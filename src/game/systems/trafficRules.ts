import type { Car, TrafficState, TravelDirection } from '../../types/agent.types';
import type { RoadType, Tile, Vec2 } from '../../types/city.types';
import { ROAD_CONFIG } from '../config/roadConfig';
import { getNeighbors4, isRoadType, keyOf } from '../city/grid';

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
  turning: boolean;
  hardStop: boolean;
};

export type IntersectionIntent = {
  carId: string;
  key: string;
  direction: TravelDirection;
  waitSeconds: number;
  priorityToken: number;
  escape: boolean;
  exitBlocked: boolean;
};

export type IntersectionControl = {
  key: string;
  occupiedByCarId?: string;
  queue: IntersectionIntent[];
  releasedCarId?: string;
};

export type IntersectionControls = Map<string, IntersectionControl>;

const STOP_BEFORE_INTERSECTION_AT = 0.52;
const INTERSECTION_STOP_SECONDS = 0.25;
const INTERSECTION_APPROACH_SPEED = 0.35;
const PRIORITY_WAIT_SECONDS = 2.8;
const GRIDLOCK_ESCAPE_SECONDS = 5;
const INSIDE_CLEAR_SECONDS = 2;
const SAFE_DISTANCE = 0.48;
const LOOK_AHEAD_DISTANCE = 1.18;
const CURVE_SLOWDOWN = 0.58;
const BASE_SPEED = 1.45;

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

export function getLaneOffset(direction: TravelDirection, roadType: RoadType, carId: string): { offset: Vec2; laneIndex: number; laneCount: number; laneSide: -1 | 1 } {
  const isAvenue = roadType === 'avenue';
  const laneIndex = isAvenue ? hashLane(carId) : 0;
  const laneCount = isAvenue ? 4 : 2;
  const laneSide: -1 | 1 = direction === 'east' || direction === 'south' ? 1 : -1;
  const base = isAvenue ? (laneIndex === 0 ? 0.14 : 0.32) : 0.2;
  const signed = base * laneSide;

  if (direction === 'east' || direction === 'west') return { laneIndex, laneCount, laneSide, offset: { x: 0, y: signed } };
  return { laneIndex, laneCount, laneSide, offset: { x: -signed, y: 0 } };
}

export function isIntersection(grid: Tile[][], pos: Vec2): boolean {
  const tile = grid[pos.y]?.[pos.x];
  if (!tile || !isRoadType(tile.type)) return false;
  return getNeighbors4(pos).filter((next) => isRoadType(grid[next.y]?.[next.x]?.type)).length >= 3;
}

export function buildIntersectionControls(grid: Tile[][], cars: Car[]): IntersectionControls {
  const controls: IntersectionControls = new Map();

  for (const car of cars) {
    if (car.status === 'arrived') continue;

    const current = { x: car.currentTileX, y: car.currentTileY };
    if (isIntersection(grid, current)) {
      const control = ensureIntersectionControl(controls, keyOf(current.x, current.y));
      control.occupiedByCarId ??= car.id;
    }

    const routeCurrent = car.route[car.routeIndex];
    const next = car.route[car.routeIndex + 1];
    const approaching = routeCurrent && next && car.progressToNext >= STOP_BEFORE_INTERSECTION_AT && isIntersection(grid, next);
    if (!approaching) continue;

    const key = keyOf(next.x, next.y);
    const control = ensureIntersectionControl(controls, key);
    const exitTile = car.route[car.routeIndex + 2];
    control.queue.push({
      carId: car.id,
      key,
      direction: getDirection(routeCurrent, next),
      waitSeconds: car.intersectionWaitSeconds,
      priorityToken: car.priorityToken || Number.MAX_SAFE_INTEGER,
      escape: car.intersectionWaitSeconds >= GRIDLOCK_ESCAPE_SECONDS,
      exitBlocked: isExitBlocked(car, cars, exitTile),
    });
  }

  for (const control of controls.values()) {
    control.queue.sort(compareIntersectionIntent);
    control.releasedCarId = control.queue.find((intent) => canReleaseIntoIntersection(control, intent))?.carId;
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
  const roadType = getRoadType(grid, current);
  const { offset, laneIndex, laneCount, laneSide } = getLaneOffset(direction, roadType, car.id);
  const desiredSpeed = BASE_SPEED * ROAD_CONFIG[roadType].speed / (1 + Math.max(0, congestion - 0.25));
  const turning = isTurningSoon(car);
  let targetSpeed = desiredSpeed * (turning ? CURVE_SLOWDOWN : 1);
  let state: TrafficState = turning ? 'turning' : 'moving';
  let blockedByCarId: string | undefined;
  let hardStop = false;

  const clearingIntersectionBox = shouldClearIntersectionBox(grid, car);
  const leader = findLeaderAhead(car, cars, direction, laneIndex);
  if (leader && !clearingIntersectionBox) {
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

  if (clearingIntersectionBox) {
    targetSpeed = Math.max(targetSpeed, INTERSECTION_APPROACH_SPEED);
    state = 'intersection';
    hardStop = false;
  }

  const intersectionKey = keyOf(next.x, next.y);
  const enteringIntersection = isApproachingIntersection(grid, car, next);
  let intersectionQueuePosition: number | undefined;
  let intersectionQueueLength: number | undefined;

  if (enteringIntersection) {
    const control = intersectionControls.get(intersectionKey);
    const queueInfo = getIntersectionQueueInfo(intersectionControls, intersectionKey, car.id);
    intersectionQueuePosition = queueInfo.position;
    intersectionQueueLength = queueInfo.length;

    const alreadyStoppedHere = car.intersectionStopKey === intersectionKey && car.waitTimer >= INTERSECTION_STOP_SECONDS;
    const released = control?.releasedCarId === car.id;
    const physicalOccupant = isPhysicallyOccupiedByAnother(control, car);
    const intent = control?.queue.find((entry) => entry.carId === car.id);
    const canEscape = Boolean(intent?.escape && !physicalOccupant);
    const escapingBlockedExit = Boolean(released && intent?.escape && intent.exitBlocked);

    if (!alreadyStoppedHere) {
      targetSpeed = car.progressToNext >= 0.78 ? 0 : Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
      state = 'intersection';
    } else if (escapingBlockedExit) {
      targetSpeed = Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
      state = 'intersection';
    } else if (!released && !canEscape) {
      targetSpeed = physicalOccupant || car.progressToNext >= 0.78 ? 0 : Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
      state = 'intersection';
    }
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
    turning,
    hardStop,
  };
}

function ensureIntersectionControl(controls: IntersectionControls, key: string): IntersectionControl {
  let control = controls.get(key);
  if (!control) {
    control = { key, queue: [] };
    controls.set(key, control);
  }
  return control;
}

function compareIntersectionIntent(a: IntersectionIntent, b: IntersectionIntent): number {
  if (a.escape !== b.escape) return a.escape ? -1 : 1;
  const aPriority = a.waitSeconds >= PRIORITY_WAIT_SECONDS;
  const bPriority = b.waitSeconds >= PRIORITY_WAIT_SECONDS;
  if (aPriority !== bPriority) return aPriority ? -1 : 1;
  if (Math.abs(a.waitSeconds - b.waitSeconds) > 0.05) return b.waitSeconds - a.waitSeconds;
  return a.priorityToken - b.priorityToken;
}

function canReleaseIntoIntersection(control: IntersectionControl, intent: IntersectionIntent): boolean {
  if (control.occupiedByCarId && control.occupiedByCarId !== intent.carId) return false;
  return !intent.exitBlocked || intent.escape;
}

function isExitBlocked(car: Car, cars: Car[], exitTile?: Vec2): boolean {
  if (!exitTile) return false;

  for (const other of cars) {
    if (other.id === car.id || other.status === 'arrived') continue;
    const sameTile = other.currentTileX === exitTile.x && other.currentTileY === exitTile.y;
    const nearCenter = Math.hypot(other.x - exitTile.x, other.y - exitTile.y) <= 0.58;
    if (!sameTile && !nearCenter) continue;

    const blockingState = other.status === 'stopped'
      || other.trafficState === 'queued'
      || other.trafficState === 'intersection'
      || other.currentSpeed < 0.42;
    const stillOccupyingTile = sameTile && other.progressToNext < 0.72;
    if (blockingState || stillOccupyingTile) return true;
  }

  return false;
}

function isPhysicallyOccupiedByAnother(control: IntersectionControl | undefined, car: Car): boolean {
  return Boolean(control?.occupiedByCarId && control.occupiedByCarId !== car.id);
}

function isApproachingIntersection(grid: Tile[][], car: Car, next: Vec2): boolean {
  return isIntersection(grid, next) && car.progressToNext >= STOP_BEFORE_INTERSECTION_AT;
}

function shouldClearIntersectionBox(grid: Tile[][], car: Car): boolean {
  return isIntersection(grid, { x: car.currentTileX, y: car.currentTileY }) && car.insideIntersectionSeconds >= INSIDE_CLEAR_SECONDS;
}

function getRoadType(grid: Tile[][], pos: Vec2): RoadType {
  const type = grid[pos.y]?.[pos.x]?.type;
  return type === 'avenue' ? 'avenue' : 'road';
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
    if (other.id === car.id || other.status === 'arrived') continue;
    if (other.direction !== direction || other.laneIndex !== laneIndex) continue;
    if (Math.round(other[lineAxis]) !== laneLine) continue;
    const distance = travelScalar(other, direction) - scalar;
    if (distance <= 0 || distance > LOOK_AHEAD_DISTANCE) continue;
    if (!leader || distance < leader.distance) leader = { car: other, distance };
  }

  return leader;
}

function travelScalar(car: Car, direction: TravelDirection): number {
  if (direction === 'west') return -car.x;
  if (direction === 'north') return -car.y;
  return direction === 'east' ? car.x : car.y;
}

function hashLane(id: string): number {
  let total = 0;
  for (let i = 0; i < id.length; i += 1) total += id.charCodeAt(i);
  return total % 2;
}
