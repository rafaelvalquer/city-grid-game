export const FIXED_SIMULATION_STEP_SECONDS = 1 / 30;

export type SimulationAdvanceResult = {
  fixedSteps: number;
  debtBeforeSeconds: number;
  debtSeconds: number;
  pendingStepsBefore: number;
  pendingStepsAfter: number;
  budgetExhausted: boolean;
  processingMs: number;
};

export class SimulationClock {
  private accumulatorSeconds = 0;

  accumulate(
    realDeltaSeconds: number,
    speed: number,
    paused: boolean,
  ): number {
    if (!paused && speed > 0 && Number.isFinite(realDeltaSeconds)) {
      this.accumulatorSeconds += Math.max(0, realDeltaSeconds) * speed;
    }
    return this.accumulatorSeconds;
  }

  processBudget(
    paused: boolean,
    updateStep: (deltaSeconds: number) => void,
    budgetMs: number,
    now: () => number = () => performance.now(),
  ): SimulationAdvanceResult {
    const debtBeforeSeconds = this.accumulatorSeconds;
    const pendingStepsBefore = this.getPendingSteps();
    const startedAt = now();

    let fixedSteps = 0;
    while (!paused && this.getPendingSteps() > 0) {
      updateStep(FIXED_SIMULATION_STEP_SECONDS);
      this.accumulatorSeconds = Math.max(0, this.accumulatorSeconds - FIXED_SIMULATION_STEP_SECONDS);
      fixedSteps += 1;
      if (now() - startedAt >= Math.max(0, budgetMs)) break;
    }

    const processingMs = Math.max(0, now() - startedAt);
    const pendingStepsAfter = this.getPendingSteps();
    return {
      fixedSteps,
      debtBeforeSeconds,
      debtSeconds: this.accumulatorSeconds,
      pendingStepsBefore,
      pendingStepsAfter,
      budgetExhausted: pendingStepsAfter > 0 && processingMs >= Math.max(0, budgetMs),
      processingMs,
    };
  }

  getDebtSeconds(): number {
    return this.accumulatorSeconds;
  }

  getPendingSteps(): number {
    return Math.floor((this.accumulatorSeconds + Number.EPSILON) / FIXED_SIMULATION_STEP_SECONDS);
  }
}
