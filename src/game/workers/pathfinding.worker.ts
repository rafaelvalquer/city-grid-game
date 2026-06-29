import { findFastestPath } from '../pathfinding/pathfinder';
import type { TrafficCell, Tunnel } from '../../types/city.types';
import type { PathfindingWorkerMessage, PathfindingWorkerRequest, PathfindingWorkerResponse, WorkerGridSnapshot, WorkerTrafficCell } from './workerTypes';

let cachedGrid: WorkerGridSnapshot | undefined;
let cachedTrafficCells: WorkerTrafficCell[] = [];
let cachedTunnels: Tunnel[] = [];

function toTrafficMap(cells: WorkerTrafficCell[]): Map<string, TrafficCell> {
  const map = new Map<string, TrafficCell>();
  for (const cell of cells) map.set(cell.key ?? cell.x + ',' + cell.y, { ...cell });
  return map;
}

function handleFindPath(request: PathfindingWorkerRequest): void {
  const started = performance.now();
  try {
    const grid = request.grid ?? cachedGrid;
    const trafficCells = request.trafficCells ?? cachedTrafficCells;
    if (!grid) throw new Error('Path worker sem snapshot de grid.');
    const route = findFastestPath(grid, toTrafficMap(trafficCells), request.start, request.goal, {
      ...request.options,
      tunnels: request.options?.tunnels ?? request.tunnels ?? cachedTunnels,
    });
    const response: PathfindingWorkerResponse = {
      id: request.id,
      type: 'find-path-result',
      carId: request.carId,
      route,
      durationMs: performance.now() - started,
    };
    self.postMessage(response);
  } catch (error) {
    const response: PathfindingWorkerResponse = {
      id: request.id,
      type: 'find-path-result',
      carId: request.carId,
      route: [],
      durationMs: performance.now() - started,
      error: error instanceof Error ? error.message : 'Erro no worker de pathfinding',
    };
    self.postMessage(response);
  }
}

self.onmessage = (event: MessageEvent<PathfindingWorkerMessage>) => {
  const request = event.data;
  if (request.type === 'path-snapshot') {
    if (request.grid) cachedGrid = request.grid;
    if (request.trafficCells) cachedTrafficCells = request.trafficCells;
    if (request.tunnels) cachedTunnels = request.tunnels;
    return;
  }
  if (request.type === 'find-path') handleFindPath(request);
};
