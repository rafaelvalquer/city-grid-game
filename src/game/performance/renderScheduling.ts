import type { SimulationSpeed } from '../../types/game.types';
import { PERFORMANCE_CONFIG } from '../config/performanceConfig';

export function getTargetRenderFps(
  speed: SimulationSpeed,
  paused: boolean,
  highLoad: boolean,
): number {
  if (paused || speed <= 1) return 0;
  if (speed === 2) {
    return highLoad
      ? PERFORMANCE_CONFIG.renderFps2xHighLoad
      : PERFORMANCE_CONFIG.renderFps2x;
  }
  return highLoad
    ? PERFORMANCE_CONFIG.renderFps4xHighLoad
    : PERFORMANCE_CONFIG.renderFps4x;
}

export function shouldRenderFrame(elapsedSeconds: number, targetFps: number): boolean {
  if (targetFps <= 0) return true;
  return elapsedSeconds + Number.EPSILON >= 1 / targetFps;
}
