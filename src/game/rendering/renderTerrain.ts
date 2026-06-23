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

export function drawCampaignVegetation(graphics: Graphics, tile: Tile, x: number, y: number, ts: number): void {
  const kind = tile.vegetationKind;
  if (!kind || tile.type !== 'empty') return;
  const px = x * ts;
  const py = y * ts;
  const variant = hash2(x, y, kind.length);
  if (kind === 'atlanticForest') {
    drawTree(graphics, px + 13, py + 25, 6);
    drawTree(graphics, px + 26, py + 19, 5);
    graphics.circle(px + 27, py + 29, 3).fill({ color: 0x4f9d58, alpha: 0.85 });
  } else if (kind === 'palm') {
    graphics.rect(px + 19, py + 16, 2.5, 16).fill({ color: 0x9a7246, alpha: 0.9 });
    for (let angle = 0; angle < 6; angle += 1) {
      const radians = angle * Math.PI / 3;
      graphics.ellipse(px + 20 + Math.cos(radians) * 5, py + 14 + Math.sin(radians) * 3, 5, 2).fill({ color: 0x3d9b5e, alpha: 0.88 });
    }
  } else if (kind === 'temperateConifer') {
    for (const [ox, oy, size] of [[12, 27, 7], [25, 23, 6]] as const) {
      graphics.rect(px + ox - 1, py + oy - 5, 2, 8).fill({ color: 0x654b36, alpha: 0.8 });
      graphics.poly([px + ox, py + oy - size * 2, px + ox - size, py + oy, px + ox + size, py + oy]).fill(0x27624f);
      graphics.poly([px + ox, py + oy - size * 1.4, px + ox - size * 0.8, py + oy + 3, px + ox + size * 0.8, py + oy + 3]).fill(0x347a5d);
    }
  } else if (kind === 'fern') {
    for (let leaf = 0; leaf < 5; leaf += 1) {
      const angle = -Math.PI + leaf * Math.PI / 4;
      graphics.moveTo(px + 20, py + 25).lineTo(px + 20 + Math.cos(angle) * 10, py + 25 + Math.sin(angle) * 8).stroke({ color: 0x4f8f61, width: 2, alpha: 0.8 });
    }
  } else if (kind === 'deciduous' || kind === 'willow') {
    graphics.rect(px + 19, py + 19, 3, 13).fill({ color: 0x79583d, alpha: 0.8 });
    const color = kind === 'willow' ? 0x7da85a : 0x5d9c64;
    graphics.ellipse(px + 20, py + 16, kind === 'willow' ? 9 : 7, kind === 'willow' ? 12 : 7).fill({ color, alpha: 0.82 });
    if (kind === 'willow') for (const dx of [-6, -2, 3, 6]) graphics.rect(px + 20 + dx, py + 18, 1, 11).fill({ color: 0x6e9650, alpha: 0.55 });
  } else if (kind === 'reeds') {
    for (let reed = 0; reed < 7; reed += 1) {
      const rx = px + 9 + reed * 3 + (variant % 2);
      graphics.moveTo(rx, py + 31).lineTo(rx + (reed % 2), py + 18 + reed % 4).stroke({ color: 0x7e9d54, width: 1.5, alpha: 0.86 });
    }
  } else if (kind === 'andeanForest' || kind === 'koreanPine') {
    const dark = kind === 'andeanForest' ? 0x245b3b : 0x214f45;
    const light = kind === 'andeanForest' ? 0x3f8050 : 0x397466;
    for (const [ox, oy, size] of [[12, 28, 6], [25, 24, 7]] as const) {
      graphics.rect(px + ox - 1, py + oy - 7, 2, 10).fill({ color: 0x66503a, alpha: 0.78 });
      graphics.poly([px + ox, py + oy - size * 2, px + ox - size, py + oy, px + ox + size, py + oy]).fill(dark);
      graphics.poly([px + ox, py + oy - size * 1.25, px + ox - size * 0.8, py + oy + 3, px + ox + size * 0.8, py + oy + 3]).fill(light);
    }
  } else if (kind === 'paramoShrub') {
    for (const [ox, oy] of [[12, 26], [21, 21], [29, 28]] as const) {
      graphics.circle(px + ox, py + oy, 3.5).fill({ color: 0x87934f, alpha: 0.84 });
      graphics.moveTo(px + ox, py + oy).lineTo(px + ox, py + oy - 7).stroke({ color: 0x6f7d3f, width: 1.4 });
      graphics.circle(px + ox, py + oy - 8, 1.6).fill({ color: 0xd8d18a, alpha: 0.9 });
    }
  } else if (kind === 'cherryTree') {
    graphics.rect(px + 19, py + 19, 3, 13).fill({ color: 0x73513f, alpha: 0.82 });
    graphics.circle(px + 17, py + 16, 6).fill({ color: 0xf3a9bf, alpha: 0.84 });
    graphics.circle(px + 24, py + 15, 6).fill({ color: 0xf7bfd0, alpha: 0.86 });
    graphics.circle(px + 21, py + 11, 5).fill({ color: 0xffd3df, alpha: 0.82 });
  } else if (kind === 'tropicalRainforest') {
    drawTree(graphics, px + 12, py + 26, 6.5);
    drawTree(graphics, px + 25, py + 20, 5.5);
    graphics.circle(px + 29, py + 29, 4).fill({ color: 0x217a4a, alpha: 0.9 });
    graphics.circle(px + 19, py + 29, 3).fill({ color: 0x55a95e, alpha: 0.82 });
  } else if (kind === 'mangrove') {
    for (const ox of [12, 21, 29]) {
      graphics.moveTo(px + ox, py + 28).lineTo(px + ox - 3, py + 34).stroke({ color: 0x73553f, width: 1.4 });
      graphics.moveTo(px + ox, py + 28).lineTo(px + ox + 3, py + 34).stroke({ color: 0x73553f, width: 1.4 });
      graphics.rect(px + ox - 1, py + 18, 2, 11).fill({ color: 0x73553f, alpha: 0.85 });
      graphics.circle(px + ox, py + 17, 4.5).fill({ color: 0x39795b, alpha: 0.86 });
    }
  } else if (kind === 'araucaria') {
    graphics.rect(px + 19, py + 15, 3, 18).fill({ color: 0x6c4d35, alpha: 0.88 });
    graphics.circle(px + 20, py + 13, 4).fill({ color: 0x285d42, alpha: 0.92 });
    graphics.ellipse(px + 20, py + 17, 11, 3.5).fill({ color: 0x347554, alpha: 0.9 });
    graphics.ellipse(px + 20, py + 21, 8, 3).fill({ color: 0x285d42, alpha: 0.88 });
  } else if (kind === 'formalGarden') {
    graphics.roundRect(px + 7, py + 8, ts - 14, ts - 16, 7).fill({ color: 0x6da95e, alpha: 0.35 });
    graphics.rect(px + 19, py + 9, 2, 24).fill({ color: 0xdacda8, alpha: 0.65 });
    graphics.rect(px + 8, py + 20, 24, 2).fill({ color: 0xdacda8, alpha: 0.65 });
    for (const [ox, oy] of [[12,14],[27,14],[12,27],[27,27]] as const) graphics.circle(px + ox, py + oy, 3).fill({ color: 0x477d4c, alpha: 0.88 });
  } else if (kind === 'planeTree') {
    graphics.rect(px + 19, py + 18, 3, 14).fill({ color: 0x8b7658, alpha: 0.86 });
    graphics.circle(px + 16, py + 16, 6).fill({ color: 0x6c9850, alpha: 0.86 });
    graphics.circle(px + 24, py + 15, 6).fill({ color: 0x7ba65b, alpha: 0.88 });
    graphics.circle(px + 20, py + 11, 5).fill({ color: 0x8bb768, alpha: 0.82 });
  } else if (kind === 'ginkgo') {
    graphics.rect(px + 19, py + 18, 3, 14).fill({ color: 0x79583d, alpha: 0.84 });
    graphics.circle(px + 17, py + 16, 6).fill({ color: 0xd8b43e, alpha: 0.88 });
    graphics.circle(px + 24, py + 15, 6).fill({ color: 0xe4c14d, alpha: 0.9 });
    graphics.circle(px + 21, py + 10, 5).fill({ color: 0xf0cf5b, alpha: 0.86 });
  } else if (kind === 'banyan') {
    graphics.rect(px + 18, py + 17, 5, 16).fill({ color: 0x6a4e37, alpha: 0.9 });
    for (const dx of [-7, -3, 4, 8]) graphics.moveTo(px + 20 + dx * 0.3, py + 20).lineTo(px + 20 + dx, py + 34).stroke({ color: 0x74543a, width: 1.2, alpha: 0.75 });
    graphics.ellipse(px + 20, py + 14, 13, 8).fill({ color: 0x2f744d, alpha: 0.9 });
    graphics.circle(px + 11, py + 16, 5).fill({ color: 0x3d8757, alpha: 0.84 });
    graphics.circle(px + 29, py + 16, 5).fill({ color: 0x3d8757, alpha: 0.84 });
  } else {
    const shrub = kind === 'protea' ? 0x9c4f70 : 0x87975e;
    for (const [ox, oy] of [[12, 25], [22, 20], [29, 28]] as const) {
      graphics.circle(px + ox, py + oy, kind === 'protea' ? 4 : 3).fill({ color: shrub, alpha: 0.82 });
      if (kind === 'protea') graphics.circle(px + ox, py + oy - 1, 1.8).fill({ color: 0xf39aa9, alpha: 0.92 });
    }
  }
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

