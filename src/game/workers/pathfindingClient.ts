import { PERFORMANCE_CONFIG } from '../config/performanceConfig';
import type { Tunnel } from '../../types/city.types';
import type { PathfindingSnapshotRequest, PathfindingWorkerRequest, PathfindingWorkerResponse, WorkerGridSnapshot, WorkerTrafficCell } from './workerTypes';

export type PathfindingClientResult = PathfindingWorkerResponse;

type Pending = {
  resolve: (result: PathfindingClientResult | undefined) => void;
  startedAt: number;
  carId?: string;
};

export type PathfindingRequestStatus = 'accepted' | 'deduped' | 'throttled' | 'dropped' | 'unsupported';

export class PathfindingClient {
  private workers: Worker[] = [];
  private pending = new Map<string, Pending>();
  private pendingByCarId = new Map<string, string>();
  private sequence = 0;
  private nextWorker = 0;
  private requestTimes: number[] = [];

  constructor() {
    if (typeof Worker === 'undefined') return;
    const maxWorkers = Math.max(1, Math.min(PERFORMANCE_CONFIG.pathfindingWorkerMaxWorkers, (navigator.hardwareConcurrency ?? 4) - 1));
    for (let index = 0; index < maxWorkers; index += 1) {
      try {
        const worker = new Worker(new URL('./pathfinding.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<PathfindingWorkerResponse>) => this.handleResponse(event.data);
        worker.onerror = () => this.flushExpired(true);
        this.workers.push(worker);
      } catch {
        break;
      }
    }
  }

  updateSnapshots(grid?: WorkerGridSnapshot, trafficCells?: WorkerTrafficCell[], tunnels?: Tunnel[]): void {
    if (!this.workers.length) return;
    const request: PathfindingSnapshotRequest = {
      id: 'snapshot-' + (++this.sequence),
      type: 'path-snapshot',
      grid,
      trafficCells,
      tunnels,
    };
    for (const worker of this.workers) worker.postMessage(request);
  }

  request(payload: Omit<PathfindingWorkerRequest, 'id' | 'type'>, options: { highLoad?: boolean; extremeLoad?: boolean } = {}): { status: PathfindingRequestStatus; promise: Promise<PathfindingClientResult | undefined> } {
    this.flushExpired(false);
    if (!this.workers.length) return { status: 'unsupported', promise: Promise.resolve(undefined) };

    const pendingLimit = options.extremeLoad
      ? PERFORMANCE_CONFIG.pathfindingWorkerMaxPendingExtremeLoad
      : options.highLoad
        ? PERFORMANCE_CONFIG.pathfindingWorkerMaxPendingHighLoad
        : PERFORMANCE_CONFIG.pathfindingWorkerMaxPending;

    if (payload.carId && this.pendingByCarId.has(payload.carId)) {
      return { status: 'deduped', promise: Promise.resolve(undefined) };
    }
    if (this.pending.size >= pendingLimit) {
      return { status: 'dropped', promise: Promise.resolve(undefined) };
    }
    if (!this.canIssueRequest(options.extremeLoad ? PERFORMANCE_CONFIG.pathfindingWorkerExtremeRequestsPerSecond : PERFORMANCE_CONFIG.pathfindingWorkerHighLoadRequestsPerSecond)) {
      return { status: 'throttled', promise: Promise.resolve(undefined) };
    }

    const id = 'path-' + (++this.sequence);
    const request: PathfindingWorkerRequest = { id, type: 'find-path', ...payload };
    const worker = this.workers[this.nextWorker % this.workers.length];
    this.nextWorker += 1;

    const promise = new Promise<PathfindingClientResult | undefined>((resolve) => {
      this.pending.set(id, { resolve, startedAt: performance.now(), carId: payload.carId });
      if (payload.carId) this.pendingByCarId.set(payload.carId, id);
      worker.postMessage(request);
    });

    return { status: 'accepted', promise };
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  getWorkerCount(): number {
    return this.workers.length;
  }

  destroy(): void {
    for (const pending of this.pending.values()) pending.resolve(undefined);
    this.pending.clear();
    this.pendingByCarId.clear();
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }

  private canIssueRequest(limitPerSecond: number): boolean {
    const now = performance.now();
    this.requestTimes = this.requestTimes.filter((time) => now - time < 1000);
    if (this.requestTimes.length >= limitPerSecond) return false;
    this.requestTimes.push(now);
    return true;
  }

  private handleResponse(response: PathfindingWorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (pending.carId) this.pendingByCarId.delete(pending.carId);
    pending.resolve(response);
  }

  private flushExpired(flushAll: boolean): void {
    const now = performance.now();
    for (const [id, pending] of this.pending.entries()) {
      if (!flushAll && now - pending.startedAt < PERFORMANCE_CONFIG.pathfindingWorkerTimeoutMs) continue;
      this.pending.delete(id);
      if (pending.carId) this.pendingByCarId.delete(pending.carId);
      pending.resolve(undefined);
    }
  }
}

let singleton: PathfindingClient | undefined;
export function getPathfindingClient(): PathfindingClient {
  singleton ??= new PathfindingClient();
  return singleton;
}
