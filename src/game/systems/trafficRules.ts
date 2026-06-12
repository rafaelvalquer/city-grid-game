import type { Car, TrafficState, TravelDirection } from '../../types/agent.types';
import type { RoadType, Tile, Vec2 } from '../../types/city.types';
import { ROAD_CONFIG } from '../config/roadConfig';
import { getNeighbors4, isRoadType, keyOf } from '../city/grid';

export type TrafficDecision = {
  speed: number;
  desiredSpeed: number;
  laneOffset: Vec2;
  laneIndex: number;
  direction: TravelDirection;
  state: TrafficState;
  blockedByCarId?: string;
  intersectionStopKey?: string;
  turning: boolean;
};

const STOP_BEFORE_INTERSECTION_AT = 0.52;
const INTERSECTION_STOP_SECONDS = 0.38;
const SAFE_DISTANCE = 0.48;
const LOOK_AHEAD_DISTANCE = 1.18;
const CURVE_SLOWDOWN = 0.58;

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

export function getLaneOffset(direction: TravelDirection, roadType: RoadType, carId: string): { offset: Vec2; laneIndex: number } {
  const isAvenue = roadType === 'avenue';
  const laneIndex = isAvenue ? hashLane(carId) : 0;
  const base = isAvenue ? (laneIndex === 0 ? 0.15 : 0.31) : 0.2;

  if (direction === 'east') return { laneIndex, offset: { x: 0, y: base } };
  if (direction === 'west') return { laneIndex, offset: { x: 0, y: -base } };
  if (direction === 'south') return { laneIndex, offset: { x: -base, y: 0 } };
  return { laneIndex, offset: { x: base, y: 0 } };
}

export function isIntersection(grid: Tile[][], pos: Vec2): boolean {
  const tile = grid[pos.y]?.[pos.x];
  if (!tile || !isRoadType(tile.type)) return false;
  return getNeighbors4(pos).filter((next) => isRoadType(grid[next.y]?.[next.x]?.type)).length >= 3;
}

export function getIntersectionReservations(grid: Tile[][], cars: Car[]): Set<string> {
  const reservations = new Set<string>();
  for (const car of cars) {
    if (isIntersection(grid, { x: car.currentTileX, y: car.currentTileY })) {
      reservations.add(keyOf(car.currentTileX, car.currentTileY));
    }
  }
  return reservations;
}

export function computeTrafficDecision(
  grid: Tile[][],
  car: Car,
  cars: Car[],
  reservations: Set<string>,
  congestion: number,
): TrafficDecision {
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  if (!current || !next) {
    return {
      speed: 0,
      desiredSpeed: 0,
      laneOffset: car.laneOffset,
      laneIndex: car.laneIndex,
      direction: car.direction,
      state: 'moving',
      turning: false,
    };
  }

  const direction = getDirection(current, next);
  const roadType = getRoadType(grid, current);
  const { offset, laneIndex } = getLaneOffset(direction, roadType, car.id);
  const desiredSpeed = car.baseSpeed * ROAD_CONFIG[roadType].speed / (1 + Math.max(0, congestion - 0.25));
  const turning = isTurningSoon(car);
  let speed = desiredSpeed * (turning ? CURVE_SLOWDOWN : 1);
  let state: TrafficState = turning ? 'turning' : 'moving';
  let blockedByCarId: string | undefined;

  const leader = findLeaderAhead(car, cars, direction, laneIndex);
  if (leader) {
    blockedByCarId = leader.car.id;
    if (leader.distance <= SAFE_DISTANCE) {
      speed = 0;
      state = 'queued';
    } else if (leader.distance < LOOK_AHEAD_DISTANCE) {
      const ratio = (leader.distance - SAFE_DISTANCE) / (LOOK_AHEAD_DISTANCE - SAFE_DISTANCE);
      speed = Math.min(speed, desiredSpeed * Math.max(0.12, ratio));
      state = 'queued';
    }
  }

  const intersectionKey = keyOf(next.x, next.y);
  const enteringIntersection = isIntersection(grid, next) && car.progressToNext >= STOP_BEFORE_INTERSECTION_AT;
  if (enteringIntersection) {
    const alreadyStoppedHere = car.intersectionStopKey === intersectionKey && car.waitTimer >= INTERSECTION_STOP_SECONDS;
    const currentKey = keyOf(car.currentTileX, car.currentTileY);
    const occupied = reservations.has(intersectionKey) && currentKey !== intersectionKey;
    if (!alreadyStoppedHere || occupied) {
      speed = 0;
      state = 'intersection';
    } else {
      reservations.add(intersectionKey);
    }
  }

  return {
    speed,
    desiredSpeed,
    laneOffset: offset,
    laneIndex,
    direction,
    state,
    blockedByCarId,
    intersectionStopKey: enteringIntersection ? intersectionKey : undefined,
    turning,
  };
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
