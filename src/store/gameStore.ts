import { create } from 'zustand';
import type { CityStats, RoadDirection, SelectedEntity } from '../types/city.types';
import type { Vec2 } from '../types/city.types';
import type { SimulationSpeed, Tool } from '../types/game.types';
import type { PerformanceMetrics } from '../game/performance/performanceTypes';

export type HeatmapMode = 'traffic' | 'satisfaction' | 'flow' | 'off';
export type ViewLayer = 'surface' | 'underground';
export type MobilityFocusMode = 'off' | 'bike' | 'bus' | 'metro';

export type HoverPreview = {
  x: number;
  y: number;
  label: string;
  cost?: number;
  valid: boolean;
  reason?: string;
  tool?: Tool;
  lineTiles?: Vec2[];
  invalidTiles?: Vec2[];
  buildableTiles?: number;
  oneWayDirection?: RoadDirection;
};

export type GameStore = {
  selectedTool: Tool;
  heatmapMode: HeatmapMode;
  viewLayer: ViewLayer;
  mobilityFocusMode: MobilityFocusMode;
  paused: boolean;
  speed: SimulationSpeed;
  stats: CityStats;
  selected: SelectedEntity;
  hoverPreview: HoverPreview | null;
  actionFeedback: string | null;
  performanceMetrics: PerformanceMetrics | null;
  setTool: (tool: Tool) => void;
  setHeatmapMode: (mode: HeatmapMode) => void;
  setViewLayer: (viewLayer: ViewLayer) => void;
  setMobilityFocusMode: (mode: MobilityFocusMode) => void;
  toggleViewLayer: () => void;
  togglePaused: () => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: SimulationSpeed) => void;
  setStats: (stats: CityStats) => void;
  setSelected: (selected: SelectedEntity) => void;
  setHoverPreview: (preview: HoverPreview | null) => void;
  setActionFeedback: (message: string | null) => void;
  setPerformanceMetrics: (metrics: PerformanceMetrics | null) => void;
};

const initialStats: CityStats = {
  money: 0,
  population: 0,
  activeCars: 0,
  satisfaction: 100,
  averageCongestion: 0,
  averageTravelTime: 0,
  disconnectedBuildings: 0,
  completedTrips: 0,
  failedTrips: 0,
  publicTripsCompleted: 0,
  carTripsAvoided: 0,
  waitingPassengers: 0,
  activeBuses: 0,
  busLaneTiles: 0,
  busLaneCoverageRatio: 0,
  districtsOwned: 1,
  cityAreaTiles: 0,
  maxCars: 0,
  maxBuses: 0,
  eastDistrictPurchased: false,
  bikeLaneTiles: 0,
  bikeLaneCoverageRatio: 0,
  bikeTripsCompleted: 0,
  bikeCarsAvoided: 0,
  activeBikeTrips: 0,
  metroStations: 0,
  metroLines: 0,
  metroPassengers: 0,
  metroCarsAvoided: 0,
  metroTripsCompleted: 0,
  metroPassengersWaiting: 0,
  metroTrains: 0,
  cityLevel: 1,
  day: 1,
  timeLabel: '06:00',
  dayPeriod: 'morning',
  terrainReliefEnabled: true,
  terrainBlockedTiles: 0,
  mountainTiles: 0,
  lakeTiles: 0,
};

export const useGameStore = create<GameStore>((set) => ({
  selectedTool: 'road',
  heatmapMode: 'traffic',
  viewLayer: 'surface',
  mobilityFocusMode: 'off',
  paused: false,
  speed: 1,
  stats: initialStats,
  selected: { kind: 'none' },
  hoverPreview: null,
  actionFeedback: null,
  performanceMetrics: null,
  setTool: (tool) => set((state) => ({
    selectedTool: tool,
    actionFeedback: null,
    viewLayer: tool === 'metroTrack' || tool === 'metroLine' ? 'underground' : state.viewLayer,
  })),
  setHeatmapMode: (mode) => set({ heatmapMode: mode }),
  setViewLayer: (viewLayer) => set({ viewLayer }),
  setMobilityFocusMode: (mode) => set((state) => ({
    mobilityFocusMode: mode,
    viewLayer: mode === 'metro' ? 'underground' : mode === 'bike' || mode === 'bus' ? 'surface' : state.viewLayer,
  })),
  toggleViewLayer: () => set((s) => ({ viewLayer: s.viewLayer === 'surface' ? 'underground' : 'surface' })),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setPaused: (paused) => set({ paused }),
  setSpeed: (speed) => set({ speed }),
  setStats: (stats) => set({ stats }),
  setSelected: (selected) => set({ selected }),
  setHoverPreview: (preview) => set({ hoverPreview: preview }),
  setActionFeedback: (message) => set({ actionFeedback: message }),
  setPerformanceMetrics: (metrics) => set({ performanceMetrics: metrics }),
}));
