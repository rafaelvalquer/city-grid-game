import type { Car } from '../../types/agent.types';
import type { Tile, TrafficCell } from '../../types/city.types';
import type { WorkerCarSnapshot, WorkerGridSnapshot, WorkerTrafficCell } from './workerTypes';

export function createWorkerGridSnapshot(grid: Tile[][]): WorkerGridSnapshot {
  return grid.map((row) => row.map((tile) => ({
    x: tile.x,
    y: tile.y,
    type: tile.type,
    oneWay: tile.oneWay,
    roadConnections: tile.roadConnections,
    busLane: tile.busLane,
    bikeLane: tile.bikeLane,
  })));
}

export function createWorkerTrafficSnapshot(traffic: Map<string, TrafficCell>): WorkerTrafficCell[] {
  return Array.from(traffic.entries()).map(([key, cell]) => ({
    key,
    x: cell.x,
    y: cell.y,
    cars: cell.cars,
    capacity: cell.capacity,
    congestion: cell.congestion,
  }));
}

export function trafficCellsToMap(cells: WorkerTrafficCell[]): Map<string, TrafficCell> {
  const map = new Map<string, TrafficCell>();
  for (const cell of cells) map.set(cell.key ?? cell.x + ',' + cell.y, { ...cell });
  return map;
}

export function createWorkerCarSnapshot(cars: Car[]): WorkerCarSnapshot[] {
  return cars.map((car) => ({
    id: car.id,
    x: car.x,
    y: car.y,
    currentTileX: car.currentTileX,
    currentTileY: car.currentTileY,
    vehicleType: car.vehicleType,
    lifecyclePhase: car.lifecyclePhase,
    status: car.status,
  }));
}
