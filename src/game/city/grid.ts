import { GAME_CONFIG } from '../config/gameConfig';
import type { Tile, TileType, Vec2 } from '../../types/city.types';

export function createGrid(): Tile[][] {
  return Array.from({ length: GAME_CONFIG.gridHeight }, (_, y) =>
    Array.from({ length: GAME_CONFIG.gridWidth }, (_, x) => ({ x, y, type: 'empty' as TileType }))
  );
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GAME_CONFIG.gridWidth && y < GAME_CONFIG.gridHeight;
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

export function isRoadType(type: TileType): boolean {
  return type === 'road' || type === 'avenue' || type === 'roundabout';
}
