import type {
  Car,
  TrafficState,
  TravelDirection,
} from "../../types/agent.types";
import type { RoadType, Tile, Vec2 } from "../../types/city.types";
import { ROAD_CONFIG } from "../config/roadConfig";
import { getNeighbors4, isRoadType, keyOf } from "../city/grid";

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

type TurnIntent = "straight" | "right" | "left" | "uturn";

export type IntersectionIntent = {
  carId: string;
  key: string;
  entryDirection: TravelDirection;
  exitDirection: TravelDirection;
  turnIntent: TurnIntent;
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
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

export function getCurrentDirection(car: Car): TravelDirection {
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  if (current && next) return getDirection(current, next);
  const previous = car.route[Math.max(0, car.routeIndex - 1)];
  if (previous && current) return getDirection(previous, current);
  return car.direction ?? "east";
}

export function getLaneOffset(
  direction: TravelDirection,
  roadType: RoadType,
  carId: string,
): { offset: Vec2; laneIndex: number; laneCount: number; laneSide: -1 | 1 } {
  const isAvenue = roadType === "avenue";
  const laneIndex = isAvenue ? hashLane(carId) : 0;
  const laneCount = isAvenue ? 4 : 2;
  const laneSide: -1 | 1 =
    direction === "east" || direction === "south" ? 1 : -1;
  const base = isAvenue ? (laneIndex === 0 ? 0.14 : 0.32) : 0.2;
  const signed = base * laneSide;

  if (direction === "east" || direction === "west")
    return { laneIndex, laneCount, laneSide, offset: { x: 0, y: signed } };
  return { laneIndex, laneCount, laneSide, offset: { x: -signed, y: 0 } };
}

export function isIntersection(grid: Tile[][], pos: Vec2): boolean {
  const tile = grid[pos.y]?.[pos.x];
  if (!tile || !isRoadType(tile.type)) return false;
  return (
    getNeighbors4(pos).filter((next) =>
      isRoadType(grid[next.y]?.[next.x]?.type),
    ).length >= 3
  );
}

export function buildIntersectionControls(
  grid: Tile[][],
  cars: Car[],
): IntersectionControls {
  const controls: IntersectionControls = new Map();

  for (const car of cars) {
    if (car.status === "arrived") continue;

    const current = { x: car.currentTileX, y: car.currentTileY };

    if (isIntersection(grid, current)) {
      const control = ensureIntersectionControl(
        controls,
        keyOf(current.x, current.y),
      );
      control.occupiedByCarId ??= car.id;

      const activeIntent = buildIntentForCar(grid, car, cars, current);
      if (activeIntent) {
        control.active.push(activeIntent);
      }
    }

    const routeCurrent = car.route[car.routeIndex];
    const next = car.route[car.routeIndex + 1];
    const approaching =
      routeCurrent &&
      next &&
      car.progressToNext >= STOP_BEFORE_INTERSECTION_AT &&
      isIntersection(grid, next);

    if (!approaching) continue;

    const key = keyOf(next.x, next.y);
    const control = ensureIntersectionControl(controls, key);
    const intent = buildIntentForCar(grid, car, cars, next);

    if (!intent) continue;

    control.queue.push(intent);
  }

  for (const control of controls.values()) {
    control.queue.sort(compareIntersectionIntent);
    control.releasedCarIds = resolveReleasedCars(grid, control);
  }

  return controls;
}

function getTurnIntent(from: TravelDirection, to: TravelDirection): TurnIntent {
  if (from === to) return "straight";

  if (
    (from === "north" && to === "east") ||
    (from === "east" && to === "south") ||
    (from === "south" && to === "west") ||
    (from === "west" && to === "north")
  ) {
    return "right";
  }

  if (
    (from === "north" && to === "west") ||
    (from === "west" && to === "south") ||
    (from === "south" && to === "east") ||
    (from === "east" && to === "north")
  ) {
    return "left";
  }

  return "uturn";
}

function buildIntentForCar(
  grid: Tile[][],
  car: Car,
  cars: Car[],
  intersectionTile: Vec2,
): IntersectionIntent | undefined {
  const previous = car.route[Math.max(0, car.routeIndex - 1)];
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  const after = car.route[car.routeIndex + 2];

  if (!current || !next) return undefined;

  const insideIntersection = isIntersection(grid, {
    x: car.currentTileX,
    y: car.currentTileY,
  });

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
    waitSeconds: car.intersectionWaitSeconds,
    priorityToken: car.priorityToken || Number.MAX_SAFE_INTEGER,
    escape: car.intersectionWaitSeconds >= GRIDLOCK_ESCAPE_SECONDS,
    exitBlocked: isExitBlocked(car, cars, exitTile),
  };
}

export function getIntersectionQueueInfo(
  controls: IntersectionControls,
  key?: string,
  carId?: string,
): { position?: number; length?: number } {
  if (!key || !carId) return {};
  const queue = controls.get(key)?.queue ?? [];
  const index = queue.findIndex((intent) => intent.carId === carId);
  return {
    position: index >= 0 ? index + 1 : undefined,
    length: queue.length || undefined,
  };
}

function canFreeFlowThroughIntersection(
  grid: Tile[][],
  intersectionKey: string,
  intent: IntersectionIntent,
  control?: IntersectionControl,
): boolean {
  if (!control) return false;
  if (intent.exitBlocked) return false;

  const activeAndReleased = [
    ...control.active,
    ...control.queue.filter((entry) => control.releasedCarIds.has(entry.carId)),
  ].filter((entry) => entry.carId !== intent.carId);

  const hasSameMovement = activeAndReleased.some((entry) =>
    isSameMovement(entry, intent),
  );

  if (hasSameMovement) return false;

  const hasExitConflict = activeAndReleased.some((entry) =>
    hasSameExit(entry, intent),
  );

  if (hasExitConflict) return false;

  if (intent.turnIntent === "right") {
    return true;
  }

  if (
    isTIntersectionByKey(grid, intersectionKey) &&
    intent.turnIntent === "straight"
  ) {
    const hasTurningConflict = activeAndReleased.some(
      (entry) => entry.turnIntent !== "straight",
    );

    return !hasTurningConflict;
  }

  return false;
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
      state: "moving",
      turning: false,
      laneCount: car.laneCount,
      laneSide: car.laneSide,
      hardStop: false,
    };
  }

  const direction = getDirection(current, next);
  const roadType = getRoadType(grid, current);
  const { offset, laneIndex, laneCount, laneSide } = getLaneOffset(
    direction,
    roadType,
    car.id,
  );
  const desiredSpeed =
    (BASE_SPEED * ROAD_CONFIG[roadType].speed) /
    (1 + Math.max(0, congestion - 0.25));
  const turning = isTurningSoon(car);
  let targetSpeed = desiredSpeed * (turning ? CURVE_SLOWDOWN : 1);
  let state: TrafficState = turning ? "turning" : "moving";
  let blockedByCarId: string | undefined;
  let hardStop = false;

  const clearingIntersectionBox = shouldClearIntersectionBox(grid, car);
  const leader = findLeaderAhead(car, cars, direction, laneIndex);
  if (leader && !clearingIntersectionBox) {
    blockedByCarId = leader.car.id;
    if (leader.distance <= SAFE_DISTANCE) {
      targetSpeed = 0;
      state = "queued";
      hardStop = leader.distance <= SAFE_DISTANCE * 0.55;
    } else if (leader.distance < LOOK_AHEAD_DISTANCE) {
      const ratio =
        (leader.distance - SAFE_DISTANCE) /
        (LOOK_AHEAD_DISTANCE - SAFE_DISTANCE);
      targetSpeed = Math.min(targetSpeed, desiredSpeed * Math.max(0.12, ratio));
      state = "queued";
    }
  }

  if (clearingIntersectionBox) {
    targetSpeed = Math.max(targetSpeed, INTERSECTION_APPROACH_SPEED);
    state = "intersection";
    hardStop = false;
  }

  const intersectionKey = keyOf(next.x, next.y);
  const enteringIntersection = isApproachingIntersection(grid, car, next);
  let intersectionQueuePosition: number | undefined;
  let intersectionQueueLength: number | undefined;

  if (enteringIntersection) {
    const control = intersectionControls.get(intersectionKey);
    const queueInfo = getIntersectionQueueInfo(
      intersectionControls,
      intersectionKey,
      car.id,
    );
    intersectionQueuePosition = queueInfo.position;
    intersectionQueueLength = queueInfo.length;

    const alreadyStoppedHere =
      car.intersectionStopKey === intersectionKey &&
      car.waitTimer >= INTERSECTION_STOP_SECONDS;
    const released = Boolean(control?.releasedCarIds.has(car.id));
    const physicalOccupant = isPhysicallyOccupiedByAnother(control, car);
    const intent = control?.queue.find((entry) => entry.carId === car.id);
    const freeFlow = Boolean(
      intent &&
      released &&
      canFreeFlowThroughIntersection(grid, intersectionKey, intent, control),
    );
    const canEscape = Boolean(intent?.escape && !physicalOccupant);
    const escapingBlockedExit = Boolean(
      released && intent?.escape && intent.exitBlocked,
    );

    if (!alreadyStoppedHere && !freeFlow) {
      targetSpeed =
        car.progressToNext >= 0.78
          ? 0
          : Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
      state = "intersection";
    } else if (escapingBlockedExit) {
      targetSpeed = Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
      state = "intersection";
    } else if (!released && !canEscape) {
      targetSpeed =
        physicalOccupant || car.progressToNext >= 0.78
          ? 0
          : Math.min(targetSpeed, INTERSECTION_APPROACH_SPEED);
      state = "intersection";
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

function ensureIntersectionControl(
  controls: IntersectionControls,
  key: string,
): IntersectionControl {
  let control = controls.get(key);

  if (!control) {
    control = { key, active: [], queue: [], releasedCarIds: new Set() };
    controls.set(key, control);
  }

  return control;
}

function compareIntersectionIntent(
  a: IntersectionIntent,
  b: IntersectionIntent,
): number {
  if (a.escape !== b.escape) return a.escape ? -1 : 1;
  const aPriority = a.waitSeconds >= PRIORITY_WAIT_SECONDS;
  const bPriority = b.waitSeconds >= PRIORITY_WAIT_SECONDS;
  if (aPriority !== bPriority) return aPriority ? -1 : 1;
  if (Math.abs(a.waitSeconds - b.waitSeconds) > 0.05)
    return b.waitSeconds - a.waitSeconds;
  return a.priorityToken - b.priorityToken;
}

function resolveReleasedCars(
  grid: Tile[][],
  control: IntersectionControl,
): Set<string> {
  const released = new Set<string>();
  const acceptedIntents = [...control.active];

  for (const intent of control.queue) {
    if (!canReleaseIntoIntersection(intent)) continue;

    const compatible = acceptedIntents.every((activeIntent) => {
      return areMovementsCompatible(grid, control.key, intent, activeIntent);
    });

    if (!compatible && !intent.escape) continue;

    released.add(intent.carId);
    acceptedIntents.push(intent);
  }

  return released;
}

function canReleaseIntoIntersection(intent: IntersectionIntent): boolean {
  return !intent.exitBlocked || intent.escape;
}

function hasSameExit(a: IntersectionIntent, b: IntersectionIntent): boolean {
  return a.exitDirection === b.exitDirection;
}

function areMovementsCompatible(
  grid: Tile[][],
  intersectionKey: string,
  a: IntersectionIntent,
  b: IntersectionIntent,
): boolean {
  if (a.carId === b.carId) return true;

  if (isSameMovement(a, b)) return false;

  // Evita dois carros tentando sair para o mesmo sentido ao mesmo tempo.
  if (hasSameExit(a, b)) return false;

  // Conversão à direita pode fluir se não disputar a mesma saída.
  if (a.turnIntent === "right" || b.turnIntent === "right") {
    return true;
  }

  // Em cruzamento em T, carros seguindo reto no mesmo eixo podem passar.
  if (isTIntersectionByKey(grid, intersectionKey)) {
    const bothStraight =
      a.turnIntent === "straight" && b.turnIntent === "straight";

    if (bothStraight && isSameAxis(a.entryDirection, b.entryDirection)) {
      return true;
    }
  }

  if (a.turnIntent === "straight" && b.turnIntent === "straight") {
    return isSameAxis(a.entryDirection, b.entryDirection);
  }

  return false;
}

function isSameMovement(a: IntersectionIntent, b: IntersectionIntent): boolean {
  return (
    a.entryDirection === b.entryDirection && a.exitDirection === b.exitDirection
  );
}

function isSameAxis(a: TravelDirection, b: TravelDirection): boolean {
  const horizontalA = a === "east" || a === "west";
  const horizontalB = b === "east" || b === "west";

  return horizontalA === horizontalB;
}

function isTIntersectionByKey(grid: Tile[][], key: string): boolean {
  const [xText, yText] = key.split(",");
  const pos = { x: Number(xText), y: Number(yText) };

  return (
    getNeighbors4(pos).filter((next) =>
      isRoadType(grid[next.y]?.[next.x]?.type),
    ).length === 3
  );
}

function isExitBlocked(car: Car, cars: Car[], exitTile?: Vec2): boolean {
  if (!exitTile) return false;

  for (const other of cars) {
    if (other.id === car.id || other.status === "arrived") continue;
    const sameTile =
      other.currentTileX === exitTile.x && other.currentTileY === exitTile.y;
    const nearCenter =
      Math.hypot(other.x - exitTile.x, other.y - exitTile.y) <= 0.58;
    if (!sameTile && !nearCenter) continue;

    const blockingState =
      other.status === "stopped" ||
      other.trafficState === "queued" ||
      other.trafficState === "intersection" ||
      other.currentSpeed < 0.42;
    const stillOccupyingTile = sameTile && other.progressToNext < 0.72;
    if (blockingState || stillOccupyingTile) return true;
  }

  return false;
}

function isPhysicallyOccupiedByAnother(
  control: IntersectionControl | undefined,
  car: Car,
): boolean {
  return Boolean(
    control?.occupiedByCarId && control.occupiedByCarId !== car.id,
  );
}

function isApproachingIntersection(
  grid: Tile[][],
  car: Car,
  next: Vec2,
): boolean {
  return (
    isIntersection(grid, next) &&
    car.progressToNext >= STOP_BEFORE_INTERSECTION_AT
  );
}

function shouldClearIntersectionBox(grid: Tile[][], car: Car): boolean {
  return (
    isIntersection(grid, { x: car.currentTileX, y: car.currentTileY }) &&
    car.insideIntersectionSeconds >= INSIDE_CLEAR_SECONDS
  );
}

function getRoadType(grid: Tile[][], pos: Vec2): RoadType {
  const type = grid[pos.y]?.[pos.x]?.type;
  return type === "avenue" ? "avenue" : "road";
}

function isTurningSoon(car: Car): boolean {
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  const after = car.route[car.routeIndex + 2];
  if (!current || !next || !after) return false;
  return (
    car.progressToNext > 0.42 &&
    getDirection(current, next) !== getDirection(next, after)
  );
}

function findLeaderAhead(
  car: Car,
  cars: Car[],
  direction: TravelDirection,
  laneIndex: number,
): { car: Car; distance: number } | undefined {
  const axis = direction === "east" || direction === "west" ? "x" : "y";
  const lineAxis = axis === "x" ? "y" : "x";
  const laneLine = Math.round(car[lineAxis]);
  const scalar = travelScalar(car, direction);
  let leader: { car: Car; distance: number } | undefined;

  for (const other of cars) {
    if (other.id === car.id || other.status === "arrived") continue;
    if (other.direction !== direction || other.laneIndex !== laneIndex)
      continue;
    if (Math.round(other[lineAxis]) !== laneLine) continue;
    const distance = travelScalar(other, direction) - scalar;
    if (distance <= 0 || distance > LOOK_AHEAD_DISTANCE) continue;
    if (!leader || distance < leader.distance)
      leader = { car: other, distance };
  }

  return leader;
}

function travelScalar(car: Car, direction: TravelDirection): number {
  if (direction === "west") return -car.x;
  if (direction === "north") return -car.y;
  return direction === "east" ? car.x : car.y;
}

function hashLane(id: string): number {
  let total = 0;
  for (let i = 0; i < id.length; i += 1) total += id.charCodeAt(i);
  return total % 2;
}
