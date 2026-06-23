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
import { createBuilding, isBuildingOperational } from '../src/game/city/buildings';
import { BUILDING_CONSTRUCTION_SECONDS, getBuildingLevelConfig } from '../src/game/config/buildingConfig';
import { getBuildingConstructionStage } from '../src/game/rendering/renderBuildings';
import { chooseTrip } from '../src/game/agents/tripGenerator';
import type { Building, BuildingType } from '../src/types/city.types';
import { CAMPAIGN_CITIES, CAMPAIGN_LEVEL_1_CITIES, CAMPAIGN_LEVEL_2_CITIES, CAMPAIGN_LEVEL_3_CITIES } from '../src/game/campaign/campaignMaps';
import {
  isCampaignLevel2Unlocked,
  isCampaignLevel3Unlocked,
  LEGACY_CAMPAIGN_PROGRESS_STORAGE_KEY,
  LEGACY_CAMPAIGN_PROGRESS_V2_STORAGE_KEY,
  loadCampaignProgress,
  saveCampaignCompletion,
} from '../src/game/campaign/campaignProgress';
import {
  getCampaignCardOffset,
  getCampaignSwipeDirection,
  getCampaignWheelDirection,
  getInitialCampaignIndex,
  wrapCampaignIndex,
} from '../src/game/campaign/campaignCarousel';

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

{
  const initialWorld = new GameWorld({ enableTerrainRelief: false });
  assert.ok(initialWorld.buildings.length > 0);
  assert.ok(initialWorld.buildings.every((building) => (
    building.constructionState === 'operational'
    && building.constructionProgress === 1
    && isBuildingOperational(building)
  )));
}

for (const type of ['house', 'shop', 'office'] as BuildingType[]) {
  const world = new GameWorld({ enableTerrainRelief: false });
  const position = findEmptyTile(world);
  const building = createBuilding(type, position.x, position.y);
  const baseline = world.getSnapshot();
  world.addBuilding(building);

  assert.equal(building.constructionState, 'constructing');
  assert.equal(building.constructionProgress, 0);
  assert.equal(building.population, 0);
  assert.equal(building.jobs, 0);
  assert.equal(building.attraction, 0);
  assert.equal(world.getSnapshot().population, baseline.population);
  assert.equal(world.getSnapshot().disconnectedBuildings, baseline.disconnectedBuildings);
  assert.equal(world.getBuildingUpgradeStatus(building).reason, 'Aguardando conclusão da obra');

  const duration = BUILDING_CONSTRUCTION_SECONDS[type];
  const updateConstruction = (dt: number) => (
    world as unknown as { updateBuildingConstruction(deltaSeconds: number): void }
  ).updateBuildingConstruction(dt);
  const steps = Math.round(duration / FIXED_SIMULATION_STEP_SECONDS);
  for (let step = 0; step < steps - 1; step += 1) updateConstruction(FIXED_SIMULATION_STEP_SECONDS);
  assert.equal(building.constructionState, 'constructing');
  updateConstruction(FIXED_SIMULATION_STEP_SECONDS);

  const config = getBuildingLevelConfig(type, 1);
  assert.equal(building.constructionState, 'operational');
  assert.equal(building.constructionProgress, 1);
  assert.equal(building.population, config.population);
  assert.equal(building.jobs, config.jobs);
  assert.equal(building.attraction, config.attraction);
}

for (const speed of [1, 2, 4]) {
  const world = new GameWorld({ enableTerrainRelief: false });
  const position = findEmptyTile(world);
  const building = createBuilding('house', position.x, position.y);
  world.addBuilding(building);
  const clock = new SimulationClock();
  const realSeconds = BUILDING_CONSTRUCTION_SECONDS.house / speed;
  const realFrames = Math.round(realSeconds * 60);
  for (let frame = 0; frame < realFrames; frame += 1) {
    clock.accumulate(1 / 60, speed, false);
    clock.processBudget(false, (dt) => (
      world as unknown as { updateBuildingConstruction(deltaSeconds: number): void }
    ).updateBuildingConstruction(dt), Infinity);
  }
  assert.equal(building.constructionState, 'operational', `${speed}x should accelerate construction`);
}

{
  const world = new GameWorld({ enableTerrainRelief: false });
  const position = findEmptyTile(world);
  const legacy: Building = {
    id: 'legacy-building',
    type: 'house',
    level: 1,
    x: position.x,
    y: position.y,
    width: 1,
    height: 1,
    population: 3,
    jobs: 0,
    attraction: 1,
    connected: true,
    nearestRoad: { x: position.x, y: Math.max(0, position.y - 1) },
    tripsToday: 0,
  };
  world.addBuilding(legacy);
  assert.equal(legacy.constructionState, 'operational');
  assert.equal(legacy.constructionProgress, 1);
}

{
  const house = createBuilding('house', 1, 1, 'operational');
  const office = createBuilding('office', 2, 1, 'operational');
  const constructingShop = createBuilding('shop', 3, 1);
  house.connected = true;
  office.connected = true;
  constructingShop.connected = true;
  const trip = chooseTrip([house, office, constructingShop], 'morning');
  assert.equal(trip?.origin.id, house.id);
  assert.equal(trip?.destination.id, office.id);
}

{
  const world = new GameWorld({ enableTerrainRelief: false });
  const position = findEmptyTile(world);
  const construction = createBuilding('shop', position.x, position.y);
  construction.connected = true;
  world.addBuilding(construction);
  const operationalIncome = world.buildings.filter((building) => (
    isBuildingOperational(building)
    && building.connected
    && (building.type === 'shop' || building.type === 'office')
  )).reduce((sum, building) => sum + (building.type === 'shop' ? 4 : 6), 0);
  const moneyBefore = world.money;
  (world as unknown as { updateEconomyAndSatisfaction(): void }).updateEconomyAndSatisfaction();
  assert.equal(world.money - moneyBefore, operationalIncome);
}

{
  const world = new GameWorld({ enableTerrainRelief: false, allowRoadDemolition: true });
  const position = findEmptyTile(world);
  const construction = createBuilding('office', position.x, position.y);
  world.addBuilding(construction);
  assert.equal(world.buildAt(position.x, position.y, 'road'), true);
  assert.equal(world.getBuilding(construction.id), undefined);
  assert.equal(world.grid[position.y]?.[position.x]?.type, 'road');
}

{
  const building = createBuilding('house', 1, 1);
  building.constructionProgress = 0.2;
  assert.equal(getBuildingConstructionStage(building), 1);
  building.constructionProgress = 0.5;
  assert.equal(getBuildingConstructionStage(building), 2);
  building.constructionProgress = 0.9;
  assert.equal(getBuildingConstructionStage(building), 3);
}

for (const city of CAMPAIGN_CITIES) {
  const first = new GameWorld({ mode: 'campaign', campaignCityId: city.id });
  const second = new GameWorld({ mode: 'campaign', campaignCityId: city.id });
  assert.equal(first.mode, 'campaign');
  assert.equal(first.grid.length, 30);
  assert.ok(first.grid.every((row) => row.length === 40));
  assert.ok(first.buildings.length > 0);
  const disconnectedInitialBuildings = first.buildings.filter((building) => {
    const tile = first.grid[building.y]?.[building.x];
    const connectedRoad = [
      first.grid[building.y - 1]?.[building.x],
      first.grid[building.y + 1]?.[building.x],
      first.grid[building.y]?.[building.x - 1],
      first.grid[building.y]?.[building.x + 1],
    ].some((candidate) => isRoadType(candidate?.type));
    return tile?.type !== 'building' || building.constructionState !== 'operational' || !connectedRoad;
  });
  assert.equal(disconnectedInitialBuildings.length, 0, `${city.name} should keep every initial building connected: ${disconnectedInitialBuildings.map((building) => `${building.x},${building.y}`).join(' ')}`);
  assert.ok(first.grid.flat().some((tile) => tile.vegetationKind && city.vegetation.includes(tile.vegetationKind)));
  assert.ok(first.grid.flat().some((tile) => isRoadType(tile.type)));
  const initialRoadTiles = first.grid.flat().filter((tile) => isRoadType(tile.type)).length;
  assert.ok(initialRoadTiles <= 220, `${city.name} should leave room for the player to build roads`);
  assert.ok(longestStraightRoadRun(first) <= 28, `${city.name} should not start as a rigid road grid`);
  if (city.id === 'hong-kong') assert.equal(countRoadComponents(first), 3);
  else assert.equal(countConnectedRoadTiles(first), first.grid.flat().filter((tile) => isRoadType(tile.type)).length);
  assert.equal(campaignMapSignature(first), campaignMapSignature(second), `${city.name} must be deterministic`);
  assert.equal(first.canPurchaseEastDistrict().canPurchase, false);
  assert.equal(first.purchaseEastDistrict().success, false);
}

assert.deepEqual(
  Object.fromEntries(CAMPAIGN_LEVEL_1_CITIES.map((city) => [
    city.id,
    city.mission.objectives.find((objective) => objective.id === 'population')?.requirements[0]?.target,
  ])),
  { rio: 220, vancouver: 280, amsterdam: 340, 'cape-town': 300 },
);
assert.equal(CAMPAIGN_LEVEL_1_CITIES.length, 4);
assert.equal(CAMPAIGN_LEVEL_2_CITIES.length, 4);
assert.equal(CAMPAIGN_LEVEL_3_CITIES.length, 4);
assert.deepEqual(CAMPAIGN_LEVEL_2_CITIES.map((city) => city.startingMoney), [2000, 4000, 5500, 8000]);
assert.deepEqual(CAMPAIGN_LEVEL_3_CITIES.map((city) => city.id), ['curitiba', 'paris', 'tokyo', 'hong-kong']);
assert.deepEqual(CAMPAIGN_LEVEL_3_CITIES.map((city) => city.startingMoney), [7000, 10000, 12000, 20000]);

{
  const world = new GameWorld({ mode: 'campaign', campaignCityId: 'rio' });
  const mission = world.getCampaignMissionSnapshot();
  assert.ok(mission);
  const firstBuilding = world.buildings[0];
  assert.ok(firstBuilding);
  const populationTarget = mission.objectives.find((objective) => objective.id === 'population')?.requirements[0]?.target ?? 0;
  const satisfactionTarget = mission.objectives.find((objective) => objective.id === 'satisfaction')?.requirements[0]?.target ?? 0;
  firstBuilding.population = populationTarget;
  world.satisfaction = satisfactionTarget;
  const updateMission = (dt: number) => (
    world as unknown as { updateCampaignMission(deltaSeconds: number): void }
  ).updateCampaignMission(dt);
  for (let tick = 0; tick < 20; tick += 1) updateMission(0.5);
  assert.equal(world.getCampaignMissionSnapshot()?.stabilitySeconds, 10);
  world.satisfaction = satisfactionTarget - 1;
  updateMission(0.5);
  assert.equal(world.getCampaignMissionSnapshot()?.stabilitySeconds, 0);
  world.satisfaction = satisfactionTarget;
  for (let tick = 0; tick < 60; tick += 1) updateMission(0.5);
  assert.equal(world.getCampaignMissionSnapshot()?.completed, true);
}

{
  const world = new GameWorld({ mode: 'campaign', campaignCityId: 'copenhagen' });
  assert.equal(world.money, 2000);
  const firstBuilding = world.buildings[0];
  assert.ok(firstBuilding);
  firstBuilding.population = 420;
  world.satisfaction = 82;
  world.bikeTripsCompleted = 25;
  let lanes = 0;
  for (const row of world.grid) {
    for (const tile of row) {
      if (lanes >= 30) break;
      if (tile.type === 'road') {
        tile.bikeLane = true;
        lanes += 1;
      }
    }
  }
  const mission = world.getCampaignMissionSnapshot();
  assert.ok(mission);
  assert.equal(mission.holdSeconds, 45);
  assert.equal(mission.objectives.length, 4);
  assert.equal(mission.objectives.find((objective) => objective.id === 'bike-network')?.met, true);
  world.bikeTripsCompleted = 24;
  assert.equal(world.getCampaignMissionSnapshot()?.objectives.find((objective) => objective.id === 'bike-network')?.met, false);
  world.bikeTripsCompleted = 25;
  const updateMission = (dt: number) => (
    world as unknown as { updateCampaignMission(deltaSeconds: number): void }
  ).updateCampaignMission(dt);
  for (let tick = 0; tick < 89; tick += 1) updateMission(0.5);
  assert.equal(world.getCampaignMissionSnapshot()?.completed, false);
  updateMission(0.5);
  assert.equal(world.getCampaignMissionSnapshot()?.completed, true);
}

{
  const world = new GameWorld({ mode: 'campaign', campaignCityId: 'bogota' });
  world.publicTripsCompleted = 50;
  world.busTripsCompleted = 0;
  const objective = world.getCampaignMissionSnapshot()?.objectives.find((candidate) => candidate.id === 'brt-network');
  assert.equal(objective?.requirements.find((requirement) => requirement.metric === 'busTripsCompleted')?.met, false);
}

{
  const world = new GameWorld({ mode: 'campaign', campaignCityId: 'curitiba' });
  world.transitLine.route = Array.from({ length: 10 }, (_, index) => ({ x: index + 2, y: 11 }));
  for (let index = 0; index < 7; index += 1) world.grid[11][index + 2].busLane = true;
  const coverage = () => world.getCampaignMissionSnapshot()?.objectives
    .find((objective) => objective.id === 'brt-megacity')?.requirements
    .find((requirement) => requirement.metric === 'busLaneCoveragePercent');
  assert.equal(coverage()?.current, 70);
  assert.equal(coverage()?.met, true);
  world.grid[11][8].busLane = undefined;
  assert.equal(coverage()?.current, 60);
  assert.equal(coverage()?.met, false);
  world.grid[11][8].busLane = true;
  world.grid[11][9].busLane = true;
  assert.equal(coverage()?.current, 80);
}

{
  const world = new GameWorld({ mode: 'campaign', campaignCityId: 'paris' });
  (world as unknown as { secondsSinceBikeTrip: number }).secondsSinceBikeTrip = 15;
  (world as unknown as { secondsSinceMetroTrip: number }).secondsSinceMetroTrip = 14.9;
  const activity = () => world.getCampaignMissionSnapshot()?.objectives.find((objective) => objective.id === 'continuous-service');
  assert.equal(activity()?.met, true);
  (world as unknown as { secondsSinceBikeTrip: number }).secondsSinceBikeTrip = 15.1;
  assert.equal(activity()?.met, false);
}

{
  const world = new GameWorld({ mode: 'campaign', campaignCityId: 'tokyo' });
  world.metroLines = [
    { id: 'line-a', name: 'A', color: '#fff', stationIds: ['a', 'b', 'c'], active: true, frequencySeconds: 1, trainCapacity: 1, totalPassengers: 0, currentPassengers: 0, waitingPassengers: 0, carsAvoided: 0, trainsActive: 0, completedCycles: 0 },
    { id: 'line-b', name: 'B', color: '#fff', stationIds: ['d', 'e'], active: true, frequencySeconds: 1, trainCapacity: 1, totalPassengers: 0, currentPassengers: 0, waitingPassengers: 0, carsAvoided: 0, trainsActive: 0, completedCycles: 0 },
  ];
  const stationsPerLine = () => world.getCampaignMissionSnapshot()?.objectives
    .find((objective) => objective.id === 'tokyo-metro')?.requirements
    .find((requirement) => requirement.metric === 'minMetroStationsPerActiveLine');
  assert.equal(stationsPerLine()?.current, 2);
  assert.equal(stationsPerLine()?.met, false);
  world.metroLines[1].stationIds.push('f');
  assert.equal(stationsPerLine()?.current, 3);
  assert.equal(stationsPerLine()?.met, true);
}

{
  const world = new GameWorld({ mode: 'campaign', campaignCityId: 'hong-kong' });
  const station = (id: string, x: number, y: number) => ({ id, name: id, x, y, coverageRadius: 5, capacity: 100, waitingPassengers: 0, totalBoarded: 0, totalAlighted: 0, totalPassengersHandled: 0, activeLineIds: [], peakWaitingPassengers: 0, carsAvoidedFromStation: 0, createdAtDay: 1 });
  const helipad = (id: string, x: number, y: number) => ({ id, name: id, x, y, accessRoad: { x, y }, coverageRadius: 12, capacity: 48, waiting: [], totalBoarded: 0, totalAlighted: 0, peakWaitingPassengers: 0, carsAvoidedFromHelipad: 0, activeLineIds: [], createdAtDay: 1 });
  world.metroStations = [station('west', 7, 14), station('north', 31, 7)];
  world.metroLines = [{ id: 'metro-link', name: 'M', color: '#fff', stationIds: ['west', 'north'], active: true, frequencySeconds: 1, trainCapacity: 1, totalPassengers: 0, currentPassengers: 0, waitingPassengers: 0, carsAvoided: 0, trainsActive: 0, completedCycles: 0 }];
  world.helipads = [helipad('north-pad', 31, 7), helipad('north-pad-2', 30, 7), helipad('south-pad', 31, 23)];
  const connectedZones = () => world.getCampaignMissionSnapshot()?.objectives
    .find((objective) => objective.id === 'connected-zones')?.requirements[0];
  assert.equal(connectedZones()?.current, 0);
  world.helicopterLines = [{ id: 'air-local', name: 'A', color: '#fff', helipadIds: ['north-pad', 'north-pad-2'], active: true, helicopterCount: 1, totalPassengers: 0, currentPassengers: 0, waitingPassengers: 0, carsAvoided: 0, completedCycles: 0 }];
  assert.equal(connectedZones()?.current, 2);
  world.helicopterLines.push({ id: 'air-link', name: 'B', color: '#fff', helipadIds: ['north-pad-2', 'south-pad'], active: true, helicopterCount: 1, totalPassengers: 0, currentPassengers: 0, waitingPassengers: 0, carsAvoided: 0, completedCycles: 0 });
  assert.equal(connectedZones()?.current, 3);
  assert.equal(connectedZones()?.met, true);
}

{
  const world = new GameWorld({ mode: 'campaign', campaignCityId: 'curitiba' });
  const baseSnapshot = world.getSnapshot();
  world.getSnapshot = () => ({ ...baseSnapshot, population: 620, activeBuses: 5, busLaneTiles: 40, busLaneCoverageRatio: 0.7, busTripsCompleted: 150, satisfaction: 84 });
  const updateMission = (dt: number) => (
    world as unknown as { updateCampaignMission(deltaSeconds: number): void }
  ).updateCampaignMission(dt);
  for (let tick = 0; tick < 119; tick += 1) updateMission(0.5);
  assert.equal(world.getCampaignMissionSnapshot()?.completed, false);
  updateMission(0.5);
  assert.equal(world.getCampaignMissionSnapshot()?.completed, true);
}

{
  const storage = createMemoryStorage();
  const record = {
    cityId: 'amsterdam' as const,
    completedAt: '2026-06-22T00:00:00.000Z',
    population: 130,
    satisfaction: 84,
    traffic: 24,
    elapsedSeconds: 180,
    day: 2,
    timeLabel: '12:00',
  };
  saveCampaignCompletion(record, storage);
  assert.equal(loadCampaignProgress(storage).amsterdam?.elapsedSeconds, 180);
  saveCampaignCompletion({ ...record, elapsedSeconds: 240 }, storage);
  assert.equal(loadCampaignProgress(storage).amsterdam?.elapsedSeconds, 180);
  saveCampaignCompletion({ ...record, elapsedSeconds: 150 }, storage);
  assert.equal(loadCampaignProgress(storage).amsterdam?.elapsedSeconds, 150);
}

{
  const storage = createMemoryStorage();
  const legacyRecord = {
    cityId: 'copenhagen' as const,
    completedAt: '',
    population: 420,
    satisfaction: 90,
    traffic: 20,
    elapsedSeconds: 100,
    day: 1,
    timeLabel: '10:00',
  };
  storage.setItem(LEGACY_CAMPAIGN_PROGRESS_V2_STORAGE_KEY, JSON.stringify({ copenhagen: legacyRecord }));
  assert.equal(loadCampaignProgress(storage).copenhagen?.population, 420);
}

{
  const storage = createMemoryStorage();
  const legacyRecord = {
    cityId: 'rio' as const,
    completedAt: '',
    population: 220,
    satisfaction: 80,
    traffic: 20,
    elapsedSeconds: 100,
    day: 1,
    timeLabel: '10:00',
  };
  storage.setItem(LEGACY_CAMPAIGN_PROGRESS_STORAGE_KEY, JSON.stringify({ rio: legacyRecord }));
  assert.equal(loadCampaignProgress(storage).rio?.population, 220);
}

{
  const recordFor = (cityId: typeof CAMPAIGN_LEVEL_1_CITIES[number]['id']) => ({
    cityId,
    completedAt: '',
    population: 500,
    satisfaction: 90,
    traffic: 20,
    elapsedSeconds: 100,
    day: 1,
    timeLabel: '10:00',
  });
  const firstThree = Object.fromEntries(CAMPAIGN_LEVEL_1_CITIES.slice(0, 3).map((city) => [city.id, recordFor(city.id)]));
  assert.equal(isCampaignLevel2Unlocked(firstThree), false);
  const allFour = Object.fromEntries(CAMPAIGN_LEVEL_1_CITIES.map((city) => [city.id, recordFor(city.id)]));
  assert.equal(isCampaignLevel2Unlocked(allFour), true);
}

{
  const recordFor = (cityId: typeof CAMPAIGN_LEVEL_2_CITIES[number]['id']) => ({
    cityId,
    completedAt: '',
    population: 700,
    satisfaction: 90,
    traffic: 15,
    elapsedSeconds: 100,
    day: 1,
    timeLabel: '10:00',
  });
  const firstThree = Object.fromEntries(CAMPAIGN_LEVEL_2_CITIES.slice(0, 3).map((city) => [city.id, recordFor(city.id)]));
  assert.equal(isCampaignLevel3Unlocked(firstThree), false);
  const allFour = Object.fromEntries(CAMPAIGN_LEVEL_2_CITIES.map((city) => [city.id, recordFor(city.id)]));
  assert.equal(isCampaignLevel3Unlocked(allFour), true);
}

{
  const cityIds = CAMPAIGN_LEVEL_1_CITIES.map((city) => city.id);
  assert.equal(getInitialCampaignIndex(cityIds, { rio: {
    cityId: 'rio',
    completedAt: '',
    population: 90,
    satisfaction: 75,
    traffic: 40,
    elapsedSeconds: 120,
    day: 1,
    timeLabel: '10:00',
  } }), 1);
  assert.equal(getInitialCampaignIndex(cityIds, Object.fromEntries(cityIds.map((id) => [id, {
    cityId: id,
    completedAt: '',
    population: 120,
    satisfaction: 90,
    traffic: 20,
    elapsedSeconds: 100,
    day: 1,
    timeLabel: '10:00',
  }]))), 0);
  assert.equal(wrapCampaignIndex(-1, 4), 3);
  assert.equal(wrapCampaignIndex(4, 4), 0);
  assert.equal(getCampaignCardOffset(3, 0, 4), -1);
  assert.equal(getCampaignCardOffset(1, 0, 4), 1);
  assert.equal(getCampaignWheelDirection(0, 40), 1);
  assert.equal(getCampaignWheelDirection(-40, 4), -1);
  assert.equal(getCampaignWheelDirection(4, 5), 0);
  assert.equal(getCampaignSwipeDirection(-70), 1);
  assert.equal(getCampaignSwipeDirection(70), -1);
  assert.equal(getCampaignSwipeDirection(20), 0);
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

function findEmptyTile(world: GameWorld): { x: number; y: number } {
  for (const row of world.grid) {
    for (const tile of row) {
      if (tile.type === 'empty') return { x: tile.x, y: tile.y };
    }
  }
  throw new Error('Expected an empty tile for construction test');
}

function campaignMapSignature(world: GameWorld): string {
  return world.grid.flat().map((tile) => `${tile.type}:${tile.vegetationKind ?? ''}`).join('|')
    + world.buildings.map((building) => `${building.type}:${building.x},${building.y}`).join('|');
}

function countConnectedRoadTiles(world: GameWorld): number {
  const roadTiles = world.grid.flat().filter((tile) => isRoadType(tile.type));
  const first = roadTiles[0];
  if (!first) return 0;
  const seen = new Set<string>([`${first.x},${first.y}`]);
  const queue = [first];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of [
      world.grid[current.y - 1]?.[current.x],
      world.grid[current.y + 1]?.[current.x],
      world.grid[current.y]?.[current.x - 1],
      world.grid[current.y]?.[current.x + 1],
    ]) {
      if (!next || !isRoadType(next.type)) continue;
      const key = `${next.x},${next.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen.size;
}

function countRoadComponents(world: GameWorld): number {
  const unvisited = new Set(world.grid.flat().filter((tile) => isRoadType(tile.type)).map((tile) => `${tile.x},${tile.y}`));
  let components = 0;
  while (unvisited.size) {
    const firstKey = unvisited.values().next().value as string;
    const [x, y] = firstKey.split(',').map(Number);
    const queue = [{ x, y }];
    unvisited.delete(firstKey);
    components += 1;
    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      for (const next of [
        world.grid[current.y - 1]?.[current.x],
        world.grid[current.y + 1]?.[current.x],
        world.grid[current.y]?.[current.x - 1],
        world.grid[current.y]?.[current.x + 1],
      ]) {
        if (!next || !isRoadType(next.type)) continue;
        const key = `${next.x},${next.y}`;
        if (!unvisited.delete(key)) continue;
        queue.push(next);
      }
    }
  }
  return components;
}

function longestStraightRoadRun(world: GameWorld): number {
  let longest = 0;
  for (const row of world.grid) {
    let run = 0;
    for (const tile of row) {
      run = isRoadType(tile.type) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  for (let x = 0; x < (world.grid[0]?.length ?? 0); x += 1) {
    let run = 0;
    for (let y = 0; y < world.grid.length; y += 1) {
      run = isRoadType(world.grid[y]?.[x]?.type) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  return longest;
}

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string): string | null { return values.get(key) ?? null; },
    setItem(key: string, value: string): void { values.set(key, String(value)); },
  };
}
