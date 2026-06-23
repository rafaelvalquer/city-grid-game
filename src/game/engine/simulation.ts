import { nanoid } from 'nanoid';
import type { Building, BuildingLevel, CityHistorySample, CityStats, District, RoadDirection, RoadType, SelectedEntity, Tile, TrafficCell, TrafficHeatmapCell, TrafficHeatmapSample, TrafficHeatmapSummary, BikeTripVisual, TrafficLightAxis, TrafficLightState, TransitLine, TransitPassengerGroup, TransitStop, Vec2 } from '../../types/city.types';
import type { Car } from '../../types/agent.types';
import type { MetroLine, MetroLineStats, MetroStation, MetroTrack, MetroTrain } from '../../types/metro.types';
import type { Helicopter, HelicopterLine, HelicopterLineStats, HelicopterPassengerGroup, Helipad } from '../../types/helicopter.types';
import type { Tool } from '../../types/game.types';
import { GAME_CONFIG } from '../config/gameConfig';
import type { CampaignCityId, GameMode, GameSetupOptions } from '../config/gameSetup';
import { ROAD_CONFIG } from '../config/roadConfig';
import { TRANSIT_CONFIG, BUS_LANE_CONFIG } from '../config/transitConfig';
import { METRO_CONFIG } from '../config/metroConfig';
import { BIKE_LANE_CONFIG } from '../config/bikeConfig';
import { HELICOPTER_CONFIG } from '../config/helicopterConfig';
import { DISTRICT_EXPANSION_CONFIG } from '../config/districtConfig';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { createGrid, inBounds, isRoadType, isTerrainBlocked, keyOf, setGridBounds } from '../city/grid';
import { CityGenerator } from '../city/cityGenerator';
import { generateTerrainReliefForBounds, getTerrainSummary } from '../city/terrainGenerator';
import { applyBuildingLevel, createBuilding, isBuildingOperational, normalizeBuildingConstruction, updateBuildingConnection } from '../city/buildings';
import { BUILDING_CONSTRUCTION_SECONDS, getBuildingLevelConfig } from '../config/buildingConfig';
import { findFastestPath } from '../pathfinding/pathfinder';
import { findBikeLanePath } from '../pathfinding/bikePathfinder';
import { buildIntersectionControls, computeTrafficDecision, getDirection, getLaneOffset, isIntersection } from '../systems/trafficRules';
import { WorldEntityIndex } from '../systems/worldEntityIndex';
import { canPlaceRoundabout, findRoundaboutCenterForTile, getDrivableNeighbors, getRoundaboutArea, getRoundaboutRing, isLegalRoadMove, isRoundaboutCenter, isRoundaboutTile } from '../systems/roundabouts';
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
import { findMetroStationPath } from '../metro/metroGraph';
import { buildMetroTrackTiles, pickMetroLineColor } from '../metro/metroLineBuilder';
import { PERFORMANCE_CONFIG } from '../config/performanceConfig';
import { createPerformanceProfiler } from '../performance/performanceProfiler';
import { SimulationClock, type SimulationAdvanceResult } from './simulationClock';
import { getTrafficMapClient } from '../workers/trafficMapClient';
import { getPathfindingClient } from '../workers/pathfindingClient';
import { createWorkerCarSnapshot, createWorkerGridSnapshot, createWorkerTrafficSnapshot } from '../workers/gridSnapshot';
import { getCampaignCity } from '../campaign/campaignMaps';
import type { CampaignCityDefinition, CampaignMissionSnapshot } from '../campaign/campaignTypes';

const BUILDING_DEMOLITION_COST: Record<Building['type'], number> = {
  house: 20,
  shop: 35,
  office: 50,
};
const SIGNAL_INSTALL_GRACE_SECONDS = 5.5;
const REROUTE_STUCK_SECONDS = 8.5;
const REROUTE_FORCE_SECONDS = 14;
const REROUTE_COOLDOWN_SECONDS = 11;
const INTERSECTION_REROUTE_STUCK_SECONDS = 22;
const SPAWN_LANE_CLEAR_DISTANCE = 0.85;
const TRAVEL_TIME_HISTORY_LIMIT = 35;
const FAILED_TRIP_PRESSURE_DECAY = 0.82;
const BUILDING_UPGRADE_EVERY_SECONDS = 10;
const BUILDING_UPGRADE_MIN_SATISFACTION = 45;
const BUILDING_UPGRADE_MAX_CONGESTION = 140;
const BUILDING_UPGRADE_MIN_SCORE = 3.2;
const CAR_SPAWN_EXIT_SECONDS = 0.65;
const CAR_DESTINATION_ENTRY_SECONDS = 0.75;
const ROAD_RULE_REROUTE_COOLDOWN_SECONDS = 1.2;
const ROAD_RULE_NO_ROUTE_SECONDS = 12;
const IMMOBILE_REROUTE_SECONDS = 8;
const IMMOBILE_ESCAPE_SECONDS = 20;
const IMMOBILE_REMOVE_SECONDS = 45;
const REPEATED_REROUTE_REMOVE_COUNT = 30;

// Mantém a simulação de trânsito estável mesmo em 2x/4x ou em frames lentos.
// Em vez de aplicar um delta grande de uma vez, o jogo divide o tempo em passos menores.
// Isso evita carros pulando tiles, sobreposição brusca em filas e remoções repentinas por arrived/no_route.
const SINGLE_TRAFFIC_MAP_PASS_CAR_THRESHOLD = 180;
type RerouteOptions = {
  force?: boolean;
  reason?: string;
  allowNeighborFallback?: boolean;
  cooldownSeconds?: number;
  stopBeforeMoving?: boolean;
};

type PerformanceViewportBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const DISTANT_CAR_UPDATE_EVERY_TICKS = 3;

export class GameWorld {
  readonly mode: GameMode;
  readonly campaignCityId?: CampaignCityId;
  readonly campaignCity?: CampaignCityDefinition;
  readonly performanceProfiler = createPerformanceProfiler();
  private readonly simulationClock = new SimulationClock();
  private trafficMapWorkerAccumulator = 0;
  private trafficMapWorkerInFlight = false;
  private asyncRerouteCarIds = new Set<string>();
  private connectionUpdateAccumulator = 0;
  private lastConnectionStaticRenderVersion = -1;
  private snapshotCache?: CityStats;
  private snapshotCacheAtMs = 0;
  private readonly baseGridWidth = GAME_CONFIG.gridWidth;
  private readonly baseGridHeight = GAME_CONFIG.gridHeight;
  grid: Tile[][] = createGrid();
  readonly entityIndex = new WorldEntityIndex(this.grid);
  districts: District[] = [];
  buildings: Building[] = [];
  cars: Car[] = [];
  bikeTrips: BikeTripVisual[] = [];
  transitStops: TransitStop[] = [];
  transitLine: TransitLine = { id: 'bus-loop', stopIds: [], route: [], active: false, busCount: BUS_LANE_CONFIG.defaultBuses, reason: 'Adicione ao menos dois pontos de ônibus.' };
  metroStations: MetroStation[] = [];
  metroTracks: MetroTrack[] = [];
  metroLines: MetroLine[] = [];
  metroTrains: MetroTrain[] = [];
  helipads: Helipad[] = [];
  helicopterLines: HelicopterLine[] = [];
  helicopters: Helicopter[] = [];
  metroTripsCompleted = 0;
  metroCarsAvoided = 0;
  helicopterTripsCompleted = 0;
  helicopterCarsAvoided = 0;
  traffic = new Map<string, TrafficCell>();
  trafficLights = new Map<string, TrafficLightState>();
  selected: SelectedEntity = { kind: 'none' };
  money = GAME_CONFIG.initialMoney;
  satisfaction = 100;
  completedTrips = 0;
  failedTrips = 0;
  publicTripsCompleted = 0;
  busTripsCompleted = 0;
  carTripsAvoided = 0;
  bikeTripsCompleted = 0;
  bikeCarsAvoided = 0;
  averageTravelTime = 0;
  cityLevel = 1;
  historySamples: CityHistorySample[] = [];
  trafficHeatmapSamples: TrafficHeatmapSample[] = [];
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
  private nextTransitStopOrder = 1;
  private lastHistorySampleKey = '';
  private trafficLightDebugTimers = new Map<string, number>();
  private readonly allowRoadDemolition: boolean;
  private readonly enableTerrainRelief: boolean;
  private staticRenderVersion = 0;
  private activeViewportBounds?: PerformanceViewportBounds;
  private performanceUpdateTick = 0;
  private pathfindingWorkerGridVersion = -1;
  private pathfindingWorkerTrafficSyncAt = 0;
  private campaignMissionAccumulator = 0;
  private campaignStabilitySeconds = 0;
  private campaignElapsedSeconds = 0;
  private campaignMissionCompleted = false;
  private secondsSinceBikeTrip = Number.POSITIVE_INFINITY;
  private secondsSinceMetroTrip = Number.POSITIVE_INFINITY;

  constructor(options: Partial<GameSetupOptions> = {}) {
    this.mode = options.mode ?? 'sandbox';
    this.campaignCityId = this.mode === 'campaign' ? options.campaignCityId : undefined;
    this.campaignCity = getCampaignCity(this.campaignCityId);
    this.money = this.campaignCity?.startingMoney ?? GAME_CONFIG.initialMoney;
    setGridBounds(GAME_CONFIG.gridWidth, GAME_CONFIG.gridHeight);
    this.grid = createGrid(GAME_CONFIG.gridWidth, GAME_CONFIG.gridHeight);
    this.initializeDistricts();
    this.enableTerrainRelief = this.mode === 'campaign'
      ? true
      : options.enableTerrainRelief ?? TERRAIN_CONFIG.enabledByDefault;
    if (this.campaignCity) {
      const initialBuildings = this.campaignCity.applyMap(this.grid);
      for (const building of initialBuildings) {
        this.addBuilding(createBuilding(building.type, building.x, building.y, 'operational'));
      }
    } else if (this.enableTerrainRelief) {
      generateTerrainReliefForBounds(this.grid, { xStart: 0, yStart: 0, width: GAME_CONFIG.gridWidth, height: GAME_CONFIG.gridHeight });
    }
    this.allowRoadDemolition = this.mode === 'sandbox' && (options.allowRoadDemolition ?? false);
    this.generator = new CityGenerator(options);
    if (!this.campaignCity) this.seedInitialCity();
    this.entityIndex.setGrid(this.grid);
    this.entityIndex.rebuild(this.cars, this.buildings);
    this.updateConnections();
    this.updateTrafficMap();
    this.recordHistorySample(true);
  }
  countVisibleCarsInBounds(bounds?: PerformanceViewportBounds, paddingTiles = 2): number {
    if (!bounds) return this.cars.filter((car) => car.status !== 'arrived' && car.status !== 'no_route').length;
    const minX = bounds.minX - paddingTiles;
    const minY = bounds.minY - paddingTiles;
    const maxX = bounds.maxX + paddingTiles;
    const maxY = bounds.maxY + paddingTiles;
    let count = 0;
    for (const car of this.cars) {
      if (car.status === 'arrived' || car.status === 'no_route') continue;
      if (car.x >= minX && car.x <= maxX && car.y >= minY && car.y <= maxY) {
        count += 1;
        continue;
      }
      const current = car.route[car.routeIndex];
      const next = car.route[car.routeIndex + 1];
      if ((current && current.x >= minX && current.x <= maxX && current.y >= minY && current.y <= maxY)
        || (next && next.x >= minX && next.x <= maxX && next.y >= minY && next.y <= maxY)) {
        count += 1;
      }
    }
    return Math.min(count, this.cars.length);
  }

  getSnapshotForUi(): CityStats {
    const now = performance.now();
    const shouldThrottle = this.cars.length >= PERFORMANCE_CONFIG.snapshotThrottleThresholdCars;
    if (shouldThrottle && this.snapshotCache && now - this.snapshotCacheAtMs < PERFORMANCE_CONFIG.snapshotThrottleMs) {
      return this.snapshotCache;
    }

    const snapshot = this.performanceProfiler.time('snapshotMs', () => this.getSnapshot());
    this.snapshotCache = snapshot;
    this.snapshotCacheAtMs = now;
    return snapshot;
  }

  getCampaignMissionSnapshot(): CampaignMissionSnapshot | null {
    if (!this.campaignCity || !this.campaignCityId) return null;
    const snapshot = this.getSnapshot();
    const objectives = this.campaignCity.mission.objectives.map((objective) => {
      const requirements = objective.requirements.map((requirement) => {
        const current = this.getCampaignMetricValue(requirement.metric, snapshot);
        return {
          ...requirement,
          current,
          met: requirement.comparator === 'min' ? current >= requirement.target : current <= requirement.target,
        };
      });
      return {
        ...objective,
        requirements,
        met: requirements.every((requirement) => requirement.met),
      };
    });
    return {
      cityId: this.campaignCityId,
      population: snapshot.population,
      satisfaction: snapshot.satisfaction,
      traffic: snapshot.averageCongestion,
      holdSeconds: this.campaignCity.mission.holdSeconds,
      objectives,
      stabilitySeconds: Math.min(this.campaignCity.mission.holdSeconds, this.campaignStabilitySeconds),
      completed: this.campaignMissionCompleted,
      elapsedSeconds: this.campaignElapsedSeconds,
      day: snapshot.day,
      timeLabel: snapshot.timeLabel,
    };
  }

  private getCampaignMetricValue(metric: import('../campaign/campaignTypes').CampaignObjectiveMetric, snapshot: CityStats): number {
    if (metric === 'busLaneCoveragePercent') return Math.round(snapshot.busLaneCoverageRatio * 100);
    if (metric === 'minMetroStationsPerActiveLine') {
      const activeLines = this.metroLines.filter((line) => line.active);
      return activeLines.length ? Math.min(...activeLines.map((line) => line.stationIds.length)) : 0;
    }
    if (metric === 'secondsSinceBikeTrip') return Number.isFinite(this.secondsSinceBikeTrip) ? Math.round(this.secondsSinceBikeTrip * 10) / 10 : 999;
    if (metric === 'secondsSinceMetroTrip') return Number.isFinite(this.secondsSinceMetroTrip) ? Math.round(this.secondsSinceMetroTrip * 10) / 10 : 999;
    if (metric === 'connectedCampaignZones') return this.getConnectedCampaignZoneCount();
    return snapshot[metric] as number;
  }

  private getConnectedCampaignZoneCount(): number {
    const zones = this.campaignCity?.zones ?? [];
    if (!zones.length) return 0;

    const positions = new Map<string, Vec2>();
    const adjacency = new Map<string, Set<string>>();
    const addNode = (id: string, position: Vec2) => {
      positions.set(id, position);
      if (!adjacency.has(id)) adjacency.set(id, new Set());
    };
    const connect = (a: string, b: string) => {
      adjacency.get(a)?.add(b);
      adjacency.get(b)?.add(a);
    };

    const activeMetroLines = this.metroLines.filter((candidate) => candidate.active);
    const activeAirLines = this.helicopterLines.filter((candidate) => candidate.active);
    const activeMetroStationIds = new Set(activeMetroLines.flatMap((line) => line.stationIds));
    const activeHelipadIds = new Set(activeAirLines.flatMap((line) => line.helipadIds));
    for (const station of this.metroStations.filter((candidate) => activeMetroStationIds.has(candidate.id))) addNode(`metro:${station.id}`, station);
    for (const helipad of this.helipads.filter((candidate) => activeHelipadIds.has(candidate.id))) addNode(`air:${helipad.id}`, helipad);
    for (const line of activeMetroLines) {
      for (let index = 1; index < line.stationIds.length; index += 1) {
        connect(`metro:${line.stationIds[index - 1]}`, `metro:${line.stationIds[index]}`);
      }
    }
    for (const line of activeAirLines) {
      connect(`air:${line.helipadIds[0]}`, `air:${line.helipadIds[1]}`);
    }
    for (const station of this.metroStations.filter((candidate) => activeMetroStationIds.has(candidate.id))) {
      for (const helipad of this.helipads.filter((candidate) => activeHelipadIds.has(candidate.id))) {
        if (manhattan(station, helipad) <= 3) connect(`metro:${station.id}`, `air:${helipad.id}`);
      }
    }

    let maxConnectedZones = 0;
    const visited = new Set<string>();
    for (const nodeId of adjacency.keys()) {
      if (visited.has(nodeId)) continue;
      const component: string[] = [];
      const queue = [nodeId];
      visited.add(nodeId);
      while (queue.length) {
        const current = queue.shift();
        if (!current) continue;
        component.push(current);
        for (const next of adjacency.get(current) ?? []) {
          if (visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }
      if (!component.some((id) => id.startsWith('metro:')) || !component.some((id) => id.startsWith('air:'))) continue;
      const connectedZones = zones.filter((zone) => component.some((id) => {
        const position = positions.get(id);
        return position ? Math.abs(position.x - zone.x) + Math.abs(position.y - zone.y) <= zone.radius : false;
      })).length;
      maxConnectedZones = Math.max(maxConnectedZones, connectedZones);
    }
    return maxConnectedZones;
  }

  private updateCampaignMission(dt: number): void {
    if (!this.campaignCity || this.campaignMissionCompleted) return;
    this.campaignElapsedSeconds += dt;
    this.campaignMissionAccumulator += dt;
    if (this.campaignMissionAccumulator + Number.EPSILON < 0.5) return;

    const evaluationSeconds = this.campaignMissionAccumulator;
    this.campaignMissionAccumulator = 0;
    const mission = this.getCampaignMissionSnapshot();
    if (!mission) return;
    if (mission.objectives.every((objective) => objective.met)) {
      this.campaignStabilitySeconds = Math.min(
        mission.holdSeconds,
        this.campaignStabilitySeconds + evaluationSeconds,
      );
      if (this.campaignStabilitySeconds >= mission.holdSeconds - 1e-9) {
        this.campaignMissionCompleted = true;
        this.emit();
      }
    } else {
      this.campaignStabilitySeconds = 0;
    }
  }


  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const l of this.listeners) l();
  }


  private initializeDistricts(): void {
    this.districts = [
      {
        id: 'district-center',
        name: 'Centro',
        direction: 'center',
        status: 'owned',
        xStart: 0,
        yStart: 0,
        width: this.baseGridWidth,
        height: this.baseGridHeight,
        cost: 0,
        purchasedAtDay: 1,
      },
      {
        id: DISTRICT_EXPANSION_CONFIG.eastDistrictId,
        name: DISTRICT_EXPANSION_CONFIG.eastDistrictName,
        direction: 'east',
        status: 'available',
        xStart: this.baseGridWidth,
        yStart: 0,
        width: this.baseGridWidth,
        height: this.baseGridHeight,
        cost: DISTRICT_EXPANSION_CONFIG.cost,
      },
    ];
  }

  getOwnedDistrictCount(): number {
    return this.districts.filter((district) => district.status === 'owned').length;
  }

  getMaxCars(): number {
    return GAME_CONFIG.maxCars * this.getOwnedDistrictCount();
  }

  seedPerformanceBenchmarkCars(targetCount: number): number {
    const target = Math.max(0, Math.min(2000, Math.floor(targetCount)));
    const currentPrivateCars = this.getPrivateCarCount();
    if (target <= currentPrivateCars) return currentPrivateCars;

    const roadTiles: Vec2[] = [];
    for (const row of this.grid) {
      for (const tile of row) {
        if (isRoadType(tile.type)) roadTiles.push({ x: tile.x, y: tile.y });
      }
    }
    if (roadTiles.length < 2) return currentPrivateCars;

    const baseRoutes: Vec2[][] = [];
    const routeAttempts = Math.min(roadTiles.length, 80);
    for (let index = 0; index < routeAttempts && baseRoutes.length < 24; index += 1) {
      const start = roadTiles[(index * 17) % roadTiles.length];
      const goal = roadTiles[(roadTiles.length - 1 - index * 29 + roadTiles.length * 4) % roadTiles.length];
      if (samePos(start, goal)) continue;
      const route = findFastestPath(this.grid, this.traffic, start, goal);
      if (route.length >= 2) baseRoutes.push(route);
    }
    if (!baseRoutes.length) {
      for (let index = 0; index < routeAttempts && baseRoutes.length < 24; index += 1) {
        const route: Vec2[] = [roadTiles[(index * 13) % roadTiles.length]];
        for (let step = 0; step < 24; step += 1) {
          const current = route[route.length - 1];
          const previous = route[route.length - 2];
          const legalNeighbors = getDrivableNeighbors(this.grid, current)
            .filter((next) => isLegalRoadMove(this.grid, current, next))
          const forwardNeighbors = legalNeighbors.filter((next) => !previous || !samePos(next, previous));
          const neighbors = forwardNeighbors.length ? forwardNeighbors : legalNeighbors;
          if (!neighbors.length) break;
          route.push(neighbors[(index + step) % neighbors.length]);
        }
        if (route.length >= 2) baseRoutes.push(route);
      }
    }
    if (!baseRoutes.length) return currentPrivateCars;

    const originId = this.buildings[0]?.id ?? 'benchmark-origin';
    const destinationId = this.buildings[1]?.id ?? originId;
    for (let index = currentPrivateCars; index < target; index += 1) {
      const route = baseRoutes[index % baseRoutes.length];
      const routeIndex = Math.min(route.length - 2, Math.floor((index / baseRoutes.length) % Math.max(1, route.length - 1)));
      const progressToNext = ((index * 37) % 100) / 100;
      const current = route[routeIndex];
      const next = route[routeIndex + 1];
      const direction = getDirection(current, next);
      const roadType = this.getRoadTypeAt(current);
      const id = `benchmark-${index}`;
      const lane = getLaneOffset(direction, roadType, id, this.getOneWayAt(current, direction));
      const desiredSpeed = 1.45 * ROAD_CONFIG[roadType].speed;
      this.addCar({
        id,
        originBuildingId: originId,
        destinationBuildingId: destinationId,
        x: current.x + (next.x - current.x) * progressToNext + lane.offset.x,
        y: current.y + (next.y - current.y) * progressToNext + lane.offset.y,
        currentTileX: current.x,
        currentTileY: current.y,
        route,
        routeIndex,
        progressToNext,
        baseSpeed: 1.45,
        currentSpeed: desiredSpeed * 0.75,
        targetSpeed: desiredSpeed,
        acceleration: 1.65,
        braking: 3.8,
        desiredSpeed,
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
        lifecyclePhase: 'driving',
        lifecycleProgress: 1,
        direction,
        status: 'moving',
        travelTime: 0,
        estimatedTime: route.length / 1.45,
        delay: 0,
        stuckSeconds: 0,
        immobileSeconds: 0,
        rerouteCooldownSeconds: 0,
        rerouteCount: 0,
        repeatedRerouteCount: 0,
        lastRouteSignature: routeSignature(route),
        signalTransitionGraceSeconds: 0,
      });
    }
    this.updateTrafficMap();
    return this.getPrivateCarCount();
  }

  getMaxBuses(): number {
    return this.getMaxTransitBusCount();
  }

  getMaxTransitBusCount(): number {
    return Math.max(BUS_LANE_CONFIG.defaultBuses, this.getOwnedDistrictCount() * BUS_LANE_CONFIG.maxBusesPerDistrict);
  }

  private getDesiredTransitBusCount(): number {
    const configured = this.transitLine.busCount ?? BUS_LANE_CONFIG.defaultBuses;
    return Math.max(1, Math.min(this.getMaxTransitBusCount(), Math.round(configured)));
  }

  private getRoadCapacityForTraffic(tile: Tile, roadType: RoadType): number {
    const baseCapacity = ROAD_CONFIG[roadType].capacity;
    if ((tile.type === 'road' || tile.type === 'avenue') && tile.busLane) {
      return Math.max(1, Math.floor(baseCapacity * BUS_LANE_CONFIG.carCapacityMultiplier));
    }
    return baseCapacity;
  }

  private getVehicleTrafficWeight(car: Car): number {
    const baseWeight = car.vehicleType === 'bus' ? TRANSIT_CONFIG.busTrafficWeight : 1;
    if (car.vehicleType === 'bus' && this.grid[car.currentTileY]?.[car.currentTileX]?.busLane) {
      return baseWeight * BUS_LANE_CONFIG.busTrafficWeightMultiplier;
    }
    return baseWeight;
  }

  getTransitBusLaneTileCount(): number {
    return this.grid.reduce((sum, row) => sum + row.filter((tile) => (tile.type === 'road' || tile.type === 'avenue') && tile.busLane).length, 0);
  }

  getTransitBusLaneCoverageRatio(): number {
    if (!this.transitLine.route.length) return 0;
    const busLaneTiles = this.transitLine.route.filter((pos) => this.grid[pos.y]?.[pos.x]?.busLane).length;
    return Math.round((busLaneTiles / Math.max(1, this.transitLine.route.length)) * 100) / 100;
  }

  private getTransitPassengerCount(): number {
    return this.getTransitBuses().reduce((sum, bus) => sum + passengerGroupCount(bus.passengers ?? []), 0);
  }

  private getTransitPassengerConversionChance(): number {
    return Math.min(
      0.94,
      TRANSIT_CONFIG.passengerConversionChance + this.getTransitBusLaneCoverageRatio() * BUS_LANE_CONFIG.passengerConversionBonus,
    );
  }

  getTransitLineStats(): {
    active: boolean;
    reason?: string;
    stops: number;
    routeTiles: number;
    busCount: number;
    maxBuses: number;
    activeBuses: number;
    waitingPassengers: number;
    passengers: number;
    busLaneTiles: number;
    busLaneCoverageRatio: number;
    carsAvoided: number;
    purchaseCost: number;
  } {
    const busLaneTiles = this.transitLine.route.filter((pos) => this.grid[pos.y]?.[pos.x]?.busLane).length;
    return {
      active: this.transitLine.active,
      reason: this.transitLine.reason,
      stops: this.transitLine.stopIds.length,
      routeTiles: this.transitLine.route.length,
      busCount: this.getDesiredTransitBusCount(),
      maxBuses: this.getMaxTransitBusCount(),
      activeBuses: this.getTransitBuses().length,
      waitingPassengers: this.getWaitingPassengerCount(),
      passengers: this.getTransitPassengerCount(),
      busLaneTiles,
      busLaneCoverageRatio: this.getTransitBusLaneCoverageRatio(),
      carsAvoided: Math.max(0, this.carTripsAvoided - this.metroCarsAvoided),
      purchaseCost: BUS_LANE_CONFIG.busPurchaseCost,
    };
  }

  setTransitBusCount(count: number): { success: boolean; count: number; max: number; cost?: number; reason?: string } {
    const max = this.getMaxTransitBusCount();
    const nextCount = Math.max(1, Math.min(max, Math.round(count)));
    const currentCount = this.getDesiredTransitBusCount();
    if (nextCount === currentCount) return { success: true, count: currentCount, max, cost: 0 };
    const cost = nextCount > currentCount ? (nextCount - currentCount) * BUS_LANE_CONFIG.busPurchaseCost : 0;
    if (this.money < cost) return { success: false, count: currentCount, max, cost, reason: `Faltam $ ${cost - this.money} para aumentar a frota.` };
    this.money -= cost;
    this.transitLine = { ...this.transitLine, busCount: nextCount };
    this.rebuildTransitLine();
    this.emit();
    return { success: true, count: nextCount, max, cost };
  }

  isEastDistrictPurchased(): boolean {
    return this.districts.some((district) => district.id === DISTRICT_EXPANSION_CONFIG.eastDistrictId && district.status === 'owned');
  }

  getEastDistrict(): District | undefined {
    return this.districts.find((district) => district.id === DISTRICT_EXPANSION_CONFIG.eastDistrictId);
  }

  getEastDistrictRequirementStatus(): Array<{ label: string; met: boolean; current: number; required: number }> {
    const snapshot = this.getSnapshot();
    return [
      { label: 'Cidade nível 3', met: snapshot.cityLevel >= DISTRICT_EXPANSION_CONFIG.requiredCityLevel, current: snapshot.cityLevel, required: DISTRICT_EXPANSION_CONFIG.requiredCityLevel },
      { label: 'População 250+', met: snapshot.population >= DISTRICT_EXPANSION_CONFIG.requiredPopulation, current: snapshot.population, required: DISTRICT_EXPANSION_CONFIG.requiredPopulation },
      { label: 'Satisfação 55%+', met: snapshot.satisfaction >= DISTRICT_EXPANSION_CONFIG.requiredSatisfaction, current: snapshot.satisfaction, required: DISTRICT_EXPANSION_CONFIG.requiredSatisfaction },
      { label: '$ 20.000 disponíveis', met: snapshot.money >= DISTRICT_EXPANSION_CONFIG.cost, current: snapshot.money, required: DISTRICT_EXPANSION_CONFIG.cost },
    ];
  }

  canPurchaseEastDistrict(): { canPurchase: boolean; reason?: string; cost: number; requirements: ReturnType<GameWorld['getEastDistrictRequirementStatus']> } {
    const requirements = this.getEastDistrictRequirementStatus();
    if (this.mode !== 'sandbox') return { canPurchase: false, reason: 'Expansão urbana disponível apenas no sandbox.', cost: DISTRICT_EXPANSION_CONFIG.cost, requirements };
    const district = this.getEastDistrict();
    if (!district) return { canPurchase: false, reason: 'Bairro Leste não configurado.', cost: DISTRICT_EXPANSION_CONFIG.cost, requirements };
    if (district.status === 'owned') return { canPurchase: false, reason: 'Bairro Leste já foi comprado.', cost: district.cost, requirements };
    const missing = requirements.find((requirement) => !requirement.met);
    if (missing) return { canPurchase: false, reason: 'Requisito pendente: ' + missing.label + '.', cost: district.cost, requirements };
    return { canPurchase: true, cost: district.cost, requirements };
  }

  purchaseEastDistrict(): { success: boolean; reason?: string; district?: District } {
    if (this.mode !== 'sandbox') return { success: false, reason: 'Expansão urbana disponível apenas no sandbox.' };
    const availability = this.canPurchaseEastDistrict();
    if (!availability.canPurchase) return { success: false, reason: availability.reason };

    const district = this.getEastDistrict();
    if (!district) return { success: false, reason: 'Bairro Leste não configurado.' };

    const oldWidth = this.grid[0]?.length ?? this.baseGridWidth;
    const oldHeight = this.grid.length || this.baseGridHeight;
    const expansionWidth = district.width || this.baseGridWidth;
    const newWidth = oldWidth + expansionWidth;

    for (let y = 0; y < oldHeight; y += 1) {
      const row = this.grid[y];
      if (!row) continue;
      for (let x = oldWidth; x < newWidth; x += 1) {
        row[x] = { x, y, type: 'empty' };
      }
    }

    district.status = 'owned';
    district.xStart = oldWidth;
    district.yStart = 0;
    district.width = expansionWidth;
    district.height = oldHeight;
    district.purchasedAtDay = this.time.getDay();

    this.money -= district.cost;
    setGridBounds(newWidth, oldHeight);
    if (this.enableTerrainRelief) {
      generateTerrainReliefForBounds(this.grid, { xStart: oldWidth, yStart: 0, width: expansionWidth, height: oldHeight }, 0.72);
    }
    this.updateConnections();
    this.updateTrafficMap();
    this.recordHistorySample(true);
    this.markStaticRenderDirty();
    this.selected = { kind: 'tile', x: oldWidth, y: Math.floor(oldHeight / 2), type: 'empty' };
    this.emit();
    return { success: true, district };
  }

  private getPrivateCarCount(): number {
    return this.cars.filter((car) => car.vehicleType !== 'bus').length;
  }

  getStaticRenderSignature(lightingKey = ''): string {
    return `lighting:${lightingKey}:static:${this.staticRenderVersion}`;
  }

  private markStaticRenderDirty(): void {
    this.staticRenderVersion = (this.staticRenderVersion + 1) % Number.MAX_SAFE_INTEGER;
  }

  setActiveViewportBounds(bounds?: PerformanceViewportBounds): void {
    this.activeViewportBounds = bounds;
  }

  getSnapshot(): CityStats {
    const disconnectedBuildings = this.buildings.filter((b) => isBuildingOperational(b) && !b.connected).length;
    const congestions = [...this.traffic.values()].map((t) => t.congestion);
    const averageCongestion = congestions.length ? congestions.reduce((a, b) => a + b, 0) / congestions.length : 0;
    const terrainSummary = getTerrainSummary(this.grid);
    const bikeLaneTiles = this.getBikeLaneTileCount();
    return {
      money: Math.floor(this.money),
      population: this.buildings.reduce((sum, b) => sum + (isBuildingOperational(b) ? b.population : 0), 0),
      activeCars: this.cars.filter((car) => car.vehicleType !== 'bus').length,
      satisfaction: Math.round(this.satisfaction),
      averageCongestion: Math.round(Math.min(300, averageCongestion * 100)),
      averageTravelTime: Math.round(this.averageTravelTime),
      disconnectedBuildings,
      completedTrips: this.completedTrips,
      failedTrips: this.failedTrips,
      publicTripsCompleted: this.publicTripsCompleted,
      busTripsCompleted: this.busTripsCompleted,
      carTripsAvoided: this.carTripsAvoided,
      waitingPassengers: this.getWaitingPassengerCount(),
      activeBuses: this.getTransitBuses().length,
      busLaneTiles: this.getTransitBusLaneTileCount(),
      busLaneCoverageRatio: this.getTransitBusLaneCoverageRatio(),
      districtsOwned: this.getOwnedDistrictCount(),
      cityAreaTiles: this.grid.length * (this.grid[0]?.length ?? 0),
      maxCars: this.getMaxCars(),
      maxBuses: this.getMaxBuses(),
      eastDistrictPurchased: this.isEastDistrictPurchased(),
      bikeLaneTiles,
      bikeLaneCoverageRatio: this.getBikeLaneCoverageRatio(),
      bikeTripsCompleted: this.bikeTripsCompleted,
      bikeCarsAvoided: this.bikeCarsAvoided,
      activeBikeTrips: this.bikeTrips.length,
      metroStations: this.metroStations.length,
      metroLines: this.metroLines.filter((line) => line.active).length,
      metroPassengers: this.metroTrains.reduce((sum, train) => sum + train.passengers, 0) + this.getMetroWaitingPassengerCount(),
      metroCarsAvoided: this.metroCarsAvoided,
      metroTripsCompleted: this.metroTripsCompleted,
      metroPassengersWaiting: this.getMetroWaitingPassengerCount(),
      metroTrains: this.metroTrains.length,
      helipads: this.helipads.length,
      helicopterLines: this.helicopterLines.filter((line) => line.active).length,
      helicopters: this.helicopters.length,
      helicopterPassengers: this.getHelicopterPassengerCount() + this.getHelicopterWaitingPassengerCount(),
      helicopterPassengersWaiting: this.getHelicopterWaitingPassengerCount(),
      helicopterTripsCompleted: this.helicopterTripsCompleted,
      helicopterCarsAvoided: this.helicopterCarsAvoided,
      cityLevel: this.cityLevel,
      day: this.time.getDay(),
      timeLabel: this.time.getLabel(),
      dayPeriod: this.time.getPeriod(),
      terrainReliefEnabled: this.enableTerrainRelief,
      terrainBlockedTiles: terrainSummary.blockedTiles,
      mountainTiles: terrainSummary.mountainTiles,
      lakeTiles: terrainSummary.lakeTiles,
    };
  }

  getHistorySamples(): CityHistorySample[] {
    return this.historySamples;
  }

  getTrafficHeatmapLast24h(): TrafficHeatmapSummary {
    const aggregate = new Map<string, { x: number; y: number; cars: number; congestion: number; weight: number; samples: number }>();
    const bounds = this.getRoadBounds();

    for (const sample of this.trafficHeatmapSamples.slice(-24)) {
      for (const tile of sample.tiles) {
        const key = keyOf(tile.x, tile.y);
        const current = aggregate.get(key) ?? { x: tile.x, y: tile.y, cars: 0, congestion: 0, weight: 0, samples: 0 };
        current.cars += tile.cars;
        current.congestion += tile.congestion;
        current.weight += tile.weight;
        current.samples += 1;
        aggregate.set(key, current);
      }
    }

    const cells: TrafficHeatmapCell[] = [...aggregate.values()].map((cell) => ({
      x: cell.x,
      y: cell.y,
      samples: cell.samples,
      carsAverage: cell.cars / Math.max(1, cell.samples),
      congestionAverage: cell.congestion / Math.max(1, cell.samples),
      weight: cell.weight,
    }));

    return {
      bounds,
      maxWeight: Math.max(1, ...cells.map((cell) => cell.weight)),
      cells,
    };
  }

  private recordHistorySample(force = false): void {
    const day = this.time.getDay();
    const hour = this.time.getHour();
    const key = `${day}-${hour}`;
    if (!force && key === this.lastHistorySampleKey) return;

    this.lastHistorySampleKey = key;
    const snapshot = this.getSnapshot();
    const buildingTypes = {
      house: 0,
      shop: 0,
      office: 0,
    };
    const buildingLevels = {
      1: 0,
      2: 0,
      3: 0,
    };

    for (const building of this.buildings) {
      buildingTypes[building.type] += 1;
      buildingLevels[building.level] += 1;
    }

    this.historySamples.push({
      key,
      day,
      hour,
      timeLabel: `${String(hour).padStart(2, '0')}:00`,
      dayPeriod: this.time.getPeriod(),
      population: snapshot.population,
      activeCars: snapshot.activeCars,
      activeBuses: snapshot.activeBuses,
      districtsOwned: snapshot.districtsOwned,
      cityAreaTiles: snapshot.cityAreaTiles,
      maxCars: snapshot.maxCars,
      maxBuses: snapshot.maxBuses,
      waitingPassengers: snapshot.waitingPassengers,
      completedTrips: snapshot.completedTrips,
      failedTrips: snapshot.failedTrips,
      publicTripsCompleted: snapshot.publicTripsCompleted,
      busTripsCompleted: snapshot.busTripsCompleted,
      carTripsAvoided: snapshot.carTripsAvoided,
      bikeLaneTiles: snapshot.bikeLaneTiles,
      bikeLaneCoverageRatio: snapshot.bikeLaneCoverageRatio,
      bikeTripsCompleted: snapshot.bikeTripsCompleted,
      bikeCarsAvoided: snapshot.bikeCarsAvoided,
      activeBikeTrips: snapshot.activeBikeTrips,
      metroTripsCompleted: snapshot.metroTripsCompleted,
      metroCarsAvoided: snapshot.metroCarsAvoided,
      metroPassengers: snapshot.metroPassengers,
      metroPassengersWaiting: snapshot.metroPassengersWaiting,
      metroStations: snapshot.metroStations,
      metroLines: snapshot.metroLines,
      metroTrains: snapshot.metroTrains,
      helipads: snapshot.helipads,
      helicopterLines: snapshot.helicopterLines,
      helicopters: snapshot.helicopters,
      helicopterPassengers: snapshot.helicopterPassengers,
      helicopterPassengersWaiting: snapshot.helicopterPassengersWaiting,
      helicopterTripsCompleted: snapshot.helicopterTripsCompleted,
      helicopterCarsAvoided: snapshot.helicopterCarsAvoided,
      averageCongestion: snapshot.averageCongestion,
      satisfaction: snapshot.satisfaction,
      averageTravelTime: snapshot.averageTravelTime,
      cityLevel: snapshot.cityLevel,
      buildingTypes,
      buildingLevels,
    });
    this.recordTrafficHeatmapSample(key, day, hour);
  }

  private recordTrafficHeatmapSample(key: string, day: number, hour: number): void {
    const tiles = [...this.traffic.values()]
      .filter((traffic) => traffic.cars > 0 || traffic.congestion > 0)
      .map((traffic) => ({
        x: traffic.x,
        y: traffic.y,
        cars: traffic.cars,
        congestion: traffic.congestion,
        capacity: traffic.capacity,
        weight: traffic.cars + Math.max(0, traffic.congestion) * traffic.capacity,
      }));

    this.trafficHeatmapSamples.push({ key, day, hour, tiles });
    if (this.trafficHeatmapSamples.length > 24) {
      this.trafficHeatmapSamples = this.trafficHeatmapSamples.slice(-24);
    }
  }

  private getRoadBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const row of this.grid) {
      for (const tile of row) {
        if (!isRoadType(tile.type)) continue;
        minX = Math.min(minX, tile.x);
        minY = Math.min(minY, tile.y);
        maxX = Math.max(maxX, tile.x);
        maxY = Math.max(maxY, tile.y);
      }
    }

    if (!Number.isFinite(minX)) {
      return { minX: 0, minY: 0, maxX: this.grid[0]?.length ?? 0, maxY: this.grid.length };
    }

    return {
      minX: Math.max(0, minX - 2),
      minY: Math.max(0, minY - 2),
      maxX: Math.min((this.grid[0]?.length ?? maxX + 1) - 1, maxX + 2),
      maxY: Math.min(this.grid.length - 1, maxY + 2),
    };
  }

  seedInitialCity(): void {
    for (let i = 0; i < GAME_CONFIG.initialBuildings; i++) {
      const b = this.generator.spawn(this.grid, this.buildings, this.cityLevel, 'operational');
      if (!b) continue;
      this.addBuilding(b);
    }
  }

  addBuilding(building: Building): void {
    normalizeBuildingConstruction(building);
    this.buildings.push(building);
    this.entityIndex.addBuilding(building);
    this.grid[building.y][building.x] = { x: building.x, y: building.y, type: 'building', buildingId: building.id };
    this.markStaticRenderDirty();
  }

  private addCar(car: Car): void {
    this.cars.push(car);
    this.entityIndex.addCar(car);
  }

  private replaceCars(cars: Car[]): void {
    this.cars = cars;
    this.entityIndex.rebuildCars(cars);
  }

  canBuildRoadOverBuildings(): boolean {
    return this.allowRoadDemolition;
  }
  private isPerformanceHighLoadMode(): boolean {
    const metrics = this.performanceProfiler.getSnapshot();
    return this.cars.length >= PERFORMANCE_CONFIG.highLoadCars
      || metrics.frameMs >= PERFORMANCE_CONFIG.highLoadFrameMs
      || metrics.updateMs >= PERFORMANCE_CONFIG.highLoadUpdateMs;
  }
  update(deltaSeconds: number, speed: number, paused: boolean): SimulationAdvanceResult & { highLoadMode: boolean } {
    this.performanceProfiler.beginUpdate();

    const highLoadMode = this.isPerformanceHighLoadMode();
    this.simulationClock.accumulate(
      deltaSeconds,
      Math.max(0, speed),
      paused,
    );
    const result = this.simulationClock.processBudget(
      paused || speed <= 0,
      (dt) => this.updateStep(dt),
      PERFORMANCE_CONFIG.simulationBudgetMs,
    );

    this.performanceProfiler.recordSimulationSlice(result);
    this.performanceProfiler.setCounters({ highLoadMode: highLoadMode ? 1 : 0 });
    return { ...result, highLoadMode };
  }
  private updateStep(dt: number): void {
    const stepStarted = performance.now();
    this.performanceProfiler.addFixedStep();
    this.secondsSinceBikeTrip += dt;
    this.secondsSinceMetroTrip += dt;

    this.performanceProfiler.time('timeSystemMs', () => this.time.update(dt));
    this.updateBuildingConstruction(dt);
    this.performanceProfiler.time('buildingActivityMs', () => this.updateDailyBuildingActivity());
    this.performanceProfiler.time('trafficLightsMs', () => this.updateTrafficLights(dt));
    this.buildingTimer += dt;
    this.buildingUpgradeTimer += dt;
    this.tripTimer += dt;
    this.economyTimer += dt;

    this.performanceProfiler.time('transitStopsMs', () => this.updateTransitStops(dt));
    this.performanceProfiler.time('metroMs', () => this.updateMetro(dt));
    this.performanceProfiler.time('helicopterMs', () => this.updateHelicopters(dt));
    this.performanceProfiler.time('bikeTripsMs', () => this.updateBikeTrips(dt));
    this.performanceProfiler.time('updateConnectionsMs', () => this.updateConnectionsOptimized(dt));
    this.performanceProfiler.time('refreshSelectedMs', () => this.refreshSelectedBuilding());

    const singleTrafficMapPass = this.cars.length >= SINGLE_TRAFFIC_MAP_PASS_CAR_THRESHOLD;
    if (!singleTrafficMapPass) this.performanceProfiler.time('trafficMapMs', () => this.updateTrafficMap());
    this.performanceProfiler.time('updateCarsMs', () => this.updateCars(dt));
    this.updateTrafficMapOptimized(dt);

    if (this.tripTimer >= GAME_CONFIG.tripGenerationEverySeconds) {
      this.tripTimer = 0;
      this.performanceProfiler.time('generateTripsMs', () => this.generateTrips());
    }

    if (this.buildingTimer >= GAME_CONFIG.spawnBuildingEverySeconds) {
      this.buildingTimer = 0;
      this.performanceProfiler.time('growCityMs', () => this.growCity());
    }

    if (this.buildingUpgradeTimer >= BUILDING_UPGRADE_EVERY_SECONDS) {
      this.buildingUpgradeTimer = 0;
      this.performanceProfiler.time('buildingUpgradeMs', () => this.updateBuildingUpgrades());
    }

    if (this.economyTimer >= GAME_CONFIG.economyTickSeconds) {
      this.economyTimer = 0;
      this.performanceProfiler.time('economyMs', () => this.updateEconomyAndSatisfaction());
    }

    this.performanceProfiler.time('historyMs', () => this.recordHistorySample());
    this.updateCampaignMission(dt);
    this.performanceProfiler.recordUpdateStep(performance.now() - stepStarted);
  }

  buildAt(x: number, y: number, tool: Tool): boolean {
    if (!inBounds(x, y)) return false;
    const tile = this.grid[y][x];
    if (isTerrainBlocked(tile)) return false;

    if (tool === 'metroStation') {
      return this.buildMetroStationAt(x, y);
    }

    if (tool === 'helipad') {
      return this.buildHelipadAt(x, y);
    }

    if (tool === 'metroTrack' || tool === 'metroLine' || tool === 'helicopterLine') {
      return false;
    }

    if (tool === 'bikeLane') {
      return this.toggleBikeLaneAt(x, y).success;
    }

    if (tool === 'busLane') {
      return this.toggleBusLaneAt(x, y).success;
    }

    if (tool === 'roundabout') {
      const center = { x, y };
      const area = getRoundaboutArea(center);
      const placement = canPlaceRoundabout(this.grid, center, this.allowRoadDemolition);
      if (!placement.valid) return false;

      const buildingsToDemolish = area
        .map((pos) => {
          const areaTile = this.grid[pos.y]?.[pos.x];
          return areaTile?.type === 'building' && areaTile.buildingId ? this.getBuilding(areaTile.buildingId) : undefined;
        })
        .filter((building): building is Building => Boolean(building));
      const demolitionCost = buildingsToDemolish.reduce((sum, building) => sum + getBuildingDemolitionCost(building), 0);
      const cost = ROAD_CONFIG.roundabout.buildCost + demolitionCost;
      if (this.money < cost) return false;

      for (const building of buildingsToDemolish) {
        this.removeBuildingForRoad(building.id);
      }
      for (const pos of area) {
        this.trafficLights.delete(getTrafficLightKey(pos.x, pos.y));
        this.grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'empty' };
      }
      for (const pos of getRoundaboutRing(center)) {
        this.grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'roundabout' };
      }
      this.grid[y][x] = { x, y, type: 'roundaboutCenter' };
      this.markStaticRenderDirty();
      this.rerouteCarsAffectedBy(area);
      this.money -= cost;
      this.updateConnections();
      this.rebuildTransitLine();
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

      const demand = this.getTrafficLightDemandAt(x, y);
      const preferredAxis: TrafficLightAxis = demand.horizontalQueue >= demand.verticalQueue ? 'horizontal' : 'vertical';
      this.trafficLights.set(key, createTrafficLight(x, y, this.trafficLights.size, preferredAxis));
      this.markStaticRenderDirty();
      this.prepareTrafficForNewSignal(key, x, y);
      this.money -= TRAFFIC_LIGHT_BUILD_COST;
      this.inspectAt(x, y);
      this.emit();
      return true;
    }

    if (tool === 'busStop') {
      const accessRoad = this.findBusStopAccessRoad({ x, y });
      if (tile.type !== 'empty') return false;
      if (!accessRoad) return false;
      if (this.money < TRANSIT_CONFIG.busStopCost) return false;

      const stop: TransitStop = {
        id: nanoid(8),
        x,
        y,
        accessRoad,
        waiting: [],
        totalBoarded: 0,
        totalAlighted: 0,
        arrivalPulse: 0,
        createdOrder: this.nextTransitStopOrder,
      };
      this.nextTransitStopOrder += 1;
      this.transitStops.push(stop);
      this.grid[y][x] = { x, y, type: 'busStop', buildingId: stop.id };
      this.markStaticRenderDirty();
      this.money -= TRANSIT_CONFIG.busStopCost;
      this.rebuildTransitLine();
      this.inspectAt(x, y);
      this.emit();
      return true;
    }

    if (tool === 'road' || tool === 'avenue') {
      if (tile.type === 'busStop') return false;
      if (tile.type === 'metroStation') return false;
      if (tile.type === 'helipad') return false;
      if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) return false;
      if (tile.type === tool) return false;
      const building = tile.type === 'building' && tile.buildingId ? this.getBuilding(tile.buildingId) : undefined;
      if (tile.type === 'building' && (!this.allowRoadDemolition || !building)) return false;
      const cost = ROAD_CONFIG[tool].buildCost + (building ? getBuildingDemolitionCost(building) : 0);
      if (this.money < cost) return false;
      const oneWay = tile.type === 'road' || tile.type === 'avenue' ? tile.oneWay : undefined;
      const busLane = tile.type === 'road' || tile.type === 'avenue' ? tile.busLane : undefined;
      const bikeLane = tile.type === 'road' || tile.type === 'avenue' ? tile.bikeLane : undefined;
      if (building) this.removeBuildingForRoad(building.id);
      this.grid[y][x] = { x, y, type: tool, oneWay, busLane, bikeLane: tool === 'road' ? bikeLane : undefined };
      this.markStaticRenderDirty();
      this.money -= cost;
      this.rerouteCarsAffectedBy([{ x, y }]);
      this.updateConnections();
      this.rebuildTransitLine();
      this.emit();
      return true;
    }

    if (tool === 'remove') {
      const helipad = this.getHelipadAt(x, y);
      if (helipad) {
        return this.removeHelipad(helipad.id);
      }
      const metroStation = this.getMetroStationAt(x, y);
      if (metroStation) {
        if (!this.removeMetroStationAt(metroStation.id)) return false;
        this.emit();
        return true;
      }
      if (tile.type === 'busStop') {
        if (this.money < TRANSIT_CONFIG.busStopCost * TRANSIT_CONFIG.busStopRemoveCostRatio) return false;
        this.removeTransitStopAt(x, y);
        this.money -= Math.ceil(TRANSIT_CONFIG.busStopCost * TRANSIT_CONFIG.busStopRemoveCostRatio);
        this.emit();
        return true;
      }
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
        this.markStaticRenderDirty();
        this.trafficLights.delete(getTrafficLightKey(x, y));
      }
      this.money -= cost;
      this.updateConnections();
      this.rebuildTransitLine();
      this.emit();
      return true;
    }

    return false;
  }

  toggleBusLaneAt(x: number, y: number): { success: boolean; enabled?: boolean; cost?: number; reason?: string } {
    const tile = this.grid[y]?.[x];
    const wasEnabled = Boolean(tile?.busLane);
    const result = this.setBusLaneLine([{ x, y }]);
    if (!result.success) return { success: false, reason: result.reason, cost: result.cost };
    return { success: true, enabled: !wasEnabled, cost: result.cost };
  }

  setBusLaneLine(tiles: Vec2[]): { success: boolean; changed: number; cost: number; removed?: boolean; reason?: string } {
    const uniqueTiles = dedupeTiles(tiles);
    if (!uniqueTiles.length) return { success: false, changed: 0, cost: 0, reason: 'Nenhum tile selecionado.' };

    let eligible = 0;
    let enabled = 0;
    for (const pos of uniqueTiles) {
      if (!inBounds(pos.x, pos.y)) return { success: false, changed: 0, cost: 0, reason: 'A linha sai do mapa.' };
      const tile = this.grid[pos.y]?.[pos.x];
      if (!tile || (tile.type !== 'road' && tile.type !== 'avenue')) {
        return { success: false, changed: 0, cost: 0, reason: 'Corredor de ônibus só pode ser aplicado em ruas e avenidas.' };
      }
      if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) {
        return { success: false, changed: 0, cost: 0, reason: 'Corredor de ônibus não pode ser aplicado em rotatórias.' };
      }
      eligible += 1;
      if (tile.busLane) enabled += 1;
    }

    const remove = eligible > 0 && enabled === eligible;
    const changed = remove ? enabled : eligible - enabled;
    if (changed <= 0) return { success: false, changed: 0, cost: 0, reason: 'Nenhuma alteração necessária.' };
    const cost = remove
      ? Math.ceil(changed * BUS_LANE_CONFIG.buildCost * BUS_LANE_CONFIG.removeCostRatio)
      : changed * BUS_LANE_CONFIG.buildCost;
    if (this.money < cost) return { success: false, changed, cost, reason: `Faltam $ ${cost - this.money} para ${remove ? 'remover' : 'implantar'} o corredor.` };

    for (const pos of uniqueTiles) {
      const tile = this.grid[pos.y][pos.x];
      if (tile.type !== 'road' && tile.type !== 'avenue') continue;
      if (remove && tile.busLane) this.grid[pos.y][pos.x] = { ...tile, busLane: undefined };
      if (!remove && !tile.busLane) this.grid[pos.y][pos.x] = { ...tile, busLane: true };
    }

    this.money -= cost;
    this.markStaticRenderDirty();
    this.updateTrafficMap();
    this.rebuildTransitLine();
    this.refreshSelectedRoad();
    this.emit();
    return { success: true, changed, cost, removed: remove };
  }


  buildRoadLine(tiles: Vec2[], roadType: 'road' | 'avenue'): { success: boolean; built: number; cost: number; demolished?: number; reason?: string } {
    const uniqueTiles = dedupeTiles(tiles);
    if (!uniqueTiles.length) return { success: false, built: 0, cost: 0, reason: 'Nenhum tile selecionado.' };

    let built = 0;
    let demolished = 0;
    let demolitionCost = 0;
    for (const pos of uniqueTiles) {
      if (!inBounds(pos.x, pos.y)) return { success: false, built: 0, cost: 0, reason: 'A linha sai do mapa.' };
      const tile = this.grid[pos.y][pos.x];
      if (isTerrainBlocked(tile)) return { success: false, built: 0, cost: 0, reason: tile.type === 'lake' ? 'A linha passa por um lago.' : 'A linha passa por uma montanha.' };
      if (tile.type === 'building' && this.allowRoadDemolition) {
        const building = tile.buildingId ? this.getBuilding(tile.buildingId) : undefined;
        if (building) {
          built += 1;
          demolished += 1;
          demolitionCost += getBuildingDemolitionCost(building);
          continue;
        }
      }
      if (tile.type === 'busStop') return { success: false, built: 0, cost: 0, reason: 'A linha passa por um ponto de ônibus.' };
      if (tile.type === 'metroStation') return { success: false, built: 0, cost: 0, reason: 'A linha passa por uma estação de metrô.' };
      if (tile.type === 'helipad') return { success: false, built: 0, cost: 0, reason: 'A linha passa por um heliponto.' };
      if (tile.type === 'building') return { success: false, built: 0, cost: 0, reason: 'A linha passa por um prédio.' };
      if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) return { success: false, built: 0, cost: 0, reason: 'A linha passa por uma rotatória.' };
      if (tile.type !== roadType) built += 1;
    }

    if (built === 0) return { success: false, built: 0, cost: 0, reason: 'Essa via já existe em toda a linha.' };

    const cost = built * ROAD_CONFIG[roadType].buildCost + demolitionCost;
    if (this.money < cost) return { success: false, built, cost, reason: `Faltam $ ${cost - this.money} para construir.` };

    for (const pos of uniqueTiles) {
      if (this.grid[pos.y][pos.x].type !== roadType) {
        const current = this.grid[pos.y][pos.x];
        const oneWay = current.type === 'road' || current.type === 'avenue' ? current.oneWay : undefined;
        const busLane = current.type === 'road' || current.type === 'avenue' ? current.busLane : undefined;
        const bikeLane = current.type === 'road' || current.type === 'avenue' ? current.bikeLane : undefined;
        if (current.type === 'building' && current.buildingId) this.removeBuildingForRoad(current.buildingId);
        this.grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: roadType, oneWay, busLane, bikeLane: roadType === 'road' ? bikeLane : undefined };
          this.markStaticRenderDirty();
      }
    }

    for (const light of [...this.trafficLights.values()]) {
      if (!isIntersection(this.grid, { x: light.x, y: light.y })) this.trafficLights.delete(getTrafficLightKey(light.x, light.y));
    }

    this.rerouteCarsAffectedBy(uniqueTiles);
    this.money -= cost;
    this.updateConnections();
    this.rebuildTransitLine();
    this.emit();
    return { success: true, built, cost, demolished };
  }

  setBikeLaneLine(tiles: Vec2[]): { success: boolean; changed: number; removed?: boolean; cost: number; reason?: string } {
    const uniqueTiles = dedupeTiles(tiles);
    if (!uniqueTiles.length) return { success: false, changed: 0, cost: 0, reason: 'Nenhum tile selecionado.' };

    let eligible = 0;
    let enabled = 0;
    for (const pos of uniqueTiles) {
      if (!inBounds(pos.x, pos.y)) return { success: false, changed: 0, cost: 0, reason: 'A linha sai do mapa.' };
      const tile = this.grid[pos.y]?.[pos.x];
      if (!tile || tile.type !== 'road') return { success: false, changed: 0, cost: 0, reason: 'Ciclovia só pode ser aplicada em ruas.' };
      eligible += 1;
      if (tile.bikeLane) enabled += 1;
    }

    const remove = eligible > 0 && enabled === eligible;
    const changed = remove ? enabled : eligible - enabled;
    if (changed === 0) return { success: false, changed: 0, cost: 0, reason: remove ? 'A ciclovia já está removida.' : 'A ciclovia já existe em todo o trecho.' };
    const cost = remove
      ? Math.ceil(changed * BIKE_LANE_CONFIG.buildCost * BIKE_LANE_CONFIG.removeCostRatio)
      : changed * BIKE_LANE_CONFIG.buildCost;
    if (this.money < cost) return { success: false, changed, cost, reason: 'Faltam $ ' + (cost - this.money) + ' para ' + (remove ? 'remover' : 'implantar') + ' a ciclovia.' };

    for (const pos of uniqueTiles) {
      const tile = this.grid[pos.y][pos.x];
      if (remove) this.grid[pos.y][pos.x] = { ...tile, bikeLane: undefined };
      else if (!tile.bikeLane) this.grid[pos.y][pos.x] = { ...tile, bikeLane: true };
    }

    this.money -= cost;
    this.markStaticRenderDirty();
    this.refreshSelectedRoad();
    this.emit();
    return { success: true, changed, removed: remove, cost };
  }

  toggleBikeLaneAt(x: number, y: number): { success: boolean; enabled?: boolean; cost?: number; reason?: string } {
    const result = this.setBikeLaneLine([{ x, y }]);
    return result.success
      ? { success: true, enabled: !result.removed, cost: result.cost }
      : { success: false, cost: result.cost, reason: result.reason };
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
      this.markStaticRenderDirty();
    }

    if (changed > 0) this.rerouteCarsAfterRoadRuleChange(uniqueTiles);
    if (changed > 0) this.rebuildTransitLine();
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
    this.markStaticRenderDirty();
    this.rerouteCarsAfterRoadRuleChange([{ x, y }]);
    this.rebuildTransitLine();
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
    this.markStaticRenderDirty();
    this.rerouteCarsAfterRoadRuleChange([{ x, y }]);
    this.rebuildTransitLine();
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
    } else if (tile.type === 'busStop' && tile.buildingId) {
      const stop = this.getTransitStop(tile.buildingId);
      this.selected = stop ? { kind: 'busStop', stop } : { kind: 'tile', x, y, type: tile.type };
    } else if (tile.type === 'metroStation' && tile.metroStationId) {
      const station = this.getMetroStation(tile.metroStationId);
      this.selected = station ? { kind: 'metroStation', station } : { kind: 'tile', x, y, type: tile.type };
    } else if (tile.type === 'helipad' && tile.helipadId) {
      const helipad = this.getHelipad(tile.helipadId);
      this.selected = helipad ? { kind: 'helipad', helipad } : { kind: 'tile', x, y, type: tile.type };
    } else if (isRoadType(tile.type)) {
      const t = this.traffic.get(keyOf(x, y)) ?? { x, y, cars: 0, capacity: ROAD_CONFIG[tile.type as RoadType].capacity, congestion: 0 };
      this.selected = { kind: 'road', x, y, roadType: tile.type as RoadType, traffic: t, trafficLight: this.trafficLights.get(getTrafficLightKey(x, y)), oneWay: tile.oneWay, busLane: tile.busLane };
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
    return this.entityIndex.getById(carId);
  }

  getBuilding(id: string): Building | undefined {
    return this.entityIndex.getBuildingById(id);
  }

  getTransitStop(id: string): TransitStop | undefined {
    return this.transitStops.find((stop) => stop.id === id);
  }

  getTransitBuses(): Car[] {
    return this.cars.filter((car) => car.vehicleType === 'bus');
  }

  private getWaitingPassengerCount(): number {
    return this.transitStops.reduce((sum, stop) => sum + passengerGroupCount(stop.waiting), 0);
  }

  private findBusStopAccessRoad(pos: Vec2): Vec2 | undefined {
    const neighbors = [
      { x: pos.x + 1, y: pos.y },
      { x: pos.x - 1, y: pos.y },
      { x: pos.x, y: pos.y + 1 },
      { x: pos.x, y: pos.y - 1 },
    ].filter((next) => inBounds(next.x, next.y));

    const roads = neighbors.filter((next) => {
      const tile = this.grid[next.y]?.[next.x];
      return tile?.type === 'road' || tile?.type === 'avenue';
    });
    return roads.sort((a, b) => {
      const aScore = this.grid[a.y][a.x].type === 'avenue' ? 0 : 1;
      const bScore = this.grid[b.y][b.x].type === 'avenue' ? 0 : 1;
      return aScore - bScore;
    })[0];
  }

  private removeTransitStopAt(x: number, y: number): void {
    const tile = this.grid[y]?.[x];
    const stopId = tile?.type === 'busStop' ? tile.buildingId : undefined;
    this.transitStops = this.transitStops.filter((stop) => stop.id !== stopId);
    this.grid[y][x] = { x, y, type: 'empty' };
    this.markStaticRenderDirty();
    this.rebuildTransitLine();
    this.selected = { kind: 'tile', x, y, type: 'empty' };
  }

  private removeBuildingForRoad(buildingId: string): void {
    const building = this.getBuilding(buildingId);
    if (!building) return;
    this.entityIndex.removeBuilding(buildingId);
    this.buildings = this.buildings.filter((candidate) => candidate.id !== buildingId);
    this.markStaticRenderDirty();
    const nextCars = this.cars.filter((car) => (
      car.vehicleType === 'bus'
      || (car.originBuildingId !== buildingId && car.destinationBuildingId !== buildingId)
    ));
    this.replaceCars(nextCars);
    if (this.selected.kind === 'building' && this.selected.building.id === buildingId) {
      this.selected = { kind: 'tile', x: building.x, y: building.y, type: 'empty' };
    }
    if (this.selected.kind === 'car' && !this.getCar(this.selected.carId)) {
      this.selected = { kind: 'none' };
    }
  }

  private rebuildTransitLine(): void {
    const desiredBusCount = this.getDesiredTransitBusCount();
    this.replaceCars(this.cars.filter((car) => car.vehicleType !== 'bus'));

    const orderedStops = this.orderTransitStops();
    if (orderedStops.length < 2) {
      this.transitLine = {
        id: 'bus-loop',
        stopIds: orderedStops.map((stop) => stop.id),
        route: [],
        active: false,
        busCount: desiredBusCount,
        reason: 'Adicione ao menos dois pontos de ônibus.',
      };
      return;
    }

    const route: Vec2[] = [];
    for (let index = 0; index < orderedStops.length; index += 1) {
      const from = orderedStops[index].accessRoad;
      const to = orderedStops[(index + 1) % orderedStops.length].accessRoad;
      const segment = keyOf(from.x, from.y) === keyOf(to.x, to.y)
        ? [from]
        : findFastestPath(this.grid, this.traffic, from, to, { vehicleType: 'bus' });
      if (segment.length < 2 && keyOf(from.x, from.y) !== keyOf(to.x, to.y)) {
        this.transitLine = {
          id: 'bus-loop',
          stopIds: orderedStops.map((stop) => stop.id),
          route,
          active: false,
          busCount: desiredBusCount,
          reason: 'Linha de ônibus interrompida: conecte as vias entre os pontos.',
        };
        return;
      }
      if (!route.length) route.push(...segment);
      else route.push(...segment.slice(1));
    }

    this.transitLine = {
      id: 'bus-loop',
      stopIds: orderedStops.map((stop) => stop.id),
      route,
      active: route.length >= 2,
      busCount: desiredBusCount,
    };
    this.spawnTransitBuses();
  }

  private orderTransitStops(): TransitStop[] {
    const remaining = [...this.transitStops].sort((a, b) => a.createdOrder - b.createdOrder);
    const first = remaining.shift();
    if (!first) return [];

    const ordered = [first];
    while (remaining.length) {
      const current = ordered[ordered.length - 1];
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];
        const distance = manhattan(current.accessRoad, candidate.accessRoad);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      ordered.push(remaining.splice(bestIndex, 1)[0]);
    }
    return ordered;
  }

  private spawnTransitBuses(): void {
    if (!this.transitLine.active || this.transitLine.route.length < 2) return;
    const busCount = Math.min(
      this.getMaxTransitBusCount(),
      this.getDesiredTransitBusCount(),
      Math.max(1, this.transitLine.stopIds.length),
    );
    for (let index = 0; index < busCount; index += 1) {
      const stopIndex = Math.floor((index / busCount) * this.transitLine.stopIds.length);
      const bus = this.createTransitBus(stopIndex);
      if (bus) this.addCar(bus);
    }
  }

  private createTransitBus(stopIndex: number): Car | undefined {
    const stopId = this.transitLine.stopIds[stopIndex];
    const stop = stopId ? this.getTransitStop(stopId) : undefined;
    if (!stop || this.transitLine.route.length < 2) return undefined;

    const routeIndex = Math.max(0, this.transitLine.route.findIndex((pos) => samePos(pos, stop.accessRoad)));
    const next = this.transitLine.route[routeIndex + 1] ?? this.transitLine.route[0];
    const current = this.transitLine.route[routeIndex];
    if (!current || !next || samePos(current, next)) return undefined;

    const direction = getDirection(current, next);
    const roadType = this.getRoadTypeAt(current);
    const busId = `bus-${nanoid(6)}`;
    const lane = getLaneOffset(direction, roadType, busId, this.getOneWayAt(current, direction));
    return {
      id: busId,
      vehicleType: 'bus',
      originBuildingId: '',
      destinationBuildingId: '',
      x: current.x + lane.offset.x,
      y: current.y + lane.offset.y,
      currentTileX: current.x,
      currentTileY: current.y,
      route: this.transitLine.route,
      routeIndex,
      progressToNext: 0,
      baseSpeed: TRANSIT_CONFIG.busBaseSpeed,
      currentSpeed: 0,
      targetSpeed: 0,
      acceleration: 1.25,
      braking: 3.2,
      desiredSpeed: TRANSIT_CONFIG.busBaseSpeed * ROAD_CONFIG[roadType].speed,
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
      trafficState: 'queued',
      lifecyclePhase: 'driving',
      lifecycleProgress: 1,
      direction,
      status: 'stopped',
      travelTime: 0,
      estimatedTime: this.transitLine.route.length / TRANSIT_CONFIG.busBaseSpeed,
      delay: 0,
      stuckSeconds: 0,
      immobileSeconds: 0,
      rerouteCooldownSeconds: 0,
      rerouteCount: 0,
      repeatedRerouteCount: 0,
      lastRouteSignature: routeSignature(this.transitLine.route),
      signalTransitionGraceSeconds: 0,
      transitLineId: this.transitLine.id,
      capacity: TRANSIT_CONFIG.busCapacity,
      passengers: [],
      nextStopIndex: stopIndex,
      dwellSeconds: 0,
    };
  }

  private tryCreateTransitTrip(origin: Building, destination: Building): boolean {
    if (!this.transitLine.active) return false;
    if (Math.random() > this.getTransitPassengerConversionChance()) return false;
    const originStop = this.findNearbyTransitStop(origin);
    const destinationStop = this.findNearbyTransitStop(destination);
    if (!originStop || !destinationStop || originStop.id === destinationStop.id) return false;
    if (!this.transitLine.stopIds.includes(originStop.id) || !this.transitLine.stopIds.includes(destinationStop.id)) return false;
    if (passengerGroupCount(originStop.waiting) > TRANSIT_CONFIG.busCapacity * 3) return false;

    addPassengerGroup(originStop.waiting, destinationStop.id, 1);
    originStop.arrivalPulse = 1;
    this.carTripsAvoided += 1;
    return true;
  }

  private updateBikeTrips(dt: number): void {
    for (const bike of this.bikeTrips) {
      bike.progress += bike.speed * dt;
    }
    this.bikeTrips = this.bikeTrips.filter((bike) => bike.progress < bike.route.length - 1 + BIKE_LANE_CONFIG.visualLifePaddingSeconds);
  }

  private getBikeLaneTileCount(): number {
    return this.grid.reduce((sum, row) => sum + row.filter((tile) => tile.type === 'road' && tile.bikeLane).length, 0);
  }

  private getBikeLaneCoverageRatio(): number {
    const roadTiles = this.grid.reduce((sum, row) => sum + row.filter((tile) => tile.type === 'road').length, 0);
    return Math.round((this.getBikeLaneTileCount() / Math.max(1, roadTiles)) * 100) / 100;
  }

  private findNearbyBikeLane(building: Building): Vec2 | undefined {
    const candidates: Vec2[] = [];
    for (let y = building.y - BIKE_LANE_CONFIG.coverageRadius; y <= building.y + BIKE_LANE_CONFIG.coverageRadius; y += 1) {
      for (let x = building.x - BIKE_LANE_CONFIG.coverageRadius; x <= building.x + BIKE_LANE_CONFIG.coverageRadius; x += 1) {
        if (!inBounds(x, y)) continue;
        if (Math.abs(building.x - x) + Math.abs(building.y - y) > BIKE_LANE_CONFIG.coverageRadius) continue;
        const tile = this.grid[y]?.[x];
        if (tile?.type === 'road' && tile.bikeLane) candidates.push({ x, y });
      }
    }
    return candidates.sort((a, b) => manhattan(a, building) - manhattan(b, building))[0];
  }

  private tryCreateBikeTrip(origin: Building, destination: Building): boolean {
    const tripDistance = manhattan(origin, destination);
    if (tripDistance > BIKE_LANE_CONFIG.maxTripDistance) return false;
    if (Math.random() > BIKE_LANE_CONFIG.bikeTripChance) return false;

    const originAccess = this.findNearbyBikeLane(origin);
    const destinationAccess = this.findNearbyBikeLane(destination);
    if (!originAccess || !destinationAccess) return false;

    const route = findBikeLanePath(this.grid, originAccess, destinationAccess);
    if (route.length < 2) return false;

    if (this.bikeTrips.length < BIKE_LANE_CONFIG.maxActiveBikeVisuals) {
      this.bikeTrips.push({
        id: nanoid(8),
        route,
        progress: 0,
        speed: BIKE_LANE_CONFIG.bikeSpeedTilesPerSecond,
        originBuildingId: origin.id,
        destinationBuildingId: destination.id,
        createdAtDay: this.time.getDay(),
      });
    }

    this.bikeTripsCompleted += 1;
    this.secondsSinceBikeTrip = 0;
    this.bikeCarsAvoided += 1;
    this.carTripsAvoided += 1;
    this.completedTrips += 1;
    this.tripHistory.push(Math.max(2, route.length / BIKE_LANE_CONFIG.bikeSpeedTilesPerSecond));
    if (this.tripHistory.length > TRAVEL_TIME_HISTORY_LIMIT) this.tripHistory.shift();
    this.averageTravelTime = this.tripHistory.length ? this.tripHistory.reduce((a, b) => a + b, 0) / this.tripHistory.length : 0;
    return true;
  }

  private findNearbyTransitStop(building: Building): TransitStop | undefined {
    return this.transitStops
      .filter((stop) => manhattan(stop, building) <= TRANSIT_CONFIG.coverageRadius)
      .sort((a, b) => manhattan(a, building) - manhattan(b, building))[0];
  }

  private updateTransitStops(dt: number): void {
    for (const stop of this.transitStops) {
      stop.arrivalPulse = Math.max(0, stop.arrivalPulse - dt * 1.8);
    }
  }

  private updateTransitBusDwell(bus: Car, dt: number): boolean {
    if (bus.vehicleType !== 'bus') return false;

    if ((bus.dwellSeconds ?? 0) > 0) {
      bus.dwellSeconds = Math.max(0, (bus.dwellSeconds ?? 0) - dt);
      bus.currentSpeed = 0;
      bus.targetSpeed = 0;
      bus.status = 'stopped';
      bus.trafficState = 'queued';
      bus.stuckSeconds = 0;
      bus.immobileSeconds = 0;
      if (bus.dwellSeconds === 0) {
        bus.dwellStopId = undefined;
        bus.trafficState = 'moving';
      }
      return true;
    }

    return this.tryStopTransitBusAtCurrentTile(bus);
  }

  private tryStopTransitBusAtCurrentTile(bus: Car): boolean {
    if (bus.vehicleType !== 'bus') return false;
    if ((bus.dwellSeconds ?? 0) > 0) return true;

    const stop = this.getNextTransitStopForBus(bus);
    if (!stop) return false;
    const currentTileKey = keyOf(bus.currentTileX, bus.currentTileY);
    if (bus.lastTransitStopTileKey === currentTileKey) return false;
    if (!samePos({ x: bus.currentTileX, y: bus.currentTileY }, stop.accessRoad)) return false;

    this.serviceTransitStop(bus, stop);
    bus.dwellSeconds = TRANSIT_CONFIG.busDwellSeconds;
    bus.dwellStopId = stop.id;
    bus.lastTransitStopTileKey = currentTileKey;
    bus.progressToNext = 0;
    bus.x = bus.currentTileX + bus.laneOffset.x;
    bus.y = bus.currentTileY + bus.laneOffset.y;
    bus.currentSpeed = 0;
    bus.targetSpeed = 0;
    bus.status = 'stopped';
    bus.trafficState = 'queued';
    bus.lastRerouteReason = 'Parada atendida: embarque/desembarque';
    return true;
  }

  private getNextTransitStopForBus(bus: Car): TransitStop | undefined {
    if (!this.transitLine.active || !this.transitLine.stopIds.length) return undefined;
    const index = Math.max(0, Math.min(this.transitLine.stopIds.length - 1, bus.nextStopIndex ?? 0));
    return this.getTransitStop(this.transitLine.stopIds[index]);
  }

  private serviceTransitStop(bus: Car, stop: TransitStop): void {
    const passengers = bus.passengers ?? [];
    const remainingPassengers: TransitPassengerGroup[] = [];
    let alighted = 0;
    for (const group of passengers) {
      if (group.destinationStopId === stop.id) alighted += group.count;
      else remainingPassengers.push(group);
    }
    if (alighted > 0) {
      stop.totalAlighted += alighted;
      this.publicTripsCompleted += alighted;
      this.busTripsCompleted += alighted;
      this.completedTrips += alighted;
    }

    const capacity = bus.capacity ?? TRANSIT_CONFIG.busCapacity;
    let freeSeats = Math.max(0, capacity - passengerGroupCount(remainingPassengers));
    const nextWaiting: TransitPassengerGroup[] = [];
    let boarded = 0;
    for (const group of stop.waiting) {
      if (freeSeats <= 0) {
        nextWaiting.push(group);
        continue;
      }
      const taking = Math.min(group.count, freeSeats);
      if (taking > 0) {
        addPassengerGroup(remainingPassengers, group.destinationStopId, taking);
        boarded += taking;
        freeSeats -= taking;
      }
      if (group.count > taking) {
        nextWaiting.push({ destinationStopId: group.destinationStopId, count: group.count - taking });
      }
    }

    bus.passengers = remainingPassengers;
    stop.waiting = nextWaiting;
    stop.totalBoarded += boarded;
    stop.arrivalPulse = Math.max(stop.arrivalPulse, 0.65);
    bus.nextStopIndex = ((bus.nextStopIndex ?? 0) + 1) % Math.max(1, this.transitLine.stopIds.length);
  }

  private updateConnections(): void {
    let changed = false;
    this.buildings = this.buildings.map((building) => {
      const next = updateBuildingConnection(building, this.grid);
      if (next.connected !== building.connected) changed = true;
      return next;
    });
    this.entityIndex.rebuildBuildings(this.buildings);
    if (changed) this.markStaticRenderDirty();
  }

  private updateTrafficLights(dt: number): void {
    if (!this.trafficLights.size) return;
    const demands = this.buildTrafficLightDemands();

    for (const [key, light] of this.trafficLights) {
      const demand = demands.get(key) ?? EMPTY_TRAFFIC_LIGHT_DEMAND;
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

  private buildTrafficLightDemands(): Map<string, TrafficLightDemand> {
    const demands = new Map<string, TrafficLightDemand>();
    const ensureDemand = (key: string): TrafficLightDemand => {
      let demand = demands.get(key);
      if (!demand) {
        demand = { ...EMPTY_TRAFFIC_LIGHT_DEMAND };
        demands.set(key, demand);
      }
      return demand;
    };

    for (const car of this.cars) {
      if (car.status === 'arrived' || car.lifecyclePhase !== 'driving') continue;
      const current = car.route[car.routeIndex];
      const next = car.route[car.routeIndex + 1];
      const currentKey = keyOf(car.currentTileX, car.currentTileY);

      if (this.trafficLights.has(currentKey)) {
        const demand = ensureDemand(currentKey);
        demand.occupiedCount += 1;
        demand.maxInsideWait = Math.max(demand.maxInsideWait, car.insideIntersectionSeconds, car.stuckSeconds);
      }

      if (!current || !next) continue;
      const nextKey = keyOf(next.x, next.y);
      if (!this.trafficLights.has(nextKey)) continue;

      const closeToStopLine = car.progressToNext >= 0.35;
      const slowOrStopped = car.currentSpeed < 0.35 || car.status === 'stopped';
      if (!closeToStopLine && !slowOrStopped) continue;

      const demand = ensureDemand(nextKey);
      const axis = getTrafficLightAxis(getDirection(current, next));
      const wait = Math.max(car.intersectionWaitSeconds, car.stuckSeconds, car.waitTimer);
      if (axis === 'horizontal') {
        demand.horizontalQueue += 1;
        demand.horizontalMaxWait = Math.max(demand.horizontalMaxWait, wait);
      } else {
        demand.verticalQueue += 1;
        demand.verticalMaxWait = Math.max(demand.verticalMaxWait, wait);
      }
    }
    return demands;
  }

  private getTrafficLightDemandAt(x: number, y: number): TrafficLightDemand {
    const key = keyOf(x, y);
    const demand: TrafficLightDemand = { ...EMPTY_TRAFFIC_LIGHT_DEMAND };
    for (const car of this.entityIndex.getCarsForIntersection(x, y)) {
      if (car.status === 'arrived' || car.lifecyclePhase !== 'driving') continue;
      const current = car.route[car.routeIndex];
      const next = car.route[car.routeIndex + 1];
      if (car.currentTileX === x && car.currentTileY === y) {
        demand.occupiedCount += 1;
        demand.maxInsideWait = Math.max(demand.maxInsideWait, car.insideIntersectionSeconds, car.stuckSeconds);
      }
      if (!current || !next || keyOf(next.x, next.y) !== key) continue;
      if (car.progressToNext < 0.35 && car.currentSpeed >= 0.35 && car.status !== 'stopped') continue;
      const axis = getTrafficLightAxis(getDirection(current, next));
      const wait = Math.max(car.intersectionWaitSeconds, car.stuckSeconds, car.waitTimer);
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
            capacity: this.getRoadCapacityForTraffic(tile, roadType),
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
        const vehicleWeight = this.getVehicleTrafficWeight(car);
        info.cars += vehicleWeight;
        if (car.trafficState === 'queued' || car.trafficState === 'intersection' || car.status === 'stopped') {
          pressure.set(k, (pressure.get(k) ?? 0) + vehicleWeight * 1.35 + Math.min(2.5, car.stuckSeconds * 0.15));
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
    const population = this.buildings.reduce((sum, b) => sum + (isBuildingOperational(b) ? b.population : 0), 0);
    const desiredAttempts = Math.max(1, Math.floor((population / 32) * multiplier));
    const highLoad = this.isPerformanceHighLoadMode();
    const extremeLoad = this.cars.length >= PERFORMANCE_CONFIG.tripBudgetExtremeCars;
    const attemptBudget = highLoad
      ? (extremeLoad ? PERFORMANCE_CONFIG.tripAttemptBudgetExtremeLoad : PERFORMANCE_CONFIG.tripAttemptBudgetHighLoad)
      : desiredAttempts;
    const spawnBudget = highLoad
      ? (extremeLoad ? PERFORMANCE_CONFIG.tripSpawnBudgetExtremeLoad : PERFORMANCE_CONFIG.tripSpawnBudgetHighLoad)
      : Number.POSITIVE_INFINITY;

    let attempts = Math.min(desiredAttempts, attemptBudget);
    let spawnedCars = 0;
    let skippedAttempts = Math.max(0, desiredAttempts - attempts);
    let skippedSpawns = 0;

    for (let i = 0; i < attempts; i++) {
      if (this.getPrivateCarCount() >= this.getMaxCars()) break;
      if (Math.random() > 0.62) continue;
      const trip = chooseTrip(this.buildings, this.time.getPeriod());
      if (!trip || !trip.origin.nearestRoad || !trip.destination.nearestRoad) {
        this.recordFailedTrip();
        continue;
      }
      const tripDistance = manhattan(trip.origin, trip.destination);
      if (tripDistance >= HELICOPTER_CONFIG.minLineDistance && this.tryCreateHelicopterTrip(trip.origin, trip.destination)) {
        trip.origin.tripsToday += 1;
        trip.destination.tripsToday += 1;
        continue;
      }
      if (tripDistance >= METRO_CONFIG.longTripDistance && this.tryCreateMetroTrip(trip.origin, trip.destination)) {
        trip.origin.tripsToday += 1;
        trip.destination.tripsToday += 1;
        continue;
      }
      if (this.tryCreateTransitTrip(trip.origin, trip.destination)) {
        trip.origin.tripsToday += 1;
        trip.destination.tripsToday += 1;
        continue;
      }
      if (tripDistance < METRO_CONFIG.longTripDistance && this.tryCreateMetroTrip(trip.origin, trip.destination)) {
        trip.origin.tripsToday += 1;
        trip.destination.tripsToday += 1;
        continue;
      }
      if (tripDistance <= BIKE_LANE_CONFIG.maxTripDistance && this.tryCreateBikeTrip(trip.origin, trip.destination)) {
        trip.origin.tripsToday += 1;
        trip.destination.tripsToday += 1;
        continue;
      }
      if (spawnedCars >= spawnBudget) {
        skippedSpawns += 1;
        continue;
      }
      const route = this.performanceProfiler.time('pathfindingSyncMs', () => findFastestPath(this.grid, this.traffic, trip.origin.nearestRoad!, trip.destination.nearestRoad!));
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
      this.addCar({
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
        immobileSeconds: 0,
        rerouteCooldownSeconds: 0,
        rerouteCount: 0,
        repeatedRerouteCount: 0,
        lastRouteSignature: routeSignature(route),
        signalTransitionGraceSeconds: 0,
        intersectionReason: undefined,
      });
      spawnedCars += 1;
      trip.origin.tripsToday += 1;
      trip.destination.tripsToday += 1;
    }

    this.performanceProfiler.recordTripBudget(skippedAttempts, skippedSpawns);
  }

  private updateCars(dt: number): void {
    this.performanceUpdateTick = (this.performanceUpdateTick + 1) % 300000;
    if (PERFORMANCE_CONFIG.enableEntityIndexValidation
      && this.performanceUpdateTick % PERFORMANCE_CONFIG.entityIndexValidationEveryTicks === 0
      && !this.entityIndex.validate(this.cars, this.buildings)) {
      console.warn('[performance] Índice persistente divergente; reconstruindo.');
      this.entityIndex.rebuild(this.cars, this.buildings);
    }
    const arrived: Car[] = [];
    const failed: Car[] = [];
    for (const car of this.cars) car.travelTime += dt;

    const detailedCars = this.performanceProfiler.time('carGroupingMs', () => this.prepareCarUpdateGroups(dt));
    const detailedDrivingCars = detailedCars.filter((car) => car.lifecyclePhase === 'driving');
    const intersectionControls = buildIntersectionControls(this.grid, detailedDrivingCars, this.entityIndex);
    const sortedCars = this.getCarUpdateOrder(detailedCars);
    const detailedStarted = performance.now();

    for (let carIndex = 0; carIndex < sortedCars.length; carIndex += 1) {
      const car = sortedCars[carIndex];
      const updateDt = Math.max(dt, Math.min(
        PERFORMANCE_CONFIG.groupedCarMaxAccumulatedDt,
        car.backgroundAccumulatedDt ?? dt,
      ));
      car.backgroundAccumulatedDt = 0;
      if (car.lifecyclePhase === 'spawnExit') {
        car.lifecycleProgress += updateDt / CAR_SPAWN_EXIT_SECONDS;
        car.currentSpeed = Math.min(car.desiredSpeed, car.currentSpeed + car.acceleration * updateDt);
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
        this.entityIndex.syncCar(car);
        continue;
      }

      if (car.lifecyclePhase === 'destinationEntry') {
        car.lifecycleProgress += updateDt / CAR_DESTINATION_ENTRY_SECONDS;
        car.currentSpeed = Math.max(0, car.currentSpeed - car.braking * updateDt);
        car.targetSpeed = 0;
        car.trafficState = 'moving';
        car.status = 'moving';
        if (car.lifecycleProgress >= 1) {
          car.status = 'arrived';
          arrived.push(car);
        }
        this.entityIndex.syncCar(car);
        continue;
      }

      if (this.updateTransitBusDwell(car, updateDt)) {
        continue;
      }

      if (car.rerouteCooldownSeconds > 0) car.rerouteCooldownSeconds = Math.max(0, car.rerouteCooldownSeconds - updateDt);
      if (car.signalTransitionGraceSeconds > 0) {
        car.signalTransitionGraceSeconds = Math.max(0, car.signalTransitionGraceSeconds - updateDt);
        if (car.signalTransitionGraceSeconds === 0) car.signalTransitionKey = undefined;
      }

      const currentRouteTile = car.route[car.routeIndex];
      const nextRouteTile = car.route[car.routeIndex + 1];
      if (currentRouteTile && nextRouteTile && !isLegalRoadMove(this.grid, currentRouteTile, nextRouteTile)) {
        if (car.vehicleType === 'bus') {
          this.rebuildTransitLine();
          continue;
        }
        const rerouted = car.rerouteCooldownSeconds <= 0
          && this.tryRerouteCar(car, {
            force: true,
            reason: 'Mão única alterada: rota recalculada',
            allowNeighborFallback: true,
            cooldownSeconds: ROAD_RULE_REROUTE_COOLDOWN_SECONDS,
            stopBeforeMoving: false,
          });
        if (!rerouted) {
          car.stuckSeconds += updateDt;
          car.immobileSeconds += updateDt;
          if (car.stuckSeconds >= ROAD_RULE_NO_ROUTE_SECONDS) {
            car.status = 'no_route';
            car.lastRerouteReason = 'Sem rota após mudança de mão única';
            failed.push(car);
            continue;
          }
          this.holdCarForRoadRuleReroute(car, 'Mão única alterada: aguardando rota válida');
          continue;
        }
      }

      const traffic = this.traffic.get(keyOf(car.currentTileX, car.currentTileY));
      const rawCongestion = traffic?.congestion ?? 0;
      const congestion = this.getCongestionForCar(car, rawCongestion, nextRouteTile);
      const decision = computeTrafficDecision(this.grid, car, detailedDrivingCars, intersectionControls, this.trafficLights, congestion, this.entityIndex);
      const busLaneSpeedMultiplier = this.getBusLaneSpeedMultiplierForCar(car, nextRouteTile);
      car.desiredSpeed = decision.desiredSpeed * busLaneSpeedMultiplier;
      car.targetSpeed = decision.targetSpeed * busLaneSpeedMultiplier;
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
      applySmoothSpeed(car, car.targetSpeed, updateDt, decision.hardStop);
      car.status = car.currentSpeed < 0.08 ? 'stopped' : 'moving';
      car.turnSlowdown = decision.turning ? Math.max(car.turnSlowdown, 0.32) : Math.max(0, car.turnSlowdown - updateDt);

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
          car.waitTimer += updateDt;
          car.intersectionWaitSeconds += updateDt;
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
        car.insideIntersectionSeconds += updateDt;
      } else if (!insideIntersection) {
        car.insideIntersectionSeconds = 0;
      } else {
        car.insideIntersectionSeconds = Math.max(0, car.insideIntersectionSeconds - updateDt * 2);
      }

      if (car.currentSpeed < 0.08 && car.targetSpeed < 0.2) {
        car.stuckSeconds += updateDt;
      } else if (car.currentSpeed > 0.25) {
        car.stuckSeconds = Math.max(0, car.stuckSeconds - updateDt * 2.5);
      }

      this.updateImmobileTimer(car, updateDt);

      if (car.currentSpeed < 0.25) car.delay += updateDt;

      if (this.shouldRemoveStuckCar(car)) {
        car.status = 'no_route';
        car.lastRerouteReason = 'Removido por travamento prolongado';
        failed.push(car);
        continue;
      }

      this.runStuckWatchdog(car);

      const rerouteStuckSeconds = shouldDelayIntersectionReroute(car) ? INTERSECTION_REROUTE_STUCK_SECONDS : REROUTE_STUCK_SECONDS;
      if (car.stuckSeconds >= rerouteStuckSeconds && car.rerouteCooldownSeconds <= 0 && !insideIntersection) {
        const rerouted = this.tryRerouteCar(car);
        if (!rerouted && car.stuckSeconds >= REROUTE_FORCE_SECONDS && car.intersectionStopKey) {
          car.rerouteCooldownSeconds = REROUTE_COOLDOWN_SECONDS * 0.5;
          car.lastRerouteReason = 'Sem rota melhor: aguardando abertura do semáforo';
        }
      }

      car.progressToNext += car.currentSpeed * updateDt;
      while (car.progressToNext >= 1 && car.routeIndex < car.route.length - 1) {
        car.progressToNext -= 1;
        car.routeIndex += 1;
        const pos = car.route[car.routeIndex];
        car.currentTileX = pos.x;
        car.currentTileY = pos.y;
        car.x = pos.x;
        car.y = pos.y;
        if (car.vehicleType === 'bus') {
          const currentTileKey = keyOf(car.currentTileX, car.currentTileY);
          if (car.lastTransitStopTileKey && car.lastTransitStopTileKey !== currentTileKey) {
            car.lastTransitStopTileKey = undefined;
          }
          if (this.tryStopTransitBusAtCurrentTile(car)) break;
        }
      }
      if (car.routeIndex >= car.route.length - 1 && car.vehicleType === 'bus') {
        car.routeIndex = 0;
        car.progressToNext = 0;
        const start = car.route[0];
        if (start) {
          car.currentTileX = start.x;
          car.currentTileY = start.y;
          car.x = start.x + car.laneOffset.x;
          car.y = start.y + car.laneOffset.y;
        }
        this.tryStopTransitBusAtCurrentTile(car);
      } else if (car.routeIndex >= car.route.length - 1) {
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
      this.entityIndex.syncCar(car);
    }
    this.performanceProfiler.recordTiming('detailedCarsMs', performance.now() - detailedStarted);
    if (arrived.length) {
      for (const car of arrived) {
        this.completedTrips += 1;
        this.tripHistory.push(car.travelTime);
        if (this.tripHistory.length > TRAVEL_TIME_HISTORY_LIMIT) this.tripHistory.shift();
      }
    }
    if (failed.length) {
      for (let index = 0; index < failed.length; index += 1) {
        this.recordFailedTrip();
      }
    }
    if (arrived.length || failed.length) {
      this.replaceCars(this.cars.filter((c) => c.status !== 'arrived' && c.status !== 'no_route'));
      this.averageTravelTime = this.tripHistory.length ? this.tripHistory.reduce((a, b) => a + b, 0) / this.tripHistory.length : 0;
    }
  }
  private updateConnectionsOptimized(dt: number): void {
    const highLoad = this.cars.length >= PERFORMANCE_CONFIG.connectionUpdateHighLoadThresholdCars;
    if (!highLoad) {
      this.updateConnections();
      this.connectionUpdateAccumulator = 0;
      this.lastConnectionStaticRenderVersion = this.staticRenderVersion;
      return;
    }

    this.connectionUpdateAccumulator += dt;
    const staticChanged = this.staticRenderVersion !== this.lastConnectionStaticRenderVersion;
    const interval = this.cars.length >= PERFORMANCE_CONFIG.trafficWorkerHighLoadThresholdCars
      ? PERFORMANCE_CONFIG.connectionUpdateHighLoadIntervalSeconds
      : PERFORMANCE_CONFIG.connectionUpdateIntervalSeconds;

    if (!staticChanged && this.connectionUpdateAccumulator < interval) {
      this.performanceProfiler.recordConnectionSkip();
      return;
    }

    this.connectionUpdateAccumulator = 0;
    this.lastConnectionStaticRenderVersion = this.staticRenderVersion;
    this.updateConnections();
  }

  private prepareCarUpdateGroups(dt: number): Car[] {
    const totalCars = this.cars.length;
    if (totalCars < PERFORMANCE_CONFIG.groupedCarUpdateThreshold) {
      this.performanceProfiler.setCounters({
        criticalCars: totalCars,
        visibleDetailedCars: 0,
        backgroundCars: 0,
        backgroundCarsUpdated: 0,
      });
      return this.cars;
    }

    const batches = totalCars >= PERFORMANCE_CONFIG.groupedCarUpdateExtremeThreshold
      ? PERFORMANCE_CONFIG.groupedCarUpdateExtremeBatches
      : PERFORMANCE_CONFIG.groupedCarUpdateBatches;
    const detailed: Car[] = [];
    let criticalCars = 0;
    let visibleCars = 0;
    let backgroundCars = 0;
    let backgroundCarsUpdated = 0;
    const lightweightStarted = performance.now();

    for (const car of this.cars) {
      if (this.isCriticalCarForDetailedUpdate(car)) {
        car.backgroundAccumulatedDt = Math.min(
          PERFORMANCE_CONFIG.groupedCarMaxAccumulatedDt,
          (car.backgroundAccumulatedDt ?? 0) + dt,
        );
        detailed.push(car);
        criticalCars += 1;
        continue;
      }

      if (this.isCarInsideActiveViewport(car, PERFORMANCE_CONFIG.groupedCarViewportPaddingTiles)) {
        car.backgroundAccumulatedDt = Math.min(
          PERFORMANCE_CONFIG.groupedCarMaxAccumulatedDt,
          (car.backgroundAccumulatedDt ?? 0) + dt,
        );
        detailed.push(car);
        visibleCars += 1;
        continue;
      }

      backgroundCars += 1;
      car.backgroundAccumulatedDt = Math.min(
        PERFORMANCE_CONFIG.groupedCarMaxAccumulatedDt,
        (car.backgroundAccumulatedDt ?? 0) + dt,
      );
      if (this.performanceUpdateTick % batches !== this.getCarPerformanceBucket(car) % batches) continue;

      const accumulatedDt = car.backgroundAccumulatedDt;
      if (this.shouldPromoteBackgroundCar(car, accumulatedDt)
        || !this.canAdvanceDistantCarLightweight(car)) {
        detailed.push(car);
        continue;
      }

      this.advanceDistantCarLightweight(car, accumulatedDt);
      car.backgroundAccumulatedDt = 0;
      this.entityIndex.syncCar(car);
      backgroundCarsUpdated += 1;
    }

    this.performanceProfiler.setCounters({
      criticalCars,
      visibleDetailedCars: visibleCars,
      backgroundCars,
      backgroundCarsUpdated,
      reducedCars: backgroundCars,
    });
    this.performanceProfiler.recordTiming('lightweightCarsMs', performance.now() - lightweightStarted);
    return detailed;
  }

  private isCriticalCarForDetailedUpdate(car: Car): boolean {
    if (car.vehicleType === 'bus') return true;
    if (this.selected.kind === 'car' && this.selected.carId === car.id) return true;
    if (car.lifecyclePhase !== 'driving') return true;
    if (car.intersectionStopKey || car.signalTransitionGraceSeconds > 0) return true;
    if (car.stuckSeconds >= PERFORMANCE_CONFIG.priorityStuckSeconds
      || car.immobileSeconds >= PERFORMANCE_CONFIG.priorityImmobileSeconds
      || car.rerouteCooldownSeconds > 0) return true;
    const current = { x: car.currentTileX, y: car.currentTileY };
    if (isIntersection(this.grid, current)) return true;
    const next = car.route[car.routeIndex + 1];
    return Boolean(next && isIntersection(this.grid, next)
      && car.progressToNext >= PERFORMANCE_CONFIG.groupedCarIntersectionPromotionProgress);
  }

  private canAdvanceDistantCarLightweight(car: Car): boolean {
    return car.lifecyclePhase === 'driving'
      && car.status === 'moving'
      && car.trafficState === 'moving'
      && !car.blockedByCarId
      && !car.intersectionStopKey
      && car.signalTransitionGraceSeconds <= 0
      && car.rerouteCooldownSeconds <= 0
      && car.stuckSeconds < PERFORMANCE_CONFIG.priorityStuckSeconds
      && car.immobileSeconds < PERFORMANCE_CONFIG.priorityImmobileSeconds;
  }

  private shouldPromoteBackgroundCar(car: Car, dt: number): boolean {
    const current = car.route[car.routeIndex];
    const next = car.route[car.routeIndex + 1];
    if (!current || !next) return true;
    if (isIntersection(this.grid, current)) return true;
    if (!isIntersection(this.grid, next)) return false;
    const projectedProgress = car.progressToNext + Math.max(0.25, car.currentSpeed || car.baseSpeed) * dt;
    return projectedProgress >= PERFORMANCE_CONFIG.groupedCarIntersectionPromotionProgress;
  }

  private isCarInsideActiveViewport(car: Car, paddingTiles: number): boolean {
    if (this.isTileInsideActiveViewport(car.currentTileX, car.currentTileY, paddingTiles)) return true;
    const next = car.route[car.routeIndex + 1];
    return Boolean(next && this.isTileInsideActiveViewport(next.x, next.y, paddingTiles));
  }

  private getCarPerformanceBucket(car: Car): number {
    if (car.performanceBucket !== undefined) return car.performanceBucket;
    car.performanceBucket = this.carUpdateBucket(car);
    return car.performanceBucket;
  }

  private updateTrafficMapOptimized(dt: number): void {
    const shouldUseWorker = this.cars.length >= PERFORMANCE_CONFIG.trafficWorkerThresholdCars;
    if (!shouldUseWorker) {
      this.performanceProfiler.time('trafficMapMs', () => this.updateTrafficMap());
      return;
    }

    this.trafficMapWorkerAccumulator += dt;
    const interval = this.cars.length >= PERFORMANCE_CONFIG.trafficWorkerHighLoadThresholdCars
      ? PERFORMANCE_CONFIG.trafficWorkerHighLoadIntervalSeconds
      : PERFORMANCE_CONFIG.trafficWorkerIntervalSeconds;

    if (this.trafficMapWorkerAccumulator < interval || this.trafficMapWorkerInFlight) return;
    this.trafficMapWorkerAccumulator = 0;
    this.trafficMapWorkerInFlight = true;

    const client = getTrafficMapClient();
    client.request({
      grid: createWorkerGridSnapshot(this.grid),
      cars: createWorkerCarSnapshot(this.cars),
    }).then((result) => {
      this.trafficMapWorkerInFlight = false;
      if (!result) {
        this.performanceProfiler.time('trafficMapMs', () => this.updateTrafficMap());
        return;
      }
      this.traffic = result.traffic;
      this.performanceProfiler.recordTrafficWorker(result.durationMs);
    }).catch(() => {
      this.trafficMapWorkerInFlight = false;
      this.performanceProfiler.time('trafficMapMs', () => this.updateTrafficMap());
    });
  }

  private getCarUpdateOrder(cars: Car[]): Car[] {
    if (cars.length < PERFORMANCE_CONFIG.reducedSortThresholdCars) {
      const sorted = [...cars].sort((a, b) => this.carUpdatePriority(b) - this.carUpdatePriority(a));
      this.performanceProfiler.setCounters({ sortedPriorityCars: sorted.length, sortedNormalCars: 0, activeCars: this.cars.length });
      return sorted;
    }

    const priorityCars: Car[] = [];
    const normalCars: Car[] = [];
    for (const car of cars) {
      if (this.needsPriorityCarUpdate(car)) priorityCars.push(car);
      else normalCars.push(car);
    }

    priorityCars.sort((a, b) => this.carUpdatePriority(b) - this.carUpdatePriority(a));
    this.performanceProfiler.setCounters({
      sortedPriorityCars: priorityCars.length,
      sortedNormalCars: normalCars.length,
      activeCars: this.cars.length,
    });
    return [...priorityCars, ...normalCars];
  }
  private needsPriorityCarUpdate(car: Car): boolean {
    if (car.vehicleType === 'bus') return true;
    if (this.selected.kind === 'car' && this.selected.carId === car.id) return true;
    if (car.lifecyclePhase !== 'driving') return true;
    if (car.intersectionStopKey) return true;
    if (car.signalTransitionGraceSeconds > 0) return true;
    if (car.immobileSeconds > PERFORMANCE_CONFIG.priorityImmobileSeconds) return true;
    if (car.stuckSeconds > PERFORMANCE_CONFIG.priorityStuckSeconds) return true;
    const current = { x: car.currentTileX, y: car.currentTileY };
    if (isIntersection(this.grid, current)) return true;
    const next = car.route[car.routeIndex + 1];
    return Boolean(next && car.progressToNext >= PERFORMANCE_CONFIG.priorityIntersectionProgressThreshold && isIntersection(this.grid, next));
  }
  private syncPathfindingWorkerSnapshots(trafficForReroute?: Map<string, TrafficCell>): void {
    const now = performance.now();
    const client = getPathfindingClient();
    const gridChanged = this.pathfindingWorkerGridVersion !== this.staticRenderVersion;
    const trafficStale = now - this.pathfindingWorkerTrafficSyncAt >= PERFORMANCE_CONFIG.pathfindingWorkerSnapshotSyncMs;
    if (!gridChanged && !trafficStale) return;

    client.updateSnapshots(
      gridChanged ? createWorkerGridSnapshot(this.grid) : undefined,
      trafficStale ? createWorkerTrafficSnapshot(trafficForReroute ?? this.traffic) : undefined,
    );
    if (gridChanged) this.pathfindingWorkerGridVersion = this.staticRenderVersion;
    if (trafficStale) this.pathfindingWorkerTrafficSyncAt = now;
  }
  private shouldUseAsyncPathfinding(car: Car, options: RerouteOptions): boolean {
    if (this.cars.length < PERFORMANCE_CONFIG.pathfindingWorkerThresholdCars) return false;
    if (options.force) return false;
    if (car.vehicleType === 'bus') return false;
    if (this.asyncRerouteCarIds.has(car.id)) return false;
    if (car.lifecyclePhase !== 'driving') return false;
    if (this.selected.kind === 'car' && this.selected.carId === car.id) return false;
    if (car.intersectionStopKey || car.signalTransitionGraceSeconds > 0) return false;
    if (car.immobileSeconds > IMMOBILE_ESCAPE_SECONDS * 0.65) return false;
    if (car.stuckSeconds > REROUTE_FORCE_SECONDS * 0.8) return false;
    return true;
  }
  private requestAsyncCarReroute(car: Car, start: Vec2, destination: Vec2, trafficForReroute: Map<string, TrafficCell>, options: RerouteOptions): void {
    const client = getPathfindingClient();
    const highLoad = this.isPerformanceHighLoadMode();
    const extremeLoad = this.cars.length >= PERFORMANCE_CONFIG.visibleReducedExtremeCars;

    this.syncPathfindingWorkerSnapshots(trafficForReroute);
    const requestedAt = performance.now();
    const request = client.request({
      carId: car.id,
      start,
      goal: destination,
      options: { vehicleType: 'car' },
    }, { highLoad, extremeLoad });

    if (request.status !== 'accepted') {
      if (request.status === 'deduped') this.performanceProfiler.recordPathfindingDropped('deduped');
      else if (request.status === 'throttled') this.performanceProfiler.recordPathfindingDropped('throttled');
      else this.performanceProfiler.recordPathfindingDropped('dropped');
      car.rerouteCooldownSeconds = Math.max(car.rerouteCooldownSeconds, 0.8);
      car.lastRerouteReason = request.status === 'deduped' ? 'Rota já pendente no worker' : 'Worker de rotas em orçamento';
      this.holdCarForRoadRuleReroute(car, 'Aguardando orçamento de rota');
      this.performanceProfiler.setCounters({ pathfindingPending: client.getPendingCount() });
      return;
    }

    this.asyncRerouteCarIds.add(car.id);
    car.rerouteCooldownSeconds = Math.max(car.rerouteCooldownSeconds, options.cooldownSeconds ?? REROUTE_COOLDOWN_SECONDS * 0.55);
    car.lastRerouteReason = options.reason ?? 'Rota enviada para worker';
    this.holdCarForRoadRuleReroute(car, 'Aguardando rota do worker');

    request.promise.then((response) => {
      this.asyncRerouteCarIds.delete(car.id);
      const duration = response?.durationMs ?? performance.now() - requestedAt;
      this.performanceProfiler.recordPathfindingWorker(duration, Boolean(response && response.route.length >= 2));
      if (!response || response.route.length < 2) return;
      this.applyWorkerRouteToCar(response.carId ?? car.id, response.route);
    }).catch(() => {
      this.asyncRerouteCarIds.delete(car.id);
      this.performanceProfiler.recordPathfindingWorker(performance.now() - requestedAt, false);
    });

    this.performanceProfiler.setCounters({ pathfindingPending: client.getPendingCount() });
  }

  private applyWorkerRouteToCar(carId: string, route: Vec2[]): void {
    const car = this.getCar(carId);
    if (!car) return;
    if (!isRouteLegal(this.grid, route)) return;
    car.route = route;
    car.routeIndex = 0;
    car.progressToNext = 0;
    const first = route[0];
    if (first) {
      car.currentTileX = first.x;
      car.currentTileY = first.y;
      car.x = first.x + car.laneOffset.x;
      car.y = first.y + car.laneOffset.y;
    }
    car.status = 'moving';
    car.trafficState = 'moving';
    car.rerouteCount += 1;
    car.repeatedRerouteCount = 0;
    car.lastRerouteReason = 'Rota aplicada pelo worker';
    this.entityIndex.syncCar(car);
    this.performanceProfiler.setCounters({ pathfindingPending: getPathfindingClient().getPendingCount() });
  }
  private advanceDistantCarLightweight(car: Car, dt: number): void {
    const desired = Math.max(0.25, car.desiredSpeed || car.baseSpeed);
    const speed = Math.max(0.25, Math.min(desired, car.currentSpeed || car.targetSpeed || car.baseSpeed));
    car.currentSpeed = speed;
    car.targetSpeed = desired;
    car.status = 'moving';
    car.trafficState = 'moving';
    car.stuckSeconds = Math.max(0, car.stuckSeconds - dt * 2);
    car.immobileSeconds = Math.max(0, car.immobileSeconds - dt * 3);

    car.progressToNext += speed * dt;
    while (car.progressToNext >= 1 && car.routeIndex < car.route.length - 1) {
      const nextPos = car.route[car.routeIndex + 1];
      if (nextPos && isIntersection(this.grid, nextPos)) {
        car.progressToNext = Math.min(0.99, car.progressToNext);
        car.currentSpeed = 0;
        car.targetSpeed = 0;
        car.status = 'stopped';
        car.trafficState = 'intersection';
        break;
      }
      car.progressToNext -= 1;
      car.routeIndex += 1;
      const pos = car.route[car.routeIndex];
      car.currentTileX = pos.x;
      car.currentTileY = pos.y;
      car.x = pos.x;
      car.y = pos.y;
      if (isIntersection(this.grid, pos)) break;
    }

    if (car.routeIndex >= car.route.length - 1) {
      car.lifecyclePhase = 'destinationEntry';
      car.lifecycleProgress = 0;
      car.currentSpeed = Math.min(car.currentSpeed, 0.5);
      car.targetSpeed = 0;
      return;
    }

    const current = car.route[car.routeIndex];
    const next = car.route[car.routeIndex + 1];
    if (!current || !next) return;
    car.x = current.x + (next.x - current.x) * car.progressToNext + car.laneOffset.x;
    car.y = current.y + (next.y - current.y) * car.progressToNext + car.laneOffset.y;
  }

  private isTileInsideActiveViewport(x: number, y: number, paddingTiles = 0): boolean {
    const bounds = this.activeViewportBounds;
    if (!bounds) return true;
    return x >= bounds.minX - paddingTiles
      && x <= bounds.maxX + paddingTiles
      && y >= bounds.minY - paddingTiles
      && y <= bounds.maxY + paddingTiles;
  }

  private carUpdateBucket(car: Car): number {
    let hash = 0;
    for (let index = 0; index < car.id.length; index += 1) {
      hash = ((hash << 5) - hash + car.id.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) % DISTANT_CAR_UPDATE_EVERY_TICKS;
  }

  private hasBusLaneForCar(car: Car, next?: Vec2): boolean {
    if (car.vehicleType !== 'bus') return false;
    const currentTile = this.grid[car.currentTileY]?.[car.currentTileX];
    const nextTile = next ? this.grid[next.y]?.[next.x] : undefined;
    return Boolean(currentTile?.busLane || nextTile?.busLane);
  }

  private getCongestionForCar(car: Car, congestion: number, next?: Vec2): number {
    return this.hasBusLaneForCar(car, next) ? congestion * BUS_LANE_CONFIG.busCongestionResistance : congestion;
  }

  private getBusLaneSpeedMultiplierForCar(car: Car, next?: Vec2): number {
    return this.hasBusLaneForCar(car, next) ? BUS_LANE_CONFIG.busSpeedMultiplier : 1;
  }


  private carUpdatePriority(car: Car): number {
    const insideIntersection = isIntersection(this.grid, { x: car.currentTileX, y: car.currentTileY }) ? 1000 : 0;
    const transition = car.signalTransitionGraceSeconds > 0 ? 300 : 0;
    const wait = Math.max(car.intersectionWaitSeconds, car.stuckSeconds) * 10;
    return insideIntersection + transition + wait;
  }

  private updateImmobileTimer(car: Car, dt: number): void {
    if (car.currentSpeed < 0.08) {
      car.immobileSeconds += dt;
      return;
    }

    if (car.currentSpeed > 0.25) {
      car.immobileSeconds = Math.max(0, car.immobileSeconds - dt * 3);
    }
  }

  private shouldRemoveStuckCar(car: Car): boolean {
    if (car.immobileSeconds >= IMMOBILE_REMOVE_SECONDS) return true;
    return car.immobileSeconds >= IMMOBILE_REROUTE_SECONDS
      && car.repeatedRerouteCount >= REPEATED_REROUTE_REMOVE_COUNT;
  }

  private runStuckWatchdog(car: Car): void {
    if (car.immobileSeconds < IMMOBILE_REROUTE_SECONDS) return;
    if (car.rerouteCooldownSeconds > 0) return;

    if (car.immobileSeconds >= IMMOBILE_ESCAPE_SECONDS) {
      this.clearCarBlockingState(car);
      const escaped = this.tryRerouteCar(car, {
        force: true,
        reason: 'Resgate anti-travamento',
        allowNeighborFallback: true,
      });
      if (!escaped) this.holdCarForRoadRuleReroute(car, 'Aguardando rota válida');
      return;
    }

    this.tryRerouteCar(car, {
      force: true,
      reason: 'Resgate anti-travamento',
      allowNeighborFallback: true,
    });
  }

  private clearCarBlockingState(car: Car): void {
    car.currentSpeed = 0;
    car.targetSpeed = 0;
    car.blockedByCarId = undefined;
    car.intersectionStopKey = undefined;
    car.intersectionWaitSeconds = 0;
    car.waitTimer = 0;
    car.gridlockEscapeSeconds = 0;
    car.insideIntersectionSeconds = 0;
    car.intersectionQueuePosition = undefined;
    car.intersectionQueueLength = undefined;
    car.intersectionReason = undefined;
    car.trafficState = 'queued';
    car.status = 'stopped';
  }

  private isSpawnLaneBlocked(origin: Vec2, laneOffset: Vec2, direction: Car['direction']): boolean {
    const spawnX = origin.x + laneOffset.x;
    const spawnY = origin.y + laneOffset.y;
    const laneAxis = direction === 'east' || direction === 'west' ? 'y' : 'x';

    return this.entityIndex.getCarsNearTile(origin.x, origin.y, 1).some((car) => {
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

  private tryRerouteCar(car: Car, options: RerouteOptions = {}): boolean {
    const destination = this.getBuilding(car.destinationBuildingId)?.nearestRoad;
    if (!destination) return false;

    const start = { x: car.currentTileX, y: car.currentTileY };
    if (!isRoadType(this.grid[start.y]?.[start.x]?.type)) return false;
    if (keyOf(start.x, start.y) === keyOf(destination.x, destination.y)) return false;

    const trafficForReroute = this.buildRerouteTraffic(car);
    if (this.shouldUseAsyncPathfinding(car, options)) {
      this.requestAsyncCarReroute(car, start, destination, trafficForReroute, options);
      return true;
    }
    let newRoute = this.performanceProfiler.time('pathfindingSyncMs', () => findFastestPath(this.grid, trafficForReroute, start, destination));
    if (!isRouteLegal(this.grid, newRoute)) newRoute = [];
    if (newRoute.length < 2 && options.allowNeighborFallback) {
      newRoute = this.findBestFallbackRouteFromLegalNeighbor(start, destination, trafficForReroute);
    }
    if (newRoute.length < 2) return false;

    const oldRemaining = car.route.slice(car.routeIndex);
    const newScore = estimateRouteCost(this.grid, trafficForReroute, newRoute);
    const oldScore = estimateRouteCost(this.grid, trafficForReroute, oldRemaining);
    const differentNext = oldRemaining[1] && newRoute[1]
      ? keyOf(oldRemaining[1].x, oldRemaining[1].y) !== keyOf(newRoute[1].x, newRoute[1].y)
      : true;

    if (!options.force && !differentNext && car.stuckSeconds < REROUTE_FORCE_SECONDS) return false;
    if (!options.force && newScore > oldScore * 0.94 && car.stuckSeconds < REROUTE_FORCE_SECONDS) return false;

    this.applyRouteToCar(car, newRoute, {
      reason: options.reason ?? (newScore < oldScore ? 'Rota alternativa mais livre' : 'Destravamento por espera prolongada'),
      cooldownSeconds: options.cooldownSeconds ?? (options.force ? ROAD_RULE_REROUTE_COOLDOWN_SECONDS : REROUTE_COOLDOWN_SECONDS),
      stopBeforeMoving: options.stopBeforeMoving ?? Boolean(options.force),
    });
    return true;
  }

  private findBestFallbackRouteFromLegalNeighbor(start: Vec2, destination: Vec2, traffic: Map<string, TrafficCell>): Vec2[] {
    let bestRoute: Vec2[] = [];
    let bestCost = Infinity;

    for (const next of getDrivableNeighbors(this.grid, start)) {
      if (!isLegalRoadMove(this.grid, start, next)) continue;
      const routeFromNeighbor = findFastestPath(this.grid, traffic, next, destination);
      if (!routeFromNeighbor.length) continue;
      const candidate = [start, ...routeFromNeighbor];
      if (!isRouteLegal(this.grid, candidate)) continue;
      const cost = estimateRouteCost(this.grid, traffic, candidate);
      if (cost < bestCost) {
        bestCost = cost;
        bestRoute = candidate;
      }
    }

    return bestRoute;
  }

  private applyRouteToCar(
    car: Car,
    route: Vec2[],
    options: { reason: string; cooldownSeconds: number; stopBeforeMoving?: boolean },
  ): void {
    const direction = getDirection(route[0], route[1]);
    const roadType = this.getRoadTypeAt(route[0]);
    const lane = getLaneOffset(direction, roadType, car.id, this.getOneWayAt(route[0], direction));
    const signature = routeSignature(route);
    car.repeatedRerouteCount = car.lastRouteSignature === signature ? car.repeatedRerouteCount + 1 : 0;
    car.lastRouteSignature = signature;

    car.route = route;
    car.routeIndex = 0;
    car.progressToNext = 0;
    car.currentTileX = route[0].x;
    car.currentTileY = route[0].y;
    car.x = route[0].x + lane.offset.x;
    car.y = route[0].y + lane.offset.y;
    car.direction = direction;
    car.laneOffset = lane.offset;
    car.laneIndex = lane.laneIndex;
    car.laneCount = lane.laneCount;
    car.laneSide = lane.laneSide;
    car.desiredSpeed = car.baseSpeed * ROAD_CONFIG[roadType].speed;
    car.targetSpeed = options.stopBeforeMoving ? 0 : car.desiredSpeed;
    car.currentSpeed = options.stopBeforeMoving ? 0 : Math.min(car.currentSpeed, car.desiredSpeed);
    car.estimatedTime = route.length / Math.max(0.1, car.baseSpeed);
    car.rerouteCooldownSeconds = options.cooldownSeconds;
    car.rerouteCount += 1;
    car.lastRerouteReason = options.reason;
    car.stuckSeconds = 0;
    car.intersectionStopKey = undefined;
    car.waitTimer = 0;
    car.intersectionWaitSeconds = 0;
    car.gridlockEscapeSeconds = 0;
    car.insideIntersectionSeconds = 0;
    car.intersectionQueuePosition = undefined;
    car.intersectionQueueLength = undefined;
    car.intersectionReason = undefined;
    car.blockedByCarId = undefined;
    car.trafficState = options.stopBeforeMoving ? 'queued' : 'moving';
    car.status = options.stopBeforeMoving ? 'stopped' : 'moving';
    this.entityIndex.syncCar(car);
  }

  private rerouteCarsAfterRoadRuleChange(changedTiles: Vec2[]): void {
    const changedKeys = new Set(changedTiles.map((pos) => keyOf(pos.x, pos.y)));

    for (const car of this.cars) {
      if (car.lifecyclePhase !== 'driving') continue;

      const current = car.route[car.routeIndex];
      const next = car.route[car.routeIndex + 1];
      const currentKey = keyOf(car.currentTileX, car.currentTileY);
      const isOnChangedTile = changedKeys.has(currentKey);
      const routeTouchesChangedTile = car.route
        .slice(car.routeIndex)
        .some((pos) => changedKeys.has(keyOf(pos.x, pos.y)));
      const nextMoveBecameIllegal = Boolean(current && next && !isLegalRoadMove(this.grid, current, next));

      if (!isOnChangedTile && !routeTouchesChangedTile && !nextMoveBecameIllegal) continue;

      const rerouted = this.tryRerouteCar(car, {
        force: true,
        reason: 'Mão única alterada: rota recalculada',
        allowNeighborFallback: isOnChangedTile || nextMoveBecameIllegal,
        cooldownSeconds: ROAD_RULE_REROUTE_COOLDOWN_SECONDS,
        stopBeforeMoving: false,
      });

      if (!rerouted && nextMoveBecameIllegal) {
        this.holdCarForRoadRuleReroute(car, 'Mão única alterada: aguardando rota válida');
      }
    }
  }

  private holdCarForRoadRuleReroute(car: Car, reason: string): void {
    const current = car.route[car.routeIndex] ?? { x: car.currentTileX, y: car.currentTileY };
    car.currentTileX = current.x;
    car.currentTileY = current.y;
    car.progressToNext = 0;
    car.currentSpeed = 0;
    car.targetSpeed = 0;
    car.status = 'stopped';
    car.trafficState = 'queued';
    if (car.rerouteCooldownSeconds <= 0) {
      car.rerouteCooldownSeconds = ROAD_RULE_REROUTE_COOLDOWN_SECONDS;
    }
    car.stuckSeconds = Math.max(car.stuckSeconds, 0.5);
    car.waitTimer = 0;
    car.intersectionWaitSeconds = 0;
    car.gridlockEscapeSeconds = 0;
    car.blockedByCarId = undefined;
    car.intersectionStopKey = undefined;
    car.intersectionReason = undefined;
    car.lastRerouteReason = reason;
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

      this.applyRouteToCar(car, newRoute, {
        reason: 'Via alterada: rota recalculada',
        cooldownSeconds: REROUTE_COOLDOWN_SECONDS,
        stopBeforeMoving: true,
      });
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


  private trySpawnEastDistrictBuilding(): Building | null {
    const district = this.getEastDistrict();
    if (!district || district.status !== 'owned') return null;
    if (Math.random() > DISTRICT_EXPANSION_CONFIG.eastGrowthChance) return null;

    const candidates: Vec2[] = [];
    const minX = Math.max(district.xStart + 1, 1);
    const maxX = Math.min(district.xStart + district.width - 2, (this.grid[0]?.length ?? 1) - 2);
    const minY = Math.max(district.yStart + 1, 1);
    const maxY = Math.min(district.yStart + district.height - 2, this.grid.length - 2);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (this.grid[y]?.[x]?.type !== 'empty') continue;
        if (this.isTooCloseToBuilding({ x, y })) continue;
        if (!this.hasRoadNearby({ x, y }, DISTRICT_EXPANSION_CONFIG.eastGrowthRoadRadius)) continue;
        candidates.push({ x, y });
      }
    }

    if (!candidates.length) return null;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    return createBuilding(this.generator.chooseType(this.cityLevel), chosen.x, chosen.y);
  }

  private isTooCloseToBuilding(pos: Vec2): boolean {
    return this.buildings.some((building) => Math.abs(building.x - pos.x) + Math.abs(building.y - pos.y) < 2);
  }

  private hasRoadNearby(pos: Vec2, radius: number): boolean {
    for (let y = pos.y - radius; y <= pos.y + radius; y += 1) {
      for (let x = pos.x - radius; x <= pos.x + radius; x += 1) {
        if (Math.abs(pos.x - x) + Math.abs(pos.y - y) > radius) continue;
        if (isRoadType(this.grid[y]?.[x]?.type)) return true;
      }
    }
    return false;
  }

  private growCity(): void {
    const stats = this.getSnapshot();
    if (stats.population > 120) this.cityLevel = Math.max(this.cityLevel, 2);
    if (stats.population > 280) this.cityLevel = Math.max(this.cityLevel, 3);
    if (this.satisfaction < 35) return;
    const building = this.trySpawnEastDistrictBuilding() ?? this.generator.spawn(this.grid, this.buildings, this.cityLevel);
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
    this.entityIndex.rebuildBuildings(this.buildings);
    this.refreshSelectedBuilding();
  }

  private updateBuildingConstruction(dt: number): void {
    let completedAny = false;
    for (const building of this.buildings) {
      if (isBuildingOperational(building)) continue;
      const duration = BUILDING_CONSTRUCTION_SECONDS[building.type];
      const nextProgress = Math.max(0, building.constructionProgress ?? 0) + dt / duration;
      const progress = nextProgress >= 1 - 1e-9 ? 1 : Math.min(1, nextProgress);
      building.constructionProgress = progress;
      if (progress < 1) continue;

      const config = getBuildingLevelConfig(building.type, building.level);
      building.constructionState = 'operational';
      building.constructionProgress = 1;
      building.population = config.population;
      building.jobs = config.jobs;
      building.attraction = config.attraction;
      completedAny = true;
    }

    if (!completedAny) return;
    this.entityIndex.rebuildBuildings(this.buildings);
    this.snapshotCache = undefined;
    this.markStaticRenderDirty();
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
    this.entityIndex.rebuildBuildings(this.buildings);
    this.markStaticRenderDirty();
    this.refreshSelectedBuilding();
  }

  getBuildingUpgradeStatus(building: Building): { canUpgrade: boolean; reason: string; nextLevel: BuildingLevel | null; score: number } {
    const nextLevel = this.nextAllowedBuildingLevel(building);
    const score = this.getBuildingUpgradeScore(building);
    if (!isBuildingOperational(building)) return { canUpgrade: false, reason: 'Aguardando conclusão da obra', nextLevel, score: 0 };
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

  getHelipad(id: string | undefined): Helipad | undefined {
    return id ? this.helipads.find((helipad) => helipad.id === id) : undefined;
  }

  getHelipadAt(x: number, y: number): Helipad | undefined {
    return this.helipads.find((helipad) => helipad.x === x && helipad.y === y);
  }

  getHelicopter(id: string | undefined): Helicopter | undefined {
    return id ? this.helicopters.find((helicopter) => helicopter.id === id) : undefined;
  }

  inspectHelipad(id: string): void {
    const helipad = this.getHelipad(id);
    if (helipad) this.selected = { kind: 'helipad', helipad };
    this.emit();
  }

  inspectHelicopterLine(id: string): void {
    const line = this.helicopterLines.find((candidate) => candidate.id === id);
    if (line) this.selected = { kind: 'helicopterLine', line };
    this.emit();
  }

  inspectHelicopter(id: string): void {
    const helicopter = this.getHelicopter(id);
    this.selected = helicopter ? { kind: 'helicopter', helicopterId: id, helicopter } : { kind: 'none' };
    this.emit();
  }

  buildHelipadAt(x: number, y: number): boolean {
    if (!inBounds(x, y)) return false;
    const accessRoad = this.findHelipadAccessRoad({ x, y });
    if (this.grid[y]?.[x]?.type !== 'empty' || !accessRoad || this.money < HELICOPTER_CONFIG.helipadBuildCost) return false;
    const helipad: Helipad = {
      id: nanoid(8),
      name: `Heliponto ${this.helipads.length + 1}`,
      x, y, accessRoad,
      coverageRadius: HELICOPTER_CONFIG.coverageRadius,
      capacity: HELICOPTER_CONFIG.waitingCapacity,
      waiting: [],
      totalBoarded: 0,
      totalAlighted: 0,
      peakWaitingPassengers: 0,
      carsAvoidedFromHelipad: 0,
      activeLineIds: [],
      createdAtDay: this.time.getDay(),
    };
    this.helipads.push(helipad);
    this.grid[y][x] = { x, y, type: 'helipad', helipadId: helipad.id };
    this.money -= HELICOPTER_CONFIG.helipadBuildCost;
    this.selected = { kind: 'helipad', helipad };
    this.markStaticRenderDirty();
    this.emit();
    return true;
  }

  createHelicopterLine(fromId: string, toId: string): { success: boolean; name?: string; cost?: number; reason?: string } {
    const from = this.getHelipad(fromId);
    const to = this.getHelipad(toId);
    if (!from || !to) return { success: false, reason: 'Selecione dois helipontos válidos.' };
    if (from.id === to.id) return { success: false, reason: 'A linha precisa ligar dois helipontos diferentes.' };
    if (manhattan(from, to) < HELICOPTER_CONFIG.minLineDistance) return { success: false, reason: `Distância mínima: ${HELICOPTER_CONFIG.minLineDistance} tiles.` };
    if (from.activeLineIds.length >= HELICOPTER_CONFIG.maxLinesPerHelipad || to.activeLineIds.length >= HELICOPTER_CONFIG.maxLinesPerHelipad) {
      return { success: false, reason: `Cada heliponto aceita no máximo ${HELICOPTER_CONFIG.maxLinesPerHelipad} linhas.` };
    }
    if (this.helicopterLines.some((line) => line.active && line.helipadIds.includes(from.id) && line.helipadIds.includes(to.id))) {
      return { success: false, reason: 'Já existe uma linha entre esses helipontos.' };
    }
    if (this.money < HELICOPTER_CONFIG.lineActivationCost) return { success: false, cost: HELICOPTER_CONFIG.lineActivationCost, reason: `Faltam $ ${HELICOPTER_CONFIG.lineActivationCost - this.money}.` };
    const line: HelicopterLine = {
      id: nanoid(8),
      name: `Linha Aérea ${this.helicopterLines.length + 1}`,
      color: pickHelicopterLineColor(this.helicopterLines.length),
      helipadIds: [from.id, to.id],
      active: true,
      helicopterCount: 1,
      totalPassengers: 0,
      currentPassengers: 0,
      waitingPassengers: 0,
      carsAvoided: 0,
      completedCycles: 0,
    };
    this.helicopterLines.push(line);
    from.activeLineIds.push(line.id);
    to.activeLineIds.push(line.id);
    this.spawnHelicopter(line, 0, 1);
    this.money -= HELICOPTER_CONFIG.lineActivationCost;
    this.selected = { kind: 'helicopterLine', line };
    this.refreshHelicopterLineMetrics(line.id);
    this.markStaticRenderDirty();
    this.emit();
    return { success: true, name: line.name, cost: HELICOPTER_CONFIG.lineActivationCost };
  }

  setHelicopterCount(lineId: string, requested: number): { success: boolean; count: number; cost?: number; reason?: string } {
    const line = this.helicopterLines.find((candidate) => candidate.id === lineId);
    if (!line) return { success: false, count: 0, reason: 'Linha aérea não encontrada.' };
    const count = Math.max(1, Math.min(HELICOPTER_CONFIG.maxHelicoptersPerLine, Math.round(requested)));
    const currentFleet = this.helicopters.filter((helicopter) => helicopter.lineId === lineId);
    if (count === currentFleet.length) return { success: true, count };
    if (count > currentFleet.length) {
      const cost = (count - currentFleet.length) * HELICOPTER_CONFIG.helicopterPurchaseCost;
      if (this.money < cost) return { success: false, count: currentFleet.length, cost, reason: `Faltam $ ${cost - this.money}.` };
      this.money -= cost;
      for (let index = currentFleet.length; index < count; index += 1) this.spawnHelicopter(line, index, count);
      this.redistributeHelicopters(lineId);
      this.refreshHelicopterLineMetrics(lineId);
      this.emit();
      return { success: true, count, cost };
    }
    const removable = [...currentFleet]
      .sort((a, b) => helicopterPassengerCount(a.passengers) - helicopterPassengerCount(b.passengers))
      .slice(0, currentFleet.length - count);
    for (const helicopter of removable) this.returnHelicopterPassengersToQueue(helicopter);
    const removeIds = new Set(removable.map((helicopter) => helicopter.id));
    this.helicopters = this.helicopters.filter((helicopter) => !removeIds.has(helicopter.id));
    this.redistributeHelicopters(lineId);
    this.refreshHelicopterLineMetrics(lineId);
    this.emit();
    return { success: true, count };
  }

  deleteHelicopterLine(lineId: string): boolean {
    const line = this.helicopterLines.find((candidate) => candidate.id === lineId);
    if (!line) return false;
    for (const helicopter of this.helicopters.filter((candidate) => candidate.lineId === lineId)) this.returnHelicopterPassengersToQueue(helicopter);
    let stranded = 0;
    for (const helipad of this.helipads) {
      const before = helicopterWaitingCount(helipad.waiting);
      helipad.waiting = helipad.waiting.filter((group) => !line.helipadIds.includes(group.destinationHelipadId));
      stranded += before - helicopterWaitingCount(helipad.waiting);
    }
    if (stranded > 0) {
      this.failedTrips += stranded;
      this.failedTripPressure += stranded;
    }
    this.helicopters = this.helicopters.filter((helicopter) => helicopter.lineId !== lineId);
    this.helicopterLines = this.helicopterLines.filter((candidate) => candidate.id !== lineId);
    for (const helipad of this.helipads) helipad.activeLineIds = helipad.activeLineIds.filter((id) => id !== lineId);
    if (this.selected.kind === 'helicopterLine' && this.selected.line.id === lineId) this.selected = { kind: 'none' };
    this.markStaticRenderDirty();
    this.emit();
    return true;
  }

  removeHelipad(id: string): boolean {
    const helipad = this.getHelipad(id);
    if (!helipad || this.money < HELICOPTER_CONFIG.helipadRemoveCost) return false;
    for (const lineId of [...helipad.activeLineIds]) this.deleteHelicopterLine(lineId);
    this.helipads = this.helipads.filter((candidate) => candidate.id !== id);
    this.grid[helipad.y][helipad.x] = { x: helipad.x, y: helipad.y, type: 'empty' };
    this.money -= HELICOPTER_CONFIG.helipadRemoveCost;
    if (this.selected.kind === 'helipad' && this.selected.helipad.id === id) this.selected = { kind: 'tile', x: helipad.x, y: helipad.y, type: 'empty' };
    this.markStaticRenderDirty();
    this.emit();
    return true;
  }

  getHelicopterLineStats(lineId: string): HelicopterLineStats | undefined {
    const line = this.helicopterLines.find((candidate) => candidate.id === lineId);
    if (!line) return undefined;
    return {
      id: line.id, name: line.name, active: line.active,
      helicopters: this.helicopters.filter((helicopter) => helicopter.lineId === lineId).length,
      waitingPassengers: line.waitingPassengers,
      currentPassengers: line.currentPassengers,
      totalPassengers: line.totalPassengers,
      carsAvoided: line.carsAvoided,
      completedCycles: line.completedCycles,
      helipadIds: line.helipadIds,
    };
  }

  private findHelipadAccessRoad(pos: Vec2): Vec2 | undefined {
    return [{ x: pos.x + 1, y: pos.y }, { x: pos.x - 1, y: pos.y }, { x: pos.x, y: pos.y + 1 }, { x: pos.x, y: pos.y - 1 }]
      .filter((candidate) => inBounds(candidate.x, candidate.y))
      .filter((candidate) => this.grid[candidate.y]?.[candidate.x]?.type === 'road' || this.grid[candidate.y]?.[candidate.x]?.type === 'avenue')
      .sort((a, b) => Number(this.grid[a.y][a.x].type !== 'avenue') - Number(this.grid[b.y][b.x].type !== 'avenue'))[0];
  }

  private tryCreateHelicopterTrip(origin: Building, destination: Building): boolean {
    const eligibleResident = (origin.type === 'house' && origin.level === 3) || (destination.type === 'house' && destination.level === 3);
    if (!eligibleResident || !origin.connected || !destination.connected || Math.random() > HELICOPTER_CONFIG.tripPreference) return false;
    const candidates = this.helicopterLines.flatMap((line) => {
      if (!line.active) return [];
      const a = this.getHelipad(line.helipadIds[0]);
      const b = this.getHelipad(line.helipadIds[1]);
      if (!a || !b) return [];
      if (manhattan(origin, a) <= a.coverageRadius && manhattan(destination, b) <= b.coverageRadius) return [{ line, from: a, to: b }];
      if (manhattan(origin, b) <= b.coverageRadius && manhattan(destination, a) <= a.coverageRadius) return [{ line, from: b, to: a }];
      return [];
    }).sort((a, b) => helicopterWaitingCount(a.from.waiting) - helicopterWaitingCount(b.from.waiting));
    const candidate = candidates[0];
    if (!candidate || helicopterWaitingCount(candidate.from.waiting) >= candidate.from.capacity) return false;
    addHelicopterPassenger(candidate.from.waiting, candidate.to.id, 1);
    candidate.from.peakWaitingPassengers = Math.max(candidate.from.peakWaitingPassengers, helicopterWaitingCount(candidate.from.waiting));
    candidate.line.totalPassengers += 1;
    this.refreshHelicopterLineMetrics(candidate.line.id);
    return true;
  }

  private spawnHelicopter(line: HelicopterLine, index: number, count: number): void {
    const reverse = index % 2 === 1;
    const progress = count <= 1 ? 0 : index / count;
    this.helicopters.push({
      id: nanoid(8), lineId: line.id,
      fromHelipadId: reverse ? line.helipadIds[1] : line.helipadIds[0],
      toHelipadId: reverse ? line.helipadIds[0] : line.helipadIds[1],
      progress, speed: HELICOPTER_CONFIG.speedTilesPerSecond,
      capacity: HELICOPTER_CONFIG.passengerCapacity,
      passengers: [], state: progress > 0 ? 'flying' : 'dwelling',
      stateProgress: progress > 0 ? 1 : 0,
      dwellSeconds: progress > 0 ? 0 : HELICOPTER_CONFIG.dwellSeconds,
    });
  }

  private redistributeHelicopters(lineId: string): void {
    const fleet = this.helicopters.filter((helicopter) => helicopter.lineId === lineId);
    fleet.forEach((helicopter, index) => {
      if (helicopterPassengerCount(helicopter.passengers)) return;
      helicopter.progress = index / Math.max(1, fleet.length);
      helicopter.state = helicopter.progress ? 'flying' : 'dwelling';
      helicopter.stateProgress = helicopter.progress ? 1 : 0;
    });
  }

  private updateHelicopters(dt: number): void {
    for (const helicopter of this.helicopters) {
      const from = this.getHelipad(helicopter.fromHelipadId);
      const to = this.getHelipad(helicopter.toHelipadId);
      if (!from || !to) continue;
      if (helicopter.state === 'dwelling') {
        helicopter.dwellSeconds = Math.max(0, helicopter.dwellSeconds - dt);
        if (!helicopter.dwellSeconds) {
          this.boardHelicopterAtCurrentPad(helicopter);
          helicopter.state = 'takingOff';
          helicopter.stateProgress = 0;
        }
      } else if (helicopter.state === 'takingOff') {
        helicopter.stateProgress = Math.min(1, helicopter.stateProgress + dt / 0.8);
        if (helicopter.stateProgress >= 1) { helicopter.state = 'flying'; helicopter.progress = 0; }
      } else if (helicopter.state === 'flying') {
        helicopter.progress = Math.min(1, helicopter.progress + (helicopter.speed / Math.max(1, Math.hypot(to.x - from.x, to.y - from.y))) * dt);
        if (helicopter.progress >= 1) { helicopter.state = 'landing'; helicopter.stateProgress = 0; }
      } else {
        helicopter.stateProgress = Math.min(1, helicopter.stateProgress + dt / 0.8);
        if (helicopter.stateProgress >= 1) this.processHelicopterStop(helicopter);
      }
    }
  }

  private processHelicopterStop(helicopter: Helicopter): void {
    const arrived = this.getHelipad(helicopter.toHelipadId);
    const departed = this.getHelipad(helicopter.fromHelipadId);
    const line = this.helicopterLines.find((candidate) => candidate.id === helicopter.lineId);
    if (!arrived || !departed || !line) return;
    const alighting = removeHelicopterPassengers(helicopter.passengers, arrived.id);
    arrived.totalAlighted += alighting;
    arrived.carsAvoidedFromHelipad += alighting;
    line.carsAvoided += alighting;
    this.helicopterTripsCompleted += alighting;
    this.helicopterCarsAvoided += alighting;
    this.carTripsAvoided += alighting;
    this.completedTrips += alighting;
    for (let index = 0; index < alighting; index += 1) this.tripHistory.push(Math.max(2, manhattan(departed, arrived) / HELICOPTER_CONFIG.speedTilesPerSecond));
    if (this.tripHistory.length > TRAVEL_TIME_HISTORY_LIMIT) this.tripHistory.splice(0, this.tripHistory.length - TRAVEL_TIME_HISTORY_LIMIT);
    const freeSeats = Math.max(0, helicopter.capacity - helicopterPassengerCount(helicopter.passengers));
    const boarding = takeHelicopterPassengers(arrived.waiting, departed.id, freeSeats);
    if (boarding) addHelicopterPassenger(helicopter.passengers, departed.id, boarding);
    arrived.totalBoarded += boarding;
    [helicopter.fromHelipadId, helicopter.toHelipadId] = [helicopter.toHelipadId, helicopter.fromHelipadId];
    helicopter.progress = 0;
    helicopter.state = 'dwelling';
    helicopter.stateProgress = 0;
    helicopter.dwellSeconds = HELICOPTER_CONFIG.dwellSeconds;
    if (helicopter.fromHelipadId === line.helipadIds[0]) line.completedCycles += 1;
    this.refreshHelicopterLineMetrics(line.id);
  }

  private boardHelicopterAtCurrentPad(helicopter: Helicopter): void {
    const current = this.getHelipad(helicopter.fromHelipadId);
    if (!current) return;
    const freeSeats = Math.max(0, helicopter.capacity - helicopterPassengerCount(helicopter.passengers));
    const boarding = takeHelicopterPassengers(current.waiting, helicopter.toHelipadId, freeSeats);
    if (boarding) addHelicopterPassenger(helicopter.passengers, helicopter.toHelipadId, boarding);
    current.totalBoarded += boarding;
    this.refreshHelicopterLineMetrics(helicopter.lineId);
  }

  private refreshHelicopterLineMetrics(lineId: string): void {
    const line = this.helicopterLines.find((candidate) => candidate.id === lineId);
    if (!line) return;
    const fleet = this.helicopters.filter((helicopter) => helicopter.lineId === lineId);
    line.helicopterCount = fleet.length;
    line.currentPassengers = fleet.reduce((sum, helicopter) => sum + helicopterPassengerCount(helicopter.passengers), 0);
    line.waitingPassengers = line.helipadIds.reduce((sum, id) => sum + helicopterWaitingCount(this.getHelipad(id)?.waiting ?? []), 0);
  }

  private returnHelicopterPassengersToQueue(helicopter: Helicopter): void {
    const from = this.getHelipad(helicopter.fromHelipadId);
    if (from) for (const group of helicopter.passengers) addHelicopterPassenger(from.waiting, group.destinationHelipadId, group.count);
    helicopter.passengers = [];
  }

  private getHelicopterWaitingPassengerCount(): number {
    return this.helipads.reduce((sum, helipad) => sum + helicopterWaitingCount(helipad.waiting), 0);
  }

  private getHelicopterPassengerCount(): number {
    return this.helicopters.reduce((sum, helicopter) => sum + helicopterPassengerCount(helicopter.passengers), 0);
  }


  getMetroStation(id: string | undefined): MetroStation | undefined {
    if (!id) return undefined;
    return this.metroStations.find((station) => station.id === id);
  }

  getMetroStationAt(x: number, y: number): MetroStation | undefined {
    return this.metroStations.find((station) => station.x === x && station.y === y);
  }

  getMetroLinesForStation(stationId: string): MetroLine[] {
    return this.metroLines.filter((line) => line.active && line.stationIds.includes(stationId));
  }

  inspectMetroStation(stationId: string): void {
    const station = this.getMetroStation(stationId);
    if (station) this.selected = { kind: 'metroStation', station };
    this.emit();
  }

  inspectMetroLine(lineId: string): void {
    const line = this.metroLines.find((candidate) => candidate.id === lineId);
    if (line) this.selected = { kind: 'metroLine', line };
    this.emit();
  }

  inspectMetroTrain(trainId: string): void {
    const train = this.metroTrains.find((candidate) => candidate.id === trainId);
    this.selected = train ? { kind: 'metroTrain', trainId, train } : { kind: 'none' };
    this.emit();
  }

  buildMetroStationAt(x: number, y: number): boolean {
    if (!inBounds(x, y)) return false;
    const tile = this.grid[y]?.[x];
    if (!tile || tile.type !== 'empty') return false;
    if (this.getMetroStationAt(x, y)) return false;
    if (this.money < METRO_CONFIG.stationBuildCost) return false;

    const station: MetroStation = {
      id: nanoid(8),
      name: `Estação ${this.metroStations.length + 1}`,
      x,
      y,
      coverageRadius: METRO_CONFIG.stationCoverageRadius,
      capacity: METRO_CONFIG.stationCapacity,
      waitingPassengers: 0,
      totalBoarded: 0,
      totalAlighted: 0,
      totalPassengersHandled: 0,
      activeLineIds: [],
      peakWaitingPassengers: 0,
      carsAvoidedFromStation: 0,
      createdAtDay: this.time.getDay(),
    };

    this.metroStations.push(station);
    this.grid[y][x] = { x, y, type: 'metroStation', metroStationId: station.id };
    this.money -= METRO_CONFIG.stationBuildCost;
    this.selected = { kind: 'metroStation', station };
    this.markStaticRenderDirty();
    this.emit();
    return true;
  }

  buildMetroTrack(fromStationId: string, toStationId: string): { success: boolean; cost?: number; reason?: string } {
    const from = this.getMetroStation(fromStationId);
    const to = this.getMetroStation(toStationId);
    if (!from || !to) return { success: false, reason: 'Selecione duas estações válidas.' };
    if (from.id === to.id) return { success: false, reason: 'O trilho precisa ligar duas estações diferentes.' };
    if (this.hasMetroTrackBetween(from.id, to.id)) return { success: false, reason: 'Essas estações já estão conectadas.' };

    const tiles = buildMetroTrackTiles(from, to);
    const distance = Math.max(1, tiles.length - 1);
    const cost = distance * METRO_CONFIG.trackCostPerTile;
    if (this.money < cost) return { success: false, cost, reason: `Faltam $ ${cost - this.money} para construir o trilho.` };

    this.metroTracks.push({
      id: nanoid(8),
      fromStationId: from.id,
      toStationId: to.id,
      tiles,
      distance,
      active: true,
    });

    this.money -= cost;
    this.markStaticRenderDirty();
    this.emit();
    return { success: true, cost };
  }

  hasMetroTrackBetween(fromStationId: string, toStationId: string): boolean {
    return this.metroTracks.some((track) => track.active && (
      (track.fromStationId === fromStationId && track.toStationId === toStationId)
      || (track.fromStationId === toStationId && track.toStationId === fromStationId)
    ));
  }

  getMetroTrackBetween(fromStationId: string, toStationId: string): MetroTrack | undefined {
    return this.metroTracks.find((track) => track.active && (
      (track.fromStationId === fromStationId && track.toStationId === toStationId)
      || (track.fromStationId === toStationId && track.toStationId === fromStationId)
    ));
  }

  getMetroTrackTilesBetween(fromStationId: string, toStationId: string): Vec2[] {
    const track = this.getMetroTrackBetween(fromStationId, toStationId);
    if (!track) return [];
    return track.fromStationId === fromStationId ? track.tiles : [...track.tiles].reverse();
  }

  findMetroRoute(fromStationId: string, toStationId: string): string[] {
    return findMetroStationPath(this.metroStations, this.metroTracks, fromStationId, toStationId);
  }

  createMetroLine(stationIds: string[]): { success: boolean; name?: string; cost?: number; reason?: string } {
    const uniqueStationIds = dedupeIds(stationIds);
    if (uniqueStationIds.length < METRO_CONFIG.minStationsForLine) {
      return { success: false, reason: 'A linha precisa ter ao menos duas estações.' };
    }

    for (let i = 0; i < uniqueStationIds.length - 1; i += 1) {
      if (!this.hasMetroTrackBetween(uniqueStationIds[i], uniqueStationIds[i + 1])) {
        return { success: false, reason: 'Todas as estações consecutivas precisam estar conectadas por trilhos.' };
      }
    }

    if (this.money < METRO_CONFIG.lineActivationCost) {
      return {
        success: false,
        cost: METRO_CONFIG.lineActivationCost,
        reason: `Faltam $ ${METRO_CONFIG.lineActivationCost - this.money} para ativar a linha.`,
      };
    }

    const line: MetroLine = {
      id: nanoid(8),
      name: `Linha ${this.metroLines.length + 1}`,
      color: pickMetroLineColor(this.metroLines.length),
      stationIds: uniqueStationIds,
      active: true,
      frequencySeconds: 18,
      trainCapacity: METRO_CONFIG.trainCapacity,
      totalPassengers: 0,
      currentPassengers: 0,
      waitingPassengers: 0,
      carsAvoided: 0,
      trainsActive: 0,
      completedCycles: 0,
    };

    this.metroLines.push(line);

    for (const stationId of uniqueStationIds) {
      const station = this.getMetroStation(stationId);
      if (!station) continue;
      station.activeLineIds ??= [];
      if (!station.activeLineIds.includes(line.id)) station.activeLineIds.push(line.id);
    }

    this.spawnMetroTrain(line.id);
    line.trainsActive = this.metroTrains.filter((train) => train.lineId === line.id).length;
    line.currentPassengers = this.metroTrains
      .filter((train) => train.lineId === line.id)
      .reduce((sum, train) => sum + train.passengers, 0);
    line.waitingPassengers = uniqueStationIds
      .map((stationId) => this.getMetroStation(stationId))
      .filter((station): station is MetroStation => Boolean(station))
      .reduce((sum, station) => sum + station.waitingPassengers, 0);

    this.money -= METRO_CONFIG.lineActivationCost;
    this.selected = { kind: 'metroLine', line };
    this.markStaticRenderDirty();
    this.emit();

    return { success: true, name: line.name, cost: METRO_CONFIG.lineActivationCost };
  }

  private spawnMetroTrain(lineId: string): void {
    const line = this.metroLines.find((candidate) => candidate.id === lineId);
    if (!line || line.stationIds.length < 2) return;
    this.metroTrains.push({
      id: nanoid(8),
      lineId,
      stationIndex: 0,
      nextStationIndex: 1,
      progress: 0,
      speed: METRO_CONFIG.trainSpeedTilesPerSecond,
      passengers: 0,
      capacity: line.trainCapacity,
      direction: 1,
      dwellSeconds: 0,
    });
  }

  private updateMetro(dt: number): void {
    for (const train of this.metroTrains) {
      const line = this.metroLines.find((candidate) => candidate.id === train.lineId);
      if (!line || !line.active || line.stationIds.length < 2) continue;

      if ((train.dwellSeconds ?? 0) > 0) {
        train.dwellSeconds = Math.max(0, (train.dwellSeconds ?? 0) - dt);
        continue;
      }

      const from = this.getMetroStation(line.stationIds[train.stationIndex]);
      const to = this.getMetroStation(line.stationIds[train.nextStationIndex]);
      if (!from || !to) continue;

      const trackTiles = this.getMetroTrackTilesBetween(from.id, to.id);
      const distance = Math.max(1, (trackTiles.length || manhattan(from, to) + 1) - 1);
      train.progress += (train.speed / distance) * dt;

      if (train.progress < 1) continue;
      train.progress = 0;
      train.stationIndex = train.nextStationIndex;
      train.nextStationIndex += train.direction;

      if (train.nextStationIndex >= line.stationIds.length) {
        train.direction = -1;
        train.nextStationIndex = Math.max(0, line.stationIds.length - 2);
      }

      if (train.nextStationIndex < 0) {
        train.direction = 1;
        train.nextStationIndex = Math.min(1, line.stationIds.length - 1);
      }

      this.processMetroStationStop(train, line);
    }
  }

  private processMetroStationStop(train: MetroTrain, line: MetroLine): void {
    const station = this.getMetroStation(line.stationIds[train.stationIndex]);
    if (!station) return;

    const alighting = Math.min(train.passengers, Math.ceil(train.passengers * 0.35));
    train.passengers -= alighting;
    station.totalAlighted += alighting;
    station.totalPassengersHandled += alighting;

    const freeSeats = Math.max(0, train.capacity - train.passengers);
    const boarding = Math.min(freeSeats, station.waitingPassengers);
    station.waitingPassengers -= boarding;
    station.totalBoarded += boarding;
    station.totalPassengersHandled += boarding;
    train.passengers += boarding;
    train.dwellSeconds = METRO_CONFIG.trainDwellSeconds;

    if (train.direction < 0 && train.stationIndex === 0) line.completedCycles += 1;
    if (train.direction > 0 && train.stationIndex === line.stationIds.length - 1) line.completedCycles += 1;
    this.refreshMetroLineMetrics(line.id);
  }

  private tryCreateMetroTrip(origin: Building, destination: Building): boolean {
    if (!this.metroLines.some((line) => line.active)) return false;
    if (Math.random() > METRO_CONFIG.metroTripPreference) return false;

    const originStation = this.findNearestMetroStation(origin);
    const destinationStation = this.findNearestMetroStation(destination);
    if (!originStation || !destinationStation) return false;
    if (originStation.id === destinationStation.id) return false;

    const route = this.findMetroRoute(originStation.id, destinationStation.id);
    if (route.length < 2) return false;
    const activeLine = this.findBestMetroLineForRoute(route);
    if (!activeLine) return false;
    if (originStation.waitingPassengers >= originStation.capacity) return false;

    originStation.waitingPassengers += 1;
    originStation.carsAvoidedFromStation += 1;
    originStation.totalPassengersHandled += 1;
    originStation.peakWaitingPassengers = Math.max(originStation.peakWaitingPassengers, originStation.waitingPassengers);

    activeLine.carsAvoided += 1;
    activeLine.waitingPassengers += 1;
    activeLine.totalPassengers += 1;
    this.metroTripsCompleted += 1;
    this.secondsSinceMetroTrip = 0;
    this.metroCarsAvoided += 1;
    this.carTripsAvoided += 1;
    this.completedTrips += 1;
    this.tripHistory.push(Math.max(2, route.length * 1.2));
    if (this.tripHistory.length > TRAVEL_TIME_HISTORY_LIMIT) this.tripHistory.shift();
    this.averageTravelTime = this.tripHistory.length ? this.tripHistory.reduce((a, b) => a + b, 0) / this.tripHistory.length : 0;
    this.refreshMetroLineMetrics(activeLine.id);
    return true;
  }


  getMetroLineStats(lineId: string): MetroLineStats | undefined {
    const line = this.metroLines.find((candidate) => candidate.id === lineId);
    if (!line) return undefined;
    const stations = line.stationIds.map((id) => this.getMetroStation(id)).filter((station): station is MetroStation => Boolean(station));
    const trains = this.metroTrains.filter((train) => train.lineId === lineId);
    return {
      id: line.id,
      name: line.name,
      color: line.color,
      active: line.active,
      stations: stations.length,
      trains: trains.length,
      waitingPassengers: stations.reduce((sum, station) => sum + station.waitingPassengers, 0),
      currentPassengers: trains.reduce((sum, train) => sum + train.passengers, 0),
      totalPassengers: line.totalPassengers,
      carsAvoided: line.carsAvoided,
      completedCycles: line.completedCycles,
      stationIds: line.stationIds,
    };
  }

  deleteMetroLine(lineId: string): boolean {
    const exists = this.metroLines.some((line) => line.id === lineId);
    if (!exists) return false;
    this.metroLines = this.metroLines.filter((line) => line.id !== lineId);
    this.metroTrains = this.metroTrains.filter((train) => train.lineId !== lineId);
    for (const station of this.metroStations) {
      station.activeLineIds = station.activeLineIds.filter((id) => id !== lineId);
    }
    if (this.selected.kind === 'metroLine' && this.selected.line.id === lineId) this.selected = { kind: 'none' };
    this.markStaticRenderDirty();
    this.emit();
    return true;
  }

  private getMetroWaitingPassengerCount(): number {
    return this.metroStations.reduce((sum, station) => sum + station.waitingPassengers, 0);
  }

  private findBestMetroLineForRoute(route: string[]): MetroLine | undefined {
    return this.metroLines.find((line) => line.active && route.every((stationId) => line.stationIds.includes(stationId)));
  }

  private refreshMetroLineMetrics(lineId: string): void {
    const line = this.metroLines.find((candidate) => candidate.id === lineId);
    if (!line) return;
    const trains = this.metroTrains.filter((train) => train.lineId === lineId);
    const stations = line.stationIds.map((id) => this.getMetroStation(id)).filter((station): station is MetroStation => Boolean(station));
    line.trainsActive = trains.length;
    line.currentPassengers = trains.reduce((sum, train) => sum + train.passengers, 0);
    line.waitingPassengers = stations.reduce((sum, station) => sum + station.waitingPassengers, 0);
  }

  private findNearestMetroStation(pos: Vec2): MetroStation | undefined {
    return this.metroStations
      .map((station) => ({ station, distance: manhattan(pos, station) }))
      .filter((candidate) => candidate.distance <= candidate.station.coverageRadius)
      .sort((a, b) => a.distance - b.distance)[0]?.station;
  }

  private removeMetroStationAt(stationId: string): boolean {
    const station = this.getMetroStation(stationId);
    if (!station) return false;

    const affectedLineIds = new Set(
      this.metroLines
        .filter((line) => line.stationIds.includes(stationId))
        .map((line) => line.id),
    );

    this.metroStations = this.metroStations.filter((candidate) => candidate.id !== stationId);
    this.metroTracks = this.metroTracks.filter((track) => track.fromStationId !== stationId && track.toStationId !== stationId);
    this.metroLines = this.metroLines.filter((line) => !affectedLineIds.has(line.id));
    this.metroTrains = this.metroTrains.filter((train) => !affectedLineIds.has(train.lineId));

    if (this.grid[station.y]?.[station.x]?.type === 'metroStation') {
      this.grid[station.y][station.x] = { x: station.x, y: station.y, type: 'empty' };
    }

    if (this.selected.kind === 'metroStation' && this.selected.station.id === stationId) {
      this.selected = { kind: 'tile', x: station.x, y: station.y, type: 'empty' };
    }

    this.markStaticRenderDirty();
    return true;
  }

  private updateEconomyAndSatisfaction(): void {
    const connectedShops = this.buildings.filter((b) => isBuildingOperational(b) && b.type === 'shop' && b.connected).length;
    const connectedOffices = this.buildings.filter((b) => isBuildingOperational(b) && b.type === 'office' && b.connected).length;
    const recentTrips = this.tripHistory.slice(-20).length;
    this.money += recentTrips * 1.5 + connectedShops * 4 + connectedOffices * 6;

    const snapshot = this.getSnapshot();

    // Regra V1 balanceada:
    // - Mantém prédios desconectados como problema importante, mas menos punitivo.
    // - Cria tolerância para congestionamento comum de cidade média/grande.
    // - Alivia tempo médio de viagem para não punir agressivamente rotas longas.
    // - Reduz o peso de viagens falhadas recentes.
    // - Dá pequeno bônus para transporte público/metrô e cidade totalmente conectada.
    const disconnectedPenalty = Math.min(32, snapshot.disconnectedBuildings * 3.2);

    const congestionTolerance = 25;
    const congestionOverTolerance = Math.max(0, snapshot.averageCongestion - congestionTolerance);
    const congestionPenalty = Math.min(34, congestionOverTolerance * 0.16);

    const failedPenalty = Math.min(18, this.failedTripPressure * 0.65);

    const travelComfortSeconds = 12;
    const travelOverComfort = Math.max(0, this.averageTravelTime - travelComfortSeconds);
    const travelPenalty = Math.min(18, Math.pow(travelOverComfort, 0.9) * 0.75);

    const publicTransportRelief = Math.min(8, (snapshot.publicTripsCompleted + snapshot.metroTripsCompleted + snapshot.helicopterTripsCompleted) * 0.015);
    const connectivityBonus = snapshot.disconnectedBuildings === 0 ? 3 : 0;

    const targetSatisfaction = 100
      - disconnectedPenalty
      - congestionPenalty
      - failedPenalty
      - travelPenalty
      + publicTransportRelief
      + connectivityBonus;

    this.satisfaction = Math.max(0, Math.min(100, targetSatisfaction));
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

export function getBuildingDemolitionCost(building: Building): number {
  return BUILDING_DEMOLITION_COST[building.type] * building.level;
}

function helicopterWaitingCount(groups: HelicopterPassengerGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

function helicopterPassengerCount(groups: HelicopterPassengerGroup[]): number {
  return helicopterWaitingCount(groups);
}

function addHelicopterPassenger(groups: HelicopterPassengerGroup[], destinationHelipadId: string, count: number): void {
  const existing = groups.find((group) => group.destinationHelipadId === destinationHelipadId);
  if (existing) existing.count += count;
  else groups.push({ destinationHelipadId, count });
}

function takeHelicopterPassengers(groups: HelicopterPassengerGroup[], destinationHelipadId: string, capacity: number): number {
  const group = groups.find((candidate) => candidate.destinationHelipadId === destinationHelipadId);
  if (!group || capacity <= 0) return 0;
  const count = Math.min(capacity, group.count);
  group.count -= count;
  if (group.count <= 0) groups.splice(groups.indexOf(group), 1);
  return count;
}

function removeHelicopterPassengers(groups: HelicopterPassengerGroup[], destinationHelipadId: string): number {
  return takeHelicopterPassengers(groups, destinationHelipadId, Number.POSITIVE_INFINITY);
}

function pickHelicopterLineColor(index: number): string {
  return ['#f97316', '#a855f7', '#22c55e', '#ef4444', '#06b6d4'][index % 5];
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
    const busLanePenalty = tile.busLane && roadType !== 'roundabout' ? BUS_LANE_CONFIG.carPathPenalty : 1;
    total += ROAD_CONFIG[roadType].pathCost * busLanePenalty + congestionPenalty;
  }
  return total;
}

function isRouteLegal(grid: Tile[][], route: Vec2[]): boolean {
  if (route.length < 2) return false;
  for (let index = 0; index < route.length - 1; index += 1) {
    if (!isLegalRoadMove(grid, route[index], route[index + 1])) return false;
  }
  return true;
}

function routeSignature(route: Vec2[]): string {
  return route.slice(0, 6).map((pos) => keyOf(pos.x, pos.y)).join('|');
}

function dedupeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function passengerGroupCount(groups: TransitPassengerGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

function addPassengerGroup(groups: TransitPassengerGroup[], destinationStopId: string, count: number): void {
  const existing = groups.find((group) => group.destinationStopId === destinationStopId);
  if (existing) existing.count += count;
  else groups.push({ destinationStopId, count });
}

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function samePos(a: Vec2 | undefined, b: Vec2 | undefined): boolean {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
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
