import type { Vec2 } from '../../types/city.types';

export function buildMetroTrackTiles(from: Vec2, to: Vec2): Vec2[] {
  const horizontalFirst = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const corner = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  return dedupeMetroTiles([...lineBetween(from, corner), ...lineBetween(corner, to)]);
}

function lineBetween(from: Vec2, to: Vec2): Vec2[] {
  const tiles: Vec2[] = [];
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);

  if (from.y === to.y) {
    for (let x = from.x; dx >= 0 ? x <= to.x : x >= to.x; x += dx || 1) {
      tiles.push({ x, y: from.y });
      if (x === to.x) break;
    }
    return tiles;
  }

  if (from.x === to.x) {
    for (let y = from.y; dy >= 0 ? y <= to.y : y >= to.y; y += dy || 1) {
      tiles.push({ x: from.x, y });
      if (y === to.y) break;
    }
    return tiles;
  }

  return [from, to];
}

function dedupeMetroTiles(tiles: Vec2[]): Vec2[] {
  const seen = new Set<string>();
  const result: Vec2[] = [];
  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tile);
  }
  return result;
}

export function pickMetroLineColor(index: number): string {
  const colors = ['#5cc8ff', '#c084fc', '#35d07f', '#f4c542', '#ff7aa2', '#22d3ee'];
  return colors[index % colors.length];
}
