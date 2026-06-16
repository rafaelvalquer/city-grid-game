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

function bikeSidewalkOffset(angle: number, ts: number): { x: number; y: number } {
  // Posiciona a bicicleta sobre a calçada/borda pintada de azul, não no meio da rua.
  // O deslocamento usa o vetor perpendicular à direção da viagem.
  const sideX = -Math.sin(angle);
  const sideY = Math.cos(angle);
  return { x: sideX * ts * 0.34, y: sideY * ts * 0.34 };
}

function bikePixelPose(route: Vec2[], progress: number, ts: number): { x: number; y: number; angle: number } | null {
  const pose = interpolate(route, progress);
  if (!pose) return null;
  const offset = bikeSidewalkOffset(pose.angle, ts);
  return {
    x: pose.x * ts + ts / 2 + offset.x,
    y: pose.y * ts + ts / 2 + offset.y,
    angle: pose.angle,
  };
}

function drawBikeTrail(graphics: Graphics, route: Vec2[], progress: number, ts: number): void {
  const current = bikePixelPose(route, progress, ts);
  const previous = bikePixelPose(route, Math.max(0, progress - 0.55), ts);
  if (!current || !previous) return;
  graphics
    .moveTo(previous.x, previous.y)
    .lineTo(current.x, current.y)
    .stroke({ color: BIKE_LANE_CONFIG.bikeTrailColor, width: 2.2, alpha: 0.16 });
}

function drawBikeSquare(graphics: Graphics, cx: number, cy: number, angle: number, timeSeconds: number): void {
  // Representação discreta: um pequeno quadradinho verde sobre a calçada azul.
  // Sem rodas/corpo grande para não parecer que está andando no meio da rua.
  const pulse = 0.5 + Math.sin(timeSeconds * 6.5 + cx * 0.01 + cy * 0.01) * 0.5;
  const size = 5.2 + pulse * 0.45;
  const glowSize = size + 3.2;
  const lean = Math.sin(angle) * 0.6;

  graphics.roundRect(cx - glowSize / 2 + lean, cy - glowSize / 2, glowSize, glowSize, 2.5)
    .fill({ color: BIKE_LANE_CONFIG.bikeBodyColor, alpha: 0.11 });
  graphics.roundRect(cx - size / 2 + lean, cy - size / 2, size, size, 1.6)
    .fill({ color: BIKE_LANE_CONFIG.bikeBodyColor, alpha: 0.92 })
    .stroke({ color: BIKE_LANE_CONFIG.bikeWheelColor, width: 0.75, alpha: 0.78 });
  graphics.rect(cx - 1.2 + lean, cy - 1.2, 2.4, 2.4)
    .fill({ color: 0x052e16, alpha: 0.24 });
}

export function drawBikeTrips(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  for (const trip of world.bikeTrips) {
    const pose = bikePixelPose(trip.route, trip.progress, ts);
    if (!pose) continue;
    drawBikeTrail(graphics, trip.route, trip.progress, ts);
    drawBikeSquare(graphics, pose.x, pose.y, pose.angle, timeSeconds);
  }
}
