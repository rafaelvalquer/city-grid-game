import seedrandom from 'seedrandom';
import type { Building, BuildingType, Tile } from '../../types/city.types';
import { GAME_CONFIG } from '../config/gameConfig';
import { createBuilding } from './buildings';

export class CityGenerator {
  private rng = seedrandom('cidade-em-fluxo-v1');

  private rand(): number {
    return this.rng();
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
    const tries = 250;
    const hasBuildings = buildings.length > 0;
    for (let i = 0; i < tries; i++) {
      const x = 2 + Math.floor(this.rand() * (GAME_CONFIG.gridWidth - 4));
      const y = 2 + Math.floor(this.rand() * (GAME_CONFIG.gridHeight - 4));
      if (grid[y][x].type !== 'empty') continue;
      const tooClose = buildings.some((b) => Math.abs(b.x - x) + Math.abs(b.y - y) < 2);
      if (tooClose) continue;
      if (hasBuildings) {
        const nearCity = buildings.some((b) => Math.abs(b.x - x) + Math.abs(b.y - y) <= 12);
        if (!nearCity) continue;
      }
      return { x, y };
    }
    return null;
  }

  spawn(grid: Tile[][], buildings: Building[], level: number): Building | null {
    const spot = this.findSpot(grid, buildings);
    if (!spot) return null;
    return createBuilding(this.chooseType(level), spot.x, spot.y);
  }
}
