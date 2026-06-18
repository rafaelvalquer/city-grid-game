import type { Car, TravelDirection } from '../../types/agent.types';
import type { Building, Tile } from '../../types/city.types';
import { keyOf } from '../city/grid';
import { isIntersection } from './trafficRules';
import type { CarSpatialIndex, LaneAxis } from './carSpatialIndex';

const EMPTY_CARS: readonly Car[] = [];

type CarIndexState = {
  tileKey?: string;
  laneKey?: string;
  intersectionKeys: string[];
};

export class WorldEntityIndex implements CarSpatialIndex {
  readonly byId = new Map<string, Car>();
  readonly carById = this.byId;
  readonly buildingById = new Map<string, Building>();
  readonly byTile = new Map<string, Car[]>();
  readonly carsByTile = this.byTile;
  readonly byLaneLine = new Map<string, Car[]>();
  readonly carsByIntersection = new Map<string, Car[]>();

  private readonly carState = new Map<string, CarIndexState>();

  constructor(private grid: Tile[][]) {}

  setGrid(grid: Tile[][]): void {
    this.grid = grid;
  }

  rebuild(cars: readonly Car[], buildings: readonly Building[]): void {
    this.byId.clear();
    this.buildingById.clear();
    this.byTile.clear();
    this.byLaneLine.clear();
    this.carsByIntersection.clear();
    this.carState.clear();
    for (const building of buildings) this.addBuilding(building);
    for (const car of cars) this.addCar(car);
  }

  rebuildCars(cars: readonly Car[]): void {
    this.byId.clear();
    this.byTile.clear();
    this.byLaneLine.clear();
    this.carsByIntersection.clear();
    this.carState.clear();
    for (const car of cars) this.addCar(car);
  }

  rebuildBuildings(buildings: readonly Building[]): void {
    this.buildingById.clear();
    for (const building of buildings) this.addBuilding(building);
  }

  addCar(car: Car): void {
    this.byId.set(car.id, car);
    this.carState.set(car.id, { intersectionKeys: [] });
    this.syncCar(car);
  }

  removeCar(carOrId: Car | string): void {
    const id = typeof carOrId === 'string' ? carOrId : carOrId.id;
    const car = this.byId.get(id);
    const state = this.carState.get(id);
    if (car && state) this.detachCar(car, state);
    this.byId.delete(id);
    this.carState.delete(id);
  }

  syncCar(car: Car): void {
    this.byId.set(car.id, car);
    const previous: CarIndexState = this.carState.get(car.id) ?? { intersectionKeys: [] };
    const next = this.describeCar(car);

    if (previous.tileKey !== next.tileKey) {
      if (previous.tileKey) removeFromBucket(this.byTile, previous.tileKey, car);
      if (next.tileKey) addToBucket(this.byTile, next.tileKey, car);
    }
    if (previous.laneKey !== next.laneKey) {
      if (previous.laneKey) removeFromBucket(this.byLaneLine, previous.laneKey, car);
      if (next.laneKey) addToBucket(this.byLaneLine, next.laneKey, car);
    }

    const previousIntersections = new Set(previous.intersectionKeys ?? []);
    const nextIntersections = new Set(next.intersectionKeys);
    for (const key of previousIntersections) {
      if (!nextIntersections.has(key)) removeFromBucket(this.carsByIntersection, key, car);
    }
    for (const key of nextIntersections) {
      if (!previousIntersections.has(key)) addToBucket(this.carsByIntersection, key, car);
    }

    this.carState.set(car.id, next);
  }

  addBuilding(building: Building): void {
    this.buildingById.set(building.id, building);
  }

  removeBuilding(buildingOrId: Building | string): void {
    this.buildingById.delete(typeof buildingOrId === 'string' ? buildingOrId : buildingOrId.id);
  }

  getById(id: string): Car | undefined {
    return this.byId.get(id);
  }

  getBuildingById(id: string): Building | undefined {
    return this.buildingById.get(id);
  }

  getCarsAtTile(x: number, y: number): readonly Car[] {
    return this.byTile.get(keyOf(x, y)) ?? EMPTY_CARS;
  }

  getCarsNearTile(x: number, y: number, radius = 1): Car[] {
    const result: Car[] = [];
    for (let ty = y - radius; ty <= y + radius; ty += 1) {
      for (let tx = x - radius; tx <= x + radius; tx += 1) {
        const cars = this.byTile.get(keyOf(tx, ty));
        if (cars?.length) result.push(...cars);
      }
    }
    return result;
  }

  getCarsForIntersection(x: number, y: number): readonly Car[] {
    return this.carsByIntersection.get(keyOf(x, y)) ?? EMPTY_CARS;
  }

  getLaneLineCandidates(direction: TravelDirection, laneIndex: number, lineAxis: LaneAxis, lineValue: number): readonly Car[] {
    return this.byLaneLine.get(laneLineKey(direction, laneIndex, lineAxis, lineValue)) ?? EMPTY_CARS;
  }

  validate(cars: readonly Car[], buildings: readonly Building[]): boolean {
    if (this.byId.size !== cars.length || this.buildingById.size !== buildings.length) return false;
    return cars.every((car) => this.byId.get(car.id) === car)
      && buildings.every((building) => this.buildingById.get(building.id) === building);
  }

  private describeCar(car: Car): CarIndexState {
    if (car.status === 'arrived' || car.status === 'no_route') return { intersectionKeys: [] };

    const tileKey = keyOf(car.currentTileX, car.currentTileY);
    const laneAxis: LaneAxis = car.direction === 'east' || car.direction === 'west' ? 'y' : 'x';
    const laneKey = car.lifecyclePhase === 'driving'
      ? laneLineKey(car.direction, car.laneIndex, laneAxis, Math.round(car[laneAxis]))
      : undefined;
    const intersectionKeys: string[] = [];
    const current = { x: car.currentTileX, y: car.currentTileY };
    const next = car.route[car.routeIndex + 1];
    if (car.lifecyclePhase === 'driving' && isIntersection(this.grid, current)) {
      intersectionKeys.push(tileKey);
    }
    if (car.lifecyclePhase === 'driving' && next && isIntersection(this.grid, next)) {
      const nextKey = keyOf(next.x, next.y);
      if (!intersectionKeys.includes(nextKey)) intersectionKeys.push(nextKey);
    }
    return { tileKey, laneKey, intersectionKeys };
  }

  private detachCar(car: Car, state: CarIndexState): void {
    if (state.tileKey) removeFromBucket(this.byTile, state.tileKey, car);
    if (state.laneKey) removeFromBucket(this.byLaneLine, state.laneKey, car);
    for (const key of state.intersectionKeys ?? []) removeFromBucket(this.carsByIntersection, key, car);
  }
}

function addToBucket(map: Map<string, Car[]>, key: string, car: Car): void {
  const bucket = map.get(key);
  if (bucket) {
    if (!bucket.includes(car)) bucket.push(car);
    return;
  }
  map.set(key, [car]);
}

function removeFromBucket(map: Map<string, Car[]>, key: string, car: Car): void {
  const bucket = map.get(key);
  if (!bucket) return;
  const index = bucket.indexOf(car);
  if (index >= 0) bucket.splice(index, 1);
  if (!bucket.length) map.delete(key);
}

function laneLineKey(direction: TravelDirection, laneIndex: number, lineAxis: LaneAxis, lineValue: number): string {
  return `${direction}:${laneIndex}:${lineAxis}:${lineValue}`;
}
