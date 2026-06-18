import type { TrafficMapWorkerRequest, TrafficMapWorkerResponse, WorkerTrafficCell } from './workerTypes';
import { ROAD_CONFIG } from '../config/roadConfig';
import { BUS_LANE_CONFIG } from '../config/transitConfig';
import type { RoadType } from '../../types/city.types';

function roadCapacity(type: RoadType, busLane?: boolean): number {
  const base = ROAD_CONFIG[type].capacity;
  if (busLane && type !== 'roundabout') return Math.max(1, Math.floor(base * BUS_LANE_CONFIG.carCapacityMultiplier));
  return base;
}

self.onmessage = (event: MessageEvent<TrafficMapWorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'traffic-map') return;

  const started = performance.now();
  const map = new Map<string, WorkerTrafficCell>();

  for (const row of request.grid) {
    for (const tile of row) {
      if (tile.type !== 'road' && tile.type !== 'avenue' && tile.type !== 'roundabout') continue;
      const capacity = roadCapacity(tile.type as RoadType, tile.busLane);
      map.set(tile.x + ',' + tile.y, { x: tile.x, y: tile.y, cars: 0, capacity, congestion: 0 });
    }
  }

  for (const car of request.cars) {
    if (car.status === 'arrived' || car.status === 'no_route') continue;
    if (car.lifecyclePhase && car.lifecyclePhase !== 'driving' && car.lifecyclePhase !== 'spawnExit' && car.lifecyclePhase !== 'destinationEntry') continue;
    const key = car.currentTileX + ',' + car.currentTileY;
    const cell = map.get(key);
    if (!cell) continue;
    cell.cars += car.vehicleType === 'bus' ? 2 : 1;
  }

  let totalCongestion = 0;
  let count = 0;
  let maxCongestion = 0;
  const trafficCells: WorkerTrafficCell[] = [];
  for (const cell of map.values()) {
    cell.congestion = cell.capacity > 0 ? cell.cars / cell.capacity : 0;
    totalCongestion += cell.congestion;
    maxCongestion = Math.max(maxCongestion, cell.congestion);
    count += 1;
    trafficCells.push(cell);
  }

  const response: TrafficMapWorkerResponse = {
    id: request.id,
    type: 'traffic-map-result',
    trafficCells,
    averageCongestion: count ? totalCongestion / count : 0,
    maxCongestion,
    durationMs: performance.now() - started,
  };
  self.postMessage(response);
};
