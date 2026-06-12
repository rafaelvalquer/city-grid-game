export type TileType = 'empty' | 'road' | 'avenue' | 'building';
export type BuildingType = 'house' | 'shop' | 'office';
export type RoadType = 'road' | 'avenue';

export type Vec2 = { x: number; y: number };

export type Tile = {
  x: number;
  y: number;
  type: TileType;
  buildingId?: string;
};

export type Building = {
  id: string;
  type: BuildingType;
  x: number;
  y: number;
  width: number;
  height: number;
  population: number;
  jobs: number;
  attraction: number;
  connected: boolean;
  nearestRoad?: Vec2;
  tripsToday: number;
};

export type TrafficCell = {
  x: number;
  y: number;
  cars: number;
  capacity: number;
  congestion: number;
};

export type CityStats = {
  money: number;
  population: number;
  activeCars: number;
  satisfaction: number;
  averageCongestion: number;
  averageTravelTime: number;
  disconnectedBuildings: number;
  completedTrips: number;
  failedTrips: number;
  cityLevel: number;
  timeLabel: string;
  dayPeriod: string;
};

export type SelectedEntity =
  | { kind: 'none' }
  | { kind: 'tile'; x: number; y: number; type: TileType }
  | { kind: 'building'; building: Building }
  | { kind: 'road'; x: number; y: number; roadType: RoadType; traffic: TrafficCell }
  | { kind: 'car'; carId: string };
