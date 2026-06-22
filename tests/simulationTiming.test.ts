import assert from 'node:assert/strict';
import {
  FIXED_SIMULATION_STEP_SECONDS,
  SimulationClock,
} from '../src/game/engine/simulationClock';
import {
  getTargetRenderFps,
  shouldRenderFrame,
} from '../src/game/performance/renderScheduling';
import { GameWorld } from '../src/game/engine/simulation';
import { isRoadType } from '../src/game/city/grid';
import { TimeSystem } from '../src/game/engine/timeSystem';

for (const fps of [60, 30, 15]) {
  const { simulatedSeconds, debtSeconds, fixedSteps } = simulate(10, fps, 4);
  assert.equal(fixedSteps, 1200, `${fps} FPS should process every 4x fixed step`);
  assert.ok(Math.abs(simulatedSeconds - 40) < 1e-9);
  assert.ok(debtSeconds < FIXED_SIMULATION_STEP_SECONDS);
}

{
  const time = new TimeSystem();
  time.update(30);
  assert.equal(time.getLabel(), '10:00');
  assert.equal(time.getPeriod(), 'morning');
  time.update(7.5);
  assert.equal(time.getLabel(), '11:00');
  assert.equal(time.getPeriod(), 'noon');
}

{
  const clock = new SimulationClock();
  let simulatedSeconds = 0;
  clock.accumulate(1, 4, true);
  const paused = clock.processBudget(true, (dt) => { simulatedSeconds += dt; }, 10);
  assert.equal(paused.fixedSteps, 0);
  assert.equal(paused.debtSeconds, 0);

  clock.accumulate(1, 4, false);
  const resumed = clock.processBudget(false, (dt) => { simulatedSeconds += dt; }, Infinity);
  assert.equal(resumed.fixedSteps, 120);
  assert.ok(Math.abs(simulatedSeconds - 4) < 1e-9);
}

{
  const clock = new SimulationClock();
  clock.accumulate(1, 4, false);
  const hidden = clock.processBudget(true, () => {
    assert.fail('hidden or paused simulation must preserve existing debt');
  }, 10);
  assert.equal(hidden.fixedSteps, 0);
  assert.equal(hidden.pendingStepsBefore, 120);
  assert.equal(hidden.pendingStepsAfter, 120);
}

{
  const clock = new SimulationClock();
  let simulatedSeconds = 0;
  for (const speed of [1, 2, 4]) {
    clock.accumulate(1, speed, false);
    clock.processBudget(false, (dt) => { simulatedSeconds += dt; }, Infinity);
  }
  assert.ok(Math.abs(simulatedSeconds - 7) < 1e-9);
}

{
  const clock = new SimulationClock();
  let fixedSteps = 0;
  clock.accumulate(0, 4, false);
  clock.processBudget(false, () => { fixedSteps += 1; }, 10);
  assert.equal(fixedSteps, 0, 'a hidden-frame delta must not create simulation debt');
  clock.accumulate(2, 4, false);
  const result = clock.processBudget(false, () => { fixedSteps += 1; }, Infinity);
  assert.equal(result.fixedSteps, 240, 'large foreground deltas must not be discarded');
}

{
  const clock = new SimulationClock();
  let nowMs = 0;
  clock.accumulate(1, 4, false);
  const result = clock.processBudget(false, () => { nowMs += 5.5; }, 10, () => nowMs);
  assert.equal(result.fixedSteps, 2);
  assert.equal(result.pendingStepsBefore, 120);
  assert.equal(result.pendingStepsAfter, 118);
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.processingMs, 11);
}

{
  const clock = new SimulationClock();
  let nowMs = 0;
  clock.accumulate(1, 1, false);
  const result = clock.processBudget(false, () => { nowMs += 15; }, 10, () => nowMs);
  assert.equal(result.fixedSteps, 1, 'an indivisible slow step must still run');
  assert.equal(result.pendingStepsAfter, 29);
  assert.equal(result.budgetExhausted, true);
}

{
  const clock = new SimulationClock();
  let processedSteps = 0;
  clock.accumulate(1, 4, false);
  while (clock.getPendingSteps() > 0) {
    let nowMs = 0;
    clock.accumulate(0, 4, false);
    clock.processBudget(false, () => {
      processedSteps += 1;
      nowMs += 6;
    }, 10, () => nowMs);
  }
  assert.equal(processedSteps, 120);
  assert.ok(clock.getDebtSeconds() < FIXED_SIMULATION_STEP_SECONDS);
}

assert.equal(getTargetRenderFps(1, false, false), 0);
assert.equal(getTargetRenderFps(2, false, false), 30);
assert.equal(getTargetRenderFps(2, false, true), 15);
assert.equal(getTargetRenderFps(4, false, false), 20);
assert.equal(getTargetRenderFps(4, false, true), 10);
assert.equal(getTargetRenderFps(4, true, true), 0);

for (const targetFps of [30, 20, 15, 10]) {
  const sourceFps = 60;
  let renderElapsed = 0;
  let visualElapsed = 0;
  let renderedVisualSeconds = 0;
  let renders = 0;
  for (let frame = 0; frame < sourceFps; frame += 1) {
    const dt = 1 / sourceFps;
    renderElapsed += dt;
    visualElapsed += dt;
    if (shouldRenderFrame(renderElapsed, targetFps)) {
      renderedVisualSeconds += visualElapsed;
      renderElapsed = 0;
      visualElapsed = 0;
      renders += 1;
    }
  }
  assert.equal(renders, targetFps);
  assert.ok(Math.abs(renderedVisualSeconds + visualElapsed - 1) < 1e-9);
}

{
  const belowThreshold = createCarGroupingWorld(299);
  const groupedAtThreshold = createCarGroupingWorld(300);
  const groupedExtreme = createCarGroupingWorld(700);
  const prepare = (world: GameWorld) => (
    world as unknown as { prepareCarUpdateGroups(dt: number): typeof world.cars }
  ).prepareCarUpdateGroups(1 / 30);

  assert.equal(prepare(belowThreshold).length, 299);
  assert.ok(prepare(groupedAtThreshold).length < 300);
  assert.ok(prepare(groupedExtreme).length < 700);

  const selectedCar = groupedAtThreshold.cars[0];
  assert.ok(selectedCar);
  groupedAtThreshold.selected = { kind: 'car', carId: selectedCar.id };
  assert.ok(prepare(groupedAtThreshold).includes(selectedCar));

  groupedAtThreshold.selected = { kind: 'none' };
  selectedCar.stuckSeconds = 4;
  assert.ok(prepare(groupedAtThreshold).includes(selectedCar));

  selectedCar.stuckSeconds = 0;
  groupedAtThreshold.setActiveViewportBounds({
    minX: selectedCar.currentTileX,
    maxX: selectedCar.currentTileX,
    minY: selectedCar.currentTileY,
    maxY: selectedCar.currentTileY,
  });
  assert.ok(prepare(groupedAtThreshold).includes(selectedCar));
}

console.log('Simulation timing tests passed.');

function simulate(realSeconds: number, fps: number, speed: number) {
  const clock = new SimulationClock();
  let simulatedSeconds = 0;
  let fixedSteps = 0;
  let debtSeconds = 0;
  for (let frame = 0; frame < realSeconds * fps; frame += 1) {
    clock.accumulate(1 / fps, speed, false);
    const result = clock.processBudget(false, (dt) => {
      simulatedSeconds += dt;
    }, Infinity);
    fixedSteps += result.fixedSteps;
    debtSeconds = result.debtSeconds;
  }
  return { simulatedSeconds, debtSeconds, fixedSteps };
}

function createCarGroupingWorld(carCount: number): GameWorld {
  const world = new GameWorld({ enableTerrainRelief: false });
  for (let y = 2; y < world.grid.length - 2; y += 4) {
    for (let x = 1; x < (world.grid[y]?.length ?? 0) - 1; x += 1) {
      world.grid[y][x] = { x, y, type: 'avenue' };
    }
  }
  for (let y = 2; y < world.grid.length - 2; y += 1) {
    for (const x of [2, 12, 22, 32]) {
      const tile = world.grid[y]?.[x];
      if (tile && !isRoadType(tile.type)) world.grid[y][x] = { x, y, type: 'avenue' };
    }
  }
  (world as unknown as { updateTrafficMap(): void }).updateTrafficMap();
  world.seedPerformanceBenchmarkCars(carCount);
  world.setActiveViewportBounds({ minX: 100, minY: 100, maxX: 101, maxY: 101 });
  return world;
}
