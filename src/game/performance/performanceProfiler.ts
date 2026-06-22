import { EMPTY_PERFORMANCE_METRICS, type PerformanceMetrics } from './performanceTypes';
import type { SimulationAdvanceResult } from '../engine/simulationClock';

function smooth(previous: number, next: number, factor = 0.18): number {
  if (!Number.isFinite(previous) || previous <= 0) return next;
  return previous + (next - previous) * factor;
}

export class PerformanceProfiler {
  private metrics: PerformanceMetrics = { ...EMPTY_PERFORMANCE_METRICS };
  private frameCount = 0;
  private frameAccumSeconds = 0;
  private currentFixedSteps = 0;
  private frameSamples: number[] = [];

  beginUpdate(): void {
    this.currentFixedSteps = 0;
    this.metrics.fixedSteps = 0;
    this.metrics.vehicleLodCars = 0;
    this.metrics.tripAttemptsSkipped = 0;
    this.metrics.tripSpawnsSkipped = 0;
    this.metrics.lightweightCarsMs = 0;
  }

  addFixedStep(): void {
    this.currentFixedSteps += 1;
    this.metrics.fixedSteps = this.currentFixedSteps;
  }

  recordSimulationSlice(result: SimulationAdvanceResult): void {
    this.metrics.simulationDebtBeforeMs = Math.max(0, result.debtBeforeSeconds * 1000);
    this.metrics.simulationDebtRemainingMs = Math.max(0, result.debtSeconds * 1000);
    this.metrics.simulationPendingStepsBefore = result.pendingStepsBefore;
    this.metrics.simulationPendingStepsAfter = result.pendingStepsAfter;
    this.metrics.simulationBudgetExhausted = result.budgetExhausted ? 1 : 0;
    this.metrics.simulationSliceMs = result.processingMs;
  }

  recordRenderSkipped(): void {
    this.metrics.renderFramesSkipped += 1;
    if (this.metrics.renderFramesSkipped > 999999) this.metrics.renderFramesSkipped = 0;
  }

  time<T>(key: keyof PerformanceMetrics, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.recordTiming(key, performance.now() - start);
    }
  }

  recordTiming(key: keyof PerformanceMetrics, durationMs: number): void {
    const previous = Number(this.metrics[key] ?? 0);
    (this.metrics as Record<string, number>)[key] = smooth(previous, durationMs);
  }

  recordFrame(dt: number): void {
    const frameMs = dt > 0 ? dt * 1000 : 0;
    this.metrics.frameMs = smooth(this.metrics.frameMs, frameMs, 0.25);
    this.frameAccumSeconds += dt;
    this.frameCount += 1;
    if (frameMs > 0) {
      this.frameSamples.push(frameMs);
      if (this.frameSamples.length > 300) this.frameSamples.shift();
    }
    if (this.frameAccumSeconds >= 0.5) {
      this.metrics.fps = Math.round(this.frameCount / this.frameAccumSeconds);
      if (this.frameSamples.length) {
        const sorted = [...this.frameSamples].sort((a, b) => a - b);
        this.metrics.frameP95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      }
      this.frameAccumSeconds = 0;
      this.frameCount = 0;
    }
  }

  recordUpdateStep(durationMs: number): void {
    this.recordTiming('updateStepMs', durationMs);
  }

  recordRender(durationMs: number): void {
    this.recordTiming('renderWorldMs', durationMs);
  }

  recordTrafficWorker(durationMs: number): void {
    this.recordTiming('trafficWorkerMs', durationMs);
  }

  recordConnectionSkip(): void {
    this.metrics.connectionSkips += 1;
    if (this.metrics.connectionSkips > 9999) this.metrics.connectionSkips = 0;
  }

  recordPathfindingWorker(durationMs: number, success: boolean): void {
    this.recordTiming('pathfindingWorkerMs', durationMs);
    if (success) this.metrics.pathfindingCompleted += 1;
    else this.metrics.pathfindingFailed += 1;
  }

  recordPathfindingDropped(kind: 'deduped' | 'throttled' | 'dropped'): void {
    if (kind === 'deduped') this.metrics.pathfindingDeduped += 1;
    if (kind === 'throttled') this.metrics.pathfindingThrottled += 1;
    if (kind === 'dropped') this.metrics.pathfindingDropped += 1;
    if (this.metrics.pathfindingDeduped > 9999) this.metrics.pathfindingDeduped = 0;
    if (this.metrics.pathfindingThrottled > 9999) this.metrics.pathfindingThrottled = 0;
    if (this.metrics.pathfindingDropped > 9999) this.metrics.pathfindingDropped = 0;
  }

  recordTripBudget(attemptsSkipped: number, spawnsSkipped: number): void {
    this.metrics.tripAttemptsSkipped = attemptsSkipped;
    this.metrics.tripSpawnsSkipped = spawnsSkipped;
  }

  setCounters(partial: Partial<PerformanceMetrics>): void {
    this.metrics = { ...this.metrics, ...partial };
  }

  getSnapshot(): PerformanceMetrics {
    return { ...this.metrics };
  }
}

export function createPerformanceProfiler(): PerformanceProfiler {
  return new PerformanceProfiler();
}
