import type { RoadDirection, TileType, Tunnel, Vec2 } from '../../types/city.types';
import type { PathfindingOptions } from '../pathfinding/pathfinder';

export type WorkerTile = {
  x: number;
  y: number;
  type: TileType;
  oneWay?: RoadDirection;
  roadConnections?: number;
  busLane?: boolean;
  bikeLane?: boolean;
};

export type WorkerGridSnapshot = WorkerTile[][];

export type WorkerTrafficCell = {
  key?: string;
  x: number;
  y: number;
  cars: number;
  capacity: number;
  congestion: number;
};

export type WorkerCarSnapshot = {
  id: string;
  x: number;
  y: number;
  currentTileX: number;
  currentTileY: number;
  vehicleType?: 'car' | 'bus';
  lifecyclePhase?: string;
  status?: string;
};

export type TrafficMapWorkerRequest = {
  id: string;
  type: 'traffic-map';
  grid: WorkerGridSnapshot;
  cars: WorkerCarSnapshot[];
};

export type TrafficMapWorkerResponse = {
  id: string;
  type: 'traffic-map-result';
  trafficCells: WorkerTrafficCell[];
  averageCongestion: number;
  maxCongestion: number;
  durationMs: number;
};

export type PathfindingSnapshotRequest = {
  id: string;
  type: 'path-snapshot';
  grid?: WorkerGridSnapshot;
  trafficCells?: WorkerTrafficCell[];
  tunnels?: Tunnel[];
};

export type PathfindingWorkerRequest = {
  id: string;
  type: 'find-path';
  carId?: string;
  start: Vec2;
  goal: Vec2;
  grid?: WorkerGridSnapshot;
  trafficCells?: WorkerTrafficCell[];
  tunnels?: Tunnel[];
  options?: PathfindingOptions;
};

export type PathfindingWorkerResponse = {
  id: string;
  type: 'find-path-result';
  carId?: string;
  route: import('../../types/city.types').RouteStep[];
  durationMs: number;
  error?: string;
};

export type PathfindingWorkerMessage = PathfindingWorkerRequest | PathfindingSnapshotRequest;
