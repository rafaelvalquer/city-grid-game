const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SUFFIX = '.bak-bike-lane-sidewalk-visual-fix';

function filePath(rel) {
  return path.join(ROOT, rel);
}

function read(rel) {
  const full = filePath(rel);
  if (!fs.existsSync(full)) throw new Error('Arquivo não encontrado: ' + rel);
  return fs.readFileSync(full, 'utf8');
}

function write(rel, content) {
  const full = filePath(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full)) {
    const backup = full + SUFFIX;
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, fs.readFileSync(full));
  }
  fs.writeFileSync(full, content, 'utf8');
}

function replaceOrThrow(content, pattern, replacement, label) {
  const next = content.replace(pattern, replacement);
  if (next === content) throw new Error('Não foi possível aplicar patch: ' + label);
  return next;
}

function patchBikeConfig() {
  const rel = 'src/game/config/bikeConfig.ts';
  let s = read(rel);

  // A faixa da ciclovia passa a representar a calçada/borda da rua em azul,
  // contrastando com o quadradinho verde da bicicleta.
  s = s.replace(/laneColor:\s*0x[0-9a-fA-F]+,/, 'laneColor: 0x2563eb,');
  s = s.replace(/laneEdgeColor:\s*0x[0-9a-fA-F]+,/, 'laneEdgeColor: 0x93c5fd,');
  s = s.replace(/laneIconColor:\s*0x[0-9a-fA-F]+,/, 'laneIconColor: 0xdbeafe,');
  s = s.replace(/bikeBodyColor:\s*0x[0-9a-fA-F]+,/, 'bikeBodyColor: 0x22c55e,');
  s = s.replace(/bikeWheelColor:\s*0x[0-9a-fA-F]+,/, 'bikeWheelColor: 0xecfeff,');
  s = s.replace(/bikeTrailColor:\s*0x[0-9a-fA-F]+,/, 'bikeTrailColor: 0x22c55e,');

  write(rel, s);
}

function patchRenderBikes() {
  const rel = 'src/game/rendering/renderBikes.ts';
  const content = `import type { Graphics } from 'pixi.js';
import type { Vec2 } from '../../types/city.types';
import { BIKE_LANE_CONFIG } from '../config/bikeConfig';
import type { GameWorld } from '../engine/simulation';

function interpolate(route: Vec2[], progress: number): { x: number; y: number; angle: number; from: Vec2; to: Vec2 } | null {
  if (route.length < 2) return null;
  const index = Math.max(0, Math.min(route.length - 2, Math.floor(progress)));
  const t = Math.max(0, Math.min(1, progress - index));
  const from = route[index];
  const to = route[index + 1];
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  return { x, y, angle: Math.atan2(to.y - from.y, to.x - from.x), from, to };
}

function bikeSidewalkOffset(angle: number, ts: number): { x: number; y: number } {
  // Posiciona a bicicleta sobre a calçada/borda pintada de azul, não no meio da rua.
  // O deslocamento usa o vetor perpendicular à direção da viagem.
  const sideX = -Math.sin(angle);
  const sideY = Math.cos(angle);
  return { x: sideX * ts * 0.34, y: sideY * ts * 0.34 };
}

function bikePixelPose(route: Vec2[], progress: number, ts: number): { x: number; y: number; angle: number } | null {
  const pose = interpolate(route, progress);
  if (!pose) return null;
  const offset = bikeSidewalkOffset(pose.angle, ts);
  return {
    x: pose.x * ts + ts / 2 + offset.x,
    y: pose.y * ts + ts / 2 + offset.y,
    angle: pose.angle,
  };
}

function drawBikeTrail(graphics: Graphics, route: Vec2[], progress: number, ts: number): void {
  const current = bikePixelPose(route, progress, ts);
  const previous = bikePixelPose(route, Math.max(0, progress - 0.55), ts);
  if (!current || !previous) return;
  graphics
    .moveTo(previous.x, previous.y)
    .lineTo(current.x, current.y)
    .stroke({ color: BIKE_LANE_CONFIG.bikeTrailColor, width: 2.2, alpha: 0.16 });
}

function drawBikeSquare(graphics: Graphics, cx: number, cy: number, angle: number, timeSeconds: number): void {
  // Representação discreta: um pequeno quadradinho verde sobre a calçada azul.
  // Sem rodas/corpo grande para não parecer que está andando no meio da rua.
  const pulse = 0.5 + Math.sin(timeSeconds * 6.5 + cx * 0.01 + cy * 0.01) * 0.5;
  const size = 5.2 + pulse * 0.45;
  const glowSize = size + 3.2;
  const lean = Math.sin(angle) * 0.6;

  graphics.roundRect(cx - glowSize / 2 + lean, cy - glowSize / 2, glowSize, glowSize, 2.5)
    .fill({ color: BIKE_LANE_CONFIG.bikeBodyColor, alpha: 0.11 });
  graphics.roundRect(cx - size / 2 + lean, cy - size / 2, size, size, 1.6)
    .fill({ color: BIKE_LANE_CONFIG.bikeBodyColor, alpha: 0.92 })
    .stroke({ color: BIKE_LANE_CONFIG.bikeWheelColor, width: 0.75, alpha: 0.78 });
  graphics.rect(cx - 1.2 + lean, cy - 1.2, 2.4, 2.4)
    .fill({ color: 0x052e16, alpha: 0.24 });
}

export function drawBikeTrips(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  for (const trip of world.bikeTrips) {
    const pose = bikePixelPose(trip.route, trip.progress, ts);
    if (!pose) continue;
    drawBikeTrail(graphics, trip.route, trip.progress, ts);
    drawBikeSquare(graphics, pose.x, pose.y, pose.angle, timeSeconds);
  }
}
`;
  write(rel, content);
}

function patchRenderRoads() {
  const rel = 'src/game/rendering/renderRoads.ts';
  let s = read(rel);

  if (!s.includes('export function drawBikeLaneMarking')) {
    throw new Error('drawBikeLaneMarking não encontrado. Aplique primeiro o pacote Ciclovia V1.');
  }

  const replacement = `

export function drawBikeLaneMarking(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number, autoTile: RoadAutoTile): void {
  const tile = grid[y]?.[x];
  if (tile?.type !== 'road' || !tile.bikeLane) return;

  const px = x * ts;
  const py = y * ts;
  const center = ts / 2;
  const horizontal = autoTile.horizontal || autoTile.connections.east || autoTile.connections.west || autoTile.shape === 'isolated';
  const vertical = autoTile.vertical || autoTile.connections.north || autoTile.connections.south || autoTile.shape === 'isolated';
  const alpha = autoTile.shape === 'cross' || autoTile.shape === 'tee' ? 0.74 : 0.94;

  // A ciclovia é representada como a própria borda/calçada da rua pintada de azul.
  // Não desenha ícone grande nem faixa no centro da pista.
  if (horizontal) {
    drawBikeSidewalkStrip(graphics, px + 4, py + center - 17, ts - 8, 4, alpha);
    drawBikeSidewalkStrip(graphics, px + 4, py + center + 13, ts - 8, 4, alpha);
  }

  if (vertical) {
    drawBikeSidewalkStrip(graphics, px + center - 17, py + 4, 4, ts - 8, alpha);
    drawBikeSidewalkStrip(graphics, px + center + 13, py + 4, 4, ts - 8, alpha);
  }
}

function drawBikeSidewalkStrip(graphics: Graphics, x: number, y: number, width: number, height: number, alpha: number): void {
  graphics.roundRect(x, y, width, height, 2)
    .fill({ color: BIKE_LANE_CONFIG.laneColor, alpha })
    .stroke({ color: BIKE_LANE_CONFIG.laneEdgeColor, width: 0.8, alpha: Math.min(0.86, alpha + 0.08) });
}
`;

  const withIconRegex = /\n\nexport function drawBikeLaneMarking[\s\S]*?\n\nfunction drawTinyBikeLaneIcon[\s\S]*?\n}\n/;
  const withoutIconRegex = /\n\nexport function drawBikeLaneMarking[\s\S]*?\n\nexport function drawRoundaboutIsland/;

  if (withIconRegex.test(s)) {
    s = s.replace(withIconRegex, replacement + '\n');
  } else if (withoutIconRegex.test(s)) {
    s = s.replace(withoutIconRegex, replacement + '\n\nexport function drawRoundaboutIsland');
  } else {
    throw new Error('Não foi possível substituir drawBikeLaneMarking em renderRoads.ts.');
  }

  write(rel, s);
}

function patchRenderUiOverlays() {
  const rel = 'src/game/rendering/renderUiOverlays.ts';
  let s = read(rel);

  // Ajusta cor do preview de linha da ciclovia para azul, mantendo a prévia discreta.
  s = s.replace(/isBikeLanePreview \? 0x[0-9a-fA-F]+ :/g, 'isBikeLanePreview ? 0x2563eb :');
  s = s.replace(/const roadW = isBikeLanePreview \? \d+ :/g, 'const roadW = isBikeLanePreview ? 6 :');

  if (s.includes("} else if (tool === 'bikeLane') {")) {
    s = replaceOrThrow(
      s,
      /  \} else if \(tool === 'bikeLane'\) \{[\s\S]*?\n  \} else if \(tool === 'busStop'\) \{/,
      `  } else if (tool === 'bikeLane') {
    // Preview discreto: pinta a borda/calçada, não o centro da pista.
    graphics.roundRect(px + 5, py + ts / 2 - 17, ts - 10, 4, 2)
      .fill({ color: valid ? 0x2563eb : MAP_COLORS.previewInvalid, alpha: valid ? 0.82 : 0.34 });
    graphics.roundRect(px + 5, py + ts / 2 + 13, ts - 10, 4, 2)
      .fill({ color: valid ? 0x2563eb : MAP_COLORS.previewInvalid, alpha: valid ? 0.82 : 0.34 });
    graphics.roundRect(px + ts / 2 - 17, py + 5, 4, ts - 10, 2)
      .fill({ color: valid ? 0x2563eb : MAP_COLORS.previewInvalid, alpha: valid ? 0.58 : 0.26 });
    graphics.roundRect(px + ts / 2 + 13, py + 5, 4, ts - 10, 2)
      .fill({ color: valid ? 0x2563eb : MAP_COLORS.previewInvalid, alpha: valid ? 0.58 : 0.26 });
  } else if (tool === 'busStop') {`,
      'preview bikeLane em renderUiOverlays.ts',
    );
  }

  write(rel, s);
}

function validate() {
  const requiredFiles = [
    'src/game/config/bikeConfig.ts',
    'src/game/rendering/renderBikes.ts',
    'src/game/rendering/renderRoads.ts',
    'src/game/rendering/renderUiOverlays.ts',
  ];

  for (const rel of requiredFiles) {
    const content = read(rel);
    if (content.includes('drawTinyBikeLaneIcon')) {
      throw new Error('Ainda existe drawTinyBikeLaneIcon em ' + rel + '.');
    }
    if (rel.endsWith('renderBikes.ts') && (content.includes('circle(rear') || content.includes('lineTo(front'))) {
      throw new Error('renderBikes.ts ainda parece usar ícone de bicicleta com rodas/corpo.');
    }
  }
}

function main() {
  patchBikeConfig();
  patchRenderBikes();
  patchRenderRoads();
  patchRenderUiOverlays();
  validate();

  console.log('Visual da ciclovia ajustado. Backups com sufixo ' + SUFFIX + '.');
  console.log('Execute: npm run build');
}

main();
