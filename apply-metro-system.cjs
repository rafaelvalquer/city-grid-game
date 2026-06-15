const fs = require('fs');
const path = require('path');

const root = process.cwd();
const packageRoot = __dirname;
const BACKUP_SUFFIX = '.bak-metro-v1';

function file(rel) {
  return path.join(root, rel);
}

function packageFile(rel) {
  return path.join(packageRoot, rel);
}

function read(rel) {
  return fs.readFileSync(file(rel), 'utf8');
}

function write(rel, content) {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), content, 'utf8');
}

function backup(rel) {
  const target = file(rel);
  if (!fs.existsSync(target)) return;
  const backupPath = `${target}${BACKUP_SUFFIX}`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(target, backupPath);
}

function copyFromPackage(rel) {
  const source = packageFile(rel);
  if (!fs.existsSync(source)) throw new Error(`Arquivo do pacote não encontrado: ${rel}`);
  backup(rel);
  write(rel, fs.readFileSync(source, 'utf8'));
}

function replaceOnce(rel, search, replacement, label = search) {
  backup(rel);
  const content = read(rel);
  if (!content.includes(search)) {
    throw new Error(`Não encontrei o trecho esperado em ${rel}: ${label}`);
  }
  write(rel, content.replace(search, replacement));
}

function replaceRegex(rel, regex, replacement, label) {
  backup(rel);
  const content = read(rel);
  if (!regex.test(content)) {
    throw new Error(`Não encontrei o padrão esperado em ${rel}: ${label}`);
  }
  write(rel, content.replace(regex, replacement));
}

function insertBefore(rel, marker, insertion, id) {
  let content = read(rel);
  if (content.includes(id)) return;
  if (!content.includes(marker)) throw new Error(`Marcador não encontrado em ${rel}: ${marker}`);
  backup(rel);
  content = content.replace(marker, `${insertion}\n${marker}`);
  write(rel, content);
}

function insertAfter(rel, marker, insertion, id) {
  let content = read(rel);
  if (content.includes(id)) return;
  if (!content.includes(marker)) throw new Error(`Marcador não encontrado em ${rel}: ${marker}`);
  backup(rel);
  content = content.replace(marker, `${marker}\n${insertion}`);
  write(rel, content);
}

function ensureContains(rel, expected, message) {
  const content = read(rel);
  if (!content.includes(expected)) throw new Error(message ?? `Validação falhou em ${rel}: ${expected}`);
}

function patchGameTypes() {
  const rel = 'src/types/game.types.ts';
  let content = read(rel);
  if (content.includes("'metroStation'")) return;
  backup(rel);
  content = content.replace(
    "export type Tool = 'road' | 'avenue' | 'roundabout' | 'trafficLight' | 'oneWay' | 'busStop' | 'remove' | 'inspect';",
    "export type Tool = 'road' | 'avenue' | 'roundabout' | 'trafficLight' | 'oneWay' | 'busStop' | 'metroStation' | 'metroTrack' | 'metroLine' | 'remove' | 'inspect';",
  );
  write(rel, content);
}

function patchCityTypes() {
  const rel = 'src/types/city.types.ts';
  let content = read(rel);
  backup(rel);
  if (!content.includes("./metro.types")) {
    content = `import type { MetroLine, MetroStation, MetroTrain } from './metro.types';\n\n${content}`;
  }
  if (!content.includes('metroStations: number;')) {
    content = content.replace(
      "  activeBuses: number;\n  cityLevel: number;",
      "  activeBuses: number;\n  metroStations: number;\n  metroLines: number;\n  metroPassengers: number;\n  metroCarsAvoided: number;\n  metroTripsCompleted: number;\n  cityLevel: number;",
    );
  }
  if (!content.includes('metroTripsCompleted: number;\n  metroCarsAvoided: number;\n  averageCongestion')) {
    content = content.replace(
      "  carTripsAvoided: number;\n  averageCongestion: number;",
      "  carTripsAvoided: number;\n  metroTripsCompleted: number;\n  metroCarsAvoided: number;\n  metroPassengers: number;\n  averageCongestion: number;",
    );
  }
  if (!content.includes("kind: 'metroStation'")) {
    content = content.replace(
      "  | { kind: 'car'; carId: string };",
      "  | { kind: 'car'; carId: string }\n  | { kind: 'metroStation'; station: MetroStation }\n  | { kind: 'metroLine'; line: MetroLine }\n  | { kind: 'metroTrain'; trainId: string; train?: MetroTrain };",
    );
  }
  write(rel, content);
}

function patchStore() {
  const rel = 'src/store/gameStore.ts';
  let content = read(rel);
  backup(rel);
  if (!content.includes('export type ViewLayer')) {
    content = content.replace(
      "export type HeatmapMode = 'traffic' | 'satisfaction' | 'flow' | 'off';",
      "export type HeatmapMode = 'traffic' | 'satisfaction' | 'flow' | 'off';\nexport type ViewLayer = 'surface' | 'underground';",
    );
  }
  if (!content.includes('viewLayer: ViewLayer;')) {
    content = content.replace(
      "  heatmapMode: HeatmapMode;\n  paused: boolean;",
      "  heatmapMode: HeatmapMode;\n  viewLayer: ViewLayer;\n  paused: boolean;",
    );
  }
  if (!content.includes('setViewLayer: (viewLayer: ViewLayer) => void;')) {
    content = content.replace(
      "  setHeatmapMode: (mode: HeatmapMode) => void;\n  togglePaused: () => void;",
      "  setHeatmapMode: (mode: HeatmapMode) => void;\n  setViewLayer: (viewLayer: ViewLayer) => void;\n  toggleViewLayer: () => void;\n  togglePaused: () => void;",
    );
  }
  if (!content.includes('metroStations: 0,')) {
    content = content.replace(
      "  activeBuses: 0,\n  cityLevel: 1,",
      "  activeBuses: 0,\n  metroStations: 0,\n  metroLines: 0,\n  metroPassengers: 0,\n  metroCarsAvoided: 0,\n  metroTripsCompleted: 0,\n  cityLevel: 1,",
    );
  }
  if (!content.includes("viewLayer: 'surface'")) {
    content = content.replace(
      "  heatmapMode: 'traffic',\n  paused: false,",
      "  heatmapMode: 'traffic',\n  viewLayer: 'surface',\n  paused: false,",
    );
  }
  if (!content.includes('setViewLayer: (viewLayer) => set({ viewLayer })')) {
    content = content.replace(
      "  setHeatmapMode: (mode) => set({ heatmapMode: mode }),\n  togglePaused: () => set((s) => ({ paused: !s.paused })),",
      "  setHeatmapMode: (mode) => set({ heatmapMode: mode }),\n  setViewLayer: (viewLayer) => set({ viewLayer }),\n  toggleViewLayer: () => set((s) => ({ viewLayer: s.viewLayer === 'surface' ? 'underground' : 'surface' })),\n  togglePaused: () => set((s) => ({ paused: !s.paused })),",
    );
  }
  write(rel, content);
}

function patchToolData() {
  const rel = 'src/components/toolData.ts';
  let content = read(rel);
  backup(rel);
  if (!content.includes('../game/config/metroConfig')) {
    content = content.replace(
      "import { TRANSIT_CONFIG } from '../game/config/transitConfig';",
      "import { TRANSIT_CONFIG } from '../game/config/transitConfig';\nimport { METRO_CONFIG } from '../game/config/metroConfig';",
    );
  }
  if (!content.includes("id: 'underground'")) {
    content = content.replace(
      "  id: 'roads' | 'traffic' | 'edit';",
      "  id: 'roads' | 'traffic' | 'underground' | 'edit';",
    );
    content = content.replace(
      "  {\n    id: 'edit',",
      "  {\n    id: 'underground',\n    label: 'Subsolo',\n    Icon: CircleDot,\n    tools: [\n      { id: 'metroStation', label: 'Estação', cost: METRO_CONFIG.stationBuildCost, Icon: CircleDot },\n      { id: 'metroTrack', label: 'Trilho', cost: METRO_CONFIG.trackCostPerTile, Icon: Route },\n      { id: 'metroLine', label: 'Criar linha', cost: METRO_CONFIG.lineActivationCost, Icon: BusFront },\n    ],\n  },\n  {\n    id: 'edit',",
    );
  }
  write(rel, content);
}

function patchHudBar() {
  const rel = 'src/components/HudBar.tsx';
  let content = read(rel);
  if (content.includes('<small>metrô</small>')) return;
  backup(rel);
  content = content.replace(
    "        <div className=\"hud-item\"><BusFront size={16} /><span>{stats.activeBuses}</span><small>{stats.waitingPassengers} fila</small></div>",
    "        <div className=\"hud-item\"><BusFront size={16} /><span>{stats.activeBuses}</span><small>{stats.waitingPassengers} fila</small></div>\n        <div className=\"hud-item\"><BusFront size={16} /><span>{stats.metroPassengers}</span><small>metrô</small></div>",
  );
  write(rel, content);
}

function patchDetailsPanel() {
  const rel = 'src/components/DetailsPanel.tsx';
  let content = read(rel);
  if (content.includes("selected.kind === 'metroStation'")) return;
  backup(rel);
  const insertion = `

      {selected.kind === 'metroStation' && (
        <div className="detail-card">
          <h3><CircleDot size={15} /> {selected.station.name}</h3>
          <p><span>Posição</span><strong>{selected.station.x}, {selected.station.y}</strong></p>
          <p><span>Passageiros esperando</span><strong>{selected.station.waitingPassengers}/{selected.station.capacity}</strong></p>
          <p><span>Embarques</span><strong>{selected.station.totalBoarded}</strong></p>
          <p><span>Desembarques</span><strong>{selected.station.totalAlighted}</strong></p>
          <p><span>Cobertura</span><strong>{selected.station.coverageRadius} tiles</strong></p>
          <p><span>Linhas</span><strong>{world.getMetroLinesForStation(selected.station.id).map((line) => line.name).join(', ') || 'Nenhuma'}</strong></p>
        </div>
      )}

      {selected.kind === 'metroLine' && (
        <div className="detail-card">
          <h3><Route size={15} /> {selected.line.name}</h3>
          <p><span>Estações</span><strong>{selected.line.stationIds.length}</strong></p>
          <p><span>Trens ativos</span><strong>{world.metroTrains.filter((train) => train.lineId === selected.line.id).length}</strong></p>
          <p><span>Passageiros</span><strong>{selected.line.totalPassengers}</strong></p>
          <p><span>Carros evitados</span><strong>{selected.line.carsAvoided}</strong></p>
          <p><span>Frequência</span><strong>{selected.line.frequencySeconds}s</strong></p>
        </div>
      )}

      {selected.kind === 'metroTrain' && selected.train && (
        <div className="detail-card">
          <h3><BusFront size={15} /> Trem de metrô</h3>
          <p><span>Linha</span><strong>{world.metroLines.find((line) => line.id === selected.train?.lineId)?.name ?? '-'}</strong></p>
          <p><span>Lotação</span><strong>{selected.train.passengers}/{selected.train.capacity}</strong></p>
          <p><span>Progresso</span><strong>{Math.round(selected.train.progress * 100)}%</strong></p>
        </div>
      )}`;
  content = content.replace(
    "\n      {selected.kind === 'road' && (",
    `${insertion}\n\n      {selected.kind === 'road' && (`,
  );
  write(rel, content);
}

function patchPixiGame() {
  const rel = 'src/game/rendering/PixiGame.tsx';
  let content = read(rel);
  backup(rel);
  if (!content.includes("../../components/LayerToggle")) {
    content = content.replace(
      "import { CanvasToolDock } from '../../components/CanvasToolDock';",
      "import { CanvasToolDock } from '../../components/CanvasToolDock';\nimport { LayerToggle } from '../../components/LayerToggle';",
    );
  }
  if (!content.includes('const viewLayer = useGameStore((s) => s.viewLayer);')) {
    content = content.replace(
      "  const heatmapModeUi = useGameStore((s) => s.heatmapMode);",
      "  const heatmapModeUi = useGameStore((s) => s.heatmapMode);\n  const viewLayer = useGameStore((s) => s.viewLayer);",
    );
  }
  if (!content.includes('viewLayer, setStats')) {
    content = content.replace(
      "        const { paused, speed, heatmapMode, setStats, setSelected } = useGameStore.getState();",
      "        const { paused, speed, heatmapMode, viewLayer, setStats, setSelected } = useGameStore.getState();",
    );
  }
  if (!content.includes('viewLayer,\n          particles,')) {
    content = content.replace(
      "          particles,\n        );",
      "          viewLayer,\n          particles,\n        );",
    );
  }
  if (!content.includes('<LayerToggle />')) {
    content = content.replace(
      "      <CanvasToolDock />",
      "      <LayerToggle />\n      <CanvasToolDock />",
    );
  }
  write(rel, content);
}

function patchRenderWorld() {
  const rel = 'src/game/rendering/renderWorld.ts';
  let content = read(rel);
  backup(rel);
  if (!content.includes("renderMetro")) {
    content = content.replace(
      "import type { HeatmapMode, HoverPreview } from '../../store/gameStore';",
      "import type { HeatmapMode, HoverPreview, ViewLayer } from '../../store/gameStore';",
    );
    content = content.replace(
      "import type { ParticleSystem } from './particleSystem';",
      "import type { ParticleSystem } from './particleSystem';\nimport { renderMetroLayer } from './renderMetro';",
    );
  }
  if (!content.includes('viewLayer: ViewLayer,')) {
    content = content.replace(
      "  scale: number,\n  particles?: ParticleSystem,",
      "  scale: number,\n  viewLayer: ViewLayer,\n  particles?: ParticleSystem,",
    );
    content = content.replace(
      "  renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere);",
      "  renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer);",
    );
    content = content.replace(
      "function renderDynamicLayer(\n  graphics: Graphics,\n  state: RenderWorldState,\n  world: GameWorld,\n  heatmapMode: HeatmapMode,\n  hoverPreview: HoverPreview | null,\n  ts: number,\n  timeSeconds: number,\n  atmosphere: ReturnType<typeof getAtmosphere>,\n): void {",
      "function renderDynamicLayer(\n  graphics: Graphics,\n  state: RenderWorldState,\n  world: GameWorld,\n  heatmapMode: HeatmapMode,\n  hoverPreview: HoverPreview | null,\n  ts: number,\n  timeSeconds: number,\n  atmosphere: ReturnType<typeof getAtmosphere>,\n  viewLayer: ViewLayer,\n): void {",
    );
    content = content.replace(
      "  drawAtmosphereOverlay(graphics, atmosphere, heatmapMode, ts);",
      "  drawAtmosphereOverlay(graphics, atmosphere, heatmapMode, ts);\n  renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);",
    );
  }
  write(rel, content);
}

function patchInputController() {
  const rel = 'src/game/rendering/inputController.ts';
  let content = read(rel);
  backup(rel);
  if (!content.includes('../config/metroConfig')) {
    content = content.replace(
      "import { TRANSIT_CONFIG } from '../config/transitConfig';",
      "import { TRANSIT_CONFIG } from '../config/transitConfig';\nimport { METRO_CONFIG } from '../config/metroConfig';",
    );
  }
  if (!content.includes('pendingMetroTrackStationId')) {
    content = content.replace(
      "  const detectCar = (tileX: number, tileY: number) => {\n    return world.cars.find((c) => Math.abs(c.x - tileX) < 0.45 && Math.abs(c.y - tileY) < 0.45);\n  };",
      "  const detectCar = (tileX: number, tileY: number) => {\n    return world.cars.find((c) => Math.abs(c.x - tileX) < 0.45 && Math.abs(c.y - tileY) < 0.45);\n  };\n\n  let pendingMetroTrackStationId: string | null = null;\n  let pendingMetroLineStationId: string | null = null;",
    );
  }
  if (!content.includes("state.selectedTool === 'metroTrack'")) {
    content = content.replace(
      "    if (state.selectedTool === 'inspect') {\n      const car = detectCar(tileX, tileY);\n      if (car) world.inspectCar(car.id);\n      else world.inspectAt(tileX, tileY);\n      state.setActionFeedback(null);\n      return;\n    }",
      "    if (state.selectedTool === 'inspect') {\n      const car = detectCar(tileX, tileY);\n      const station = world.getMetroStationAt(tileX, tileY);\n      if (state.viewLayer === 'underground' && station) world.inspectMetroStation(station.id);\n      else if (car) world.inspectCar(car.id);\n      else world.inspectAt(tileX, tileY);\n      state.setActionFeedback(null);\n      return;\n    }\n\n    if (state.selectedTool === 'metroStation') {\n      if (state.viewLayer !== 'underground') {\n        state.setActionFeedback('Ative a camada Subsolo para construir estações.');\n        return;\n      }\n      const preview = getActionPreview(world, tileX, tileY, state.selectedTool, state.stats.money);\n      const didBuild = world.buildMetroStationAt(tileX, tileY);\n      state.setActionFeedback(didBuild ? preview.successMessage : preview.reason ?? 'Não foi possível construir a estação.');\n      return;\n    }\n\n    if (state.selectedTool === 'metroTrack') {\n      if (state.viewLayer !== 'underground') {\n        state.setActionFeedback('Ative a camada Subsolo para conectar trilhos.');\n        return;\n      }\n      const station = world.getMetroStationAt(tileX, tileY);\n      if (!station) {\n        state.setActionFeedback('Selecione uma estação de metrô para iniciar ou concluir o trilho.');\n        return;\n      }\n      if (!pendingMetroTrackStationId) {\n        pendingMetroTrackStationId = station.id;\n        state.setActionFeedback(`Origem do trilho: ${station.name}. Clique em outra estação para conectar.`);\n        return;\n      }\n      const from = pendingMetroTrackStationId;\n      pendingMetroTrackStationId = null;\n      const result = world.buildMetroTrack(from, station.id);\n      state.setActionFeedback(result.success ? `Trilho construído por $ ${result.cost}.` : result.reason ?? 'Não foi possível construir o trilho.');\n      return;\n    }\n\n    if (state.selectedTool === 'metroLine') {\n      if (state.viewLayer !== 'underground') {\n        state.setActionFeedback('Ative a camada Subsolo para criar linhas de metrô.');\n        return;\n      }\n      const station = world.getMetroStationAt(tileX, tileY);\n      if (!station) {\n        state.setActionFeedback('Clique em uma estação de metrô para iniciar ou finalizar a linha.');\n        return;\n      }\n      if (!pendingMetroLineStationId) {\n        pendingMetroLineStationId = station.id;\n        state.setActionFeedback(`Início da linha: ${station.name}. Clique na estação de destino.`);\n        return;\n      }\n      const from = pendingMetroLineStationId;\n      pendingMetroLineStationId = null;\n      const route = world.findMetroRoute(from, station.id);\n      if (route.length < 2) {\n        state.setActionFeedback('Não existe trilho conectado entre as estações selecionadas.');\n        return;\n      }\n      const result = world.createMetroLine(route);\n      state.setActionFeedback(result.success ? `${result.name} ativada por $ ${result.cost}.` : result.reason ?? 'Não foi possível criar a linha.');\n      return;\n    }",
    );
  }
  if (!content.includes("if (tool === 'metroStation')")) {
    content = content.replace(
      "  if (tool === 'oneWay') {",
      "  if (tool === 'metroStation') {\n    const cost = METRO_CONFIG.stationBuildCost;\n    if (world.getMetroStationAt(x, y)) return { x, y, label: 'Estação já existe', cost, valid: false, reason: 'Já existe uma estação de metrô nesse tile.', successMessage: '' };\n    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para construir a estação.`, successMessage: '' };\n    return { x, y, label: 'Construir estação de metrô', cost, valid: true, successMessage: `Estação de metrô construída por $ ${cost}.` };\n  }\n\n  if (tool === 'metroTrack') {\n    const station = world.getMetroStationAt(x, y);\n    return { x, y, label: station ? `Selecionar ${station.name}` : 'Selecione uma estação', valid: Boolean(station), reason: station ? undefined : 'Trilhos ligam uma estação a outra.', successMessage: 'Estação selecionada.' };\n  }\n\n  if (tool === 'metroLine') {\n    const station = world.getMetroStationAt(x, y);\n    return { x, y, label: station ? `Linha a partir de ${station.name}` : 'Selecione uma estação', cost: METRO_CONFIG.lineActivationCost, valid: Boolean(station), reason: station ? undefined : 'Clique em uma estação para criar uma linha.', successMessage: 'Estação selecionada.' };\n  }\n\n  if (tool === 'oneWay') {",
    );
  }
  write(rel, content);
}

function patchSimulation() {
  const rel = 'src/game/engine/simulation.ts';
  let content = read(rel);
  backup(rel);

  if (!content.includes('../../types/metro.types')) {
    content = content.replace(
      "import type { Car } from '../../types/agent.types';",
      "import type { Car } from '../../types/agent.types';\nimport type { MetroLine, MetroStation, MetroTrack, MetroTrain } from '../../types/metro.types';",
    );
  }
  if (!content.includes('../config/metroConfig')) {
    content = content.replace(
      "import { TRANSIT_CONFIG } from '../config/transitConfig';",
      "import { TRANSIT_CONFIG } from '../config/transitConfig';\nimport { METRO_CONFIG } from '../config/metroConfig';",
    );
  }
  if (!content.includes('../metro/metroGraph')) {
    content = content.replace(
      "import { chooseTrip } from '../agents/tripGenerator';",
      "import { chooseTrip } from '../agents/tripGenerator';\nimport { findMetroStationPath } from '../metro/metroGraph';\nimport { buildMetroTrackTiles, pickMetroLineColor } from '../metro/metroLineBuilder';",
    );
  }
  if (!content.includes('metroStations: MetroStation[]')) {
    content = content.replace(
      "  transitStops: TransitStop[] = [];\n  transitLine: TransitLine = { id: 'bus-loop', stopIds: [], route: [], active: false, reason: 'Adicione ao menos dois pontos de ônibus.' };",
      "  transitStops: TransitStop[] = [];\n  transitLine: TransitLine = { id: 'bus-loop', stopIds: [], route: [], active: false, reason: 'Adicione ao menos dois pontos de ônibus.' };\n  metroStations: MetroStation[] = [];\n  metroTracks: MetroTrack[] = [];\n  metroLines: MetroLine[] = [];\n  metroTrains: MetroTrain[] = [];\n  metroTripsCompleted = 0;\n  metroCarsAvoided = 0;",
    );
  }
  if (!content.includes('metroStations: this.metroStations.length')) {
    content = content.replace(
      "      activeBuses: this.getTransitBuses().length,\n      cityLevel: this.cityLevel,",
      "      activeBuses: this.getTransitBuses().length,\n      metroStations: this.metroStations.length,\n      metroLines: this.metroLines.filter((line) => line.active).length,\n      metroPassengers: this.metroTrains.reduce((sum, train) => sum + train.passengers, 0) + this.metroStations.reduce((sum, station) => sum + station.waitingPassengers, 0),\n      metroCarsAvoided: this.metroCarsAvoided,\n      metroTripsCompleted: this.metroTripsCompleted,\n      cityLevel: this.cityLevel,",
    );
  }
  if (!content.includes('metroTripsCompleted: this.metroTripsCompleted')) {
    content = content.replace(
      "      carTripsAvoided: this.carTripsAvoided,\n      averageCongestion: snapshot.averageCongestion,",
      "      carTripsAvoided: this.carTripsAvoided,\n      metroTripsCompleted: this.metroTripsCompleted,\n      metroCarsAvoided: this.metroCarsAvoided,\n      metroPassengers: snapshot.metroPassengers,\n      averageCongestion: snapshot.averageCongestion,",
    );
  }
  if (!content.includes('this.updateMetro(dt);')) {
    content = content.replace(
      "    this.updateTransitStops(dt);\n    this.updateConnections();",
      "    this.updateTransitStops(dt);\n    this.updateMetro(dt);\n    this.updateConnections();",
    );
  }
  if (!content.includes("if (tool === 'metroStation')")) {
    content = content.replace(
      "    const tile = this.grid[y][x];\n\n    if (tool === 'roundabout') {",
      "    const tile = this.grid[y][x];\n\n    if (tool === 'metroStation') {\n      return this.buildMetroStationAt(x, y);\n    }\n\n    if (tool === 'metroTrack' || tool === 'metroLine') {\n      return false;\n    }\n\n    if (tool === 'roundabout') {",
    );
  }
  if (!content.includes('const metroStation = this.getMetroStationAt(x, y);')) {
    content = content.replace(
      "    if (tool === 'remove') {\n      if (tile.type === 'busStop') {",
      "    if (tool === 'remove') {\n      const metroStation = this.getMetroStationAt(x, y);\n      if (metroStation) {\n        if (!this.removeMetroStationAt(metroStation.id)) return false;\n        this.emit();\n        return true;\n      }\n      if (tile.type === 'busStop') {",
    );
  }
  if (!content.includes('this.tryCreateMetroTrip(trip.origin, trip.destination)')) {
    content = content.replace(
      "      if (this.tryCreateTransitTrip(trip.origin, trip.destination)) {\n        trip.origin.tripsToday += 1;\n        trip.destination.tripsToday += 1;\n        continue;\n      }",
      "      const tripDistance = manhattan(trip.origin, trip.destination);\n      if (tripDistance >= METRO_CONFIG.longTripDistance && this.tryCreateMetroTrip(trip.origin, trip.destination)) {\n        trip.origin.tripsToday += 1;\n        trip.destination.tripsToday += 1;\n        continue;\n      }\n      if (this.tryCreateTransitTrip(trip.origin, trip.destination)) {\n        trip.origin.tripsToday += 1;\n        trip.destination.tripsToday += 1;\n        continue;\n      }\n      if (tripDistance < METRO_CONFIG.longTripDistance && this.tryCreateMetroTrip(trip.origin, trip.destination)) {\n        trip.origin.tripsToday += 1;\n        trip.destination.tripsToday += 1;\n        continue;\n      }",
    );
  }
  if (!content.includes('buildMetroStationAt(x: number, y: number)')) {
    const metroMethods = `
  getMetroStation(id: string | undefined): MetroStation | undefined {
    if (!id) return undefined;
    return this.metroStations.find((station) => station.id === id);
  }

  getMetroStationAt(x: number, y: number): MetroStation | undefined {
    return this.metroStations.find((station) => station.x === x && station.y === y);
  }

  getMetroLinesForStation(stationId: string): MetroLine[] {
    return this.metroLines.filter((line) => line.active && line.stationIds.includes(stationId));
  }

  inspectMetroStation(stationId: string): void {
    const station = this.getMetroStation(stationId);
    if (station) this.selected = { kind: 'metroStation', station };
    this.emit();
  }

  inspectMetroLine(lineId: string): void {
    const line = this.metroLines.find((candidate) => candidate.id === lineId);
    if (line) this.selected = { kind: 'metroLine', line };
    this.emit();
  }

  inspectMetroTrain(trainId: string): void {
    const train = this.metroTrains.find((candidate) => candidate.id === trainId);
    this.selected = train ? { kind: 'metroTrain', trainId, train } : { kind: 'none' };
    this.emit();
  }

  buildMetroStationAt(x: number, y: number): boolean {
    if (!inBounds(x, y)) return false;
    if (this.getMetroStationAt(x, y)) return false;
    if (this.money < METRO_CONFIG.stationBuildCost) return false;

    const station: MetroStation = {
      id: nanoid(8),
      name: \`Estação \${this.metroStations.length + 1}\`,
      x,
      y,
      coverageRadius: METRO_CONFIG.stationCoverageRadius,
      capacity: METRO_CONFIG.stationCapacity,
      waitingPassengers: 0,
      totalBoarded: 0,
      totalAlighted: 0,
      createdAtDay: this.time.getDay(),
    };

    this.metroStations.push(station);
    this.money -= METRO_CONFIG.stationBuildCost;
    this.selected = { kind: 'metroStation', station };
    this.markStaticRenderDirty();
    this.emit();
    return true;
  }

  buildMetroTrack(fromStationId: string, toStationId: string): { success: boolean; cost?: number; reason?: string } {
    const from = this.getMetroStation(fromStationId);
    const to = this.getMetroStation(toStationId);
    if (!from || !to) return { success: false, reason: 'Selecione duas estações válidas.' };
    if (from.id === to.id) return { success: false, reason: 'O trilho precisa ligar duas estações diferentes.' };
    if (this.hasMetroTrackBetween(from.id, to.id)) return { success: false, reason: 'Essas estações já estão conectadas.' };

    const tiles = buildMetroTrackTiles(from, to);
    const distance = Math.max(1, tiles.length - 1);
    const cost = distance * METRO_CONFIG.trackCostPerTile;
    if (this.money < cost) return { success: false, cost, reason: \`Faltam $ \${cost - this.money} para construir o trilho.\` };

    this.metroTracks.push({
      id: nanoid(8),
      fromStationId: from.id,
      toStationId: to.id,
      tiles,
      distance,
      active: true,
    });

    this.money -= cost;
    this.markStaticRenderDirty();
    this.emit();
    return { success: true, cost };
  }

  hasMetroTrackBetween(fromStationId: string, toStationId: string): boolean {
    return this.metroTracks.some((track) => track.active && (
      (track.fromStationId === fromStationId && track.toStationId === toStationId)
      || (track.fromStationId === toStationId && track.toStationId === fromStationId)
    ));
  }

  findMetroRoute(fromStationId: string, toStationId: string): string[] {
    return findMetroStationPath(this.metroStations, this.metroTracks, fromStationId, toStationId);
  }

  createMetroLine(stationIds: string[]): { success: boolean; name?: string; cost?: number; reason?: string } {
    const uniqueStationIds = dedupeIds(stationIds);
    if (uniqueStationIds.length < METRO_CONFIG.minStationsForLine) return { success: false, reason: 'A linha precisa ter ao menos duas estações.' };

    for (let i = 0; i < uniqueStationIds.length - 1; i += 1) {
      if (!this.hasMetroTrackBetween(uniqueStationIds[i], uniqueStationIds[i + 1])) {
        return { success: false, reason: 'Todas as estações consecutivas precisam estar conectadas por trilhos.' };
      }
    }

    if (this.money < METRO_CONFIG.lineActivationCost) {
      return { success: false, cost: METRO_CONFIG.lineActivationCost, reason: \`Faltam $ \${METRO_CONFIG.lineActivationCost - this.money} para ativar a linha.\` };
    }

    const line: MetroLine = {
      id: nanoid(8),
      name: \`Linha \${this.metroLines.length + 1}\`,
      color: pickMetroLineColor(this.metroLines.length),
      stationIds: uniqueStationIds,
      active: true,
      frequencySeconds: 18,
      trainCapacity: METRO_CONFIG.trainCapacity,
      totalPassengers: 0,
      carsAvoided: 0,
    };

    this.metroLines.push(line);
    this.spawnMetroTrain(line.id);
    this.money -= METRO_CONFIG.lineActivationCost;
    this.selected = { kind: 'metroLine', line };
    this.markStaticRenderDirty();
    this.emit();
    return { success: true, name: line.name, cost: METRO_CONFIG.lineActivationCost };
  }

  private spawnMetroTrain(lineId: string): void {
    const line = this.metroLines.find((candidate) => candidate.id === lineId);
    if (!line || line.stationIds.length < 2) return;
    this.metroTrains.push({
      id: nanoid(8),
      lineId,
      stationIndex: 0,
      nextStationIndex: 1,
      progress: 0,
      speed: METRO_CONFIG.trainSpeedTilesPerSecond,
      passengers: 0,
      capacity: line.trainCapacity,
      direction: 1,
      dwellSeconds: 0,
    });
  }

  private updateMetro(dt: number): void {
    for (const train of this.metroTrains) {
      const line = this.metroLines.find((candidate) => candidate.id === train.lineId);
      if (!line || !line.active || line.stationIds.length < 2) continue;

      if ((train.dwellSeconds ?? 0) > 0) {
        train.dwellSeconds = Math.max(0, (train.dwellSeconds ?? 0) - dt);
        continue;
      }

      const from = this.getMetroStation(line.stationIds[train.stationIndex]);
      const to = this.getMetroStation(line.stationIds[train.nextStationIndex]);
      if (!from || !to) continue;

      const distance = Math.max(1, manhattan(from, to));
      train.progress += (train.speed / distance) * dt;

      if (train.progress < 1) continue;
      train.progress = 0;
      train.stationIndex = train.nextStationIndex;
      train.nextStationIndex += train.direction;

      if (train.nextStationIndex >= line.stationIds.length) {
        train.direction = -1;
        train.nextStationIndex = Math.max(0, line.stationIds.length - 2);
      }

      if (train.nextStationIndex < 0) {
        train.direction = 1;
        train.nextStationIndex = Math.min(1, line.stationIds.length - 1);
      }

      this.processMetroStationStop(train, line);
    }
  }

  private processMetroStationStop(train: MetroTrain, line: MetroLine): void {
    const station = this.getMetroStation(line.stationIds[train.stationIndex]);
    if (!station) return;

    const alighting = Math.min(train.passengers, Math.ceil(train.passengers * 0.55));
    train.passengers -= alighting;
    station.totalAlighted += alighting;

    const freeSeats = Math.max(0, train.capacity - train.passengers);
    const boarding = Math.min(freeSeats, station.waitingPassengers);
    station.waitingPassengers -= boarding;
    station.totalBoarded += boarding;
    train.passengers += boarding;
    line.totalPassengers += boarding;
    train.dwellSeconds = METRO_CONFIG.trainDwellSeconds;
  }

  private tryCreateMetroTrip(origin: Building, destination: Building): boolean {
    if (!this.metroLines.some((line) => line.active)) return false;
    if (Math.random() > METRO_CONFIG.metroTripPreference) return false;

    const originStation = this.findNearestMetroStation(origin);
    const destinationStation = this.findNearestMetroStation(destination);
    if (!originStation || !destinationStation) return false;
    if (originStation.id === destinationStation.id) return false;

    const route = this.findMetroRoute(originStation.id, destinationStation.id);
    if (route.length < 2) return false;
    const activeLine = this.metroLines.find((line) => line.active && route.every((stationId) => line.stationIds.includes(stationId)));
    if (!activeLine) return false;
    if (originStation.waitingPassengers >= originStation.capacity) return false;

    originStation.waitingPassengers += 1;
    activeLine.carsAvoided += 1;
    this.metroTripsCompleted += 1;
    this.metroCarsAvoided += 1;
    this.carTripsAvoided += 1;
    this.completedTrips += 1;
    this.tripHistory.push(Math.max(2, route.length * 1.2));
    if (this.tripHistory.length > TRAVEL_TIME_HISTORY_LIMIT) this.tripHistory.shift();
    this.averageTravelTime = this.tripHistory.length ? this.tripHistory.reduce((a, b) => a + b, 0) / this.tripHistory.length : 0;
    return true;
  }

  private findNearestMetroStation(pos: Vec2): MetroStation | undefined {
    return this.metroStations
      .map((station) => ({ station, distance: manhattan(pos, station) }))
      .filter((candidate) => candidate.distance <= candidate.station.coverageRadius)
      .sort((a, b) => a.distance - b.distance)[0]?.station;
  }

  private removeMetroStationAt(stationId: string): boolean {
    const station = this.getMetroStation(stationId);
    if (!station) return false;
    this.metroStations = this.metroStations.filter((candidate) => candidate.id !== stationId);
    this.metroTracks = this.metroTracks.filter((track) => track.fromStationId !== stationId && track.toStationId !== stationId);
    this.metroLines = this.metroLines.filter((line) => !line.stationIds.includes(stationId));
    const activeLineIds = new Set(this.metroLines.map((line) => line.id));
    this.metroTrains = this.metroTrains.filter((train) => activeLineIds.has(train.lineId));
    this.selected = { kind: 'tile', x: station.x, y: station.y, type: this.grid[station.y]?.[station.x]?.type ?? 'empty' };
    this.markStaticRenderDirty();
    return true;
  }
`;
    content = content.replace(
      "  private updateEconomyAndSatisfaction(): void {",
      `${metroMethods}\n  private updateEconomyAndSatisfaction(): void {`,
    );
  }
  if (!content.includes('function dedupeIds')) {
    content = content.replace(
      "function passengerGroupCount(groups: TransitPassengerGroup[]): number {",
      "function dedupeIds(ids: string[]): string[] {\n  const seen = new Set<string>();\n  const result: string[] = [];\n  for (const id of ids) {\n    if (seen.has(id)) continue;\n    seen.add(id);\n    result.push(id);\n  }\n  return result;\n}\n\nfunction passengerGroupCount(groups: TransitPassengerGroup[]): number {",
    );
  }
  write(rel, content);
}

function patchStyles() {
  const rel = 'src/styles.css';
  let content = read(rel);
  if (content.includes('.layer-toggle')) return;
  backup(rel);
  content += `

/* Metro / underground layer */
.layer-toggle {
  position: absolute;
  top: 56px;
  right: 16px;
  z-index: 12;
  display: inline-flex;
  gap: 6px;
  padding: 6px;
  border: 1px solid rgba(150, 167, 189, 0.22);
  border-radius: 999px;
  background: rgba(7, 17, 31, 0.74);
  box-shadow: var(--shadow);
  backdrop-filter: blur(14px);
}

.layer-toggle button {
  min-height: 32px;
  padding: 7px 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.layer-toggle button.active {
  color: #06111d;
  background: linear-gradient(135deg, #5cc8ff, #35d07f);
}
`;
  write(rel, content);
}

function main() {
  const required = [
    'src/game/engine/simulation.ts',
    'src/game/rendering/PixiGame.tsx',
    'src/game/rendering/renderWorld.ts',
    'src/game/rendering/inputController.ts',
    'src/types/city.types.ts',
    'src/types/game.types.ts',
    'src/store/gameStore.ts',
    'src/components/toolData.ts',
    'src/components/HudBar.tsx',
    'src/components/DetailsPanel.tsx',
    'src/styles.css',
  ];
  for (const rel of required) {
    if (!fs.existsSync(file(rel))) throw new Error(`Execute este script na raiz do projeto. Arquivo não encontrado: ${rel}`);
  }

  copyFromPackage('src/types/metro.types.ts');
  copyFromPackage('src/game/config/metroConfig.ts');
  copyFromPackage('src/game/metro/metroGraph.ts');
  copyFromPackage('src/game/metro/metroRouting.ts');
  copyFromPackage('src/game/metro/metroTripResolver.ts');
  copyFromPackage('src/game/metro/metroLineBuilder.ts');
  copyFromPackage('src/game/rendering/renderMetro.ts');
  copyFromPackage('src/components/LayerToggle.tsx');
  copyFromPackage('src/components/MetroLineEditor.tsx');

  patchGameTypes();
  patchCityTypes();
  patchStore();
  patchToolData();
  patchHudBar();
  patchDetailsPanel();
  patchPixiGame();
  patchRenderWorld();
  patchInputController();
  patchSimulation();
  patchStyles();

  ensureContains('src/game/engine/simulation.ts', 'tryCreateMetroTrip', 'A integração de viagens do metrô não foi aplicada.');
  ensureContains('src/game/rendering/renderWorld.ts', 'renderMetroLayer', 'A renderização do metrô não foi aplicada.');
  ensureContains('src/game/rendering/inputController.ts', "state.selectedTool === 'metroTrack'", 'O input de trilhos não foi aplicado.');

  console.log('Sistema de metrô V1 aplicado com sucesso.');
  console.log('Backups criados com sufixo:', BACKUP_SUFFIX);
  console.log('Execute: npm run build && npm run dev');
}

try {
  main();
} catch (error) {
  console.error('Falha ao aplicar sistema de metrô V1:');
  console.error(error.message);
  process.exit(1);
}
