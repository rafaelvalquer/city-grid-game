import type { Graphics } from 'pixi.js';
import type { ViewLayer } from '../../store/gameStore';
import type { Vec2 } from '../../types/city.types';
import type { GameWorld } from '../engine/simulation';
import { GAME_CONFIG } from '../config/gameConfig';

const METRO_SURFACE_DIM = 0x07111f;
const METRO_STATION = 0x5cc8ff;
const METRO_STATION_ACTIVE = 0x35d07f;
const METRO_STATION_CORE = 0xe8eef7;
const METRO_TRACK = 0x7dd3fc;
const METRO_TRAIN = 0xf4c542;
const METRO_COVERAGE = 0x5cc8ff;
const SURFACE_BUILDING = 0x10243a;
const SURFACE_ROOF = 0x173e5f;

export function renderMetroLayer(
  graphics: Graphics,
  world: GameWorld,
  viewLayer: ViewLayer,
  ts: number,
  timeSeconds: number,
): void {
  if (viewLayer !== 'underground') {
    drawSurfaceStationBuildings(graphics, world, ts, timeSeconds);
    return;
  }

  const width = (world.grid[0]?.length ?? GAME_CONFIG.gridWidth) * ts;
  const height = (world.grid.length || GAME_CONFIG.gridHeight) * ts;
  graphics.rect(0, 0, width, height).fill({ color: METRO_SURFACE_DIM, alpha: 0.74 });

  for (const station of world.metroStations) {
    graphics.circle(
      station.x * ts + ts / 2,
      station.y * ts + ts / 2,
      station.coverageRadius * ts,
    ).fill({ color: METRO_COVERAGE, alpha: 0.045 });
  }

  for (const track of world.metroTracks) {
    if (!track.active || track.tiles.length < 2) continue;
    drawPolyline(graphics, track.tiles, ts, METRO_TRACK, 5, 0.38);
    drawPolyline(graphics, track.tiles, ts, 0xffffff, 1, 0.18);
  }

  for (const line of world.metroLines) {
    if (!line.active || line.stationIds.length < 2) continue;
    const color = parseLineColor(line.color);
    for (let index = 0; index < line.stationIds.length - 1; index += 1) {
      const fromId = line.stationIds[index];
      const toId = line.stationIds[index + 1];
      const tiles = world.getMetroTrackTilesBetween(fromId, toId);
      if (tiles.length >= 2) {
        drawPolyline(graphics, tiles, ts, color, 3, 0.96);
        continue;
      }

      const from = world.getMetroStation(fromId);
      const to = world.getMetroStation(toId);
      if (from && to) drawPolyline(graphics, [from, to], ts, color, 3, 0.56);
    }
  }

  for (const station of world.metroStations) {
    drawUndergroundStation(graphics, world, station.id, ts, timeSeconds);
  }

  for (const train of world.metroTrains) {
    const line = world.metroLines.find((candidate) => candidate.id === train.lineId);
    if (!line) continue;
    const from = world.getMetroStation(line.stationIds[train.stationIndex]);
    const to = world.getMetroStation(line.stationIds[train.nextStationIndex]);
    if (!from || !to) continue;

    const trackTiles = world.getMetroTrackTilesBetween(from.id, to.id);
    const pose = trackTiles.length >= 2
      ? interpolateTrackPosition(trackTiles, train.progress)
      : { x: from.x + (to.x - from.x) * train.progress, y: from.y + (to.y - from.y) * train.progress };

    const px = pose.x * ts + ts / 2;
    const py = pose.y * ts + ts / 2;
    graphics.circle(px, py, 15).fill({ color: parseLineColor(line.color), alpha: 0.2 });
    graphics.roundRect(px - 11, py - 5, 22, 10, 5).fill({ color: METRO_TRAIN, alpha: 0.98 });
    graphics.roundRect(px - 6, py - 2, 12, 4, 3).fill({ color: 0x07111f, alpha: 0.76 });
  }
}

function drawPolyline(graphics: Graphics, tiles: Vec2[], ts: number, color: number, width: number, alpha: number): void {
  if (tiles.length < 2) return;
  graphics.moveTo(tiles[0].x * ts + ts / 2, tiles[0].y * ts + ts / 2);
  for (const tile of tiles.slice(1)) {
    graphics.lineTo(tile.x * ts + ts / 2, tile.y * ts + ts / 2);
  }
  graphics.stroke({ color, width, alpha });
}

function interpolateTrackPosition(tiles: Vec2[], progress: number): Vec2 {
  if (tiles.length < 2) return tiles[0] ?? { x: 0, y: 0 };
  const clamped = Math.max(0, Math.min(1, progress));
  const segmentCount = tiles.length - 1;
  const scaled = clamped * segmentCount;
  const index = Math.min(segmentCount - 1, Math.floor(scaled));
  const local = scaled - index;
  const from = tiles[index];
  const to = tiles[index + 1];
  return {
    x: from.x + (to.x - from.x) * local,
    y: from.y + (to.y - from.y) * local,
  };
}

function drawSurfaceStationBuildings(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  for (const station of world.metroStations) {
    const active = station.activeLineIds.length > 0;
    const pulse = 0.5 + Math.sin(timeSeconds * 4 + station.x * 0.35 + station.y * 0.2) * 0.5;
    const loadRatio = Math.min(1, station.waitingPassengers / Math.max(1, station.capacity));
    const x = station.x * ts;
    const y = station.y * ts;
    const cx = x + ts / 2;
    const cy = y + ts / 2;

    if (active || station.waitingPassengers > 0) {
      graphics.circle(cx, cy, 13 + pulse * 5).stroke({
        color: active ? METRO_STATION_ACTIVE : METRO_STATION,
        width: 1.5 + pulse,
        alpha: active ? 0.18 + pulse * 0.24 : 0.12 + pulse * 0.18,
      });
    }

    graphics.roundRect(x + 5, y + 6, ts - 10, ts - 12, 7).fill({ color: SURFACE_BUILDING, alpha: 0.98 });
    graphics.roundRect(x + 7, y + 4, ts - 14, 8, 4).fill({ color: SURFACE_ROOF, alpha: 0.98 });
    graphics.roundRect(x + 11, y + ts - 15, ts - 22, 8, 3).fill({ color: METRO_STATION, alpha: 0.7 + pulse * 0.22 });
    graphics.circle(cx, cy - 1, 11).fill({ color: active ? METRO_STATION_ACTIVE : METRO_STATION, alpha: 0.9 });
    graphics.circle(cx, cy - 1, 7).fill({ color: 0x07111f, alpha: 0.82 });

    graphics.moveTo(cx - 5, cy + 4);
    graphics.lineTo(cx - 5, cy - 5);
    graphics.lineTo(cx, cy + 1);
    graphics.lineTo(cx + 5, cy - 5);
    graphics.lineTo(cx + 5, cy + 4);
    graphics.stroke({ color: METRO_STATION_CORE, width: 1.8, alpha: 0.95 });

    if (loadRatio > 0) {
      graphics.roundRect(x + 7, y + ts - 5, ts - 14, 3, 2).fill({ color: 0x07111f, alpha: 0.82 });
      graphics.roundRect(x + 7, y + ts - 5, (ts - 14) * loadRatio, 3, 2).fill({ color: loadRatio > 0.82 ? 0xf26464 : 0x35d07f, alpha: 0.95 });
    }
  }
}

function drawUndergroundStation(graphics: Graphics, world: GameWorld, stationId: string, ts: number, timeSeconds: number): void {
  const station = world.getMetroStation(stationId);
  if (!station) return;
  const active = station.activeLineIds.length > 0;
  const cx = station.x * ts + ts / 2;
  const cy = station.y * ts + ts / 2;
  const pulse = 0.5 + Math.sin(timeSeconds * 3.5 + station.x * 0.4) * 0.5;
  const loadRatio = Math.min(1, station.waitingPassengers / Math.max(1, station.capacity));

  graphics.circle(cx, cy, 18 + pulse * 3).fill({ color: active ? METRO_STATION_ACTIVE : METRO_STATION, alpha: 0.14 + pulse * 0.1 });
  graphics.circle(cx, cy, 10).fill({ color: active ? METRO_STATION_ACTIVE : METRO_STATION, alpha: 0.94 });
  graphics.circle(cx, cy, 5).fill({ color: METRO_STATION_CORE, alpha: 0.96 });

  if (loadRatio > 0) {
    graphics.roundRect(cx - 14, cy + 14, 28, 4, 2).fill({ color: 0x0b1524, alpha: 0.82 });
    graphics.roundRect(cx - 14, cy + 14, 28 * loadRatio, 4, 2).fill({ color: loadRatio > 0.82 ? 0xf26464 : 0x35d07f, alpha: 0.96 });
  }
}

function parseLineColor(color: string): number {
  return Number(color.replace('#', '0x')) || METRO_TRACK;
}
