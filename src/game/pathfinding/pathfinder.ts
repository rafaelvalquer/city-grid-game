import type { Tile, TrafficCell, Vec2 } from '../../types/city.types';
import { ROAD_CONFIG } from '../config/roadConfig';
import { isRoadType, keyOf } from '../city/grid';
import { getDrivableNeighbors } from '../systems/roundabouts';

function heuristic(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

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

export function findFastestPath(grid: Tile[][], traffic: Map<string, TrafficCell>, start: Vec2, goal: Vec2): Vec2[] {
  const startKey = keyOf(start.x, start.y);
  const goalKey = keyOf(goal.x, goal.y);
  const open = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, heuristic(start, goal)]]);

  while (open.size > 0) {
    let current = [...open].sort((a, b) => (fScore.get(a) ?? Infinity) - (fScore.get(b) ?? Infinity))[0];
    if (current === goalKey) return reconstruct(cameFrom, current);
    open.delete(current);

    const [cx, cy] = current.split(',').map(Number);
    for (const next of getDrivableNeighbors(grid, { x: cx, y: cy })) {
      const tile = grid[next.y][next.x];
      if (!isRoadType(tile.type)) continue;
      const roadType = tile.type as 'road' | 'avenue' | 'roundabout';
      const base = ROAD_CONFIG[roadType].pathCost;
      const t = traffic.get(keyOf(next.x, next.y));
      const congestionPenalty = t ? Math.max(0, t.congestion - 0.2) * 12 : 0;
      const tentative = (gScore.get(current) ?? Infinity) + base + congestionPenalty;
      const nextKey = keyOf(next.x, next.y);
      if (tentative < (gScore.get(nextKey) ?? Infinity)) {
        cameFrom.set(nextKey, current);
        gScore.set(nextKey, tentative);
        fScore.set(nextKey, tentative + heuristic(next, goal));
        open.add(nextKey);
      }
    }
  }
  return [];
}
