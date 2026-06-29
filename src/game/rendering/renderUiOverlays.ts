import type { Graphics } from 'pixi.js';
import type { HoverPreview } from '../../store/gameStore';
import type { RoadDirection } from '../../types/city.types';
import type { GameWorld } from '../engine/simulation';
import { inBounds, keyOf } from '../city/grid';
import { MAP_COLORS } from './visualTheme';
import { drawBusStopCoverage, drawOneWayArrow, drawTinyBusIcon } from './renderRoads';
import { getCarRenderPose } from './renderVehicles';
import { busStopPreviewAccess, isRoadLineTool } from './inputController';
import { pulse } from './renderUtils';
import { SIGNAL_GREEN, SIGNAL_OFF, SIGNAL_RED } from './renderTypes';
import { HELICOPTER_CONFIG } from '../config/helicopterConfig';
import { drawHelipadCoverage } from './renderHelicopters';
import { getRoadConnectionDirections } from '../city/roadConnections';
export function drawSelection(graphics: Graphics, x: number, y: number, ts: number): void {
  graphics.roundRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2, 5).stroke({ color: MAP_COLORS.selection, width: 2 });
}

export function drawSelectedRoadConnections(graphics: Graphics, world: GameWorld, x: number, y: number, ts: number): void {
  const centerX = x * ts + ts / 2;
  const centerY = y * ts + ts / 2;
  for (const direction of getRoadConnectionDirections(world.grid, { x, y })) {
    const endX = direction === 'west' ? x * ts : direction === 'east' ? (x + 1) * ts : centerX;
    const endY = direction === 'north' ? y * ts : direction === 'south' ? (y + 1) * ts : centerY;
    graphics.moveTo(centerX, centerY).lineTo(endX, endY)
      .stroke({ color: MAP_COLORS.selection, width: 4, alpha: 0.72 });
    graphics.circle(endX, endY, 3.5).fill({ color: MAP_COLORS.selection, alpha: 0.95 });
  }
}


export function drawConstructionPreview(graphics: Graphics, world: GameWorld, preview: HoverPreview, ts: number, timeSeconds: number): void {
  const { x, y, valid, tool } = preview;
  if (tool === 'roadConnection' && preview.connectionDirection) {
    drawRoadConnectionPreview(graphics, preview, preview.connectionDirection, ts, timeSeconds);
    return;
  }
  if (preview.lineTiles?.length && tool && isRoadLineTool(tool)) {
    drawRoadLinePreview(graphics, preview, tool, ts, timeSeconds);
    return;
  }
  if (preview.lineTiles?.length && tool === 'oneWay' && preview.oneWayDirection) {
    drawOneWayLinePreview(graphics, preview, preview.oneWayDirection, ts, timeSeconds);
    return;
  }
  if (preview.lineTiles?.length && (tool === 'metroTrack' || tool === 'metroLine')) {
    drawMetroDraftPreview(graphics, preview, ts, timeSeconds);
    return;
  }
  if (preview.lineTiles?.length && tool === 'helicopterLine') {
    drawHelicopterLinePreview(graphics, preview, ts, timeSeconds);
    return;
  }
  if (!inBounds(x, y)) return;
  const color = valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;
  const px = x * ts;
  const py = y * ts;
  const previewPulse = pulse(timeSeconds, valid ? 1.2 : 1.75, x * 0.19 + y * 0.13);

  if (tool === 'busStop' && valid) {
    drawBusStopCoverage(graphics, x, y, ts, 0.075 + previewPulse * 0.018, 0.42 + previewPulse * 0.18);
  }
  if (tool === 'helipad' && valid) {
    drawHelipadCoverage(graphics, {
      id: 'preview', name: 'Preview', x, y,
      accessRoad: { x, y },
      coverageRadius: HELICOPTER_CONFIG.coverageRadius,
      capacity: HELICOPTER_CONFIG.waitingCapacity,
      waiting: [], totalBoarded: 0, totalAlighted: 0,
      peakWaitingPassengers: 0, carsAvoidedFromHelipad: 0,
      activeLineIds: [], createdAtDay: 0,
    }, ts, 0.04);
  }

  if (tool === 'roundabout') {
    const areaPx = (x - 1) * ts;
    const areaPy = (y - 1) * ts;
    graphics.roundRect(areaPx + 2, areaPy + 2, ts * 3 - 4, ts * 3 - 4, 10)
      .fill({ color, alpha: valid ? 0.08 + previewPulse * 0.06 : 0.15 + previewPulse * 0.06 })
      .stroke({ color, width: 2 + previewPulse, alpha: valid ? 0.76 : 0.88 });
    graphics.circle(px + ts / 2, py + ts / 2, ts * 0.44).fill({ color: MAP_COLORS.park, alpha: valid ? 0.42 : 0.2 });
    graphics.circle(px + ts / 2, py + ts / 2, ts * 1.05).stroke({ color: valid ? MAP_COLORS.road : color, width: 12, alpha: valid ? 0.34 : 0.22 });
    if (!valid && preview.reason) {
      graphics.rect(areaPx + 9, areaPy + ts * 3 - 13, ts * 3 - 18, 4).fill({ color: MAP_COLORS.previewInvalid, alpha: 0.86 });
    }
    return;
  }

  const outerInset = 2 - previewPulse * 1.2;
  graphics.roundRect(px + outerInset, py + outerInset, ts - outerInset * 2, ts - outerInset * 2, 5)
    .fill({ color, alpha: valid ? 0.1 + previewPulse * 0.07 : 0.16 + previewPulse * 0.06 })
    .stroke({ color, width: 1.6 + previewPulse * 1.1, alpha: valid ? 0.68 + previewPulse * 0.28 : 0.76 + previewPulse * 0.2 });
  graphics.roundRect(px + 7, py + 7, ts - 14, ts - 14, 5).stroke({ color, width: 1, alpha: valid ? 0.4 + previewPulse * 0.25 : 0.56 + previewPulse * 0.22 });

  if (tool === 'road' || tool === 'avenue') {
    const roadW = tool === 'avenue' ? 30 : 21;
    graphics.roundRect(px + ts / 2 - roadW / 2, py + 5, roadW, ts - 10, 6).fill({ color: valid ? MAP_COLORS.road : MAP_COLORS.previewInvalid, alpha: valid ? 0.38 + previewPulse * 0.1 : 0.22 + previewPulse * 0.06 });
    graphics.roundRect(px + 5, py + ts / 2 - roadW / 2, ts - 10, roadW, 6).fill({ color: valid ? MAP_COLORS.road : MAP_COLORS.previewInvalid, alpha: valid ? 0.16 + previewPulse * 0.07 : 0.1 + previewPulse * 0.05 });
  } else if (tool === 'trafficLight') {
    graphics.circle(px + ts / 2, py + ts / 2, 8.5 + previewPulse * 1.6).fill({ color, alpha: 0.1 + previewPulse * 0.1 });
    graphics.circle(px + ts / 2, py + ts / 2, 7).fill({ color: valid ? SIGNAL_GREEN : SIGNAL_RED, alpha: 0.68 + previewPulse * 0.18 });
    graphics.circle(px + ts / 2, py + ts / 2, 3).fill(SIGNAL_OFF);
  } else if (tool === 'busStop') {
    graphics.roundRect(px + 6, py + 7, ts - 12, ts - 14, 8).fill({ color: valid ? 0xe8f7f4 : MAP_COLORS.previewInvalid, alpha: valid ? 0.62 : 0.22 });
    graphics.roundRect(px + 8, py + 8, ts - 16, 8, 4).fill({ color: valid ? 0x24a0b7 : MAP_COLORS.previewInvalid, alpha: valid ? 0.86 : 0.42 });
    graphics.roundRect(px + 13, py + 25, ts - 24, 4, 2).fill({ color: valid ? MAP_COLORS.bench : MAP_COLORS.previewInvalid, alpha: valid ? 0.72 : 0.34 });
    graphics.circle(px + ts - 8, py + 8, 6).fill({ color: valid ? 0x24a0b7 : MAP_COLORS.previewInvalid, alpha: 0.84 });
    drawTinyBusIcon(graphics, px + ts - 8, py + 8, 0.8, MAP_COLORS.laneSoft, valid ? 0.95 : 0.55);
    const access = valid ? busStopPreviewAccess(world.grid, x, y) : undefined;
    if (access) {
      graphics.roundRect(access.x * ts + 7, access.y * ts + 7, ts - 14, ts - 14, 6).stroke({ color: 0x24a0b7, width: 3, alpha: 0.55 });
    }
  } else if (tool === 'helipad') {
    graphics.circle(px + ts / 2, py + ts / 2, ts * 0.32).stroke({ color, width: 3, alpha: 0.9 });
    graphics.moveTo(px + 13, py + 10).lineTo(px + 13, py + ts - 10)
      .moveTo(px + ts - 13, py + 10).lineTo(px + ts - 13, py + ts - 10)
      .moveTo(px + 13, py + ts / 2).lineTo(px + ts - 13, py + ts / 2)
      .stroke({ color, width: 3, alpha: 0.9 });
  } else if (tool === 'remove') {
    graphics.moveTo(px + 10, py + 10).lineTo(px + ts - 10, py + ts - 10).stroke({ color, width: 3, alpha: 0.85 });
    graphics.moveTo(px + ts - 10, py + 10).lineTo(px + 10, py + ts - 10).stroke({ color, width: 3, alpha: 0.85 });
  } else if (tool === 'inspect') {
    const car = world.cars.find((c) => Math.abs(c.x - x) < 0.45 && Math.abs(c.y - y) < 0.45);
    if (car) graphics.circle(px + ts / 2, py + ts / 2, 10).stroke({ color: MAP_COLORS.selection, width: 2, alpha: 0.9 });
  }

  if (!valid && preview.reason) {
    graphics.rect(px + 7, py + ts - 10, ts - 14, 3).fill({ color: MAP_COLORS.previewInvalid, alpha: 0.86 });
  }
}

function drawRoadConnectionPreview(
  graphics: Graphics,
  preview: HoverPreview,
  direction: RoadDirection,
  ts: number,
  timeSeconds: number,
): void {
  if (!inBounds(preview.x, preview.y)) return;
  const px = preview.x * ts;
  const py = preview.y * ts;
  const padding = Math.max(5, ts * 0.14);
  const activeColor = preview.connectionConnected ? MAP_COLORS.previewInvalid : MAP_COLORS.previewValid;
  const color = preview.valid ? activeColor : MAP_COLORS.previewInvalid;
  const glow = 5 + pulse(timeSeconds, 1.5, preview.x * 0.17 + preview.y * 0.11) * 3;
  let x1 = px + padding;
  let y1 = py;
  let x2 = px + ts - padding;
  let y2 = py;
  if (direction === 'south') {
    y1 = py + ts;
    y2 = py + ts;
  } else if (direction === 'west') {
    x1 = px;
    x2 = px;
    y1 = py + padding;
    y2 = py + ts - padding;
  } else if (direction === 'east') {
    x1 = px + ts;
    x2 = px + ts;
    y1 = py + padding;
    y2 = py + ts - padding;
  }
  graphics.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width: glow, alpha: 0.2 });
  graphics.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width: 3, alpha: 0.95 });
  graphics.circle((x1 + x2) / 2, (y1 + y2) / 2, 4).fill({ color, alpha: 0.95 });
}


export function drawRoadLinePreview(graphics: Graphics, preview: HoverPreview, tool: 'road' | 'avenue' | 'busLane' | 'bikeLane' | 'roadTunnel' | 'avenueTunnel', ts: number, timeSeconds: number): void {
  const lineTiles = preview.lineTiles ?? [];
  const visibleTiles = lineTiles.filter((tile) => inBounds(tile.x, tile.y));
  if (!visibleTiles.length) return;

  const previewPulse = pulse(timeSeconds, preview.valid ? 1.15 : 1.7, (preview.x * 0.19) + (preview.y * 0.13));
  const color = preview.valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;
  const isBusLanePreview = tool === 'busLane';
  const isBikeLanePreview = tool === 'bikeLane';
  const isTunnelPreview = tool === 'roadTunnel' || tool === 'avenueTunnel';
  const roadColor = preview.valid
    ? (isTunnelPreview ? 0x7dd3fc : isBikeLanePreview ? 0x2563eb : isBusLanePreview ? 0x1d9bf0 : tool === 'avenue' ? MAP_COLORS.avenue : MAP_COLORS.road)
    : MAP_COLORS.previewInvalid;
  const roadW = isBikeLanePreview ? 6 : isBusLanePreview ? 13 : tool === 'avenue' || tool === 'avenueTunnel' ? 32 : 23;
  const minX = Math.min(...visibleTiles.map((tile) => tile.x));
  const maxX = Math.max(...visibleTiles.map((tile) => tile.x));
  const minY = Math.min(...visibleTiles.map((tile) => tile.y));
  const maxY = Math.max(...visibleTiles.map((tile) => tile.y));
  const horizontal = minY === maxY;

  graphics.roundRect(
    minX * ts + 2,
    minY * ts + 2,
    (maxX - minX + 1) * ts - 4,
    (maxY - minY + 1) * ts - 4,
    9,
  ).fill({ color, alpha: preview.valid ? 0.08 + previewPulse * 0.05 : 0.13 + previewPulse * 0.06 })
    .stroke({ color, width: 1.5 + previewPulse, alpha: preview.valid ? 0.56 + previewPulse * 0.28 : 0.72 + previewPulse * 0.2 });

  if (horizontal) {
    const y = minY * ts + ts / 2 - roadW / 2;
    graphics.roundRect(minX * ts + 4, y, (maxX - minX + 1) * ts - 8, roadW, 9)
      .fill({ color: roadColor, alpha: preview.valid ? 0.45 + previewPulse * 0.12 : 0.28 + previewPulse * 0.08 });
  } else {
    const x = minX * ts + ts / 2 - roadW / 2;
    graphics.roundRect(x, minY * ts + 4, roadW, (maxY - minY + 1) * ts - 8, 9)
      .fill({ color: roadColor, alpha: preview.valid ? 0.45 + previewPulse * 0.12 : 0.28 + previewPulse * 0.08 });
  }

  const invalidKeys = new Set((preview.invalidTiles ?? []).map((tile) => keyOf(tile.x, tile.y)));
  for (let index = 0; index < visibleTiles.length; index += 1) {
    const tile = visibleTiles[index];
    const px = tile.x * ts;
    const py = tile.y * ts;
    const invalid = invalidKeys.has(keyOf(tile.x, tile.y));
    graphics.roundRect(px + 5, py + 5, ts - 10, ts - 10, 5)
      .stroke({ color: invalid ? MAP_COLORS.previewInvalid : MAP_COLORS.previewValid, width: invalid ? 2 : 1, alpha: invalid ? 0.92 : 0.44 });
    if (invalid) {
      graphics.moveTo(px + 12, py + 12).lineTo(px + ts - 12, py + ts - 12).stroke({ color: MAP_COLORS.previewInvalid, width: 2.5, alpha: 0.9 });
      graphics.moveTo(px + ts - 12, py + 12).lineTo(px + 12, py + ts - 12).stroke({ color: MAP_COLORS.previewInvalid, width: 2.5, alpha: 0.9 });
    }
    if (isTunnelPreview && (index === 0 || index === visibleTiles.length - 1)) {
      graphics.circle(px + ts / 2, py + ts / 2, 12 + previewPulse * 3).stroke({ color: roadColor, width: 3, alpha: preview.valid ? 0.9 : 0.6 });
      graphics.roundRect(px + 9, py + 13, ts - 18, ts - 26, 8).fill({ color: 0x020617, alpha: 0.36 });
    }
  }
}


export function drawOneWayLinePreview(graphics: Graphics, preview: HoverPreview, direction: RoadDirection, ts: number, timeSeconds: number): void {
  const lineTiles = preview.lineTiles ?? [];
  const visibleTiles = lineTiles.filter((tile) => inBounds(tile.x, tile.y));
  if (!visibleTiles.length) return;

  const previewPulse = pulse(timeSeconds, preview.valid ? 1.1 : 1.7, preview.x * 0.17 + preview.y * 0.11);
  const color = preview.valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;
  const invalidKeys = new Set((preview.invalidTiles ?? []).map((tile) => keyOf(tile.x, tile.y)));

  for (const tile of visibleTiles) {
    const px = tile.x * ts;
    const py = tile.y * ts;
    const invalid = invalidKeys.has(keyOf(tile.x, tile.y));
    graphics.roundRect(px + 4, py + 4, ts - 8, ts - 8, 7)
      .fill({ color: invalid ? MAP_COLORS.previewInvalid : MAP_COLORS.previewValid, alpha: invalid ? 0.16 : 0.08 + previewPulse * 0.05 })
      .stroke({ color: invalid ? MAP_COLORS.previewInvalid : color, width: invalid ? 2 : 1.4 + previewPulse * 0.7, alpha: invalid ? 0.9 : 0.58 + previewPulse * 0.22 });
    drawOneWayArrow(graphics, tile.x, tile.y, ts, direction, false, invalid ? MAP_COLORS.previewInvalid : MAP_COLORS.previewValid, invalid ? 0.72 : 0.85);
  }
}

export function drawMetroDraftPreview(graphics: Graphics, preview: HoverPreview, ts: number, timeSeconds: number): void {
  const lineTiles = preview.lineTiles ?? [];
  const visibleTiles = lineTiles.filter((tile) => inBounds(tile.x, tile.y));
  if (visibleTiles.length < 2) return;

  const previewPulse = pulse(timeSeconds, preview.valid ? 1.1 : 1.7, preview.x * 0.17 + preview.y * 0.11);
  const color = preview.valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;
  const alpha = preview.valid ? 0.68 + previewPulse * 0.18 : 0.78 + previewPulse * 0.16;
  const centers = visibleTiles.map((tile) => ({ x: tile.x * ts + ts / 2, y: tile.y * ts + ts / 2 }));

  for (let index = 0; index < centers.length - 1; index += 1) {
    drawDashedSegment(graphics, centers[index], centers[index + 1], color, 3.5 + previewPulse, alpha, 12, 7);
  }

  for (const tile of visibleTiles) {
    const px = tile.x * ts + ts / 2;
    const py = tile.y * ts + ts / 2;
    graphics.circle(px, py, 7).fill({ color, alpha: 0.16 + previewPulse * 0.08 });
    graphics.circle(px, py, 3).fill({ color, alpha: 0.72 });
  }
}

function drawHelicopterLinePreview(graphics: Graphics, preview: HoverPreview, ts: number, timeSeconds: number): void {
  const tiles = preview.lineTiles ?? [];
  if (tiles.length < 2) return;
  const pulseValue = pulse(timeSeconds, preview.valid ? 1.1 : 1.7, preview.x * 0.13 + preview.y * 0.17);
  const color = preview.valid ? 0xf97316 : MAP_COLORS.previewInvalid;
  const from = { x: tiles[0].x * ts + ts / 2, y: tiles[0].y * ts + ts / 2 };
  const to = { x: tiles[tiles.length - 1].x * ts + ts / 2, y: tiles[tiles.length - 1].y * ts + ts / 2 };
  drawDashedSegment(graphics, from, to, color, 3 + pulseValue, 0.72, 14, 8);
  graphics.circle(from.x, from.y, 8).stroke({ color, width: 2, alpha: 0.9 });
  graphics.circle(to.x, to.y, 8).stroke({ color, width: 2, alpha: 0.9 });
}

function drawDashedSegment(
  graphics: Graphics,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: number,
  width: number,
  alpha: number,
  dash: number,
  gap: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return;
  const ux = dx / length;
  const uy = dy / length;

  let cursor = 0;
  while (cursor < length) {
    const end = Math.min(length, cursor + dash);
    graphics.moveTo(from.x + ux * cursor, from.y + uy * cursor);
    graphics.lineTo(from.x + ux * end, from.y + uy * end);
    graphics.stroke({ color, width, alpha });
    cursor += dash + gap;
  }
}


export function drawSelectedCarMarker(graphics: Graphics, world: GameWorld, ts: number): void {
  if (world.selected.kind !== 'car') return;
  const car = world.getCar(world.selected.carId);
  if (!car) return;
  const pose = getCarRenderPose(car, world);
  graphics.circle(pose.x * ts + ts / 2, pose.y * ts + ts / 2, 9).stroke({ color: MAP_COLORS.selection, width: 2 });
}

export function drawSelectedRoute(graphics: Graphics, world: GameWorld, ts: number): void {
  const route = world.getSelectedCarRoute();
  if (!route.length) return;
  graphics.poly(route.flatMap((p) => [p.x * ts + ts / 2, p.y * ts + ts / 2])).stroke({ color: MAP_COLORS.route, width: 5, alpha: 0.28 });
  graphics.poly(route.flatMap((p) => [p.x * ts + ts / 2, p.y * ts + ts / 2])).stroke({ color: MAP_COLORS.route, width: 2, alpha: 0.9 });
}
