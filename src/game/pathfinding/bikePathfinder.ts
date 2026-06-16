import type { Tile, Vec2 } from '../../types/city.types';
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
