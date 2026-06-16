import type { Tile, TrafficCell, Vec2 } from '../../types/city.types';
import { ROAD_CONFIG } from '../config/roadConfig';
import { BUS_LANE_CONFIG } from '../config/transitConfig';
import { isRoadType, keyOf } from '../city/grid';
import { getDrivableNeighbors } from '../systems/roundabouts';
import { PriorityQueue } from './PriorityQueue';

export type PathVehicleType = 'car' | 'bus';
export type PathfindingOptions = { vehicleType?: PathVehicleType };

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

export function findFastestPath(grid: Tile[][], traffic: Map<string, TrafficCell>, start: Vec2, goal: Vec2, options: PathfindingOptions = {}): Vec2[] {
  const vehicleType = options.vehicleType ?? 'car';
  const startKey = keyOf(start.x, start.y);
  const goalKey = keyOf(goal.x, goal.y);
  const open = new PriorityQueue<string>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, heuristic(start, goal)]]);

  open.push(startKey, heuristic(start, goal));

  while (!open.isEmpty()) {
    const entry = open.pop();
    if (!entry) break;

    const current = entry.value;
    const bestKnownPriority = fScore.get(current) ?? Infinity;

    // The queue intentionally allows duplicate entries instead of doing decrease-key.
    // If this popped entry is stale, keep the newer/lower-priority path in the heap.
    if (entry.priority > bestKnownPriority) continue;

    if (current === goalKey) return reconstruct(cameFrom, current);

    const [cx, cy] = current.split(',').map(Number);
    for (const next of getDrivableNeighbors(grid, { x: cx, y: cy })) {
      const tile = grid[next.y]?.[next.x];
      if (!tile || !isRoadType(tile.type)) continue;

      const roadType = tile.type as 'road' | 'avenue' | 'roundabout';
      const hasBusLane = Boolean(tile.busLane && roadType !== 'roundabout');
      const busLanePathMultiplier = hasBusLane
        ? vehicleType === 'bus' ? BUS_LANE_CONFIG.busPathCostMultiplier : BUS_LANE_CONFIG.carPathPenalty
        : 1;
      const base = ROAD_CONFIG[roadType].pathCost * busLanePathMultiplier;
      const trafficCell = traffic.get(keyOf(next.x, next.y));
      const congestionResistance = hasBusLane && vehicleType === 'bus' ? BUS_LANE_CONFIG.busCongestionResistance : 1;
      const congestionPenalty = trafficCell ? Math.max(0, trafficCell.congestion - 0.2) * 12 * congestionResistance : 0;
      const tentative = (gScore.get(current) ?? Infinity) + base + congestionPenalty;
      const nextKey = keyOf(next.x, next.y);

      if (tentative < (gScore.get(nextKey) ?? Infinity)) {
        cameFrom.set(nextKey, current);
        gScore.set(nextKey, tentative);

        const priority = tentative + heuristic(next, goal);
        fScore.set(nextKey, priority);
        open.push(nextKey, priority);
      }
    }
  }

  return [];
}
