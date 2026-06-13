import { nanoid } from 'nanoid';
import type { Building, BuildingLevel, CityStats, RoadDirection, RoadType, SelectedEntity, Tile, TrafficCell, TrafficLightAxis, TrafficLightState, Vec2 } from '../../types/city.types';
import type { Car } from '../../types/agent.types';
import type { Tool } from '../../types/game.types';
import { GAME_CONFIG } from '../config/gameConfig';
import type { GameSetupOptions } from '../config/gameSetup';
import { ROAD_CONFIG } from '../config/roadConfig';
import { createGrid, inBounds, isRoadType, keyOf } from '../city/grid';
import { CityGenerator } from '../city/cityGenerator';
import { applyBuildingLevel, updateBuildingConnection } from '../city/buildings';
import { findFastestPath } from '../pathfinding/pathfinder';
import { buildIntersectionControls, computeTrafficDecision, getDirection, getLaneOffset, isIntersection } from '../systems/trafficRules';
import { canPlaceRoundabout, findRoundaboutCenterForTile, getRoundaboutArea, getRoundaboutRing, isRoundaboutCenter, isRoundaboutTile } from '../systems/roundabouts';
import {
  createTrafficLight,
  EMPTY_TRAFFIC_LIGHT_DEMAND,
  getTrafficLightOpenAxis,
  getTrafficLightAxis,
  getTrafficLightKey,
  TRAFFIC_LIGHT_BUILD_COST,
  updateTrafficLight,
  type TrafficLightDemand,
} from '../systems/trafficLights';
import { TimeSystem } from './timeSystem';
import { chooseTrip } from '../agents/tripGenerator';

const SIGNAL_INSTALL_GRACE_SECONDS = 5.5;
const REROUTE_STUCK_SECONDS = 8.5;
const REROUTE_FORCE_SECONDS = 14;
const REROUTE_COOLDOWN_SECONDS = 11;
const INTERSECTION_REROUTE_STUCK_SECONDS = 22;
const SPAWN_LANE_CLEAR_DISTANCE = 0.85;
const TRAVEL_TIME_HISTORY_LIMIT = 35;
const FAILED_TRIP_PRESSURE_DECAY = 0.82;
const FAILED_TRIP_PENALTY_FACTOR = 0.9;
const BUILDING_UPGRADE_EVERY_SECONDS = 10;
const BUILDING_UPGRADE_MIN_SATISFACTION = 45;
const BUILDING_UPGRADE_MAX_CONGESTION = 140;
const BUILDING_UPGRADE_MIN_SCORE = 3.2;
const CAR_SPAWN_EXIT_SECONDS = 0.65;
const CAR_DESTINATION_ENTRY_SECONDS = 0.75;

export class GameWorld {
  grid: Tile[][] = createGrid();
  buildings: Building[] = [];
  cars: Car[] = [];
  traffic = new Map<string, TrafficCell>();
  trafficLights = new Map<string, TrafficLightState>();
  selected: SelectedEntity = { kind: 'none' };
  money = GAME_CONFIG.initialMoney;
  satisfaction = 100;
  completedTrips = 0;
  failedTrips = 0;
  averageTravelTime = 0;
  cityLevel = 1;
  time = new TimeSystem();
  generator: CityGenerator;

  private buildingTimer = 0;
  private buildingUpgradeTimer = 0;
  private tripTimer = 0;
  private economyTimer = 0;
  private listeners = new Set<() => void>();
  private tripHistory: number[] = [];
  private failedTripPressure = 0;
  private lastProcessedDay = 1;
  private nextPriorityToken = 1;
  private trafficLightDebugTimers = new Map<string, number>();

  constructor(options: Partial<GameSetupOptions> = {}) {
    this.generator = new CityGenerator(options);
    this.seedInitialCity();
    this.updateConnections();
    this.updateTrafficMap();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const l of this.listeners) l();
  }

  getSnapshot(): CityStats {
    const disconnectedBuildings = this.buildings.filter((b) => !b.connected).length;
    const congestions = [...this.traffic.values()].map((t) => t.congestion);
    const averageCongestion = congestions.length ? congestions.reduce((a, b) => a + b, 0) / congestions.length : 0;
    return {
      money: Math.floor(this.money),
      population: this.buildings.reduce((sum, b) => sum + b.population, 0),
      activeCars: this.cars.length,
      satisfaction: Math.round(this.satisfaction),
      averageCongestion: Math.round(Math.min(300, averageCongestion * 100)),
      averageTravelTime: Math.round(this.averageTravelTime),
      disconnectedBuildings,
      completedTrips: this.completedTrips,
      failedTrips: this.failedTrips,
      cityLevel: this.cityLevel,
      day: this.time.getDay(),
      timeLabel: this.time.getLabel(),
      dayPeriod: this.time.getPeriod(),
    };
  }

  seedInitialCity(): void {
    for (let i = 0; i < GAME_CONFIG.initialBuildings; i++) {
      const b = this.generator.spawn(this.grid, this.buildings, this.cityLevel);
      if (!b) continue;
      this.addBuilding(b);
    }
  }

  addBuilding(building: Building): void {
    this.buildings.push(building);
    this.grid[building.y][building.x] = { x: building.x, y: building.y, type: 'building', buildingId: building.id };
  }

  update(deltaSeconds: number, speed: number, paused: boolean): void {
    if (paused || speed === 0) return;
    const dt = Math.min(0.08, deltaSeconds) * speed;
    this.time.update(dt);
    this.updateDailyBuildingActivity();
    this.updateTrafficLights(dt);
    this.buildingTimer += dt;
    this.buildingUpgradeTimer += dt;
    this.tripTimer += dt;
    this.economyTimer += dt;

    this.updateConnections();
    this.refreshSelectedBuilding();
    this.updateTrafficMap();
    this.updateCars(dt);
    this.updateTrafficMap();

    if (this.tripTimer >= GAME_CONFIG.tripGenerationEverySeconds) {
      this.tripTimer = 0;
      this.generateTrips();
    }

    if (this.buildingTimer >= GAME_CONFIG.spawnBuildingEverySeconds) {
      this.buildingTimer = 0;
      this.growCity();
    }

    if (this.buildingUpgradeTimer >= BUILDING_UPGRADE_EVERY_SECONDS) {
      this.buildingUpgradeTimer = 0;
      this.updateBuildingUpgrades();
    }

    if (this.economyTimer >= GAME_CONFIG.economyTickSeconds) {
      this.economyTimer = 0;
      this.updateEconomyAndSatisfaction();
    }
  }

  buildAt(x: number, y: number, tool: Tool): boolean {
    if (!inBounds(x, y)) return false;
    const tile = this.grid[y][x];

    if (tool === 'roundabout') {
      const placement = canPlaceRoundabout(this.grid, { x, y });
      if (!placement.valid) return false;
      if (this.money < ROAD_CONFIG.roundabout.buildCost) return false;

      for (const pos of getRoundaboutArea({ x, y })) {
        this.trafficLights.delete(getTrafficLightKey(pos.x, pos.y));
        this.grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'empty' };
      }
      for (const pos of getRoundaboutRing({ x, y })) {
        this.grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'roundabout' };
      }
      this.grid[y][x] = { x, y, type: 'roundaboutCenter' };
      this.rerouteCarsAffectedBy(getRoundaboutArea({ x, y }));
      this.money -= ROAD_CONFIG.roundabout.buildCost;
      this.updateConnections();
      this.inspectAt(x, y - 1);
      this.emit();
      return true;
    }

    if (tool === 'trafficLight') {
      if (!isRoadType(tile.type)) return false;
      if (isRoundaboutTile(tile)) return false;
      if (!isIntersection(this.grid, { x, y })) return false;
      const key = getTrafficLightKey(x, y);
      if (this.trafficLights.has(key)) return false;
      if (this.money < TRAFFIC_LIGHT_BUILD_COST) return false;

      const demand = this.getTrafficLightDemandForKey(x, y);
      const preferredAxis: TrafficLightAxis = demand.horizontalQueue >= demand.verticalQueue ? 'horizontal' : 'vertical';
      this.trafficLights.set(key, createTrafficLight(x, y, this.trafficLights.size, preferredAxis));
      this.prepareTrafficForNewSignal(key, x, y);
      this.money -= TRAFFIC_LIGHT_BUILD_COST;
      this.inspectAt(x, y);
      this.emit();
      return true;
    }

    if (tool === 'road' || tool === 'avenue') {
      if (tile.type === 'building') return false;
      if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) return false;
      const cost = ROAD_CONFIG[tool].buildCost;
      if (this.money < cost) return false;
      if (tile.type === tool) return false;
      const oneWay = tile.type === 'road' || tile.type === 'avenue' ? tile.oneWay : undefined;
      this.grid[y][x] = { x, y, type: tool, oneWay };
      this.money -= cost;
      this.updateConnections();
      this.emit();
      return true;
    }

    if (tool === 'remove') {
      if (!isRoadType(tile.type) && !isRoundaboutCenter(tile)) return false;
      const center = findRoundaboutCenterForTile(this.grid, { x, y });
      const roadType = center ? 'roundabout' : tile.type as RoadType;
      const cost = ROAD_CONFIG[roadType].removeCost;
      if (this.money < cost) return false;
      if (center) {
        for (const pos of getRoundaboutArea(center)) {
          this.grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'empty' };
          this.trafficLights.delete(getTrafficLightKey(pos.x, pos.y));
        }
        this.rerouteCarsAffectedBy(getRoundaboutArea(center));
      } else {
        this.grid[y][x] = { x, y, type: 'empty' };
        this.trafficLights.delete(getTrafficLightKey(x, y));
      }
      this.money -= cost;
      this.updateConnections();
      this.emit();
      return true;
    }

    return false;
  }

  buildRoadLine(tiles: Vec2[], roadType: 'road' | 'avenue'): { success: boolean; built: number; cost: number; reason?: string } {
    const uniqueTiles = dedupeTiles(tiles);
    if (!uniqueTiles.length) return { success: false, built: 0, cost: 0, reason: 'Nenhum tile selecionado.' };

    let built = 0;
    for (const pos of uniqueTiles) {
      if (!inBounds(pos.x, pos.y)) return { success: false, built: 0, cost: 0, reason: 'A linha sai do mapa.' };
      const tile = this.grid[pos.y][pos.x];
      if (tile.type === 'building') return { success: false, built: 0, cost: 0, reason: 'A linha passa por um prédio.' };
      if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) return { success: false, built: 0, cost: 0, reason: 'A linha passa por uma rotatória.' };
      if (tile.type !== roadType) built += 1;
    }

    if (built === 0) return { success: false, built: 0, cost: 0, reason: 'Essa via já existe em toda a linha.' };

    const cost = built * ROAD_CONFIG[roadType].buildCost;
    if (this.money < cost) return { success: false, built, cost, reason: `Faltam $ ${cost - this.money} para construir.` };

    for (const pos of uniqueTiles) {
      if (this.grid[pos.y][pos.x].type !== roadType) {
        const current = this.grid[pos.y][pos.x];
        const oneWay = current.type === 'road' || current.type === 'avenue' ? current.oneWay : undefined;
        this.grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: roadType, oneWay };
      }
    }

    for (const light of [...this.trafficLights.values()]) {
      if (!isIntersection(this.grid, { x: light.x, y: light.y })) this.trafficLights.delete(getTrafficLightKey(light.x, light.y));
    }

    this.rerouteCarsAffectedBy(uniqueTiles);
    this.money -= cost;
    this.updateConnections();
    this.emit();
    return { success: true, built, cost };
  }

  setOneWayLine(tiles: Vec2[], direction: RoadDirection): { success: boolean; changed: number; reason?: string } {
    const uniqueTiles = dedupeTiles(tiles);
    if (!uniqueTiles.length) return { success: false, changed: 0, reason: 'Nenhum tile selecionado.' };

    for (const pos of uniqueTiles) {
      if (!inBounds(pos.x, pos.y)) return { success: false, changed: 0, reason: 'A linha sai do mapa.' };
      const tile = this.grid[pos.y][pos.x];
      if (tile.type !== 'road' && tile.type !== 'avenue') {
        return { success: false, changed: 0, reason: 'Mão única só pode ser aplicada em ruas e avenidas.' };
      }
    }

    let changed = 0;
    for (const pos of uniqueTiles) {
      const tile = this.grid[pos.y][pos.x];
      if (tile.oneWay !== direction) changed += 1;
      this.grid[pos.y][pos.x] = { ...tile, oneWay: direction };
    }

    this.rerouteCarsAffectedBy(uniqueTiles);
    this.refreshSelectedRoad();
    this.emit();
    return { success: true, changed };
  }

  toggleOneWayAt(x: number, y: number): { success: boolean; direction?: RoadDirection; cleared?: boolean; reason?: string } {
    if (!inBounds(x, y)) return { success: false, reason: 'Fora do mapa.' };
    const tile = this.grid[y][x];
    if (tile.type !== 'road' && tile.type !== 'avenue') {
      return { success: false, reason: 'Mão única só pode ser aplicada em ruas e avenidas.' };
    }

    const nextDirection = nextOneWayDirection(tile.oneWay);
    this.grid[y][x] = { ...tile, oneWay: nextDirection };
    this.rerouteCarsAffectedBy([{ x, y }]);
    this.refreshSelectedRoad();
    this.emit();
    return nextDirection
      ? { success: true, direction: nextDirection }
      : { success: true, cleared: true };
  }

  clearOneWayAt(x: number, y: number): boolean {
    if (!inBounds(x, y)) return false;
    const tile = this.grid[y][x];
    if ((tile.type !== 'road' && tile.type !== 'avenue') || !tile.oneWay) return false;
    this.grid[y][x] = { ...tile, oneWay: undefined };
    this.rerouteCarsAffectedBy([{ x, y }]);
    this.refreshSelectedRoad();
    this.emit();
    return true;
  }

  inspectAt(x: number, y: number): SelectedEntity {
    if (!inBounds(x, y)) return { kind: 'none' };
    const tile = this.grid[y][x];
    if (tile.type === 'building' && tile.buildingId) {
      const building = this.buildings.find((b) => b.id === tile.buildingId);
      if (building) this.selected = { kind: 'building', building };
    } else if (isRoadType(tile.type)) {
      const t = this.traffic.get(keyOf(x, y)) ?? { x, y, cars: 0, capacity: ROAD_CONFIG[tile.type as RoadType].capacity, congestion: 0 };
      this.selected = { kind: 'road', x, y, roadType: tile.type as RoadType, traffic: t, trafficLight: this.trafficLights.get(getTrafficLightKey(x, y)), oneWay: tile.oneWay };
    } else {
      this.selected = { kind: 'tile', x, y, type: tile.type };
    }
    this.emit();
    return this.selected;
  }

  inspectCar(carId: string): void {
    this.selected = { kind: 'car', carId };
    this.emit();
  }

  getCar(carId: string): Car | undefined {
    return this.cars.find((c) => c.id === carId);
  }

  getBuilding(id: string): Building | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  private updateConnections(): void {
    this.buildings = this.buildings.map((b) => updateBuildingConnection(b, this.grid));
  }

  private updateTrafficLights(dt: number): void {
    if (!this.trafficLights.size) return;

    for (const [key, light] of this.trafficLights) {
      const demand = this.getTrafficLightDemandForKey(light.x, light.y);
      const nextLight = updateTrafficLight(light, dt, demand);
      this.trafficLights.set(key, nextLight);
      this.debugTrafficLight(key, nextLight, demand, dt);
    }

    if (this.selected.kind === 'road') {
      const selectedKey = getTrafficLightKey(this.selected.x, this.selected.y);
      if (this.trafficLights.has(selectedKey)) {
        this.selected = { ...this.selected, trafficLight: this.trafficLights.get(selectedKey) };
      }
    }
  }

  private debugTrafficLight(key: string, light: TrafficLightState, demand: TrafficLightDemand, dt: number): void {
    if (!isTrafficDebugEnabled()) return;

    const elapsed = (this.trafficLightDebugTimers.get(key) ?? 0) + dt;
    if (elapsed < 2) {
      this.trafficLightDebugTimers.set(key, elapsed);
      return;
    }
    this.trafficLightDebugTimers.set(key, 0);

    const totalQueue = demand.horizontalQueue + demand.verticalQueue;
    const maxWait = Math.max(demand.horizontalMaxWait, demand.verticalMaxWait, demand.maxInsideWait);
    if (totalQueue < 3 && maxWait < 3) return;

    console.info('[traffic-light]', {
      key,
      phase: light.phase,
      openAxis: getTrafficLightOpenAxis(light),
      timer: Number(light.timer.toFixed(1)),
      startup: Number(light.startupSeconds.toFixed(1)),
      emergency: Number(light.emergencySeconds.toFixed(1)),
      reason: light.lastSwitchReason,
      demand: {
        horizontalQueue: demand.horizontalQueue,
        verticalQueue: demand.verticalQueue,
        horizontalMaxWait: Number(demand.horizontalMaxWait.toFixed(1)),
        verticalMaxWait: Number(demand.verticalMaxWait.toFixed(1)),
        occupiedCount: demand.occupiedCount,
        maxInsideWait: Number(demand.maxInsideWait.toFixed(1)),
      },
    });
  }

  private getTrafficLightDemandForKey(x: number, y: number): TrafficLightDemand {
    const key = getTrafficLightKey(x, y);
    const demand: TrafficLightDemand = { ...EMPTY_TRAFFIC_LIGHT_DEMAND };

    for (const car of this.cars) {
      if (car.status === 'arrived') continue;
      if (car.lifecyclePhase !== 'driving') continue;
      const current = car.route[car.routeIndex];
      const next = car.route[car.routeIndex + 1];

      if (car.currentTileX === x && car.currentTileY === y) {
        demand.occupiedCount += 1;
        demand.maxInsideWait = Math.max(demand.maxInsideWait, car.insideIntersectionSeconds, car.stuckSeconds);
      }

      if (!current || !next) continue;
      if (keyOf(next.x, next.y) !== key) continue;

      const axis = getTrafficLightAxis(getDirection(current, next));
      const closeToStopLine = car.progressToNext >= 0.35;
      const slowOrStopped = car.currentSpeed < 0.35 || car.status === 'stopped';
      const wait = Math.max(car.intersectionWaitSeconds, car.stuckSeconds, car.waitTimer);

      if (!closeToStopLine && !slowOrStopped) continue;

      if (axis === 'horizontal') {
        demand.horizontalQueue += 1;
        demand.horizontalMaxWait = Math.max(demand.horizontalMaxWait, wait);
      } else {
        demand.verticalQueue += 1;
        demand.verticalMaxWait = Math.max(demand.verticalMaxWait, wait);
      }
    }

    return demand;
  }

  private prepareTrafficForNewSignal(key: string, x: number, y: number): void {
    for (const car of this.cars) {
      if (car.lifecyclePhase !== 'driving') continue;
      const current = car.route[car.routeIndex];
      const next = car.route[car.routeIndex + 1];
      const after = car.route[car.routeIndex + 2];
      const isInside = car.currentTileX === x && car.currentTileY === y;
      const isApproaching = Boolean(next && keyOf(next.x, next.y) === key);
      const isLeaving = Boolean(current && keyOf(current.x, current.y) === key);
      const isNearPath = Boolean(after && keyOf(after.x, after.y) === key);

      if (!isInside && !isApproaching && !isLeaving && !isNearPath) continue;

      car.signalTransitionKey = key;
      car.signalTransitionGraceSeconds = SIGNAL_INSTALL_GRACE_SECONDS;
      car.intersectionStopKey = undefined;
      car.waitTimer = 0;
      car.intersectionWaitSeconds = 0;
      car.gridlockEscapeSeconds = 0;
      car.stuckSeconds = Math.max(0, car.stuckSeconds - 2);
      car.rerouteCooldownSeconds = Math.min(car.rerouteCooldownSeconds, 1.5);
    }
  }

  private updateTrafficMap(): void {
    const map = new Map<string, TrafficCell>();
    const pressure = new Map<string, number>();
    for (const row of this.grid) {
      for (const tile of row) {
        if (isRoadType(tile.type)) {
          const roadType = tile.type as RoadType;
          map.set(keyOf(tile.x, tile.y), {
            x: tile.x,
            y: tile.y,
            cars: 0,
            capacity: ROAD_CONFIG[roadType].capacity,
            congestion: 0,
          });
        }
      }
    }
    for (const car of this.cars) {
      if (car.lifecyclePhase !== 'driving') continue;
      const k = keyOf(car.currentTileX, car.currentTileY);
      const info = map.get(k);
      if (info) {
        info.cars += 1;
        if (car.trafficState === 'queued' || car.trafficState === 'intersection' || car.status === 'stopped') {
          pressure.set(k, (pressure.get(k) ?? 0) + 1.35 + Math.min(2.5, car.stuckSeconds * 0.15));
        }
      }
    }
    for (const info of map.values()) {
      const queuePressure = pressure.get(keyOf(info.x, info.y)) ?? 0;
      info.congestion = (info.cars + queuePressure) / Math.max(1, info.capacity);
    }
    this.traffic = map;
  }

  private generateTrips(): void {
    const multiplier = this.time.getTripMultiplier();
    const population = this.getSnapshot().population;
    const attempts = Math.max(1, Math.floor((population / 32) * multiplier));
    for (let i = 0; i < attempts; i++) {
      if (this.cars.length >= GAME_CONFIG.maxCars) return;
      if (Math.random() > 0.62) continue;
      const trip = chooseTrip(this.buildings, this.time.getPeriod());
      if (!trip || !trip.origin.nearestRoad || !trip.destination.nearestRoad) {
        this.recordFailedTrip();
        continue;
      }
      const route = findFastestPath(this.grid, this.traffic, trip.origin.nearestRoad, trip.destination.nearestRoad);
      if (route.length < 2) {
        this.recordFailedTrip();
        continue;
      }
      const initialDirection = getDirection(route[0], route[1]);
      const initialRoadType = this.getRoadTypeAt(route[0]);
      const carId = nanoid(8);
      const lane = getLaneOffset(initialDirection, initialRoadType, carId, this.getOneWayAt(route[0], initialDirection));
      if (this.isSpawnLaneBlocked(route[0], lane.offset, initialDirection)) {
        this.debugSpawnBlocked(route[0], initialDirection);
        continue;
      }
      this.cars.push({
        id: carId,
        originBuildingId: trip.origin.id,
        destinationBuildingId: trip.destination.id,
        x: route[0].x + lane.offset.x,
        y: route[0].y + lane.offset.y,
        currentTileX: route[0].x,
        currentTileY: route[0].y,
        route,
        routeIndex: 0,
        progressToNext: 0,
        baseSpeed: 1.45,
        currentSpeed: 0,
        targetSpeed: 0,
        acceleration: 1.65,
        braking: 3.8,
        desiredSpeed: 1.45 * ROAD_CONFIG[initialRoadType].speed,
        laneOffset: lane.offset,
        laneIndex: lane.laneIndex,
        laneCount: lane.laneCount,
        laneSide: lane.laneSide,
        waitTimer: 0,
        intersectionWaitSeconds: 0,
        priorityToken: 0,
        gridlockEscapeSeconds: 0,
        insideIntersectionSeconds: 0,
        turnSlowdown: 0,
        trafficState: 'moving',
        lifecyclePhase: 'spawnExit',
        lifecycleProgress: 0,
        direction: initialDirection,
        status: 'moving',
        travelTime: 0,
        estimatedTime: route.length / 1.45,
        delay: 0,
        stuckSeconds: 0,
        rerouteCooldownSeconds: 0,
        rerouteCount: 0,
        signalTransitionGraceSeconds: 0,
        intersectionReason: undefined,
      });
      trip.origin.tripsToday += 1;
      trip.destination.tripsToday += 1;
    }
  }

  private updateCars(dt: number): void {
    const arrived: Car[] = [];
    const drivingCars = this.cars.filter((car) => car.lifecyclePhase === 'driving');
    const intersectionControls = buildIntersectionControls(this.grid, drivingCars);
    const sortedCars = [...this.cars].sort((a, b) => this.carUpdatePriority(b) - this.carUpdatePriority(a));

    for (const car of sortedCars) {
      car.travelTime += dt;
      if (car.lifecyclePhase === 'spawnExit') {
        car.lifecycleProgress += dt / CAR_SPAWN_EXIT_SECONDS;
        car.currentSpeed = Math.min(car.desiredSpeed, car.currentSpeed + car.acceleration * dt);
        car.targetSpeed = car.desiredSpeed;
        car.trafficState = 'moving';
        car.status = 'moving';
        if (car.lifecycleProgress >= 1) {
          car.lifecyclePhase = 'driving';
          car.lifecycleProgress = 1;
          car.progressToNext = 0;
          car.x = car.route[0].x + car.laneOffset.x;
          car.y = car.route[0].y + car.laneOffset.y;
          car.currentTileX = car.route[0].x;
          car.currentTileY = car.route[0].y;
        }
        continue;
      }

      if (car.lifecyclePhase === 'destinationEntry') {
        car.lifecycleProgress += dt / CAR_DESTINATION_ENTRY_SECONDS;
        car.currentSpeed = Math.max(0, car.currentSpeed - car.braking * dt);
        car.targetSpeed = 0;
        car.trafficState = 'moving';
        car.status = 'moving';
        if (car.lifecycleProgress >= 1) {
          car.status = 'arrived';
          arrived.push(car);
        }
        continue;
      }

      if (car.rerouteCooldownSeconds > 0) car.rerouteCooldownSeconds = Math.max(0, car.rerouteCooldownSeconds - dt);
      if (car.signalTransitionGraceSeconds > 0) {
        car.signalTransitionGraceSeconds = Math.max(0, car.signalTransitionGraceSeconds - dt);
        if (car.signalTransitionGraceSeconds === 0) car.signalTransitionKey = undefined;
      }

      const traffic = this.traffic.get(keyOf(car.currentTileX, car.currentTileY));
      const congestion = traffic?.congestion ?? 0;
      const decision = computeTrafficDecision(this.grid, car, drivingCars, intersectionControls, this.trafficLights, congestion);
      car.desiredSpeed = decision.desiredSpeed;
      car.targetSpeed = decision.targetSpeed;
      car.laneOffset = decision.laneOffset;
      car.laneIndex = decision.laneIndex;
      car.laneCount = decision.laneCount;
      car.laneSide = decision.laneSide;
      car.direction = decision.direction;
      car.blockedByCarId = decision.blockedByCarId;
      car.trafficState = decision.state;
      car.intersectionQueuePosition = decision.intersectionQueuePosition;
      car.intersectionQueueLength = decision.intersectionQueueLength;
      car.intersectionReason = decision.intersectionReason;
      applySmoothSpeed(car, decision.targetSpeed, dt, decision.hardStop);
      car.status = car.currentSpeed < 0.08 ? 'stopped' : 'moving';
      car.turnSlowdown = decision.turning ? Math.max(car.turnSlowdown, 0.32) : Math.max(0, car.turnSlowdown - dt);

      if (decision.intersectionStopKey) {
        if (car.intersectionStopKey !== decision.intersectionStopKey) {
          car.intersectionStopKey = decision.intersectionStopKey;
          car.lastIntersectionKey = decision.intersectionStopKey;
          car.waitTimer = 0;
          car.intersectionWaitSeconds = 0;
          car.gridlockEscapeSeconds = 0;
          car.priorityToken = this.nextPriorityToken;
          this.nextPriorityToken += 1;
          if (this.nextPriorityToken > Number.MAX_SAFE_INTEGER - 1000) this.nextPriorityToken = 1;
        }
        if (decision.state === 'intersection') {
          car.waitTimer += dt;
          car.intersectionWaitSeconds += dt;
          car.gridlockEscapeSeconds = Math.max(0, car.intersectionWaitSeconds - 5);
        }
      } else {
        car.intersectionStopKey = undefined;
        car.waitTimer = 0;
        car.intersectionWaitSeconds = 0;
        car.gridlockEscapeSeconds = 0;
        car.priorityToken = 0;
        car.intersectionQueuePosition = undefined;
        car.intersectionQueueLength = undefined;
      }

      const insideIntersection = isIntersection(this.grid, { x: car.currentTileX, y: car.currentTileY });
      if (insideIntersection && car.currentSpeed < 0.18) {
        car.insideIntersectionSeconds += dt;
      } else if (!insideIntersection) {
        car.insideIntersectionSeconds = 0;
      } else {
        car.insideIntersectionSeconds = Math.max(0, car.insideIntersectionSeconds - dt * 2);
      }

      if (car.currentSpeed < 0.08 && decision.targetSpeed < 0.2) {
        car.stuckSeconds += dt;
      } else if (car.currentSpeed > 0.25) {
        car.stuckSeconds = Math.max(0, car.stuckSeconds - dt * 2.5);
      }

      if (car.currentSpeed < 0.25) car.delay += dt;

      const rerouteStuckSeconds = shouldDelayIntersectionReroute(car) ? INTERSECTION_REROUTE_STUCK_SECONDS : REROUTE_STUCK_SECONDS;
      if (car.stuckSeconds >= rerouteStuckSeconds && car.rerouteCooldownSeconds <= 0 && !insideIntersection) {
        const rerouted = this.tryRerouteCar(car);
        if (!rerouted && car.stuckSeconds >= REROUTE_FORCE_SECONDS && car.intersectionStopKey) {
          car.rerouteCooldownSeconds = REROUTE_COOLDOWN_SECONDS * 0.5;
          car.lastRerouteReason = 'Sem rota melhor: aguardando abertura do semáforo';
        }
      }

      car.progressToNext += car.currentSpeed * dt;
      while (car.progressToNext >= 1 && car.routeIndex < car.route.length - 1) {
        car.progressToNext -= 1;
        car.routeIndex += 1;
        const pos = car.route[car.routeIndex];
        car.currentTileX = pos.x;
        car.currentTileY = pos.y;
        car.x = pos.x;
        car.y = pos.y;
      }
      if (car.routeIndex >= car.route.length - 1) {
        car.lifecyclePhase = 'destinationEntry';
        car.lifecycleProgress = 0;
        car.currentSpeed = Math.min(car.currentSpeed, 0.5);
        car.targetSpeed = 0;
        car.status = 'moving';
      } else {
        const current = car.route[car.routeIndex];
        const next = car.route[car.routeIndex + 1];
        car.x = current.x + (next.x - current.x) * car.progressToNext + car.laneOffset.x;
        car.y = current.y + (next.y - current.y) * car.progressToNext + car.laneOffset.y;
      }
    }
    if (arrived.length) {
      for (const car of arrived) {
        this.completedTrips += 1;
        this.tripHistory.push(car.travelTime);
        if (this.tripHistory.length > TRAVEL_TIME_HISTORY_LIMIT) this.tripHistory.shift();
      }
      this.cars = this.cars.filter((c) => c.status !== 'arrived');
      this.averageTravelTime = this.tripHistory.length ? this.tripHistory.reduce((a, b) => a + b, 0) / this.tripHistory.length : 0;
    }
  }

  private carUpdatePriority(car: Car): number {
    const insideIntersection = isIntersection(this.grid, { x: car.currentTileX, y: car.currentTileY }) ? 1000 : 0;
    const transition = car.signalTransitionGraceSeconds > 0 ? 300 : 0;
    const wait = Math.max(car.intersectionWaitSeconds, car.stuckSeconds) * 10;
    return insideIntersection + transition + wait;
  }

  private isSpawnLaneBlocked(origin: Vec2, laneOffset: Vec2, direction: Car['direction']): boolean {
    const spawnX = origin.x + laneOffset.x;
    const spawnY = origin.y + laneOffset.y;
    const laneAxis = direction === 'east' || direction === 'west' ? 'y' : 'x';

    return this.cars.some((car) => {
      if (car.status === 'arrived') return false;
      if (car.lifecyclePhase !== 'driving') return false;
      if (Math.abs(car[laneAxis] - (laneAxis === 'x' ? spawnX : spawnY)) > 0.18) return false;
      return Math.hypot(car.x - spawnX, car.y - spawnY) < SPAWN_LANE_CLEAR_DISTANCE;
    });
  }

  private debugSpawnBlocked(origin: Vec2, direction: Car['direction']): void {
    if (!isTrafficDebugEnabled()) return;
    console.info('[spawn-blocked]', {
      origin: `${origin.x},${origin.y}`,
      direction,
      activeCars: this.cars.length,
    });
  }

  private tryRerouteCar(car: Car): boolean {
    const destination = this.getBuilding(car.destinationBuildingId)?.nearestRoad;
    if (!destination) return false;

    const start = { x: car.currentTileX, y: car.currentTileY };
    if (!isRoadType(this.grid[start.y]?.[start.x]?.type)) return false;
    if (keyOf(start.x, start.y) === keyOf(destination.x, destination.y)) return false;

    const trafficForReroute = this.buildRerouteTraffic(car);
    const newRoute = findFastestPath(this.grid, trafficForReroute, start, destination);
    if (newRoute.length < 2) return false;

    const oldRemaining = car.route.slice(car.routeIndex);
    const newScore = estimateRouteCost(this.grid, trafficForReroute, newRoute);
    const oldScore = estimateRouteCost(this.grid, trafficForReroute, oldRemaining);
    const differentNext = oldRemaining[1] && newRoute[1]
      ? keyOf(oldRemaining[1].x, oldRemaining[1].y) !== keyOf(newRoute[1].x, newRoute[1].y)
      : true;

    if (!differentNext && car.stuckSeconds < REROUTE_FORCE_SECONDS) return false;
    if (newScore > oldScore * 0.94 && car.stuckSeconds < REROUTE_FORCE_SECONDS) return false;

    const direction = getDirection(newRoute[0], newRoute[1]);
    const roadType = this.getRoadTypeAt(newRoute[0]);
    const lane = getLaneOffset(direction, roadType, car.id, this.getOneWayAt(newRoute[0], direction));

    car.route = newRoute;
    car.routeIndex = 0;
    car.progressToNext = 0;
    car.currentTileX = newRoute[0].x;
    car.currentTileY = newRoute[0].y;
    car.x = newRoute[0].x + lane.offset.x;
    car.y = newRoute[0].y + lane.offset.y;
    car.direction = direction;
    car.laneOffset = lane.offset;
    car.laneIndex = lane.laneIndex;
    car.laneCount = lane.laneCount;
    car.laneSide = lane.laneSide;
    car.estimatedTime = newRoute.length / Math.max(0.1, car.baseSpeed);
    car.rerouteCooldownSeconds = REROUTE_COOLDOWN_SECONDS;
    car.rerouteCount += 1;
    car.lastRerouteReason = newScore < oldScore ? 'Rota alternativa mais livre' : 'Destravamento por espera prolongada';
    car.stuckSeconds = 0;
    car.intersectionStopKey = undefined;
    car.waitTimer = 0;
    car.intersectionWaitSeconds = 0;
    car.gridlockEscapeSeconds = 0;
    return true;
  }

  private rerouteCarsAffectedBy(area: Vec2[]): void {
    const affectedKeys = new Set(area.map((pos) => keyOf(pos.x, pos.y)));
    for (const car of this.cars) {
      if (car.lifecyclePhase !== 'driving') continue;
      const remainingRoute = car.route.slice(car.routeIndex);
      if (!remainingRoute.some((pos) => affectedKeys.has(keyOf(pos.x, pos.y)))) continue;

      if (isRoadType(this.grid[car.currentTileY]?.[car.currentTileX]?.type)) {
        this.tryRerouteCar(car);
        continue;
      }

      const fallbackStart = this.findNearestRoadTile({ x: car.currentTileX, y: car.currentTileY }, area);
      const destination = this.getBuilding(car.destinationBuildingId)?.nearestRoad;
      if (!fallbackStart || !destination) {
        car.route = [{ x: car.currentTileX, y: car.currentTileY }];
        car.routeIndex = 0;
        car.status = 'arrived';
        this.recordFailedTrip();
        continue;
      }

      const newRoute = findFastestPath(this.grid, this.traffic, fallbackStart, destination);
      if (newRoute.length < 2) {
        car.route = [fallbackStart];
        car.routeIndex = 0;
        car.currentTileX = fallbackStart.x;
        car.currentTileY = fallbackStart.y;
        car.x = fallbackStart.x;
        car.y = fallbackStart.y;
        car.status = 'arrived';
        this.recordFailedTrip();
        continue;
      }

      const direction = getDirection(newRoute[0], newRoute[1]);
      const roadType = this.getRoadTypeAt(newRoute[0]);
      const lane = getLaneOffset(direction, roadType, car.id, this.getOneWayAt(newRoute[0], direction));
      car.route = newRoute;
      car.routeIndex = 0;
      car.progressToNext = 0;
      car.currentTileX = newRoute[0].x;
      car.currentTileY = newRoute[0].y;
      car.x = newRoute[0].x + lane.offset.x;
      car.y = newRoute[0].y + lane.offset.y;
      car.direction = direction;
      car.laneOffset = lane.offset;
      car.laneIndex = lane.laneIndex;
      car.laneCount = lane.laneCount;
      car.laneSide = lane.laneSide;
      car.currentSpeed = 0;
      car.targetSpeed = 0;
      car.stuckSeconds = 0;
      car.intersectionStopKey = undefined;
      car.intersectionWaitSeconds = 0;
      car.waitTimer = 0;
      car.rerouteCount += 1;
      car.lastRerouteReason = 'Via alterada: rota recalculada';
    }
  }

  private findNearestRoadTile(origin: Vec2, candidates: Vec2[]): Vec2 | undefined {
    return candidates
      .filter((pos) => isRoadType(this.grid[pos.y]?.[pos.x]?.type))
      .sort((a, b) => (
        Math.abs(a.x - origin.x) + Math.abs(a.y - origin.y)
        - (Math.abs(b.x - origin.x) + Math.abs(b.y - origin.y))
      ))[0];
  }

  private buildRerouteTraffic(carToReroute: Car): Map<string, TrafficCell> {
    const map = new Map<string, TrafficCell>();
    for (const [key, value] of this.traffic) {
      map.set(key, { ...value });
    }

    for (const car of this.cars) {
      if (car.id === carToReroute.id || car.status === 'arrived') continue;
      if (car.lifecyclePhase !== 'driving') continue;
      const pressure = car.status === 'stopped' || car.stuckSeconds > 2 ? 3.5 : 0.8;
      addTrafficPenalty(map, car.currentTileX, car.currentTileY, pressure);
      const next = car.route[car.routeIndex + 1];
      if (next) addTrafficPenalty(map, next.x, next.y, pressure * 0.65);
    }

    return map;
  }

  private growCity(): void {
    const stats = this.getSnapshot();
    if (stats.population > 120) this.cityLevel = Math.max(this.cityLevel, 2);
    if (stats.population > 280) this.cityLevel = Math.max(this.cityLevel, 3);
    if (this.satisfaction < 35) return;
    const building = this.generator.spawn(this.grid, this.buildings, this.cityLevel);
    if (building) this.addBuilding(building);
  }

  private updateDailyBuildingActivity(): void {
    const day = this.time.getDay();
    if (day === this.lastProcessedDay) return;
    this.lastProcessedDay = day;
    this.buildings = this.buildings.map((building) => ({
      ...building,
      tripsToday: Math.floor(building.tripsToday * 0.25),
    }));
    this.refreshSelectedBuilding();
  }

  private updateBuildingUpgrades(): void {
    const snapshot = this.getSnapshot();
    if (this.satisfaction < BUILDING_UPGRADE_MIN_SATISFACTION) return;
    if (snapshot.averageCongestion >= BUILDING_UPGRADE_MAX_CONGESTION) return;

    const candidates = this.buildings
      .map((building) => ({
        building,
        status: this.getBuildingUpgradeStatus(building),
        score: this.getBuildingUpgradeScore(building),
      }))
      .filter((candidate) => candidate.status.canUpgrade && candidate.score >= BUILDING_UPGRADE_MIN_SCORE)
      .sort((a, b) => b.score - a.score);

    const candidate = candidates[0];
    if (!candidate) return;
    const nextLevel = this.nextAllowedBuildingLevel(candidate.building);
    if (!nextLevel) return;

    this.buildings = this.buildings.map((building) => (
      building.id === candidate.building.id
        ? applyBuildingLevel(building, nextLevel, this.time.getDay())
        : building
    ));
    this.refreshSelectedBuilding();
  }

  getBuildingUpgradeStatus(building: Building): { canUpgrade: boolean; reason: string; nextLevel: BuildingLevel | null; score: number } {
    const nextLevel = this.nextAllowedBuildingLevel(building);
    const score = this.getBuildingUpgradeScore(building);
    if (!nextLevel) return { canUpgrade: false, reason: 'Construção no nível máximo', nextLevel: null, score };
    if (!building.connected) return { canUpgrade: false, reason: 'Precisa de conexão', nextLevel, score };
    if (this.satisfaction < BUILDING_UPGRADE_MIN_SATISFACTION) return { canUpgrade: false, reason: 'Satisfação baixa demais', nextLevel, score };
    if (this.getSnapshot().averageCongestion >= BUILDING_UPGRADE_MAX_CONGESTION) return { canUpgrade: false, reason: 'Trânsito alto demais', nextLevel, score };
    if (!this.isBuildingLevelUnlocked(nextLevel)) return { canUpgrade: false, reason: 'Cidade precisa de nível maior', nextLevel, score };
    if (score < BUILDING_UPGRADE_MIN_SCORE) return { canUpgrade: false, reason: 'Precisa de mais atividade', nextLevel, score };
    return { canUpgrade: true, reason: 'Pode evoluir', nextLevel, score };
  }

  private nextAllowedBuildingLevel(building: Building): BuildingLevel | null {
    if (building.level === 1) return 2;
    if (building.level === 2) return 3;
    return null;
  }

  private isBuildingLevelUnlocked(level: BuildingLevel): boolean {
    if (level === 1) return true;
    if (level === 2) return this.cityLevel >= 2 || this.time.getDay() >= 2;
    return this.cityLevel >= 3 || this.time.getDay() >= 4;
  }

  private getBuildingUpgradeScore(building: Building): number {
    const nearbyTraffic = this.getNearbyBuildingTraffic(building);
    const levelBias = building.level === 1 ? 0.5 : 0;
    const satisfactionBonus = Math.max(0, (this.satisfaction - BUILDING_UPGRADE_MIN_SATISFACTION) / 40);
    return building.tripsToday * 0.7 + nearbyTraffic * 3.2 + satisfactionBonus + levelBias;
  }

  private getNearbyBuildingTraffic(building: Building): number {
    let max = 0;
    for (const next of [{ x: building.x + 1, y: building.y }, { x: building.x - 1, y: building.y }, { x: building.x, y: building.y + 1 }, { x: building.x, y: building.y - 1 }]) {
      const traffic = this.traffic.get(keyOf(next.x, next.y));
      if (traffic) max = Math.max(max, Math.min(2, traffic.cars / Math.max(1, traffic.capacity)));
    }
    return max;
  }

  private refreshSelectedBuilding(): void {
    if (this.selected.kind !== 'building') return;
    const building = this.getBuilding(this.selected.building.id);
    if (building) this.selected = { kind: 'building', building };
  }

  private refreshSelectedRoad(): void {
    if (this.selected.kind !== 'road') return;
    this.inspectAt(this.selected.x, this.selected.y);
  }

  private getRoadTypeAt(pos: Vec2): RoadType {
    const type = this.grid[pos.y]?.[pos.x]?.type;
    return type === 'avenue' || type === 'roundabout' ? type : 'road';
  }

  private getOneWayAt(pos: Vec2, direction: RoadDirection): RoadDirection | undefined {
    const tile = this.grid[pos.y]?.[pos.x];
    if ((tile?.type !== 'road' && tile?.type !== 'avenue') || tile.oneWay !== direction) return undefined;
    return tile.oneWay;
  }

  private updateEconomyAndSatisfaction(): void {
    const connectedShops = this.buildings.filter((b) => b.type === 'shop' && b.connected).length;
    const connectedOffices = this.buildings.filter((b) => b.type === 'office' && b.connected).length;
    const recentTrips = this.tripHistory.slice(-20).length;
    this.money += recentTrips * 1.5 + connectedShops * 4 + connectedOffices * 6;

    const snapshot = this.getSnapshot();
    const disconnectedPenalty = snapshot.disconnectedBuildings * 4.5;
    const congestionPenalty = Math.min(52, snapshot.averageCongestion * 0.28);
    const failedPenalty = Math.min(25, this.failedTripPressure * FAILED_TRIP_PENALTY_FACTOR);
    const travelPenalty = Math.min(25, Math.max(0, this.averageTravelTime - 7) * 1.8);
    this.satisfaction = Math.max(0, Math.min(100, 100 - disconnectedPenalty - congestionPenalty - failedPenalty - travelPenalty));
    this.failedTripPressure *= FAILED_TRIP_PRESSURE_DECAY;
  }

  private recordFailedTrip(): void {
    this.failedTrips += 1;
    this.failedTripPressure += 1;
  }

  getSelectedCarRoute(): Vec2[] {
    if (this.selected.kind !== 'car') return [];
    return this.getCar(this.selected.carId)?.route ?? [];
  }
}

function applySmoothSpeed(car: Car, targetSpeed: number, dt: number, hardStop: boolean): void {
  if (hardStop) {
    car.currentSpeed = 0;
    return;
  }

  if (targetSpeed > car.currentSpeed) {
    car.currentSpeed = Math.min(targetSpeed, car.currentSpeed + car.acceleration * dt);
    return;
  }

  car.currentSpeed = Math.max(targetSpeed, car.currentSpeed - car.braking * dt);
}

function shouldDelayIntersectionReroute(car: Car): boolean {
  return car.trafficState === 'intersection'
    && (
      car.intersectionReason === 'signal_red'
      || car.intersectionReason === 'signal_yellow'
      || car.intersectionReason === 'exit_blocked'
      || car.intersectionReason === 'box_occupied'
      || car.intersectionReason === 'unsignalized_queue'
    );
}

function addTrafficPenalty(map: Map<string, TrafficCell>, x: number, y: number, amount: number): void {
  const key = keyOf(x, y);
  const current = map.get(key);
  if (!current) return;
  current.congestion += amount;
  current.cars += Math.ceil(amount);
}

function estimateRouteCost(grid: Tile[][], traffic: Map<string, TrafficCell>, route: Vec2[]): number {
  let total = 0;
  for (const pos of route) {
    const tile = grid[pos.y]?.[pos.x];
    if (!tile || !isRoadType(tile.type)) {
      total += 999;
      continue;
    }
    const roadType = tile.type as RoadType;
    const trafficCell = traffic.get(keyOf(pos.x, pos.y));
    const congestionPenalty = trafficCell ? Math.max(0, trafficCell.congestion - 0.2) * 12 : 0;
    total += ROAD_CONFIG[roadType].pathCost + congestionPenalty;
  }
  return total;
}

function dedupeTiles(tiles: Vec2[]): Vec2[] {
  const seen = new Set<string>();
  const result: Vec2[] = [];
  for (const tile of tiles) {
    const key = keyOf(tile.x, tile.y);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tile);
  }
  return result;
}

function nextOneWayDirection(direction?: RoadDirection): RoadDirection | undefined {
  if (!direction) return 'east';
  if (direction === 'east') return 'south';
  if (direction === 'south') return 'west';
  if (direction === 'west') return 'north';
  return undefined;
}

function isTrafficDebugEnabled(): boolean {
  try {
    const fromStorage = globalThis.localStorage?.getItem('cityTrafficDebug') === '1';
    const fromUrl = new URLSearchParams(globalThis.location?.search ?? '').get('trafficDebug') === '1';
    return fromStorage || fromUrl;
  } catch {
    return false;
  }
}
