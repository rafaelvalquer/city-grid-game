import type { Tile } from '../../types/city.types';

export function createTile(x: number, y: number): Tile {
  return { x, y, type: 'empty' };
}
