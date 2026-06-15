import type { HoverPreview } from '../../store/gameStore';
import type { DayPeriod } from '../engine/timeSystem';

export type ActionPreview = HoverPreview & {
  reason?: string;
  successMessage: string;
  demolishedBuildings?: number;
};

export type LotDecor = 'trees' | 'park' | 'parking' | 'garden' | 'plaza' | 'plain';

export type Atmosphere = {
  period: DayPeriod;
  overlayColor: number;
  overlayAlpha: number;
  lightAlpha: number;
  windowGlowAlpha: number;
  headlightAlpha: number;
  heatmapBoost: number;
  pedestrianAlpha: number;
  motion: number;
};

export type CarRenderPose = {
  x: number;
  y: number;
  angle: number;
  turningAmount: number;
  alpha: number;
};

export const TURN_IN_START = 0.64;
export const TURN_OUT_END = 0.36;
export const SIGNAL_RED = 0xef4444;
export const SIGNAL_YELLOW = 0xfacc15;
export const SIGNAL_GREEN = 0x22c55e;
export const SIGNAL_OFF = 0x172033;
