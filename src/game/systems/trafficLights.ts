import type { TrafficLightAxis, TrafficLightSignal, TrafficLightState } from '../../types/city.types';
import type { TravelDirection } from '../../types/agent.types';
import { keyOf } from '../city/grid';

export type TrafficLightMap = Map<string, TrafficLightState>;

export type TrafficLightDemand = {
  horizontalQueue: number;
  verticalQueue: number;
  horizontalMaxWait: number;
  verticalMaxWait: number;
  occupiedCount: number;
  maxInsideWait: number;
};

export const TRAFFIC_LIGHT_BUILD_COST = 40;
export const TRAFFIC_LIGHT_GREEN_SECONDS = 6.5;
export const TRAFFIC_LIGHT_YELLOW_SECONDS = 1.0;
export const TRAFFIC_LIGHT_ALL_RED_SECONDS = 0.45;
export const TRAFFIC_LIGHT_STARTUP_SECONDS = 5.0;
export const TRAFFIC_LIGHT_EMERGENCY_SECONDS = 3.5;
export const TRAFFIC_LIGHT_MIN_GREEN_SECONDS = 2.1;
export const TRAFFIC_LIGHT_MAX_GREEN_SECONDS = 9.5;
export const TRAFFIC_LIGHT_FORCE_SWITCH_WAIT_SECONDS = 7.0;
export const TRAFFIC_LIGHT_BOX_HOLD_SECONDS = 2.6;

export const EMPTY_TRAFFIC_LIGHT_DEMAND: TrafficLightDemand = {
  horizontalQueue: 0,
  verticalQueue: 0,
  horizontalMaxWait: 0,
  verticalMaxWait: 0,
  occupiedCount: 0,
  maxInsideWait: 0,
};

export function createTrafficLight(
  x: number,
  y: number,
  sequence = 0,
  preferredAxis?: TrafficLightAxis,
): TrafficLightState {
  const initialAxis = preferredAxis ?? (sequence % 2 === 0 ? 'horizontal' : 'vertical');

  return {
    id: `signal-${x}-${y}`,
    x,
    y,
    phase: initialAxis === 'horizontal' ? 'horizontalGreen' : 'verticalGreen',
    timer: 0,
    greenSeconds: TRAFFIC_LIGHT_GREEN_SECONDS,
    yellowSeconds: TRAFFIC_LIGHT_YELLOW_SECONDS,
    offsetSeconds: (sequence % 4) * 0.75,
    startupSeconds: TRAFFIC_LIGHT_STARTUP_SECONDS,
    emergencyAxis: undefined,
    emergencySeconds: 0,
    nextGreenAxis: undefined,
    lastSwitchReason: 'startup',
  };
}

export function updateTrafficLight(
  light: TrafficLightState,
  dt: number,
  demand: TrafficLightDemand = EMPTY_TRAFFIC_LIGHT_DEMAND,
): TrafficLightState {
  let next: TrafficLightState = { ...light };

  if (next.startupSeconds > 0) {
    return {
      ...next,
      startupSeconds: Math.max(0, next.startupSeconds - dt),
      timer: 0,
      emergencySeconds: 0,
      emergencyAxis: undefined,
      nextGreenAxis: undefined,
      lastSwitchReason: 'startup',
    };
  }

  const forcedAxis = getEmergencyAxis(next, demand);
  if (forcedAxis) {
    return {
      ...setGreenAxis(next, forcedAxis, 'emergency'),
      emergencyAxis: forcedAxis,
      emergencySeconds: TRAFFIC_LIGHT_EMERGENCY_SECONDS,
    };
  }

  if (next.emergencySeconds > 0) {
    const remaining = Math.max(0, next.emergencySeconds - dt);
    return {
      ...next,
      timer: 0,
      emergencySeconds: remaining,
      emergencyAxis: remaining > 0 ? next.emergencyAxis : undefined,
      lastSwitchReason: remaining > 0 ? 'emergency' : 'timer',
    };
  }

  let timer = next.timer + dt;
  if (isGreenPhase(next.phase) && shouldSwitchGreen(next, demand, timer)) {
    return startYellowForOppositeAxis(next, 'adaptive');
  }

  while (timer >= phaseDuration(next, next.phase)) {
    timer -= phaseDuration(next, next.phase);
    next = advancePhase(next, timer);
  }

  return {
    ...next,
    timer,
  };
}

export function getTrafficLightKey(x: number, y: number): string {
  return keyOf(x, y);
}

export function getTrafficLightAxis(direction: TravelDirection): TrafficLightAxis {
  return direction === 'east' || direction === 'west' ? 'horizontal' : 'vertical';
}

export function isTrafficLightControlling(light: TrafficLightState): boolean {
  return light.startupSeconds <= 0;
}

export function getTrafficLightSignal(light: TrafficLightState, direction: TravelDirection): TrafficLightSignal {
  if (!isTrafficLightControlling(light)) return 'yellow';

  const axis = getTrafficLightAxis(direction);
  if (light.phase === 'allRedClearance') return 'red';
  if (light.phase === 'horizontalGreen') return axis === 'horizontal' ? 'green' : 'red';
  if (light.phase === 'verticalGreen') return axis === 'vertical' ? 'green' : 'red';
  if (light.phase === 'horizontalYellow') return axis === 'horizontal' ? 'yellow' : 'red';
  return axis === 'vertical' ? 'yellow' : 'red';
}

export function getTrafficLightOpenAxis(light: TrafficLightState): TrafficLightAxis {
  if (light.phase === 'allRedClearance') return light.nextGreenAxis ?? 'horizontal';
  return light.phase === 'horizontalGreen' || light.phase === 'horizontalYellow' ? 'horizontal' : 'vertical';
}

export function isTrafficLightGreenForDirection(light: TrafficLightState, direction: TravelDirection): boolean {
  return getTrafficLightSignal(light, direction) === 'green';
}

function shouldSwitchGreen(light: TrafficLightState, demand: TrafficLightDemand, timer: number): boolean {
  if (timer < TRAFFIC_LIGHT_MIN_GREEN_SECONDS) return false;
  if (timer >= TRAFFIC_LIGHT_MAX_GREEN_SECONDS) return true;

  const openAxis = getTrafficLightOpenAxis(light);
  const openQueue = openAxis === 'horizontal' ? demand.horizontalQueue : demand.verticalQueue;
  const closedQueue = openAxis === 'horizontal' ? demand.verticalQueue : demand.horizontalQueue;
  const closedMaxWait = openAxis === 'horizontal' ? demand.verticalMaxWait : demand.horizontalMaxWait;

  if (closedMaxWait >= TRAFFIC_LIGHT_FORCE_SWITCH_WAIT_SECONDS) return true;
  return openQueue === 0 && closedQueue > 0;
}

function getEmergencyAxis(light: TrafficLightState, demand: TrafficLightDemand): TrafficLightAxis | undefined {
  if (light.startupSeconds > 0 || light.emergencySeconds > 0 || light.phase === 'allRedClearance') return undefined;

  const openAxis = getTrafficLightOpenAxis(light);
  if (demand.occupiedCount > 0 && demand.maxInsideWait > 0 && demand.maxInsideWait < TRAFFIC_LIGHT_BOX_HOLD_SECONDS) {
    return openAxis;
  }

  const horizontalBlocked = demand.horizontalMaxWait >= TRAFFIC_LIGHT_FORCE_SWITCH_WAIT_SECONDS;
  const verticalBlocked = demand.verticalMaxWait >= TRAFFIC_LIGHT_FORCE_SWITCH_WAIT_SECONDS;

  if (horizontalBlocked && openAxis !== 'horizontal') return 'horizontal';
  if (verticalBlocked && openAxis !== 'vertical') return 'vertical';
  return undefined;
}

function setGreenAxis(light: TrafficLightState, axis: TrafficLightAxis, reason: TrafficLightState['lastSwitchReason']): TrafficLightState {
  return {
    ...light,
    phase: axis === 'horizontal' ? 'horizontalGreen' : 'verticalGreen',
    timer: 0,
    nextGreenAxis: undefined,
    lastSwitchReason: reason,
  };
}

function startYellowForOppositeAxis(light: TrafficLightState, reason: TrafficLightState['lastSwitchReason']): TrafficLightState {
  const openAxis = getTrafficLightOpenAxis(light);
  return {
    ...light,
    phase: openAxis === 'horizontal' ? 'horizontalYellow' : 'verticalYellow',
    nextGreenAxis: openAxis === 'horizontal' ? 'vertical' : 'horizontal',
    timer: 0,
    lastSwitchReason: reason,
  };
}

function phaseDuration(light: TrafficLightState, phase: TrafficLightState['phase']): number {
  if (phase === 'allRedClearance') return TRAFFIC_LIGHT_ALL_RED_SECONDS;
  return phase === 'horizontalGreen' || phase === 'verticalGreen' ? light.greenSeconds : light.yellowSeconds;
}

function isGreenPhase(phase: TrafficLightState['phase']): boolean {
  return phase === 'horizontalGreen' || phase === 'verticalGreen';
}

function advancePhase(light: TrafficLightState, timer: number): TrafficLightState {
  if (light.phase === 'horizontalGreen' || light.phase === 'verticalGreen') {
    return { ...startYellowForOppositeAxis(light, 'timer'), timer };
  }

  if (light.phase === 'horizontalYellow' || light.phase === 'verticalYellow') {
    return {
      ...light,
      phase: 'allRedClearance',
      timer,
      lastSwitchReason: 'timer',
    };
  }

  return setGreenAxis(light, light.nextGreenAxis ?? 'horizontal', 'timer');
}
