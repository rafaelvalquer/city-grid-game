import { nanoid } from 'nanoid';
import type { Building, CityStats, RoadType, SelectedEntity, Tile, TrafficCell, Vec2 } from '../../types/city.types';
import type { Car } from '../../types/agent.types';
import type { Tool } from '../../types/game.types';
import { GAME_CONFIG } from '../config/gameConfig';
import { ROAD_CONFIG } from '../config/roadConfig';
import { createGrid, inBounds, isRoadType, keyOf } from '../city/grid';
import { CityGenerator } from '../city/cityGenerator';
import { updateBuildingConnection } from '../city/buildings';
import { findFastestPath } from '../pathfinding/pathfinder';
import { buildIntersectionControls, computeTrafficDecision, getDirection, getLaneOffset, isIntersection } from '../systems/trafficRules';
import { TimeSystem } from './timeSystem';
import { chooseTrip } from '../agents/tripGenerator';

export class GameWorld {
  grid: Tile[][] = createGrid();
  buildings: Building[] = [];
  cars: Car[] = [];
  traffic = new Map<string, TrafficCell>();
  selected: SelectedEntity = { kind: 'none' };
  money = GAME_CONFIG.initialMoney;
  satisfaction = 100;
  completedTrips = 0;
  failedTrips = 0;
  averageTravelTime = 0;
  cityLevel = 1;
  time = new TimeSystem();
  generator = new CityGenerator();

  private buildingTimer = 0;
  private tripTimer = 0;
  private economyTimer = 0;
  private listeners = new Set<() => void>();
  private tripHistory: number[] = [];
  private nextPriorityToken = 1;

  constructor() {
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
    this.buildingTimer += dt;
    this.tripTimer += dt;
    this.economyTimer += dt;

    this.updateConnections();
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

    if (this.economyTimer >= GAME_CONFIG.economyTickSeconds) {
      this.economyTimer = 0;
      this.updateEconomyAndSatisfaction();
    }
  }

  buildAt(x: number, y: number, tool: Tool): boolean {
    if (!inBounds(x, y)) return false;
    const tile = this.grid[y][x];
    if (tool === 'road' || tool === 'avenue') {
      if (tile.type === 'building') return false;
      const cost = ROAD_CONFIG[tool].buildCost;
      if (this.money < cost) return false;
      if (tile.type === tool) return false;
      this.grid[y][x] = { x, y, type: tool };
      this.money -= cost;
      this.updateConnections();
      this.emit();
      return true;
    }
    if (tool === 'remove') {
      if (!isRoadType(tile.type)) return false;
      const roadType = tile.type as RoadType;
      const cost = ROAD_CONFIG[roadType].removeCost;
      if (this.money < cost) return false;
      this.grid[y][x] = { x, y, type: 'empty' };
      this.money -= cost;
      this.updateConnections();
      this.emit();
      return true;
    }
    return false;
  }

  inspectAt(x: number, y: number): SelectedEntity {
    if (!inBounds(x, y)) return { kind: 'none' };
    const tile = this.grid[y][x];
    if (tile.type === 'building' && tile.buildingId) {
      const building = this.buildings.find((b) => b.id === tile.buildingId);
      if (building) this.selected = { kind: 'building', building };
    } else if (isRoadType(tile.type)) {
      const t = this.traffic.get(keyOf(x, y)) ?? { x, y, cars: 0, capacity: ROAD_CONFIG[tile.type as RoadType].capacity, congestion: 0 };
      this.selected = { kind: 'road', x, y, roadType: tile.type as RoadType, traffic: t };
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
      const k = keyOf(car.currentTileX, car.currentTileY);
      const info = map.get(k);
      if (info) {
        info.cars += 1;
        if (car.trafficState === 'queued' || car.trafficState === 'intersection' || car.status === 'stopped') {
          pressure.set(k, (pressure.get(k) ?? 0) + 1.35);
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
        this.failedTrips += 1;
        continue;
      }
      const route = findFastestPath(this.grid, this.traffic, trip.origin.nearestRoad, trip.destination.nearestRoad);
      if (route.length < 2) {
        this.failedTrips += 1;
        continue;
      }
      const initialDirection = getDirection(route[0], route[1]);
      const initialRoadType = this.grid[route[0].y]?.[route[0].x]?.type === 'avenue' ? 'avenue' : 'road';
      const carId = nanoid(8);
      const lane = getLaneOffset(initialDirection, initialRoadType, carId);
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
        direction: initialDirection,
        status: 'moving',
        travelTime: 0,
        estimatedTime: route.length / 1.45,
        delay: 0,
      });
      trip.origin.tripsToday += 1;
    }
  }

  private updateCars(dt: number): void {
    const arrived: Car[] = [];
    const intersectionControls = buildIntersectionControls(this.grid, this.cars);
    for (const car of this.cars) {
      car.travelTime += dt;
      const traffic = this.traffic.get(keyOf(car.currentTileX, car.currentTileY));
      const congestion = traffic?.congestion ?? 0;
      const decision = computeTrafficDecision(this.grid, car, this.cars, intersectionControls, congestion);
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

      if (car.currentSpeed < 0.25) car.delay += dt;
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
        car.status = 'arrived';
        arrived.push(car);
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
        if (this.tripHistory.length > 100) this.tripHistory.shift();
      }
      this.cars = this.cars.filter((c) => c.status !== 'arrived');
      this.averageTravelTime = this.tripHistory.length ? this.tripHistory.reduce((a, b) => a + b, 0) / this.tripHistory.length : 0;
    }
  }

  private growCity(): void {
    const stats = this.getSnapshot();
    if (stats.population > 120) this.cityLevel = Math.max(this.cityLevel, 2);
    if (stats.population > 280) this.cityLevel = Math.max(this.cityLevel, 3);
    if (this.satisfaction < 35) return;
    const building = this.generator.spawn(this.grid, this.buildings, this.cityLevel);
    if (building) this.addBuilding(building);
  }

  private updateEconomyAndSatisfaction(): void {
    const connectedShops = this.buildings.filter((b) => b.type === 'shop' && b.connected).length;
    const connectedOffices = this.buildings.filter((b) => b.type === 'office' && b.connected).length;
    const recentTrips = this.tripHistory.slice(-20).length;
    this.money += recentTrips * 1.5 + connectedShops * 4 + connectedOffices * 6;

    const snapshot = this.getSnapshot();
    const disconnectedPenalty = snapshot.disconnectedBuildings * 4.5;
    const congestionPenalty = Math.min(52, snapshot.averageCongestion * 0.28);
    const failedPenalty = Math.min(25, this.failedTrips * 0.12);
    const travelPenalty = Math.min(25, Math.max(0, this.averageTravelTime - 7) * 1.8);
    this.satisfaction = Math.max(0, Math.min(100, 100 - disconnectedPenalty - congestionPenalty - failedPenalty - travelPenalty));
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
