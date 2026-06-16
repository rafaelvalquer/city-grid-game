const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SUFFIX = '.bak-bike-lane-v1';

function filePath(rel) {
  return path.join(ROOT, rel);
}

function exists(rel) {
  return fs.existsSync(filePath(rel));
}

function read(rel) {
  const full = filePath(rel);
  if (!fs.existsSync(full)) throw new Error('Arquivo não encontrado: ' + rel);
  return fs.readFileSync(full, 'utf8');
}

function write(rel, content) {
  const full = filePath(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full)) {
    const backup = full + SUFFIX;
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, fs.readFileSync(full));
  }
  fs.writeFileSync(full, content, 'utf8');
}

function createFile(rel, content) {
  const full = filePath(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full)) {
    const backup = full + SUFFIX;
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, fs.readFileSync(full));
  }
  fs.writeFileSync(full, content, 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addToUnion(content, typeName, literal, label) {
  const re = new RegExp('export type ' + typeName + ' = ([^;]+);');
  const match = content.match(re);
  if (!match) throw new Error('Tipo ' + typeName + ' não encontrado para ' + label + '.');
  if (match[1].includes("'" + literal + "'")) return content;
  const replacement = match[0].replace(';', " | '" + literal + "';");
  return content.replace(match[0], replacement);
}

function addPropertyToTypeBlock(content, typeName, propertyLine, afterProperty) {
  if (content.includes(propertyLine.trim())) return content;
  const re = new RegExp('export type ' + typeName + ' = \\{[\\s\\S]*?\\n\\};');
  const match = content.match(re);
  if (!match) throw new Error('Bloco do tipo ' + typeName + ' não encontrado.');
  const block = match[0];
  const after = '  ' + afterProperty + '\n';
  if (block.includes(after)) {
    return content.replace(block, block.replace(after, after + propertyLine));
  }
  return content.replace(block, block.replace('\n};', '\n' + propertyLine + '};'));
}

function addHistoryField(content, fieldLine) {
  if (content.includes(fieldLine.trim())) return content;
  const re = /export type CityHistorySample = \{[\s\S]*?\n\};/;
  const match = content.match(re);
  if (!match) throw new Error('CityHistorySample não encontrado.');
  let block = match[0];
  const anchor = block.includes('  metroCarsAvoided: number;\n') ? '  metroCarsAvoided: number;\n' : '  carTripsAvoided: number;\n';
  block = block.replace(anchor, anchor + fieldLine);
  return content.replace(match[0], block);
}

function patchCityTypes() {
  const rel = 'src/types/city.types.ts';
  let s = read(rel);

  if (!s.includes('bikeLane?: boolean;')) {
    if (s.includes('  busLane?: boolean;\n')) {
      s = s.replace('  busLane?: boolean;\n', '  busLane?: boolean;\n  bikeLane?: boolean;\n');
    } else {
      s = s.replace('  oneWay?: RoadDirection;\n', '  oneWay?: RoadDirection;\n  bikeLane?: boolean;\n');
    }
  }

  if (!s.includes('export type BikeTripVisual')) {
    const insertAfter = /export type TransitLine = \{[\s\S]*?\n\};/;
    const match = s.match(insertAfter);
    if (!match) throw new Error('TransitLine não encontrado para inserir BikeTripVisual.');
    const bikeType = `

export type BikeTripVisual = {
  id: string;
  route: Vec2[];
  progress: number;
  speed: number;
  originBuildingId: string;
  destinationBuildingId: string;
  createdAtDay: number;
};`;
    s = s.replace(match[0], match[0] + bikeType);
  }

  const statFields = [
    '  bikeLaneTiles: number;\n',
    '  bikeLaneCoverageRatio: number;\n',
    '  bikeTripsCompleted: number;\n',
    '  bikeCarsAvoided: number;\n',
    '  activeBikeTrips: number;\n',
  ];
  for (const field of statFields) {
    if (!s.includes(field.trim())) {
      const marker = s.includes('  metroStations: number;\n') ? '  metroStations: number;\n' : '  cityLevel: number;\n';
      s = s.replace(marker, field + marker);
    }
  }

  for (const field of statFields) s = addHistoryField(s, field);

  if (s.includes("| { kind: 'road';") && !s.includes('bikeLane?: boolean }')) {
    s = s.replace(/\| \{ kind: 'road'; ([^\n]+?) \}/, (whole) => {
      if (whole.includes('bikeLane?: boolean')) return whole;
      let updated = whole.replace(/ \}$/, '; bikeLane?: boolean }');
      if (!updated.includes('busLane?: boolean') && updated.includes('oneWay?: RoadDirection')) {
        updated = updated.replace('oneWay?: RoadDirection', 'oneWay?: RoadDirection; busLane?: boolean');
      }
      return updated;
    });
  }

  write(rel, s);
}

function patchGameTypes() {
  const rel = 'src/types/game.types.ts';
  let s = read(rel);
  s = addToUnion(s, 'Tool', 'bikeLane', 'Tool bikeLane');
  write(rel, s);
}

function patchBikeConfig() {
  createFile('src/game/config/bikeConfig.ts', `export const BIKE_LANE_CONFIG = {
  buildCost: 35,
  removeCostRatio: 0.3,
  coverageRadius: 3,
  maxTripDistance: 9,
  bikeTripChance: 0.42,
  bikeSpeedTilesPerSecond: 2.4,
  visualLifePaddingSeconds: 0.8,
  carAvoidedSatisfactionWeight: 0.02,
  maxActiveBikeVisuals: 80,
  laneColor: 0x2dd4bf,
  laneEdgeColor: 0x99f6e4,
  laneIconColor: 0xecfeff,
  bikeBodyColor: 0x22c55e,
  bikeWheelColor: 0xecfeff,
  bikeTrailColor: 0x22c55e,
} as const;
`);
}

function patchBikePathfinder() {
  createFile('src/game/pathfinding/bikePathfinder.ts', `import type { Tile, Vec2 } from '../../types/city.types';
import { keyOf } from '../city/grid';

function reconstruct(cameFrom: Map<string, string>, current: string): Vec2[] {
  const total = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    total.push(current);
  }
  return total.reverse().map((key) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  });
}

function isBikeLaneTile(grid: Tile[][], pos: Vec2): boolean {
  const tile = grid[pos.y]?.[pos.x];
  return Boolean(tile && tile.type === 'road' && tile.bikeLane);
}

function bikeNeighbors(grid: Tile[][], pos: Vec2): Vec2[] {
  return [
    { x: pos.x + 1, y: pos.y },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x, y: pos.y - 1 },
  ].filter((next) => isBikeLaneTile(grid, next));
}

export function findBikeLanePath(grid: Tile[][], start: Vec2, goal: Vec2): Vec2[] {
  if (!isBikeLaneTile(grid, start) || !isBikeLaneTile(grid, goal)) return [];
  const startKey = keyOf(start.x, start.y);
  const goalKey = keyOf(goal.x, goal.y);
  const queue = [start];
  const visited = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();

  while (queue.length) {
    const current = queue.shift()!;
    const currentKey = keyOf(current.x, current.y);
    if (currentKey === goalKey) return reconstruct(cameFrom, currentKey);

    for (const next of bikeNeighbors(grid, current)) {
      const nextKey = keyOf(next.x, next.y);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      cameFrom.set(nextKey, currentKey);
      queue.push(next);
    }
  }

  return [];
}
`);
}

function patchToolData() {
  const rel = 'src/components/toolData.ts';
  let s = read(rel);
  if (!s.includes('Bike')) {
    s = s.replace(/import \{ ([^}]+) \} from 'lucide-react';/, (full, names) => {
      const parts = names.split(',').map((p) => p.trim());
      if (!parts.includes('Bike')) parts.splice(Math.max(0, parts.indexOf('BusFront') + 1), 0, 'Bike');
      return "import { " + parts.join(', ') + " } from 'lucide-react';";
    });
  }
  if (!s.includes("../game/config/bikeConfig")) {
    s = s.replace("import { METRO_CONFIG } from '../game/config/metroConfig';", "import { METRO_CONFIG } from '../game/config/metroConfig';\nimport { BIKE_LANE_CONFIG } from '../game/config/bikeConfig';");
  }
  if (!s.includes("id: 'bikeLane'")) {
    const busLaneLine = /      \{ id: 'busLane',[^\n]+\},\n/;
    if (busLaneLine.test(s)) {
      s = s.replace(busLaneLine, (line) => line + "      { id: 'bikeLane', label: 'Ciclovia', cost: BIKE_LANE_CONFIG.buildCost, Icon: Bike },\n");
    } else {
      s = s.replace(
        "      { id: 'busStop', label: 'Ponto de ônibus', cost: TRANSIT_CONFIG.busStopCost, Icon: BusFront },\n",
        "      { id: 'busStop', label: 'Ponto de ônibus', cost: TRANSIT_CONFIG.busStopCost, Icon: BusFront },\n      { id: 'bikeLane', label: 'Ciclovia', cost: BIKE_LANE_CONFIG.buildCost, Icon: Bike },\n"
      );
    }
  }
  write(rel, s);
}

function patchStore() {
  const rel = 'src/store/gameStore.ts';
  let s = read(rel);
  const inserts = [
    '  bikeLaneTiles: 0,\n',
    '  bikeLaneCoverageRatio: 0,\n',
    '  bikeTripsCompleted: 0,\n',
    '  bikeCarsAvoided: 0,\n',
    '  activeBikeTrips: 0,\n',
  ];
  for (const line of inserts) {
    if (!s.includes(line.trim())) {
      const marker = s.includes('  metroStations: 0,\n') ? '  metroStations: 0,\n' : '  cityLevel: 1,\n';
      s = s.replace(marker, line + marker);
    }
  }
  write(rel, s);
}

function patchRenderBikes() {
  createFile('src/game/rendering/renderBikes.ts', `import type { Graphics } from 'pixi.js';
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
`);
}

function patchRenderRoads() {
  const rel = 'src/game/rendering/renderRoads.ts';
  let s = read(rel);
  if (!s.includes("../config/bikeConfig")) {
    s = s.replace("import { TRANSIT_CONFIG } from '../config/transitConfig';", "import { TRANSIT_CONFIG } from '../config/transitConfig';\nimport { BIKE_LANE_CONFIG } from '../config/bikeConfig';");
  }
  if (!s.includes('drawBikeLaneMarking(graphics, grid, x, y, ts, autoTile);')) {
    if (s.includes('drawBusLaneMarking(graphics, grid, x, y, ts, type, autoTile);')) {
      s = s.replace('drawBusLaneMarking(graphics, grid, x, y, ts, type, autoTile);', 'drawBusLaneMarking(graphics, grid, x, y, ts, type, autoTile);\n    if (grid[y]?.[x]?.bikeLane) drawBikeLaneMarking(graphics, grid, x, y, ts, autoTile);');
    } else {
      s = s.replace('drawLaneMarkings(graphics, px, py, ts, isAvenue, autoTile, grid[y]?.[x]?.oneWay);', 'drawLaneMarkings(graphics, px, py, ts, isAvenue, autoTile, grid[y]?.[x]?.oneWay);\n    if (grid[y]?.[x]?.bikeLane) drawBikeLaneMarking(graphics, grid, x, y, ts, autoTile);');
    }
  }
  if (!s.includes('export function drawBikeLaneMarking')) {
    const marker = s.includes('export function drawBusLaneMarking') ? '\n\nexport function drawBusLaneMarking' : '\n\nexport function drawRoundaboutIsland';
    const fn = `

export function drawBikeLaneMarking(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number, autoTile: RoadAutoTile): void {
  const tile = grid[y]?.[x];
  if (tile?.type !== 'road' || !tile.bikeLane) return;
  const px = x * ts;
  const py = y * ts;
  const center = ts / 2;
  const horizontal = autoTile.horizontal || (!autoTile.vertical && (autoTile.connections.east || autoTile.connections.west));
  const vertical = autoTile.vertical || (!autoTile.horizontal && (autoTile.connections.north || autoTile.connections.south));
  const laneAlpha = autoTile.shape === 'cross' || autoTile.shape === 'tee' ? 0.68 : 0.92;

  if (horizontal) {
    graphics.roundRect(px + 5, py + center + 9, ts - 10, 4, 2)
      .fill({ color: BIKE_LANE_CONFIG.laneColor, alpha: laneAlpha })
      .stroke({ color: BIKE_LANE_CONFIG.laneEdgeColor, width: 0.7, alpha: 0.72 });
  }
  if (vertical) {
    graphics.roundRect(px + center + 9, py + 5, 4, ts - 10, 2)
      .fill({ color: BIKE_LANE_CONFIG.laneColor, alpha: laneAlpha })
      .stroke({ color: BIKE_LANE_CONFIG.laneEdgeColor, width: 0.7, alpha: 0.72 });
  }

  if ((x + y) % 4 === 0 || autoTile.shape === 'deadEnd') {
    drawTinyBikeLaneIcon(graphics, px + center, py + center, BIKE_LANE_CONFIG.laneIconColor, 0.92);
  }
}

function drawTinyBikeLaneIcon(graphics: Graphics, cx: number, cy: number, color: number, alpha: number): void {
  graphics.circle(cx - 4, cy + 3, 2.1).stroke({ color, width: 1, alpha });
  graphics.circle(cx + 4, cy + 3, 2.1).stroke({ color, width: 1, alpha });
  graphics.moveTo(cx - 4, cy + 3).lineTo(cx, cy - 1).lineTo(cx + 4, cy + 3).lineTo(cx - 1, cy + 3).lineTo(cx - 4, cy + 3)
    .stroke({ color, width: 1.2, alpha });
  graphics.circle(cx, cy - 4.5, 1.35).fill({ color, alpha });
}
`;
    if (!s.includes(marker)) throw new Error('Ponto para inserir drawBikeLaneMarking não encontrado em renderRoads.ts');
    s = s.replace(marker, fn + marker);
  }
  write(rel, s);
}

function patchRenderWorld() {
  const rel = 'src/game/rendering/renderWorld.ts';
  let s = read(rel);
  if (!s.includes("./renderBikes")) {
    s = s.replace("import { renderMetroLayer } from './renderMetro';", "import { renderMetroLayer } from './renderMetro';\nimport { drawBikeTrips } from './renderBikes';");
  }
  if (!s.includes('drawBikeTrips(graphics, world, ts, timeSeconds);')) {
    s = s.replace(
      `  for (const car of world.cars) {
    drawCar(graphics, car, world, ts, timeSeconds, atmosphere);
  }
`,
      `  for (const car of world.cars) {
    drawCar(graphics, car, world, ts, timeSeconds, atmosphere);
  }
  drawBikeTrips(graphics, world, ts, timeSeconds);
`
    );
  }
  write(rel, s);
}

function patchRenderUiOverlays() {
  const rel = 'src/game/rendering/renderUiOverlays.ts';
  let s = read(rel);
  s = s.replace(/tool: 'road' \| 'avenue'( \| 'busLane')?/g, "tool: 'road' | 'avenue' | 'busLane' | 'bikeLane'");
  s = s.replace(/tool: 'road' \| 'avenue' \| 'busLane'/g, "tool: 'road' | 'avenue' | 'busLane' | 'bikeLane'");
  if (!s.includes('const isBikeLanePreview = tool ===')) {
    s = s.replace(
      /const color = preview\.valid \? MAP_COLORS\.previewValid : MAP_COLORS\.previewInvalid;\n\s*const isBusLanePreview = tool === 'busLane';\n\s*const roadColor = preview\.valid \? \(isBusLanePreview \? 0x1d9bf0 : tool === 'avenue' \? MAP_COLORS\.avenue : MAP_COLORS\.road\) : MAP_COLORS\.previewInvalid;\n\s*const roadW = isBusLanePreview \? 13 : tool === 'avenue' \? 32 : 23;/,
      "const color = preview.valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;\n  const isBusLanePreview = tool === 'busLane';\n  const isBikeLanePreview = tool === 'bikeLane';\n  const roadColor = preview.valid ? (isBikeLanePreview ? 0x2dd4bf : isBusLanePreview ? 0x1d9bf0 : tool === 'avenue' ? MAP_COLORS.avenue : MAP_COLORS.road) : MAP_COLORS.previewInvalid;\n  const roadW = isBikeLanePreview ? 8 : isBusLanePreview ? 13 : tool === 'avenue' ? 32 : 23;"
    );
  }
  if (!s.includes('const isBikeLanePreview = tool ===')) {
    s = s.replace(
      /const color = preview\.valid \? MAP_COLORS\.previewValid : MAP_COLORS\.previewInvalid;\n\s*const roadColor = preview\.valid \? \(tool === 'avenue' \? MAP_COLORS\.avenue : MAP_COLORS\.road\) : MAP_COLORS\.previewInvalid;\n\s*const roadW = tool === 'avenue' \? 32 : 23;/,
      "const color = preview.valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;\n  const isBusLanePreview = tool === 'busLane';\n  const isBikeLanePreview = tool === 'bikeLane';\n  const roadColor = preview.valid ? (isBikeLanePreview ? 0x2dd4bf : isBusLanePreview ? 0x1d9bf0 : tool === 'avenue' ? MAP_COLORS.avenue : MAP_COLORS.road) : MAP_COLORS.previewInvalid;\n  const roadW = isBikeLanePreview ? 8 : isBusLanePreview ? 13 : tool === 'avenue' ? 32 : 23;"
    );
  }
  if (!s.includes("tool === 'bikeLane'")) {
    s = s.replace(
      "  } else if (tool === 'busStop') {",
      "  } else if (tool === 'bikeLane') {\n    graphics.roundRect(px + 8, py + ts / 2 + 9, ts - 16, 5, 2).fill({ color: valid ? 0x2dd4bf : MAP_COLORS.previewInvalid, alpha: valid ? 0.82 : 0.36 });\n    graphics.circle(px + ts / 2 - 4, py + ts / 2 + 11, 2).stroke({ color: 0xecfeff, width: 1, alpha: valid ? 0.92 : 0.42 });\n    graphics.circle(px + ts / 2 + 4, py + ts / 2 + 11, 2).stroke({ color: 0xecfeff, width: 1, alpha: valid ? 0.92 : 0.42 });\n  } else if (tool === 'busStop') {"
    );
  }
  write(rel, s);
}

function patchInputController() {
  const rel = 'src/game/rendering/inputController.ts';
  let s = read(rel);
  if (!s.includes("../config/bikeConfig")) {
    s = s.replace("import { METRO_CONFIG } from '../config/metroConfig';", "import { METRO_CONFIG } from '../config/metroConfig';\nimport { BIKE_LANE_CONFIG } from '../config/bikeConfig';");
  }
  s = s.replace(/tool: 'road' \| 'avenue'( \| 'busLane')?;/, (m) => m.includes('bikeLane') ? m : m.replace(';', " | 'bikeLane';"));
  s = s.replace(/tool is 'road' \| 'avenue'( \| 'busLane')?/g, (m) => m.includes('bikeLane') ? m : m + " | 'bikeLane'");
  s = s.replace(/return tool === 'road' \|\| tool === 'avenue'( \|\| tool === 'busLane')?;/, (m) => m.includes("tool === 'bikeLane'") ? m : m.replace(';', " || tool === 'bikeLane';"));
  s = s.replace(/tool: 'road' \| 'avenue'( \| 'busLane')?/g, (m) => m.includes('bikeLane') ? m : m + " | 'bikeLane'");

  if (!s.includes('world.setBikeLaneLine(lineTiles)')) {
    if (s.includes("if (drag.tool === 'busLane') {")) {
      s = s.replace("if (drag.tool === 'busLane') {", "if (drag.tool === 'bikeLane') {\n        const result = world.setBikeLaneLine(lineTiles);\n        if (result.success) emitBikeLaneLineParticles(particles, lineTiles, result.cost);\n        state.setActionFeedback(result.success\n          ? bikeLaneSuccessMessage(result.changed, result.cost, Boolean(result.removed))\n          : result.reason ?? preview.reason ?? 'Não foi possível alterar a ciclovia.');\n        state.setHoverPreview(null);\n      } else if (drag.tool === 'busLane') {");
    } else {
      s = s.replace(
        '      const result = world.buildRoadLine(lineTiles, drag.tool);',
        "      if (drag.tool === 'bikeLane') {\n        const result = world.setBikeLaneLine(lineTiles);\n        if (result.success) emitBikeLaneLineParticles(particles, lineTiles, result.cost);\n        state.setActionFeedback(result.success\n          ? bikeLaneSuccessMessage(result.changed, result.cost, Boolean(result.removed))\n          : result.reason ?? preview.reason ?? 'Não foi possível alterar a ciclovia.');\n        state.setHoverPreview(null);\n        refs.roadLineDragRef.current = null;\n        refs.oneWayLineDragRef.current = null;\n        refs.isDrawingRef.current = false;\n        camera.stopPanning();\n        refs.lastTileRef.current = '';\n        return;\n      }\n      const result = world.buildRoadLine(lineTiles, drag.tool);"
      );
    }
  }

  if (!s.includes('return getBikeLaneBuildPreview(world, uniqueTiles, money);')) {
    if (s.includes("if (tool === 'busLane') return getBusLaneBuildPreview(world, uniqueTiles, money);")) {
      s = s.replace("if (tool === 'busLane') return getBusLaneBuildPreview(world, uniqueTiles, money);", "if (tool === 'busLane') return getBusLaneBuildPreview(world, uniqueTiles, money);\n  if (tool === 'bikeLane') return getBikeLaneBuildPreview(world, uniqueTiles, money);");
    } else {
      s = s.replace('  const invalidTiles: Vec2[] = [];', "  if (tool === 'bikeLane') return getBikeLaneBuildPreview(world, uniqueTiles, money);\n  const invalidTiles: Vec2[] = [];");
    }
  }

  if (!s.includes('function getBikeLaneBuildPreview')) {
    const marker = '\n\nexport function dedupePreviewTiles';
    const fn = `

function getBikeLaneBuildPreview(world: GameWorld, uniqueTiles: Vec2[], money: number): ActionPreview {
  const invalidTiles: Vec2[] = [];
  let reason: string | undefined;
  let eligible = 0;
  let enabled = 0;

  for (const pos of uniqueTiles) {
    if (!inBounds(pos.x, pos.y)) {
      invalidTiles.push(pos);
      reason ??= 'A linha sai do mapa.';
      continue;
    }
    const tile = world.grid[pos.y]?.[pos.x];
    if (!tile || tile.type !== 'road') {
      invalidTiles.push(pos);
      reason ??= 'Ciclovia só pode ser aplicada em ruas.';
      continue;
    }
    eligible += 1;
    if (tile.bikeLane) enabled += 1;
  }

  const remove = eligible > 0 && enabled === eligible;
  const changed = remove ? enabled : eligible - enabled;
  const cost = remove
    ? Math.ceil(changed * BIKE_LANE_CONFIG.buildCost * BIKE_LANE_CONFIG.removeCostRatio)
    : changed * BIKE_LANE_CONFIG.buildCost;

  if (!reason && eligible === 0) reason = 'Nenhuma rua válida selecionada.';
  if (!reason && changed === 0) reason = remove ? 'A ciclovia já está removida.' : 'A ciclovia já existe em todo o trecho.';
  if (!reason && money < cost) reason = 'Faltam $ ' + (cost - money) + ' para ' + (remove ? 'remover' : 'implantar') + ' a ciclovia.';

  return {
    x: uniqueTiles[uniqueTiles.length - 1]?.x ?? 0,
    y: uniqueTiles[uniqueTiles.length - 1]?.y ?? 0,
    label: remove ? 'Remover ciclovia: ' + changed + ' tiles' : 'Ciclovia: ' + changed + ' tiles',
    cost,
    valid: !reason,
    reason,
    tool: 'bikeLane',
    lineTiles: uniqueTiles,
    invalidTiles,
    buildableTiles: changed,
    successMessage: bikeLaneSuccessMessage(changed, cost, remove),
  };
}
`;
    if (!s.includes(marker)) throw new Error('Ponto para inserir getBikeLaneBuildPreview não encontrado.');
    s = s.replace(marker, fn + marker);
  }

  if (!s.includes('function emitBikeLaneLineParticles')) {
    const marker = s.includes('function busLaneSuccessMessage') ? '\n\nfunction busLaneSuccessMessage' : '\n\nfunction roadLineSuccessMessage';
    const fn = `

function emitBikeLaneLineParticles(particles: ParticleSystem | undefined, lineTiles: Vec2[], cost: number): void {
  if (!particles) return;
  const step = Math.max(1, Math.ceil(lineTiles.length / 18));
  for (let i = 0; i < lineTiles.length; i += step) {
    particles.emitRoadDust(lineTiles[i], 5);
  }
  const anchor = lineTiles[lineTiles.length - 1];
  if (anchor && cost > 0) particles.emitMoneyText(anchor, -cost);
}

function bikeLaneSuccessMessage(changed: number, cost: number, removed: boolean): string {
  const tileText = changed + ' tile' + (changed === 1 ? '' : 's');
  return removed
    ? 'Ciclovia removida: ' + tileText + ' por $ ' + cost + '.'
    : 'Ciclovia implantada: ' + tileText + ' por $ ' + cost + '.';
}
`;
    s = s.replace(marker, fn + marker);
  }
  write(rel, s);
}

function patchSimulation() {
  const rel = 'src/game/engine/simulation.ts';
  let s = read(rel);
  if (!s.includes("../config/bikeConfig")) {
    s = s.replace("import { METRO_CONFIG } from '../config/metroConfig';", "import { METRO_CONFIG } from '../config/metroConfig';\nimport { BIKE_LANE_CONFIG } from '../config/bikeConfig';");
  }
  if (!s.includes("../pathfinding/bikePathfinder")) {
    s = s.replace("import { findFastestPath } from '../pathfinding/pathfinder';", "import { findFastestPath } from '../pathfinding/pathfinder';\nimport { findBikeLanePath } from '../pathfinding/bikePathfinder';");
  }
  if (!s.includes('BikeTripVisual')) {
    s = s.replace('TrafficHeatmapSummary, TrafficLightAxis', 'TrafficHeatmapSummary, BikeTripVisual, TrafficLightAxis');
  }
  if (!s.includes('bikeTrips: BikeTripVisual[]')) {
    s = s.replace('  cars: Car[] = [];\n', '  cars: Car[] = [];\n  bikeTrips: BikeTripVisual[] = [];\n');
  }
  if (!s.includes('bikeTripsCompleted = 0;')) {
    s = s.replace('  carTripsAvoided = 0;\n', '  carTripsAvoided = 0;\n  bikeTripsCompleted = 0;\n  bikeCarsAvoided = 0;\n');
  }
  if (!s.includes('this.updateBikeTrips(dt);')) {
    s = s.replace('    this.updateMetro(dt);\n', '    this.updateMetro(dt);\n    this.updateBikeTrips(dt);\n');
  }

  if (!s.includes('const bikeLaneTiles = this.getBikeLaneTileCount();')) {
    s = s.replace(
      '    const averageCongestion = congestions.length ? congestions.reduce((a, b) => a + b, 0) / congestions.length : 0;\n',
      '    const averageCongestion = congestions.length ? congestions.reduce((a, b) => a + b, 0) / congestions.length : 0;\n    const bikeLaneTiles = this.getBikeLaneTileCount();\n'
    );
  }
  const snapshotFields = [
    '      bikeLaneTiles,\n',
    '      bikeLaneCoverageRatio: this.getBikeLaneCoverageRatio(),\n',
    '      bikeTripsCompleted: this.bikeTripsCompleted,\n',
    '      bikeCarsAvoided: this.bikeCarsAvoided,\n',
    '      activeBikeTrips: this.bikeTrips.length,\n',
  ];
  for (const field of snapshotFields) {
    if (!s.includes(field.trim())) {
      const marker = s.includes('      metroStations: this.metroStations.length,\n') ? '      metroStations: this.metroStations.length,\n' : '      cityLevel: this.cityLevel,\n';
      s = s.replace(marker, field + marker);
    }
  }

  const historyFields = [
    '      bikeLaneTiles: snapshot.bikeLaneTiles,\n',
    '      bikeLaneCoverageRatio: snapshot.bikeLaneCoverageRatio,\n',
    '      bikeTripsCompleted: snapshot.bikeTripsCompleted,\n',
    '      bikeCarsAvoided: snapshot.bikeCarsAvoided,\n',
    '      activeBikeTrips: snapshot.activeBikeTrips,\n',
  ];
  for (const field of historyFields) {
    if (!s.includes(field.trim())) {
      const marker = s.includes('      metroTripsCompleted: snapshot.metroTripsCompleted,\n') ? '      metroTripsCompleted: snapshot.metroTripsCompleted,\n' : '      averageCongestion: snapshot.averageCongestion,\n';
      s = s.replace(marker, field + marker);
    }
  }

  if (!s.includes("if (tool === 'bikeLane')")) {
    s = s.replace(
      "    if (tool === 'metroTrack' || tool === 'metroLine') {\n      return false;\n    }\n\n",
      "    if (tool === 'metroTrack' || tool === 'metroLine') {\n      return false;\n    }\n\n    if (tool === 'bikeLane') {\n      return this.toggleBikeLaneAt(x, y).success;\n    }\n\n"
    );
  }

  if (!s.includes('setBikeLaneLine(tiles: Vec2[])')) {
    const marker = '  setOneWayLine(tiles: Vec2[], direction: RoadDirection): { success: boolean; changed: number; reason?: string } {';
    const methods = `  setBikeLaneLine(tiles: Vec2[]): { success: boolean; changed: number; removed?: boolean; cost: number; reason?: string } {
    const uniqueTiles = dedupeTiles(tiles);
    if (!uniqueTiles.length) return { success: false, changed: 0, cost: 0, reason: 'Nenhum tile selecionado.' };

    let eligible = 0;
    let enabled = 0;
    for (const pos of uniqueTiles) {
      if (!inBounds(pos.x, pos.y)) return { success: false, changed: 0, cost: 0, reason: 'A linha sai do mapa.' };
      const tile = this.grid[pos.y]?.[pos.x];
      if (!tile || tile.type !== 'road') return { success: false, changed: 0, cost: 0, reason: 'Ciclovia só pode ser aplicada em ruas.' };
      eligible += 1;
      if (tile.bikeLane) enabled += 1;
    }

    const remove = eligible > 0 && enabled === eligible;
    const changed = remove ? enabled : eligible - enabled;
    if (changed === 0) return { success: false, changed: 0, cost: 0, reason: remove ? 'A ciclovia já está removida.' : 'A ciclovia já existe em todo o trecho.' };
    const cost = remove
      ? Math.ceil(changed * BIKE_LANE_CONFIG.buildCost * BIKE_LANE_CONFIG.removeCostRatio)
      : changed * BIKE_LANE_CONFIG.buildCost;
    if (this.money < cost) return { success: false, changed, cost, reason: 'Faltam $ ' + (cost - this.money) + ' para ' + (remove ? 'remover' : 'implantar') + ' a ciclovia.' };

    for (const pos of uniqueTiles) {
      const tile = this.grid[pos.y][pos.x];
      if (remove) this.grid[pos.y][pos.x] = { ...tile, bikeLane: undefined };
      else if (!tile.bikeLane) this.grid[pos.y][pos.x] = { ...tile, bikeLane: true };
    }

    this.money -= cost;
    this.markStaticRenderDirty();
    this.refreshSelectedRoad();
    this.emit();
    return { success: true, changed, removed: remove, cost };
  }

  toggleBikeLaneAt(x: number, y: number): { success: boolean; enabled?: boolean; cost?: number; reason?: string } {
    const result = this.setBikeLaneLine([{ x, y }]);
    return result.success
      ? { success: true, enabled: !result.removed, cost: result.cost }
      : { success: false, cost: result.cost, reason: result.reason };
  }

` + marker;
    if (!s.includes(marker)) throw new Error('Ponto para inserir setBikeLaneLine não encontrado.');
    s = s.replace(marker, methods);
  }

  if (!s.includes('this.tryCreateBikeTrip(trip.origin, trip.destination)')) {
    s = s.replace(
      "      if (tripDistance < METRO_CONFIG.longTripDistance && this.tryCreateMetroTrip(trip.origin, trip.destination)) {\n        trip.origin.tripsToday += 1;\n        trip.destination.tripsToday += 1;\n        continue;\n      }\n",
      "      if (tripDistance < METRO_CONFIG.longTripDistance && this.tryCreateMetroTrip(trip.origin, trip.destination)) {\n        trip.origin.tripsToday += 1;\n        trip.destination.tripsToday += 1;\n        continue;\n      }\n      if (tripDistance <= BIKE_LANE_CONFIG.maxTripDistance && this.tryCreateBikeTrip(trip.origin, trip.destination)) {\n        trip.origin.tripsToday += 1;\n        trip.destination.tripsToday += 1;\n        continue;\n      }\n"
    );
  }

  if (!s.includes('private tryCreateBikeTrip')) {
    const marker = '  private findNearbyTransitStop(building: Building): TransitStop | undefined {';
    const methods = `  private updateBikeTrips(dt: number): void {
    for (const bike of this.bikeTrips) {
      bike.progress += bike.speed * dt;
    }
    this.bikeTrips = this.bikeTrips.filter((bike) => bike.progress < bike.route.length - 1 + BIKE_LANE_CONFIG.visualLifePaddingSeconds);
  }

  private getBikeLaneTileCount(): number {
    return this.grid.reduce((sum, row) => sum + row.filter((tile) => tile.type === 'road' && tile.bikeLane).length, 0);
  }

  private getBikeLaneCoverageRatio(): number {
    const roadTiles = this.grid.reduce((sum, row) => sum + row.filter((tile) => tile.type === 'road').length, 0);
    return Math.round((this.getBikeLaneTileCount() / Math.max(1, roadTiles)) * 100) / 100;
  }

  private findNearbyBikeLane(building: Building): Vec2 | undefined {
    const candidates: Vec2[] = [];
    for (let y = building.y - BIKE_LANE_CONFIG.coverageRadius; y <= building.y + BIKE_LANE_CONFIG.coverageRadius; y += 1) {
      for (let x = building.x - BIKE_LANE_CONFIG.coverageRadius; x <= building.x + BIKE_LANE_CONFIG.coverageRadius; x += 1) {
        if (!inBounds(x, y)) continue;
        if (Math.abs(building.x - x) + Math.abs(building.y - y) > BIKE_LANE_CONFIG.coverageRadius) continue;
        const tile = this.grid[y]?.[x];
        if (tile?.type === 'road' && tile.bikeLane) candidates.push({ x, y });
      }
    }
    return candidates.sort((a, b) => manhattan(a, building) - manhattan(b, building))[0];
  }

  private tryCreateBikeTrip(origin: Building, destination: Building): boolean {
    const tripDistance = manhattan(origin, destination);
    if (tripDistance > BIKE_LANE_CONFIG.maxTripDistance) return false;
    if (Math.random() > BIKE_LANE_CONFIG.bikeTripChance) return false;

    const originAccess = this.findNearbyBikeLane(origin);
    const destinationAccess = this.findNearbyBikeLane(destination);
    if (!originAccess || !destinationAccess) return false;

    const route = findBikeLanePath(this.grid, originAccess, destinationAccess);
    if (route.length < 2) return false;

    if (this.bikeTrips.length < BIKE_LANE_CONFIG.maxActiveBikeVisuals) {
      this.bikeTrips.push({
        id: nanoid(8),
        route,
        progress: 0,
        speed: BIKE_LANE_CONFIG.bikeSpeedTilesPerSecond,
        originBuildingId: origin.id,
        destinationBuildingId: destination.id,
        createdAtDay: this.time.getDay(),
      });
    }

    this.bikeTripsCompleted += 1;
    this.bikeCarsAvoided += 1;
    this.carTripsAvoided += 1;
    this.completedTrips += 1;
    this.tripHistory.push(Math.max(2, route.length / BIKE_LANE_CONFIG.bikeSpeedTilesPerSecond));
    if (this.tripHistory.length > TRAVEL_TIME_HISTORY_LIMIT) this.tripHistory.shift();
    this.averageTravelTime = this.tripHistory.length ? this.tripHistory.reduce((a, b) => a + b, 0) / this.tripHistory.length : 0;
    return true;
  }

` + marker;
    if (!s.includes(marker)) throw new Error('Ponto para inserir métodos de bicicleta não encontrado.');
    s = s.replace(marker, methods);
  }

  if (!s.includes('bikeLane: tile.bikeLane')) {
    s = s.replace(
      "this.selected = { kind: 'road', x, y, roadType: tile.type as RoadType, traffic: t, trafficLight: this.trafficLights.get(getTrafficLightKey(x, y)), oneWay: tile.oneWay };",
      "this.selected = { kind: 'road', x, y, roadType: tile.type as RoadType, traffic: t, trafficLight: this.trafficLights.get(getTrafficLightKey(x, y)), oneWay: tile.oneWay, busLane: tile.busLane, bikeLane: tile.bikeLane };"
    );
  }

  write(rel, s);
}

function patchAnalyticsPanel() {
  const rel = 'src/components/AnalyticsPanel.tsx';
  let s = read(rel);
  if (!s.includes('Bike')) {
    s = s.replace(/import \{ ([^}]+) \} from 'lucide-react';/, (full, names) => {
      const parts = names.split(',').map((p) => p.trim());
      if (!parts.includes('Bike')) parts.splice(Math.max(0, parts.indexOf('BusFront') + 1), 0, 'Bike');
      return "import { " + parts.join(', ') + " } from 'lucide-react';";
    });
  }
  const emptyFields = [
    '    bikeLaneTiles: 0,\n',
    '    bikeLaneCoverageRatio: 0,\n',
    '    bikeTripsCompleted: 0,\n',
    '    bikeCarsAvoided: 0,\n',
    '    activeBikeTrips: 0,\n',
  ];
  for (const field of emptyFields) {
    if (!s.includes(field.trim())) {
      s = s.replace('    metroTripsCompleted: 0,\n', field + '    metroTripsCompleted: 0,\n');
    }
  }

  if (!s.includes("label: 'Viagens de bicicleta'")) {
    s = s.replace(
      "          { label: 'Carros evitados pelo metrô', value: latest.metroCarsAvoided ?? 0, initial: samples[0].metroCarsAvoided ?? 0 },\n",
      "          { label: 'Carros evitados pelo metrô', value: latest.metroCarsAvoided ?? 0, initial: samples[0].metroCarsAvoided ?? 0 },\n          { label: 'Viagens de bicicleta', value: latest.bikeTripsCompleted ?? 0, initial: samples[0].bikeTripsCompleted ?? 0 },\n          { label: 'Carros evitados por bicicleta', value: latest.bikeCarsAvoided ?? 0, initial: samples[0].bikeCarsAvoided ?? 0 },\n"
    );
  }
  if (!s.includes('<BikeAnalyticsCard world={world} latest={latest} />')) {
    s = s.replace('        <MetroAnalyticsCard world={world} latest={latest} />', '        <BikeAnalyticsCard world={world} latest={latest} />\n        <MetroAnalyticsCard world={world} latest={latest} />');
  }
  if (!s.includes("label: 'Viagens por bicicleta'")) {
    s = s.replace(
      "          { label: 'Viagens por metrô', color: 'accent', values: samples.map((s) => s.metroTripsCompleted ?? 0) },\n          { label: 'Carros evitados', color: 'warn', values: samples.map((s) => s.carTripsAvoided) },",
      "          { label: 'Viagens por metrô', color: 'accent', values: samples.map((s) => s.metroTripsCompleted ?? 0) },\n          { label: 'Viagens por bicicleta', color: 'good', values: samples.map((s) => s.bikeTripsCompleted ?? 0) },\n          { label: 'Carros evitados', color: 'warn', values: samples.map((s) => s.carTripsAvoided) },"
    );
    s = s.replace(
      "          { label: 'Viagens por metrô', color: 'good', values: samples.map((s) => s.metroTripsCompleted ?? 0) },\n          { label: 'Carros evitados', color: 'warn', values: samples.map((s) => s.carTripsAvoided) },",
      "          { label: 'Viagens por metrô', color: 'good', values: samples.map((s) => s.metroTripsCompleted ?? 0) },\n          { label: 'Viagens por bicicleta', color: 'accent', values: samples.map((s) => s.bikeTripsCompleted ?? 0) },\n          { label: 'Carros evitados', color: 'warn', values: samples.map((s) => s.carTripsAvoided) },"
    );
  }
  if (!s.includes('function BikeAnalyticsCard')) {
    const marker = '\n\nfunction MetroAnalyticsCard';
    const fn = `

function BikeAnalyticsCard({ world, latest }: { world: GameWorld; latest: CityHistorySample }) {
  const coverage = Math.round((latest.bikeLaneCoverageRatio ?? 0) * 100);
  return (
    <article className="analytics-card bike-analytics-card">
      <header>
        <h3><Bike size={16} /> Bicicleta</h3>
        <span>{latest.bikeLaneTiles ?? 0} tiles de ciclovia</span>
      </header>
      <div className="metro-analytics-grid">
        <p><span>Viagens de bicicleta</span><strong>{latest.bikeTripsCompleted ?? 0}</strong></p>
        <p><span>Carros evitados</span><strong>{latest.bikeCarsAvoided ?? 0}</strong></p>
        <p><span>Cobertura cicloviária</span><strong>{coverage}%</strong></p>
        <p><span>Bicicletas visuais</span><strong>{latest.activeBikeTrips ?? world.bikeTrips.length}</strong></p>
      </div>
    </article>
  );
}
`;
    if (!s.includes(marker)) throw new Error('Ponto para inserir BikeAnalyticsCard não encontrado.');
    s = s.replace(marker, fn + marker);
  }
  const referenceCases = [
    "    case 'Viagens de bicicleta':\n      return sample.bikeTripsCompleted ?? 0;\n",
    "    case 'Carros evitados por bicicleta':\n      return sample.bikeCarsAvoided ?? 0;\n",
  ];
  for (const c of referenceCases) {
    if (!s.includes(c.trim())) {
      s = s.replace("    case 'Carros evitados pelo metrô':\n      return sample.metroCarsAvoided ?? 0;\n", "    case 'Carros evitados pelo metrô':\n      return sample.metroCarsAvoided ?? 0;\n" + c);
    }
  }
  write(rel, s);
}

function patchDetailsPanel() {
  const rel = 'src/components/DetailsPanel.tsx';
  let s = read(rel);
  if (!s.includes('selected.bikeLane')) {
    s = s.replace(
      "          <p><span>Sentido</span><strong>{selected.oneWay ? oneWayLabel[selected.oneWay] : 'Mão dupla'}</strong></p>",
      "          <p><span>Sentido</span><strong>{selected.oneWay ? oneWayLabel[selected.oneWay] : 'Mão dupla'}</strong></p>\n          <p><span>Ciclovia</span><strong className={selected.bikeLane ? 'good' : ''}>{selected.bikeLane ? 'Ativa' : 'Inativa'}</strong></p>"
    );
  }
  write(rel, s);
}

function validate() {
  const files = [
    'src/types/city.types.ts',
    'src/types/game.types.ts',
    'src/game/engine/simulation.ts',
    'src/game/rendering/inputController.ts',
    'src/game/rendering/renderRoads.ts',
    'src/game/rendering/renderWorld.ts',
    'src/components/AnalyticsPanel.tsx',
  ];
  for (const rel of files) {
    const s = read(rel);
    if (s.includes("'s''") || s.includes("implantar''")) {
      throw new Error('Padrão de string quebrada detectado em ' + rel);
    }
  }
}

function main() {
  patchCityTypes();
  patchGameTypes();
  patchBikeConfig();
  patchBikePathfinder();
  patchToolData();
  patchStore();
  patchRenderBikes();
  patchRenderRoads();
  patchRenderWorld();
  patchRenderUiOverlays();
  patchInputController();
  patchSimulation();
  patchAnalyticsPanel();
  patchDetailsPanel();
  validate();
  console.log('Ciclovia V1 aplicada. Backups com sufixo ' + SUFFIX + '.');
  console.log('Execute: npm run build');
}

main();
