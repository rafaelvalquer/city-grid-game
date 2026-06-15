import type { Car, TravelDirection } from '../../types/agent.types';
import { keyOf } from '../city/grid';

export type LaneAxis = 'x' | 'y';

export type CarSpatialIndex = {
  readonly byId: Map<string, Car>;
  readonly byTile: Map<string, Car[]>;
  readonly byLaneLine: Map<string, Car[]>;
  getById(id: string): Car | undefined;
  getCarsAtTile(x: number, y: number): readonly Car[];
  getCarsNearTile(x: number, y: number, radius?: number): Car[];
  getLaneLineCandidates(direction: TravelDirection, laneIndex: number, lineAxis: LaneAxis, lineValue: number): readonly Car[];
};

const EMPTY_CARS: readonly Car[] = [];

export function createCarSpatialIndex(cars: readonly Car[]): CarSpatialIndex {
  const byId = new Map<string, Car>();
  const byTile = new Map<string, Car[]>();
  const byLaneLine = new Map<string, Car[]>();

  for (const car of cars) {
    if (car.status === 'arrived' || car.lifecyclePhase !== 'driving') continue;

    byId.set(car.id, car);

    const tileKey = keyOf(car.currentTileX, car.currentTileY);
    let tileCars = byTile.get(tileKey);
    if (!tileCars) {
      tileCars = [];
      byTile.set(tileKey, tileCars);
    }
    tileCars.push(car);

    const lineAxis = getLaneLineAxis(car.direction);
    const lineValue = Math.round(car[lineAxis]);
    const laneKey = getLaneLineKey(car.direction, car.laneIndex, lineAxis, lineValue);
    let laneCars = byLaneLine.get(laneKey);
    if (!laneCars) {
      laneCars = [];
      byLaneLine.set(laneKey, laneCars);
    }
    laneCars.push(car);
  }

  return {
    byId,
    byTile,
    byLaneLine,
    getById: (id: string) => byId.get(id),
    getCarsAtTile: (x: number, y: number) => byTile.get(keyOf(x, y)) ?? EMPTY_CARS,
    getCarsNearTile: (x: number, y: number, radius = 1) => {
      const result: Car[] = [];
      const minX = x - radius;
      const maxX = x + radius;
      const minY = y - radius;
      const maxY = y + radius;

      for (let ty = minY; ty <= maxY; ty += 1) {
        for (let tx = minX; tx <= maxX; tx += 1) {
          const carsAtTile = byTile.get(keyOf(tx, ty));
          if (carsAtTile?.length) result.push(...carsAtTile);
        }
      }

      return result;
    },
    getLaneLineCandidates: (direction: TravelDirection, laneIndex: number, lineAxis: LaneAxis, lineValue: number) => (
      byLaneLine.get(getLaneLineKey(direction, laneIndex, lineAxis, lineValue)) ?? EMPTY_CARS
    ),
  };
}

export function getLaneLineAxis(direction: TravelDirection): LaneAxis {
  return direction === 'east' || direction === 'west' ? 'y' : 'x';
}

export function getLaneTravelAxis(direction: TravelDirection): LaneAxis {
  return direction === 'east' || direction === 'west' ? 'x' : 'y';
}

function getLaneLineKey(direction: TravelDirection, laneIndex: number, lineAxis: LaneAxis, lineValue: number): string {
  return `
${direction}:${laneIndex}:${lineAxis}:${lineValue}`.trim();
}
