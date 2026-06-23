import type { Graphics } from 'pixi.js';
import type { Building } from '../../types/city.types';
import { MAP_COLORS } from './visualTheme';
import type { Atmosphere } from './renderTypes';
import { hash2, pulse } from './renderUtils';
import { isBuildingOperational } from '../city/buildings';
export function drawBuildingVariant(
  graphics: Graphics,
  building: Building,
  ts: number,
  timeSeconds: number,
  atmosphere: Atmosphere,
  lightsEnabled = true,
): void {
  const { type, x, y, connected } = building;
  const px = x * ts;
  const py = y * ts;
  const variant = hash2(x, y, type.length);
  const activity = Math.min(1, (building.population + building.jobs + building.attraction) / 16);
  const growth = building.level - 1;
  graphics.roundRect(px + 7, py + 8, ts - 7, ts - 7, 5).fill({ color: MAP_COLORS.buildingShadow, alpha: 0.22 + activity * 0.16 });
  if (type === 'house') {
    const roofShift = variant % 2 === 0 ? 0 : 3;
    const bodyInset = growth === 2 ? 3 : growth === 1 ? 5 : 6;
    const roofTop = growth === 2 ? py + 2 : py + 4;
    if (growth < 2) {
      graphics.poly([px + bodyInset - 1, py + 14, px + ts / 2 + roofShift, roofTop, px + ts - bodyInset + 1, py + 14]).fill(MAP_COLORS.houseRoof);
      graphics.poly([px + ts - bodyInset + 1, py + 14, px + ts / 2 + roofShift, roofTop, px + ts / 2 + roofShift + 5, py + 15]).fill({ color: MAP_COLORS.shadow, alpha: 0.16 });
    } else {
      graphics.roundRect(px + bodyInset, py + 5, ts - bodyInset * 2, 7, 2).fill(MAP_COLORS.houseRoof);
    }
    graphics.roundRect(px + bodyInset, py + (growth === 2 ? 9 : 13), ts - bodyInset * 2, ts - 16 + growth * 2, 3).fill(MAP_COLORS.house);
    const homeLight = lightsEnabled ? buildingLightAlpha(building, atmosphere, timeSeconds, 0) : 0;
    graphics.rect(px + bodyInset + 6, py + 21, 5, 7).fill({ color: homeLight > 0.2 ? MAP_COLORS.windowLit : MAP_COLORS.carWindow, alpha: Math.max(0.42 + activity * 0.22, homeLight) });
    graphics.rect(px + ts - bodyInset - 11, py + 18, 6, 5).fill({ color: homeLight > 0.2 ? MAP_COLORS.windowWarm : MAP_COLORS.laneSoft, alpha: Math.max(0.34 + activity * 0.3, homeLight * 0.88) });
    if (growth > 0) graphics.rect(px + ts / 2 - 4, py + 25, 8, 7).fill({ color: MAP_COLORS.houseTrim, alpha: 0.72 });
    if (growth === 2) {
      graphics.rect(px + 11, py + 13, 4, 3).fill({ color: homeLight > 0.2 ? MAP_COLORS.windowLit : MAP_COLORS.laneSoft, alpha: Math.max(0.75, homeLight) });
      graphics.rect(px + 25, py + 13, 4, 3).fill({ color: homeLight > 0.2 ? MAP_COLORS.windowLit : MAP_COLORS.laneSoft, alpha: Math.max(0.75, homeLight * 0.9) });
    }
  } else if (type === 'shop') {
    const heightBoost = growth * 2;
    const shopLight = lightsEnabled ? buildingLightAlpha(building, atmosphere, timeSeconds, 1) : 0;
    graphics.roundRect(px + 5, py + 6 - heightBoost, ts - 10, ts - 10 + heightBoost, 3).fill(MAP_COLORS.shop);
    graphics.rect(px + 7, py + 8 - heightBoost, ts - 14, 4).fill(MAP_COLORS.shopSign);
    for (let i = 0; i < 4; i += 1) {
      graphics.rect(px + 6 + i * 7, py + 12 - heightBoost, 5, 4).fill(i % 2 === 0 ? MAP_COLORS.shopAwning : MAP_COLORS.laneSoft);
    }
    graphics.rect(px + 9, py + 18, ts - 18, 6).fill({ color: shopLight > 0.15 ? MAP_COLORS.shopGlow : MAP_COLORS.shopGlass, alpha: Math.max(0.4 + activity * 0.35, shopLight * 0.9) });
    graphics.rect(px + 16, py + 26, 8, 7).fill({ color: MAP_COLORS.shadow, alpha: 0.22 });
    if (growth === 2) graphics.rect(px + 10, py + 28, ts - 20, 2).fill({ color: MAP_COLORS.shopAwning, alpha: 0.78 });
  } else {
    const floors = 3 + (variant % 2) + growth;
    const top = py + 6 - growth * 2;
    const height = ts - 9 + growth * 2;
    graphics.roundRect(px + 5, top, ts - 10, height, 3).fill(MAP_COLORS.office);
    graphics.rect(px + ts - 11, top + 4, 4, height - 8).fill({ color: MAP_COLORS.officeDark, alpha: 0.38 });
    for (let row = 0; row < floors; row += 1) {
      const yy = top + 4 + row * 5;
      const litA = lightsEnabled ? buildingLightAlpha(building, atmosphere, timeSeconds, row + 2) : 0;
      const litB = lightsEnabled ? buildingLightAlpha(building, atmosphere, timeSeconds, row + 7) : 0;
      const litC = lightsEnabled ? buildingLightAlpha(building, atmosphere, timeSeconds, row + 13) : 0;
      graphics.rect(px + 8, yy, 3, 2).fill({ color: litA > 0.35 ? MAP_COLORS.windowLit : MAP_COLORS.officeGlass, alpha: Math.max(0.55 + activity * 0.25, litA) });
      graphics.rect(px + 14, yy, 3, 2).fill({ color: litB > 0.35 ? MAP_COLORS.windowWarm : MAP_COLORS.officeGlass, alpha: Math.max(0.55 + activity * 0.25, litB) });
      graphics.rect(px + 22, yy, 3, 2).fill({ color: litC > 0.35 ? MAP_COLORS.windowLit : MAP_COLORS.officeGlass, alpha: Math.max(0.45 + activity * 0.22, litC) });
    }
    graphics.rect(px + 7, py + ts - 8, ts - 14, 2).fill({ color: MAP_COLORS.officeDark, alpha: 0.5 });
  }
  drawBuildingLevelBadge(graphics, px, py, building.level);
  graphics.roundRect(px + 4, py + 4, ts - 8, ts - 8, 4).stroke({ color: connected ? MAP_COLORS.lotStroke : MAP_COLORS.disconnected, width: connected ? 1 : 3, alpha: connected ? 0.8 : 1 });
}

export function getBuildingConstructionStage(building: Building): 1 | 2 | 3 {
  const progress = Math.max(0, Math.min(1, building.constructionProgress ?? 0));
  if (progress <= 1 / 3) return 1;
  if (progress <= 2 / 3) return 2;
  return 3;
}

export function drawBuildingConstruction(graphics: Graphics, building: Building, ts: number, timeSeconds: number): void {
  if (isBuildingOperational(building)) return;
  const progress = Math.max(0, Math.min(1, building.constructionProgress ?? 0));
  const stage = getBuildingConstructionStage(building);
  const px = building.x * ts;
  const py = building.y * ts;
  const pulseAlpha = 0.72 + pulse(timeSeconds, 0.55, (building.x + building.y) * 0.13) * 0.2;

  graphics.roundRect(px + 5, py + 27, ts - 10, 7, 2).fill({ color: MAP_COLORS.constructionFoundation, alpha: 0.9 });
  graphics.rect(px + 8, py + 24, ts - 16, 3).fill({ color: MAP_COLORS.constructionFoundation, alpha: 0.74 });

  if (stage >= 2) {
    const structureHeight = stage === 2 ? 13 : 22;
    const top = py + 27 - structureHeight;
    for (const columnX of [px + 10, px + ts - 12]) {
      graphics.rect(columnX, top, 3, structureHeight).fill({ color: MAP_COLORS.constructionFrame, alpha: 0.9 });
    }
    graphics.rect(px + 9, top, ts - 18, 3).fill({ color: MAP_COLORS.constructionFrame, alpha: 0.9 });
    if (stage === 3) {
      graphics.rect(px + 9, py + 15, ts - 18, 3).fill({ color: MAP_COLORS.constructionFrame, alpha: 0.82 });
      graphics.rect(px + 7, py + 5, 2, 25).fill({ color: MAP_COLORS.constructionScaffold, alpha: pulseAlpha });
      graphics.rect(px + ts - 9, py + 5, 2, 25).fill({ color: MAP_COLORS.constructionScaffold, alpha: pulseAlpha });
      for (const yy of [py + 8, py + 17, py + 26]) {
        graphics.rect(px + 6, yy, ts - 12, 1.5).fill({ color: MAP_COLORS.constructionScaffold, alpha: 0.72 });
      }
    }
  } else {
    graphics.rect(px + 9, py + 19, 7, 5).fill({ color: MAP_COLORS.constructionFrame, alpha: pulseAlpha });
    graphics.rect(px + 21, py + 21, 10, 3).fill({ color: MAP_COLORS.constructionScaffold, alpha: 0.75 });
  }

  graphics.roundRect(px + 5, py + 2, ts - 10, 5, 2).fill({ color: MAP_COLORS.shadow, alpha: 0.52 });
  graphics.roundRect(px + 6, py + 3, (ts - 12) * progress, 3, 1.5).fill({ color: MAP_COLORS.constructionProgress, alpha: 0.95 });
}


export function drawBuildingLevelBadge(graphics: Graphics, px: number, py: number, level: number): void {
  const badgeX = px + 7;
  const badgeY = py + 31;
  graphics.roundRect(badgeX - 2, badgeY - 2, 14, 6, 3).fill({ color: MAP_COLORS.shadow, alpha: 0.32 });
  for (let i = 0; i < level; i += 1) {
    graphics.rect(badgeX + i * 4, badgeY, 2, 3).fill({ color: MAP_COLORS.laneSoft, alpha: 0.9 });
  }
}


export function buildingLightAlpha(building: Building, atmosphere: Atmosphere, timeSeconds: number, salt: number): number {
  if (!isBuildingOperational(building)) return 0;
  const base = atmosphere.lightAlpha;
  if (base <= 0.04) return base;
  const stable = (hash2(building.x, building.y, salt + 41) % 100) / 100;
  const activity = Math.min(1, (building.tripsToday + building.population + building.jobs + building.attraction) / 18);
  const flicker = atmosphere.motion > 0 ? pulse(timeSeconds, 0.12 + stable * 0.08, stable) : 0.5;
  const typeBoost = building.type === 'house' && atmosphere.period === 'night' ? 0.18 : building.type === 'shop' && atmosphere.period === 'evening' ? 0.16 : 0;
  const nightBoost = atmosphere.windowGlowAlpha * (0.22 + activity * 0.18);
  return Math.min(0.98, base * (0.34 + stable * 0.28 + activity * 0.3 + flicker * 0.12 + typeBoost + nightBoost));
}

