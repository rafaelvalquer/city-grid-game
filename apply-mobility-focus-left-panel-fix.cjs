#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const BACKUP_SUFFIX = '.bak-mobility-focus-left-panel-fix';

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
function ensureImport(content, importLine) {
  if (content.includes(importLine)) return content;
  const lines = content.split('\n');
  let lastImport = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('import ')) lastImport = i;
  }
  if (lastImport >= 0) lines.splice(lastImport + 1, 0, importLine);
  else lines.unshift(importLine);
  return lines.join('\n');
}

function patchGameStore() {
  patch('src/store/gameStore.ts', (source) => {
    let s = source;
    if (!s.includes("export type MobilityFocusMode = 'off' | 'bike' | 'bus' | 'metro';")) {
      s = s.replace(
        "export type ViewLayer = 'surface' | 'underground';",
        "export type ViewLayer = 'surface' | 'underground';\nexport type MobilityFocusMode = 'off' | 'bike' | 'bus' | 'metro';",
      );
    }
    if (!s.includes('mobilityFocusMode: MobilityFocusMode;')) {
      s = s.replace(
        '  viewLayer: ViewLayer;\n',
        '  viewLayer: ViewLayer;\n  mobilityFocusMode: MobilityFocusMode;\n',
      );
    }
    if (!s.includes('setMobilityFocusMode: (mode: MobilityFocusMode) => void;')) {
      s = s.replace(
        '  setViewLayer: (viewLayer: ViewLayer) => void;\n',
        '  setViewLayer: (viewLayer: ViewLayer) => void;\n  setMobilityFocusMode: (mode: MobilityFocusMode) => void;\n',
      );
    }
    if (!s.includes("mobilityFocusMode: 'off'")) {
      s = s.replace(
        "  viewLayer: 'surface',\n",
        "  viewLayer: 'surface',\n  mobilityFocusMode: 'off',\n",
      );
    }
    if (!s.includes('setMobilityFocusMode: (mode) => set((state) =>')) {
      s = s.replace(
        '  setViewLayer: (viewLayer) => set({ viewLayer }),\n',
        `  setViewLayer: (viewLayer) => set({ viewLayer }),\n  setMobilityFocusMode: (mode) => set((state) => ({\n    mobilityFocusMode: mode,\n    viewLayer: mode === 'metro' ? 'underground' : mode === 'bike' || mode === 'bus' ? 'surface' : state.viewLayer,\n  })),\n`,
      );
    }
    return s;
  });
}

function writeMobilityFocusToggle() {
  const content = `import { Bike, BusFront, Eye, TrainFront } from 'lucide-react';
import { useGameStore, type MobilityFocusMode } from '../store/gameStore';

const focusModes: Array<{ id: MobilityFocusMode; label: string; Icon: typeof Eye }> = [
  { id: 'off', label: 'Normal', Icon: Eye },
  { id: 'bike', label: 'Bicicletas', Icon: Bike },
  { id: 'bus', label: 'Ônibus', Icon: BusFront },
  { id: 'metro', label: 'Metrô', Icon: TrainFront },
];

export function MobilityFocusToggle({ variant = 'panel' }: { variant?: 'panel' | 'floating' }) {
  const mode = useGameStore((s) => s.mobilityFocusMode);
  const setMode = useGameStore((s) => s.setMobilityFocusMode);
  const stats = useGameStore((s) => s.stats);

  return (
    <section className={variant === 'floating' ? 'mobility-focus-floating' : 'mobility-focus-panel'} aria-label="Visualização focada">
      <div className="mobility-focus-heading">
        <span><Eye size={14} /> Foco de mobilidade</span>
        {mode !== 'off' && <strong>{focusModes.find((item) => item.id === mode)?.label}</strong>}
      </div>

      <div className="mobility-focus-grid" role="group" aria-label="Escolher foco de mobilidade">
        {focusModes.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={mode === id ? 'mobility-focus-button active' : 'mobility-focus-button'}
            onClick={() => setMode(id)}
            aria-pressed={mode === id}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {mode !== 'off' && <MobilityFocusSummary mode={mode} stats={stats} />}
    </section>
  );
}

function MobilityFocusSummary({ mode, stats }: { mode: MobilityFocusMode; stats: ReturnType<typeof useGameStore.getState>['stats'] }) {
  if (mode === 'bike') {
    return (
      <div className="mobility-focus-summary inline">
        <span>Viagens: <strong>{stats.bikeTripsCompleted ?? 0}</strong></span>
        <span>Carros evitados: <strong>{stats.bikeCarsAvoided ?? 0}</strong></span>
        <span>Ciclovias: <strong>{stats.bikeLaneTiles ?? 0}</strong></span>
      </div>
    );
  }

  if (mode === 'bus') {
    return (
      <div className="mobility-focus-summary inline">
        <span>Ônibus ativos: <strong>{stats.activeBuses ?? 0}</strong></span>
        <span>Passageiros: <strong>{stats.waitingPassengers ?? 0}</strong></span>
        <span>Corredores: <strong>{stats.busLaneTiles ?? 0}</strong></span>
      </div>
    );
  }

  if (mode === 'metro') {
    return (
      <div className="mobility-focus-summary inline">
        <span>Estações: <strong>{stats.metroStations ?? 0}</strong></span>
        <span>Linhas: <strong>{stats.metroLines ?? 0}</strong></span>
        <span>Trens: <strong>{stats.metroTrains ?? 0}</strong></span>
      </div>
    );
  }

  return null;
}
`;
  write('src/components/MobilityFocusToggle.tsx', content);
}

function patchToolPanel() {
  patch('src/components/ToolPanel.tsx', (source) => {
    let s = source;
    s = ensureImport(s, "import { MobilityFocusToggle } from './MobilityFocusToggle';");
    if (!s.includes('<MobilityFocusToggle')) {
      s = s.replace(
        '        <div className="hint"><Radar size={14} /> Camadas para diagnosticar a cidade.</div>\n      </div>',
        '        <div className="hint"><Radar size={14} /> Camadas para diagnosticar a cidade.</div>\n        <MobilityFocusToggle variant="panel" />\n      </div>',
      );
    }
    return s;
  });
}

function patchPixiGame() {
  patch('src/game/rendering/PixiGame.tsx', (source) => {
    let s = source;
    s = s.replace(/import \{ MobilityFocusToggle \} from ['"]\.\.\/\.\.\/components\/MobilityFocusToggle['"];\n/g, '');
    s = s.replace(/import \{ MobilityFocusToggle \} from ['"]\.\.\/components\/MobilityFocusToggle['"];\n/g, '');
    s = s.replace(/\s*<MobilityFocusToggle(?:\s+[^>]*)?\s*\/>\n/g, '\n');

    if (!s.includes('mobilityFocusMode,')) {
      s = s.replace(
        'const { paused, speed, heatmapMode, viewLayer, setStats, setSelected } = useGameStore.getState();',
        'const { paused, speed, heatmapMode, viewLayer, mobilityFocusMode, setStats, setSelected } = useGameStore.getState();',
      );
    }

    if (!s.includes('viewLayer,\n          mobilityFocusMode,')) {
      s = s.replace(
        '          viewLayer,\n          particles,',
        '          viewLayer,\n          mobilityFocusMode,\n          particles,',
      );
    }
    return s;
  });
}

function writeRenderMobilityFocus() {
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
  graphics.rect(0, 0, width, height).fill({ color: DIM_COLOR, alpha: 0.68 });
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
        graphics.roundRect(px + 4, py + ts - 8, ts - 8, 4, 3).fill({ color: BIKE_LANE, alpha: 0.95 });
        graphics.roundRect(px + 7, py + ts - 11, ts - 14, 10, 6).stroke({ color: BIKE_LANE, width: 1.4, alpha: 0.28 + pulse });
      } else {
        graphics.roundRect(px + ts - 8, py + 4, 4, ts - 8, 3).fill({ color: BIKE_LANE, alpha: 0.95 });
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
    graphics.roundRect(px - 5, py - 5, 10, 10, 3).fill({ color: BIKE, alpha: 0.98 });
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
      graphics.roundRect(x * ts + 5, y * ts + ts / 2 - 3, ts - 10, 6, 4).fill({ color: BUS_LANE, alpha: 0.9 });
      graphics.roundRect(x * ts + 3, y * ts + 3, ts - 6, ts - 6, 7).stroke({ color: BUS_LANE, width: 1.2, alpha: 0.18 + pulse * 0.35 });
    }
  }

  drawPolyline(graphics, world.transitLine?.route ?? [], ts, BUS_LINE, 5, 0.68);
  drawPolyline(graphics, world.transitLine?.route ?? [], ts, 0xffffff, 1.2, 0.38);

  for (const stop of world.transitStops ?? []) {
    const cx = stop.x * ts + ts / 2;
    const cy = stop.y * ts + ts / 2;
    graphics.circle(cx, cy, 16 + pulse * 4).fill({ color: BUS_STOP, alpha: 0.15 + pulse * 0.08 });
    graphics.circle(cx, cy, 9).fill({ color: BUS_STOP, alpha: 0.94 });
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
    graphics.circle(cx, cy, 10).fill({ color: active ? METRO : METRO_LINE, alpha: 0.94 });
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
  graphics.stroke({ color: BIKE, width: 3, alpha: 0.3 });
}

function drawFocusedVehicle(graphics: Graphics, car: Car, ts: number, color: number, width: number, height: number): void {
  const px = car.x * ts + ts / 2;
  const py = car.y * ts + ts / 2;
  graphics.circle(px, py, 16).fill({ color, alpha: 0.18 });
  graphics.roundRect(px - width / 2, py - height / 2, width, height, 4).fill({ color, alpha: 0.98 });
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
  const index = Math.min(segmentCount - 1, Math.floor(scaled));
  const local = scaled - index;
  const from = tiles[index];
  const to = tiles[index + 1];
  return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
}

function parseLineColor(line: MetroLine): number {
  return Number(String(line.color ?? '').replace('#', '0x')) || METRO_LINE;
}

function isMostlyHorizontalRoad(grid: Array<Array<{ type?: string }>>, x: number, y: number): boolean {
  const left = grid[y]?.[x - 1]?.type === 'road';
  const right = grid[y]?.[x + 1]?.type === 'road';
  const up = grid[y - 1]?.[x]?.type === 'road';
  const down = grid[y + 1]?.[x]?.type === 'road';
  if ((left || right) && !(up || down)) return true;
  if ((up || down) && !(left || right)) return false;
  return left || right;
}
`;
  write('src/game/rendering/renderMobilityFocus.ts', content);
}

function patchRenderWorld() {
  patch('src/game/rendering/renderWorld.ts', (source) => {
    let s = source;
    s = s.replace(
      "import type { HeatmapMode, HoverPreview, ViewLayer } from '../../store/gameStore';",
      "import type { HeatmapMode, HoverPreview, MobilityFocusMode, ViewLayer } from '../../store/gameStore';",
    );
    s = ensureImport(s, "import { drawMobilityFocusOverlay } from './renderMobilityFocus';");

    if (!s.includes('mobilityFocusMode: MobilityFocusMode')) {
      s = s.replace(
        '  viewLayer: ViewLayer,\n  particles?: ParticleSystem,',
        "  viewLayer: ViewLayer,\n  mobilityFocusMode: MobilityFocusMode = 'off',\n  particles?: ParticleSystem,",
      );
    }

    if (!s.includes('renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, mobilityFocusMode')) {
      s = s.replace(
        'renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, visibleBounds);',
        'renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, mobilityFocusMode, visibleBounds);',
      );
    }

    if (!s.includes('  mobilityFocusMode: MobilityFocusMode,\n  visibleBounds?: ViewportTileBounds,')) {
      s = s.replace(
        '  viewLayer: ViewLayer,\n  visibleBounds?: ViewportTileBounds,',
        '  viewLayer: ViewLayer,\n  mobilityFocusMode: MobilityFocusMode,\n  visibleBounds?: ViewportTileBounds,',
      );
    }

    if (!s.includes('drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);\n    if (hoverPreview) drawConstructionPreview')) {
      s = s.replace(
        '    renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);\n    if (hoverPreview) drawConstructionPreview',
        '    renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);\n    drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);\n    if (hoverPreview) drawConstructionPreview',
      );
    }

    if (!s.includes('drawBikeTrips(graphics, world, ts, timeSeconds);\n  drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);')) {
      s = s.replace(
        '  drawBikeTrips(graphics, world, ts, timeSeconds);\n\n  if (hoverPreview)',
        '  drawBikeTrips(graphics, world, ts, timeSeconds);\n  drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);\n\n  if (hoverPreview)',
      );
    }
    return s;
  });
}

function patchRenderMetro() {
  patch('src/game/rendering/renderMetro.ts', (source) => {
    let s = source;
    s = s.replace(
      '  const width = GAME_CONFIG.gridWidth * ts;\n  const height = GAME_CONFIG.gridHeight * ts;',
      '  const width = (world.grid[0]?.length ?? GAME_CONFIG.gridWidth) * ts;\n  const height = (world.grid.length || GAME_CONFIG.gridHeight) * ts;',
    );
    return s;
  });
}

function patchDistrictTerrainGeneration() {
  patch('src/game/engine/simulation.ts', (source) => {
    let s = source;
    if (!s.includes("generateTerrainReliefForBounds")) return s;

    if (!s.includes('private readonly enableTerrainRelief: boolean;')) {
      s = s.replace(
        '  private readonly allowRoadDemolition: boolean;\n',
        '  private readonly allowRoadDemolition: boolean;\n  private readonly enableTerrainRelief: boolean;\n',
      );
    }

    if (!s.includes('this.enableTerrainRelief = options.enableTerrainRelief')) {
      s = s.replace(
        '    this.initializeDistricts();\n    this.allowRoadDemolition = options.allowRoadDemolition ?? false;',
        '    this.initializeDistricts();\n    this.enableTerrainRelief = options.enableTerrainRelief ?? true;\n    this.allowRoadDemolition = options.allowRoadDemolition ?? false;',
      );
    }

    if (!s.includes('generateTerrainReliefForBounds(this.grid, { xStart: oldWidth, yStart: 0, width: expansionWidth, height: oldHeight }')) {
      s = s.replace(
        '    this.money -= district.cost;\n    setGridBounds(newWidth, oldHeight);',
        '    this.money -= district.cost;\n    setGridBounds(newWidth, oldHeight);\n    if (this.enableTerrainRelief) {\n      generateTerrainReliefForBounds(this.grid, { xStart: oldWidth, yStart: 0, width: expansionWidth, height: oldHeight }, { densityScale: 0.72 });\n    }',
      );
    }
    return s;
  });
}

function patchStyles() {
  patch('src/styles.css', (source) => {
    let s = source;
    const css = `

/* Mobility focus moved to left controls panel */
.mobility-focus-toggle,
.mobility-focus-floating {
  position: static !important;
  inset: auto !important;
  transform: none !important;
}

.mobility-focus-panel {
  margin-top: 12px;
  padding: 10px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.52);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}

.mobility-focus-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: rgba(226, 232, 240, 0.9);
  font-size: 0.78rem;
  font-weight: 700;
}

.mobility-focus-heading span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.mobility-focus-heading strong {
  color: #67e8f9;
  font-size: 0.72rem;
}

.mobility-focus-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.mobility-focus-button {
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(2, 6, 23, 0.36);
  color: rgba(226, 232, 240, 0.82);
  border-radius: 12px;
  padding: 8px 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-weight: 800;
  font-size: 0.74rem;
  cursor: pointer;
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, color .16s ease;
}

.mobility-focus-button:hover {
  background: rgba(15, 23, 42, 0.72);
  border-color: rgba(103, 232, 249, 0.38);
}

.mobility-focus-button.active {
  color: #ecfeff;
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.34), rgba(34, 197, 94, 0.22));
  border-color: rgba(103, 232, 249, 0.7);
  box-shadow: 0 0 18px rgba(56, 189, 248, 0.2);
}

.mobility-focus-summary.inline {
  margin-top: 9px;
  display: grid;
  gap: 4px;
  color: rgba(203, 213, 225, 0.82);
  font-size: 0.72rem;
}

.mobility-focus-summary.inline span {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.mobility-focus-summary.inline strong {
  color: #f8fafc;
}
`;
    if (!s.includes('/* Mobility focus moved to left controls panel */')) s += css;
    return s;
  });
}

function validate() {
  const toolPanel = read('src/components/ToolPanel.tsx');
  if (!toolPanel.includes('<MobilityFocusToggle')) throw new Error('MobilityFocusToggle não foi inserido no ToolPanel.');
  const pixi = read('src/game/rendering/PixiGame.tsx');
  if (pixi.includes('<MobilityFocusToggle')) throw new Error('MobilityFocusToggle ainda está no PixiGame e pode sobrepor os botões superiores.');
  const renderWorld = read('src/game/rendering/renderWorld.ts');
  if (!renderWorld.includes('drawMobilityFocusOverlay')) throw new Error('Overlay de foco não foi conectado ao renderWorld.');
}

function main() {
  patchGameStore();
  writeMobilityFocusToggle();
  patchToolPanel();
  patchPixiGame();
  writeRenderMobilityFocus();
  patchRenderWorld();
  patchRenderMetro();
  patchDistrictTerrainGeneration();
  patchStyles();
  validate();
  console.log('\nCorreção aplicada: visualização focada movida para o menu lateral esquerdo e overlay conectado.');
}

main();
