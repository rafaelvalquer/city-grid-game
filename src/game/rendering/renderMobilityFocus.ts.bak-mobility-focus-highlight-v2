import type { Graphics } from 'pixi.js';
import type { MobilityFocusMode } from '../../store/gameStore';
import type { Car } from '../../types/agent.types';
import type { Vec2 } from '../../types/city.types';
import type { MetroLine } from '../../types/metro.types';
import type { GameWorld } from '../engine/simulation';

const DIM_COLOR = 0x020617;
const BIKE = 0x5cff9d;
const BIKE_LANE = 0x38e8ff;
const BUS = 0xffd166;
const BUS_LINE = 0xffa928;
const BUS_STOP = 0xfff2a6;
const BUS_LANE = 0x38bdf8;
const METRO = 0x9f7aea;
const METRO_LINE = 0x7dd3fc;
const METRO_STATION = 0xe0f2fe;
const METRO_TRAIN = 0xfacc15;

export function drawMobilityFocusOverlay(
  graphics: Graphics,
  world: GameWorld,
  mode: MobilityFocusMode,
  ts: number,
  timeSeconds: number,
): void {
  if (mode === 'off') return;

  drawMobilityFocusDim(graphics, world, ts);
  if (mode === 'bike') drawBikeFocusOverlay(graphics, world, ts, timeSeconds);
  if (mode === 'bus') drawBusFocusOverlay(graphics, world, ts, timeSeconds);
  if (mode === 'metro') drawMetroFocusOverlay(graphics, world, ts, timeSeconds);
}

function drawMobilityFocusDim(graphics: Graphics, world: GameWorld, ts: number): void {
  const width = (world.grid[0]?.length ?? 0) * ts;
  const height = world.grid.length * ts;
  if (width <= 0 || height <= 0) return;
  graphics.rect(0, 0, width, height).fill({ color: DIM_COLOR, alpha: 0.68 });
}

function drawBikeFocusOverlay(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  const pulse = 0.45 + Math.sin(timeSeconds * 3.2) * 0.18;

  for (let y = 0; y < world.grid.length; y += 1) {
    const row = world.grid[y];
    for (let x = 0; x < (row?.length ?? 0); x += 1) {
      const tile = row?.[x];
      if (!tile?.bikeLane) continue;
      const px = x * ts;
      const py = y * ts;
      const horizontal = isMostlyHorizontalRoad(world.grid, x, y);
      if (horizontal) {
        graphics.roundRect(px + 4, py + ts - 8, ts - 8, 4, 3).fill({ color: BIKE_LANE, alpha: 0.95 });
        graphics.roundRect(px + 7, py + ts - 11, ts - 14, 10, 6).stroke({ color: BIKE_LANE, width: 1.4, alpha: 0.28 + pulse });
      } else {
        graphics.roundRect(px + ts - 8, py + 4, 4, ts - 8, 3).fill({ color: BIKE_LANE, alpha: 0.95 });
        graphics.roundRect(px + ts - 11, py + 7, 10, ts - 14, 6).stroke({ color: BIKE_LANE, width: 1.4, alpha: 0.28 + pulse });
      }
    }
  }

  const bikeTrips = Array.isArray(world.bikeTrips) ? world.bikeTrips : [];
  for (const bike of bikeTrips) {
    if (!bike.route?.length) continue;
    drawBikeRouteTrail(graphics, bike.route, bike.progress, ts);
    const pos = interpolateRoute(bike.route, bike.progress);
    const px = pos.x * ts + ts / 2;
    const py = pos.y * ts + ts / 2;
    graphics.roundRect(px - 5, py - 5, 10, 10, 3).fill({ color: BIKE, alpha: 0.98 });
    graphics.roundRect(px - 8, py - 8, 16, 16, 6).stroke({ color: BIKE, width: 1.4, alpha: 0.25 + pulse });
  }
}

function drawBusFocusOverlay(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  const pulse = 0.5 + Math.sin(timeSeconds * 3.5) * 0.22;

  for (let y = 0; y < world.grid.length; y += 1) {
    const row = world.grid[y];
    for (let x = 0; x < (row?.length ?? 0); x += 1) {
      const tile = row?.[x];
      if (!tile?.busLane) continue;
      graphics.roundRect(x * ts + 5, y * ts + ts / 2 - 3, ts - 10, 6, 4).fill({ color: BUS_LANE, alpha: 0.9 });
      graphics.roundRect(x * ts + 3, y * ts + 3, ts - 6, ts - 6, 7).stroke({ color: BUS_LANE, width: 1.2, alpha: 0.18 + pulse * 0.35 });
    }
  }

  drawPolyline(graphics, world.transitLine?.route ?? [], ts, BUS_LINE, 5, 0.68);
  drawPolyline(graphics, world.transitLine?.route ?? [], ts, 0xffffff, 1.2, 0.38);

  for (const stop of world.transitStops ?? []) {
    const cx = stop.x * ts + ts / 2;
    const cy = stop.y * ts + ts / 2;
    graphics.circle(cx, cy, 16 + pulse * 4).fill({ color: BUS_STOP, alpha: 0.15 + pulse * 0.08 });
    graphics.circle(cx, cy, 9).fill({ color: BUS_STOP, alpha: 0.94 });
    graphics.circle(cx, cy, 4).fill({ color: DIM_COLOR, alpha: 0.74 });
  }

  for (const bus of world.cars.filter((car) => car.vehicleType === 'bus')) {
    drawFocusedVehicle(graphics, bus, ts, BUS, 18, 10);
  }
}

function drawMetroFocusOverlay(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  const pulse = 0.5 + Math.sin(timeSeconds * 3.2) * 0.22;

  for (const track of world.metroTracks ?? []) {
    if (!track.active || !track.tiles || track.tiles.length < 2) continue;
    drawPolyline(graphics, track.tiles, ts, METRO_LINE, 7, 0.34);
    drawPolyline(graphics, track.tiles, ts, METRO_STATION, 2, 0.28);
  }

  for (const line of world.metroLines ?? []) {
    if (!line.active || line.stationIds.length < 2) continue;
    const color = parseLineColor(line);
    for (let index = 0; index < line.stationIds.length - 1; index += 1) {
      const fromId = line.stationIds[index];
      const toId = line.stationIds[index + 1];
      const tiles = world.getMetroTrackTilesBetween(fromId, toId);
      if (tiles.length >= 2) {
        drawPolyline(graphics, tiles, ts, color, 5, 0.9);
      } else {
        const from = world.getMetroStation(fromId);
        const to = world.getMetroStation(toId);
        if (from && to) drawPolyline(graphics, [from, to], ts, color, 5, 0.55);
      }
    }
  }

  for (const station of world.metroStations ?? []) {
    const cx = station.x * ts + ts / 2;
    const cy = station.y * ts + ts / 2;
    const active = station.activeLineIds?.length > 0;
    graphics.circle(cx, cy, 18 + pulse * 5).fill({ color: active ? METRO : METRO_LINE, alpha: 0.16 + pulse * 0.08 });
    graphics.circle(cx, cy, 10).fill({ color: active ? METRO : METRO_LINE, alpha: 0.94 });
    graphics.circle(cx, cy, 5).fill({ color: METRO_STATION, alpha: 0.96 });
  }

  for (const train of world.metroTrains ?? []) {
    const line = world.metroLines.find((candidate) => candidate.id === train.lineId);
    if (!line) continue;
    const from = world.getMetroStation(line.stationIds[train.stationIndex]);
    const to = world.getMetroStation(line.stationIds[train.nextStationIndex]);
    if (!from || !to) continue;
    const trackTiles = world.getMetroTrackTilesBetween(from.id, to.id);
    const pos = trackTiles.length >= 2
      ? interpolateNormalizedTrack(trackTiles, train.progress)
      : { x: from.x + (to.x - from.x) * train.progress, y: from.y + (to.y - from.y) * train.progress };
    const px = pos.x * ts + ts / 2;
    const py = pos.y * ts + ts / 2;
    graphics.circle(px, py, 16).fill({ color: parseLineColor(line), alpha: 0.22 });
    graphics.roundRect(px - 11, py - 6, 22, 12, 5).fill({ color: METRO_TRAIN, alpha: 0.98 });
    graphics.roundRect(px - 6, py - 2, 12, 4, 3).fill({ color: DIM_COLOR, alpha: 0.78 });
  }
}

function drawPolyline(graphics: Graphics, tiles: Vec2[], ts: number, color: number, width: number, alpha: number): void {
  if (tiles.length < 2) return;
  graphics.moveTo(tiles[0].x * ts + ts / 2, tiles[0].y * ts + ts / 2);
  for (let i = 1; i < tiles.length; i += 1) {
    graphics.lineTo(tiles[i].x * ts + ts / 2, tiles[i].y * ts + ts / 2);
  }
  graphics.stroke({ color, width, alpha });
}

function drawBikeRouteTrail(graphics: Graphics, route: Vec2[], progress: number, ts: number): void {
  const start = Math.max(0, Math.floor(progress) - 4);
  const end = Math.min(route.length - 1, Math.floor(progress) + 1);
  if (end <= start) return;
  graphics.moveTo(route[start].x * ts + ts / 2, route[start].y * ts + ts / 2);
  for (let i = start + 1; i <= end; i += 1) {
    graphics.lineTo(route[i].x * ts + ts / 2, route[i].y * ts + ts / 2);
  }
  graphics.stroke({ color: BIKE, width: 3, alpha: 0.3 });
}

function drawFocusedVehicle(graphics: Graphics, car: Car, ts: number, color: number, width: number, height: number): void {
  const px = car.x * ts + ts / 2;
  const py = car.y * ts + ts / 2;
  graphics.circle(px, py, 16).fill({ color, alpha: 0.18 });
  graphics.roundRect(px - width / 2, py - height / 2, width, height, 4).fill({ color, alpha: 0.98 });
  graphics.roundRect(px - width / 2 + 4, py - 2, width - 8, 4, 3).fill({ color: DIM_COLOR, alpha: 0.55 });
}

function interpolateRoute(route: Vec2[], progress: number): Vec2 {
  if (route.length < 2) return route[0] ?? { x: 0, y: 0 };
  const index = Math.max(0, Math.min(route.length - 2, Math.floor(progress)));
  const local = Math.max(0, Math.min(1, progress - index));
  const from = route[index];
  const to = route[index + 1];
  return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
}

function interpolateNormalizedTrack(tiles: Vec2[], progress: number): Vec2 {
  if (tiles.length < 2) return tiles[0] ?? { x: 0, y: 0 };
  const clamped = Math.max(0, Math.min(1, progress));
  const segmentCount = tiles.length - 1;
  const scaled = clamped * segmentCount;
  const index = Math.min(segmentCount - 1, Math.floor(scaled));
  const local = scaled - index;
  const from = tiles[index];
  const to = tiles[index + 1];
  return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
}

function parseLineColor(line: MetroLine): number {
  return Number(String(line.color ?? '').replace('#', '0x')) || METRO_LINE;
}

function isMostlyHorizontalRoad(grid: Array<Array<{ type?: string }>>, x: number, y: number): boolean {
  const left = grid[y]?.[x - 1]?.type === 'road';
  const right = grid[y]?.[x + 1]?.type === 'road';
  const up = grid[y - 1]?.[x]?.type === 'road';
  const down = grid[y + 1]?.[x]?.type === 'road';
  if ((left || right) && !(up || down)) return true;
  if ((up || down) && !(left || right)) return false;
  return left || right;
}
