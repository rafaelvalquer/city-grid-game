import { GAME_CONFIG } from '../config/gameConfig';
import type { Tile, TileType, Vec2 } from '../../types/city.types';

let activeGridWidth = GAME_CONFIG.gridWidth;
let activeGridHeight = GAME_CONFIG.gridHeight;

export function setGridBounds(width: number, height: number): void {
  activeGridWidth = Math.max(1, Math.floor(width));
  activeGridHeight = Math.max(1, Math.floor(height));
}

export function getGridWidth(): number {
  return activeGridWidth;
}

export function getGridHeight(): number {
  return activeGridHeight;
}

export function createGrid(width = GAME_CONFIG.gridWidth, height = GAME_CONFIG.gridHeight): Tile[][] {
  setGridBounds(width, height);
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({ x, y, type: 'empty' as TileType }))
  );
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < activeGridWidth && y < activeGridHeight;
}

export function inBoundsForGrid(grid: Tile[][], x: number, y: number): boolean {
  return x >= 0 && y >= 0 && y < grid.length && x < (grid[y]?.length ?? 0);
}

export function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

export function getNeighbors4(pos: Vec2): Vec2[] {
  return [
    { x: pos.x + 1, y: pos.y },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x, y: pos.y - 1 },
  ].filter((p) => inBounds(p.x, p.y));
}

export function getNeighbors4ForGrid(grid: Tile[][], pos: Vec2): Vec2[] {
  return [
    { x: pos.x + 1, y: pos.y },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x, y: pos.y - 1 },
  ].filter((p) => inBoundsForGrid(grid, p.x, p.y));
}

export function isRoadType(type: TileType | undefined): boolean {
  return type === 'road' || type === 'avenue' || type === 'roundabout';
}


export function isTerrainBlocked(tile: Tile | undefined): boolean {
  return tile?.type === 'mountain' || tile?.type === 'lake';
}


export function isTerrainType(type: TileType | undefined): boolean {
  return type === 'mountain' || type === 'lake';
}
