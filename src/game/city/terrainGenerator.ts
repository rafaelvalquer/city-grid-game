import type { TerrainKind, Tile, Vec2 } from '../../types/city.types';
import { GAME_CONFIG } from '../config/gameConfig';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { getNeighbors4ForGrid, inBoundsForGrid, keyOf } from './grid';

type SizeRange = { min: number; max: number };
type CountRange = { min: number; max: number };
type TerrainBounds = { xStart: number; yStart: number; width: number; height: number };

type TerrainConfigShape = typeof TERRAIN_CONFIG;

export function isTerrainBlocked(tile: Tile | undefined): boolean {
  return tile?.type === 'mountain' || tile?.type === 'lake';
}

export function generateTerrainReliefForBounds(
  grid: Tile[][],
  bounds: TerrainBounds,
  densityMultiplier = 0.62,
  config: TerrainConfigShape = TERRAIN_CONFIG,
): void {
  const startBlocked = getTerrainSummary(grid).blockedTiles;
  const maxBlocked = Math.floor(Math.max(1, bounds.width * bounds.height) * (config.maxBlockedRatio ?? 0.16) * densityMultiplier);
  const mountainClusters = Math.max(1, Math.round(randRange(config.mountainClusterCount ?? { min: 3, max: 6 }) * densityMultiplier));
  const lakeClusters = Math.max(1, Math.round(randRange(config.lakeClusterCount ?? { min: 2, max: 4 }) * densityMultiplier));

  for (let i = 0; i < mountainClusters; i += 1) {
    if (getTerrainSummary(grid).blockedTiles - startBlocked >= maxBlocked) break;
    placeTerrainCluster(grid, bounds, 'mountain', pickMountainSize(config), config);
  }

  for (let i = 0; i < lakeClusters; i += 1) {
    if (getTerrainSummary(grid).blockedTiles - startBlocked >= maxBlocked) break;
    placeTerrainCluster(grid, bounds, 'lake', pickLakeSize(config), config);
  }

  smoothTerrainClusters(grid, bounds);
  enhanceMountainOrganicShape(grid, bounds);
  computeTerrainMetadata(grid);
}

export function getTerrainSummary(grid: Tile[][]): { mountainTiles: number; lakeTiles: number; blockedTiles: number; blockedRatio: number } {
  let mountainTiles = 0;
  let lakeTiles = 0;
  let total = 0;
  for (const row of grid) {
    for (const tile of row) {
      total += 1;
      if (tile.type === 'mountain') mountainTiles += 1;
      if (tile.type === 'lake') lakeTiles += 1;
    }
  }
  const blockedTiles = mountainTiles + lakeTiles;
  return {
    mountainTiles,
    lakeTiles,
    blockedTiles,
    blockedRatio: total ? Math.round((blockedTiles / total) * 1000) / 1000 : 0,
  };
}

export function computeTerrainMetadata(grid: Tile[][]): void {
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < (grid[y]?.length ?? 0); x += 1) {
      const tile = grid[y]?.[x];
      if (!tile || !isTerrainBlocked(tile)) continue;
      const kind = tile.type as TerrainKind;
      const edgeMask = computeEdgeMask(grid, x, y, kind);
      const depth = kind === 'mountain' ? computeMountainDepth(grid, x, y) : computeLakeDepth(grid, x, y);
      grid[y][x] = {
        ...tile,
        terrainEdgeMask: edgeMask,
        terrainDepth: depth,
        terrainVariant: tile.terrainVariant ?? Math.abs(hashTerrain(x, y, kind)) % 8,
      };
    }
  }
}

function placeTerrainCluster(grid: Tile[][], bounds: TerrainBounds, kind: TerrainKind, targetSize: number, config: TerrainConfigShape): void {
  const start = findTerrainStart(grid, bounds, config);
  if (!start) return;
  const clusterId = kind + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 9999).toString(36);
  const cluster = growTerrainCluster(grid, bounds, start, kind, targetSize);
  if (cluster.length < Math.max(3, Math.floor(targetSize * 0.45))) return;

  for (const pos of cluster) {
    const current = grid[pos.y]?.[pos.x];
    if (!current || current.type !== 'empty') continue;
    grid[pos.y][pos.x] = {
      x: pos.x,
      y: pos.y,
      type: kind,
      terrainClusterId: clusterId,
      terrainVariant: Math.abs(hashTerrain(pos.x, pos.y, kind)) % 8,
    } as Tile;
  }
}

function growTerrainCluster(grid: Tile[][], bounds: TerrainBounds, start: Vec2, kind: TerrainKind, targetSize: number): Vec2[] {
  const cluster: Vec2[] = [start];
  const seen = new Set<string>([keyOf(start.x, start.y)]);
  const frontier: Vec2[] = [start];
  const organicChance = kind === 'lake' ? 0.73 : 0.64;

  while (cluster.length < targetSize && frontier.length) {
    const current = frontier.splice(Math.floor(Math.random() * frontier.length), 1)[0];
    const candidates = shuffle(getNeighbors4ForGrid(grid, current));
    for (const next of candidates) {
      if (cluster.length >= targetSize) break;
      const key = keyOf(next.x, next.y);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!insideBounds(next, bounds)) continue;
      if (!canPlaceTerrainAt(grid, next)) continue;
      const roll = Math.random();
      const irregularity = 0.12 * Math.sin((next.x + 2) * 1.7 + (next.y - 3) * 1.3);
      if (roll > organicChance + irregularity) continue;
      cluster.push(next);
      frontier.push(next);
    }

    if (frontier.length < 2 && cluster.length < targetSize * 0.72) {
      const fallback = cluster[Math.floor(Math.random() * cluster.length)];
      if (fallback) frontier.push(fallback);
    }
  }

  return cluster;
}

function smoothTerrainClusters(grid: Tile[][], bounds: TerrainBounds): void {
  for (const kind of ['mountain', 'lake'] as TerrainKind[]) {
    fillSmallHoles(grid, bounds, kind);
    removeTinySingleTiles(grid, bounds, kind);
    softenHardCorners(grid, bounds, kind);
  }
}

function fillSmallHoles(grid: Tile[][], bounds: TerrainBounds, kind: TerrainKind): void {
  const additions: Vec2[] = [];
  forEachInBounds(bounds, (x, y) => {
    const tile = grid[y]?.[x];
    if (!tile || tile.type !== 'empty') return;
    const count = countCardinalNeighbors(grid, x, y, kind);
    const diagonals = countDiagonalNeighbors(grid, x, y, kind);
    if (count >= 3 || (count >= 2 && diagonals >= 2 && Math.random() < 0.45)) additions.push({ x, y });
  });
  for (const pos of additions) {
    if (grid[pos.y]?.[pos.x]?.type !== 'empty') continue;
    grid[pos.y][pos.x] = {
      x: pos.x,
      y: pos.y,
      type: kind,
      terrainClusterId: kind + '-smooth',
      terrainVariant: Math.abs(hashTerrain(pos.x, pos.y, kind)) % 8,
    } as Tile;
  }
}

function removeTinySingleTiles(grid: Tile[][], bounds: TerrainBounds, kind: TerrainKind): void {
  const removals: Vec2[] = [];
  forEachInBounds(bounds, (x, y) => {
    const tile = grid[y]?.[x];
    if (tile?.type !== kind) return;
    if (countCardinalNeighbors(grid, x, y, kind) === 0 && countDiagonalNeighbors(grid, x, y, kind) <= 1) removals.push({ x, y });
  });
  for (const pos of removals) grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'empty' } as Tile;
}

function softenHardCorners(grid: Tile[][], bounds: TerrainBounds, kind: TerrainKind): void {
  const additions: Vec2[] = [];
  forEachInBounds(bounds, (x, y) => {
    const tile = grid[y]?.[x];
    if (!tile || tile.type !== 'empty') return;
    const n = sameTerrain(grid, x, y - 1, kind);
    const e = sameTerrain(grid, x + 1, y, kind);
    const s = sameTerrain(grid, x, y + 1, kind);
    const w = sameTerrain(grid, x - 1, y, kind);
    const cornerPair = (n && e) || (e && s) || (s && w) || (w && n);
    if (cornerPair && Math.random() < 0.22) additions.push({ x, y });
  });
  for (const pos of additions) {
    if (grid[pos.y]?.[pos.x]?.type !== 'empty') continue;
    grid[pos.y][pos.x] = {
      x: pos.x,
      y: pos.y,
      type: kind,
      terrainClusterId: kind + '-corner',
      terrainVariant: Math.abs(hashTerrain(pos.x, pos.y, kind)) % 8,
    } as Tile;
  }
}

function computeEdgeMask(grid: Tile[][], x: number, y: number, kind: TerrainKind): number {
  let mask = 0;
  if (!sameTerrain(grid, x, y - 1, kind)) mask |= 1;
  if (!sameTerrain(grid, x + 1, y, kind)) mask |= 2;
  if (!sameTerrain(grid, x, y + 1, kind)) mask |= 4;
  if (!sameTerrain(grid, x - 1, y, kind)) mask |= 8;
  return mask;
}

function computeMountainDepth(grid: Tile[][], x: number, y: number): number {
  for (let radius = 1; radius <= 5; radius += 1) {
    for (let yy = y - radius; yy <= y + radius; yy += 1) {
      for (let xx = x - radius; xx <= x + radius; xx += 1) {
        if (Math.abs(xx - x) + Math.abs(yy - y) > radius) continue;
        if (!sameTerrain(grid, xx, yy, 'mountain')) return Math.max(1, radius);
      }
    }
  }
  return 5;
}

function computeLakeDepth(grid: Tile[][], x: number, y: number): number {
  const cardinal = countCardinalNeighbors(grid, x, y, 'lake');
  const diagonal = countDiagonalNeighbors(grid, x, y, 'lake');
  return Math.max(1, Math.min(5, Math.round((cardinal + diagonal) / 2)));
}

function findTerrainStart(grid: Tile[][], bounds: TerrainBounds, config: TerrainConfigShape): Vec2 | null {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const x = randInt(bounds.xStart + 1, bounds.xStart + bounds.width - 2);
    const y = randInt(bounds.yStart + 1, bounds.yStart + bounds.height - 2);
    const pos = { x, y };
    if (!insideBounds(pos, bounds)) continue;
    if (!canPlaceTerrainAt(grid, pos)) continue;
    if (isProtectedInitialArea(pos, bounds, config)) continue;
    return pos;
  }
  return null;
}

function canPlaceTerrainAt(grid: Tile[][], pos: Vec2): boolean {
  const tile = grid[pos.y]?.[pos.x];
  if (!tile || tile.type !== 'empty') return false;
  return true;
}

function isProtectedInitialArea(pos: Vec2, bounds: TerrainBounds, config: TerrainConfigShape): boolean {
  if (bounds.xStart !== 0 || bounds.yStart !== 0) return false;
  const centerX = Math.floor((gridWidth(bounds)) / 2);
  const centerY = Math.floor((gridHeight(bounds)) / 2);
  const radius = config.protectedCenterRadius ?? 5;
  if (Math.abs(pos.x - centerX) + Math.abs(pos.y - centerY) <= radius) return true;
  const protectedWidth = config.protectedSpawnAreaWidth ?? 12;
  const protectedHeight = config.protectedSpawnAreaHeight ?? 8;
  return Math.abs(pos.x - centerX) <= protectedWidth / 2 && Math.abs(pos.y - centerY) <= protectedHeight / 2;
}

function pickMountainSize(config: TerrainConfigShape): number {
  const roll = Math.random();
  if (roll < 0.42) return randRange(config.smallMountainSize ?? { min: 4, max: 9 });
  if (roll < 0.82) return randRange(config.mediumMountainSize ?? { min: 10, max: 18 });
  return randRange(config.largeMountainSize ?? { min: 19, max: 34 });
}

function pickLakeSize(config: TerrainConfigShape): number {
  return Math.random() < 0.62
    ? randRange(config.smallLakeSize ?? { min: 5, max: 12 })
    : randRange(config.largeLakeSize ?? { min: 18, max: 36 });
}

function countCardinalNeighbors(grid: Tile[][], x: number, y: number, kind: TerrainKind): number {
  return Number(sameTerrain(grid, x, y - 1, kind))
    + Number(sameTerrain(grid, x + 1, y, kind))
    + Number(sameTerrain(grid, x, y + 1, kind))
    + Number(sameTerrain(grid, x - 1, y, kind));
}

function countDiagonalNeighbors(grid: Tile[][], x: number, y: number, kind: TerrainKind): number {
  return Number(sameTerrain(grid, x + 1, y - 1, kind))
    + Number(sameTerrain(grid, x + 1, y + 1, kind))
    + Number(sameTerrain(grid, x - 1, y + 1, kind))
    + Number(sameTerrain(grid, x - 1, y - 1, kind));
}

function sameTerrain(grid: Tile[][], x: number, y: number, kind: TerrainKind): boolean {
  return inBoundsForGrid(grid, x, y) && grid[y]?.[x]?.type === kind;
}

function insideBounds(pos: Vec2, bounds: TerrainBounds): boolean {
  return pos.x >= bounds.xStart
    && pos.y >= bounds.yStart
    && pos.x < bounds.xStart + bounds.width
    && pos.y < bounds.yStart + bounds.height;
}

function forEachInBounds(bounds: TerrainBounds, callback: (x: number, y: number) => void): void {
  for (let y = bounds.yStart; y < bounds.yStart + bounds.height; y += 1) {
    for (let x = bounds.xStart; x < bounds.xStart + bounds.width; x += 1) callback(x, y);
  }
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randRange(range: CountRange | SizeRange): number {
  return randInt(range.min, range.max);
}

function randInt(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function gridWidth(bounds: TerrainBounds): number {
  return bounds.width || GAME_CONFIG.gridWidth;
}

function gridHeight(bounds: TerrainBounds): number {
  return bounds.height || GAME_CONFIG.gridHeight;
}


function enhanceMountainOrganicShape(grid: Tile[][], bounds: TerrainBounds): void {
  const toMountain: Vec2[] = [];
  const toEmpty: Vec2[] = [];

  for (let y = bounds.yStart; y < bounds.yStart + bounds.height; y += 1) {
    for (let x = bounds.xStart; x < bounds.xStart + bounds.width; x += 1) {
      const tile = grid[y]?.[x];
      if (!tile) continue;
      const mountainNeighbors = getSameTerrainNeighborCount(grid, x, y, 'mountain');
      if (tile.type === 'empty' && mountainNeighbors >= 5 && canPlaceTerrainAt(grid, { x, y })) {
        toMountain.push({ x, y });
      }
      if (tile.type === 'mountain' && mountainNeighbors <= 1) {
        toEmpty.push({ x, y });
      }
    }
  }

  for (const pos of toMountain.slice(0, 18)) {
    grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'mountain' };
  }
  for (const pos of toEmpty) {
    grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'empty' };
  }
}

function getSameTerrainNeighborCount(grid: Tile[][], x: number, y: number, kind: TerrainKind): number {
  let count = 0;
  for (let yy = y - 1; yy <= y + 1; yy += 1) {
    for (let xx = x - 1; xx <= x + 1; xx += 1) {
      if (xx === x && yy === y) continue;
      if (grid[yy]?.[xx]?.type === kind) count += 1;
    }
  }
  return count;
}

function hashTerrain(x: number, y: number, kind: TerrainKind): number {
  let n = x * 374761393 + y * 668265263 + (kind === 'lake' ? 1442695041 : 982451653);
  n = (n ^ (n >> 13)) * 1274126177;
  return n ^ (n >> 16);
}
