export type TileType = 'empty' | 'road' | 'avenue' | 'roundabout' | 'roundaboutCenter' | 'building' | 'busStop';
export type BuildingType = 'house' | 'shop' | 'office';
export type BuildingLevel = 1 | 2 | 3;
export type RoadType = 'road' | 'avenue' | 'roundabout';
export type RoadDirection = 'north' | 'south' | 'east' | 'west';

export type Vec2 = { x: number; y: number };

export type Tile = {
  x: number;
  y: number;
  type: TileType;
  buildingId?: string;
  oneWay?: RoadDirection;
};

export type Building = {
  id: string;
  type: BuildingType;
  level: BuildingLevel;
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
  upgradedAtDay?: number;
};

export type TrafficCell = {
  x: number;
  y: number;
  cars: number;
  capacity: number;
  congestion: number;
};

export type TransitPassengerGroup = {
  destinationStopId: string;
  count: number;
};

export type TransitStop = {
  id: string;
  x: number;
  y: number;
  accessRoad: Vec2;
  waiting: TransitPassengerGroup[];
  totalBoarded: number;
  totalAlighted: number;
  arrivalPulse: number;
  createdOrder: number;
};

export type TransitLine = {
  id: string;
  stopIds: string[];
  route: Vec2[];
  active: boolean;
  reason?: string;
};

export type TrafficLightAxis = 'horizontal' | 'vertical';
export type TrafficLightPhase = 'horizontalGreen' | 'horizontalYellow' | 'verticalGreen' | 'verticalYellow' | 'allRedClearance';
export type TrafficLightSignal = 'green' | 'yellow' | 'red';
export type TrafficLightSwitchReason = 'timer' | 'adaptive' | 'emergency' | 'startup';

export type TrafficLightState = {
  id: string;
  x: number;
  y: number;
  phase: TrafficLightPhase;
  timer: number;
  greenSeconds: number;
  yellowSeconds: number;
  offsetSeconds: number;
  startupSeconds: number;
  emergencyAxis?: TrafficLightAxis;
  emergencySeconds: number;
  nextGreenAxis?: TrafficLightAxis;
  lastSwitchReason: TrafficLightSwitchReason;
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
  publicTripsCompleted: number;
  carTripsAvoided: number;
  waitingPassengers: number;
  activeBuses: number;
  cityLevel: number;
  day: number;
  timeLabel: string;
  dayPeriod: string;
};

export type SelectedEntity =
  | { kind: 'none' }
  | { kind: 'tile'; x: number; y: number; type: TileType }
  | { kind: 'building'; building: Building }
  | { kind: 'busStop'; stop: TransitStop }
  | { kind: 'road'; x: number; y: number; roadType: RoadType; traffic: TrafficCell; trafficLight?: TrafficLightState; oneWay?: RoadDirection }
  | { kind: 'car'; carId: string };
