import type { Graphics } from 'pixi.js';
import type { Tile } from '../../types/city.types';
import { MAP_COLORS } from './visualTheme';
import type { LotDecor } from './renderTypes';
import { hash2 } from './renderUtils';
export function drawBaseTile(graphics: Graphics, tile: Tile, x: number, y: number, ts: number): void {
  const tone = hash2(x, y, 3) % 7;
  const base = tone === 0 ? MAP_COLORS.blockWarm : (x + y) % 2 === 0 ? MAP_COLORS.block : MAP_COLORS.blockAlt;
  graphics.rect(x * ts, y * ts, ts, ts).fill(base).stroke({ width: 1, color: MAP_COLORS.grid, alpha: 0.28 });
  if (tile.type === 'empty') {
    const inset = 5 + (hash2(x, y, 5) % 2);
    graphics.roundRect(x * ts + inset, y * ts + inset, ts - inset * 2, ts - inset * 2, 6).stroke({ width: 1, color: MAP_COLORS.lotStroke, alpha: 0.18 + (tone % 3) * 0.035 });
  }
}


export function drawLotDecoration(graphics: Graphics, x: number, y: number, ts: number): void {
  const decor = lotDecorAt(x, y);
  if (decor === 'plain') return;

  const px = x * ts;
  const py = y * ts;
  if (decor === 'trees') {
    drawTree(graphics, px + 13, py + 25, 5);
    drawTree(graphics, px + 25, py + 18, 4);
    if (hash2(x, y, 9) % 2 === 0) drawTree(graphics, px + 28, py + 29, 3.5);
    return;
  }

  if (decor === 'park') {
    graphics.roundRect(px + 7, py + 7, ts - 14, ts - 14, 8).fill({ color: MAP_COLORS.park, alpha: 0.54 });
    graphics.circle(px + 15, py + 17, 4).fill({ color: MAP_COLORS.treeLight, alpha: 0.82 });
    graphics.circle(px + 27, py + 25, 4).fill({ color: MAP_COLORS.tree, alpha: 0.78 });
    graphics.rect(px + 13, py + 29, 14, 2).fill({ color: MAP_COLORS.lotStroke, alpha: 0.28 });
    return;
  }

  if (decor === 'plaza') {
    graphics.roundRect(px + 8, py + 8, ts - 16, ts - 16, 5).fill({ color: MAP_COLORS.plaza, alpha: 0.5 });
    graphics.rect(px + 13, py + 13, ts - 26, 1).fill({ color: MAP_COLORS.parkingLine, alpha: 0.34 });
    graphics.rect(px + 13, py + ts - 14, ts - 26, 1).fill({ color: MAP_COLORS.parkingLine, alpha: 0.34 });
    graphics.circle(px + ts / 2, py + ts / 2, 3).fill({ color: MAP_COLORS.garden, alpha: 0.76 });
    drawTree(graphics, px + 12, py + 27, 3.2);
    return;
  }

  if (decor === 'parking') {
    graphics.roundRect(px + 7, py + 8, ts - 14, ts - 15, 4).fill({ color: MAP_COLORS.parking, alpha: 0.34 });
    for (let i = 0; i < 3; i += 1) {
      graphics.rect(px + 11 + i * 8, py + 12, 1, 18).fill({ color: MAP_COLORS.parkingLine, alpha: 0.42 });
    }
    graphics.rect(px + 10, py + 30, ts - 20, 1).fill({ color: MAP_COLORS.parkingLine, alpha: 0.42 });
    return;
  }

  graphics.roundRect(px + 8, py + 9, ts - 16, ts - 18, 7).fill({ color: MAP_COLORS.garden, alpha: 0.2 });
  graphics.circle(px + 14, py + 17, 2.2).fill({ color: MAP_COLORS.garden, alpha: 0.8 });
  graphics.circle(px + 22, py + 24, 2.2).fill({ color: MAP_COLORS.lane, alpha: 0.72 });
  graphics.circle(px + 29, py + 17, 2).fill({ color: MAP_COLORS.officeGlass, alpha: 0.7 });
}


export function drawTree(graphics: Graphics, x: number, y: number, radius: number): void {
  graphics.circle(x + 3, y + 4, radius).fill({ color: MAP_COLORS.shadow, alpha: 0.18 });
  graphics.circle(x + radius * 0.15, y + radius * 0.15, radius * 0.88).fill(MAP_COLORS.treeDark);
  graphics.circle(x, y, radius).fill(MAP_COLORS.tree);
  graphics.circle(x - radius * 0.45, y + radius * 0.15, radius * 0.55).fill(MAP_COLORS.treeLight);
}


export function lotDecorAt(x: number, y: number): LotDecor {
  const value = hash2(x, y, 17) % 100;
  if (value < 10) return 'park';
  if (value < 23) return 'trees';
  if (value < 31) return 'parking';
  if (value < 38) return 'plaza';
  if (value < 49) return 'garden';
  return 'plain';
}

