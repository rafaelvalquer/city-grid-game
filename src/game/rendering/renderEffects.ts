import type { Graphics } from 'pixi.js';
import type { HeatmapMode } from '../../store/gameStore';
import type { GameWorld } from '../engine/simulation';
import type { DayPeriod } from '../engine/timeSystem';
import { MAP_COLORS } from './visualTheme';
import type { Atmosphere } from './renderTypes';
import { lotDecorAt } from './renderTerrain';
import { buildingLightAlpha } from './renderBuildings';
import { hash2, pulse, prefersReducedMotion } from './renderUtils';
import type { GraphicsSettings } from '../config/graphicsSettings';
export function getAtmosphere(rawPeriod: string, timeSeconds: number): Atmosphere {
  const period = normalizePeriod(rawPeriod);
  const reducedMotion = prefersReducedMotion();
  const softPulse = reducedMotion ? 0.5 : pulse(timeSeconds, 0.055, 0.17);
  if (period === 'night') {
    return {
      period,
      overlayColor: MAP_COLORS.nightOverlay,
      overlayAlpha: 0.39 + softPulse * 0.04,
      lightAlpha: 1,
      windowGlowAlpha: 1,
      headlightAlpha: 1,
      heatmapBoost: 1,
      pedestrianAlpha: 0.32,
      motion: reducedMotion ? 0 : 0.35,
    };
  }
  if (period === 'evening') {
    return {
      period,
      overlayColor: MAP_COLORS.eveningOverlay,
      overlayAlpha: 0.18 + softPulse * 0.035,
      lightAlpha: 0.82,
      windowGlowAlpha: 0.78,
      headlightAlpha: 0.68,
      heatmapBoost: 1.28,
      pedestrianAlpha: 0.9,
      motion: reducedMotion ? 0 : 0.85,
    };
  }
  if (period === 'morning') {
    return {
      period,
      overlayColor: MAP_COLORS.morningOverlay,
      overlayAlpha: 0.095,
      lightAlpha: 0.18,
      windowGlowAlpha: 0.12,
      headlightAlpha: 0.16,
      heatmapBoost: 1.22,
      pedestrianAlpha: 0.72,
      motion: reducedMotion ? 0 : 0.65,
    };
  }
  if (period === 'noon') {
    return {
      period,
      overlayColor: MAP_COLORS.morningOverlay,
      overlayAlpha: 0.018,
      lightAlpha: 0.08,
      windowGlowAlpha: 0.04,
      headlightAlpha: 0.08,
      heatmapBoost: 1,
      pedestrianAlpha: 0.82,
      motion: reducedMotion ? 0 : 0.75,
    };
  }
  return {
    period,
    overlayColor: MAP_COLORS.eveningOverlay,
    overlayAlpha: 0.035,
    lightAlpha: 0.14,
    windowGlowAlpha: 0.08,
    headlightAlpha: 0.1,
    heatmapBoost: 1,
    pedestrianAlpha: 0.62,
    motion: reducedMotion ? 0 : 0.55,
  };
}


export function normalizePeriod(period: string): DayPeriod {
  if (period === 'morning' || period === 'noon' || period === 'afternoon' || period === 'evening' || period === 'night') return period;
  return 'morning';
}


export function drawAtmosphereOverlay(graphics: Graphics, world: GameWorld, atmosphere: Atmosphere, heatmapMode: HeatmapMode, ts: number): void {
  if (atmosphere.overlayAlpha <= 0) return;
  const heatmapFactor = heatmapMode === 'off' ? 1 : 0.55;
  const width = world.grid[0]?.length ?? 0;
  const height = world.grid.length;
  graphics.rect(0, 0, width * ts, height * ts)
    .fill({ color: atmosphere.overlayColor, alpha: atmosphere.overlayAlpha * heatmapFactor });
}


export function drawStreetFurniture(
  graphics: Graphics,
  world: GameWorld,
  ts: number,
  timeSeconds: number,
  atmosphere: Atmosphere,
  settings: Pick<GraphicsSettings, 'streetFurniture' | 'streetLights' | 'pedestrians'>,
): void {
  for (let y = 0; y < world.grid.length; y += 1) {
    const row = world.grid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x += 1) {
      const tile = row[x];
      if (!tile) continue;
      if (tile.type === 'empty') {
        if (settings.streetFurniture) {
          drawEmptyLotMicroDetails(graphics, x, y, ts, timeSeconds, atmosphere, settings.pedestrians);
        }
        continue;
      }
      if (settings.streetLights && (tile.type === 'road' || tile.type === 'avenue') && hash2(x, y, 29) % 7 === 0) {
        drawStreetLamp(graphics, x, y, ts, atmosphere, timeSeconds, false);
      }
    }
  }
}


export function drawEmptyLotMicroDetails(
  graphics: Graphics,
  x: number,
  y: number,
  ts: number,
  timeSeconds: number,
  atmosphere: Atmosphere,
  pedestriansEnabled = true,
): void {
  const decor = lotDecorAt(x, y);
  const px = x * ts;
  const py = y * ts;
  if (decor === 'park' || decor === 'plaza') {
    graphics.roundRect(px + 12, py + 28, 13, 3, 1).fill({ color: MAP_COLORS.bench, alpha: 0.56 });
    graphics.rect(px + 10, py + 28, 2, 5).fill({ color: MAP_COLORS.bench, alpha: 0.5 });
    graphics.rect(px + 25, py + 28, 2, 5).fill({ color: MAP_COLORS.bench, alpha: 0.5 });
    if (pedestriansEnabled && hash2(x, y, 31) % 2 === 0) drawPeopleCluster(graphics, px + 20, py + 18, 2 + (hash2(x, y, 33) % 2), timeSeconds, atmosphere, (hash2(x, y, 35) % 997) / 997);
  }
  if (decor === 'parking' || hash2(x, y, 37) % 18 === 0) {
    graphics.roundRect(px + ts - 10, py + ts - 12, 4, 6, 1).fill({ color: MAP_COLORS.trashCan, alpha: 0.6 });
    graphics.rect(px + ts - 11, py + ts - 13, 6, 1).fill({ color: MAP_COLORS.laneSoft, alpha: 0.42 });
  }
}


export function drawBuildingLife(
  graphics: Graphics,
  world: GameWorld,
  ts: number,
  timeSeconds: number,
  atmosphere: Atmosphere,
  settings: Pick<GraphicsSettings, 'buildingLights' | 'pedestrians'>,
): void {
  for (const building of world.buildings) {
    const px = building.x * ts;
    const py = building.y * ts;
    const activity = Math.min(1, (building.tripsToday + building.population + building.jobs + building.attraction) / 18);
    const lightAlpha = settings.buildingLights ? buildingLightAlpha(building, atmosphere, timeSeconds, 23) : 0;
    if (lightAlpha > 0.12) {
      const glowColor = building.type === 'shop' ? MAP_COLORS.shopGlow : MAP_COLORS.lightGlow;
      graphics.circle(px + ts / 2, py + ts / 2 + 2, 13 + activity * 5).fill({ color: glowColor, alpha: lightAlpha * 0.08 });
    }
    if (settings.pedestrians && building.type === 'shop' && building.connected && atmosphere.pedestrianAlpha > 0.2) {
      const count = Math.min(5, 1 + building.level + Math.floor(activity * 2));
      drawPeopleCluster(graphics, px + ts / 2, py + ts - 6, count, timeSeconds, atmosphere, (hash2(building.x, building.y, 61) % 997) / 997);
      if (atmosphere.period === 'evening' || atmosphere.period === 'noon') {
        graphics.roundRect(px + 9, py + ts - 5, ts - 18, 2, 1).fill({ color: MAP_COLORS.shopGlow, alpha: 0.2 + activity * 0.18 });
      }
    } else if (settings.pedestrians && building.type === 'office' && building.connected && atmosphere.period === 'evening') {
      drawPeopleCluster(graphics, px + ts / 2 + 4, py + ts - 5, 2 + building.level, timeSeconds, atmosphere, (hash2(building.x, building.y, 67) % 997) / 997);
    }
  }
}


export function drawPeopleCluster(graphics: Graphics, x: number, y: number, count: number, timeSeconds: number, atmosphere: Atmosphere, phase: number): void {
  const alpha = atmosphere.pedestrianAlpha;
  if (alpha <= 0.05) return;
  for (let i = 0; i < count; i += 1) {
    const offset = i - (count - 1) / 2;
    const bob = atmosphere.motion > 0 ? (pulse(timeSeconds, 0.28 + i * 0.03, phase + i * 0.21) - 0.5) * atmosphere.motion * 1.4 : 0;
    const color = i % 2 === 0 ? MAP_COLORS.person : MAP_COLORS.personAlt;
    graphics.circle(x + offset * 4.2, y + bob, 1.55).fill({ color, alpha: 0.66 * alpha });
    graphics.rect(x + offset * 4.2 - 0.8, y + 1.6 + bob, 1.6, 2.2).fill({ color, alpha: 0.46 * alpha });
  }
}


export function drawStreetLamp(graphics: Graphics, x: number, y: number, ts: number, atmosphere: Atmosphere, timeSeconds: number, glowOnly: boolean): void {
  const px = x * ts;
  const py = y * ts;
  const phase = (hash2(x, y, 71) % 100) / 100;
  const glow = atmosphere.lightAlpha * (0.64 + (atmosphere.motion > 0 ? pulse(timeSeconds, 0.18, phase) * 0.16 : 0.08));
  const lampX = px + (hash2(x, y, 73) % 2 === 0 ? 7 : ts - 7);
  const lampY = py + (hash2(x, y, 79) % 2 === 0 ? 7 : ts - 7);
  if (glow > 0.08) graphics.circle(lampX, lampY, 9).fill({ color: MAP_COLORS.streetLamp, alpha: glow * 0.1 });
  if (glowOnly) return;
  graphics.rect(lampX - 0.7, lampY - 4, 1.4, 8).fill({ color: MAP_COLORS.shadow, alpha: 0.48 });
  graphics.circle(lampX, lampY - 4, 1.8).fill({ color: glow > 0.08 ? MAP_COLORS.streetLamp : MAP_COLORS.laneSoft, alpha: Math.max(0.42, glow) });
}


export function passengerGroupCount(groups: Array<{ count: number }>): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

