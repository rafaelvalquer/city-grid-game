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

class PriorityQueue<T> {
  private items: { value: T; priority: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(value: T, priority: number): void {
    this.items.push({ value, priority });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last) return undefined;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return first.value;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= this.items[index].priority) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
      if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
      if (smallest === index) return;

      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }
}

export function findFastestPath(grid: Tile[][], traffic: Map<string, TrafficCell>, start: Vec2, goal: Vec2): Vec2[] {
  const startKey = keyOf(start.x, start.y);
  const goalKey = keyOf(goal.x, goal.y);
  const open = new PriorityQueue<string>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();
  open.push(startKey, heuristic(start, goal));

  while (open.size > 0) {
    const current = open.pop();
    if (!current || closed.has(current)) continue;
    if (current === goalKey) return reconstruct(cameFrom, current);
    closed.add(current);

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
        open.push(nextKey, tentative + heuristic(next, goal));
      }
    }
  }
  return [];
}
