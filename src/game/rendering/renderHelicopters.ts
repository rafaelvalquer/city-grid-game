import type { Graphics } from 'pixi.js';
import type { Helicopter, Helipad } from '../../types/helicopter.types';
import type { GameWorld } from '../engine/simulation';
import type { GraphicsSettings } from '../config/graphicsSettings';

const HELIPAD_COLOR = 0xf97316;
const HELIPAD_ACTIVE = 0x22c55e;
const HELICOPTER_BODY = 0xf8fafc;
const HELICOPTER_GLASS = 0x38bdf8;

export type HelicopterPose = {
  x: number;
  y: number;
  angle: number;
  altitude: number;
};

export function drawHelipads(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  for (const helipad of world.helipads) drawHelipad(graphics, helipad, ts, timeSeconds);
}

export function drawHelipadCoverage(graphics: Graphics, helipad: Helipad, ts: number, alpha = 0.055): void {
  graphics.circle(
    helipad.x * ts + ts / 2,
    helipad.y * ts + ts / 2,
    helipad.coverageRadius * ts,
  ).fill({ color: HELIPAD_COLOR, alpha })
    .stroke({ color: HELIPAD_COLOR, width: 2, alpha: alpha * 4 });
}

export function drawAirLayer(
  graphics: Graphics,
  world: GameWorld,
  ts: number,
  timeSeconds: number,
  settings: GraphicsSettings,
): void {
  graphics.clear();
  for (const line of world.helicopterLines) {
    if (!line.active) continue;
    const from = world.getHelipad(line.helipadIds[0]);
    const to = world.getHelipad(line.helipadIds[1]);
    if (!from || !to) continue;
    graphics.moveTo(from.x * ts + ts / 2, from.y * ts + ts / 2)
      .lineTo(to.x * ts + ts / 2, to.y * ts + ts / 2)
      .stroke({ color: parseColor(line.color), width: 1.5, alpha: 0.18 });
  }
  for (const helicopter of world.helicopters) drawHelicopter(graphics, world, helicopter, ts, timeSeconds, settings);
}

export function getHelicopterPose(world: GameWorld, helicopter: Helicopter): HelicopterPose | undefined {
  const from = world.getHelipad(helicopter.fromHelipadId);
  const to = world.getHelipad(helicopter.toHelipadId);
  if (!from || !to) return undefined;
  const rawProgress = helicopter.state === 'landing' ? 1 : helicopter.state === 'dwelling' || helicopter.state === 'takingOff' ? 0 : helicopter.progress;
  const progress = Math.max(0, Math.min(1, rawProgress));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const perpendicularX = -dy / length;
  const perpendicularY = dx / length;
  const arc = Math.sin(Math.PI * progress) * Math.min(2.2, length * 0.08);
  const phaseAltitude = helicopter.state === 'takingOff'
    ? helicopter.stateProgress
    : helicopter.state === 'landing'
      ? 1 - helicopter.stateProgress
      : helicopter.state === 'dwelling' ? 0 : 1;
  return {
    x: from.x + dx * progress + perpendicularX * arc,
    y: from.y + dy * progress + perpendicularY * arc,
    angle: Math.atan2(dy, dx),
    altitude: Math.max(0, Math.min(1, phaseAltitude)),
  };
}

function drawHelipad(graphics: Graphics, helipad: Helipad, ts: number, timeSeconds: number): void {
  const x = helipad.x * ts;
  const y = helipad.y * ts;
  const cx = x + ts / 2;
  const cy = y + ts / 2;
  const pulse = 0.5 + Math.sin(timeSeconds * 4 + helipad.x) * 0.5;
  const active = helipad.activeLineIds.length > 0;
  const waiting = helipad.waiting.reduce((sum, group) => sum + group.count, 0);
  graphics.roundRect(x + 3, y + 3, ts - 6, ts - 6, 8).fill({ color: 0x273449, alpha: 0.98 });
  graphics.circle(cx, cy, ts * 0.34).stroke({ color: active ? HELIPAD_ACTIVE : HELIPAD_COLOR, width: 3, alpha: 0.9 });
  graphics.moveTo(cx - 7, cy - 9).lineTo(cx - 7, cy + 9)
    .moveTo(cx + 7, cy - 9).lineTo(cx + 7, cy + 9)
    .moveTo(cx - 7, cy).lineTo(cx + 7, cy)
    .stroke({ color: 0xffffff, width: 3, alpha: 0.92 });
  if (active) graphics.circle(cx, cy, ts * 0.42 + pulse * 2).stroke({ color: HELIPAD_ACTIVE, width: 1, alpha: 0.18 + pulse * 0.18 });
  if (waiting > 0) {
    const ratio = Math.min(1, waiting / Math.max(1, helipad.capacity));
    graphics.roundRect(x + 7, y + ts - 5, ts - 14, 3, 2).fill({ color: 0x07111f, alpha: 0.9 });
    graphics.roundRect(x + 7, y + ts - 5, (ts - 14) * ratio, 3, 2).fill({ color: ratio > 0.8 ? 0xef4444 : HELIPAD_ACTIVE, alpha: 0.96 });
  }
}

function drawHelicopter(
  graphics: Graphics,
  world: GameWorld,
  helicopter: Helicopter,
  ts: number,
  timeSeconds: number,
  settings: GraphicsSettings,
): void {
  const pose = getHelicopterPose(world, helicopter);
  if (!pose) return;
  const cx = pose.x * ts + ts / 2;
  const cy = pose.y * ts + ts / 2 - pose.altitude * 10;
  const scale = 0.82 + pose.altitude * 0.24;
  const simplified = settings.vehicleDetail === 'simplified';
  if (settings.vehicleShadows) {
    graphics.ellipse(cx + 5 + pose.altitude * 8, cy + 8 + pose.altitude * 10, 11 * scale, 5 * scale)
      .fill({ color: 0x020617, alpha: 0.18 * (1 - pose.altitude * 0.45) });
  }
  drawRotatedEllipse(graphics, cx, cy, simplified ? 8 : 10, simplified ? 5 : 6, pose.angle, HELICOPTER_BODY, 0.98);
  drawRotatedRect(graphics, cx - Math.cos(pose.angle) * 10, cy - Math.sin(pose.angle) * 10, 12, 2.5, pose.angle, HELICOPTER_BODY, 0.94);
  drawRotatedEllipse(graphics, cx + Math.cos(pose.angle) * 3, cy + Math.sin(pose.angle) * 3, 4, 3.5, pose.angle, HELICOPTER_GLASS, 0.88);
  const rotorAngle = timeSeconds * 18;
  const rotorWidth = simplified ? 18 : 23;
  graphics.moveTo(cx - Math.cos(rotorAngle) * rotorWidth, cy - Math.sin(rotorAngle) * rotorWidth)
    .lineTo(cx + Math.cos(rotorAngle) * rotorWidth, cy + Math.sin(rotorAngle) * rotorWidth)
    .stroke({ color: 0xe2e8f0, width: 1.3, alpha: 0.72 });
  if (!simplified) {
    const tailX = cx - Math.cos(pose.angle) * 16;
    const tailY = cy - Math.sin(pose.angle) * 16;
    graphics.circle(tailX, tailY, 3).stroke({ color: 0xe2e8f0, width: 1, alpha: 0.8 });
  }
  if (settings.vehicleLights) {
    graphics.circle(cx + Math.cos(pose.angle) * 8, cy + Math.sin(pose.angle) * 8, 1.8).fill({ color: 0x22c55e, alpha: 0.95 });
    graphics.circle(cx - Math.cos(pose.angle) * 8, cy - Math.sin(pose.angle) * 8, 1.6).fill({ color: 0xef4444, alpha: 0.9 });
  }
}

function drawRotatedRect(graphics: Graphics, cx: number, cy: number, width: number, height: number, angle: number, color: number, alpha: number): void {
  const points = rotatedPoints(cx, cy, width, height, angle);
  graphics.poly(points).fill({ color, alpha });
}

function drawRotatedEllipse(graphics: Graphics, cx: number, cy: number, rx: number, ry: number, angle: number, color: number, alpha: number): void {
  const points: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    const t = (index / 16) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    points.push(cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle));
  }
  graphics.poly(points).fill({ color, alpha });
}

function rotatedPoints(cx: number, cy: number, width: number, height: number, angle: number): number[] {
  const hw = width / 2;
  const hh = height / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].flatMap(([x, y]) => [
    cx + x * Math.cos(angle) - y * Math.sin(angle),
    cy + x * Math.sin(angle) + y * Math.cos(angle),
  ]);
}

function parseColor(color: string): number {
  return Number(color.replace('#', '0x')) || HELIPAD_COLOR;
}
