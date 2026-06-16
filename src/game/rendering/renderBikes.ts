import type { Graphics } from 'pixi.js';
import type { Vec2 } from '../../types/city.types';
import { BIKE_LANE_CONFIG } from '../config/bikeConfig';
import type { GameWorld } from '../engine/simulation';

function interpolate(route: Vec2[], progress: number): { x: number; y: number; angle: number; from: Vec2; to: Vec2 } | null {
  if (route.length < 2) return null;
  const index = Math.max(0, Math.min(route.length - 2, Math.floor(progress)));
  const t = Math.max(0, Math.min(1, progress - index));
  const from = route[index];
  const to = route[index + 1];
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  return { x, y, angle: Math.atan2(to.y - from.y, to.x - from.x), from, to };
}

function localPoint(cx: number, cy: number, angle: number, forward: number, side: number): { x: number; y: number } {
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const sx = -fy;
  const sy = fx;
  return { x: cx + fx * forward + sx * side, y: cy + fy * forward + sy * side };
}

function drawBikeTrail(graphics: Graphics, route: Vec2[], progress: number, ts: number): void {
  const current = interpolate(route, progress);
  const previous = interpolate(route, Math.max(0, progress - 0.75));
  if (!current || !previous) return;
  graphics
    .moveTo(previous.x * ts + ts / 2, previous.y * ts + ts / 2)
    .lineTo(current.x * ts + ts / 2, current.y * ts + ts / 2)
    .stroke({ color: BIKE_LANE_CONFIG.bikeTrailColor, width: 3, alpha: 0.18 });
}

function drawBike(graphics: Graphics, cx: number, cy: number, angle: number, timeSeconds: number): void {
  const pedal = Math.sin(timeSeconds * 10) * 0.9;
  const wheelPulse = 0.8 + Math.abs(Math.sin(timeSeconds * 12)) * 0.22;
  const rear = localPoint(cx, cy, angle, -5, 3);
  const front = localPoint(cx, cy, angle, 5, 3);
  const bodyTop = localPoint(cx, cy, angle, 0, -2 + pedal);
  const bodyLow = localPoint(cx, cy, angle, -1, 3);
  const head = localPoint(cx, cy, angle, 0, -6 + pedal * 0.35);

  graphics.circle(rear.x, rear.y, 2.6 + wheelPulse * 0.2)
    .stroke({ color: BIKE_LANE_CONFIG.bikeWheelColor, width: 1.25, alpha: 0.94 });
  graphics.circle(front.x, front.y, 2.6 + wheelPulse * 0.2)
    .stroke({ color: BIKE_LANE_CONFIG.bikeWheelColor, width: 1.25, alpha: 0.94 });

  graphics.moveTo(rear.x, rear.y)
    .lineTo(bodyTop.x, bodyTop.y)
    .lineTo(front.x, front.y)
    .lineTo(bodyLow.x, bodyLow.y)
    .lineTo(rear.x, rear.y)
    .stroke({ color: BIKE_LANE_CONFIG.bikeBodyColor, width: 1.7, alpha: 0.97 });

  graphics.circle(head.x, head.y, 1.8).fill({ color: BIKE_LANE_CONFIG.bikeWheelColor, alpha: 0.97 });
}

export function drawBikeTrips(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  for (const trip of world.bikeTrips) {
    const pose = interpolate(trip.route, trip.progress);
    if (!pose) continue;
    drawBikeTrail(graphics, trip.route, trip.progress, ts);
    drawBike(graphics, pose.x * ts + ts / 2, pose.y * ts + ts / 2, pose.angle, timeSeconds);
  }
}
