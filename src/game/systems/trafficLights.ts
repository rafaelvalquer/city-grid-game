import type { TrafficLightAxis, TrafficLightSignal, TrafficLightState } from '../../types/city.types';
import type { TravelDirection } from '../../types/agent.types';
import { keyOf } from '../city/grid';

export type TrafficLightMap = Map<string, TrafficLightState>;

export const TRAFFIC_LIGHT_BUILD_COST = 40;
export const TRAFFIC_LIGHT_GREEN_SECONDS = 6.5;
export const TRAFFIC_LIGHT_YELLOW_SECONDS = 1.2;

export function createTrafficLight(x: number, y: number, sequence = 0): TrafficLightState {
  return {
    id: `signal-${x}-${y}`,
    x,
    y,
    phase: sequence % 2 === 0 ? 'horizontalGreen' : 'verticalGreen',
    timer: 0,
    greenSeconds: TRAFFIC_LIGHT_GREEN_SECONDS,
    yellowSeconds: TRAFFIC_LIGHT_YELLOW_SECONDS,
    offsetSeconds: (sequence % 4) * 0.75,
  };
}

export function updateTrafficLight(light: TrafficLightState, dt: number): TrafficLightState {
  let timer = light.timer + dt;
  let phase = light.phase;

  while (timer >= phaseDuration(light, phase)) {
    timer -= phaseDuration(light, phase);
    phase = nextPhase(phase);
  }

  return {
    ...light,
    phase,
    timer,
  };
}

export function getTrafficLightKey(x: number, y: number): string {
  return keyOf(x, y);
}

export function getTrafficLightAxis(direction: TravelDirection): TrafficLightAxis {
  return direction === 'east' || direction === 'west' ? 'horizontal' : 'vertical';
}

export function getTrafficLightSignal(light: TrafficLightState, direction: TravelDirection): TrafficLightSignal {
  const axis = getTrafficLightAxis(direction);

  if (light.phase === 'horizontalGreen') return axis === 'horizontal' ? 'green' : 'red';
  if (light.phase === 'verticalGreen') return axis === 'vertical' ? 'green' : 'red';
  if (light.phase === 'horizontalYellow') return axis === 'horizontal' ? 'yellow' : 'red';
  return axis === 'vertical' ? 'yellow' : 'red';
}

export function getTrafficLightOpenAxis(light: TrafficLightState): TrafficLightAxis {
  return light.phase === 'horizontalGreen' || light.phase === 'horizontalYellow' ? 'horizontal' : 'vertical';
}

export function isTrafficLightGreenForDirection(light: TrafficLightState, direction: TravelDirection): boolean {
  return getTrafficLightSignal(light, direction) === 'green';
}

function phaseDuration(light: TrafficLightState, phase: TrafficLightState['phase']): number {
  return phase === 'horizontalGreen' || phase === 'verticalGreen' ? light.greenSeconds : light.yellowSeconds;
}

function nextPhase(phase: TrafficLightState['phase']): TrafficLightState['phase'] {
  if (phase === 'horizontalGreen') return 'horizontalYellow';
  if (phase === 'horizontalYellow') return 'verticalGreen';
  if (phase === 'verticalGreen') return 'verticalYellow';
  return 'horizontalGreen';
}
