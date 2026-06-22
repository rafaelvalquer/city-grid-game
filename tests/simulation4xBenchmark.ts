import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { GameWorld } from '../src/game/engine/simulation';
import { FIXED_SIMULATION_STEP_SECONDS } from '../src/game/engine/simulationClock';
import { isRoadType } from '../src/game/city/grid';

const world = new GameWorld({ enableTerrainRelief: false });
prepareBenchmarkRoadGrid(world);
const cars = world.seedPerformanceBenchmarkCars(1000);
assert.equal(cars, 1000);

const sourceFps = 15;
const realSeconds = 1;
let fixedSteps = 0;
let debtSeconds = 0;
let maxSliceMs = 0;
let budgetExhaustedSlices = 0;
const startedAt = performance.now();

for (let frame = 0; frame < sourceFps * realSeconds; frame += 1) {
  const result = world.update(1 / sourceFps, 4, false);
  fixedSteps += result.fixedSteps;
  debtSeconds = result.debtSeconds;
  maxSliceMs = Math.max(maxSliceMs, result.processingMs);
  if (result.budgetExhausted) budgetExhaustedSlices += 1;
}
while (debtSeconds + Number.EPSILON >= FIXED_SIMULATION_STEP_SECONDS) {
  const result = world.update(0, 4, false);
  fixedSteps += result.fixedSteps;
  debtSeconds = result.debtSeconds;
  maxSliceMs = Math.max(maxSliceMs, result.processingMs);
  if (result.budgetExhausted) budgetExhaustedSlices += 1;
}

const durationMs = performance.now() - startedAt;
const expectedSteps = realSeconds * 4 / FIXED_SIMULATION_STEP_SECONDS;
assert.equal(fixedSteps, expectedSteps);
assert.ok(debtSeconds < FIXED_SIMULATION_STEP_SECONDS);

console.log(JSON.stringify({
  seededCars: cars,
  activeCarsAfterBenchmark: world.cars.length,
  sourceFps,
  realSeconds,
  simulatedSeconds: fixedSteps * FIXED_SIMULATION_STEP_SECONDS,
  fixedSteps,
  debtMs: debtSeconds * 1000,
  maxSliceMs,
  budgetExhaustedSlices,
  benchmarkDurationMs: durationMs,
}, null, 2));

function prepareBenchmarkRoadGrid(worldToPrepare: GameWorld): void {
  for (let y = 2; y < worldToPrepare.grid.length - 2; y += 4) {
    for (let x = 1; x < (worldToPrepare.grid[y]?.length ?? 0) - 1; x += 1) {
      worldToPrepare.grid[y][x] = { x, y, type: 'avenue' };
    }
  }
  for (let y = 2; y < worldToPrepare.grid.length - 2; y += 1) {
    for (const x of [2, 12, 22, 32]) {
      const tile = worldToPrepare.grid[y]?.[x];
      if (tile && !isRoadType(tile.type)) worldToPrepare.grid[y][x] = { x, y, type: 'avenue' };
    }
  }
  (worldToPrepare as unknown as { updateTrafficMap(): void }).updateTrafficMap();
}
