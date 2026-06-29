import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Graphics } from 'pixi.js';
import { GameWorld } from '../src/game/engine/simulation';
import { drawAirLayer } from '../src/game/rendering/renderHelicopters';
import { DEFAULT_GRAPHICS_SETTINGS } from '../src/game/config/graphicsSettings';
import { normalizeLegacyRoadConnections } from '../src/game/city/roadConnections';
import type { HelicopterLine, Helipad } from '../src/types/helicopter.types';

const world = new GameWorld({ enableTerrainRelief: false });
prepareBenchmarkRoadGrid(world);
const cars = world.seedPerformanceBenchmarkCars(1000);
assert.equal(cars, 1000);

const pads: Helipad[] = Array.from({ length: 8 }, (_, index) => ({
  id: `pad-${index}`,
  name: `Pad ${index}`,
  x: 3 + (index % 4) * 10,
  y: index < 4 ? 4 : 24,
  accessRoad: { x: 3 + (index % 4) * 10, y: index < 4 ? 5 : 23 },
  coverageRadius: 12,
  capacity: 48,
  waiting: [],
  totalBoarded: 0,
  totalAlighted: 0,
  peakWaitingPassengers: 0,
  carsAvoidedFromHelipad: 0,
  activeLineIds: [],
  createdAtDay: 1,
}));
const lines: HelicopterLine[] = Array.from({ length: 4 }, (_, index) => ({
  id: `line-${index}`,
  name: `Line ${index}`,
  color: ['#f97316', '#a855f7', '#22c55e', '#06b6d4'][index],
  helipadIds: [pads[index].id, pads[index + 4].id],
  active: true,
  helicopterCount: 3,
  totalPassengers: 0,
  currentPassengers: 0,
  waitingPassengers: 0,
  carsAvoided: 0,
  completedCycles: 0,
}));
world.helipads = pads;
world.helicopterLines = lines;
world.helicopters = lines.flatMap((line, lineIndex) => Array.from({ length: 3 }, (_, index) => ({
  id: `heli-${lineIndex}-${index}`,
  lineId: line.id,
  fromHelipadId: line.helipadIds[index % 2],
  toHelipadId: line.helipadIds[(index + 1) % 2],
  progress: (index + 1) / 4,
  speed: 6,
  capacity: 6,
  passengers: [],
  state: 'flying' as const,
  stateProgress: 1,
  dwellSeconds: 0,
})));

const baselineWorld = new GameWorld({ enableTerrainRelief: false });
prepareBenchmarkRoadGrid(baselineWorld);
baselineWorld.seedPerformanceBenchmarkCars(1000);
const graphics = new Graphics();
const baselineGraphics = new Graphics();

for (let index = 0; index < 80; index += 1) {
  drawAirLayer(graphics, world, 40, index / 60, DEFAULT_GRAPHICS_SETTINGS);
  drawAirLayer(baselineGraphics, baselineWorld, 40, index / 60, DEFAULT_GRAPHICS_SETTINGS);
}

const samples = measure(() => drawAirLayer(graphics, world, 40, performance.now() / 1000, DEFAULT_GRAPHICS_SETTINGS), 500);
const baseline = measure(() => drawAirLayer(baselineGraphics, baselineWorld, 40, performance.now() / 1000, DEFAULT_GRAPHICS_SETTINGS), 500);
const result = {
  cars: world.getSnapshot().activeCars,
  helicopters: world.helicopters.length,
  averageAirRenderMs: average(samples),
  p95AirRenderMs: percentile(samples, 0.95),
  baselineP95Ms: percentile(baseline, 0.95),
};
const p95DeltaMs = Math.max(0, result.p95AirRenderMs - result.baselineP95Ms);
assert.equal(result.cars, 1000);
assert.equal(result.helicopters, 12);
assert.ok(p95DeltaMs < 1, `Air layer P95 delta was ${p95DeltaMs.toFixed(3)}ms`);
console.log(JSON.stringify({ ...result, p95DeltaMs }, null, 2));

function measure(fn: () => void, iterations: number): number[] {
  const values: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    fn();
    values.push(performance.now() - start);
  }
  return values;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function prepareBenchmarkRoadGrid(world: GameWorld): void {
  for (let y = 2; y < world.grid.length - 2; y += 4) {
    for (let x = 1; x < (world.grid[y]?.length ?? 0) - 1; x += 1) {
      world.grid[y][x] = { x, y, type: 'avenue' };
    }
  }
  for (let y = 2; y < world.grid.length - 2; y += 1) {
    for (const x of [2, 12, 22, 32]) {
      if (world.grid[y]?.[x]) world.grid[y][x] = { x, y, type: 'avenue' };
    }
  }
  normalizeLegacyRoadConnections(world.grid);
  (world as unknown as { updateTrafficMap(): void }).updateTrafficMap();
}
