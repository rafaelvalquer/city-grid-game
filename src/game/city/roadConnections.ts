import type { RoadDirection, Tile, Vec2 } from '../../types/city.types';
import { getNeighbors4ForGrid, isRoadType, keyOf } from './grid';

export const ROAD_CONNECTION_BITS: Record<RoadDirection, number> = {
  north: 1,
  east: 2,
  south: 4,
  west: 8,
};

export const OPPOSITE_ROAD_DIRECTION: Record<RoadDirection, RoadDirection> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
};

export function roadDirectionBetween(from: Vec2, to: Vec2): RoadDirection | undefined {
  if (to.x === from.x && to.y === from.y - 1) return 'north';
  if (to.x === from.x + 1 && to.y === from.y) return 'east';
  if (to.x === from.x && to.y === from.y + 1) return 'south';
  if (to.x === from.x - 1 && to.y === from.y) return 'west';
  return undefined;
}

export function roadDirectionOffset(direction: RoadDirection): Vec2 {
  if (direction === 'north') return { x: 0, y: -1 };
  if (direction === 'east') return { x: 1, y: 0 };
  if (direction === 'south') return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

export function hasRoadConnection(tile: Tile | undefined, direction: RoadDirection): boolean {
  return Boolean(tile && isRoadType(tile.type) && ((tile.roadConnections ?? 0) & ROAD_CONNECTION_BITS[direction]));
}

export function areRoadTilesConnected(grid: Tile[][], from: Vec2, to: Vec2): boolean {
  const direction = roadDirectionBetween(from, to);
  if (!direction) return false;
  const fromTile = grid[from.y]?.[from.x];
  const toTile = grid[to.y]?.[to.x];
  if (!fromTile || !toTile || !isRoadType(fromTile.type) || !isRoadType(toTile.type)) return false;
  if (fromTile.type === 'roundabout' || toTile.type === 'roundabout') {
    return hasRoadConnection(fromTile, direction)
      && hasRoadConnection(toTile, OPPOSITE_ROAD_DIRECTION[direction]);
  }
  return hasRoadConnection(fromTile, direction)
    && hasRoadConnection(toTile, OPPOSITE_ROAD_DIRECTION[direction]);
}

export function setRoadConnection(grid: Tile[][], from: Vec2, to: Vec2, connected: boolean): boolean {
  const direction = roadDirectionBetween(from, to);
  if (!direction) return false;
  const fromTile = grid[from.y]?.[from.x];
  const toTile = grid[to.y]?.[to.x];
  if (!fromTile || !toTile || !isRoadType(fromTile.type) || !isRoadType(toTile.type)) return false;
  const opposite = OPPOSITE_ROAD_DIRECTION[direction];
  const fromMask = fromTile.roadConnections ?? 0;
  const toMask = toTile.roadConnections ?? 0;
  fromTile.roadConnections = connected
    ? fromMask | ROAD_CONNECTION_BITS[direction]
    : fromMask & ~ROAD_CONNECTION_BITS[direction];
  toTile.roadConnections = connected
    ? toMask | ROAD_CONNECTION_BITS[opposite]
    : toMask & ~ROAD_CONNECTION_BITS[opposite];
  return true;
}

export function connectRoadPath(grid: Tile[][], path: Vec2[]): void {
  for (let index = 1; index < path.length; index += 1) {
    setRoadConnection(grid, path[index - 1], path[index], true);
  }
}

export function getConnectedRoadNeighbors(grid: Tile[][], position: Vec2): Vec2[] {
  const tile = grid[position.y]?.[position.x];
  if (!tile || !isRoadType(tile.type)) return [];
  return getNeighbors4ForGrid(grid, position).filter((next) => areRoadTilesConnected(grid, position, next));
}

export function getRoadConnectionDirections(grid: Tile[][], position: Vec2): RoadDirection[] {
  return getConnectedRoadNeighbors(grid, position)
    .map((next) => roadDirectionBetween(position, next))
    .filter((direction): direction is RoadDirection => Boolean(direction));
}

export function clearRoadConnections(grid: Tile[][], position: Vec2): void {
  const tile = grid[position.y]?.[position.x];
  if (!tile || !isRoadType(tile.type)) return;
  for (const next of getNeighbors4ForGrid(grid, position)) {
    if (isRoadType(grid[next.y]?.[next.x]?.type)) setRoadConnection(grid, position, next, false);
  }
  tile.roadConnections = 0;
}

export function validateRoadConnectionReciprocity(grid: Tile[][]): boolean {
  for (const row of grid) {
    for (const tile of row) {
      if (!isRoadType(tile.type)) continue;
      for (const direction of Object.keys(ROAD_CONNECTION_BITS) as RoadDirection[]) {
        if (!hasRoadConnection(tile, direction)) continue;
        const offset = roadDirectionOffset(direction);
        const neighbor = grid[tile.y + offset.y]?.[tile.x + offset.x];
        if (!neighbor || !isRoadType(neighbor.type) || !hasRoadConnection(neighbor, OPPOSITE_ROAD_DIRECTION[direction])) return false;
      }
    }
  }
  return true;
}

export function normalizeLegacyRoadConnections(grid: Tile[][]): void {
  const roads = grid.flat().filter((tile) => isRoadType(tile.type));
  if (!roads.some((tile) => tile.roadConnections === undefined)) return;
  for (const tile of roads) tile.roadConnections = 0;

  const candidates: Array<{ from: Vec2; to: Vec2; score: number }> = [];
  for (const tile of roads) {
    for (const next of [{ x: tile.x + 1, y: tile.y }, { x: tile.x, y: tile.y + 1 }]) {
      const neighbor = grid[next.y]?.[next.x];
      if (!neighbor || !isRoadType(neighbor.type)) continue;
      const horizontal = next.x !== tile.x;
      const score = legacyConnectionScore(grid, tile, neighbor, horizontal);
      candidates.push({ from: tile, to: next, score });
    }
  }

  const parent = new Map<string, string>();
  const find = (value: string): string => {
    const root = parent.get(value) ?? value;
    if (root === value) return root;
    const resolved = find(root);
    parent.set(value, resolved);
    return resolved;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const tile of roads) parent.set(keyOf(tile.x, tile.y), keyOf(tile.x, tile.y));

  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const a = keyOf(candidate.from.x, candidate.from.y);
    const b = keyOf(candidate.to.x, candidate.to.y);
    const preservesAxis = candidate.score >= 3;
    if (preservesAxis || find(a) !== find(b)) {
      setRoadConnection(grid, candidate.from, candidate.to, true);
      union(a, b);
    }
  }
}

function legacyConnectionScore(grid: Tile[][], from: Tile, to: Tile, horizontal: boolean): number {
  if (from.type === 'roundabout' || to.type === 'roundabout') return 100;
  let score = from.type === to.type ? 1 : 0;
  if (horizontal) {
    if (isRoadType(grid[from.y]?.[from.x - 1]?.type) || isRoadType(grid[to.y]?.[to.x + 1]?.type)) score += 3;
    if (from.oneWay === 'east' || from.oneWay === 'west' || to.oneWay === 'east' || to.oneWay === 'west') score += 2;
    if (isRoadType(grid[from.y - 1]?.[from.x]?.type) && isRoadType(grid[to.y - 1]?.[to.x]?.type)) score -= 2;
    if (isRoadType(grid[from.y + 1]?.[from.x]?.type) && isRoadType(grid[to.y + 1]?.[to.x]?.type)) score -= 2;
  } else {
    if (isRoadType(grid[from.y - 1]?.[from.x]?.type) || isRoadType(grid[to.y + 1]?.[to.x]?.type)) score += 3;
    if (from.oneWay === 'north' || from.oneWay === 'south' || to.oneWay === 'north' || to.oneWay === 'south') score += 2;
    if (isRoadType(grid[from.y]?.[from.x - 1]?.type) && isRoadType(grid[to.y]?.[to.x - 1]?.type)) score -= 2;
    if (isRoadType(grid[from.y]?.[from.x + 1]?.type) && isRoadType(grid[to.y]?.[to.x + 1]?.type)) score -= 2;
  }
  return score;
}
