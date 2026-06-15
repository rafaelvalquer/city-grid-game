import type { Graphics } from 'pixi.js';
import type { RoadDirection, Vec2 } from '../../types/city.types';
import { MAP_COLORS } from './visualTheme';

export function directionAngle(direction: RoadDirection): number {
  if (direction === 'west') return Math.PI;
  if (direction === 'north') return -Math.PI / 2;
  if (direction === 'south') return Math.PI / 2;
  return 0;
}
export function drawCapsule(
  graphics: Graphics,
  cx: number,
  cy: number,
  length: number,
  width: number,
  angle: number,
  color: number,
  alpha = 1,
  strokeColor?: number,
): void {
  const radius = width / 2;
  const halfStraight = Math.max(0, (length - width) / 2);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const front = { x: cx + dx * halfStraight, y: cy + dy * halfStraight };
  const back = { x: cx - dx * halfStraight, y: cy - dy * halfStraight };
  const body = [
    back.x + px * radius, back.y + py * radius,
    front.x + px * radius, front.y + py * radius,
    front.x - px * radius, front.y - py * radius,
    back.x - px * radius, back.y - py * radius,
  ];

  graphics.poly(body).fill({ color, alpha });
  graphics.circle(front.x, front.y, radius).fill({ color, alpha });
  graphics.circle(back.x, back.y, radius).fill({ color, alpha });
  if (strokeColor !== undefined) {
    graphics.poly(body).stroke({ color: strokeColor, width: 1, alpha: 0.55 });
    graphics.circle(front.x, front.y, radius).stroke({ color: strokeColor, width: 1, alpha: 0.55 });
    graphics.circle(back.x, back.y, radius).stroke({ color: strokeColor, width: 1, alpha: 0.55 });
  }
}


export function drawRotatedRect(graphics: Graphics, cx: number, cy: number, width: number, height: number, angle: number, color: number, alpha = 1): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const hw = width / 2;
  const hh = height / 2;
  graphics.poly([
    cx - dx * hw - px * hh, cy - dy * hw - py * hh,
    cx + dx * hw - px * hh, cy + dy * hw - py * hh,
    cx + dx * hw + px * hh, cy + dy * hw + py * hh,
    cx - dx * hw + px * hh, cy - dy * hw + py * hh,
  ]).fill({ color, alpha });
}


export function normalizeVec(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.y);
  if (length <= 0.0001) return { x: 0, y: 0 };
  return { x: vec.x / length, y: vec.y / length };
}


export function carColor(id: string): number {
  const colors = [MAP_COLORS.carBody, MAP_COLORS.carAltA, MAP_COLORS.carAltB, MAP_COLORS.carAltC];
  let total = 0;
  for (let i = 0; i < id.length; i += 1) total += id.charCodeAt(i);
  return colors[total % colors.length];
}


export function hash2(x: number, y: number, salt = 0): number {
  let value = Math.imul(x + 101, 374761393) ^ Math.imul(y + 17, 668265263) ^ Math.imul(salt + 31, 2246822519);
  value = (value ^ (value >>> 13)) >>> 0;
  return value;
}


export function pulse(timeSeconds: number, speed: number, phase = 0): number {
  return (Math.sin((timeSeconds * speed + phase) * Math.PI * 2) + 1) / 2;
}


export function idPhase(id: string): number {
  let total = 0;
  for (let i = 0; i < id.length; i += 1) total += id.charCodeAt(i) * (i + 1);
  return (total % 997) / 997;
}


export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

