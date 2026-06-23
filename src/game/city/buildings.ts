import { nanoid } from 'nanoid';
import type { Building, BuildingConstructionState, BuildingLevel, BuildingType, Tile } from '../../types/city.types';
import { getBuildingLevelConfig } from '../config/buildingConfig';
import { getNeighbors4, isRoadType } from './grid';

export function createBuilding(
  type: BuildingType,
  x: number,
  y: number,
  constructionState: BuildingConstructionState = 'constructing',
): Building {
  const level: BuildingLevel = 1;
  const cfg = getBuildingLevelConfig(type, level);
  const operational = constructionState === 'operational';
  return {
    id: nanoid(8),
    type,
    level,
    x,
    y,
    width: 1,
    height: 1,
    population: operational ? cfg.population : 0,
    jobs: operational ? cfg.jobs : 0,
    attraction: operational ? cfg.attraction : 0,
    connected: false,
    tripsToday: 0,
    constructionState,
    constructionProgress: operational ? 1 : 0,
  };
}

export function isBuildingOperational(building: Building): boolean {
  return (building.constructionState ?? 'operational') === 'operational';
}

export function normalizeBuildingConstruction(building: Building): Building {
  if (building.constructionState) {
    building.constructionProgress = building.constructionState === 'operational'
      ? 1
      : Math.max(0, Math.min(1, building.constructionProgress ?? 0));
    return building;
  }
  building.constructionState = 'operational';
  building.constructionProgress = 1;
  return building;
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
