import assert from 'node:assert/strict';
import { GameWorld } from '../src/game/engine/simulation';
import { createGrid } from '../src/game/city/grid';
import type { Building } from '../src/types/city.types';
import { HELICOPTER_CONFIG } from '../src/game/config/helicopterConfig';

const world = new GameWorld({ enableTerrainRelief: false });
world.grid = createGrid(40, 30);
world.entityIndex.setGrid(world.grid);
world.buildings = [];
world.cars = [];
world.entityIndex.rebuild([], []);
world.money = 50_000;

world.grid[3][2] = { x: 2, y: 3, type: 'road' };
world.grid[3][22] = { x: 22, y: 3, type: 'road' };
assert.equal(world.buildHelipadAt(2, 2), true);
assert.equal(world.buildHelipadAt(22, 2), true);
assert.equal(world.money, 50_000 - HELICOPTER_CONFIG.helipadBuildCost * 2);

const [firstPad, secondPad] = world.helipads;
assert.equal(firstPad.coverageRadius, 12);
assert.equal(firstPad.capacity, 48);
const lineResult = world.createHelicopterLine(firstPad.id, secondPad.id);
assert.equal(lineResult.success, true);
assert.equal(world.helicopters.length, 1);
assert.equal(world.cars.length, 0);

const house: Building = {
  id: 'house-l3', type: 'house', level: 3, x: 3, y: 2, width: 1, height: 1,
  population: 16, jobs: 1, attraction: 4, connected: true, nearestRoad: { x: 2, y: 3 }, tripsToday: 0,
};
const office: Building = {
  id: 'office-l3', type: 'office', level: 3, x: 21, y: 2, width: 1, height: 1,
  population: 0, jobs: 30, attraction: 18, connected: true, nearestRoad: { x: 22, y: 3 }, tripsToday: 0,
};
const ineligible: Building = { ...house, id: 'house-l2', level: 2, x: 4, population: 7 };
world.addBuilding(house);
world.addBuilding(office);
world.addBuilding(ineligible);

const internals = world as unknown as {
  tryCreateHelicopterTrip(origin: Building, destination: Building): boolean;
  updateHelicopters(dt: number): void;
};
const originalRandom = Math.random;
Math.random = () => 0;
try {
  assert.equal(internals.tryCreateHelicopterTrip(house, office), true);
  assert.equal(internals.tryCreateHelicopterTrip(office, house), true);
  assert.equal(internals.tryCreateHelicopterTrip(ineligible, office), false);
  for (let index = 0; index < 60; index += 1) internals.tryCreateHelicopterTrip(house, office);
} finally {
  Math.random = originalRandom;
}
assert.equal(firstPad.waiting.reduce((sum, group) => sum + group.count, 0), 48);

const carCountBeforeFlight = world.cars.length;
for (let index = 0; index < 360; index += 1) internals.updateHelicopters(1 / 30);
assert.ok(world.helicopterTripsCompleted > 0);
assert.equal(world.helicopterTripsCompleted, world.helicopterCarsAvoided);
assert.equal(world.cars.length, carCountBeforeFlight);
assert.ok(world.helicopters.every((helicopter) => helicopter.passengers.reduce((sum, group) => sum + group.count, 0) <= 6));

const line = world.helicopterLines[0];
assert.equal(world.setHelicopterCount(line.id, 3).success, true);
assert.equal(world.helicopters.length, 3);
assert.equal(world.setHelicopterCount(line.id, 4).count, 3);
assert.equal(world.setHelicopterCount(line.id, 1).success, true);
assert.equal(world.helicopters.length, 1);

for (const [x, y] of [[2, 18], [15, 18], [35, 18]] as const) {
  world.grid[y + 1][x] = { x, y: y + 1, type: 'road' };
  assert.equal(world.buildHelipadAt(x, y), true);
}
assert.equal(world.createHelicopterLine(firstPad.id, world.helipads[2].id).success, true);
assert.equal(world.createHelicopterLine(firstPad.id, world.helipads[3].id).success, true);
assert.equal(firstPad.activeLineIds.length, 3);
assert.equal(world.createHelicopterLine(firstPad.id, world.helipads[4].id).success, false);

const closeWorld = new GameWorld({ enableTerrainRelief: false });
closeWorld.grid = createGrid(40, 30);
closeWorld.money = 10_000;
closeWorld.grid[2][1] = { x: 1, y: 2, type: 'road' };
closeWorld.grid[2][8] = { x: 8, y: 2, type: 'road' };
assert.equal(closeWorld.buildHelipadAt(1, 1), true);
assert.equal(closeWorld.buildHelipadAt(8, 1), true);
assert.equal(closeWorld.createHelicopterLine(closeWorld.helipads[0].id, closeWorld.helipads[1].id).success, false);

const moneyBeforeRemoval = world.money;
assert.equal(world.removeHelipad(firstPad.id), true);
assert.equal(world.money, moneyBeforeRemoval - HELICOPTER_CONFIG.helipadRemoveCost);
assert.equal(world.helicopterLines.length, 0);
assert.equal(world.helicopters.length, 0);

console.log('helicopter system tests passed');
