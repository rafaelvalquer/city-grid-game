import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { GameWorld } from '../src/game/engine/simulation';
import { FIXED_SIMULATION_STEP_SECONDS } from '../src/game/engine/simulationClock';
import { isRoadType } from '../src/game/city/grid';
import { createBuilding } from '../src/game/city/buildings';
import type { BuildingType } from '../src/types/city.types';
import { CAMPAIGN_CITIES } from '../src/game/campaign/campaignMaps';

const world = new GameWorld({ enableTerrainRelief: false });
prepareBenchmarkRoadGrid(world);
const cars = world.seedPerformanceBenchmarkCars(1000);
assert.equal(cars, 1000);
const constructionTypes: BuildingType[] = ['house', 'shop', 'office'];
let constructionCount = 0;
for (const row of world.grid) {
  for (const tile of row) {
    if (constructionCount >= 40) break;
    if (tile.type !== 'empty') continue;
    world.addBuilding(createBuilding(
      constructionTypes[constructionCount % constructionTypes.length],
      tile.x,
      tile.y,
    ));
    constructionCount += 1;
  }
  if (constructionCount >= 40) break;
}
assert.equal(constructionCount, 40);

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
const campaignBenchmarks = CAMPAIGN_CITIES.map((city) => {
  const campaignWorld = new GameWorld({ mode: 'campaign', campaignCityId: city.id });
  const campaignStartedAt = performance.now();
  for (let frame = 0; frame < 60; frame += 1) campaignWorld.update(1 / 60, 1, false);
  return {
    cityId: city.id,
    durationMs: performance.now() - campaignStartedAt,
    buildings: campaignWorld.buildings.length,
    roadTiles: campaignWorld.grid.flat().filter((tile) => tile.type === 'road' || tile.type === 'avenue').length,
    longestStraightRoad: longestStraightRoadRun(campaignWorld),
    blockedTiles: campaignWorld.getSnapshot().terrainBlockedTiles,
  };
});

console.log(JSON.stringify({
  seededCars: cars,
  activeCarsAfterBenchmark: world.cars.length,
  simultaneousConstructions: constructionCount,
  sourceFps,
  realSeconds,
  simulatedSeconds: fixedSteps * FIXED_SIMULATION_STEP_SECONDS,
  fixedSteps,
  debtMs: debtSeconds * 1000,
  maxSliceMs,
  budgetExhaustedSlices,
  benchmarkDurationMs: durationMs,
  campaignBenchmarks,
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

function longestStraightRoadRun(worldToMeasure: GameWorld): number {
  let longest = 0;
  for (const row of worldToMeasure.grid) {
    let run = 0;
    for (const tile of row) {
      run = tile.type === 'road' || tile.type === 'avenue' ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  const width = worldToMeasure.grid[0]?.length ?? 0;
  for (let x = 0; x < width; x += 1) {
    let run = 0;
    for (let y = 0; y < worldToMeasure.grid.length; y += 1) {
      const tile = worldToMeasure.grid[y]?.[x];
      run = tile?.type === 'road' || tile?.type === 'avenue' ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  return longest;
}
