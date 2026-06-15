import { create } from 'zustand';
import type { CityStats, RoadDirection, SelectedEntity } from '../types/city.types';
import type { Vec2 } from '../types/city.types';
import type { SimulationSpeed, Tool } from '../types/game.types';

export type HeatmapMode = 'traffic' | 'satisfaction' | 'flow' | 'off';
export type ViewLayer = 'surface' | 'underground';

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
  paused: boolean;
  speed: SimulationSpeed;
  stats: CityStats;
  selected: SelectedEntity;
  hoverPreview: HoverPreview | null;
  actionFeedback: string | null;
  setTool: (tool: Tool) => void;
  setHeatmapMode: (mode: HeatmapMode) => void;
  setViewLayer: (viewLayer: ViewLayer) => void;
  toggleViewLayer: () => void;
  togglePaused: () => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: SimulationSpeed) => void;
  setStats: (stats: CityStats) => void;
  setSelected: (selected: SelectedEntity) => void;
  setHoverPreview: (preview: HoverPreview | null) => void;
  setActionFeedback: (message: string | null) => void;
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
};

export const useGameStore = create<GameStore>((set) => ({
  selectedTool: 'road',
  heatmapMode: 'traffic',
  viewLayer: 'surface',
  paused: false,
  speed: 1,
  stats: initialStats,
  selected: { kind: 'none' },
  hoverPreview: null,
  actionFeedback: null,
  setTool: (tool) => set({ selectedTool: tool, actionFeedback: null }),
  setHeatmapMode: (mode) => set({ heatmapMode: mode }),
  setViewLayer: (viewLayer) => set({ viewLayer }),
  toggleViewLayer: () => set((s) => ({ viewLayer: s.viewLayer === 'surface' ? 'underground' : 'surface' })),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setPaused: (paused) => set({ paused }),
  setSpeed: (speed) => set({ speed }),
  setStats: (stats) => set({ stats }),
  setSelected: (selected) => set({ selected }),
  setHoverPreview: (preview) => set({ hoverPreview: preview }),
  setActionFeedback: (message) => set({ actionFeedback: message }),
}));
