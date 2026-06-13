import type { Tile, Vec2 } from '../../types/city.types';
import { getNeighbors4, inBounds, isRoadType, keyOf } from '../city/grid';

const RING_OFFSETS: Vec2[] = [
  { x: 0, y: -1 },
  { x: -1, y: -1 },
  { x: -1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 0 },
  { x: 1, y: -1 },
];

export function isRoundaboutTile(tile: Tile | undefined): boolean {
  return tile?.type === 'roundabout';
}

export function isRoundaboutCenter(tile: Tile | undefined): boolean {
  return tile?.type === 'roundaboutCenter';
}

export function getRoundaboutArea(center: Vec2): Vec2[] {
  const area: Vec2[] = [];
  for (let y = center.y - 1; y <= center.y + 1; y += 1) {
    for (let x = center.x - 1; x <= center.x + 1; x += 1) area.push({ x, y });
  }
  return area;
}

export function getRoundaboutRing(center: Vec2): Vec2[] {
  return RING_OFFSETS.map((offset) => ({ x: center.x + offset.x, y: center.y + offset.y }));
}

export function getRoundaboutCenter(grid: Tile[][], pos: Vec2): Vec2 | undefined {
  if (isRoundaboutCenter(grid[pos.y]?.[pos.x])) return pos;
  if (!isRoundaboutTile(grid[pos.y]?.[pos.x])) return undefined;

  for (let y = pos.y - 1; y <= pos.y + 1; y += 1) {
    for (let x = pos.x - 1; x <= pos.x + 1; x += 1) {
      if (isRoundaboutCenter(grid[y]?.[x])) return { x, y };
    }
  }
  return undefined;
}

export function findRoundaboutCenterForTile(grid: Tile[][], pos: Vec2): Vec2 | undefined {
  if (isRoundaboutTile(grid[pos.y]?.[pos.x]) || isRoundaboutCenter(grid[pos.y]?.[pos.x])) {
    return getRoundaboutCenter(grid, pos);
  }
  return undefined;
}

export function canPlaceRoundabout(grid: Tile[][], center: Vec2): { valid: boolean; reason?: string } {
  for (const tilePos of getRoundaboutArea(center)) {
    if (!inBounds(tilePos.x, tilePos.y)) return { valid: false, reason: 'A rotatória precisa caber em uma área 3x3.' };
    const tile = grid[tilePos.y][tilePos.x];
    if (tile.type === 'building') return { valid: false, reason: 'Não é possível construir rotatória sobre prédio.' };
  }
  return { valid: true };
}

export function isInsideRoundabout(grid: Tile[][], pos: Vec2): boolean {
  return isRoundaboutTile(grid[pos.y]?.[pos.x]);
}

export function isEnteringRoundabout(grid: Tile[][], from: Vec2, to: Vec2): boolean {
  return !isInsideRoundabout(grid, from) && isInsideRoundabout(grid, to);
}

export function isRoundaboutExit(grid: Tile[][], from: Vec2, to: Vec2): boolean {
  return isInsideRoundabout(grid, from) && !isInsideRoundabout(grid, to) && isRoadType(grid[to.y]?.[to.x]?.type);
}

export function getRoundaboutNext(grid: Tile[][], pos: Vec2): Vec2 | undefined {
  const center = getRoundaboutCenter(grid, pos);
  if (!center) return undefined;

  const ring = getRoundaboutRing(center);
  const index = ring.findIndex((tile) => tile.x === pos.x && tile.y === pos.y);
  if (index < 0) return undefined;
  return ring[(index + 1) % ring.length];
}

export function isValidRoundaboutInternalMove(grid: Tile[][], from: Vec2, to: Vec2): boolean {
  const next = getRoundaboutNext(grid, from);
  return Boolean(next && next.x === to.x && next.y === to.y);
}

export function getDrivableNeighbors(grid: Tile[][], current: Vec2): Vec2[] {
  const tile = grid[current.y]?.[current.x];
  if (!tile || isRoundaboutCenter(tile)) return [];

  const neighbors = getNeighbors4(current).filter((next) => isRoadType(grid[next.y]?.[next.x]?.type));
  if (!isRoundaboutTile(tile)) {
    return neighbors.filter((next) => !isRoundaboutTile(grid[next.y]?.[next.x]) || isEntrySide(grid, current, next));
  }

  const allowed = new Map<string, Vec2>();
  const roundaboutNext = getRoundaboutNext(grid, current);
  if (roundaboutNext) allowed.set(keyOf(roundaboutNext.x, roundaboutNext.y), roundaboutNext);

  for (const next of neighbors) {
    if (isRoundaboutTile(grid[next.y]?.[next.x])) continue;
    if (isRoundaboutCenter(grid[next.y]?.[next.x])) continue;
    if (!isExitSide(grid, current, next)) continue;
    allowed.set(keyOf(next.x, next.y), next);
  }
  return [...allowed.values()];
}

function isEntrySide(grid: Tile[][], from: Vec2, to: Vec2): boolean {
  const center = getRoundaboutCenter(grid, to);
  if (!center) return false;
  const dx = to.x - center.x;
  const dy = to.y - center.y;
  const fromDx = from.x - center.x;
  const fromDy = from.y - center.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
  return Math.sign(fromDx) === Math.sign(dx) && Math.sign(fromDy) === Math.sign(dy);
}

function isExitSide(grid: Tile[][], from: Vec2, to: Vec2): boolean {
  const center = getRoundaboutCenter(grid, from);
  if (!center) return false;
  const dx = from.x - center.x;
  const dy = from.y - center.y;
  const toDx = to.x - center.x;
  const toDy = to.y - center.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
  return Math.sign(toDx) === Math.sign(dx) && Math.sign(toDy) === Math.sign(dy);
}
