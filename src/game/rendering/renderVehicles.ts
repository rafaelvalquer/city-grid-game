import type { Graphics } from 'pixi.js';
import type { Car } from '../../types/agent.types';
import type { Building, Tile, Vec2 } from '../../types/city.types';
import type { GameWorld } from '../engine/simulation';
import { getDirection, getLaneOffsetForRouteSegment } from '../systems/trafficRules';
import { MAP_COLORS } from './visualTheme';
import type { Atmosphere, CarRenderPose } from './renderTypes';
import { TURN_IN_START, TURN_OUT_END } from './renderTypes';
import { carColor, directionAngle, drawCapsule, drawRotatedRect, idPhase, normalizeVec, pulse } from './renderUtils';
export function drawCar(graphics: Graphics, car: Car, world: GameWorld, ts: number, timeSeconds: number, atmosphere: Atmosphere): void {
  const pose = getCarRenderPose(car, world);
  const cx = pose.x * ts + ts / 2;
  const cy = pose.y * ts + ts / 2;
  const isBus = car.vehicleType === 'bus';
  const length = isBus ? 22 : 13;
  const width = isBus ? 10 : 7;
  const baseColor = isBus ? 0x24a0b7 : carDestinationColor(world, car);
  const color = car.trafficState === 'intersection'
    ? blendCarStateColor(baseColor, MAP_COLORS.carAltC)
    : car.trafficState === 'queued'
      ? blendCarStateColor(baseColor, MAP_COLORS.carAltA)
      : baseColor;
  if (car.lifecyclePhase === 'driving' && (car.trafficState === 'queued' || car.trafficState === 'intersection')) {
    const halo = car.trafficState === 'queued' ? MAP_COLORS.carTail : MAP_COLORS.lane;
    graphics.circle(cx, cy, 7.5).fill({ color: halo, alpha: car.trafficState === 'queued' ? 0.16 : 0.2 });
  }
  drawCapsule(graphics, cx + 3, cy + 4, length, width, pose.angle, MAP_COLORS.shadow, 0.28 * pose.alpha);
  drawCapsule(graphics, cx, cy, length, width, pose.angle, color, pose.alpha, MAP_COLORS.roadEdge);
  if (isBus) {
    for (let index = -2; index <= 2; index += 1) {
      const windowGlow = atmosphere.windowGlowAlpha > 0.45 ? MAP_COLORS.windowLit : MAP_COLORS.shopGlass;
      drawRotatedRect(
        graphics,
        cx + Math.cos(pose.angle) * (index * 3.2) - Math.sin(pose.angle) * 1.1,
        cy + Math.sin(pose.angle) * (index * 3.2) + Math.cos(pose.angle) * 1.1,
        2.5,
        2.4,
        pose.angle,
        windowGlow,
        Math.min(1, (0.86 + atmosphere.windowGlowAlpha * 0.12) * pose.alpha),
      );
    }
  } else {
    drawRotatedRect(graphics, cx + Math.cos(pose.angle) * 1.8, cy + Math.sin(pose.angle) * 1.8, 4.2, 3.2, pose.angle, MAP_COLORS.carWindow, 0.88 * pose.alpha);
  }
  drawCarLights(graphics, car, cx, cy, length, width, pose.angle, timeSeconds, atmosphere, pose.alpha);
}


export function drawCarLights(graphics: Graphics, car: Car, cx: number, cy: number, length: number, width: number, angle: number, timeSeconds: number, atmosphere: Atmosphere, alpha = 1): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const frontX = cx + dx * (length / 2 - 1.2);
  const frontY = cy + dy * (length / 2 - 1.2);
  const backX = cx - dx * (length / 2 - 1.5);
  const backY = cy - dy * (length / 2 - 1.5);
  const queuedPulse = car.trafficState === 'queued' ? pulse(timeSeconds, 1.15, idPhase(car.id)) : 1;
  const nightLight = atmosphere.headlightAlpha;
  const lightAlpha = Math.min(1, (car.trafficState === 'queued' ? 0.55 + queuedPulse * 0.45 : 0.88) * (0.72 + nightLight * 0.38)) * alpha;
  const tailAlpha = Math.min(1, (car.trafficState === 'queued' ? 0.5 + queuedPulse * 0.5 : 0.86) * (0.78 + nightLight * 0.28)) * alpha;
  const lightRadius = (car.trafficState === 'queued' ? 1.05 + queuedPulse * 0.45 : 1.15) + nightLight * 0.42;
  const tailRadius = (car.trafficState === 'queued' ? 0.85 + queuedPulse * 0.3 : 0.95) + nightLight * 0.22;
  if (nightLight > 0.22) {
    const beamLength = car.vehicleType === 'bus' ? 22 : 16;
    const beamSpread = car.vehicleType === 'bus' ? 7.2 : 5.2;
    const beamAlpha = Math.min(0.16, nightLight * 0.11) * alpha;
    graphics.poly([
      frontX + px * (width * 0.28),
      frontY + py * (width * 0.28),
      frontX + dx * beamLength + px * beamSpread,
      frontY + dy * beamLength + py * beamSpread,
      frontX + dx * (beamLength + 3),
      frontY + dy * (beamLength + 3),
      frontX + dx * beamLength - px * beamSpread,
      frontY + dy * beamLength - py * beamSpread,
      frontX - px * (width * 0.28),
      frontY - py * (width * 0.28),
    ]).fill({ color: MAP_COLORS.carLight, alpha: beamAlpha });
    graphics.circle(frontX + dx * 7, frontY + dy * 7, 6 + nightLight * 3).fill({ color: MAP_COLORS.carLight, alpha: beamAlpha * 0.55 });
  }
  graphics.circle(frontX + px * (width * 0.22), frontY + py * (width * 0.22), lightRadius).fill({ color: MAP_COLORS.carLight, alpha: lightAlpha });
  graphics.circle(frontX - px * (width * 0.22), frontY - py * (width * 0.22), lightRadius).fill({ color: MAP_COLORS.carLight, alpha: lightAlpha });
  graphics.circle(backX + px * (width * 0.2), backY + py * (width * 0.2), tailRadius).fill({ color: MAP_COLORS.carTail, alpha: tailAlpha });
  graphics.circle(backX - px * (width * 0.2), backY - py * (width * 0.2), tailRadius).fill({ color: MAP_COLORS.carTail, alpha: tailAlpha });
}


export function carDestinationColor(world: GameWorld, car: Car): number {
  const destination = world.getBuilding(car.destinationBuildingId)?.type;
  if (destination === 'house') return MAP_COLORS.carHouse;
  if (destination === 'shop') return MAP_COLORS.carShop;
  if (destination === 'office') return MAP_COLORS.carOffice;
  return carColor(car.id);
}


export function blendCarStateColor(base: number, overlay: number): number {
  const br = (base >> 16) & 255;
  const bg = (base >> 8) & 255;
  const bb = base & 255;
  const or = (overlay >> 16) & 255;
  const og = (overlay >> 8) & 255;
  const ob = overlay & 255;
  return ((Math.round(br * 0.65 + or * 0.35) << 16)
    | (Math.round(bg * 0.65 + og * 0.35) << 8)
    | Math.round(bb * 0.65 + ob * 0.35));
}


export function getCarRenderPose(car: Car, world: GameWorld): CarRenderPose {
  const grid = world.grid;
  if (car.lifecyclePhase === 'spawnExit') {
    const pose = getLifecyclePose(car, world, 'spawnExit');
    if (pose) return pose;
  }
  if (car.lifecyclePhase === 'destinationEntry') {
    const pose = getLifecyclePose(car, world, 'destinationEntry');
    if (pose) return pose;
  }

  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  if (!current || !next) return { x: car.x, y: car.y, angle: directionAngle(car.direction), turningAmount: 0, alpha: 1 };

  const after = car.route[car.routeIndex + 2];
  if (after && isRouteTurn(current, next, after) && car.progressToNext >= TURN_IN_START) {
    const curve = buildTurnCurve(car, grid, current, next, after);
    const t = ((car.progressToNext - TURN_IN_START) / (1 - TURN_IN_START)) * 0.5;
    return poseOnCurve(curve, t);
  }

  const previous = car.route[car.routeIndex - 1];
  if (previous && isRouteTurn(previous, current, next) && car.progressToNext <= TURN_OUT_END) {
    const curve = buildTurnCurve(car, grid, previous, current, next);
    const t = 0.5 + (car.progressToNext / TURN_OUT_END) * 0.5;
    return poseOnCurve(curve, t);
  }

  const offset = laneOffsetForSegment(car, grid, current, next);
  return {
    x: current.x + (next.x - current.x) * car.progressToNext + offset.x,
    y: current.y + (next.y - current.y) * car.progressToNext + offset.y,
    angle: Math.atan2(next.y - current.y, next.x - current.x),
    turningAmount: 0,
    alpha: 1,
  };
}


export function getLifecyclePose(car: Car, world: GameWorld, phase: 'spawnExit' | 'destinationEntry'): CarRenderPose | undefined {
  const building = world.getBuilding(phase === 'spawnExit' ? car.originBuildingId : car.destinationBuildingId);
  if (!building) return undefined;

  const t = smoothStep(Math.max(0, Math.min(1, car.lifecycleProgress)));
  if (phase === 'spawnExit') {
    const from = buildingPoint(building);
    const routeStart = car.route[0];
    const routeNext = car.route[1];
    if (!routeStart || !routeNext) return undefined;
    const roadPoint = {
      x: routeStart.x + car.laneOffset.x,
      y: routeStart.y + car.laneOffset.y,
    };
    const direction = getDirection(routeStart, routeNext);
    const curve = {
      p0: from,
      p1: {
        x: roadPoint.x - Math.cos(directionAngle(direction)) * 0.3,
        y: roadPoint.y - Math.sin(directionAngle(direction)) * 0.3,
      },
      p2: roadPoint,
    };
    return { ...poseOnCurve(curve, t), alpha: 0.65 + t * 0.35 };
  }

  const routeEnd = car.route[car.route.length - 1];
  const routePrevious = car.route[car.route.length - 2];
  if (!routeEnd || !routePrevious) return undefined;
  const offset = laneOffsetForSegment(car, world.grid, routePrevious, routeEnd);
  const roadPoint = {
    x: routeEnd.x + offset.x,
    y: routeEnd.y + offset.y,
  };
  const to = buildingPoint(building);
  const approachAngle = Math.atan2(routeEnd.y - routePrevious.y, routeEnd.x - routePrevious.x);
  const curve = {
    p0: roadPoint,
    p1: {
      x: roadPoint.x + Math.cos(approachAngle) * 0.24,
      y: roadPoint.y + Math.sin(approachAngle) * 0.24,
    },
    p2: to,
  };
  return { ...poseOnCurve(curve, t), alpha: 1 - t * 0.25 };
}


export function buildingPoint(building: Building): Vec2 {
  return { x: building.x, y: building.y };
}


export function buildTurnCurve(car: Car, grid: Tile[][], from: Vec2, corner: Vec2, to: Vec2): { p0: Vec2; p1: Vec2; p2: Vec2 } {
  const incomingOffset = laneOffsetForSegment(car, grid, from, corner);
  const outgoingOffset = laneOffsetForSegment(car, grid, corner, to);
  return {
    p0: {
      x: from.x + (corner.x - from.x) * TURN_IN_START + incomingOffset.x,
      y: from.y + (corner.y - from.y) * TURN_IN_START + incomingOffset.y,
    },
    p1: { x: corner.x, y: corner.y },
    p2: {
      x: corner.x + (to.x - corner.x) * TURN_OUT_END + outgoingOffset.x,
      y: corner.y + (to.y - corner.y) * TURN_OUT_END + outgoingOffset.y,
    },
  };
}


export function poseOnCurve(curve: { p0: Vec2; p1: Vec2; p2: Vec2 }, rawT: number): CarRenderPose {
  const t = Math.max(0, Math.min(1, rawT));
  const mt = 1 - t;
  const x = mt * mt * curve.p0.x + 2 * mt * t * curve.p1.x + t * t * curve.p2.x;
  const y = mt * mt * curve.p0.y + 2 * mt * t * curve.p1.y + t * t * curve.p2.y;
  const dx = 2 * mt * (curve.p1.x - curve.p0.x) + 2 * t * (curve.p2.x - curve.p1.x);
  const dy = 2 * mt * (curve.p1.y - curve.p0.y) + 2 * t * (curve.p2.y - curve.p1.y);
  return { x, y, angle: Math.atan2(dy, dx), turningAmount: Math.sin(Math.PI * t), alpha: 1 };
}


export function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}


export function laneOffsetForSegment(car: Car, grid: Tile[][], from: Vec2, to: Vec2): Vec2 {
  return getLaneOffsetForRouteSegment(grid, car, from, to).offset;
}


export function isRouteTurn(from: Vec2, corner: Vec2, to: Vec2): boolean {
  return getDirection(from, corner) !== getDirection(corner, to);
}

