import type { Graphics } from 'pixi.js';
import type { Car } from '../../types/agent.types';
import type { Tunnel, Vec2 } from '../../types/city.types';
import type { GameWorld } from '../engine/simulation';
import { GAME_CONFIG } from '../config/gameConfig';
import { ROAD_CONFIG } from '../config/roadConfig';
import { MAP_COLORS } from './visualTheme';
import { pulse } from './renderUtils';

const TUNNEL_EDGE = 0x1e3a5f;
const TUNNEL_CORE = 0x334155;
const TUNNEL_LIGHT = 0x7dd3fc;
const PORTAL_CONCRETE = 0xb8c1c6;
const PORTAL_CONCRETE_DARK = 0x7b8790;
const PORTAL_ASPHALT = 0x39465c;
const PORTAL_ASPHALT_DARK = 0x222b3b;
const PORTAL_WARNING = 0xfacc15;

export function drawSurfaceTunnelPortals(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  for (const tunnel of world.tunnels) {
    if (!tunnel.active) continue;
    drawPortal(graphics, tunnel, tunnel.entryPortal, directionBetween(tunnel.entryPortal, tunnel.entryAccessRoad), ts, timeSeconds);
    drawPortal(graphics, tunnel, tunnel.exitPortal, directionBetween(tunnel.exitPortal, tunnel.exitAccessRoad), ts, timeSeconds);
  }
}

export function drawUndergroundTunnels(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  for (const tunnel of world.tunnels) {
    if (!tunnel.active || tunnel.path.length < 2) continue;
    const width = tunnel.type === 'avenueTunnel' ? 18 : 12;
    drawTunnelPolyline(graphics, tunnel.path, ts, width + 8, TUNNEL_EDGE, 0.58);
    drawTunnelPolyline(graphics, tunnel.path, ts, width, TUNNEL_CORE, 0.96);
    drawTunnelPolyline(graphics, tunnel.path, ts, 1.4, 0xe0f2fe, 0.42);
    for (let index = 0; index < tunnel.path.length; index += 2) {
      const pos = tunnel.path[index];
      const glow = 0.35 + pulse(timeSeconds, 1.8, index * 0.21 + pos.x * 0.11 + pos.y * 0.17) * 0.22;
      graphics.circle(pos.x * ts + ts / 2, pos.y * ts + ts / 2, 3.2).fill({ color: TUNNEL_LIGHT, alpha: glow });
    }
  }
}

export function isCarInTunnel(car: Car): boolean {
  const current = car.route[car.routeIndex];
  return current?.layer === 'tunnel';
}

export function isCarDeepInsideTunnel(car: Car): boolean {
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  return current?.layer === 'tunnel' && next?.layer === 'tunnel';
}

function drawTunnelPolyline(graphics: Graphics, path: Vec2[], ts: number, width: number, color: number, alpha: number): void {
  if (path.length < 2) return;
  graphics.moveTo(path[0].x * ts + ts / 2, path[0].y * ts + ts / 2);
  for (const pos of path.slice(1)) graphics.lineTo(pos.x * ts + ts / 2, pos.y * ts + ts / 2);
  graphics.stroke({ color, width, alpha });
}

function drawPortal(graphics: Graphics, tunnel: Tunnel, portal: Vec2, direction: Vec2, ts: number, timeSeconds: number): void {
  const px = portal.x * ts;
  const py = portal.y * ts;
  const cx = px + ts / 2;
  const cy = py + ts / 2;
  const dir = direction.x === 0 && direction.y === 0 ? { x: 0, y: 1 } : direction;
  const roadWidth = tunnel.type === 'avenueTunnel' ? Math.min(ts - 7, 34) : Math.min(ts - 12, 25);
  const mouthWidth = tunnel.type === 'avenueTunnel' ? Math.min(ts - 5, 36) : Math.min(ts - 10, 28);
  const portalDepth = tunnel.type === 'avenueTunnel' ? 18 : 15;
  const shimmer = pulse(timeSeconds, 1.6, portal.x * 0.2 + portal.y * 0.31);

  graphics.roundRect(px + 3, py + 3, ts - 6, ts - 6, 8)
    .fill({ color: 0xc9d2d1, alpha: 0.82 })
    .stroke({ color: PORTAL_CONCRETE_DARK, width: 1, alpha: 0.34 });

  drawRamp(graphics, cx, cy, dir, ts, roadWidth, mouthWidth);
  drawRetainingWalls(graphics, cx, cy, dir, ts, roadWidth);

  graphics.circle(cx - dir.x * 4, cy - dir.y * 4, tunnel.type === 'avenueTunnel' ? 19 : 15)
    .fill({ color: TUNNEL_LIGHT, alpha: 0.05 + shimmer * 0.05 });

  drawOrientedRect(graphics, cx, cy, dir, -2, 0, mouthWidth + 8, portalDepth + 7, PORTAL_CONCRETE_DARK, 0.42);
  drawOrientedRect(graphics, cx, cy, dir, 0, 0, mouthWidth + 5, portalDepth + 4, PORTAL_CONCRETE, 0.98, TUNNEL_EDGE);
  drawOrientedRect(graphics, cx, cy, dir, 1, 0, mouthWidth - 5, portalDepth - 2, 0x060b14, 0.94);
  drawOrientedRect(graphics, cx, cy, dir, -5, 0, mouthWidth - 11, portalDepth - 7, 0x020617, 0.96);

  drawLaneMarks(graphics, cx, cy, dir, ts, roadWidth, tunnel.type === 'avenueTunnel');
  drawPortalLights(graphics, cx, cy, dir, mouthWidth, portalDepth, shimmer, tunnel.type === 'avenueTunnel');
  drawConstructionDetails(graphics, cx, cy, dir, ts, roadWidth);
}

function directionBetween(from: Vec2, to: Vec2): Vec2 {
  return { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
}

function drawRamp(graphics: Graphics, cx: number, cy: number, dir: Vec2, ts: number, roadWidth: number, mouthWidth: number): void {
  const points = [
    orientedPoint(cx, cy, dir, -roadWidth / 2, ts / 2 + 1),
    orientedPoint(cx, cy, dir, roadWidth / 2, ts / 2 + 1),
    orientedPoint(cx, cy, dir, mouthWidth / 2 - 3, 5),
    orientedPoint(cx, cy, dir, -mouthWidth / 2 + 3, 5),
  ].flatMap((point) => [point.x, point.y]);
  graphics.poly(points)
    .fill({ color: PORTAL_ASPHALT, alpha: 0.98 })
    .stroke({ color: MAP_COLORS.roadEdge, width: 1.4, alpha: 0.72 });

  const inner = [
    orientedPoint(cx, cy, dir, -roadWidth / 2 + 4, ts / 2 - 2),
    orientedPoint(cx, cy, dir, roadWidth / 2 - 4, ts / 2 - 2),
    orientedPoint(cx, cy, dir, mouthWidth / 2 - 8, 8),
    orientedPoint(cx, cy, dir, -mouthWidth / 2 + 8, 8),
  ].flatMap((point) => [point.x, point.y]);
  graphics.poly(inner).fill({ color: PORTAL_ASPHALT_DARK, alpha: 0.22 });
}

function drawRetainingWalls(graphics: Graphics, cx: number, cy: number, dir: Vec2, ts: number, roadWidth: number): void {
  const wallOffset = roadWidth / 2 + 4;
  for (const side of [-1, 1]) {
    const points = [
      orientedPoint(cx, cy, dir, side * wallOffset, ts / 2 - 3),
      orientedPoint(cx, cy, dir, side * (wallOffset + 4), ts / 2 - 5),
      orientedPoint(cx, cy, dir, side * (wallOffset + 2), 2),
      orientedPoint(cx, cy, dir, side * wallOffset, 6),
    ].flatMap((point) => [point.x, point.y]);
    graphics.poly(points)
      .fill({ color: PORTAL_CONCRETE, alpha: 0.92 })
      .stroke({ color: PORTAL_CONCRETE_DARK, width: 1, alpha: 0.58 });
  }
}

function drawLaneMarks(graphics: Graphics, cx: number, cy: number, dir: Vec2, ts: number, roadWidth: number, avenue: boolean): void {
  const marks = avenue ? [-roadWidth * 0.18, roadWidth * 0.18] : [0];
  for (const lateral of marks) {
    const a = orientedPoint(cx, cy, dir, lateral, ts / 2 - 6);
    const b = orientedPoint(cx, cy, dir, lateral, 10);
    graphics.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: MAP_COLORS.laneSoft, width: 1.8, alpha: 0.82 });
  }
}

function drawPortalLights(graphics: Graphics, cx: number, cy: number, dir: Vec2, mouthWidth: number, portalDepth: number, shimmer: number, avenue: boolean): void {
  for (const side of [-1, 1]) {
    const lamp = orientedPoint(cx, cy, dir, side * (mouthWidth / 2 - 5), portalDepth / 2 - 1);
    graphics.circle(lamp.x, lamp.y, 2.3 + shimmer * 0.5).fill({ color: TUNNEL_LIGHT, alpha: 0.2 + shimmer * 0.08 });
    graphics.circle(lamp.x, lamp.y, 1.5).fill({ color: avenue ? PORTAL_WARNING : TUNNEL_LIGHT, alpha: 0.9 });
  }
}

function drawConstructionDetails(graphics: Graphics, cx: number, cy: number, dir: Vec2, ts: number, roadWidth: number): void {
  const accessEdge = ts / 2 - 4;
  for (const side of [-1, 1]) {
    const cone = orientedPoint(cx, cy, dir, side * (roadWidth / 2 + 7), accessEdge - 6);
    graphics.circle(cone.x, cone.y, 2.5).fill({ color: 0xf97316, alpha: 0.92 });
    graphics.circle(cone.x, cone.y - 0.8, 1.1).fill({ color: MAP_COLORS.laneSoft, alpha: 0.88 });
  }
  const stripeA = orientedPoint(cx, cy, dir, -roadWidth / 2 - 5, accessEdge - 1);
  const stripeB = orientedPoint(cx, cy, dir, roadWidth / 2 + 5, accessEdge - 1);
  graphics.moveTo(stripeA.x, stripeA.y).lineTo(stripeB.x, stripeB.y).stroke({ color: PORTAL_WARNING, width: 1.2, alpha: 0.52 });
}

function drawOrientedRect(
  graphics: Graphics,
  cx: number,
  cy: number,
  dir: Vec2,
  forward: number,
  lateral: number,
  width: number,
  length: number,
  color: number,
  alpha: number,
  strokeColor?: number,
): void {
  const points = [
    orientedPoint(cx, cy, dir, lateral - width / 2, forward - length / 2),
    orientedPoint(cx, cy, dir, lateral + width / 2, forward - length / 2),
    orientedPoint(cx, cy, dir, lateral + width / 2, forward + length / 2),
    orientedPoint(cx, cy, dir, lateral - width / 2, forward + length / 2),
  ].flatMap((point) => [point.x, point.y]);
  const shape = graphics.poly(points).fill({ color, alpha });
  if (strokeColor !== undefined) shape.stroke({ color: strokeColor, width: 1.5, alpha: 0.86 });
}

function orientedPoint(cx: number, cy: number, dir: Vec2, lateral: number, forward: number): Vec2 {
  const perp = { x: -dir.y, y: dir.x };
  return {
    x: cx + perp.x * lateral + dir.x * forward,
    y: cy + perp.y * lateral + dir.y * forward,
  };
}
