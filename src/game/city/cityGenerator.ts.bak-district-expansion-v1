import seedrandom from 'seedrandom';
import type { Building, BuildingType, Tile } from '../../types/city.types';
import { GAME_CONFIG } from '../config/gameConfig';
import type { BuildingSpawnMode, GameSetupOptions } from '../config/gameSetup';
import { DEFAULT_GAME_SETUP } from '../config/gameSetup';
import { createBuilding } from './buildings';

export class CityGenerator {
  private rng = seedrandom(`${Date.now()}-${Math.random()}`);
  private cityAnchor: { x: number; y: number } | null = null;
  private readonly spawnMode: BuildingSpawnMode;
  private readonly districtCenters: Record<BuildingType, { x: number; y: number }>;
  private readonly corridorAxes: { x: number; y: number };

  constructor(options: Partial<GameSetupOptions> = {}) {
    this.spawnMode = options.spawnMode ?? DEFAULT_GAME_SETUP.spawnMode;
    this.districtCenters = this.createDistrictCenters();
    this.corridorAxes = {
      x: this.randInt(Math.floor(GAME_CONFIG.gridWidth * 0.34), Math.ceil(GAME_CONFIG.gridWidth * 0.66)),
      y: this.randInt(Math.floor(GAME_CONFIG.gridHeight * 0.34), Math.ceil(GAME_CONFIG.gridHeight * 0.66)),
    };
  }

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

  findSpot(grid: Tile[][], buildings: Building[], type: BuildingType = this.chooseType(1)): { x: number; y: number } | null {
    if (this.spawnMode === 'compact') return this.findCompactSpot(grid, buildings);
    if (this.spawnMode === 'districts') return this.findDistrictSpot(grid, buildings, type);
    if (this.spawnMode === 'corridors') return this.findCorridorSpot(grid, buildings);
    if (this.spawnMode === 'gridBlocks') return this.findGridBlockSpot(grid, buildings);
    return this.findOrganicSpot(grid, buildings);
  }

  private findOrganicSpot(grid: Tile[][], buildings: Building[]): { x: number; y: number } | null {
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

  private findCompactSpot(grid: Tile[][], buildings: Building[]): { x: number; y: number } | null {
    if (!buildings.length) return this.findInitialSpotAndAnchor(grid);
    const anchor = this.cityAnchor ?? this.centroid(buildings);
    const radius = Math.min(13, 3 + Math.floor(Math.sqrt(buildings.length) * 1.45));
    const cityRadius = Math.min(17, radius + 5);

    for (let i = 0; i < 360; i += 1) {
      const bias = this.rand() < 0.82 ? anchor : buildings[this.randInt(0, buildings.length - 1)];
      const x = Math.round(bias.x + this.randInt(-radius, radius));
      const y = Math.round(bias.y + this.randInt(-radius, radius));
      if (this.isCoherentSpot(grid, buildings, x, y, cityRadius)) return { x, y };
    }
    return this.findOrganicSpot(grid, buildings);
  }

  private findDistrictSpot(grid: Tile[][], buildings: Building[], type: BuildingType): { x: number; y: number } | null {
    if (!buildings.length) return this.findInitialSpotAndAnchor(grid);
    const center = this.districtCenters[type];
    const sameType = buildings.filter((building) => building.type === type);
    const localBase = sameType.length && this.rand() < 0.58 ? sameType[this.randInt(0, sameType.length - 1)] : center;
    const radius = Math.min(9, 3 + Math.floor(Math.sqrt(Math.max(1, sameType.length)) * 1.55));
    const cityRadius = Math.min(20, 9 + Math.floor(Math.sqrt(buildings.length) * 2.2));

    for (let i = 0; i < 360; i += 1) {
      const x = Math.round(localBase.x + this.randInt(-radius, radius));
      const y = Math.round(localBase.y + this.randInt(-radius, radius));
      if (this.isCoherentSpot(grid, buildings, x, y, cityRadius)) return { x, y };
    }
    return this.findOrganicSpot(grid, buildings);
  }

  private findCorridorSpot(grid: Tile[][], buildings: Building[]): { x: number; y: number } | null {
    if (!buildings.length) return this.findInitialSpotAndAnchor(grid);
    const cityRadius = Math.min(22, 10 + Math.floor(Math.sqrt(buildings.length) * 2.3));
    const spanX = Math.min(15, 5 + Math.floor(Math.sqrt(buildings.length) * 2));
    const spanY = Math.min(11, 4 + Math.floor(Math.sqrt(buildings.length) * 1.5));

    for (let i = 0; i < 380; i += 1) {
      const followHorizontal = this.rand() < 0.55;
      const x = followHorizontal
        ? this.randInt(Math.max(2, this.corridorAxes.x - spanX), Math.min(GAME_CONFIG.gridWidth - 3, this.corridorAxes.x + spanX))
        : Math.round(this.corridorAxes.x + this.randInt(-2, 2));
      const y = followHorizontal
        ? Math.round(this.corridorAxes.y + this.randInt(-2, 2))
        : this.randInt(Math.max(2, this.corridorAxes.y - spanY), Math.min(GAME_CONFIG.gridHeight - 3, this.corridorAxes.y + spanY));
      if (this.isCoherentSpot(grid, buildings, x, y, cityRadius) && this.isNearCorridor(x, y, 3)) return { x, y };
    }
    return this.findOrganicSpot(grid, buildings);
  }

  private findGridBlockSpot(grid: Tile[][], buildings: Building[]): { x: number; y: number } | null {
    if (!buildings.length) return this.findInitialSpotAndAnchor(grid);
    const cityRadius = Math.min(21, 9 + Math.floor(Math.sqrt(buildings.length) * 2.25));
    const anchor = this.cityAnchor ?? this.centroid(buildings);
    const radius = Math.min(16, 5 + Math.floor(Math.sqrt(buildings.length) * 2));

    for (let i = 0; i < 420; i += 1) {
      const x = Math.round(anchor.x + this.randInt(-radius, radius));
      const y = Math.round(anchor.y + this.randInt(-radius, radius));
      if (!this.isBlockLotCoordinate(x, y)) continue;
      if (this.isCoherentSpot(grid, buildings, x, y, cityRadius)) return { x, y };
    }
    return this.findOrganicSpot(grid, buildings);
  }

  private findInitialSpotAndAnchor(grid: Tile[][]): { x: number; y: number } | null {
    const firstSpot = this.findInitialSpot(grid);
    if (firstSpot) this.cityAnchor = firstSpot;
    return firstSpot;
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

  private centroid(buildings: Building[]): { x: number; y: number } {
    return buildings.reduce(
      (acc, building) => ({ x: acc.x + building.x / buildings.length, y: acc.y + building.y / buildings.length }),
      { x: 0, y: 0 },
    );
  }

  private createDistrictCenters(): Record<BuildingType, { x: number; y: number }> {
    const centerX = Math.floor(GAME_CONFIG.gridWidth * 0.5);
    const centerY = Math.floor(GAME_CONFIG.gridHeight * 0.5);
    return {
      house: { x: Math.floor(GAME_CONFIG.gridWidth * 0.35), y: Math.floor(GAME_CONFIG.gridHeight * 0.42) },
      shop: { x: centerX, y: Math.floor(GAME_CONFIG.gridHeight * 0.58) },
      office: { x: Math.floor(GAME_CONFIG.gridWidth * 0.66), y: centerY },
    };
  }

  private isNearCorridor(x: number, y: number, distance: number): boolean {
    return Math.abs(x - this.corridorAxes.x) <= distance || Math.abs(y - this.corridorAxes.y) <= distance;
  }

  private isBlockLotCoordinate(x: number, y: number): boolean {
    const localX = ((x % 5) + 5) % 5;
    const localY = ((y % 5) + 5) % 5;
    return localX !== 0 && localY !== 0 && localX !== 4 && localY !== 4;
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
    const type = this.chooseType(level);
    const spot = this.findSpot(grid, buildings, type);
    if (!spot) return null;
    return createBuilding(type, spot.x, spot.y);
  }
}
