import { trafficCellsToMap } from './gridSnapshot';
import type { TrafficMapWorkerRequest, TrafficMapWorkerResponse } from './workerTypes';
import type { TrafficCell } from '../../types/city.types';

export type TrafficMapClientResult = {
  traffic: Map<string, TrafficCell>;
  averageCongestion: number;
  maxCongestion: number;
  durationMs: number;
};

export class TrafficMapClient {
  private worker?: Worker;
  private pending = new Map<string, (result: TrafficMapClientResult | undefined) => void>();
  private sequence = 0;
  private supported = typeof Worker !== 'undefined';

  constructor() {
    if (!this.supported) return;
    try {
      this.worker = new Worker(new URL('./trafficMap.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<TrafficMapWorkerResponse>) => {
        const response = event.data;
        const resolver = this.pending.get(response.id);
        if (!resolver) return;
        this.pending.delete(response.id);
        resolver({
          traffic: trafficCellsToMap(response.trafficCells),
          averageCongestion: response.averageCongestion,
          maxCongestion: response.maxCongestion,
          durationMs: response.durationMs,
        });
      };
      this.worker.onerror = () => {
        this.flush(undefined);
      };
    } catch {
      this.worker = undefined;
    }
  }

  request(payload: Omit<TrafficMapWorkerRequest, 'id' | 'type'>): Promise<TrafficMapClientResult | undefined> {
    if (!this.worker) return Promise.resolve(undefined);
    const id = 'traffic-' + (++this.sequence);
    const request: TrafficMapWorkerRequest = { id, type: 'traffic-map', ...payload };
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker?.postMessage(request);
    });
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  destroy(): void {
    this.flush(undefined);
    this.worker?.terminate();
    this.worker = undefined;
  }

  private flush(result: TrafficMapClientResult | undefined): void {
    for (const resolver of this.pending.values()) resolver(result);
    this.pending.clear();
  }
}

let singleton: TrafficMapClient | undefined;
export function getTrafficMapClient(): TrafficMapClient {
  singleton ??= new TrafficMapClient();
  return singleton;
}
