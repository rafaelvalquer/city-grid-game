import type { RouteLayer, RouteStep, Tile, TrafficCell, Tunnel, Vec2 } from '../../types/city.types';
import { ROAD_CONFIG } from '../config/roadConfig';
import { BUS_LANE_CONFIG } from '../config/transitConfig';
import { isRoadType, keyOf } from '../city/grid';
import { getDrivableNeighbors } from '../systems/roundabouts';
import { PriorityQueue } from './PriorityQueue';

export type PathVehicleType = 'car' | 'bus';
export type PathfindingOptions = { vehicleType?: PathVehicleType; tunnels?: Tunnel[] };

type PathNode = RouteStep & { layer: RouteLayer; tunnelId?: string };

function heuristic(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function tunnelTrafficKey(tunnelId: string, x: number, y: number): string {
  return `tunnel:${tunnelId}:${x},${y}`;
}

function nodeKey(node: PathNode): string {
  return node.layer === 'tunnel'
    ? `tunnel:${node.tunnelId}:${node.x},${node.y}`
    : `surface:${node.x},${node.y}`;
}

function parseNode(key: string): PathNode {
  const parts = key.split(':');
  if (parts[0] === 'tunnel') {
    const [x, y] = parts[2].split(',').map(Number);
    return { x, y, layer: 'tunnel', tunnelId: parts[1] };
  }
  const [x, y] = parts[1].split(',').map(Number);
  return { x, y, layer: 'surface' };
}

function reconstruct(cameFrom: Map<string, string>, current: string): RouteStep[] {
  const total = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    total.push(current);
  }
  return total.reverse().map((key) => {
    const node = parseNode(key);
    return node.layer === 'tunnel'
      ? { x: node.x, y: node.y, layer: 'tunnel', tunnelId: node.tunnelId }
      : { x: node.x, y: node.y, layer: 'surface' };
  });
}

export function findFastestPath(grid: Tile[][], traffic: Map<string, TrafficCell>, start: Vec2, goal: Vec2, options: PathfindingOptions = {}): RouteStep[] {
  const vehicleType = options.vehicleType ?? 'car';
  const tunnels = (options.tunnels ?? []).filter((tunnel) => (
    tunnel.active
    && tunnel.path.length >= 2
    && isRoadType(grid[tunnel.entryAccessRoad.y]?.[tunnel.entryAccessRoad.x]?.type)
    && isRoadType(grid[tunnel.exitAccessRoad.y]?.[tunnel.exitAccessRoad.x]?.type)
  ));
  const portalToTunnels = new Map<string, Tunnel[]>();
  for (const tunnel of tunnels) {
    for (const accessRoad of [tunnel.entryAccessRoad, tunnel.exitAccessRoad]) {
      const key = keyOf(accessRoad.x, accessRoad.y);
      const list = portalToTunnels.get(key) ?? [];
      list.push(tunnel);
      portalToTunnels.set(key, list);
    }
  }
  const tunnelById = new Map(tunnels.map((tunnel) => [tunnel.id, tunnel]));
  const startKey = nodeKey({ x: start.x, y: start.y, layer: 'surface' });
  const goalKey = nodeKey({ x: goal.x, y: goal.y, layer: 'surface' });
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

    const currentNode = parseNode(current);
    for (const next of getPathNeighbors(grid, currentNode, portalToTunnels, tunnelById)) {
      const stepCost = getStepCost(grid, traffic, next, vehicleType, tunnelById);
      if (!Number.isFinite(stepCost)) continue;
      const tentative = (gScore.get(current) ?? Infinity) + stepCost;
      const nextKey = nodeKey(next);

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

function getPathNeighbors(
  grid: Tile[][],
  current: PathNode,
  portalToTunnels: Map<string, Tunnel[]>,
  tunnelById: Map<string, Tunnel>,
): PathNode[] {
  if (current.layer === 'surface') {
    const result: PathNode[] = getDrivableNeighbors(grid, current).map((next) => ({ ...next, layer: 'surface' }));
    for (const tunnel of portalToTunnels.get(keyOf(current.x, current.y)) ?? []) {
      if (samePosition(current, tunnel.entryAccessRoad)) {
        result.push({ x: tunnel.entryPortal.x, y: tunnel.entryPortal.y, layer: 'tunnel', tunnelId: tunnel.id });
      }
      if (samePosition(current, tunnel.exitAccessRoad)) {
        result.push({ x: tunnel.exitPortal.x, y: tunnel.exitPortal.y, layer: 'tunnel', tunnelId: tunnel.id });
      }
    }
    return result;
  }

  const tunnel = current.tunnelId ? tunnelById.get(current.tunnelId) : undefined;
  if (!tunnel) return [];
  const result: PathNode[] = [];
  const index = tunnel.path.findIndex((pos) => pos.x === current.x && pos.y === current.y);
  if (index > 0) result.push({ ...tunnel.path[index - 1], layer: 'tunnel', tunnelId: tunnel.id });
  if (index >= 0 && index < tunnel.path.length - 1) result.push({ ...tunnel.path[index + 1], layer: 'tunnel', tunnelId: tunnel.id });
  if (samePosition(current, tunnel.entryPortal)) {
    result.push({ x: tunnel.entryAccessRoad.x, y: tunnel.entryAccessRoad.y, layer: 'surface' });
  }
  if (samePosition(current, tunnel.exitPortal)) {
    result.push({ x: tunnel.exitAccessRoad.x, y: tunnel.exitAccessRoad.y, layer: 'surface' });
  }
  return result;
}

function samePosition(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function getStepCost(
  grid: Tile[][],
  traffic: Map<string, TrafficCell>,
  next: PathNode,
  vehicleType: PathVehicleType,
  tunnelById: Map<string, Tunnel>,
): number {
  if (next.layer === 'tunnel') {
    const tunnel = next.tunnelId ? tunnelById.get(next.tunnelId) : undefined;
    if (!tunnel) return Infinity;
    const config = ROAD_CONFIG[tunnel.type];
    const trafficCell = traffic.get(tunnelTrafficKey(tunnel.id, next.x, next.y));
    const congestionPenalty = trafficCell ? Math.max(0, trafficCell.congestion - 0.2) * 10 : 0;
    return config.pathCost + congestionPenalty;
  }

  const tile = grid[next.y]?.[next.x];
  if (!tile || !isRoadType(tile.type)) return Infinity;
  const roadType = tile.type as 'road' | 'avenue' | 'roundabout';
  const hasBusLane = Boolean(tile.busLane && roadType !== 'roundabout');
  const busLanePathMultiplier = hasBusLane
    ? vehicleType === 'bus' ? BUS_LANE_CONFIG.busPathCostMultiplier : BUS_LANE_CONFIG.carPathPenalty
    : 1;
  const base = ROAD_CONFIG[roadType].pathCost * busLanePathMultiplier;
  const trafficCell = traffic.get(keyOf(next.x, next.y));
  const congestionResistance = hasBusLane && vehicleType === 'bus' ? BUS_LANE_CONFIG.busCongestionResistance : 1;
  const congestionPenalty = trafficCell ? Math.max(0, trafficCell.congestion - 0.2) * 12 * congestionResistance : 0;
  return base + congestionPenalty;
}
