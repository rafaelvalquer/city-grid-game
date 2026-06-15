import type { Car, IntersectionReason, TrafficState, TravelDirection } from '../../types/agent.types';
import type { RoadDirection, RoadType, Tile, Vec2 } from '../../types/city.types';
import { ROAD_CONFIG } from '../config/roadConfig';
import { getNeighbors4, isRoadType, keyOf } from '../city/grid';
import { getTrafficLightSignal, isTrafficLightControlling, type TrafficLightMap } from './trafficLights';
import {
  getRoundaboutCenter,
  getRoundaboutDistanceAlongRing,
  getRoundaboutRing,
  isEnteringRoundabout,
  isInsideRoundabout,
  willExitBeforeEntry,
  isRoundaboutTile,
} from './roundabouts';

export type TrafficDecision = {
  targetSpeed: number;
  desiredSpeed: number;
  laneOffset: Vec2;
  laneIndex: number;
  laneCount: number;
  laneSide: -1 | 1;
  direction: TravelDirection;
  state: TrafficState;
  blockedByCarId?: string;
  intersectionStopKey?: string;
  intersectionQueuePosition?: number;
  intersectionQueueLength?: number;
  intersectionReason?: IntersectionReason;
  turning: boolean;
  hardStop: boolean;
};

type TurnIntent = 'straight' | 'right' | 'left' | 'uturn';

export type IntersectionIntent = {
  carId: string;
  key: string;
  entryDirection: TravelDirection;
  exitDirection: TravelDirection;
  turnIntent: TurnIntent;
  entryRoadType: RoadType;
  roadRank: number;
  waitSeconds: number;
  priorityToken: number;
  escape: boolean;
  exitBlocked: boolean;
};

export type IntersectionControl = {
  key: string;
  occupiedByCarId?: string;
  active: IntersectionIntent[];
  queue: IntersectionIntent[];
  releasedCarIds: Set<string>;
};

export type IntersectionControls = Map<string, IntersectionControl>;

const STOP_BEFORE_INTERSECTION_AT = 0.52;
const INTERSECTION_STOP_SECONDS = 0.22;
const INTERSECTION_APPROACH_SPEED = 0.38;
const INTERSECTION_CLEAR_SPEED = 0.95;
const TRAFFIC_LIGHT_STOP_AT = 0.62;
const PRIORITY_WAIT_SECONDS = 2.4;
const GRIDLOCK_ESCAPE_SECONDS = 5;
const INSIDE_CLEAR_SECONDS = 1.4;
const SAFE_DISTANCE = 0.48;
const LOOK_AHEAD_DISTANCE = 1.18;
const CURVE_SLOWDOWN = 0.62;
const BASE_SPEED = 1.45;
const EXIT_ROLLING_RELEASE_WAIT_SECONDS = 2.6;
const EXIT_CRITICAL_PROGRESS = 0.24;
const EXIT_LANE_CLEARANCE = 0.16;
const RIGHT_TURN_YIELD_SPEED = 0.72;
const RIGHT_TURN_DEBUG_SECONDS = 2.5;
const OVERLAP_LEADER_DISTANCE = 0.08;
const ROUNDABOUT_ENTRY_APPROACH_SPEED = 0.38;
const ROUNDABOUT_ENTRY_FREE_SPEED = 0.62;
const ROUNDABOUT_ENTRY_GAP_SPEED = 0.52;
const ROUNDABOUT_BLOCK_DISTANCE = 1.15;
const ROUNDABOUT_FREE_DISTANCE = 1.65;
const ROUNDABOUT_LANE_COUNT = 3;
const ROUNDABOUT_LANE_RADIAL_OFFSETS = [0.24, 0, -0.24];

const rightTurnDebugTimers = new Map<string, number>();

export function getDirection(from: Vec2, to: Vec2): TravelDirection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

export function getCurrentDirection(car: Car): TravelDirection {
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  if (current && next) return getDirection(current, next);
  const previous = car.route[Math.max(0, car.routeIndex - 1)];
  if (previous && current) return getDirection(previous, current);
  return car.direction ?? 'east';
}

export function getLaneOffset(
  direction: TravelDirection,
  roadType: RoadType,
  carId: string,
  oneWayDirection?: RoadDirection,
): { offset: Vec2; laneIndex: number; laneCount: number; laneSide: -1 | 1 } {
  if (roadType === 'roundabout') {
    return { offset: { x: 0, y: 0 }, laneIndex: 0, laneCount: 1, laneSide: 1 };
  }

  const isAvenue = roadType === 'avenue';
  if (oneWayDirection === direction) {
    const laneCount = isAvenue ? 4 : 2;
    const laneIndex = hashLane(carId, laneCount);
    const offsets = isAvenue ? [-0.33, -0.12, 0.12, 0.33] : [-0.14, 0.14];
    const signed = offsets[laneIndex] ?? 0;
    const laneSide: -1 | 1 = signed >= 0 ? 1 : -1;
    if (direction === 'east' || direction === 'west') return { laneIndex, laneCount, laneSide, offset: { x: 0, y: signed } };
    return { laneIndex, laneCount, laneSide, offset: { x: -signed, y: 0 } };
  }

  const laneIndex = isAvenue ? hashLane(carId, 2) : 0;
  const laneCount = isAvenue ? 4 : 2;
  const laneSide: -1 | 1 = direction === 'east' || direction === 'south' ? 1 : -1;
  const base = isAvenue ? (laneIndex === 0 ? 0.14 : 0.32) : 0.2;
  const signed = base * laneSide;

  if (direction === 'east' || direction === 'west') return { laneIndex, laneCount, laneSide, offset: { x: 0, y: signed } };
  return { laneIndex, laneCount, laneSide, offset: { x: -signed, y: 0 } };
}

export function getLaneOffsetForRouteSegment(
  grid: Tile[][],
  car: Car,
  from: Vec2,
  to: Vec2,
): { offset: Vec2; laneIndex: number; laneCount: number; laneSide: -1 | 1 } {
  if (isInsideRoundabout(grid, from)) {
    return getRoundaboutLaneOffset(grid, car, from, to);
  }

  const direction = getDirection(from, to);
  const roadType = getRoadType(grid, from);
  return getLaneOffset(direction, roadType, car.id, getOneWayDirection(grid, from, direction));
}

export function getRoundaboutLaneIndexForCar(grid: Tile[][], car: Car, from?: Vec2, to?: Vec2): number {
  const current = from ?? car.route[car.routeIndex];
  const next = to ?? car.route[car.routeIndex + 1];
  if (!current || !next) return 1;
  const exitNumber = getRoundaboutExitNumber(grid, car.route, car.routeIndex, current, next);
  return Math.max(0, Math.min(ROUNDABOUT_LANE_COUNT - 1, exitNumber - 1));
}

export function isIntersection(grid: Tile[][], pos: Vec2): boolean {
  const tile = grid[pos.y]?.[pos.x];
  if (!tile || !isRoadType(tile.type)) return false;
  if (isRoundaboutTile(tile)) return false;
  return getNeighbors4(pos).filter((next) => isRoadType(grid[next.y]?.[next.x]?.type)).length >= 3;
}

export function buildIntersectionControls(grid: Tile[][], cars: Car[]): IntersectionControls {
  const controls: IntersectionControls = new Map();

  for (const car of cars) {
    if (car.status === 'arrived' || car.lifecyclePhase !== 'driving') continue;

    const current = { x: car.currentTileX, y: car.currentTileY };
    if (isIntersection(grid, current)) {
      const control = ensureIntersectionControl(controls, keyOf(current.x, current.y));
      control.occupiedByCarId ??= car.id;

      const activeIntent = buildIntentForCar(grid, car, cars, current);
      if (activeIntent) control.active.push(activeIntent);
    }

    const routeCurrent = car.route[car.routeIndex];
    const next = car.route[car.routeIndex + 1];
    const approaching = routeCurrent && next && car.progressToNext >= STOP_BEFORE_INTERSECTION_AT && isIntersection(grid, next);
    if (!approaching) continue;

    const control = ensureIntersectionControl(controls, keyOf(next.x, next.y));
    const intent = buildIntentForCar(grid, car, cars, next);
    if (intent) control.queue.push(intent);
  }

  for (const control of controls.values()) {
    control.queue.sort(compareIntersectionIntent);
    control.releasedCarIds = resolveReleasedCars(grid, control);
  }

  return controls;
}

export function getIntersectionQueueInfo(controls: IntersectionControls, key?: string, carId?: string): { position?: number; length?: number } {
  if (!key || !carId) return {};
  const queue = controls.get(key)?.queue ?? [];
  const index = queue.findIndex((intent) => intent.carId === carId);
  return {
    position: index >= 0 ? index + 1 : undefined,
    length: queue.length || undefined,
  };
}

export function computeTrafficDecision(
  grid: Tile[][],
  car: Car,
  cars: Car[],
  intersectionControls: IntersectionControls,
  trafficLights: TrafficLightMap,
  congestion: number,
): TrafficDecision {
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  if (!current || !next) {
    return {
      targetSpeed: 0,
      desiredSpeed: 0,
      laneOffset: car.laneOffset,
      laneIndex: car.laneIndex,
      direction: car.direction,
      state: 'moving',
      turning: false,
      laneCount: car.laneCount,
      laneSide: car.laneSide,
      hardStop: false,
    };
  }

  const direction = getDirection(current, next);
  const insideIntersection = isIntersection(grid, { x: car.currentTileX, y: car.currentTileY });
  const roadType = getRoadType(grid, current);
  let { offset, laneIndex, laneCount, laneSide } = getLaneOffsetForRouteSegment(grid, car, current, next);
  const desiredSpeed = (BASE_SPEED * ROAD_CONFIG[roadType].speed) / (1 + Math.max(0, congestion - 0.25));
  const turning = isTurningSoon(car);
  let targetSpeed = desiredSpeed * (turning ? CURVE_SLOWDOWN : 1);
  let state: TrafficState = turning ? 'turning' : 'moving';
  let blockedByCarId: string | undefined;
  let hardStop = false;
  let intersectionReason: IntersectionReason | undefined;

  const clearingIntersectionBox = shouldClearIntersectionBox(grid, car);
  let leader = findLeaderAhead(car, cars, direction, laneIndex);
  const passingLane = leader?.car.vehicleType === 'bus' && leader.car.status === 'stopped' && roadType === 'avenue'
    ? findAvenuePassingLane(car, cars, direction, laneIndex)
    : undefined;
  if (passingLane) {
    laneIndex = passingLane.laneIndex;
    laneCount = passingLane.laneCount;
    laneSide = passingLane.laneSide;
    offset = passingLane.offset;
    leader = findLeaderAhead(car, cars, direction, laneIndex);
  }
  if (leader && !insideIntersection && !clearingIntersectionBox) {
    blockedByCarId = leader.car.id;
    if (leader.distance <= SAFE_DISTANCE) {
      targetSpeed = 0;
      state = 'queued';
      hardStop = leader.distance <= SAFE_DISTANCE * 0.55;
    } else if (leader.distance < LOOK_AHEAD_DISTANCE) {
      const ratio = (leader.distance - SAFE_DISTANCE) / (LOOK_AHEAD_DISTANCE - SAFE_DISTANCE);
      targetSpeed = Math.min(targetSpeed, desiredSpeed * Math.max(0.12, ratio));
      state = 'queued';
    }
  }

  // Um carro que já entrou na caixa do cruzamento não deve mais obedecer vermelho.
  // Ele tem prioridade de limpeza para não bloquear todas as aproximações.
  if (insideIntersection || clearingIntersectionBox) {
    targetSpeed = Math.max(targetSpeed, INTERSECTION_CLEAR_SPEED);
    state = 'intersection';
    if (!blockedByCarId) hardStop = false;
  }

  if (isInsideRoundabout(grid, current)) {
    targetSpeed = Math.min(targetSpeed, desiredSpeed);
    state = turning ? 'turning' : 'moving';
    hardStop = false;
  } else if (isEnteringRoundabout(grid, current, next)) {
    const roundaboutDecision = computeRoundaboutEntryDecision(grid, car, cars, next);
    if (roundaboutDecision.blockedByCarId) {
      targetSpeed = car.progressToNext >= TRAFFIC_LIGHT_STOP_AT ? 0 : Math.min(targetSpeed, ROUNDABOUT_ENTRY_APPROACH_SPEED);
      state = 'intersection';
      hardStop = car.progressToNext >= TRAFFIC_LIGHT_STOP_AT;
      blockedByCarId = roundaboutDecision.blockedByCarId;
      return {
        targetSpeed,
        desiredSpeed,
        laneOffset: offset,
        laneIndex,
        laneCount,
        laneSide,
        direction,
        state,
        blockedByCarId,
        intersectionStopKey: keyOf(next.x, next.y),
        intersectionReason: roundaboutDecision.reason,
        turning,
        hardStop,
      };
    }

    if (!blockedByCarId && targetSpeed > 0) {
      targetSpeed = roundaboutDecision.reason === 'roundabout_gap'
        ? Math.max(Math.min(targetSpeed, roundaboutDecision.targetSpeed), INTERSECTION_APPROACH_SPEED)
        : Math.min(targetSpeed, roundaboutDecision.targetSpeed);
      state = targetSpeed > 0 ? 'turning' : 'intersection';
      intersectionReason = roundaboutDecision.reason;
    }
    if (!blockedByCarId) hardStop = false;
  }

  const intersectionKey = keyOf(next.x, next.y);
  const enteringIntersection = !insideIntersection && isApproachingIntersection(grid, car, next);
  let intersectionQueuePosition: number | undefined;
  let intersectionQueueLength: number | undefined;

  if (enteringIntersection) {
    const control = intersectionControls.get(intersectionKey);
    const queueInfo = getIntersectionQueueInfo(intersectionControls, intersectionKey, car.id);
    intersectionQueuePosition = queueInfo.position;
    intersectionQueueLength = queueInfo.length;

    const trafficLight = trafficLights.get(intersectionKey);
    const intent = control?.queue.find((entry) => entry.carId === car.id);
    const physicalOccupant = isBlockingPhysicalOccupant(control, car, cars, intent);
    const signalIsControlling = Boolean(trafficLight && isTrafficLightControlling(trafficLight));

    if (trafficLight && signalIsControlling && intent) {
      const signal = getTrafficLightSignal(trafficLight, direction);
      const blockedByExit = intent.exitBlocked || physicalOccupant;
      if (signal !== 'green') {
        targetSpeed = car.progressToNext >= TRAFFIC_LIGHT_STOP_AT ? 0 : Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
        state = 'intersection';
        hardStop = car.progressToNext >= TRAFFIC_LIGHT_STOP_AT;
        intersectionReason = signal === 'yellow' ? 'signal_yellow' : 'signal_red';
      } else if (blockedByExit) {
        targetSpeed = car.progressToNext >= TRAFFIC_LIGHT_STOP_AT ? 0 : Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
        state = 'intersection';
        hardStop = car.progressToNext >= TRAFFIC_LIGHT_STOP_AT;
        intersectionReason = intent.exitBlocked ? 'exit_blocked' : 'box_occupied';
      } else {
        // Sinal verde: o eixo liberado flui sem parada obrigatória.
        hardStop = false;
      }
    } else {
      const alreadyStoppedHere = car.intersectionStopKey === intersectionKey && car.waitTimer >= INTERSECTION_STOP_SECONDS;
      const released = Boolean(control?.releasedCarIds.has(car.id));
      const rightTurnFree = Boolean(intent && canRightTurnYield(intent, control));
      const freeFlow = Boolean(intent && released && canFreeFlowThroughIntersection(grid, intersectionKey, intent, control));

      if (rightTurnFree) {
        if (hardStop && blockedByCarId) {
          targetSpeed = 0;
          state = 'queued';
        } else {
          targetSpeed = blockedByCarId
            ? Math.min(targetSpeed, RIGHT_TURN_YIELD_SPEED)
            : Math.max(Math.min(targetSpeed, RIGHT_TURN_YIELD_SPEED), INTERSECTION_APPROACH_SPEED);
          state = 'intersection';
          hardStop = false;
        }
        intersectionReason = 'right_turn_free';
      } else if (intent?.turnIntent === 'right') {
        debugRightTurnBlocked(car, intent, control, physicalOccupant);
      } else if (!alreadyStoppedHere && !freeFlow) {
        targetSpeed = car.progressToNext >= TRAFFIC_LIGHT_STOP_AT ? 0 : Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
        state = 'intersection';
        hardStop = car.progressToNext >= TRAFFIC_LIGHT_STOP_AT;
        intersectionReason = 'unsignalized_queue';
      } else if (!released) {
        targetSpeed = physicalOccupant || car.progressToNext >= TRAFFIC_LIGHT_STOP_AT ? 0 : Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
        state = 'intersection';
        hardStop = physicalOccupant || car.progressToNext >= TRAFFIC_LIGHT_STOP_AT;
        intersectionReason = physicalOccupant ? 'box_occupied' : intent?.exitBlocked ? 'exit_blocked' : 'unsignalized_queue';
      }
    }
  }

  if (state === 'turning' && targetSpeed <= 0.05) {
    state = blockedByCarId ? 'queued' : 'intersection';
  }

  return {
    targetSpeed,
    desiredSpeed,
    laneOffset: offset,
    laneIndex,
    laneCount,
    laneSide,
    direction,
    state,
    blockedByCarId,
    intersectionStopKey: enteringIntersection ? intersectionKey : undefined,
    intersectionQueuePosition,
    intersectionQueueLength,
    intersectionReason,
    turning,
    hardStop,
  };
}

function ensureIntersectionControl(controls: IntersectionControls, key: string): IntersectionControl {
  let control = controls.get(key);
  if (!control) {
    control = { key, active: [], queue: [], releasedCarIds: new Set() };
    controls.set(key, control);
  }
  return control;
}

function getTurnIntent(from: TravelDirection, to: TravelDirection): TurnIntent {
  if (from === to) return 'straight';

  if (
    (from === 'north' && to === 'east')
    || (from === 'east' && to === 'south')
    || (from === 'south' && to === 'west')
    || (from === 'west' && to === 'north')
  ) return 'right';

  if (
    (from === 'north' && to === 'west')
    || (from === 'west' && to === 'south')
    || (from === 'south' && to === 'east')
    || (from === 'east' && to === 'north')
  ) return 'left';

  return 'uturn';
}

function buildIntentForCar(grid: Tile[][], car: Car, cars: Car[], intersectionTile: Vec2): IntersectionIntent | undefined {
  const previous = car.route[Math.max(0, car.routeIndex - 1)];
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  const after = car.route[car.routeIndex + 2];

  if (!current || !next) return undefined;

  const insideIntersection = isIntersection(grid, { x: car.currentTileX, y: car.currentTileY });
  const enteringIntersection = isIntersection(grid, next);

  let entryDirection: TravelDirection;
  let exitDirection: TravelDirection;
  let exitTile: Vec2 | undefined;

  if (insideIntersection && previous) {
    entryDirection = getDirection(previous, current);
    exitDirection = getDirection(current, next);
    exitTile = next;
  } else if (enteringIntersection) {
    entryDirection = getDirection(current, next);
    exitDirection = after ? getDirection(next, after) : entryDirection;
    exitTile = after;
  } else {
    entryDirection = getDirection(current, next);
    exitDirection = entryDirection;
    exitTile = next;
  }

  return {
    carId: car.id,
    key: keyOf(intersectionTile.x, intersectionTile.y),
    entryDirection,
    exitDirection,
    turnIntent: getTurnIntent(entryDirection, exitDirection),
    entryRoadType: getRoadType(grid, insideIntersection ? previous ?? current : current),
    roadRank: getRoadRank(grid, insideIntersection ? previous ?? current : current),
    waitSeconds: Math.max(car.intersectionWaitSeconds, car.stuckSeconds),
    priorityToken: car.priorityToken || Number.MAX_SAFE_INTEGER,
    escape: Math.max(car.intersectionWaitSeconds, car.stuckSeconds) >= GRIDLOCK_ESCAPE_SECONDS,
    exitBlocked: isExitBlocked(grid, car, cars, exitTile, exitDirection),
  };
}

function canFreeFlowThroughIntersection(grid: Tile[][], intersectionKey: string, intent: IntersectionIntent, control?: IntersectionControl): boolean {
  if (!control) return false;
  if (intent.exitBlocked) return false;

  const activeAndReleased = [
    ...control.active,
    ...control.queue.filter((entry) => control.releasedCarIds.has(entry.carId)),
  ].filter((entry) => entry.carId !== intent.carId);

  if (activeAndReleased.some((entry) => isSameMovement(entry, intent))) return false;
  if (activeAndReleased.some((entry) => hasSameExit(entry, intent))) return false;

  const approaching = control.queue.filter((entry) => entry.carId !== intent.carId && !control.releasedCarIds.has(entry.carId));
  const hasApproachingConflict = approaching.some((entry) => hasIntersectionConflict(grid, intersectionKey, intent, entry));
  if (!activeAndReleased.length && !hasApproachingConflict) return true;
  if (activeAndReleased.length > 0 && activeAndReleased.every((entry) => areMovementsCompatible(grid, intersectionKey, intent, entry)) && !hasApproachingConflict) {
    return true;
  }

  if (intent.turnIntent === 'right') return true;

  if (isTIntersectionByKey(grid, intersectionKey) && intent.turnIntent === 'straight') {
    return !activeAndReleased.some((entry) => entry.turnIntent !== 'straight');
  }

  return false;
}

function hasIntersectionConflict(grid: Tile[][], intersectionKey: string, a: IntersectionIntent, b: IntersectionIntent): boolean {
  if (b.exitBlocked) return true;
  if (isSameMovement(a, b)) return true;
  if (hasSameExit(a, b)) return true;
  return !areMovementsCompatible(grid, intersectionKey, a, b);
}

function canRightTurnYield(
  intent: IntersectionIntent,
  control: IntersectionControl | undefined,
): boolean {
  if (intent.turnIntent !== 'right') return false;
  if (intent.exitBlocked) return false;
  if (!control) return true;

  const activeAndReleased = [
    ...control.active,
    ...control.queue.filter((entry) => control.releasedCarIds.has(entry.carId)),
  ].filter((entry) => entry.carId !== intent.carId);

  if (activeAndReleased.some((entry) => hasSameExit(entry, intent))) return false;
  if (activeAndReleased.some((entry) => isSameMovement(entry, intent))) return false;
  return true;
}

function compareIntersectionIntent(a: IntersectionIntent, b: IntersectionIntent): number {
  if (a.roadRank !== b.roadRank) return b.roadRank - a.roadRank;
  if (a.escape !== b.escape) return a.escape ? -1 : 1;
  const aPriority = a.waitSeconds >= PRIORITY_WAIT_SECONDS;
  const bPriority = b.waitSeconds >= PRIORITY_WAIT_SECONDS;
  if (aPriority !== bPriority) return aPriority ? -1 : 1;
  if (turnRank(a.turnIntent) !== turnRank(b.turnIntent)) return turnRank(b.turnIntent) - turnRank(a.turnIntent);
  if (Math.abs(a.waitSeconds - b.waitSeconds) > 0.05) return b.waitSeconds - a.waitSeconds;
  return a.priorityToken - b.priorityToken;
}

function turnRank(turnIntent: TurnIntent): number {
  if (turnIntent === 'straight') return 3;
  if (turnIntent === 'right') return 2;
  if (turnIntent === 'left') return 1;
  return 0;
}

function resolveReleasedCars(grid: Tile[][], control: IntersectionControl): Set<string> {
  const released = new Set<string>();
  const acceptedIntents = [...control.active];

  for (const intent of control.queue) {
    if (intent.turnIntent === 'right') continue;
    if (!canReleaseIntoIntersection(intent)) continue;

    const compatible = acceptedIntents.every((activeIntent) => areMovementsCompatible(grid, control.key, intent, activeIntent));
    if (!compatible) continue;

    released.add(intent.carId);
    acceptedIntents.push(intent);
  }

  return released;
}

function canReleaseIntoIntersection(intent: IntersectionIntent): boolean {
  return !intent.exitBlocked;
}

function getRoundaboutLaneOffset(
  grid: Tile[][],
  car: Car,
  from: Vec2,
  to: Vec2,
): { offset: Vec2; laneIndex: number; laneCount: number; laneSide: -1 | 1 } {
  const roundaboutPos = isInsideRoundabout(grid, from) ? from : to;
  const center = getRoundaboutCenter(grid, roundaboutPos);
  if (!center) return { offset: { x: 0, y: 0 }, laneIndex: 1, laneCount: ROUNDABOUT_LANE_COUNT, laneSide: 1 };

  const laneIndex = getRoundaboutLaneIndexForCar(grid, car, from, to);
  const radial = normalizeVec({ x: roundaboutPos.x - center.x, y: roundaboutPos.y - center.y });
  const distance = ROUNDABOUT_LANE_RADIAL_OFFSETS[laneIndex] ?? 0;
  const laneSide: -1 | 1 = laneIndex === 0 ? 1 : -1;

  return {
    offset: { x: radial.x * distance, y: radial.y * distance },
    laneIndex,
    laneCount: ROUNDABOUT_LANE_COUNT,
    laneSide,
  };
}

function getRoundaboutExitNumber(grid: Tile[][], route: Vec2[], routeIndex: number, from: Vec2, to: Vec2): number {
  const roundaboutPos = isInsideRoundabout(grid, from) ? from : to;
  const center = getRoundaboutCenter(grid, roundaboutPos);
  if (!center) return 2;

  const entryRouteIndex = findRoundaboutEntryRouteIndex(grid, route, routeIndex, center);
  const exitRouteIndex = findRoundaboutExitRouteIndex(grid, route, Math.max(entryRouteIndex, routeIndex), center);
  if (entryRouteIndex < 0 || exitRouteIndex < 0) return 2;

  const ring = getRoundaboutRing(center);
  const entryRingIndex = ring.findIndex((tile) => samePos(tile, route[entryRouteIndex]));
  const exitRingIndex = ring.findIndex((tile) => samePos(tile, route[exitRouteIndex]));
  if (entryRingIndex < 0 || exitRingIndex < 0) return 2;
  if (entryRingIndex === exitRingIndex) return 1;

  let exitNumber = 0;
  for (let step = 1; step <= ring.length; step += 1) {
    const ringIndex = (entryRingIndex + step) % ring.length;
    const pos = ring[ringIndex];
    if (isRoundaboutExitOpportunity(grid, pos, center)) exitNumber += 1;
    if (ringIndex === exitRingIndex) return Math.max(1, exitNumber);
  }

  return Math.max(1, exitNumber);
}

function findRoundaboutEntryRouteIndex(grid: Tile[][], route: Vec2[], routeIndex: number, center: Vec2): number {
  const start = Math.min(route.length - 1, routeIndex + 1);
  for (let index = start; index >= 0; index -= 1) {
    const pos = route[index];
    if (!isInsideSameRoundabout(grid, pos, center)) continue;
    const previous = route[index - 1];
    if (!previous || !isInsideSameRoundabout(grid, previous, center)) return index;
  }
  return -1;
}

function findRoundaboutExitRouteIndex(grid: Tile[][], route: Vec2[], startIndex: number, center: Vec2): number {
  for (let index = Math.max(0, startIndex); index < route.length - 1; index += 1) {
    const pos = route[index];
    const next = route[index + 1];
    if (isInsideSameRoundabout(grid, pos, center) && !isInsideSameRoundabout(grid, next, center)) return index;
  }
  return -1;
}

function isInsideSameRoundabout(grid: Tile[][], pos: Vec2 | undefined, center: Vec2): boolean {
  if (!pos || !isInsideRoundabout(grid, pos)) return false;
  const currentCenter = getRoundaboutCenter(grid, pos);
  return Boolean(currentCenter && samePos(currentCenter, center));
}

function isRoundaboutExitOpportunity(grid: Tile[][], pos: Vec2, center: Vec2): boolean {
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
  const exitTile = { x: pos.x + dx, y: pos.y + dy };
  const tile = grid[exitTile.y]?.[exitTile.x];
  return Boolean(tile && isRoadType(tile.type) && !isRoundaboutTile(tile));
}

function normalizeVec(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.y);
  if (length <= 0.0001) return { x: 0, y: 0 };
  return { x: vec.x / length, y: vec.y / length };
}

function samePos(a: Vec2 | undefined, b: Vec2 | undefined): boolean {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function computeRoundaboutEntryDecision(
  grid: Tile[][],
  car: Car,
  cars: Car[],
  entryTile: Vec2,
): { blockedByCarId?: string; targetSpeed: number; reason?: IntersectionReason } {
  const center = getRoundaboutCenter(grid, entryTile);
  if (!center) return { targetSpeed: ROUNDABOUT_ENTRY_FREE_SPEED };

  let hasExitingCarNearEntry = false;
  let nearestConflictDistance = Infinity;
  let nearestConflictCarId: string | undefined;
  const enteringLaneIndex = getRoundaboutLaneIndexForCar(grid, car, car.route[car.routeIndex], entryTile);

  for (const other of cars) {
    if (other.id === car.id || other.status === 'arrived' || other.lifecyclePhase !== 'driving') continue;
    if (!isInsideRoundabout(grid, { x: other.currentTileX, y: other.currentTileY })) continue;
    const otherCenter = getRoundaboutCenter(grid, { x: other.currentTileX, y: other.currentTileY });
    if (!otherCenter || otherCenter.x !== center.x || otherCenter.y !== center.y) continue;

    if (willExitBeforeEntry(grid, other, entryTile)) {
      if (Math.hypot(other.x - entryTile.x, other.y - entryTile.y) < ROUNDABOUT_FREE_DISTANCE) {
        hasExitingCarNearEntry = true;
      }
      continue;
    }

    const otherCurrent = { x: other.currentTileX, y: other.currentTileY };
    const otherNext = other.route[other.routeIndex + 1];
    if (otherCurrent.x === entryTile.x && otherCurrent.y === entryTile.y) {
      return { blockedByCarId: other.id, targetSpeed: 0, reason: 'roundabout_yield' };
    }
    if (otherNext && otherNext.x === entryTile.x && otherNext.y === entryTile.y) {
      return { blockedByCarId: other.id, targetSpeed: 0, reason: 'roundabout_yield' };
    }

    const ringDistance = getRoundaboutDistanceAlongRing(grid, otherCurrent, entryTile);
    const adjustedDistance = ringDistance === Infinity ? Infinity : Math.max(0, ringDistance - other.progressToNext);
    const otherLaneIndex = getRoundaboutLaneIndexForCar(grid, other, otherCurrent, otherNext);
    if (otherLaneIndex !== enteringLaneIndex && adjustedDistance > SAFE_DISTANCE) continue;
    if (adjustedDistance < nearestConflictDistance) {
      nearestConflictDistance = adjustedDistance;
      nearestConflictCarId = other.id;
    }
  }

  if (nearestConflictCarId && nearestConflictDistance < ROUNDABOUT_BLOCK_DISTANCE) {
    return { blockedByCarId: nearestConflictCarId, targetSpeed: 0, reason: 'roundabout_yield' };
  }

  if (hasExitingCarNearEntry) {
    return { targetSpeed: ROUNDABOUT_ENTRY_GAP_SPEED, reason: 'roundabout_gap' };
  }

  if (!nearestConflictCarId || nearestConflictDistance > ROUNDABOUT_FREE_DISTANCE) {
    return { targetSpeed: ROUNDABOUT_ENTRY_FREE_SPEED };
  }

  return { targetSpeed: ROUNDABOUT_ENTRY_GAP_SPEED, reason: 'roundabout_gap' };
}

function areMovementsCompatible(grid: Tile[][], intersectionKey: string, a: IntersectionIntent, b: IntersectionIntent): boolean {
  if (a.carId === b.carId) return true;
  if (isSameMovement(a, b)) return false;
  if (hasSameExit(a, b)) return false;
  if (a.turnIntent === 'right' || b.turnIntent === 'right') return true;

  if (isTIntersectionByKey(grid, intersectionKey)) {
    const bothStraight = a.turnIntent === 'straight' && b.turnIntent === 'straight';
    if (bothStraight && isSameAxis(a.entryDirection, b.entryDirection)) return true;
  }

  if (a.turnIntent === 'straight' && b.turnIntent === 'straight') return isSameAxis(a.entryDirection, b.entryDirection);
  return false;
}

function isSameMovement(a: IntersectionIntent, b: IntersectionIntent): boolean {
  return a.entryDirection === b.entryDirection && a.exitDirection === b.exitDirection;
}

function hasSameExit(a: IntersectionIntent, b: IntersectionIntent): boolean {
  return a.exitDirection === b.exitDirection;
}

function isSameAxis(a: TravelDirection, b: TravelDirection): boolean {
  const horizontalA = a === 'east' || a === 'west';
  const horizontalB = b === 'east' || b === 'west';
  return horizontalA === horizontalB;
}

function isInExitLane(car: Car, exitDirection: TravelDirection, exitLanePosition: Vec2): boolean {
  const laneAxis = exitDirection === 'east' || exitDirection === 'west' ? 'y' : 'x';
  return Math.abs(car[laneAxis] - exitLanePosition[laneAxis]) <= EXIT_LANE_CLEARANCE;
}

function debugRightTurnBlocked(
  car: Car,
  intent: IntersectionIntent,
  control: IntersectionControl | undefined,
  physicalOccupant: boolean,
): void {
  if (!isTrafficDebugEnabled()) return;

  const key = `${intent.key}:${car.id}`;
  const elapsed = (rightTurnDebugTimers.get(key) ?? 0) + 0.08;
  if (elapsed < RIGHT_TURN_DEBUG_SECONDS) {
    rightTurnDebugTimers.set(key, elapsed);
    return;
  }
  rightTurnDebugTimers.set(key, 0);

  const active = [
    ...(control?.active ?? []),
    ...((control?.queue ?? []).filter((entry) => control?.releasedCarIds.has(entry.carId))),
  ].filter((entry) => entry.carId !== car.id);

  console.info('[intersection-right-turn-blocked]', {
    carId: car.id,
    key: intent.key,
    entry: intent.entryDirection,
    exit: intent.exitDirection,
    wait: Number(Math.max(car.intersectionWaitSeconds, car.stuckSeconds).toFixed(1)),
    exitBlocked: intent.exitBlocked,
    physicalOccupant,
    sameExit: active.some((entry) => hasSameExit(entry, intent)),
    sameMovement: active.some((entry) => isSameMovement(entry, intent)),
    active: active.map((entry) => ({
      carId: entry.carId,
      turn: entry.turnIntent,
      entry: entry.entryDirection,
      exit: entry.exitDirection,
    })),
  });
}

function isTIntersectionByKey(grid: Tile[][], key: string): boolean {
  const [xText, yText] = key.split(',');
  const pos = { x: Number(xText), y: Number(yText) };
  return getNeighbors4(pos).filter((next) => isRoadType(grid[next.y]?.[next.x]?.type)).length === 3;
}

function isExitBlocked(grid: Tile[][], car: Car, cars: Car[], exitTile: Vec2 | undefined, exitDirection: TravelDirection): boolean {
  if (!exitTile) return false;
  const exitRoadType = getRoadType(grid, exitTile);
  const exitLane = getLaneOffset(exitDirection, exitRoadType, car.id, getOneWayDirection(grid, exitTile, exitDirection));
  const exitLanePosition = {
    x: exitTile.x + exitLane.offset.x,
    y: exitTile.y + exitLane.offset.y,
  };

  for (const other of cars) {
    if (other.id === car.id || other.status === 'arrived' || other.lifecyclePhase !== 'driving') continue;
    const sameTile = other.currentTileX === exitTile.x && other.currentTileY === exitTile.y;
    const nearCenter = Math.hypot(other.x - exitTile.x, other.y - exitTile.y) <= 0.58;
    if (!sameTile && !nearCenter) continue;
    if (!isInExitLane(other, exitDirection, exitLanePosition)) continue;

    const sameFlow = other.direction === exitDirection && other.laneIndex === car.laneIndex;
    const carHasWaited = Math.max(car.intersectionWaitSeconds, car.stuckSeconds) >= EXIT_ROLLING_RELEASE_WAIT_SECONDS;

    if (sameFlow) {
      if (sameTile && other.progressToNext > EXIT_CRITICAL_PROGRESS) continue;
      if (other.currentSpeed > 0.12) continue;
      if (carHasWaited && other.progressToNext > EXIT_CRITICAL_PROGRESS * 0.65) continue;
    }

    // Se o outro carro já está quase saindo do tile de destino, não trave a aproximação inteira.
    if (sameTile && other.currentSpeed > 0.22 && other.progressToNext > 0.5) continue;
    if (nearCenter && other.currentSpeed > 0.32 && other.trafficState !== 'queued' && other.status !== 'stopped') continue;

    const blockingState = other.status === 'stopped'
      || other.trafficState === 'queued'
      || other.currentSpeed < 0.18;
    const stillOccupyingTile = sameTile && other.progressToNext < (sameFlow ? EXIT_CRITICAL_PROGRESS : 0.58);
    if (blockingState || stillOccupyingTile) return true;
  }

  return false;
}

function isBlockingPhysicalOccupant(
  control: IntersectionControl | undefined,
  car: Car,
  cars: Car[],
  intent?: IntersectionIntent,
): boolean {
  if (!control?.occupiedByCarId) return false;
  if (control.occupiedByCarId === car.id) return false;

  const occupant = cars.find((other) => other.id === control.occupiedByCarId);
  if (!occupant) return false;

  if (intent && occupant.currentSpeed > 0.28 && isSameAxis(occupant.direction, intent.entryDirection)) {
    return false;
  }

  if (intent && occupant.insideIntersectionSeconds > 2.4 && isSameAxis(occupant.direction, intent.entryDirection)) {
    return false;
  }

  // Se o ocupante está limpando o cruzamento, não segure todo mundo indefinidamente.
  if (occupant.currentSpeed > 0.42 && occupant.insideIntersectionSeconds < 2.2) {
    return false;
  }

  return true;
}

function isApproachingIntersection(grid: Tile[][], car: Car, next: Vec2): boolean {
  return isIntersection(grid, next) && car.progressToNext >= STOP_BEFORE_INTERSECTION_AT;
}

function shouldClearIntersectionBox(grid: Tile[][], car: Car): boolean {
  return isIntersection(grid, { x: car.currentTileX, y: car.currentTileY }) && car.insideIntersectionSeconds >= INSIDE_CLEAR_SECONDS;
}

function getRoadType(grid: Tile[][], pos: Vec2): RoadType {
  const type = grid[pos.y]?.[pos.x]?.type;
  if (type === 'avenue' || type === 'roundabout') return type;
  return 'road';
}

function getOneWayDirection(grid: Tile[][], pos: Vec2, direction: TravelDirection): RoadDirection | undefined {
  const tile = grid[pos.y]?.[pos.x];
  if ((tile?.type !== 'road' && tile?.type !== 'avenue') || tile.oneWay !== direction) return undefined;
  return tile.oneWay;
}

function getRoadRank(grid: Tile[][], pos: Vec2): number {
  return getRoadType(grid, pos) === 'avenue' ? 2 : 1;
}

function isTurningSoon(car: Car): boolean {
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  const after = car.route[car.routeIndex + 2];
  if (!current || !next || !after) return false;
  return car.progressToNext > 0.42 && getDirection(current, next) !== getDirection(next, after);
}

function findLeaderAhead(car: Car, cars: Car[], direction: TravelDirection, laneIndex: number): { car: Car; distance: number } | undefined {
  const axis = direction === 'east' || direction === 'west' ? 'x' : 'y';
  const lineAxis = axis === 'x' ? 'y' : 'x';
  const laneLine = Math.round(car[lineAxis]);
  const scalar = travelScalar(car, direction);
  let leader: { car: Car; distance: number } | undefined;

  for (const other of cars) {
    if (other.id === car.id || other.status === 'arrived' || other.lifecyclePhase !== 'driving') continue;
    if (other.direction !== direction || other.laneIndex !== laneIndex) continue;
    if (Math.round(other[lineAxis]) !== laneLine) continue;
    const rawDistance = travelScalar(other, direction) - scalar;
    const overlapped = Math.abs(rawDistance) <= OVERLAP_LEADER_DISTANCE;
    if (!overlapped && (rawDistance <= 0 || rawDistance > LOOK_AHEAD_DISTANCE)) continue;
    if (overlapped && other.id > car.id) continue;

    const distance = overlapped ? OVERLAP_LEADER_DISTANCE : rawDistance;
    if (!leader || distance < leader.distance) leader = { car: other, distance };
  }

  return leader;
}

function findAvenuePassingLane(
  car: Car,
  cars: Car[],
  direction: TravelDirection,
  currentLaneIndex: number,
): { offset: Vec2; laneIndex: number; laneCount: number; laneSide: -1 | 1 } | undefined {
  const alternateLaneIndex = currentLaneIndex === 0 ? 1 : 0;
  const axis = direction === 'east' || direction === 'west' ? 'x' : 'y';
  const lineAxis = axis === 'x' ? 'y' : 'x';
  const lane = getFixedAvenueLaneOffset(direction, alternateLaneIndex);
  const alternateLine = Math.round((axis === 'x' ? car.y + lane.offset.y : car.x + lane.offset.x));
  const scalar = travelScalar(car, direction);

  for (const other of cars) {
    if (other.id === car.id || other.status === 'arrived' || other.lifecyclePhase !== 'driving') continue;
    if (other.direction !== direction || other.laneIndex !== alternateLaneIndex) continue;
    if (Math.round(other[lineAxis]) !== alternateLine) continue;
    const distance = travelScalar(other, direction) - scalar;
    if (distance > -0.5 && distance < LOOK_AHEAD_DISTANCE * 0.72) return undefined;
  }

  return lane;
}

function getFixedAvenueLaneOffset(
  direction: TravelDirection,
  laneIndex: number,
): { offset: Vec2; laneIndex: number; laneCount: number; laneSide: -1 | 1 } {
  const laneCount = 2;
  const laneSide: -1 | 1 = direction === 'east' || direction === 'south' ? 1 : -1;
  const base = laneIndex === 0 ? 0.14 : 0.32;
  const signed = laneSide * base;
  if (direction === 'east' || direction === 'west') return { laneIndex, laneCount, laneSide, offset: { x: 0, y: signed } };
  return { laneIndex, laneCount, laneSide, offset: { x: -signed, y: 0 } };
}

function travelScalar(car: Car, direction: TravelDirection): number {
  if (direction === 'west') return -car.x;
  if (direction === 'north') return -car.y;
  return direction === 'east' ? car.x : car.y;
}

function hashLane(id: string, laneCount = 2): number {
  let total = 0;
  for (let i = 0; i < id.length; i += 1) total += id.charCodeAt(i);
  return total % laneCount;
}

function isTrafficDebugEnabled(): boolean {
  try {
    const fromStorage = globalThis.localStorage?.getItem('cityTrafficDebug') === '1';
    const fromUrl = new URLSearchParams(globalThis.location?.search ?? '').get('trafficDebug') === '1';
    return fromStorage || fromUrl;
  } catch {
    return false;
  }
}
