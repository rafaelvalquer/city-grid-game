import type { Graphics } from 'pixi.js';
import type { RoadDirection, RoadType, Tile, TrafficLightState, Vec2 } from '../../types/city.types';
import { TRANSIT_CONFIG } from '../config/transitConfig';
import { BIKE_LANE_CONFIG } from '../config/bikeConfig';
import type { GameWorld } from '../engine/simulation';
import { isRoadType, keyOf } from '../city/grid';
import { isIntersection } from '../systems/trafficRules';
import { getTrafficLightSignal } from '../systems/trafficLights';
import { getRoundaboutCenter, getRoundaboutRing, isRoundaboutTile } from '../systems/roundabouts';
import { MAP_COLORS } from './visualTheme';
import type { Atmosphere } from './renderTypes';
import { SIGNAL_GREEN, SIGNAL_OFF, SIGNAL_RED, SIGNAL_YELLOW } from './renderTypes';
import { passengerGroupCount } from './renderEffects';
import { directionAngle, hash2, idPhase, normalizeVec, pulse } from './renderUtils';

type RoadConnections = Record<RoadDirection, boolean>;
type RoadAutoTileShape = 'isolated' | 'deadEnd' | 'straight' | 'corner' | 'tee' | 'cross' | 'roundabout';

type RoadAutoTile = {
  shape: RoadAutoTileShape;
  connections: RoadConnections;
  directions: RoadDirection[];
  count: number;
  horizontal: boolean;
  vertical: boolean;
};

const BUS_LANE_COLOR = 0x1d9bf0;
const BUS_LANE_EDGE = 0x8bdcff;
const BUS_LANE_TEXT = 0xe7fbff;

export function drawBusStop(graphics: Graphics, world: GameWorld, x: number, y: number, ts: number, timeSeconds: number, atmosphere: Atmosphere): void {
  const stop = world.transitStops.find((candidate) => candidate.x === x && candidate.y === y);
  const px = x * ts;
  const py = y * ts;
  const pulseAlpha = stop ? pulse(timeSeconds, 1.6, idPhase(stop.id)) * stop.arrivalPulse : 0;
  const access = stop?.accessRoad;
  const dx = access ? Math.sign(access.x - x) : 0;
  const dy = access ? Math.sign(access.y - y) : 1;
  const horizontalAccess = dx !== 0;
  const platformX = px + (dx > 0 ? ts - 9 : dx < 0 ? 5 : 8);
  const platformY = py + (dy > 0 ? ts - 9 : dy < 0 ? 5 : 8);

  graphics.roundRect(px + 5, py + 6, ts - 10, ts - 12, 8)
    .fill({ color: 0xf1fbf8, alpha: 0.92 })
    .stroke({ color: 0x1d5f72, width: 1.2, alpha: 0.5 });
  if (horizontalAccess) {
    graphics.roundRect(platformX, py + 10, 4, ts - 18, 2).fill({ color: 0x24a0b7, alpha: 0.65 });
  } else {
    graphics.roundRect(px + 9, platformY, ts - 18, 4, 2).fill({ color: 0x24a0b7, alpha: 0.65 });
  }
  graphics.roundRect(px + 7, py + 7, ts - 14, 9, 4)
    .fill({ color: 0x24a0b7, alpha: 0.98 })
    .stroke({ color: MAP_COLORS.roadEdge, width: 1, alpha: 0.38 });
  graphics.rect(px + 11, py + 16, 3, 14).fill({ color: MAP_COLORS.roadEdge, alpha: 0.48 });
  graphics.rect(px + ts - 16, py + 16, 3, 14).fill({ color: MAP_COLORS.roadEdge, alpha: 0.48 });
  graphics.roundRect(px + 13, py + 25, ts - 24, 4, 2).fill({ color: MAP_COLORS.bench, alpha: 0.85 });
  graphics.rect(px + 15, py + 29, 2, 4).fill({ color: MAP_COLORS.bench, alpha: 0.7 });
  graphics.rect(px + ts - 17, py + 29, 2, 4).fill({ color: MAP_COLORS.bench, alpha: 0.7 });

  const signX = px + ts - 7;
  const signY = py + 8;
  graphics.rect(signX - 1, signY + 4, 2, 16).fill({ color: MAP_COLORS.roadEdge, alpha: 0.55 });
  graphics.circle(signX, signY, 6 + pulseAlpha * 2.2).fill({ color: 0x24a0b7, alpha: 0.18 + pulseAlpha * 0.16 });
  graphics.circle(signX, signY, 5).fill({ color: 0x24a0b7, alpha: 0.98 }).stroke({ color: MAP_COLORS.laneSoft, width: 1, alpha: 0.75 });
  drawTinyBusIcon(graphics, signX, signY, 0.78, MAP_COLORS.laneSoft, 0.96);

  const waiting = stop ? passengerGroupCount(stop.waiting) : 0;
  const visiblePeople = Math.min(8, waiting);
  for (let index = 0; index < visiblePeople; index += 1) {
    const row = Math.floor(index / 4);
    const col = index % 4;
    const phase = ((hash2(x, y, 120 + index) % 997) / 997);
    const bob = atmosphere.motion > 0 ? Math.sin((timeSeconds + phase) * 4.2) * 0.7 : 0;
    const personX = px + 7 + col * 4.7;
    const personY = py + ts - 5 - row * 4.8 + bob;
    const color = index % 2 === 0 ? MAP_COLORS.person : MAP_COLORS.personAlt;
    graphics.circle(personX, personY - 2.5, 1.4).fill({ color, alpha: atmosphere.pedestrianAlpha });
    graphics.rect(personX - 0.9, personY - 1.2, 1.8, 3.6).fill({ color, alpha: atmosphere.pedestrianAlpha });
  }

  if (waiting > visiblePeople) {
    graphics.roundRect(px + ts - 18, py + ts - 12, 12, 6, 3).fill({ color: MAP_COLORS.roadEdge, alpha: 0.58 });
    graphics.circle(px + ts - 14, py + ts - 9, 1.2).fill({ color: MAP_COLORS.laneSoft, alpha: 0.9 });
    graphics.circle(px + ts - 10, py + ts - 9, 1.2).fill({ color: MAP_COLORS.laneSoft, alpha: 0.9 });
  }
}


export function drawBusStopCoverage(graphics: Graphics, x: number, y: number, ts: number, fillAlpha = 0.08, strokeAlpha = 0.34): void {
  const cx = x * ts + ts / 2;
  const cy = y * ts + ts / 2;
  const radius = TRANSIT_CONFIG.coverageRadius * ts + ts / 2;
  graphics.circle(cx, cy, radius).fill({ color: 0x24a0b7, alpha: fillAlpha });
  graphics.circle(cx, cy, radius).stroke({ color: 0x24a0b7, width: 2, alpha: strokeAlpha });
  graphics.circle(cx, cy, ts * 0.55).stroke({ color: MAP_COLORS.laneSoft, width: 1, alpha: 0.28 });
}


export function drawTinyBusIcon(graphics: Graphics, cx: number, cy: number, scale: number, color: number, alpha: number): void {
  const w = 7 * scale;
  const h = 4.6 * scale;
  graphics.roundRect(cx - w / 2, cy - h / 2, w, h, 1.4 * scale).fill({ color, alpha });
  graphics.rect(cx - w * 0.32, cy - h * 0.22, w * 0.64, h * 0.28).fill({ color: 0x24a0b7, alpha: 0.8 });
  graphics.circle(cx - w * 0.28, cy + h * 0.38, 0.75 * scale).fill({ color: MAP_COLORS.roadEdge, alpha: 0.74 });
  graphics.circle(cx + w * 0.28, cy + h * 0.38, 0.75 * scale).fill({ color: MAP_COLORS.roadEdge, alpha: 0.74 });
}


export function drawRoad(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number, type: RoadType): void {
  const isAvenue = type === 'avenue';
  const isRoundabout = type === 'roundabout';
  const px = x * ts;
  const py = y * ts;
  const roadColor = isAvenue ? MAP_COLORS.avenue : MAP_COLORS.road;
  const edgeColor = isAvenue ? MAP_COLORS.avenueEdge : MAP_COLORS.roadEdge;
  const roadW = isAvenue ? 34 : isRoundabout ? 28 : 24;
  const walkW = Math.min(ts - 4, roadW + 8);
  const halfRoad = roadW / 2;
  const halfWalk = walkW / 2;
  const autoTile = getRoadAutoTileShape(grid, x, y, type);

  drawRoadShapeLayer(graphics, px + 2, py + 3, ts, halfWalk, MAP_COLORS.curbShadow, autoTile);

  drawRoadShapeLayer(graphics, px, py, ts, halfWalk, MAP_COLORS.sidewalk, autoTile);

  drawRoadShapeLayer(graphics, px + 1, py + 2, ts, halfRoad, MAP_COLORS.shadow, autoTile, 0.24);

  drawRoadShapeLayer(graphics, px, py, ts, halfRoad, roadColor, autoTile);
  drawRoadOutline(graphics, px, py, ts, halfRoad, edgeColor, autoTile);

  if (isRoundabout) {
    drawRoundaboutMarkings(graphics, grid, x, y, ts);
  } else {
    drawLaneMarkings(graphics, px, py, ts, isAvenue, autoTile, grid[y]?.[x]?.oneWay);
    if (grid[y]?.[x]?.busLane) drawBusLaneMarking(graphics, x, y, ts, type, autoTile);
    if (grid[y]?.[x]?.bikeLane) drawBikeLaneMarking(graphics, grid, x, y, ts, autoTile);
  }
}


export function drawBikeLaneMarking(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number, autoTile: RoadAutoTile): void {
  const tile = grid[y]?.[x];
  if (tile?.type !== 'road' || !tile.bikeLane) return;

  const px = x * ts;
  const py = y * ts;
  const center = ts / 2;
  const horizontal = autoTile.horizontal || autoTile.connections.east || autoTile.connections.west || autoTile.shape === 'isolated';
  const vertical = autoTile.vertical || autoTile.connections.north || autoTile.connections.south || autoTile.shape === 'isolated';
  const alpha = autoTile.shape === 'cross' || autoTile.shape === 'tee' ? 0.74 : 0.94;

  // A ciclovia é representada como a própria borda/calçada da rua pintada de azul.
  // Não desenha ícone grande nem faixa no centro da pista.
  if (horizontal) {
    drawBikeSidewalkStrip(graphics, px + 4, py + center - 17, ts - 8, 4, alpha);
    drawBikeSidewalkStrip(graphics, px + 4, py + center + 13, ts - 8, 4, alpha);
  }

  if (vertical) {
    drawBikeSidewalkStrip(graphics, px + center - 17, py + 4, 4, ts - 8, alpha);
    drawBikeSidewalkStrip(graphics, px + center + 13, py + 4, 4, ts - 8, alpha);
  }
}

function drawBikeSidewalkStrip(graphics: Graphics, x: number, y: number, width: number, height: number, alpha: number): void {
  graphics.roundRect(x, y, width, height, 2)
    .fill({ color: BIKE_LANE_CONFIG.laneColor, alpha })
    .stroke({ color: BIKE_LANE_CONFIG.laneEdgeColor, width: 0.8, alpha: Math.min(0.86, alpha + 0.08) });
}



export function drawBusLaneMarking(graphics: Graphics, x: number, y: number, ts: number, type: RoadType, autoTile: RoadAutoTile): void {
  if (type === 'roundabout') return;
  const px = x * ts;
  const py = y * ts;
  const center = ts / 2;
  const isAvenue = type === 'avenue';
  const halfWidth = isAvenue ? 5.2 : 4.2;
  drawRoadShapeLayer(graphics, px, py, ts, halfWidth + 1.5, BUS_LANE_EDGE, autoTile, 0.48);
  drawRoadShapeLayer(graphics, px, py, ts, halfWidth, BUS_LANE_COLOR, autoTile, 0.82);

  const hasTrueHorizontalSpan = autoTile.connections.east && autoTile.connections.west;
  const hasTrueVerticalSpan = autoTile.connections.north && autoTile.connections.south;
  if (hasTrueHorizontalSpan || (!hasTrueVerticalSpan && autoTile.horizontal)) {
    graphics.rect(px + 8, py + center - 1, ts - 16, 2).fill({ color: BUS_LANE_TEXT, alpha: 0.55 });
  }
  if (hasTrueVerticalSpan || (!hasTrueHorizontalSpan && autoTile.vertical)) {
    graphics.rect(px + center - 1, py + 8, 2, ts - 16).fill({ color: BUS_LANE_TEXT, alpha: 0.55 });
  }

  if ((x + y) % 3 === 0 || autoTile.shape === 'tee' || autoTile.shape === 'cross') {
    drawTinyBusIcon(graphics, px + center, py + center, isAvenue ? 1.05 : 0.92, BUS_LANE_TEXT, 0.96);
  }
}


export function drawRoundaboutIsland(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number): void {
  const px = x * ts;
  const py = y * ts;
  const center = ts / 2;
  graphics.circle(px + center + 2, py + center + 3, 15).fill({ color: MAP_COLORS.shadow, alpha: 0.22 });
  graphics.circle(px + center, py + center, 16).fill(MAP_COLORS.sidewalk);
  graphics.circle(px + center, py + center, 12).fill({ color: MAP_COLORS.park, alpha: 0.9 });
  graphics.circle(px + center - 4, py + center - 2, 3).fill(MAP_COLORS.tree);
  graphics.circle(px + center + 5, py + center + 4, 2.6).fill(MAP_COLORS.treeLight);

  for (const ring of getRoundaboutRing({ x, y })) {
    if (!isRoundaboutTile(grid[ring.y]?.[ring.x])) continue;
    const rx = ring.x * ts + center;
    const ry = ring.y * ts + center;
    const angle = Math.atan2(ry - (py + center), rx - (px + center)) - Math.PI / 2;
    drawTurnArrow(graphics, rx, ry, angle);
  }
}


export function drawRoundaboutMarkings(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number): void {
  const center = getRoundaboutCenter(grid, { x, y });
  if (!center) return;
  const px = x * ts;
  const py = y * ts;
  const localCenterX = center.x * ts + ts / 2;
  const localCenterY = center.y * ts + ts / 2;
  const cx = px + ts / 2;
  const cy = py + ts / 2;
  const angle = Math.atan2(cy - localCenterY, cx - localCenterX) - Math.PI / 2;
  const radial = normalizeVec({ x: cx - localCenterX, y: cy - localCenterY });
  const tangent = { x: -radial.y, y: radial.x };

  for (const distance of [-5.5, 5.5]) {
    const markX = cx + radial.x * distance;
    const markY = cy + radial.y * distance;
    drawShortDashedSegment(graphics, markX, markY, tangent, MAP_COLORS.laneSoft, 0.34);
  }

  drawTurnArrow(graphics, cx, cy, angle);
}


export function drawRoadSignage(graphics: Graphics, world: GameWorld, x: number, y: number, ts: number): void {
  if (!isIntersection(world.grid, { x, y })) return;
  if (world.trafficLights.has(keyOf(x, y))) return;

  const px = x * ts;
  const py = y * ts;
  const center = ts / 2;
  const autoTile = getRoadAutoTileShape(world.grid, x, y, world.grid[y][x].type as RoadType);
  if (autoTile.shape !== 'tee' && autoTile.shape !== 'cross') return;
  const neighbors = autoTile.connections;
  const markColor = MAP_COLORS.laneSoft;

  drawIntersectionBox(graphics, px, py, ts);

  if (neighbors.west) {
    drawCrosswalk(graphics, px + 5, py + center - 15, false, markColor);
    drawStopMark(graphics, px + 8, py + center + 10, true);
  }
  if (neighbors.east) {
    drawCrosswalk(graphics, px + ts - 11, py + center - 15, false, markColor);
    drawStopMark(graphics, px + ts - 17, py + center - 12, true);
  }
  if (neighbors.north) {
    drawCrosswalk(graphics, px + center - 15, py + 5, true, markColor);
    drawStopMark(graphics, px + center - 12, py + 8, false);
  }
  if (neighbors.south) {
    drawCrosswalk(graphics, px + center - 15, py + ts - 11, true, markColor);
    drawStopMark(graphics, px + center + 10, py + ts - 17, false);
  }
}


export function drawIntersectionBox(graphics: Graphics, px: number, py: number, ts: number): void {
  const inset = 11;
  graphics.roundRect(px + inset, py + inset, ts - inset * 2, ts - inset * 2, 5)
    .fill({ color: MAP_COLORS.laneSoft, alpha: 0.08 })
    .stroke({ color: MAP_COLORS.laneSoft, width: 1, alpha: 0.16 });
}


export function drawCrosswalk(graphics: Graphics, x: number, y: number, horizontal: boolean, color: number): void {
  for (let i = 0; i < 4; i += 1) {
    if (horizontal) graphics.roundRect(x + i * 7, y, 4, 2, 1).fill({ color, alpha: 0.52 });
    else graphics.roundRect(x, y + i * 7, 2, 4, 1).fill({ color, alpha: 0.52 });
  }
}


export function drawStopMark(graphics: Graphics, x: number, y: number, horizontal: boolean): void {
  if (horizontal) graphics.roundRect(x, y, 9, 2, 1).fill({ color: MAP_COLORS.laneSoft, alpha: 0.58 });
  else graphics.roundRect(x, y, 2, 9, 1).fill({ color: MAP_COLORS.laneSoft, alpha: 0.58 });
}


export function drawTurnArrow(graphics: Graphics, x: number, y: number, angle: number): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const points = [
    x + dx * 5, y + dy * 5,
    x - dx * 3 + px * 3, y - dy * 3 + py * 3,
    x - dx * 1, y - dy * 1,
    x - dx * 3 - px * 3, y - dy * 3 - py * 3,
  ];
  graphics.poly(points).fill({ color: MAP_COLORS.laneSoft, alpha: 0.62 });
}


export function drawTrafficLights(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  for (const light of world.trafficLights.values()) {
    drawTrafficLight(graphics, light, ts, timeSeconds);
  }
}


export function drawTrafficLight(graphics: Graphics, light: TrafficLightState, ts: number, timeSeconds: number): void {
  const px = light.x * ts;
  const py = light.y * ts;
  const center = ts / 2;
  const startupBlink = light.startupSeconds > 0 && Math.floor(light.startupSeconds * 3) % 2 === 0;
  const horizontalColor = startupBlink ? SIGNAL_OFF : signalColor(getTrafficLightSignal(light, 'east'));
  const verticalColor = startupBlink ? SIGNAL_OFF : signalColor(getTrafficLightSignal(light, 'north'));
  const phase = (light.x * 0.17) + (light.y * 0.11);

  graphics.circle(px + center, py + center, 6).fill({ color: MAP_COLORS.shadow, alpha: 0.48 });

  drawSignalDot(graphics, px + center - 13, py + 7, verticalColor, timeSeconds, phase);
  drawSignalDot(graphics, px + center + 13, py + ts - 7, verticalColor, timeSeconds, phase + 0.13);
  drawSignalDot(graphics, px + 7, py + center + 13, horizontalColor, timeSeconds, phase + 0.27);
  drawSignalDot(graphics, px + ts - 7, py + center - 13, horizontalColor, timeSeconds, phase + 0.41);
}


export function drawSignalDot(graphics: Graphics, x: number, y: number, color: number, timeSeconds: number, phase = 0): void {
  const active = color !== SIGNAL_OFF;
  if (active) {
    const glow = pulse(timeSeconds, 0.9, phase);
    graphics.circle(x, y, 6.8 + glow * 1.7).fill({ color, alpha: 0.08 + glow * 0.09 });
  }
  graphics.circle(x, y, 5).fill(SIGNAL_OFF).stroke({ color: MAP_COLORS.laneSoft, width: 1, alpha: 0.65 });
  graphics.circle(x, y, 3.2).fill({ color, alpha: active ? 0.82 + pulse(timeSeconds, 0.7, phase + 0.3) * 0.18 : 1 });
}


export function signalColor(signal: 'green' | 'yellow' | 'red'): number {
  if (signal === 'green') return SIGNAL_GREEN;
  if (signal === 'yellow') return SIGNAL_YELLOW;
  return SIGNAL_RED;
}


export function roadNeighbors(grid: Tile[][], x: number, y: number): RoadConnections {
  const hasRoad = (tx: number, ty: number) => isRoadType(grid[ty]?.[tx]?.type);
  return {
    north: hasRoad(x, y - 1),
    south: hasRoad(x, y + 1),
    east: hasRoad(x + 1, y),
    west: hasRoad(x - 1, y),
  };
}


export function getRoadAutoTileShape(grid: Tile[][], x: number, y: number, type: RoadType): RoadAutoTile {
  const connections = type === 'roundabout'
    ? roadNeighbors(grid, x, y)
    : roadNeighbors(grid, x, y);
  const directions = connectedDirections(connections);
  const count = directions.length;
  const horizontal = connections.east || connections.west;
  const vertical = connections.north || connections.south;
  let shape: RoadAutoTileShape = 'isolated';

  if (type === 'roundabout') shape = 'roundabout';
  else if (count === 0) shape = 'isolated';
  else if (count === 1) shape = 'deadEnd';
  else if (count === 2) shape = horizontal && vertical ? 'corner' : 'straight';
  else if (count === 3) shape = 'tee';
  else shape = 'cross';

  return { shape, connections, directions, count, horizontal, vertical };
}


export function connectedDirections(connections: RoadConnections): RoadDirection[] {
  return (['north', 'south', 'east', 'west'] as RoadDirection[]).filter((direction) => connections[direction]);
}


export function drawRoadShapeLayer(
  graphics: Graphics,
  px: number,
  py: number,
  ts: number,
  halfWidth: number,
  color: number,
  autoTile: RoadAutoTile,
  alpha = 1,
): void {
  const center = ts / 2;
  const width = halfWidth * 2;
  const fill = alpha === 1 ? color : { color, alpha };
  const cornerRadius = Math.min(8, halfWidth * 0.55);
  const centerInset = center - halfWidth;

  if (autoTile.shape === 'isolated') {
    graphics.roundRect(px + centerInset, py + centerInset, width, width, cornerRadius).fill(fill);
    return;
  }

  if (autoTile.connections.west) graphics.rect(px, py + center - halfWidth, center, width).fill(fill);
  if (autoTile.connections.east) graphics.rect(px + center, py + center - halfWidth, center, width).fill(fill);
  if (autoTile.connections.north) graphics.rect(px + center - halfWidth, py, width, center).fill(fill);
  if (autoTile.connections.south) graphics.rect(px + center - halfWidth, py + center, width, center).fill(fill);

  if (autoTile.shape === 'deadEnd') {
    const direction = autoTile.directions[0];
    const cap = halfWidth * 0.5;
    if (direction === 'west') graphics.roundRect(px + center - halfWidth, py + center - halfWidth, width + cap, width, cornerRadius).fill(fill);
    if (direction === 'east') graphics.roundRect(px + center - cap, py + center - halfWidth, width + cap, width, cornerRadius).fill(fill);
    if (direction === 'north') graphics.roundRect(px + center - halfWidth, py + center - halfWidth, width, width + cap, cornerRadius).fill(fill);
    if (direction === 'south') graphics.roundRect(px + center - halfWidth, py + center - cap, width, width + cap, cornerRadius).fill(fill);
    return;
  }

  const centerRadius = autoTile.shape === 'corner' ? cornerRadius : Math.min(5, cornerRadius);
  graphics.roundRect(px + centerInset, py + centerInset, width, width, centerRadius).fill(fill);

  if (autoTile.shape === 'tee' || autoTile.shape === 'cross') {
    graphics.roundRect(px + centerInset - 1, py + centerInset - 1, width + 2, width + 2, 4).fill(fill);
  }
}


export function drawRoadOutline(
  graphics: Graphics,
  px: number,
  py: number,
  ts: number,
  halfWidth: number,
  edgeColor: number,
  autoTile: RoadAutoTile,
): void {
  const center = ts / 2;
  const width = halfWidth * 2;
  const inset = center - halfWidth;
  const alpha = autoTile.shape === 'straight' ? 0.46 : 0.62;
  graphics.roundRect(px + inset, py + inset, width, width, Math.min(7, halfWidth * 0.45))
    .stroke({ color: edgeColor, width: 1, alpha });

  for (const direction of autoTile.directions) {
    if (direction === 'west') graphics.moveTo(px, py + center - halfWidth).lineTo(px + center, py + center - halfWidth).stroke({ color: edgeColor, width: 1, alpha: 0.36 });
    if (direction === 'east') graphics.moveTo(px + center, py + center - halfWidth).lineTo(px + ts, py + center - halfWidth).stroke({ color: edgeColor, width: 1, alpha: 0.36 });
    if (direction === 'north') graphics.moveTo(px + center - halfWidth, py).lineTo(px + center - halfWidth, py + center).stroke({ color: edgeColor, width: 1, alpha: 0.36 });
    if (direction === 'south') graphics.moveTo(px + center - halfWidth, py + center).lineTo(px + center - halfWidth, py + ts).stroke({ color: edgeColor, width: 1, alpha: 0.36 });
  }
}


export function drawLaneMarkings(
  graphics: Graphics,
  px: number,
  py: number,
  ts: number,
  isAvenue: boolean,
  autoTile: RoadAutoTile,
  oneWayDirection?: RoadDirection,
): void {
  const oneWayHorizontal = oneWayDirection === 'east' || oneWayDirection === 'west';
  const oneWayVertical = oneWayDirection === 'north' || oneWayDirection === 'south';
  const horizontal = oneWayDirection ? oneWayHorizontal : autoTile.horizontal;
  const vertical = oneWayDirection ? oneWayVertical : autoTile.vertical;
  const center = ts / 2;
  const hasTrueHorizontalSpan = autoTile.connections.east && autoTile.connections.west;
  const hasTrueVerticalSpan = autoTile.connections.north && autoTile.connections.south;

  if (oneWayDirection) {
    const offsets = isAvenue ? [-10, 0, 10] : [0];
    for (const offset of offsets) {
      if (horizontal) drawDashedLine(graphics, px + 6, py + center + offset - 1, ts - 12, true, MAP_COLORS.laneSoft, isAvenue ? 0.58 : 0.66);
      if (vertical) drawDashedLine(graphics, px + center + offset - 1, py + 6, ts - 12, false, MAP_COLORS.laneSoft, isAvenue ? 0.58 : 0.66);
    }
    return;
  }
  if (hasTrueHorizontalSpan) drawDashedLine(graphics, px + 5, py + center - 1, ts - 10, true, MAP_COLORS.lane);
  else if (horizontal) drawDirectionalLaneSegments(graphics, px, py, ts, autoTile, true, MAP_COLORS.lane);

  if (hasTrueVerticalSpan) drawDashedLine(graphics, px + center - 1, py + 5, ts - 10, false, MAP_COLORS.lane);
  else if (vertical) drawDirectionalLaneSegments(graphics, px, py, ts, autoTile, false, MAP_COLORS.lane);

  if (isAvenue && hasTrueHorizontalSpan) {
    drawDashedLine(graphics, px + 6, py + center - 11, ts - 12, true, MAP_COLORS.laneSoft, 0.52);
    drawDashedLine(graphics, px + 6, py + center + 9, ts - 12, true, MAP_COLORS.laneSoft, 0.52);
  }
  if (isAvenue && hasTrueVerticalSpan) {
    drawDashedLine(graphics, px + center - 11, py + 6, ts - 12, false, MAP_COLORS.laneSoft, 0.52);
    drawDashedLine(graphics, px + center + 9, py + 6, ts - 12, false, MAP_COLORS.laneSoft, 0.52);
  }
}


export function drawDirectionalLaneSegments(
  graphics: Graphics,
  px: number,
  py: number,
  ts: number,
  autoTile: RoadAutoTile,
  horizontal: boolean,
  color: number,
): void {
  const center = ts / 2;
  const alpha = autoTile.shape === 'deadEnd' ? 0.5 : 0.62;
  if (horizontal && autoTile.connections.west) drawDashedLine(graphics, px + 6, py + center - 1, center - 8, true, color, alpha);
  if (horizontal && autoTile.connections.east) drawDashedLine(graphics, px + center + 2, py + center - 1, center - 8, true, color, alpha);
  if (!horizontal && autoTile.connections.north) drawDashedLine(graphics, px + center - 1, py + 6, center - 8, false, color, alpha);
  if (!horizontal && autoTile.connections.south) drawDashedLine(graphics, px + center - 1, py + center + 2, center - 8, false, color, alpha);
}


export function drawDashedLine(graphics: Graphics, x: number, y: number, length: number, horizontal: boolean, color: number, alpha = 0.82): void {
  const dash = 5;
  const gap = 5;
  for (let offset = 0; offset < length; offset += dash + gap) {
    const size = Math.min(dash, length - offset);
    if (horizontal) graphics.rect(x + offset, y, size, 2).fill({ color, alpha });
    else graphics.rect(x, y + offset, 2, size).fill({ color, alpha });
  }
}


export function drawShortDashedSegment(graphics: Graphics, x: number, y: number, direction: Vec2, color: number, alpha: number): void {
  const dash = 4;
  const gap = 3;
  const total = 18;
  const start = -total / 2;
  for (let offset = 0; offset < total; offset += dash + gap) {
    const segmentStart = start + offset;
    const segmentEnd = Math.min(start + total, segmentStart + dash);
    graphics
      .moveTo(x + direction.x * segmentStart, y + direction.y * segmentStart)
      .lineTo(x + direction.x * segmentEnd, y + direction.y * segmentEnd)
      .stroke({ color, width: 1.4, alpha });
  }
}


export function drawOneWayArrow(
  graphics: Graphics,
  x: number,
  y: number,
  ts: number,
  direction: RoadDirection,
  isAvenue: boolean,
  color = MAP_COLORS.lane,
  alpha = 0.78,
): void {
  const cx = x * ts + ts / 2;
  const cy = y * ts + ts / 2;
  const angle = directionAngle(direction);
  const length = isAvenue ? 14 : 11;
  const head = isAvenue ? 5 : 4;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const startX = cx - dx * length * 0.42;
  const startY = cy - dy * length * 0.42;
  const endX = cx + dx * length * 0.42;
  const endY = cy + dy * length * 0.42;

  graphics.moveTo(startX, startY).lineTo(endX, endY).stroke({ color, width: isAvenue ? 2.2 : 2, alpha });
  graphics.poly([
    endX + dx * head, endY + dy * head,
    endX - dx * head * 0.8 + px * head * 0.8, endY - dy * head * 0.8 + py * head * 0.8,
    endX - dx * head * 0.8 - px * head * 0.8, endY - dy * head * 0.8 - py * head * 0.8,
  ]).fill({ color, alpha });
}

