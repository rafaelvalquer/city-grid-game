import type { Graphics } from 'pixi.js';
import type { HeatmapMode } from '../../store/gameStore';
import type { GameWorld } from '../engine/simulation';
import { keyOf } from '../city/grid';
import { MAP_COLORS, congestionColor } from './visualTheme';
import type { Atmosphere } from './renderTypes';
import { isBuildingOperational } from '../city/buildings';
export function drawHeatmapMode(graphics: Graphics, world: GameWorld, mode: HeatmapMode, ts: number, atmosphere: Atmosphere): void {
  if (mode === 'off') return;
  const boost = atmosphere.heatmapBoost;

  if (mode === 'traffic') {
    for (const t of world.traffic.values()) {
      if (t.congestion <= 0) continue;
      graphics.roundRect(t.x * ts + 5, t.y * ts + 5, ts - 10, ts - 10, 5).fill({ color: congestionColor(t.congestion), alpha: Math.min(0.68, (0.12 + t.congestion * 0.18) * boost) });
    }
    return;
  }

  if (mode === 'flow') {
    for (const t of world.traffic.values()) {
      if (t.cars <= 0) continue;
      const intensity = Math.min(1, t.cars / Math.max(1, t.capacity));
      graphics.roundRect(t.x * ts + 6, t.y * ts + 6, ts - 12, ts - 12, 5).fill({ color: MAP_COLORS.route, alpha: Math.min(0.68, (0.12 + intensity * 0.38) * boost) });
    }
    return;
  }

  const citySatisfaction = world.getSnapshot().satisfaction;
  const cityColor = citySatisfaction >= 70 ? MAP_COLORS.treeLight : citySatisfaction >= 40 ? MAP_COLORS.lane : MAP_COLORS.disconnected;
  for (const building of world.buildings) {
    if (!isBuildingOperational(building)) continue;
    const nearbyCongestion = nearbyTrafficCongestion(world, building.x, building.y);
    const localStress = building.connected ? nearbyCongestion : 1.2;
    const color = localStress > 0.9 || !building.connected ? MAP_COLORS.disconnected : cityColor;
    graphics.roundRect(building.x * ts + 4, building.y * ts + 4, ts - 8, ts - 8, 6).fill({ color, alpha: Math.min(0.58, (0.16 + localStress * 0.18) * boost) });
  }
}


export function nearbyTrafficCongestion(world: GameWorld, x: number, y: number): number {
  let max = 0;
  for (const next of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
    const traffic = world.traffic.get(keyOf(next.x, next.y));
    if (traffic) max = Math.max(max, traffic.congestion);
  }
  return max;
}


export function heatmapLabel(mode: HeatmapMode): string {
  if (mode === 'traffic') return 'Trânsito';
  if (mode === 'satisfaction') return 'Satisfação';
  if (mode === 'flow') return 'Fluxo';
  return 'Heatmap';
}

