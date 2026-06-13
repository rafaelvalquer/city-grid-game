import seedrandom from 'seedrandom';
import type { Building, BuildingType, Tile } from '../../types/city.types';
import { GAME_CONFIG } from '../config/gameConfig';
import { createBuilding } from './buildings';

export class CityGenerator {
  private rng = seedrandom(`${Date.now()}-${Math.random()}`);
  private cityAnchor: { x: number; y: number } | null = null;

  private rand(): number {
    return this.rng();
  }

  private randInt(min: number, max: number): number {
    return min + Math.floor(this.rand() * (max - min + 1));
  }

  chooseType(level: number): BuildingType {
    const r = this.rand();
    if (level <= 1) {
      if (r < 0.72) return 'house';
      if (r < 0.94) return 'shop';
      return 'office';
    }
    if (level === 2) {
      if (r < 0.55) return 'house';
      if (r < 0.8) return 'shop';
      return 'office';
    }
    if (r < 0.42) return 'house';
    if (r < 0.68) return 'shop';
    return 'office';
  }

  findSpot(grid: Tile[][], buildings: Building[]): { x: number; y: number } | null {
    const tries = 320;
    if (!buildings.length) {
      const firstSpot = this.findInitialSpot(grid);
      if (firstSpot) this.cityAnchor = firstSpot;
      return firstSpot;
    }

    const centroid = buildings.reduce(
      (acc, building) => ({ x: acc.x + building.x / buildings.length, y: acc.y + building.y / buildings.length }),
      { x: 0, y: 0 },
    );
    const anchor = this.cityAnchor ?? centroid;
    const growthRadius = Math.min(11, 4 + Math.floor(Math.sqrt(buildings.length) * 1.8));
    const cityRadius = Math.min(18, 8 + Math.floor(Math.sqrt(buildings.length) * 2.4));

    for (let i = 0; i < tries; i++) {
      const base = this.rand() < 0.72
        ? buildings[this.randInt(0, buildings.length - 1)]
        : (this.rand() < 0.65 ? centroid : anchor);
      const x = Math.round(base.x + this.randInt(-growthRadius, growthRadius));
      const y = Math.round(base.y + this.randInt(-growthRadius, growthRadius));
      if (this.isCoherentSpot(grid, buildings, x, y, cityRadius)) return { x, y };
    }

    for (let i = 0; i < tries; i++) {
      const x = this.randInt(2, GAME_CONFIG.gridWidth - 3);
      const y = this.randInt(2, GAME_CONFIG.gridHeight - 3);
      if (this.isCoherentSpot(grid, buildings, x, y, cityRadius + 5)) return { x, y };
    }
    return null;
  }

  private findInitialSpot(grid: Tile[][]): { x: number; y: number } | null {
    const minX = Math.floor(GAME_CONFIG.gridWidth * 0.28);
    const maxX = Math.ceil(GAME_CONFIG.gridWidth * 0.72);
    const minY = Math.floor(GAME_CONFIG.gridHeight * 0.28);
    const maxY = Math.ceil(GAME_CONFIG.gridHeight * 0.72);

    for (let i = 0; i < 120; i++) {
      const x = this.randInt(minX, maxX);
      const y = this.randInt(minY, maxY);
      if (grid[y]?.[x]?.type === 'empty') return { x, y };
    }
    return null;
  }

  private isCoherentSpot(grid: Tile[][], buildings: Building[], x: number, y: number, cityRadius: number): boolean {
    if (x < 2 || y < 2 || x > GAME_CONFIG.gridWidth - 3 || y > GAME_CONFIG.gridHeight - 3) return false;
    if (grid[y]?.[x]?.type !== 'empty') return false;
    const tooClose = buildings.some((b) => Math.abs(b.x - x) + Math.abs(b.y - y) < 2);
    if (tooClose) return false;
    const nearCity = buildings.some((b) => Math.abs(b.x - x) + Math.abs(b.y - y) <= cityRadius);
    if (!nearCity) return false;
    if (!this.cityAnchor) return true;
    const distanceFromAnchor = Math.abs(this.cityAnchor.x - x) + Math.abs(this.cityAnchor.y - y);
    return distanceFromAnchor <= cityRadius + 8;
  }

  spawn(grid: Tile[][], buildings: Building[], level: number): Building | null {
    const spot = this.findSpot(grid, buildings);
    if (!spot) return null;
    return createBuilding(this.chooseType(level), spot.x, spot.y);
  }
}
