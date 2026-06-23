import type { MetroLine, MetroStation, MetroTrain } from './metro.types';
import type { Helicopter, HelicopterLine, Helipad } from './helicopter.types';

export type TileType = 'empty' | 'road' | 'avenue' | 'roundabout' | 'roundaboutCenter' | 'building' | 'busStop' | 'metroStation' | 'helipad' | 'mountain' | 'lake';
export type BuildingType = 'house' | 'shop' | 'office';
export type BuildingLevel = 1 | 2 | 3;
export type BuildingConstructionState = 'constructing' | 'operational';
export type RoadType = 'road' | 'avenue' | 'roundabout';
export type RoadDirection = 'north' | 'south' | 'east' | 'west';
export type TerrainKind = 'mountain' | 'lake';
export type VegetationKind =
  | 'atlanticForest'
  | 'palm'
  | 'temperateConifer'
  | 'fern'
  | 'deciduous'
  | 'willow'
  | 'reeds'
  | 'fynbos'
  | 'protea'
  | 'andeanForest'
  | 'paramoShrub'
  | 'koreanPine'
  | 'cherryTree'
  | 'tropicalRainforest'
  | 'mangrove'
  | 'araucaria'
  | 'formalGarden'
  | 'planeTree'
  | 'ginkgo'
  | 'banyan';

export type DistrictStatus = 'owned' | 'available' | 'locked';
export type DistrictDirection = 'center' | 'east';

export type District = {
  id: string;
  name: string;
  direction: DistrictDirection;
  status: DistrictStatus;
  xStart: number;
  yStart: number;
  width: number;
  height: number;
  cost: number;
  purchasedAtDay?: number;
};

export type Vec2 = { x: number; y: number };

export type Tile = {
  x: number;
  y: number;
  type: TileType;
  buildingId?: string;
  metroStationId?: string;
  helipadId?: string;
  oneWay?: RoadDirection;
  busLane?: boolean;
  bikeLane?: boolean;
  terrainVariant?: number;
  terrainClusterId?: string;
  terrainDepth?: number;
  terrainEdgeMask?: number;
  vegetationKind?: VegetationKind;
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
  constructionState?: BuildingConstructionState;
  constructionProgress?: number;
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
  busCount?: number;
  reason?: string;
};

export type BikeTripVisual = {
  id: string;
  route: Vec2[];
  progress: number;
  speed: number;
  originBuildingId: string;
  destinationBuildingId: string;
  createdAtDay: number;
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
  busTripsCompleted: number;
  carTripsAvoided: number;
  waitingPassengers: number;
  activeBuses: number;
  busLaneTiles: number;
  busLaneCoverageRatio: number;
  districtsOwned: number;
  cityAreaTiles: number;
  maxCars: number;
  maxBuses: number;
  eastDistrictPurchased: boolean;
  bikeLaneTiles: number;
  bikeLaneCoverageRatio: number;
  bikeTripsCompleted: number;
  bikeCarsAvoided: number;
  activeBikeTrips: number;
  metroStations: number;
  metroLines: number;
  metroPassengers: number;
  metroCarsAvoided: number;
  metroTripsCompleted: number;
  metroPassengersWaiting: number;
  metroTrains: number;
  helipads: number;
  helicopterLines: number;
  helicopters: number;
  helicopterPassengers: number;
  helicopterPassengersWaiting: number;
  helicopterTripsCompleted: number;
  helicopterCarsAvoided: number;
  cityLevel: number;
  day: number;
  timeLabel: string;
  dayPeriod: string;
  terrainReliefEnabled: boolean;
  terrainBlockedTiles: number;
  mountainTiles: number;
  lakeTiles: number;
};

export type BuildingTypeCounts = Record<BuildingType, number>;
export type BuildingLevelCounts = Record<BuildingLevel, number>;

export type CityHistorySample = {
  key: string;
  day: number;
  hour: number;
  timeLabel: string;
  dayPeriod: string;
  population: number;
  activeCars: number;
  activeBuses: number;
  districtsOwned: number;
  cityAreaTiles: number;
  maxCars: number;
  maxBuses: number;
  waitingPassengers: number;
  completedTrips: number;
  failedTrips: number;
  publicTripsCompleted: number;
  busTripsCompleted: number;
  carTripsAvoided: number;
  bikeLaneTiles: number;
  bikeLaneCoverageRatio: number;
  bikeTripsCompleted: number;
  bikeCarsAvoided: number;
  activeBikeTrips: number;
  metroTripsCompleted: number;
  metroCarsAvoided: number;
  metroPassengers: number;
  metroPassengersWaiting: number;
  metroStations: number;
  metroLines: number;
  metroTrains: number;
  helipads: number;
  helicopterLines: number;
  helicopters: number;
  helicopterPassengers: number;
  helicopterPassengersWaiting: number;
  helicopterTripsCompleted: number;
  helicopterCarsAvoided: number;
  averageCongestion: number;
  satisfaction: number;
  averageTravelTime: number;
  cityLevel: number;
  buildingTypes: BuildingTypeCounts;
  buildingLevels: BuildingLevelCounts;
};

export type TrafficHeatmapTileSample = {
  x: number;
  y: number;
  cars: number;
  congestion: number;
  capacity: number;
  weight: number;
};

export type TrafficHeatmapSample = {
  key: string;
  day: number;
  hour: number;
  tiles: TrafficHeatmapTileSample[];
};

export type TrafficHeatmapCell = {
  x: number;
  y: number;
  samples: number;
  carsAverage: number;
  congestionAverage: number;
  weight: number;
};

export type TrafficHeatmapSummary = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  maxWeight: number;
  cells: TrafficHeatmapCell[];
};

export type SelectedEntity =
  | { kind: 'none' }
  | { kind: 'tile'; x: number; y: number; type: TileType }
  | { kind: 'building'; building: Building }
  | { kind: 'busStop'; stop: TransitStop }
  | { kind: 'road'; x: number; y: number; roadType: RoadType; traffic: TrafficCell; trafficLight?: TrafficLightState; oneWay?: RoadDirection; busLane?: boolean; bikeLane?: boolean }
  | { kind: 'car'; carId: string }
  | { kind: 'metroStation'; station: MetroStation }
  | { kind: 'metroLine'; line: MetroLine }
  | { kind: 'metroTrain'; trainId: string; train?: MetroTrain }
  | { kind: 'helipad'; helipad: Helipad }
  | { kind: 'helicopterLine'; line: HelicopterLine }
  | { kind: 'helicopter'; helicopterId: string; helicopter?: Helicopter };
