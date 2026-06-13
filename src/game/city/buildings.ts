import { nanoid } from 'nanoid';
import type { Building, BuildingLevel, BuildingType, Tile } from '../../types/city.types';
import { getBuildingLevelConfig } from '../config/buildingConfig';
import { getNeighbors4, isRoadType } from './grid';

export function createBuilding(type: BuildingType, x: number, y: number): Building {
  const level: BuildingLevel = 1;
  const cfg = getBuildingLevelConfig(type, level);
  return {
    id: nanoid(8),
    type,
    level,
    x,
    y,
    width: 1,
    height: 1,
    population: cfg.population,
    jobs: cfg.jobs,
    attraction: cfg.attraction,
    connected: false,
    tripsToday: 0,
  };
}

export function applyBuildingLevel(building: Building, level: BuildingLevel, day?: number): Building {
  const cfg = getBuildingLevelConfig(building.type, level);
  return {
    ...building,
    level,
    population: cfg.population,
    jobs: cfg.jobs,
    attraction: cfg.attraction,
    upgradedAtDay: day ?? building.upgradedAtDay,
  };
}

export function updateBuildingConnection(building: Building, grid: Tile[][]): Building {
  const road = getNeighbors4({ x: building.x, y: building.y }).find((n) => isRoadType(grid[n.y][n.x].type));
  return { ...building, connected: Boolean(road), nearestRoad: road };
}
