import type { Graphics } from 'pixi.js';
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
  waterDeep: 0x135f86,
  water: 0x1f8fba,
  waterLight: 0x75d7f0,
  shore: 0xb7d58c,
  shoreDark: 0x6da06a,
  glint: 0xe9fbff,
};

const MOUNTAIN = {
  base: 0x6b764e,
  baseDark: 0x505d3f,
  moss: 0x7f8b59,
  stone: 0x7d7465,
  stoneLight: 0xb4ad9a,
  stoneDark: 0x514d45,
  ridge: 0xd0c8ae,
  shadow: 0x22281f,
  fog: 0xc8d8bd,
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
  if (args.tile.type === 'mountain') drawConnectedMountainBase(graphics, args);
}

export function drawTerrainFeatureAnimation(graphics: Graphics, grid: Tile[][], ts: number, timeSeconds: number): void {
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y];
    for (let x = 0; x < (row?.length ?? 0); x += 1) {
      const tile = row?.[x];
      if (!tile) continue;
      if (tile.type === 'lake') drawLakeWaterAnimation(graphics, grid, tile, x, y, ts, timeSeconds);
      if (tile.type === 'mountain') drawMountainMist(graphics, grid, tile, x, y, ts, timeSeconds);
    }
  }
}

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

function terrainHeightLevel(grid: Tile[][], tile: Tile, x: number, y: number): number {
  if (typeof tile.terrainDepth === 'number' && Number.isFinite(tile.terrainDepth)) {
    return clamp(Math.round(tile.terrainDepth), 1, 5);
  }

  let level = 1;
  for (let radius = 1; radius <= 4; radius += 1) {
    let fullySurrounded = true;
    for (let yy = y - radius; yy <= y + radius; yy += 1) {
      for (let xx = x - radius; xx <= x + radius; xx += 1) {
        if (Math.abs(xx - x) + Math.abs(yy - y) > radius) continue;
        if (!sameTerrain(grid, xx, yy, 'mountain')) fullySurrounded = false;
      }
    }
    if (fullySurrounded) level += 1;
  }
  return clamp(level, 1, 5);
}

function rectForConnectedTile(x: number, y: number, ts: number, n: TerrainNeighbors, inset: number) {
  const px = x * ts;
  const py = y * ts;
  const left = n.w ? 0 : inset;
  const right = n.e ? 0 : inset;
  const top = n.n ? 0 : inset;
  const bottom = n.s ? 0 : inset;
  return {
    x: px + left,
    y: py + top,
    width: ts - left - right,
    height: ts - top - bottom,
    px,
    py,
    left,
    right,
    top,
    bottom,
  };
}

function drawConnectedLakeBase(graphics: Graphics, args: TerrainRenderArgs): void {
  const { grid, tile, x, y, ts } = args;
  const n = neighbors(grid, x, y, 'lake');
  const hash = hash2(x, y, 83);
  const rect = rectForConnectedTile(x, y, ts, n, 3);
  const waveTint = (hash % 3) * 0x030506;
  const depth = clamp(tile.terrainDepth ?? (externalEdgeCount(n) <= 1 ? 3 : 2), 1, 5);
  const waterColor = depth >= 4 ? LAKE.waterDeep : LAKE.water - waveTint;

  // Margem externa orgânica: só aparece no contorno do cluster, não entre tiles conectados.
  if (!n.n) graphics.roundRect(rect.px + 3, rect.py + 1, ts - 6, 7, 5).fill({ color: LAKE.shore, alpha: 0.62 });
  if (!n.s) graphics.roundRect(rect.px + 3, rect.py + ts - 8, ts - 6, 7, 5).fill({ color: LAKE.shoreDark, alpha: 0.42 });
  if (!n.w) graphics.roundRect(rect.px + 1, rect.py + 3, 7, ts - 6, 5).fill({ color: LAKE.shore, alpha: 0.48 });
  if (!n.e) graphics.roundRect(rect.px + ts - 8, rect.py + 3, 7, ts - 6, 5).fill({ color: LAKE.shoreDark, alpha: 0.36 });

  // Corpo d'água conectado entre tiles. O retângulo cobre a grade interna do cluster.
  graphics.roundRect(rect.x, rect.y, rect.width, rect.height, externalEdgeCount(n) >= 3 ? 9 : 2)
    .fill({ color: waterColor, alpha: 0.96 });

  // Interior mais profundo para clusters maiores.
  if (externalEdgeCount(n) <= 1) {
    graphics.roundRect(rect.px + 2, rect.py + 2, ts - 4, ts - 4, 4)
      .fill({ color: LAKE.waterDeep, alpha: 0.18 + depth * 0.025 });
  }

  // Canto orgânico apenas onde falta diagonal externa.
  drawLakeCorner(graphics, rect.px, rect.py, ts, !n.n && !n.w, 'nw');
  drawLakeCorner(graphics, rect.px, rect.py, ts, !n.n && !n.e, 'ne');
  drawLakeCorner(graphics, rect.px, rect.py, ts, !n.s && !n.w, 'sw');
  drawLakeCorner(graphics, rect.px, rect.py, ts, !n.s && !n.e, 'se');
}

function drawLakeCorner(graphics: Graphics, px: number, py: number, ts: number, active: boolean, corner: 'nw' | 'ne' | 'sw' | 'se'): void {
  if (!active) return;
  const x = corner.endsWith('e') ? px + ts - 9 : px + 3;
  const y = corner.startsWith('s') ? py + ts - 9 : py + 3;
  graphics.circle(x + 3, y + 3, 4).fill({ color: LAKE.shore, alpha: 0.34 });
}

function drawLakeWaterAnimation(graphics: Graphics, grid: Tile[][], tile: Tile, x: number, y: number, ts: number, timeSeconds: number): void {
  const n = neighbors(grid, x, y, 'lake');
  const rect = rectForConnectedTile(x, y, ts, n, 4);
  const px = x * ts;
  const py = y * ts;
  const speed = TERRAIN_CONFIG.lakeAnimationSpeed ?? 0.8;
  const phase = timeSeconds * speed + x * 0.71 + y * 0.43;
  const wave = Math.sin(phase) * 0.65;
  const alpha = 0.11 + Math.sin(phase * 0.7) * 0.025;

  graphics.roundRect(rect.x + 6, rect.y + 9 + wave, Math.max(5, rect.width - 12), 2.4, 2)
    .fill({ color: LAKE.glint, alpha });

  if ((hash2(x, y, 91) % 3) === 0) {
    graphics.roundRect(px + 9, py + ts * 0.58 - wave, ts - 18, 2, 2)
      .fill({ color: LAKE.waterLight, alpha: 0.13 });
  }
}

function drawConnectedMountainBase(graphics: Graphics, args: TerrainRenderArgs): void {
  const { grid, tile, x, y, ts } = args;
  const n = neighbors(grid, x, y, 'mountain');
  const h = terrainHeightLevel(grid, tile, x, y);
  const hash = hash2(x, y, 117);
  const rect = rectForConnectedTile(x, y, ts, n, 2);
  const edgeCount = externalEdgeCount(n);
  const centerTile = edgeCount <= 1;
  const variant = tile.terrainVariant ?? hash % 6;

  // Sombra de contato no contorno externo; não aparece entre tiles conectados.
  if (!n.s) graphics.roundRect(rect.px + 4, rect.py + ts - 7, ts - 8, 6, 4).fill({ color: MOUNTAIN.shadow, alpha: 0.17 + h * 0.022 });
  if (!n.e) graphics.roundRect(rect.px + ts - 7, rect.py + 5, 6, ts - 10, 4).fill({ color: MOUNTAIN.shadow, alpha: 0.12 + h * 0.018 });

  // Base conectada. Cobre a grade interna e cria a massa única da montanha.
  graphics.roundRect(rect.x, rect.y, rect.width, rect.height, edgeCount >= 3 ? 8 : 2)
    .fill({ color: variant % 2 === 0 ? MOUNTAIN.base : MOUNTAIN.baseDark, alpha: 0.92 });

  // Textura de musgo/terra. Pouco contraste para não virar ruído.
  graphics.roundRect(rect.px + 5 + (hash % 3), rect.py + ts - 11 - (hash % 2), Math.max(8, ts - 14), 4, 3)
    .fill({ color: MOUNTAIN.moss, alpha: 0.13 + (variant % 3) * 0.02 });

  drawMountainOuterRim(graphics, rect.px, rect.py, ts, n, h);

  if (h <= 1) {
    drawLowMountainSlope(graphics, rect.px, rect.py, ts, hash, n);
    return;
  }

  if (h === 2 || !centerTile) {
    drawMidMountainSlope(graphics, rect.px, rect.py, ts, h, hash, n);
    return;
  }

  drawMountainPeak(graphics, rect.px, rect.py, ts, h, hash, variant);
  if (h >= 4 && (hash % 4) !== 0) drawSecondaryPeak(graphics, rect.px, rect.py, ts, h, hash);
}

function drawMountainOuterRim(graphics: Graphics, px: number, py: number, ts: number, n: TerrainNeighbors, h: number): void {
  const alpha = 0.16 + h * 0.018;
  if (!n.n) graphics.roundRect(px + 3, py + 2, ts - 6, 5, 3).fill({ color: MOUNTAIN.moss, alpha: 0.28 });
  if (!n.w) graphics.roundRect(px + 2, py + 5, 5, ts - 10, 3).fill({ color: MOUNTAIN.moss, alpha: 0.2 });
  if (!n.s) graphics.roundRect(px + 4, py + ts - 8, ts - 8, 5, 3).fill({ color: MOUNTAIN.shadow, alpha });
  if (!n.e) graphics.roundRect(px + ts - 8, py + 6, 5, ts - 12, 3).fill({ color: MOUNTAIN.shadow, alpha: alpha * 0.75 });
}

function drawLowMountainSlope(graphics: Graphics, px: number, py: number, ts: number, hash: number, n: TerrainNeighbors): void {
  const raise = 1 + (hash % 3) * 0.4;
  graphics
    .moveTo(px + ts * 0.14, py + ts * 0.78)
    .lineTo(px + ts * 0.46, py + ts * (0.47 - raise * 0.01))
    .lineTo(px + ts * 0.84, py + ts * 0.79)
    .closePath()
    .fill({ color: MOUNTAIN.stoneDark, alpha: n.s ? 0.12 : 0.22 });

  graphics.roundRect(px + ts * 0.18, py + ts * 0.67, ts * 0.55, 3, 2)
    .fill({ color: MOUNTAIN.stoneLight, alpha: 0.11 });
}

function drawMidMountainSlope(graphics: Graphics, px: number, py: number, ts: number, h: number, hash: number, n: TerrainNeighbors): void {
  const offset = (hash % 5 - 2) * 0.7;
  const peakY = py + ts * (0.37 - h * 0.025);
  const leftX = px + ts * (0.13 + (hash % 2) * 0.02);
  const midX = px + ts * 0.48 + offset;
  const rightX = px + ts * 0.86;
  const bottomY = py + ts * 0.8;

  graphics
    .moveTo(leftX, bottomY)
    .lineTo(midX, peakY)
    .lineTo(rightX, bottomY)
    .closePath()
    .fill({ color: MOUNTAIN.stone, alpha: 0.72 });

  graphics
    .moveTo(midX, peakY)
    .lineTo(rightX, bottomY)
    .lineTo(px + ts * 0.55, bottomY)
    .closePath()
    .fill({ color: MOUNTAIN.stoneDark, alpha: 0.42 });

  graphics
    .moveTo(midX, peakY)
    .lineTo(px + ts * 0.39, py + ts * 0.58)
    .lineTo(px + ts * 0.52, py + ts * 0.55)
    .closePath()
    .fill({ color: MOUNTAIN.stoneLight, alpha: n.n ? 0.28 : 0.38 });
}

function drawMountainPeak(graphics: Graphics, px: number, py: number, ts: number, h: number, hash: number, variant: number): void {
  const heightBoost = Math.min(0.13, h * 0.024);
  const midX = px + ts * (0.48 + ((hash % 7) - 3) * 0.012);
  const peakY = py + ts * (0.25 - heightBoost);
  const leftX = px + ts * (0.10 + (variant % 3) * 0.018);
  const rightX = px + ts * (0.88 - (variant % 2) * 0.018);
  const bottomY = py + ts * 0.84;

  graphics
    .moveTo(leftX, bottomY)
    .lineTo(midX, peakY)
    .lineTo(rightX, bottomY)
    .closePath()
    .fill({ color: MOUNTAIN.stone, alpha: 0.9 });

  graphics
    .moveTo(midX, peakY)
    .lineTo(rightX, bottomY)
    .lineTo(px + ts * 0.57, bottomY)
    .closePath()
    .fill({ color: MOUNTAIN.stoneDark, alpha: 0.48 });

  graphics
    .moveTo(midX, peakY)
    .lineTo(px + ts * 0.36, py + ts * 0.58)
    .lineTo(px + ts * 0.52, py + ts * 0.55)
    .closePath()
    .fill({ color: MOUNTAIN.stoneLight, alpha: 0.44 });

  graphics
    .moveTo(midX, peakY + 1)
    .lineTo(midX - ts * 0.08, peakY + ts * 0.17)
    .lineTo(midX + ts * 0.08, peakY + ts * 0.17)
    .closePath()
    .fill({ color: MOUNTAIN.ridge, alpha: h >= 4 ? 0.76 : 0.46 });
}

function drawSecondaryPeak(graphics: Graphics, px: number, py: number, ts: number, h: number, hash: number): void {
  const side = hash % 2 === 0 ? -1 : 1;
  const cx = px + ts * (0.48 + side * 0.22);
  const top = py + ts * (0.39 - h * 0.012);
  graphics
    .moveTo(cx - ts * 0.15, py + ts * 0.8)
    .lineTo(cx, top)
    .lineTo(cx + ts * 0.18, py + ts * 0.8)
    .closePath()
    .fill({ color: MOUNTAIN.stoneDark, alpha: 0.4 });
  graphics
    .moveTo(cx, top)
    .lineTo(cx - ts * 0.055, top + ts * 0.11)
    .lineTo(cx + ts * 0.055, top + ts * 0.11)
    .closePath()
    .fill({ color: MOUNTAIN.stoneLight, alpha: 0.22 });
}

function drawMountainMist(graphics: Graphics, grid: Tile[][], tile: Tile, x: number, y: number, ts: number, timeSeconds: number): void {
  const h = terrainHeightLevel(grid, tile, x, y);
  if (h < 4) return;
  const hash = hash2(x, y, 131);
  if (hash % 5 !== 0) return;
  const phase = timeSeconds * 0.42 + hash * 0.01;
  const alpha = 0.035 + Math.sin(phase) * 0.012;
  graphics.roundRect(x * ts + 5, y * ts + 8 + Math.sin(phase) * 1.5, ts - 10, 4, 4)
    .fill({ color: MOUNTAIN.fog, alpha });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Compatibilidade: alguns patches anteriores importaram o nome no plural.
export function drawTerrainFeatureAnimations(graphics: Graphics, grid: Tile[][], ts: number, timeSeconds: number): void {
  drawTerrainFeatureAnimation(graphics, grid, ts, timeSeconds);
}
