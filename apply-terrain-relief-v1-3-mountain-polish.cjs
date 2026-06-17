const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupSuffix = '.bak-terrain-relief-v1-3-mountain-polish';

function filePath(rel) {
  return path.join(root, rel);
}

function ensureDir(rel) {
  fs.mkdirSync(path.dirname(filePath(rel)), { recursive: true });
}

function read(rel) {
  return fs.readFileSync(filePath(rel), 'utf8');
}

function write(rel, content) {
  ensureDir(rel);
  const abs = filePath(rel);
  if (fs.existsSync(abs) && !fs.existsSync(abs + backupSuffix)) {
    fs.copyFileSync(abs, abs + backupSuffix);
  }
  fs.writeFileSync(abs, content, 'utf8');
  console.log('updated', rel);
}

function patch(rel, updater) {
  const abs = filePath(rel);
  if (!fs.existsSync(abs)) {
    console.warn('skip missing', rel);
    return;
  }
  const original = read(rel);
  const next = updater(original);
  if (next !== original) write(rel, next);
  else console.log('unchanged', rel);
}

const renderTerrainFeatures = String.raw`import type { Graphics } from 'pixi.js';
import type { Tile } from '../../types/city.types';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { hash2 } from './renderUtils';

type TerrainKind = 'mountain' | 'lake';

type TerrainNeighbors = {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  ne: boolean;
  se: boolean;
  sw: boolean;
  nw: boolean;
};

type TerrainRenderArgs = {
  grid: Tile[][];
  tile: Tile;
  x: number;
  y: number;
  ts: number;
  timeSeconds: number;
};

const LAKE = {
  waterDeep: 0x155e75,
  water: 0x1d91b4,
  waterLight: 0x8be9fb,
  shore: 0xbfdc9a,
  shoreDark: 0x78a86d,
  glint: 0xe9fbff,
};

const MOUNTAIN = {
  ground: 0x6f7f54,
  groundAlt: 0x63764f,
  groundDark: 0x485a3f,
  mossLight: 0x92a36b,
  mossDark: 0x536846,
  stone: 0x81796a,
  stoneWarm: 0x91846f,
  stoneLight: 0xb8b098,
  stoneHighlight: 0xd6cfb7,
  stoneDark: 0x504d45,
  shadow: 0x20271f,
  ridge: 0xc9c0a4,
  fog: 0xd6e4ce,
};

export function drawTerrainFeatureBase(graphics: Graphics, grid: Tile[][], tile: Tile, x: number, y: number, ts: number, timeSeconds?: number): void;
export function drawTerrainFeatureBase(graphics: Graphics, tile: Tile, x: number, y: number, ts: number, timeSeconds?: number): void;
export function drawTerrainFeatureBase(
  graphics: Graphics,
  gridOrTile: Tile[][] | Tile,
  tileOrX: Tile | number,
  xOrY: number,
  yOrTs: number,
  tsOrTime = 0,
  maybeTime = 0,
): void {
  const args = normalizeFeatureArgs(gridOrTile, tileOrX, xOrY, yOrTs, tsOrTime, maybeTime);
  if (!args || !isTerrainTile(args.tile)) return;
  if (args.tile.type === 'lake') drawConnectedLakeBase(graphics, args);
  if (args.tile.type === 'mountain') drawConnectedMountainMass(graphics, args);
}

export function drawTerrainFeatureAnimation(graphics: Graphics, grid: Tile[][], ts: number, timeSeconds: number): void {
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y];
    for (let x = 0; x < (row?.length ?? 0); x += 1) {
      const tile = row?.[x];
      if (!tile) continue;
      if (tile.type === 'lake') drawLakeWaterAnimation(graphics, grid, tile, x, y, ts, timeSeconds);
      if (tile.type === 'mountain') drawMountainAtmosphere(graphics, grid, tile, x, y, ts, timeSeconds);
    }
  }
}

// Compatibilidade com pacotes anteriores que importavam o nome no plural.
export const drawTerrainFeatureAnimations = drawTerrainFeatureAnimation;

export function getTerrainNeighborMask(grid: Tile[][], x: number, y: number, type: TerrainKind): number {
  const n = sameTerrain(grid, x, y - 1, type) ? 1 : 0;
  const e = sameTerrain(grid, x + 1, y, type) ? 2 : 0;
  const s = sameTerrain(grid, x, y + 1, type) ? 4 : 0;
  const w = sameTerrain(grid, x - 1, y, type) ? 8 : 0;
  return n | e | s | w;
}

function normalizeFeatureArgs(
  gridOrTile: Tile[][] | Tile,
  tileOrX: Tile | number,
  xOrY: number,
  yOrTs: number,
  tsOrTime = 0,
  maybeTime = 0,
): TerrainRenderArgs | null {
  if (Array.isArray(gridOrTile)) {
    const grid = gridOrTile;
    const tile = tileOrX as Tile;
    const x = xOrY;
    const y = yOrTs;
    const ts = tsOrTime;
    return { grid, tile, x, y, ts, timeSeconds: maybeTime };
  }

  const tile = gridOrTile;
  const x = tileOrX as number;
  const y = xOrY;
  const ts = yOrTs;
  return { grid: [[tile]], tile, x, y, ts, timeSeconds: tsOrTime };
}

function isTerrainTile(tile: Tile | undefined): tile is Tile & { type: TerrainKind } {
  return tile?.type === 'mountain' || tile?.type === 'lake';
}

function sameTerrain(grid: Tile[][], x: number, y: number, type: TerrainKind): boolean {
  return grid[y]?.[x]?.type === type;
}

function neighbors(grid: Tile[][], x: number, y: number, type: TerrainKind): TerrainNeighbors {
  return {
    n: sameTerrain(grid, x, y - 1, type),
    e: sameTerrain(grid, x + 1, y, type),
    s: sameTerrain(grid, x, y + 1, type),
    w: sameTerrain(grid, x - 1, y, type),
    ne: sameTerrain(grid, x + 1, y - 1, type),
    se: sameTerrain(grid, x + 1, y + 1, type),
    sw: sameTerrain(grid, x - 1, y + 1, type),
    nw: sameTerrain(grid, x - 1, y - 1, type),
  };
}

function externalEdgeCount(n: TerrainNeighbors): number {
  return Number(!n.n) + Number(!n.e) + Number(!n.s) + Number(!n.w);
}

function connectedRect(x: number, y: number, ts: number, n: TerrainNeighbors, inset: number) {
  const px = x * ts;
  const py = y * ts;
  const left = n.w ? -1 : inset;
  const right = n.e ? -1 : inset;
  const top = n.n ? -1 : inset;
  const bottom = n.s ? -1 : inset;
  return {
    px,
    py,
    x: px + left,
    y: py + top,
    width: ts - left - right,
    height: ts - top - bottom,
  };
}

function mountainDepth(grid: Tile[][], tile: Tile, x: number, y: number): number {
  if (typeof tile.terrainDepth === 'number' && Number.isFinite(tile.terrainDepth)) {
    return clamp(Math.round(tile.terrainDepth), 1, 5);
  }

  let depth = 1;
  for (let radius = 1; radius <= 4; radius += 1) {
    let surrounded = true;
    for (let yy = y - radius; yy <= y + radius && surrounded; yy += 1) {
      for (let xx = x - radius; xx <= x + radius; xx += 1) {
        if (Math.abs(xx - x) + Math.abs(yy - y) > radius) continue;
        if (!sameTerrain(grid, xx, yy, 'mountain')) {
          surrounded = false;
          break;
        }
      }
    }
    if (surrounded) depth += 1;
  }
  return clamp(depth, 1, 5);
}

function localMountainPeakScore(grid: Tile[][], x: number, y: number): number {
  let score = 0;
  for (let yy = y - 1; yy <= y + 1; yy += 1) {
    for (let xx = x - 1; xx <= x + 1; xx += 1) {
      if (sameTerrain(grid, xx, yy, 'mountain')) score += 1;
    }
  }
  return score;
}

function drawConnectedLakeBase(graphics: Graphics, args: TerrainRenderArgs): void {
  const { grid, tile, x, y, ts } = args;
  const n = neighbors(grid, x, y, 'lake');
  const edgeCount = externalEdgeCount(n);
  const hash = hash2(x, y, 83);
  const rect = connectedRect(x, y, ts, n, edgeCount >= 3 ? 4 : 1);
  const depth = clamp(tile.terrainDepth ?? (edgeCount <= 1 ? 4 : 2), 1, 5);
  const water = depth >= 4 ? LAKE.waterDeep : LAKE.water - (hash % 3) * 0x020202;

  // Margem externa somente no contorno do lago.
  if (!n.n) graphics.roundRect(rect.px + 2, rect.py + 1, ts - 4, 8, 5).fill({ color: LAKE.shore, alpha: 0.55 });
  if (!n.s) graphics.roundRect(rect.px + 3, rect.py + ts - 9, ts - 6, 8, 5).fill({ color: LAKE.shoreDark, alpha: 0.42 });
  if (!n.w) graphics.roundRect(rect.px + 1, rect.py + 3, 8, ts - 6, 5).fill({ color: LAKE.shore, alpha: 0.42 });
  if (!n.e) graphics.roundRect(rect.px + ts - 9, rect.py + 3, 8, ts - 6, 5).fill({ color: LAKE.shoreDark, alpha: 0.34 });

  graphics.roundRect(rect.x, rect.y, rect.width, rect.height, edgeCount >= 3 ? 9 : 1)
    .fill({ color: water, alpha: 0.97 });

  if (edgeCount <= 1) {
    graphics.roundRect(rect.px + 2, rect.py + 2, ts - 4, ts - 4, 3)
      .fill({ color: LAKE.waterDeep, alpha: 0.17 + depth * 0.025 });
  }

  drawLakeCorner(graphics, rect.px, rect.py, ts, !n.n && !n.w, 'nw');
  drawLakeCorner(graphics, rect.px, rect.py, ts, !n.n && !n.e, 'ne');
  drawLakeCorner(graphics, rect.px, rect.py, ts, !n.s && !n.w, 'sw');
  drawLakeCorner(graphics, rect.px, rect.py, ts, !n.s && !n.e, 'se');
}

function drawLakeCorner(graphics: Graphics, px: number, py: number, ts: number, active: boolean, corner: 'nw' | 'ne' | 'sw' | 'se'): void {
  if (!active) return;
  const x = corner.endsWith('e') ? px + ts - 8 : px + 4;
  const y = corner.startsWith('s') ? py + ts - 8 : py + 4;
  graphics.circle(x, y, 4).fill({ color: LAKE.shore, alpha: 0.28 });
}

function drawLakeWaterAnimation(graphics: Graphics, grid: Tile[][], tile: Tile, x: number, y: number, ts: number, timeSeconds: number): void {
  const n = neighbors(grid, x, y, 'lake');
  const edgeCount = externalEdgeCount(n);
  const rect = connectedRect(x, y, ts, n, edgeCount >= 3 ? 5 : 2);
  const speed = TERRAIN_CONFIG.lakeAnimationSpeed ?? 0.8;
  const phase = timeSeconds * speed + x * 0.71 + y * 0.43;
  const wave = Math.sin(phase) * 0.65;
  const alpha = 0.1 + Math.sin(phase * 0.7) * 0.025;

  graphics.roundRect(rect.x + 7, rect.y + 9 + wave, Math.max(4, rect.width - 14), 2.2, 2)
    .fill({ color: LAKE.glint, alpha });

  if ((hash2(x, y, 91) % 4) === 0) {
    graphics.roundRect(x * ts + 10, y * ts + ts * 0.6 - wave, ts - 20, 1.8, 2)
      .fill({ color: LAKE.waterLight, alpha: 0.11 });
  }
}

function drawConnectedMountainMass(graphics: Graphics, args: TerrainRenderArgs): void {
  const { grid, tile, x, y, ts } = args;
  const n = neighbors(grid, x, y, 'mountain');
  const edgeCount = externalEdgeCount(n);
  const depth = mountainDepth(grid, tile, x, y);
  const hash = hash2(x, y, 117);
  const rect = connectedRect(x, y, ts, n, edgeCount >= 3 ? 4 : 0);
  const variant = tile.terrainVariant ?? hash % 8;
  const baseColor = depth <= 1 ? MOUNTAIN.ground : variant % 2 === 0 ? MOUNTAIN.groundAlt : MOUNTAIN.ground;

  // Sombra externa: dá peso e remove a leitura de adesivo por tile.
  if (!n.s) graphics.roundRect(rect.px + 3, rect.py + ts - 8, ts - 6, 7, 5).fill({ color: MOUNTAIN.shadow, alpha: 0.15 + depth * 0.025 });
  if (!n.e) graphics.roundRect(rect.px + ts - 8, rect.py + 5, 7, ts - 10, 5).fill({ color: MOUNTAIN.shadow, alpha: 0.1 + depth * 0.018 });

  // Massa conectada, cobrindo a grade interna do cluster.
  graphics.roundRect(rect.x, rect.y, rect.width, rect.height, edgeCount >= 3 ? 8 : 1)
    .fill({ color: baseColor, alpha: 0.96 });

  // Encosta baixa e musgo; baixa opacidade para não virar padrão repetitivo.
  drawClusterRim(graphics, rect.px, rect.py, ts, n, depth);
  drawGroundTexture(graphics, rect.px, rect.py, ts, hash, depth, edgeCount);

  if (depth <= 1) {
    drawFoothill(graphics, rect.px, rect.py, ts, hash, n);
    return;
  }

  if (depth === 2) {
    drawIntermediateSlope(graphics, rect.px, rect.py, ts, depth, hash, n);
    return;
  }

  const peakScore = localMountainPeakScore(grid, x, y);
  const peakAllowed = depth >= 4 || (peakScore >= 8 && hash % 3 !== 0) || (depth >= 3 && edgeCount === 0 && hash % 5 !== 0);
  if (!peakAllowed) {
    drawHighSlopeWithoutPeak(graphics, rect.px, rect.py, ts, depth, hash, n);
    return;
  }

  drawMajorPeak(graphics, rect.px, rect.py, ts, depth, hash, variant);
  if (depth >= 4 && hash % 4 !== 1) drawSecondaryPeak(graphics, rect.px, rect.py, ts, depth, hash);
}

function drawClusterRim(graphics: Graphics, px: number, py: number, ts: number, n: TerrainNeighbors, depth: number): void {
  const shadowAlpha = 0.13 + depth * 0.018;
  if (!n.n) graphics.roundRect(px + 3, py + 2, ts - 6, 5, 3).fill({ color: MOUNTAIN.mossLight, alpha: 0.28 });
  if (!n.w) graphics.roundRect(px + 2, py + 5, 5, ts - 10, 3).fill({ color: MOUNTAIN.mossLight, alpha: 0.18 });
  if (!n.s) graphics.roundRect(px + 4, py + ts - 8, ts - 8, 5, 3).fill({ color: MOUNTAIN.shadow, alpha: shadowAlpha });
  if (!n.e) graphics.roundRect(px + ts - 8, py + 6, 5, ts - 12, 3).fill({ color: MOUNTAIN.shadow, alpha: shadowAlpha * 0.7 });
}

function drawGroundTexture(graphics: Graphics, px: number, py: number, ts: number, hash: number, depth: number, edgeCount: number): void {
  const alpha = edgeCount >= 2 ? 0.13 : 0.08;
  const offset = hash % 5;
  graphics.roundRect(px + 5 + offset, py + ts - 12 + (hash % 2), Math.max(8, ts - 16 - offset), 3, 2)
    .fill({ color: depth <= 1 ? MOUNTAIN.mossDark : MOUNTAIN.mossLight, alpha });
  if (hash % 4 === 0) {
    graphics.circle(px + ts * 0.25, py + ts * 0.62, 1.4).fill({ color: MOUNTAIN.stoneDark, alpha: 0.12 });
    graphics.circle(px + ts * 0.72, py + ts * 0.47, 1.2).fill({ color: MOUNTAIN.stoneLight, alpha: 0.1 });
  }
}

function drawFoothill(graphics: Graphics, px: number, py: number, ts: number, hash: number, n: TerrainNeighbors): void {
  const ridgeY = py + ts * (0.64 + (hash % 3) * 0.025);
  const alpha = n.s ? 0.16 : 0.28;
  graphics
    .moveTo(px + ts * 0.12, py + ts * 0.78)
    .lineTo(px + ts * 0.43, ridgeY)
    .lineTo(px + ts * 0.84, py + ts * 0.79)
    .closePath()
    .fill({ color: MOUNTAIN.stoneDark, alpha });

  graphics.roundRect(px + ts * 0.18, ridgeY + 3, ts * 0.52, 2.5, 2)
    .fill({ color: MOUNTAIN.stoneLight, alpha: 0.1 });
}

function drawIntermediateSlope(graphics: Graphics, px: number, py: number, ts: number, depth: number, hash: number, n: TerrainNeighbors): void {
  const midX = px + ts * (0.48 + ((hash % 5) - 2) * 0.012);
  const peakY = py + ts * (0.42 - depth * 0.025);
  const bottomY = py + ts * 0.82;

  graphics
    .moveTo(px + ts * 0.1, bottomY)
    .lineTo(midX, peakY)
    .lineTo(px + ts * 0.9, bottomY)
    .closePath()
    .fill({ color: MOUNTAIN.stoneWarm, alpha: 0.55 });

  graphics
    .moveTo(midX, peakY)
    .lineTo(px + ts * 0.9, bottomY)
    .lineTo(px + ts * 0.58, bottomY)
    .closePath()
    .fill({ color: MOUNTAIN.stoneDark, alpha: 0.25 });

  graphics
    .moveTo(midX, peakY)
    .lineTo(px + ts * 0.37, py + ts * 0.6)
    .lineTo(px + ts * 0.53, py + ts * 0.58)
    .closePath()
    .fill({ color: MOUNTAIN.stoneLight, alpha: n.n ? 0.18 : 0.28 });
}

function drawHighSlopeWithoutPeak(graphics: Graphics, px: number, py: number, ts: number, depth: number, hash: number, n: TerrainNeighbors): void {
  const ridge = py + ts * (0.34 - depth * 0.012);
  const midX = px + ts * (0.5 + ((hash % 7) - 3) * 0.01);
  graphics
    .moveTo(px + ts * 0.08, py + ts * 0.84)
    .lineTo(midX, ridge)
    .lineTo(px + ts * 0.92, py + ts * 0.84)
    .closePath()
    .fill({ color: MOUNTAIN.stone, alpha: 0.62 });

  graphics
    .moveTo(midX, ridge)
    .lineTo(px + ts * 0.92, py + ts * 0.84)
    .lineTo(px + ts * 0.58, py + ts * 0.84)
    .closePath()
    .fill({ color: MOUNTAIN.stoneDark, alpha: 0.32 });

  graphics.roundRect(px + ts * 0.22, py + ts * 0.58, ts * 0.34, 2.2, 2)
    .fill({ color: MOUNTAIN.stoneHighlight, alpha: n.n ? 0.16 : 0.23 });
}

function drawMajorPeak(graphics: Graphics, px: number, py: number, ts: number, depth: number, hash: number, variant: number): void {
  const heightBoost = Math.min(0.16, depth * 0.027);
  const midX = px + ts * (0.48 + ((hash % 7) - 3) * 0.012);
  const peakY = py + ts * (0.26 - heightBoost);
  const leftX = px + ts * (0.09 + (variant % 3) * 0.018);
  const rightX = px + ts * (0.9 - (variant % 2) * 0.018);
  const bottomY = py + ts * 0.86;

  graphics
    .moveTo(leftX, bottomY)
    .lineTo(midX, peakY)
    .lineTo(rightX, bottomY)
    .closePath()
    .fill({ color: variant % 2 === 0 ? MOUNTAIN.stone : MOUNTAIN.stoneWarm, alpha: 0.9 });

  graphics
    .moveTo(midX, peakY)
    .lineTo(rightX, bottomY)
    .lineTo(px + ts * 0.57, bottomY)
    .closePath()
    .fill({ color: MOUNTAIN.stoneDark, alpha: 0.5 });

  graphics
    .moveTo(midX, peakY)
    .lineTo(px + ts * 0.34, py + ts * 0.59)
    .lineTo(px + ts * 0.52, py + ts * 0.56)
    .closePath()
    .fill({ color: MOUNTAIN.stoneLight, alpha: 0.42 });

  graphics
    .moveTo(midX, peakY + 1)
    .lineTo(midX - ts * 0.085, peakY + ts * 0.17)
    .lineTo(midX + ts * 0.085, peakY + ts * 0.17)
    .closePath()
    .fill({ color: MOUNTAIN.ridge, alpha: depth >= 4 ? 0.72 : 0.44 });
}

function drawSecondaryPeak(graphics: Graphics, px: number, py: number, ts: number, depth: number, hash: number): void {
  const side = hash % 2 === 0 ? -1 : 1;
  const cx = px + ts * (0.48 + side * 0.22);
  const top = py + ts * (0.4 - depth * 0.014);
  graphics
    .moveTo(cx - ts * 0.14, py + ts * 0.82)
    .lineTo(cx, top)
    .lineTo(cx + ts * 0.17, py + ts * 0.82)
    .closePath()
    .fill({ color: MOUNTAIN.stoneDark, alpha: 0.34 });
  graphics
    .moveTo(cx, top)
    .lineTo(cx - ts * 0.055, top + ts * 0.11)
    .lineTo(cx + ts * 0.055, top + ts * 0.11)
    .closePath()
    .fill({ color: MOUNTAIN.stoneLight, alpha: 0.2 });
}

function drawMountainAtmosphere(graphics: Graphics, grid: Tile[][], tile: Tile, x: number, y: number, ts: number, timeSeconds: number): void {
  const depth = mountainDepth(grid, tile, x, y);
  const hash = hash2(x, y, 131);
  if (depth >= 4 && hash % 5 === 0) {
    const phase = timeSeconds * 0.42 + hash * 0.01;
    const alpha = 0.033 + Math.sin(phase) * 0.011;
    graphics.roundRect(x * ts + 5, y * ts + 8 + Math.sin(phase) * 1.5, ts - 10, 4, 4)
      .fill({ color: MOUNTAIN.fog, alpha });
  }

  // Micro textura de altitude para quebrar repetição, muito discreta.
  if (depth >= 3 && hash % 6 === 0) {
    graphics.circle(x * ts + ts * 0.22, y * ts + ts * 0.26, 1.2)
      .fill({ color: MOUNTAIN.stoneHighlight, alpha: 0.08 });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
`;

write('src/game/rendering/renderTerrainFeatures.ts', renderTerrainFeatures);

patch('src/game/city/terrainGenerator.ts', (source) => {
  let s = source;

  if (s.includes('function enhanceMountainOrganicShape(')) {
    return s;
  }

  s = s.replace(
    /smoothTerrainClusters\(grid, bounds\);\s*computeTerrainMetadata\(grid\);/,
    `smoothTerrainClusters(grid, bounds);
  enhanceMountainOrganicShape(grid, bounds);
  computeTerrainMetadata(grid);`,
  );

  if (!s.includes('enhanceMountainOrganicShape(grid, bounds);')) {
    s = s.replace(/computeTerrainMetadata\(grid\);/, `enhanceMountainOrganicShape(grid, bounds);
  computeTerrainMetadata(grid);`);
  }

  const helpers = String.raw`

function enhanceMountainOrganicShape(grid: Tile[][], bounds: TerrainBounds): void {
  const toMountain: Vec2[] = [];
  const toEmpty: Vec2[] = [];

  for (let y = bounds.yStart; y < bounds.yStart + bounds.height; y += 1) {
    for (let x = bounds.xStart; x < bounds.xStart + bounds.width; x += 1) {
      const tile = grid[y]?.[x];
      if (!tile) continue;
      const mountainNeighbors = getSameTerrainNeighborCount(grid, x, y, 'mountain');
      if (tile.type === 'empty' && mountainNeighbors >= 5 && canPlaceTerrainAt(grid, { x, y }, bounds)) {
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
`;

  // Insere antes da função de hash ou no fim do arquivo.
  if (s.includes('function hashTerrain(')) {
    s = s.replace(/\nfunction hashTerrain\(/, `${helpers}\nfunction hashTerrain(`);
  } else {
    s += helpers;
  }

  return s;
});

patch('src/game/rendering/renderWorld.ts', (source) => {
  let s = source;
  // Garante que tanto o nome singular quanto o plural funcionem. Mantemos o nome que já estiver no arquivo.
  if (s.includes("from './renderTerrainFeatures'") && !s.includes('drawTerrainFeatureBase')) {
    s = s.replace(
      /import \{([^}]+)\} from '\.\/renderTerrainFeatures';/,
      (match, imports) => {
        const names = new Set(imports.split(',').map((part) => part.trim()).filter(Boolean));
        names.add('drawTerrainFeatureBase');
        names.add('drawTerrainFeatureAnimation');
        return `import { ${[...names].join(', ')} } from './renderTerrainFeatures';`;
      },
    );
  }
  return s;
});

function validate() {
  const render = read('src/game/rendering/renderTerrainFeatures.ts');
  for (const required of ['drawTerrainFeatureBase', 'drawTerrainFeatureAnimation', 'drawTerrainFeatureAnimations']) {
    if (!render.includes(required)) throw new Error('renderTerrainFeatures.ts não contém ' + required + '.');
  }
}

validate();
console.log('Terrain Relief V1.3 Mountain Polish aplicado com sucesso.');
