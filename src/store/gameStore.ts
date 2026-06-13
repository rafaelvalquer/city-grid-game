import { create } from 'zustand';
import type { CityStats, SelectedEntity } from '../types/city.types';
import type { Vec2 } from '../types/city.types';
import type { SimulationSpeed, Tool } from '../types/game.types';

export type HeatmapMode = 'traffic' | 'satisfaction' | 'flow' | 'disconnected' | 'off';

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
};

export type GameStore = {
  selectedTool: Tool;
  heatmapMode: HeatmapMode;
  paused: boolean;
  speed: SimulationSpeed;
  stats: CityStats;
  selected: SelectedEntity;
  hoverPreview: HoverPreview | null;
  actionFeedback: string | null;
  setTool: (tool: Tool) => void;
  setHeatmapMode: (mode: HeatmapMode) => void;
  togglePaused: () => void;
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
  cityLevel: 1,
  day: 1,
  timeLabel: '06:00',
  dayPeriod: 'morning',
};

export const useGameStore = create<GameStore>((set) => ({
  selectedTool: 'road',
  heatmapMode: 'traffic',
  paused: false,
  speed: 1,
  stats: initialStats,
  selected: { kind: 'none' },
  hoverPreview: null,
  actionFeedback: null,
  setTool: (tool) => set({ selectedTool: tool, actionFeedback: null }),
  setHeatmapMode: (mode) => set({ heatmapMode: mode }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setSpeed: (speed) => set({ speed }),
  setStats: (stats) => set({ stats }),
  setSelected: (selected) => set({ selected }),
  setHoverPreview: (preview) => set({ hoverPreview: preview }),
  setActionFeedback: (message) => set({ actionFeedback: message }),
}));
