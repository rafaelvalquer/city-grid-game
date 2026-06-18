import type { Car, TravelDirection } from '../../types/agent.types';

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
