import type { BuildingType, Tile, TileType, VegetationKind } from '../../types/city.types';
import type { CampaignCityId } from '../config/gameSetup';
import type { CampaignBuildingDefinition, CampaignCityDefinition } from './campaignTypes';
import { clearRoadConnections, connectRoadPath, getConnectedRoadNeighbors, setRoadConnection } from '../city/roadConnections';

type Point = { x: number; y: number };

function setTile(grid: Tile[][], x: number, y: number, type: TileType, vegetationKind?: VegetationKind): void {
  if (!grid[y]?.[x]) return;
  const current = grid[y][x];
  if ((current.type === 'road' || current.type === 'avenue' || current.type === 'roundabout')
    && type !== 'road' && type !== 'avenue' && type !== 'roundabout') {
    clearRoadConnections(grid, { x, y });
  }
  const roadConnections = (type === 'road' || type === 'avenue' || type === 'roundabout')
    ? current.roadConnections ?? 0
    : undefined;
  grid[y][x] = { x, y, type, vegetationKind, roadConnections, terrainVariant: Math.abs(x * 31 + y * 17) % 8 };
}

function rect(grid: Tile[][], x0: number, y0: number, x1: number, y1: number, type: TileType): void {
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const organicTerrain = (type === 'lake' || type === 'mountain') && width > 3 && height > 3;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (organicTerrain) {
        const edgeDistance = Math.min(x - x0, x1 - x, y - y0, y1 - y);
        if (edgeDistance === 0 && hash(x, y, width * 17 + height * 31) % 4 === 0) continue;
      }
      setTile(grid, x, y, type);
    }
  }
}

function ellipse(grid: Tile[][], cx: number, cy: number, rx: number, ry: number, type: TileType): void {
  for (let y = cy - ry; y <= cy + ry; y += 1) {
    for (let x = cx - rx; x <= cx + rx; x += 1) {
      const normalized = ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2);
      const edgeNoise = ((hash(x, y, cx * 13 + cy * 29) % 100) - 50) / 420;
      if (normalized <= 1 + edgeNoise) setTile(grid, x, y, type);
    }
  }
}

function roadLine(grid: Tile[][], points: Point[], type: 'road' | 'avenue' = 'road'): void {
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (distance < 8) {
      drawOrthogonalSegment(grid, from, to, type, index);
      continue;
    }
    const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
    const direction = hash(from.x + to.x, from.y + to.y, index * 41) % 2 === 0 ? 1 : -1;
    const bend = Math.max(1, Math.min(2, Math.floor(distance / 13)));
    const first = horizontal
      ? { x: Math.round(from.x + (to.x - from.x) * 0.34), y: from.y + direction * bend }
      : { x: from.x + direction * bend, y: Math.round(from.y + (to.y - from.y) * 0.34) };
    const second = horizontal
      ? { x: Math.round(from.x + (to.x - from.x) * 0.7), y: to.y - direction * Math.max(1, bend - 1) }
      : { x: to.x - direction * Math.max(1, bend - 1), y: Math.round(from.y + (to.y - from.y) * 0.7) };
    drawOrthogonalSegment(grid, from, first, type, index);
    drawOrthogonalSegment(grid, first, second, type, index + 1);
    drawOrthogonalSegment(grid, second, to, type, index + 2);
  }
}

function drawOrthogonalSegment(grid: Tile[][], from: Point, to: Point, type: 'road' | 'avenue', seed: number): void {
  const horizontalFirst = hash(from.x + to.x, from.y + to.y, seed * 67) % 2 === 0;
  const corner = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  drawAxisSegment(grid, from, corner, type);
  drawAxisSegment(grid, corner, to, type);
}

function drawAxisSegment(grid: Tile[][], from: Point, to: Point, type: 'road' | 'avenue'): void {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  setTile(grid, x, y, type);
  let previous = { x, y };
  while (x !== to.x || y !== to.y) {
    x += dx;
    y += dy;
    setTile(grid, x, y, type);
    setRoadConnection(grid, previous, { x, y }, true);
    previous = { x, y };
  }
}

function hash(x: number, y: number, seed: number): number {
  let value = Math.imul(x + seed, 374761393) ^ Math.imul(y - seed, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
}

function organicMap(
  apply: (grid: Tile[][]) => CampaignBuildingDefinition[],
  seed: number,
  disconnectedRoadComponents = 1,
): (grid: Tile[][]) => CampaignBuildingDefinition[] {
  return (grid) => {
    const definitions = apply(grid);
    trimUnusedRoadEnds(grid, definitions, 3);
    ensureBuildingAccess(grid, definitions, seed);
    for (const building of definitions) setTile(grid, building.x, building.y, 'empty');
    guaranteeBuildingFrontages(grid, definitions);
    connectRoadComponents(grid, definitions, seed, disconnectedRoadComponents);
    return definitions;
  };
}

function guaranteeBuildingFrontages(grid: Tile[][], definitions: CampaignBuildingDefinition[]): void {
  const blocked = new Set(definitions.map((building) => `${building.x},${building.y}`));
  for (const building of definitions) {
    if (roadNeighbors(grid, building.x, building.y).some((road) => !blocked.has(`${road.x},${road.y}`))) continue;
    const frontage = [
      { x: building.x, y: building.y + 1 },
      { x: building.x + 1, y: building.y },
      { x: building.x, y: building.y - 1 },
      { x: building.x - 1, y: building.y },
    ].find((point) => grid[point.y]?.[point.x] && !blocked.has(`${point.x},${point.y}`));
    if (frontage) setTile(grid, frontage.x, frontage.y, 'road');
  }
}

function trimUnusedRoadEnds(grid: Tile[][], definitions: CampaignBuildingDefinition[], passes: number): void {
  const protectedTiles = new Set<string>();
  for (const building of definitions) {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      protectedTiles.add(`${building.x + dx},${building.y + dy}`);
    }
  }
  for (let pass = 0; pass < passes; pass += 1) {
    const removals: Point[] = [];
    for (const row of grid) {
      for (const tile of row) {
        if (!isRoad(tile.type) || protectedTiles.has(`${tile.x},${tile.y}`)) continue;
        if (roadNeighbors(grid, tile.x, tile.y).length <= 1) removals.push(tile);
      }
    }
    for (const tile of removals) setTile(grid, tile.x, tile.y, 'empty');
    if (!removals.length) break;
  }
}

function ensureBuildingAccess(grid: Tile[][], definitions: CampaignBuildingDefinition[], seed: number): void {
  const blocked = new Set(definitions.map((building) => `${building.x},${building.y}`));
  for (const building of definitions) {
    if (!grid[building.y]?.[building.x]) continue;
    setTile(grid, building.x, building.y, 'empty');
    if (roadNeighbors(grid, building.x, building.y).some((road) => !blocked.has(`${road.x},${road.y}`))) continue;
    const road = findNearestRoad(grid, building, Number.POSITIVE_INFINITY);
    if (!road) continue;
    const starts = [
      { x: building.x, y: building.y - 1 },
      { x: building.x + 1, y: building.y },
      { x: building.x, y: building.y + 1 },
      { x: building.x - 1, y: building.y },
    ].filter((point) => grid[point.y]?.[point.x] && !blocked.has(`${point.x},${point.y}`));
    const start = starts.sort((a, b) => manhattan(a, road) - manhattan(b, road))[0];
    if (start) {
      setTile(grid, start.x, start.y, 'empty');
      const path = findConnectorPath(grid, start, road, blocked, seed + building.x * 7 + building.y * 11);
      for (const point of path) setTile(grid, point.x, point.y, 'road');
      connectRoadPath(grid, path);
    }
  }
}

function connectRoadComponents(grid: Tile[][], definitions: CampaignBuildingDefinition[], seed: number, targetComponents: number): void {
  const blocked = new Set(definitions.map((building) => `${building.x},${building.y}`));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const components = getRoadComponents(grid);
    if (components.length <= targetComponents) return;
    const origin = components[0];
    let best: { from: Point; to: Point; distance: number } | undefined;
    for (const target of components.slice(1)) {
      for (const from of origin) {
        for (const to of target) {
          const distance = manhattan(from, to);
          if (!best || distance < best.distance) best = { from, to, distance };
        }
      }
    }
    if (!best) return;
    const path = findConnectorPath(grid, best.from, best.to, blocked, seed + attempt);
    for (const point of path) setTile(grid, point.x, point.y, 'road');
    connectRoadPath(grid, path);
  }
}

function findConnectorPath(grid: Tile[][], from: Point, to: Point, blocked: Set<string>, seed: number): Point[] {
  const queue = [from];
  const visited = new Set([`${from.x},${from.y}`]);
  const previous = new Map<string, string>();
  const directions = hash(from.x, from.y, seed) % 2 === 0
    ? [[1, 0], [0, 1], [-1, 0], [0, -1]]
    : [[0, 1], [1, 0], [0, -1], [-1, 0]];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    if (current.x === to.x && current.y === to.y) break;
    for (const [dx, dy] of directions) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = `${next.x},${next.y}`;
      if (!grid[next.y]?.[next.x] || visited.has(key) || blocked.has(key)) continue;
      visited.add(key);
      previous.set(key, `${current.x},${current.y}`);
      queue.push(next);
    }
  }
  const targetKey = `${to.x},${to.y}`;
  if (!visited.has(targetKey)) return [];
  const path: Point[] = [];
  let key = targetKey;
  while (key !== `${from.x},${from.y}`) {
    const [x, y] = key.split(',').map(Number);
    path.push({ x, y });
    key = previous.get(key) ?? `${from.x},${from.y}`;
  }
  path.push(from);
  return path.reverse();
}

function getRoadComponents(grid: Tile[][]): Point[][] {
  const remaining = new Set(grid.flat().filter((tile) => isRoad(tile.type)).map((tile) => `${tile.x},${tile.y}`));
  const components: Point[][] = [];
  while (remaining.size) {
    const firstKey = remaining.values().next().value as string;
    const [x, y] = firstKey.split(',').map(Number);
    const queue = [{ x, y }];
    const component: Point[] = [];
    remaining.delete(firstKey);
    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      component.push(current);
      for (const next of getConnectedRoadNeighbors(grid, current)) {
        const key = `${next.x},${next.y}`;
        if (!remaining.delete(key)) continue;
        queue.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function findNearestRoad(grid: Tile[][], point: Point, maxDistance: number): Point | undefined {
  return grid.flat()
    .filter((tile) => isRoad(tile.type) && manhattan(tile, point) <= maxDistance)
    .sort((a, b) => manhattan(a, point) - manhattan(b, point))[0];
}

function roadNeighbors(grid: Tile[][], x: number, y: number): Point[] {
  return [
    grid[y - 1]?.[x],
    grid[y]?.[x + 1],
    grid[y + 1]?.[x],
    grid[y]?.[x - 1],
  ].filter((tile): tile is Tile => Boolean(tile && isRoad(tile.type)));
}

function isRoad(type: TileType): type is 'road' | 'avenue' {
  return type === 'road' || type === 'avenue';
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function vegetation(grid: Tile[][], kind: VegetationKind, predicate: (x: number, y: number) => boolean): void {
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < (grid[y]?.length ?? 0); x += 1) {
      const tile = grid[y][x];
      if (tile.type === 'empty' && predicate(x, y)) tile.vegetationKind = kind;
    }
  }
}

function buildings(items: Array<[number, number, BuildingType]>): CampaignBuildingDefinition[] {
  return items.map(([x, y, type]) => ({ x, y, type }));
}

function applyRio(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 34, 0, 39, 29, 'lake');
  ellipse(grid, 30, 23, 8, 5, 'lake');
  ellipse(grid, 7, 8, 5, 7, 'mountain');
  ellipse(grid, 21, 4, 6, 4, 'mountain');
  ellipse(grid, 17, 19, 4, 6, 'mountain');
  roadLine(grid, [{ x: 2, y: 15 }, { x: 32, y: 15 }], 'avenue');
  roadLine(grid, [{ x: 25, y: 8 }, { x: 25, y: 27 }], 'avenue');
  roadLine(grid, [{ x: 11, y: 11 }, { x: 20, y: 11 }]);
  vegetation(grid, 'atlanticForest', (x, y) => x < 24 && (x + y) % 3 !== 0);
  vegetation(grid, 'palm', (x, y) => x > 24 && y > 18 && (x + y) % 2 === 0);
  return buildings([[12,14,'house'],[14,14,'house'],[18,14,'shop'],[22,14,'office'],[27,14,'shop'],[29,14,'house'],[24,10,'office'],[26,10,'house'],[24,18,'shop'],[26,18,'house'],[30,18,'office'],[31,10,'house']]);
}

function applyVancouver(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 0, 0, 39, 3, 'lake');
  rect(grid, 0, 25, 39, 29, 'lake');
  rect(grid, 0, 4, 4, 24, 'lake');
  ellipse(grid, 31, 7, 9, 4, 'mountain');
  ellipse(grid, 16, 5, 6, 3, 'mountain');
  ellipse(grid, 10, 18, 3, 3, 'lake');
  roadLine(grid, [{ x: 6, y: 12 }, { x: 37, y: 12 }], 'avenue');
  roadLine(grid, [{ x: 20, y: 5 }, { x: 20, y: 24 }], 'avenue');
  roadLine(grid, [{ x: 20, y: 17 }, { x: 34, y: 17 }]);
  vegetation(grid, 'temperateConifer', (x, y) => y < 12 || x < 13);
  vegetation(grid, 'fern', (x, y) => (x * 3 + y) % 5 === 0);
  return buildings([[8,11,'house'],[12,11,'house'],[16,11,'shop'],[19,11,'office'],[21,11,'office'],[24,11,'shop'],[28,11,'house'],[20,16,'shop'],[22,16,'house'],[26,16,'office'],[28,16,'house'],[35,16,'shop']]);
}

function applyAmsterdam(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 0, 0, 39, 2, 'lake');
  rect(grid, 0, 27, 39, 29, 'lake');
  for (const y of [7, 12, 18, 23]) {
    for (let x = 3; x <= 36; x += 1) if (![9, 20, 31].includes(x)) setTile(grid, x, y, 'lake');
  }
  roadLine(grid, [{ x: 2, y: 15 }, { x: 37, y: 15 }], 'avenue');
  roadLine(grid, [{ x: 2, y: 25 }, { x: 37, y: 25 }], 'avenue');
  for (const x of [9, 31]) roadLine(grid, [{ x, y: 3 }, { x, y: 26 }], 'road');
  vegetation(grid, 'deciduous', (x, y) => (x + y * 2) % 7 === 0);
  vegetation(grid, 'willow', (x, y) => [6,8,11,13,17,19,22,24].includes(y) && x % 5 === 0);
  vegetation(grid, 'reeds', (x, y) => (y === 3 || y === 26) && x % 3 === 0);
  return buildings([[5,4,'house'],[8,4,'shop'],[10,4,'house'],[14,4,'office'],[19,4,'shop'],[21,4,'house'],[25,4,'office'],[30,4,'shop'],[32,4,'house'],[8,14,'house'],[10,14,'shop'],[19,14,'office'],[21,14,'house'],[30,14,'shop'],[32,14,'office'],[8,24,'house'],[10,24,'shop'],[19,24,'house'],[21,24,'office'],[30,24,'shop'],[32,24,'house']]);
}

function applyCapeTown(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 0, 24, 39, 29, 'lake');
  rect(grid, 0, 0, 3, 23, 'lake');
  rect(grid, 18, 2, 26, 7, 'mountain');
  rect(grid, 20, 8, 24, 13, 'mountain');
  ellipse(grid, 10, 7, 4, 5, 'mountain');
  roadLine(grid, [{ x: 5, y: 17 }, { x: 38, y: 17 }], 'avenue');
  roadLine(grid, [{ x: 29, y: 5 }, { x: 29, y: 23 }], 'avenue');
  roadLine(grid, [{ x: 6, y: 21 }, { x: 18, y: 21 }]);
  vegetation(grid, 'fynbos', (x, y) => (x + y) % 2 === 0);
  vegetation(grid, 'protea', (x, y) => x > 16 && y < 16 && (x * 2 + y) % 5 === 0);
  return buildings([[6,16,'house'],[9,16,'shop'],[13,16,'house'],[16,16,'office'],[27,16,'shop'],[30,16,'office'],[33,16,'house'],[36,16,'shop'],[14,20,'house'],[16,20,'shop'],[28,20,'office'],[30,20,'house'],[34,20,'shop'],[36,20,'house']]);
}

function applyCopenhagen(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 0, 0, 39, 2, 'lake');
  rect(grid, 0, 27, 39, 29, 'lake');
  for (const y of [9, 20]) rect(grid, 2, y, 37, y, 'lake');
  rect(grid, 16, 3, 18, 26, 'lake');
  for (const y of [5, 14]) roadLine(grid, [{ x: 2, y }, { x: 37, y }], y === 14 ? 'avenue' : 'road');
  for (const x of [8, 25]) roadLine(grid, [{ x, y: 3 }, { x, y: 26 }], x === 25 ? 'avenue' : 'road');
  vegetation(grid, 'willow', (x, y) => (x + y) % 7 === 0);
  vegetation(grid, 'reeds', (x, y) => ([3, 8, 10, 19, 21, 26].includes(y) || [15, 19].includes(x)) && (x + y) % 3 === 0);
  vegetation(grid, 'deciduous', (x, y) => (x * 2 + y) % 11 === 0);
  return buildings([[4,4,'house'],[7,4,'shop'],[9,4,'house'],[13,4,'office'],[24,4,'shop'],[26,4,'house'],[32,4,'office'],[5,13,'house'],[7,13,'shop'],[9,13,'house'],[22,13,'office'],[24,13,'shop'],[26,13,'house'],[33,13,'office'],[5,23,'house'],[7,23,'shop'],[9,23,'house'],[22,23,'office'],[24,23,'shop'],[26,23,'house'],[33,23,'office']]);
}

function applyBogota(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 0, 0, 3, 29, 'mountain');
  rect(grid, 36, 0, 39, 29, 'mountain');
  ellipse(grid, 7, 4, 4, 3, 'mountain');
  ellipse(grid, 31, 25, 4, 3, 'mountain');
  for (const y of [6, 14]) roadLine(grid, [{ x: 5, y }, { x: 34, y }], y === 14 ? 'avenue' : 'road');
  for (const x of [10, 20]) roadLine(grid, [{ x, y: 4 }, { x, y: 25 }], x === 20 ? 'avenue' : 'road');
  vegetation(grid, 'andeanForest', (x, y) => (x < 10 || x > 29) && (x + y) % 2 === 0);
  vegetation(grid, 'paramoShrub', (x, y) => (x * 3 + y) % 9 === 0);
  return buildings([[6,5,'house'],[9,5,'shop'],[11,5,'house'],[16,5,'office'],[19,5,'shop'],[21,5,'house'],[28,5,'office'],[30,5,'house'],[6,13,'house'],[9,13,'shop'],[11,13,'house'],[16,13,'office'],[19,13,'shop'],[21,13,'house'],[28,13,'office'],[30,13,'shop'],[7,21,'house'],[9,21,'shop'],[11,21,'house'],[17,21,'office'],[19,21,'shop'],[21,21,'house'],[28,21,'office'],[30,21,'house']]);
}

function applySeoul(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 0, 14, 39, 16, 'lake');
  ellipse(grid, 4, 5, 4, 5, 'mountain');
  ellipse(grid, 35, 6, 4, 5, 'mountain');
  ellipse(grid, 34, 25, 5, 3, 'mountain');
  for (const y of [12, 19]) roadLine(grid, [{ x: 6, y }, { x: 33, y }], 'avenue');
  for (const x of [10, 20]) roadLine(grid, [{ x, y: 3 }, { x, y: 27 }], x === 20 ? 'avenue' : 'road');
  vegetation(grid, 'koreanPine', (x, y) => (x < 9 || x > 30) && (x + y) % 2 === 0);
  vegetation(grid, 'cherryTree', (x, y) => [6, 8, 11, 13, 18, 20, 23, 25].includes(y) && x % 5 === 0);
  return buildings([[7,6,'house'],[9,6,'shop'],[11,6,'house'],[16,6,'office'],[19,6,'shop'],[21,6,'office'],[28,6,'house'],[30,6,'shop'],[7,11,'house'],[9,11,'shop'],[11,11,'house'],[17,11,'office'],[19,11,'shop'],[21,11,'office'],[28,11,'house'],[30,11,'shop'],[7,18,'house'],[9,18,'shop'],[11,18,'house'],[17,18,'office'],[19,18,'shop'],[21,18,'office'],[28,18,'house'],[30,18,'shop'],[7,23,'house'],[9,23,'shop'],[11,23,'house'],[17,23,'office'],[19,23,'shop'],[21,23,'office'],[28,23,'house'],[30,23,'shop']]);
}

function applySingapore(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 0, 0, 39, 2, 'lake');
  rect(grid, 0, 27, 39, 29, 'lake');
  rect(grid, 0, 3, 3, 26, 'lake');
  rect(grid, 36, 3, 39, 26, 'lake');
  ellipse(grid, 8, 8, 3, 4, 'lake');
  ellipse(grid, 29, 21, 4, 3, 'lake');
  for (const y of [6, 14]) roadLine(grid, [{ x: 5, y }, { x: 34, y }], y === 14 ? 'avenue' : 'road');
  for (const x of [13, 22]) roadLine(grid, [{ x, y: 4 }, { x, y: 25 }], x === 22 ? 'avenue' : 'road');
  vegetation(grid, 'tropicalRainforest', (x, y) => (x < 13 || y > 19) && (x * 2 + y) % 4 === 0);
  vegetation(grid, 'mangrove', (x, y) => (x < 6 || x > 33 || y < 5 || y > 24) && (x + y) % 2 === 0);
  vegetation(grid, 'palm', (x, y) => (x * 5 + y) % 17 === 0);
  return buildings([[6,5,'house'],[12,5,'shop'],[14,5,'house'],[18,5,'office'],[21,5,'shop'],[23,5,'office'],[31,5,'house'],[33,5,'shop'],[6,13,'house'],[12,13,'shop'],[14,13,'house'],[18,13,'office'],[21,13,'shop'],[23,13,'office'],[31,13,'house'],[33,13,'shop'],[6,22,'house'],[12,22,'shop'],[14,22,'house'],[18,22,'office'],[21,22,'shop'],[23,22,'office'],[31,22,'house'],[33,22,'shop']]);
}

function applyCuritiba(grid: Tile[][]): CampaignBuildingDefinition[] {
  ellipse(grid, 6, 6, 4, 3, 'lake');
  ellipse(grid, 33, 23, 4, 3, 'lake');
  for (const y of [11, 18]) roadLine(grid, [{ x: 2, y }, { x: 37, y }], 'avenue');
  roadLine(grid, [{ x: 20, y: 2 }, { x: 20, y: 27 }], 'avenue');
  vegetation(grid, 'araucaria', (x, y) => (x < 9 || x > 31 || y < 5 || y > 24) && (x + y) % 3 === 0);
  vegetation(grid, 'formalGarden', (x, y) => x > 13 && x < 27 && y > 7 && y < 22 && (x * 3 + y) % 13 === 0);
  return buildings([[11,4,'house'],[14,4,'shop'],[19,4,'office'],[21,4,'office'],[26,4,'shop'],[29,4,'house'],[9,10,'house'],[11,10,'shop'],[16,10,'office'],[19,10,'shop'],[21,10,'office'],[26,10,'house'],[29,10,'shop'],[9,17,'house'],[11,17,'shop'],[16,17,'office'],[19,17,'shop'],[21,17,'office'],[26,17,'house'],[29,17,'shop'],[11,23,'house'],[14,23,'shop'],[19,23,'office'],[21,23,'office'],[26,23,'shop'],[29,23,'house']]);
}

function applyParis(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 0, 14, 39, 16, 'lake');
  for (const x of [15, 24]) roadLine(grid, [{ x, y: 3 }, { x, y: 26 }], 'avenue');
  for (const y of [10, 18, 25]) roadLine(grid, [{ x: 2, y }, { x: 37, y }], y === 18 ? 'avenue' : 'road');
  vegetation(grid, 'planeTree', (x, y) => [4, 6, 9, 11, 19, 21, 24, 26].includes(y) && x % 4 === 0);
  vegetation(grid, 'formalGarden', (x, y) => ((x > 16 && x < 23 && y > 5 && y < 11) || (x > 27 && y > 20)) && (x + y) % 3 === 0);
  return buildings([[3,4,'house'],[6,4,'shop'],[8,4,'house'],[14,4,'office'],[16,4,'shop'],[23,4,'office'],[25,4,'shop'],[32,4,'house'],[34,4,'shop'],[3,9,'house'],[6,9,'shop'],[8,9,'house'],[14,9,'office'],[25,9,'office'],[32,9,'house'],[34,9,'shop'],[3,19,'house'],[6,19,'shop'],[8,19,'house'],[14,19,'office'],[16,19,'shop'],[23,19,'office'],[25,19,'shop'],[32,19,'house'],[34,19,'shop'],[3,24,'house'],[6,24,'shop'],[14,24,'office'],[25,24,'office'],[32,24,'house'],[34,24,'shop']]);
}

function applyTokyo(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 0, 14, 39, 16, 'lake');
  for (const x of [10, 30]) roadLine(grid, [{ x, y: 2 }, { x, y: 27 }], 'avenue');
  for (const y of [8, 12, 18]) roadLine(grid, [{ x: 2, y }, { x: 37, y }], y === 12 || y === 18 ? 'avenue' : 'road');
  vegetation(grid, 'ginkgo', (x, y) => (x + y * 2) % 17 === 0);
  vegetation(grid, 'cherryTree', (x, y) => [13, 17].includes(y) && x % 5 === 0);
  return buildings([[3,3,'house'],[6,3,'shop'],[9,3,'office'],[11,3,'office'],[16,3,'shop'],[19,3,'office'],[21,3,'office'],[26,3,'shop'],[29,3,'office'],[31,3,'house'],[35,3,'shop'],[3,7,'house'],[6,7,'shop'],[9,7,'office'],[11,7,'office'],[16,7,'shop'],[19,7,'office'],[21,7,'office'],[26,7,'shop'],[29,7,'office'],[31,7,'house'],[35,7,'shop'],[3,11,'house'],[6,11,'shop'],[9,11,'office'],[11,11,'office'],[16,11,'shop'],[19,11,'office'],[21,11,'office'],[26,11,'shop'],[29,11,'office'],[31,11,'house'],[35,11,'shop'],[3,17,'house'],[6,17,'shop'],[9,17,'office'],[11,17,'office'],[16,17,'shop'],[19,17,'office'],[21,17,'office'],[26,17,'shop'],[29,17,'office'],[31,17,'house'],[35,17,'shop'],[3,21,'house'],[6,21,'shop'],[9,21,'office'],[11,21,'office'],[16,21,'shop'],[19,21,'office'],[21,21,'office'],[26,21,'shop'],[29,21,'office'],[31,21,'house'],[35,21,'shop']]);
}

function applyHongKong(grid: Tile[][]): CampaignBuildingDefinition[] {
  rect(grid, 13, 0, 23, 29, 'lake');
  rect(grid, 24, 12, 39, 17, 'mountain');
  ellipse(grid, 5, 4, 4, 3, 'mountain');
  ellipse(grid, 7, 25, 4, 3, 'mountain');
  for (const y of [9, 14, 20]) roadLine(grid, [{ x: 2, y }, { x: 11, y }], y === 14 ? 'avenue' : 'road');
  for (const x of [4, 9]) roadLine(grid, [{ x, y: 7 }, { x, y: 22 }], x === 9 ? 'avenue' : 'road');
  for (const y of [5, 10]) roadLine(grid, [{ x: 25, y }, { x: 37, y }], y === 10 ? 'avenue' : 'road');
  for (const x of [28, 34]) roadLine(grid, [{ x, y: 3 }, { x, y: 11 }], x === 34 ? 'avenue' : 'road');
  for (const y of [20, 25]) roadLine(grid, [{ x: 25, y }, { x: 37, y }], y === 20 ? 'avenue' : 'road');
  for (const x of [28, 34]) roadLine(grid, [{ x, y: 18 }, { x, y: 27 }], x === 34 ? 'avenue' : 'road');
  vegetation(grid, 'banyan', (x, y) => (x < 13 || x > 23) && (x + y) % 5 === 0);
  vegetation(grid, 'tropicalRainforest', (x, y) => (x < 13 || x > 23) && (x * 2 + y) % 7 === 0);
  return buildings([[3,8,'house'],[5,8,'shop'],[8,8,'office'],[10,8,'house'],[3,13,'house'],[5,13,'shop'],[8,13,'office'],[10,13,'shop'],[3,19,'house'],[5,19,'shop'],[8,19,'office'],[10,19,'house'],[26,4,'house'],[27,4,'shop'],[29,4,'office'],[33,4,'shop'],[35,4,'house'],[26,9,'house'],[27,9,'shop'],[29,9,'office'],[33,9,'shop'],[35,9,'house'],[26,19,'house'],[27,19,'shop'],[29,19,'office'],[33,19,'shop'],[35,19,'house'],[26,24,'house'],[27,24,'shop'],[29,24,'office'],[33,24,'shop'],[35,24,'house']]);
}

function requirement(
  metric: import('./campaignTypes').CampaignObjectiveMetric,
  comparator: 'min' | 'max',
  target: number,
  label: string,
  unit?: '%' | 'tiles' | 'viagens' | 's' | 'zonas',
) {
  return { metric, comparator, target, label, unit };
}

const minObjective = (id: string, label: string, metric: import('./campaignTypes').CampaignObjectiveMetric, target: number, unit?: '%' | 'tiles' | 'viagens' | 's' | 'zonas') => ({
  id,
  label,
  description: `${label}: ${target}${unit === '%' ? '%' : unit ? ` ${unit}` : ''} ou mais`,
  requirements: [requirement(metric, 'min', target, label, unit)],
});

const maxObjective = (id: string, label: string, metric: import('./campaignTypes').CampaignObjectiveMetric, target: number, unit?: '%') => ({
  id,
  label,
  description: `${label}: no máximo ${target}${unit ?? ''}`,
  requirements: [requirement(metric, 'max', target, label, unit)],
});

const LEGACY_LEVEL_1_CITIES = [
  { id: 'rio', name: 'Rio de Janeiro', country: 'Brasil', description: 'Conecte bairros entre maciços, lagoas e a Baía de Guanabara.', biome: 'Mata Atlântica tropical', accent: '#35d07f', vegetation: ['atlanticForest', 'palm'], mission: { population: 220, satisfaction: 75, maxTraffic: 45, holdSeconds: 30 }, applyMap: applyRio },
  { id: 'vancouver', name: 'Vancouver', country: 'Canadá', description: 'Planeje uma península costeira entre floresta temperada e montanhas.', biome: 'Floresta temperada costeira', accent: '#5cc8ff', vegetation: ['temperateConifer', 'fern'], mission: { population: 280, satisfaction: 82, maxTraffic: 35, holdSeconds: 30 }, applyMap: applyVancouver },
  { id: 'amsterdam', name: 'Amsterdã', country: 'Países Baixos', description: 'Faça a cidade crescer entre canais, ilhas e corredores estreitos.', biome: 'Planície úmida temperada', accent: '#f6c244', vegetation: ['deciduous', 'willow', 'reeds'], mission: { population: 340, satisfaction: 78, maxTraffic: 30, holdSeconds: 30 }, applyMap: applyAmsterdam },
  { id: 'cape-town', name: 'Cidade do Cabo', country: 'África do Sul', description: 'Supere a costa e o maciço da Table Mountain sem colapsar o trânsito.', biome: 'Fynbos mediterrâneo', accent: '#ff7a4f', vegetation: ['fynbos', 'protea'], mission: { population: 300, satisfaction: 80, maxTraffic: 38, holdSeconds: 30 }, applyMap: applyCapeTown },
];

const LEVEL_1_CITIES: CampaignCityDefinition[] = LEGACY_LEVEL_1_CITIES.map((city) => ({
  ...city,
  id: city.id as CampaignCityId,
  vegetation: city.vegetation as VegetationKind[],
  campaignLevel: 1,
  startingMoney: 1000,
  mission: {
    holdSeconds: city.mission.holdSeconds,
    objectives: [
      minObjective('population', 'População', 'population', city.mission.population),
      minObjective('satisfaction', 'Satisfação', 'satisfaction', city.mission.satisfaction, '%'),
      maxObjective('traffic', 'Trânsito', 'averageCongestion', city.mission.maxTraffic, '%'),
    ],
  },
  applyMap: organicMap(city.applyMap, city.id.length * 101),
}));

const LEVEL_2_CITIES: CampaignCityDefinition[] = [
  { id: 'copenhagen', name: 'Copenhague', country: 'Dinamarca', description: 'Transforme ilhas e canais em uma cidade onde a bicicleta é a primeira escolha.', biome: 'Arquipélago temperado', accent: '#55e6c1', vegetation: ['deciduous', 'willow', 'reeds'], campaignLevel: 2, startingMoney: 2000, featuredObjectives: ['bike'], mission: { holdSeconds: 45, objectives: [
    minObjective('population', 'População', 'population', 420),
    { id: 'bike-network', label: 'Cidade ciclável', description: '30 tiles e 25 viagens de bicicleta', requirements: [requirement('bikeLaneTiles', 'min', 30, 'Ciclovias', 'tiles'), requirement('bikeTripsCompleted', 'min', 25, 'Viagens de bicicleta', 'viagens')] },
    minObjective('satisfaction', 'Satisfação', 'satisfaction', 82, '%'),
    maxObjective('traffic', 'Trânsito', 'averageCongestion', 28, '%'),
  ] }, applyMap: organicMap(applyCopenhagen, 211) },
  { id: 'bogota', name: 'Bogotá', country: 'Colômbia', description: 'Estruture corredores de ônibus de alta capacidade entre os Andes e o planalto.', biome: 'Planalto andino', accent: '#ef5350', vegetation: ['andeanForest', 'paramoShrub'], campaignLevel: 2, startingMoney: 4000, featuredObjectives: ['bus'], mission: { holdSeconds: 45, objectives: [
    minObjective('population', 'População', 'population', 460),
    { id: 'brt-network', label: 'Corredor BRT', description: '24 tiles, 3 ônibus e 50 viagens', requirements: [requirement('busLaneTiles', 'min', 24, 'Corredores', 'tiles'), requirement('activeBuses', 'min', 3, 'Ônibus'), requirement('busTripsCompleted', 'min', 50, 'Viagens de ônibus', 'viagens')] },
    minObjective('satisfaction', 'Satisfação', 'satisfaction', 78, '%'),
    maxObjective('traffic', 'Trânsito', 'averageCongestion', 32, '%'),
  ] }, applyMap: organicMap(applyBogota, 307) },
  { id: 'seoul', name: 'Seul', country: 'Coreia do Sul', description: 'Una os dois lados do Rio Han com uma rede de metrô densa e eficiente.', biome: 'Vale fluvial temperado', accent: '#9b8cff', vegetation: ['koreanPine', 'cherryTree'], campaignLevel: 2, startingMoney: 5500, featuredObjectives: ['metro'], mission: { holdSeconds: 45, objectives: [
    minObjective('population', 'População', 'population', 520),
    { id: 'metro-network', label: 'Metrô metropolitano', description: '4 estações, 1 linha e 40 viagens', requirements: [requirement('metroStations', 'min', 4, 'Estações'), requirement('metroLines', 'min', 1, 'Linhas'), requirement('metroTripsCompleted', 'min', 40, 'Viagens de metrô', 'viagens')] },
    minObjective('satisfaction', 'Satisfação', 'satisfaction', 82, '%'),
    maxObjective('traffic', 'Trânsito', 'averageCongestion', 25, '%'),
  ] }, applyMap: organicMap(applySeoul, 401) },
  { id: 'singapore', name: 'Singapura', country: 'Singapura', description: 'Crie um hub aéreo tropical conectado a uma cidade compacta e produtiva.', biome: 'Ilha tropical úmida', accent: '#ff9f43', vegetation: ['tropicalRainforest', 'mangrove', 'palm'], campaignLevel: 2, startingMoney: 8000, featuredObjectives: ['air'], mission: { holdSeconds: 45, objectives: [
    minObjective('population', 'População', 'population', 500),
    { id: 'air-hub', label: 'Hub aéreo', description: '2 helipontos, 1 linha, 2 aeronaves e 12 viagens', requirements: [requirement('helipads', 'min', 2, 'Helipontos'), requirement('helicopterLines', 'min', 1, 'Linhas aéreas'), requirement('helicopters', 'min', 2, 'Aeronaves'), requirement('helicopterTripsCompleted', 'min', 12, 'Viagens aéreas', 'viagens')] },
    minObjective('satisfaction', 'Satisfação', 'satisfaction', 84, '%'),
    maxObjective('traffic', 'Trânsito', 'averageCongestion', 25, '%'),
  ] }, applyMap: organicMap(applySingapore, 503) },
];

const LEVEL_3_CITIES: CampaignCityDefinition[] = [
  { id: 'curitiba', name: 'Curitiba', country: 'Brasil', description: 'Organize o crescimento ao redor de eixos estruturais e corredores de ônibus eficientes.', biome: 'Planalto subtropical', accent: '#6fcf74', vegetation: ['araucaria', 'formalGarden'], campaignLevel: 3, startingMoney: 7000, featuredObjectives: ['bus'], mission: { holdSeconds: 60, objectives: [
    minObjective('population', 'População', 'population', 620),
    { id: 'brt-megacity', label: 'Rede BRT', description: '40 tiles, 5 ônibus, 150 viagens e 70% da rota em corredor', requirements: [requirement('busLaneTiles', 'min', 40, 'Corredores', 'tiles'), requirement('activeBuses', 'min', 5, 'Ônibus'), requirement('busTripsCompleted', 'min', 150, 'Viagens de ônibus', 'viagens'), requirement('busLaneCoveragePercent', 'min', 70, 'Cobertura BRT', '%')] },
    minObjective('satisfaction', 'Satisfação', 'satisfaction', 84, '%'),
  ] }, applyMap: organicMap(applyCuritiba, 601) },
  { id: 'paris', name: 'Paris', country: 'França', description: 'Integre bicicleta e metrô nas duas margens do Sena sem sobrecarregar o centro histórico.', biome: 'Vale temperado urbano', accent: '#e6b85c', vegetation: ['planeTree', 'formalGarden'], campaignLevel: 3, startingMoney: 10000, featuredObjectives: ['bike', 'metro'], mission: { holdSeconds: 60, objectives: [
    minObjective('population', 'População', 'population', 680),
    { id: 'bike-paris', label: 'Rede ciclável', description: '35 tiles e 60 viagens de bicicleta', requirements: [requirement('bikeLaneTiles', 'min', 35, 'Ciclovias', 'tiles'), requirement('bikeTripsCompleted', 'min', 60, 'Viagens de bicicleta', 'viagens')] },
    { id: 'metro-paris', label: 'Metrô integrado', description: '5 estações, 2 linhas e 80 viagens', requirements: [requirement('metroStations', 'min', 5, 'Estações'), requirement('metroLines', 'min', 2, 'Linhas'), requirement('metroTripsCompleted', 'min', 80, 'Viagens de metrô', 'viagens')] },
    { id: 'continuous-service', label: 'Serviço simultâneo', description: 'Bicicleta e metrô com viagens nos últimos 15 segundos', requirements: [requirement('secondsSinceBikeTrip', 'max', 15, 'Bicicleta ativa', 's'), requirement('secondsSinceMetroTrip', 'max', 15, 'Metrô ativo', 's')] },
    maxObjective('traffic', 'Trânsito', 'averageCongestion', 22, '%'),
  ] }, applyMap: organicMap(applyParis, 701) },
  { id: 'tokyo', name: 'Tóquio', country: 'Japão', description: 'Construa uma rede metropolitana robusta entre centros comerciais densos e um rio urbano.', biome: 'Metrópole temperada', accent: '#ff6b7a', vegetation: ['ginkgo', 'cherryTree'], campaignLevel: 3, startingMoney: 12000, featuredObjectives: ['metro'], mission: { holdSeconds: 60, objectives: [
    minObjective('population', 'População', 'population', 700),
    { id: 'tokyo-metro', label: 'Rede metropolitana', description: '7 estações, 2 linhas e 120 viagens', requirements: [requirement('metroStations', 'min', 7, 'Estações'), requirement('metroLines', 'min', 2, 'Linhas'), requirement('metroTripsCompleted', 'min', 120, 'Viagens de metrô', 'viagens'), requirement('minMetroStationsPerActiveLine', 'min', 3, 'Estações por linha')] },
    maxObjective('traffic', 'Trânsito', 'averageCongestion', 20, '%'),
  ] }, applyMap: organicMap(applyTokyo, 809) },
  { id: 'hong-kong', name: 'Hong Kong', country: 'China', description: 'Una três núcleos verticais separados por baía e montanhas usando metrô e mobilidade aérea.', biome: 'Costa subtropical montanhosa', accent: '#e84a5f', vegetation: ['banyan', 'tropicalRainforest'], campaignLevel: 3, startingMoney: 20000, featuredObjectives: ['metro', 'air'], zones: [
    { id: 'island', label: 'Ilha oeste', x: 7, y: 14, radius: 7 },
    { id: 'kowloon', label: 'Núcleo norte', x: 31, y: 7, radius: 7 },
    { id: 'harbor-east', label: 'Núcleo sul', x: 31, y: 23, radius: 7 },
  ], mission: { holdSeconds: 60, objectives: [
    minObjective('population', 'População', 'population', 650),
    { id: 'hong-kong-metro', label: 'Metrô vertical', description: '5 estações, 2 linhas e 100 viagens', requirements: [requirement('metroStations', 'min', 5, 'Estações'), requirement('metroLines', 'min', 2, 'Linhas'), requirement('metroTripsCompleted', 'min', 100, 'Viagens de metrô', 'viagens')] },
    { id: 'hong-kong-air', label: 'Pontes aéreas', description: '4 helipontos, 2 linhas e 25 viagens', requirements: [requirement('helipads', 'min', 4, 'Helipontos'), requirement('helicopterLines', 'min', 2, 'Linhas aéreas'), requirement('helicopterTripsCompleted', 'min', 25, 'Viagens aéreas', 'viagens')] },
    minObjective('connected-zones', 'Núcleos conectados', 'connectedCampaignZones', 3, 'zonas'),
    minObjective('satisfaction', 'Satisfação', 'satisfaction', 86, '%'),
    maxObjective('traffic', 'Trânsito', 'averageCongestion', 18, '%'),
  ] }, applyMap: organicMap(applyHongKong, 907, 3) },
];

export const CAMPAIGN_LEVEL_1_CITIES = LEVEL_1_CITIES;
export const CAMPAIGN_LEVEL_2_CITIES = LEVEL_2_CITIES;
export const CAMPAIGN_LEVEL_3_CITIES = LEVEL_3_CITIES;
export const CAMPAIGN_CITIES: CampaignCityDefinition[] = [...LEVEL_1_CITIES, ...LEVEL_2_CITIES, ...LEVEL_3_CITIES];

export function getCampaignCity(id: string | undefined): CampaignCityDefinition | undefined {
  return CAMPAIGN_CITIES.find((city) => city.id === id);
}
