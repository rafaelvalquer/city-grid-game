#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const BACKUP_SUFFIX = '.bak-mobility-focus-district-terrain-fix';

function file(rel) { return path.join(ROOT, rel); }
function exists(rel) { return fs.existsSync(file(rel)); }
function read(rel) { return fs.readFileSync(file(rel), 'utf8'); }
function write(rel, content) {
  const abs = file(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs) && !fs.existsSync(abs + BACKUP_SUFFIX)) fs.copyFileSync(abs, abs + BACKUP_SUFFIX);
  fs.writeFileSync(abs, content, 'utf8');
  console.log('updated', rel);
}
function patch(rel, updater) {
  if (!exists(rel)) throw new Error('Arquivo não encontrado: ' + rel);
  const original = read(rel);
  const next = updater(original);
  if (next !== original) write(rel, next);
  else console.log('unchanged', rel);
}
function ensureImport(content, importLine, afterImportStartsWith) {
  if (content.includes(importLine)) return content;
  const lines = content.split('\n');
  let insertAt = -1;
  if (afterImportStartsWith) {
    insertAt = lines.findIndex((line) => line.startsWith(afterImportStartsWith));
  }
  if (insertAt >= 0) {
    lines.splice(insertAt + 1, 0, importLine);
    return lines.join('\n');
  }
  const lastImport = lines.reduce((last, line, idx) => line.startsWith('import ') ? idx : last, -1);
  if (lastImport >= 0) {
    lines.splice(lastImport + 1, 0, importLine);
    return lines.join('\n');
  }
  return importLine + '\n' + content;
}

function createRenderMobilityFocus() {
  const rel = 'src/game/rendering/renderMobilityFocus.ts';
  const content = `import type { Graphics } from 'pixi.js';
import type { MobilityFocusMode } from '../../store/gameStore';
import type { Car } from '../../types/agent.types';
import type { Vec2 } from '../../types/city.types';
import type { MetroLine } from '../../types/metro.types';
import type { GameWorld } from '../engine/simulation';

const DIM_COLOR = 0x020617;
const BIKE = 0x5cff9d;
const BIKE_LANE = 0x38e8ff;
const BUS = 0xffd166;
const BUS_LINE = 0xffa928;
const BUS_STOP = 0xfff2a6;
const BUS_LANE = 0x38bdf8;
const METRO = 0x9f7aea;
const METRO_LINE = 0x7dd3fc;
const METRO_STATION = 0xe0f2fe;
const METRO_TRAIN = 0xfacc15;

export function drawMobilityFocusOverlay(
  graphics: Graphics,
  world: GameWorld,
  mode: MobilityFocusMode,
  ts: number,
  timeSeconds: number,
): void {
  if (mode === 'off') return;

  drawMobilityFocusDim(graphics, world, ts);
  if (mode === 'bike') drawBikeFocusOverlay(graphics, world, ts, timeSeconds);
  if (mode === 'bus') drawBusFocusOverlay(graphics, world, ts, timeSeconds);
  if (mode === 'metro') drawMetroFocusOverlay(graphics, world, ts, timeSeconds);
}

function drawMobilityFocusDim(graphics: Graphics, world: GameWorld, ts: number): void {
  const width = (world.grid[0]?.length ?? 0) * ts;
  const height = world.grid.length * ts;
  if (width <= 0 || height <= 0) return;
  graphics.rect(0, 0, width, height).fill({ color: DIM_COLOR, alpha: 0.64 });
}

function drawBikeFocusOverlay(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  const pulse = 0.45 + Math.sin(timeSeconds * 3.2) * 0.18;

  for (let y = 0; y < world.grid.length; y += 1) {
    const row = world.grid[y];
    for (let x = 0; x < (row?.length ?? 0); x += 1) {
      const tile = row?.[x];
      if (!tile?.bikeLane) continue;
      const px = x * ts;
      const py = y * ts;
      const horizontal = isMostlyHorizontalRoad(world.grid, x, y);
      if (horizontal) {
        graphics.roundRect(px + 4, py + ts - 8, ts - 8, 4, 3).fill({ color: BIKE_LANE, alpha: 0.88 });
        graphics.roundRect(px + 7, py + ts - 11, ts - 14, 10, 6).stroke({ color: BIKE_LANE, width: 1.4, alpha: 0.28 + pulse });
      } else {
        graphics.roundRect(px + ts - 8, py + 4, 4, ts - 8, 3).fill({ color: BIKE_LANE, alpha: 0.88 });
        graphics.roundRect(px + ts - 11, py + 7, 10, ts - 14, 6).stroke({ color: BIKE_LANE, width: 1.4, alpha: 0.28 + pulse });
      }
    }
  }

  const bikeTrips = Array.isArray(world.bikeTrips) ? world.bikeTrips : [];
  for (const bike of bikeTrips) {
    if (!bike.route?.length) continue;
    drawBikeRouteTrail(graphics, bike.route, bike.progress, ts);
    const pos = interpolateRoute(bike.route, bike.progress);
    const px = pos.x * ts + ts / 2;
    const py = pos.y * ts + ts / 2;
    graphics.roundRect(px - 5, py - 5, 10, 10, 3).fill({ color: BIKE, alpha: 0.95 });
    graphics.roundRect(px - 8, py - 8, 16, 16, 6).stroke({ color: BIKE, width: 1.4, alpha: 0.25 + pulse });
  }
}

function drawBusFocusOverlay(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  const pulse = 0.5 + Math.sin(timeSeconds * 3.5) * 0.22;

  for (let y = 0; y < world.grid.length; y += 1) {
    const row = world.grid[y];
    for (let x = 0; x < (row?.length ?? 0); x += 1) {
      const tile = row?.[x];
      if (!tile?.busLane) continue;
      graphics.roundRect(x * ts + 5, y * ts + ts / 2 - 3, ts - 10, 6, 4).fill({ color: BUS_LANE, alpha: 0.82 });
      graphics.roundRect(x * ts + 3, y * ts + 3, ts - 6, ts - 6, 7).stroke({ color: BUS_LANE, width: 1.2, alpha: 0.18 + pulse * 0.35 });
    }
  }

  drawPolyline(graphics, world.transitLine?.route ?? [], ts, BUS_LINE, 5, 0.64);
  drawPolyline(graphics, world.transitLine?.route ?? [], ts, 0xffffff, 1.2, 0.34);

  for (const stop of world.transitStops ?? []) {
    const cx = stop.x * ts + ts / 2;
    const cy = stop.y * ts + ts / 2;
    graphics.circle(cx, cy, 16 + pulse * 4).fill({ color: BUS_STOP, alpha: 0.13 + pulse * 0.08 });
    graphics.circle(cx, cy, 9).fill({ color: BUS_STOP, alpha: 0.92 });
    graphics.circle(cx, cy, 4).fill({ color: DIM_COLOR, alpha: 0.74 });
  }

  for (const bus of world.cars.filter((car) => car.vehicleType === 'bus')) {
    drawFocusedVehicle(graphics, bus, ts, BUS, 18, 10);
  }
}

function drawMetroFocusOverlay(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  const pulse = 0.5 + Math.sin(timeSeconds * 3.2) * 0.22;

  for (const track of world.metroTracks ?? []) {
    if (!track.active || !track.tiles || track.tiles.length < 2) continue;
    drawPolyline(graphics, track.tiles, ts, METRO_LINE, 7, 0.34);
    drawPolyline(graphics, track.tiles, ts, METRO_STATION, 2, 0.28);
  }

  for (const line of world.metroLines ?? []) {
    if (!line.active || line.stationIds.length < 2) continue;
    const color = parseLineColor(line);
    for (let index = 0; index < line.stationIds.length - 1; index += 1) {
      const fromId = line.stationIds[index];
      const toId = line.stationIds[index + 1];
      const tiles = world.getMetroTrackTilesBetween(fromId, toId);
      if (tiles.length >= 2) {
        drawPolyline(graphics, tiles, ts, color, 5, 0.9);
      } else {
        const from = world.getMetroStation(fromId);
        const to = world.getMetroStation(toId);
        if (from && to) drawPolyline(graphics, [from, to], ts, color, 5, 0.55);
      }
    }
  }

  for (const station of world.metroStations ?? []) {
    const cx = station.x * ts + ts / 2;
    const cy = station.y * ts + ts / 2;
    const active = station.activeLineIds?.length > 0;
    graphics.circle(cx, cy, 18 + pulse * 5).fill({ color: active ? METRO : METRO_LINE, alpha: 0.16 + pulse * 0.08 });
    graphics.circle(cx, cy, 10).fill({ color: active ? METRO : METRO_LINE, alpha: 0.92 });
    graphics.circle(cx, cy, 5).fill({ color: METRO_STATION, alpha: 0.96 });
  }

  for (const train of world.metroTrains ?? []) {
    const line = world.metroLines.find((candidate) => candidate.id === train.lineId);
    if (!line) continue;
    const from = world.getMetroStation(line.stationIds[train.stationIndex]);
    const to = world.getMetroStation(line.stationIds[train.nextStationIndex]);
    if (!from || !to) continue;
    const trackTiles = world.getMetroTrackTilesBetween(from.id, to.id);
    const pos = trackTiles.length >= 2
      ? interpolateNormalizedTrack(trackTiles, train.progress)
      : { x: from.x + (to.x - from.x) * train.progress, y: from.y + (to.y - from.y) * train.progress };
    const px = pos.x * ts + ts / 2;
    const py = pos.y * ts + ts / 2;
    graphics.circle(px, py, 16).fill({ color: parseLineColor(line), alpha: 0.22 });
    graphics.roundRect(px - 11, py - 6, 22, 12, 5).fill({ color: METRO_TRAIN, alpha: 0.98 });
    graphics.roundRect(px - 6, py - 2, 12, 4, 3).fill({ color: DIM_COLOR, alpha: 0.78 });
  }
}

function drawPolyline(graphics: Graphics, tiles: Vec2[], ts: number, color: number, width: number, alpha: number): void {
  if (tiles.length < 2) return;
  graphics.moveTo(tiles[0].x * ts + ts / 2, tiles[0].y * ts + ts / 2);
  for (let i = 1; i < tiles.length; i += 1) {
    graphics.lineTo(tiles[i].x * ts + ts / 2, tiles[i].y * ts + ts / 2);
  }
  graphics.stroke({ color, width, alpha });
}

function drawBikeRouteTrail(graphics: Graphics, route: Vec2[], progress: number, ts: number): void {
  const start = Math.max(0, Math.floor(progress) - 4);
  const end = Math.min(route.length - 1, Math.floor(progress) + 1);
  if (end <= start) return;
  graphics.moveTo(route[start].x * ts + ts / 2, route[start].y * ts + ts / 2);
  for (let i = start + 1; i <= end; i += 1) {
    graphics.lineTo(route[i].x * ts + ts / 2, route[i].y * ts + ts / 2);
  }
  graphics.stroke({ color: BIKE, width: 3, alpha: 0.28 });
}

function drawFocusedVehicle(graphics: Graphics, car: Car, ts: number, color: number, width: number, height: number): void {
  const px = car.x * ts + ts / 2;
  const py = car.y * ts + ts / 2;
  graphics.circle(px, py, 16).fill({ color, alpha: 0.16 });
  graphics.roundRect(px - width / 2, py - height / 2, width, height, 4).fill({ color, alpha: 0.96 });
  graphics.roundRect(px - width / 2 + 4, py - 2, width - 8, 4, 3).fill({ color: DIM_COLOR, alpha: 0.55 });
}

function interpolateRoute(route: Vec2[], progress: number): Vec2 {
  if (route.length < 2) return route[0] ?? { x: 0, y: 0 };
  const index = Math.max(0, Math.min(route.length - 2, Math.floor(progress)));
  const local = Math.max(0, Math.min(1, progress - index));
  const from = route[index];
  const to = route[index + 1];
  return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
}

function interpolateNormalizedTrack(tiles: Vec2[], progress: number): Vec2 {
  if (tiles.length < 2) return tiles[0] ?? { x: 0, y: 0 };
  const clamped = Math.max(0, Math.min(1, progress));
  const segmentCount = tiles.length - 1;
  const scaled = clamped * segmentCount;
  const index = Math.max(0, Math.min(segmentCount - 1, Math.floor(scaled)));
  const local = scaled - index;
  const from = tiles[index];
  const to = tiles[index + 1];
  return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
}

function parseLineColor(line: MetroLine): number {
  return Number(String(line.color ?? '').replace('#', '0x')) || METRO;
}

function isMostlyHorizontalRoad(grid: { type: string }[][], x: number, y: number): boolean {
  const west = grid[y]?.[x - 1]?.type;
  const east = grid[y]?.[x + 1]?.type;
  const north = grid[y - 1]?.[x]?.type;
  const south = grid[y + 1]?.[x]?.type;
  const horizontal = Number(west === 'road' || west === 'avenue') + Number(east === 'road' || east === 'avenue');
  const vertical = Number(north === 'road' || north === 'avenue') + Number(south === 'road' || south === 'avenue');
  return horizontal >= vertical;
}
`;
  write(rel, content);
}

function createMobilityFocusToggle() {
  const rel = 'src/components/MobilityFocusToggle.tsx';
  const content = `import { Bike, BusFront, Eye, TrainFront } from 'lucide-react';
import { useGameStore, type MobilityFocusMode } from '../store/gameStore';

const MODES: Array<{ id: MobilityFocusMode; label: string; shortLabel: string; Icon: typeof Eye }> = [
  { id: 'off', label: 'Normal', shortLabel: 'Normal', Icon: Eye },
  { id: 'bike', label: 'Bicicletas', shortLabel: 'Bike', Icon: Bike },
  { id: 'bus', label: 'Ônibus', shortLabel: 'Ônibus', Icon: BusFront },
  { id: 'metro', label: 'Metrô', shortLabel: 'Metrô', Icon: TrainFront },
];

export function MobilityFocusToggle() {
  const mode = useGameStore((s) => s.mobilityFocusMode);
  const setMode = useGameStore((s) => s.setMobilityFocusMode);
  const setViewLayer = useGameStore((s) => s.setViewLayer);
  const stats = useGameStore((s) => s.stats);
  const metrics = stats as typeof stats & Record<string, number | string | boolean | undefined>;

  function choose(nextMode: MobilityFocusMode): void {
    setMode(nextMode);
    if (nextMode === 'metro') setViewLayer('underground');
    if (nextMode === 'bike' || nextMode === 'bus') setViewLayer('surface');
  }

  return (
    <div className="mobility-focus-widget">
      <div className="mobility-focus-toggle" role="group" aria-label="Visualização focada">
        <span className="mobility-focus-title"><Eye size={14} /> Visualização</span>
        {MODES.map(({ id, shortLabel, Icon }) => (
          <button
            key={id}
            type="button"
            className={mode === id ? 'active' : ''}
            aria-pressed={mode === id}
            onClick={() => choose(id)}
            title={id === 'off' ? 'Mapa normal' : 'Destacar ' + shortLabel}
          >
            <Icon size={14} />
            {shortLabel}
          </button>
        ))}
      </div>
      {mode !== 'off' && (
        <div className={'mobility-focus-summary ' + mode}>
          <strong>{mode === 'bike' ? 'Bicicletas' : mode === 'bus' ? 'Ônibus' : 'Metrô'}</strong>
          {mode === 'bike' && (
            <>
              <span>Viagens: {metrics.bikeTripsCompleted ?? 0}</span>
              <span>Carros evitados: {metrics.bikeCarsAvoided ?? 0}</span>
              <span>Ciclovias: {metrics.bikeLaneTiles ?? 0} tiles</span>
            </>
          )}
          {mode === 'bus' && (
            <>
              <span>Ativos: {metrics.activeBuses ?? 0}</span>
              <span>Pontos: {metrics.transitStops ?? 0}</span>
              <span>Esperando: {metrics.waitingPassengers ?? 0}</span>
            </>
          )}
          {mode === 'metro' && (
            <>
              <span>Estações: {metrics.metroStations ?? 0}</span>
              <span>Linhas: {metrics.metroLines ?? 0}</span>
              <span>Trens: {metrics.metroTrains ?? 0}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
`;
  write(rel, content);
}

function patchGameStore() {
  patch('src/store/gameStore.ts', (c) => {
    if (!c.includes("export type MobilityFocusMode = 'off' | 'bike' | 'bus' | 'metro';")) {
      c = c.replace("export type ViewLayer = 'surface' | 'underground';", "export type ViewLayer = 'surface' | 'underground';\nexport type MobilityFocusMode = 'off' | 'bike' | 'bus' | 'metro';");
    }
    if (!c.includes('mobilityFocusMode: MobilityFocusMode;')) {
      c = c.replace('  viewLayer: ViewLayer;\n', '  viewLayer: ViewLayer;\n  mobilityFocusMode: MobilityFocusMode;\n');
    }
    if (!c.includes('setMobilityFocusMode: (mode: MobilityFocusMode) => void;')) {
      c = c.replace('  setViewLayer: (viewLayer: ViewLayer) => void;\n', '  setViewLayer: (viewLayer: ViewLayer) => void;\n  setMobilityFocusMode: (mode: MobilityFocusMode) => void;\n');
    }
    if (!c.includes("mobilityFocusMode: 'off'")) {
      c = c.replace("  viewLayer: 'surface',\n", "  viewLayer: 'surface',\n  mobilityFocusMode: 'off',\n");
    }
    if (!c.includes('setMobilityFocusMode: (mobilityFocusMode) => set({ mobilityFocusMode })')) {
      c = c.replace('  setViewLayer: (viewLayer) => set({ viewLayer }),\n', '  setViewLayer: (viewLayer) => set({ viewLayer }),\n  setMobilityFocusMode: (mobilityFocusMode) => set({ mobilityFocusMode }),\n');
    }
    return c;
  });
}

function patchPixiGame() {
  patch('src/game/rendering/PixiGame.tsx', (c) => {
    c = ensureImport(c, "import { MobilityFocusToggle } from '../../components/MobilityFocusToggle';", "import { LayerToggle }");
    if (!c.includes('const mobilityFocusMode = useGameStore((s) => s.mobilityFocusMode);')) {
      c = c.replace('  const viewLayer = useGameStore((s) => s.viewLayer);\n', '  const viewLayer = useGameStore((s) => s.viewLayer);\n  const mobilityFocusMode = useGameStore((s) => s.mobilityFocusMode);\n');
    }
    // Insere o novo argumento no renderWorld somente se ainda não estiver sendo passado.
    if (!/viewLayer,\s*\n\s*mobilityFocusMode,\s*\n\s*particles/.test(c)) {
      c = c.replace(
        '          viewLayer,\n          particles,',
        '          viewLayer,\n          mobilityFocusMode,\n          particles,',
      );
    }
    if (!c.includes('<MobilityFocusToggle />')) {
      c = c.replace('      <LayerToggle />', '      <LayerToggle />\n      <MobilityFocusToggle />');
    }
    return c;
  });
}

function patchRenderWorld() {
  patch('src/game/rendering/renderWorld.ts', (c) => {
    // Corrige import do tipo.
    if (!c.includes('MobilityFocusMode')) {
      c = c.replace(
        "import type { HeatmapMode, HoverPreview, ViewLayer } from '../../store/gameStore';",
        "import type { HeatmapMode, HoverPreview, ViewLayer, MobilityFocusMode } from '../../store/gameStore';",
      );
    }
    c = ensureImport(c, "import { drawMobilityFocusOverlay } from './renderMobilityFocus';", "import { renderMetroLayer }");

    // Assinatura pública: viewLayer, mobilityFocusMode, particles, visibleBounds.
    if (!/viewLayer:\s*ViewLayer,\s*\n\s*mobilityFocusMode:\s*MobilityFocusMode/.test(c)) {
      c = c.replace(
        '  viewLayer: ViewLayer,\n  particles?: ParticleSystem,\n  visibleBounds?: ViewportTileBounds,',
        "  viewLayer: ViewLayer,\n  mobilityFocusMode: MobilityFocusMode = 'off',\n  particles?: ParticleSystem,\n  visibleBounds?: ViewportTileBounds,",
      );
    }

    if (!/renderDynamicLayer\(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, mobilityFocusMode, visibleBounds\)/.test(c)) {
      c = c.replace(
        'renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, visibleBounds)',
        'renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, mobilityFocusMode, visibleBounds)',
      );
    }

    if (!/viewLayer:\s*ViewLayer,\s*\n\s*mobilityFocusMode:\s*MobilityFocusMode,\s*\n\s*visibleBounds\?: ViewportTileBounds/.test(c)) {
      c = c.replace(
        '  viewLayer: ViewLayer,\n  visibleBounds?: ViewportTileBounds,',
        '  viewLayer: ViewLayer,\n  mobilityFocusMode: MobilityFocusMode,\n  visibleBounds?: ViewportTileBounds,',
      );
    }

    // No subsolo, escurece e redesenha destaque por cima da camada de metrô.
    if (!c.includes('drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);\n    if (hoverPreview)')) {
      c = c.replace(
        '    renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);\n    if (hoverPreview) drawConstructionPreview',
        '    renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);\n    drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);\n    if (hoverPreview) drawConstructionPreview',
      );
    }

    // Na superfície, insere após veículos/bikes e antes de preview/seleção.
    if (!c.includes('drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);\n\n  if (hoverPreview)')) {
      c = c.replace(
        '  drawBikeTrips(graphics, world, ts, timeSeconds);\n\n  if (hoverPreview)',
        '  drawBikeTrips(graphics, world, ts, timeSeconds);\n  drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);\n\n  if (hoverPreview)',
      );
    }

    return c;
  });
}

function patchRenderMetro() {
  patch('src/game/rendering/renderMetro.ts', (c) => {
    c = c.replace(
      '  const width = GAME_CONFIG.gridWidth * ts;\n  const height = GAME_CONFIG.gridHeight * ts;',
      '  const width = (world.grid[0]?.length ?? GAME_CONFIG.gridWidth) * ts;\n  const height = (world.grid.length || GAME_CONFIG.gridHeight) * ts;',
    );
    return c;
  });
}

function patchSimulationTerrainDistrict() {
  patch('src/game/engine/simulation.ts', (c) => {
    // Garante imports se o patch anterior de relevo falhou parcialmente.
    if (!c.includes("import { TERRAIN_CONFIG } from '../config/terrainConfig';")) {
      c = c.replace("import { DISTRICT_EXPANSION_CONFIG } from '../config/districtConfig';", "import { DISTRICT_EXPANSION_CONFIG } from '../config/districtConfig';\nimport { TERRAIN_CONFIG } from '../config/terrainConfig';");
    }
    if (!c.includes('generateTerrainReliefForBounds')) {
      c = c.replace("import { CityGenerator } from '../city/cityGenerator';", "import { CityGenerator } from '../city/cityGenerator';\nimport { generateTerrainReliefForBounds, getTerrainSummary } from '../city/terrainGenerator';");
    }
    if (!c.includes('private readonly enableTerrainRelief: boolean;')) {
      c = c.replace('  private readonly allowRoadDemolition: boolean;\n', '  private readonly allowRoadDemolition: boolean;\n  private readonly enableTerrainRelief: boolean;\n');
    }
    if (!c.includes('this.enableTerrainRelief = options.enableTerrainRelief ?? TERRAIN_CONFIG.enabledByDefault;')) {
      c = c.replace(
        '    this.initializeDistricts();\n    this.allowRoadDemolition = options.allowRoadDemolition ?? false;',
        '    this.initializeDistricts();\n    this.enableTerrainRelief = options.enableTerrainRelief ?? TERRAIN_CONFIG.enabledByDefault;\n    if (this.enableTerrainRelief) {\n      generateTerrainReliefForBounds(this.grid, { xStart: 0, yStart: 0, width: GAME_CONFIG.gridWidth, height: GAME_CONFIG.gridHeight });\n    }\n    this.allowRoadDemolition = options.allowRoadDemolition ?? false;',
      );
    }

    // Garante geração de relevo no Bairro Leste após expansão de grid.
    if (!c.includes('generateTerrainReliefForBounds(this.grid, { xStart: oldWidth, yStart: 0, width: expansionWidth, height: oldHeight }')) {
      if (c.includes('    setGridBounds(newWidth, oldHeight);\n    this.updateConnections();')) {
        c = c.replace(
          '    setGridBounds(newWidth, oldHeight);\n    this.updateConnections();',
          '    setGridBounds(newWidth, oldHeight);\n    if (this.enableTerrainRelief) {\n      generateTerrainReliefForBounds(this.grid, { xStart: oldWidth, yStart: 0, width: expansionWidth, height: oldHeight }, { densityScale: 0.72 });\n    }\n    this.updateConnections();',
        );
      } else if (c.includes('    setGridBounds(newWidth, oldHeight);')) {
        c = c.replace(
          '    setGridBounds(newWidth, oldHeight);',
          '    setGridBounds(newWidth, oldHeight);\n    if (this.enableTerrainRelief) {\n      generateTerrainReliefForBounds(this.grid, { xStart: oldWidth, yStart: 0, width: expansionWidth, height: oldHeight }, { densityScale: 0.72 });\n    }',
        );
      } else {
        throw new Error('Não foi possível localizar setGridBounds(newWidth, oldHeight) em purchaseEastDistrict().');
      }
    }

    // Se o usuário já teve o erro terrainSummary, mantém a proteção.
    if (c.includes('terrainSummary.') && !c.includes('const terrainSummary = getTerrainSummary(this.grid);')) {
      c = c.replace(
        '    const averageCongestion = congestions.length ? congestions.reduce((a, b) => a + b, 0) / congestions.length : 0;\n    return {',
        '    const averageCongestion = congestions.length ? congestions.reduce((a, b) => a + b, 0) / congestions.length : 0;\n    const terrainSummary = getTerrainSummary(this.grid);\n    return {',
      );
    }
    return c;
  });
}

function patchCss() {
  patch('src/styles.css', (c) => {
    if (c.includes('.mobility-focus-widget')) return c;
    return c + `

.mobility-focus-widget {
  position: absolute;
  top: 72px;
  right: 16px;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: auto;
}

.mobility-focus-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(2, 6, 23, 0.78);
  box-shadow: 0 18px 42px rgba(2, 6, 23, 0.28);
  backdrop-filter: blur(14px);
}

.mobility-focus-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 5px;
  color: rgba(226, 232, 240, 0.82);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.mobility-focus-toggle button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.62);
  color: rgba(226, 232, 240, 0.78);
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, background 0.14s ease;
}

.mobility-focus-toggle button:hover {
  transform: translateY(-1px);
  border-color: rgba(125, 211, 252, 0.44);
  color: #f8fafc;
}

.mobility-focus-toggle button.active {
  border-color: rgba(56, 189, 248, 0.78);
  background: rgba(14, 165, 233, 0.18);
  color: #f8fafc;
  box-shadow: 0 0 22px rgba(56, 189, 248, 0.32);
}

.mobility-focus-summary {
  min-width: 188px;
  display: grid;
  gap: 5px;
  padding: 11px 13px;
  border-radius: 15px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(2, 6, 23, 0.78);
  color: rgba(226, 232, 240, 0.82);
  font-size: 0.78rem;
  box-shadow: 0 18px 42px rgba(2, 6, 23, 0.3);
  backdrop-filter: blur(14px);
}

.mobility-focus-summary strong {
  color: #f8fafc;
  font-size: 0.84rem;
}

.mobility-focus-summary.bike strong { color: #86efac; }
.mobility-focus-summary.bus strong { color: #fde68a; }
.mobility-focus-summary.metro strong { color: #c4b5fd; }

@media (max-width: 840px) {
  .mobility-focus-widget {
    top: auto;
    right: 12px;
    bottom: 92px;
    max-width: calc(100vw - 24px);
  }

  .mobility-focus-toggle {
    max-width: 100%;
    overflow-x: auto;
  }

  .mobility-focus-title {
    display: none;
  }
}
`;
  });
}

function validate() {
  const store = read('src/store/gameStore.ts');
  if (!store.includes('MobilityFocusMode')) throw new Error('MobilityFocusMode não foi aplicado em gameStore.ts.');
  const pixi = read('src/game/rendering/PixiGame.tsx');
  if (!pixi.includes('<MobilityFocusToggle />')) throw new Error('MobilityFocusToggle não foi inserido em PixiGame.tsx.');
  const renderWorld = read('src/game/rendering/renderWorld.ts');
  if (!renderWorld.includes('drawMobilityFocusOverlay')) throw new Error('renderWorld.ts não chama drawMobilityFocusOverlay.');
  const metro = read('src/game/rendering/renderMetro.ts');
  if (metro.includes('const width = GAME_CONFIG.gridWidth * ts;')) throw new Error('renderMetro.ts ainda usa largura fixa GAME_CONFIG.gridWidth.');
  const simulation = read('src/game/engine/simulation.ts');
  if (!simulation.includes('generateTerrainReliefForBounds(this.grid, { xStart: oldWidth')) {
    throw new Error('purchaseEastDistrict() ainda não gera relevo no bairro liberado.');
  }
}

function main() {
  createRenderMobilityFocus();
  createMobilityFocusToggle();
  patchGameStore();
  patchPixiGame();
  patchRenderWorld();
  patchRenderMetro();
  patchSimulationTerrainDistrict();
  patchCss();
  validate();
  console.log('\nOK: visualização focada + correção de subsolo/bairro 2 aplicadas.');
}

main();
