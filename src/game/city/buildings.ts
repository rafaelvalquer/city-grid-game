import { nanoid } from 'nanoid';
import type { Building, BuildingType, Tile } from '../../types/city.types';
import { BUILDING_CONFIG } from '../config/buildingConfig';
import { getNeighbors4, isRoadType } from './grid';

export function createBuilding(type: BuildingType, x: number, y: number): Building {
  const cfg = BUILDING_CONFIG[type];
  return {
    id: nanoid(8),
    type,
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

export function updateBuildingConnection(building: Building, grid: Tile[][]): Building {
  const road = getNeighbors4({ x: building.x, y: building.y }).find((n) => isRoadType(grid[n.y][n.x].type));
  return { ...building, connected: Boolean(road), nearestRoad: road };
}
