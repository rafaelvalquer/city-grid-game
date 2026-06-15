const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = process.cwd();
const packageRoot = __dirname;
const BACKUP_SUFFIX = '.bak-metro-surface-v2';
// Revisão: replaceMethod agora reconhece métodos public/private/protected.
// Isso corrige o erro: Método não encontrado: processMetroStationStop.

function file(rel) { return path.join(root, rel); }
function packageFile(rel) { return path.join(packageRoot, rel); }
function read(rel) { return fs.readFileSync(file(rel), 'utf8'); }
function write(rel, content) { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), content, 'utf8'); }
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
function ensureFile(rel) {
  if (!fs.existsSync(file(rel))) throw new Error(`Execute na raiz do projeto. Arquivo não encontrado: ${rel}`);
}
function replaceMethod(content, methodName, replacement) {
  const starts = [
    content.indexOf(`  ${methodName}`),
    content.indexOf(`  private ${methodName}`),
    content.indexOf(`  public ${methodName}`),
    content.indexOf(`  protected ${methodName}`),
  ].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start < 0) throw new Error(`Método não encontrado: ${methodName}`);
  const open = content.indexOf('{', start);
  if (open < 0) throw new Error(`Abertura do método não encontrada: ${methodName}`);
  let depth = 0;
  for (let i = open; i < content.length; i += 1) {
    const char = content[i];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(0, start) + replacement.trimEnd() + content.slice(i + 1);
      }
    }
  }
  throw new Error(`Fechamento do método não encontrado: ${methodName}`);
}
function insertBefore(rel, marker, insertion, id) {
  let content = read(rel);
  if (content.includes(id)) return;
  if (!content.includes(marker)) throw new Error(`Marcador não encontrado em ${rel}: ${marker}`);
  backup(rel);
  content = content.replace(marker, `${insertion}\n${marker}`);
  write(rel, content);
}
function appendStyleOnce(css) {
  const rel = 'src/styles.css';
  let content = read(rel);
  if (content.includes('/* Metro surface V2 */')) return;
  backup(rel);
  content += `\n\n${css}\n`;
  write(rel, content);
}

function runMetroV1IfNeeded() {
  const hasMetroType = fs.existsSync(file('src/types/metro.types.ts'));
  const hasMetroTool = fs.existsSync(file('src/types/game.types.ts')) && read('src/types/game.types.ts').includes("'metroStation'");
  const hasViewLayer = fs.existsSync(file('src/store/gameStore.ts')) && read('src/store/gameStore.ts').includes('viewLayer');
  const hasMetroCore = fs.existsSync(file('src/game/engine/simulation.ts'))
    && read('src/game/engine/simulation.ts').includes('buildMetroStationAt')
    && read('src/game/engine/simulation.ts').includes('updateMetro')
    && read('src/game/engine/simulation.ts').includes('processMetroStationStop')
    && read('src/game/engine/simulation.ts').includes('tryCreateMetroTrip');
  if (hasMetroType && hasMetroTool && hasViewLayer && hasMetroCore) return;

  const script = packageFile('apply-metro-system.cjs');
  if (!fs.existsSync(script)) throw new Error('Metrô V1 não está aplicado e apply-metro-system.cjs não está no pacote.');
  console.log('Metrô V1 não detectado. Aplicando Metrô V1 antes da V2...');
  childProcess.execFileSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
}

function patchCityTypes() {
  const rel = 'src/types/city.types.ts';
  let content = read(rel);
  backup(rel);

  if (!content.includes("'metroStation'")) {
    content = content.replace(
      "export type TileType = 'empty' | 'road' | 'avenue' | 'roundabout' | 'roundaboutCenter' | 'building' | 'busStop';",
      "export type TileType = 'empty' | 'road' | 'avenue' | 'roundabout' | 'roundaboutCenter' | 'building' | 'busStop' | 'metroStation';",
    );
  }

  if (!content.includes('metroStationId?: string;')) {
    content = content.replace(
      '  buildingId?: string;\n  oneWay?: RoadDirection;',
      '  buildingId?: string;\n  metroStationId?: string;\n  oneWay?: RoadDirection;',
    );
  }

  if (!content.includes('metroPassengersWaiting: number;')) {
    content = content.replace(
      '  metroTripsCompleted: number;\n  cityLevel: number;',
      '  metroTripsCompleted: number;\n  metroPassengersWaiting: number;\n  metroTrains: number;\n  cityLevel: number;',
    );
  }

  if (!content.includes('metroPassengersWaiting: number;\n  metroStations: number;')) {
    content = content.replace(
      '  metroPassengers: number;\n  averageCongestion: number;',
      '  metroPassengers: number;\n  metroPassengersWaiting: number;\n  metroStations: number;\n  metroLines: number;\n  metroTrains: number;\n  averageCongestion: number;',
    );
  }

  write(rel, content);
}

function patchStore() {
  const rel = 'src/store/gameStore.ts';
  let content = read(rel);
  backup(rel);
  if (!content.includes('metroPassengersWaiting: 0,')) {
    content = content.replace(
      '  metroTripsCompleted: 0,\n  cityLevel: 1,',
      '  metroTripsCompleted: 0,\n  metroPassengersWaiting: 0,\n  metroTrains: 0,\n  cityLevel: 1,',
    );
  }
  write(rel, content);
}

function patchSimulation() {
  const rel = 'src/game/engine/simulation.ts';
  let content = read(rel);
  backup(rel);

  if (!content.includes('MetroLineStats')) {
    content = content.replace(
      "import type { MetroLine, MetroStation, MetroTrack, MetroTrain } from '../../types/metro.types';",
      "import type { MetroLine, MetroLineStats, MetroStation, MetroTrack, MetroTrain } from '../../types/metro.types';",
    );
  }

  // Snapshot metrics.
  if (!content.includes('metroPassengersWaiting: this.getMetroWaitingPassengerCount()')) {
    content = content.replace(
      '      metroPassengers: this.metroTrains.reduce((sum, train) => sum + train.passengers, 0) + this.metroStations.reduce((sum, station) => sum + station.waitingPassengers, 0),\n      metroCarsAvoided: this.metroCarsAvoided,\n      metroTripsCompleted: this.metroTripsCompleted,',
      '      metroPassengers: this.metroTrains.reduce((sum, train) => sum + train.passengers, 0) + this.getMetroWaitingPassengerCount(),\n      metroCarsAvoided: this.metroCarsAvoided,\n      metroTripsCompleted: this.metroTripsCompleted,\n      metroPassengersWaiting: this.getMetroWaitingPassengerCount(),\n      metroTrains: this.metroTrains.length,',
    );
  }

  // History metrics.
  if (!content.includes('metroPassengersWaiting: snapshot.metroPassengersWaiting')) {
    content = content.replace(
      '      metroPassengers: snapshot.metroPassengers,\n      averageCongestion: snapshot.averageCongestion,',
      '      metroPassengers: snapshot.metroPassengers,\n      metroPassengersWaiting: snapshot.metroPassengersWaiting,\n      metroStations: snapshot.metroStations,\n      metroLines: snapshot.metroLines,\n      metroTrains: snapshot.metroTrains,\n      averageCongestion: snapshot.averageCongestion,',
    );
  }

  // Station occupies the surface tile now.
  content = replaceMethod(content, 'buildMetroStationAt', `  buildMetroStationAt(x: number, y: number): boolean {
    if (!inBounds(x, y)) return false;
    const tile = this.grid[y]?.[x];
    if (!tile || tile.type !== 'empty') return false;
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
      totalPassengersHandled: 0,
      activeLineIds: [],
      peakWaitingPassengers: 0,
      carsAvoidedFromStation: 0,
      createdAtDay: this.time.getDay(),
    };

    this.metroStations.push(station);
    this.grid[y][x] = { x, y, type: 'metroStation', metroStationId: station.id };
    this.money -= METRO_CONFIG.stationBuildCost;
    this.selected = { kind: 'metroStation', station };
    this.markStaticRenderDirty();
    this.emit();
    return true;
  }`);

  content = replaceMethod(content, 'createMetroLine', `  createMetroLine(stationIds: string[]): { success: boolean; name?: string; cost?: number; reason?: string } {
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
      currentPassengers: 0,
      waitingPassengers: 0,
      carsAvoided: 0,
      trainsActive: 0,
      completedCycles: 0,
    };

    this.metroLines.push(line);
    for (const stationId of uniqueStationIds) {
      const station = this.getMetroStation(stationId);
      if (station && !station.activeLineIds.includes(line.id)) station.activeLineIds.push(line.id);
    }
    this.spawnMetroTrain(line.id);
    this.refreshMetroLineMetrics(line.id);
    this.money -= METRO_CONFIG.lineActivationCost;
    this.selected = { kind: 'metroLine', line };
    this.markStaticRenderDirty();
    this.emit();
    return { success: true, name: line.name, cost: METRO_CONFIG.lineActivationCost };
  }`);

  content = replaceMethod(content, 'processMetroStationStop', `  private processMetroStationStop(train: MetroTrain, line: MetroLine): void {
    const station = this.getMetroStation(line.stationIds[train.stationIndex]);
    if (!station) return;

    const alighting = Math.min(train.passengers, Math.ceil(train.passengers * 0.35));
    train.passengers -= alighting;
    station.totalAlighted += alighting;
    station.totalPassengersHandled += alighting;

    const freeSeats = Math.max(0, train.capacity - train.passengers);
    const boarding = Math.min(freeSeats, station.waitingPassengers);
    station.waitingPassengers -= boarding;
    station.totalBoarded += boarding;
    station.totalPassengersHandled += boarding;
    train.passengers += boarding;
    train.dwellSeconds = METRO_CONFIG.trainDwellSeconds;

    if (train.direction < 0 && train.stationIndex === 0) line.completedCycles += 1;
    if (train.direction > 0 && train.stationIndex === line.stationIds.length - 1) line.completedCycles += 1;
    this.refreshMetroLineMetrics(line.id);
  }`);

  content = replaceMethod(content, 'tryCreateMetroTrip', `  private tryCreateMetroTrip(origin: Building, destination: Building): boolean {
    if (!this.metroLines.some((line) => line.active)) return false;
    if (Math.random() > METRO_CONFIG.metroTripPreference) return false;

    const originStation = this.findNearestMetroStation(origin);
    const destinationStation = this.findNearestMetroStation(destination);
    if (!originStation || !destinationStation) return false;
    if (originStation.id === destinationStation.id) return false;

    const route = this.findMetroRoute(originStation.id, destinationStation.id);
    if (route.length < 2) return false;
    const activeLine = this.findBestMetroLineForRoute(route);
    if (!activeLine) return false;
    if (originStation.waitingPassengers >= originStation.capacity) return false;

    originStation.waitingPassengers += 1;
    originStation.carsAvoidedFromStation += 1;
    originStation.totalPassengersHandled += 1;
    originStation.peakWaitingPassengers = Math.max(originStation.peakWaitingPassengers, originStation.waitingPassengers);

    activeLine.carsAvoided += 1;
    activeLine.waitingPassengers += 1;
    activeLine.totalPassengers += 1;
    this.metroTripsCompleted += 1;
    this.metroCarsAvoided += 1;
    this.carTripsAvoided += 1;
    this.completedTrips += 1;
    this.tripHistory.push(Math.max(2, route.length * 1.2));
    if (this.tripHistory.length > TRAVEL_TIME_HISTORY_LIMIT) this.tripHistory.shift();
    this.averageTravelTime = this.tripHistory.length ? this.tripHistory.reduce((a, b) => a + b, 0) / this.tripHistory.length : 0;
    this.refreshMetroLineMetrics(activeLine.id);
    return true;
  }`);

  content = replaceMethod(content, 'removeMetroStationAt', `  private removeMetroStationAt(stationId: string): boolean {
    const station = this.getMetroStation(stationId);
    if (!station) return false;

    const affectedLineIds = new Set(
      this.metroLines
        .filter((line) => line.stationIds.includes(stationId))
        .map((line) => line.id),
    );

    this.metroStations = this.metroStations.filter((candidate) => candidate.id !== stationId);
    this.metroTracks = this.metroTracks.filter((track) => track.fromStationId !== stationId && track.toStationId !== stationId);
    this.metroLines = this.metroLines.filter((line) => !affectedLineIds.has(line.id));
    this.metroTrains = this.metroTrains.filter((train) => !affectedLineIds.has(train.lineId));

    if (this.grid[station.y]?.[station.x]?.type === 'metroStation') {
      this.grid[station.y][station.x] = { x: station.x, y: station.y, type: 'empty' };
    }

    if (this.selected.kind === 'metroStation' && this.selected.station.id === stationId) {
      this.selected = { kind: 'tile', x: station.x, y: station.y, type: 'empty' };
    }

    this.markStaticRenderDirty();
    return true;
  }`);

  if (!content.includes('getMetroLineStats(lineId: string): MetroLineStats | undefined')) {
    const methods = `
  getMetroLineStats(lineId: string): MetroLineStats | undefined {
    const line = this.metroLines.find((candidate) => candidate.id === lineId);
    if (!line) return undefined;
    const stations = line.stationIds.map((id) => this.getMetroStation(id)).filter((station): station is MetroStation => Boolean(station));
    const trains = this.metroTrains.filter((train) => train.lineId === lineId);
    return {
      id: line.id,
      name: line.name,
      color: line.color,
      active: line.active,
      stations: stations.length,
      trains: trains.length,
      waitingPassengers: stations.reduce((sum, station) => sum + station.waitingPassengers, 0),
      currentPassengers: trains.reduce((sum, train) => sum + train.passengers, 0),
      totalPassengers: line.totalPassengers,
      carsAvoided: line.carsAvoided,
      completedCycles: line.completedCycles,
      stationIds: line.stationIds,
    };
  }

  deleteMetroLine(lineId: string): boolean {
    const exists = this.metroLines.some((line) => line.id === lineId);
    if (!exists) return false;
    this.metroLines = this.metroLines.filter((line) => line.id !== lineId);
    this.metroTrains = this.metroTrains.filter((train) => train.lineId !== lineId);
    for (const station of this.metroStations) {
      station.activeLineIds = station.activeLineIds.filter((id) => id !== lineId);
    }
    if (this.selected.kind === 'metroLine' && this.selected.line.id === lineId) this.selected = { kind: 'none' };
    this.markStaticRenderDirty();
    this.emit();
    return true;
  }

  private getMetroWaitingPassengerCount(): number {
    return this.metroStations.reduce((sum, station) => sum + station.waitingPassengers, 0);
  }

  private findBestMetroLineForRoute(route: string[]): MetroLine | undefined {
    return this.metroLines.find((line) => line.active && route.every((stationId) => line.stationIds.includes(stationId)));
  }

  private refreshMetroLineMetrics(lineId: string): void {
    const line = this.metroLines.find((candidate) => candidate.id === lineId);
    if (!line) return;
    const trains = this.metroTrains.filter((train) => train.lineId === lineId);
    const stations = line.stationIds.map((id) => this.getMetroStation(id)).filter((station): station is MetroStation => Boolean(station));
    line.trainsActive = trains.length;
    line.currentPassengers = trains.reduce((sum, train) => sum + train.passengers, 0);
    line.waitingPassengers = stations.reduce((sum, station) => sum + station.waitingPassengers, 0);
  }
`;
    content = content.replace('  private findNearestMetroStation(pos: Vec2): MetroStation | undefined {', `${methods}\n  private findNearestMetroStation(pos: Vec2): MetroStation | undefined {`);
  }

  // Block road/avenue over stations.
  if (!content.includes("if (tile.type === 'metroStation') return false;")) {
    content = content.replace(
      "      if (tile.type === 'busStop') return false;\n      if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) return false;",
      "      if (tile.type === 'busStop') return false;\n      if (tile.type === 'metroStation') return false;\n      if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) return false;",
    );
  }
  if (!content.includes("reason: 'A linha passa por uma estação de metrô.'")) {
    content = content.replace(
      "      if (tile.type === 'busStop') return { success: false, built: 0, cost: 0, reason: 'A linha passa por um ponto de ônibus.' };",
      "      if (tile.type === 'busStop') return { success: false, built: 0, cost: 0, reason: 'A linha passa por um ponto de ônibus.' };\n      if (tile.type === 'metroStation') return { success: false, built: 0, cost: 0, reason: 'A linha passa por uma estação de metrô.' };",
    );
  }

  // Inspect station from surface.
  if (!content.includes("tile.type === 'metroStation' && tile.metroStationId")) {
    content = content.replace(
      "    } else if (tile.type === 'busStop' && tile.buildingId) {\n      const stop = this.getTransitStop(tile.buildingId);\n      this.selected = stop ? { kind: 'busStop', stop } : { kind: 'tile', x, y, type: tile.type };",
      "    } else if (tile.type === 'busStop' && tile.buildingId) {\n      const stop = this.getTransitStop(tile.buildingId);\n      this.selected = stop ? { kind: 'busStop', stop } : { kind: 'tile', x, y, type: tile.type };\n    } else if (tile.type === 'metroStation' && tile.metroStationId) {\n      const station = this.getMetroStation(tile.metroStationId);\n      this.selected = station ? { kind: 'metroStation', station } : { kind: 'tile', x, y, type: tile.type };",
    );
  }

  write(rel, content);
}

function patchInputController() {
  const rel = 'src/game/rendering/inputController.ts';
  let content = read(rel);
  backup(rel);

  if (!content.includes("if (tile.type !== 'empty') return { x, y, label: 'Tile ocupado'")) {
    content = content.replace(
      "  if (tool === 'metroStation') {\n    const cost = METRO_CONFIG.stationBuildCost;\n    if (world.getMetroStationAt(x, y)) return { x, y, label: 'Estação já existe', cost, valid: false, reason: 'Já existe uma estação de metrô nesse tile.', successMessage: '' };",
      "  if (tool === 'metroStation') {\n    const cost = METRO_CONFIG.stationBuildCost;\n    if (world.getMetroStationAt(x, y)) return { x, y, label: 'Estação já existe', cost, valid: false, reason: 'Já existe uma estação de metrô nesse tile.', successMessage: '' };\n    if (tile.type !== 'empty') return { x, y, label: 'Tile ocupado', cost, valid: false, reason: 'A estação precisa ocupar um tile vazio na superfície.', successMessage: '' };",
    );
  }

  // Allow station construction from both surface and underground.
  content = content.replace(
    "    if (state.selectedTool === 'metroStation') {\n      if (state.viewLayer !== 'underground') {\n        state.setActionFeedback('Ative a camada Subsolo para construir estações.');\n        return;\n      }",
    "    if (state.selectedTool === 'metroStation') {",
  );

  write(rel, content);
}

function patchPixiGame() {
  const rel = 'src/game/rendering/PixiGame.tsx';
  let content = read(rel);
  backup(rel);

  if (!content.includes("useState } from 'react'")) {
    content = content.replace("import { useEffect, useRef } from 'react';", "import { useEffect, useRef, useState } from 'react';");
  }
  if (!content.includes('../../components/MetroManagementPanel')) {
    content = content.replace(
      "import { CanvasToolDock } from '../../components/CanvasToolDock';",
      "import { CanvasToolDock } from '../../components/CanvasToolDock';\nimport { MetroManagementPanel } from '../../components/MetroManagementPanel';",
    );
  }
  if (!content.includes('const [metroManagerOpen, setMetroManagerOpen]')) {
    content = content.replace(
      "  const heatmapModeUi = useGameStore((s) => s.heatmapMode);",
      "  const heatmapModeUi = useGameStore((s) => s.heatmapMode);\n  const viewLayerUi = useGameStore((s) => s.viewLayer);\n  const [metroManagerOpen, setMetroManagerOpen] = useState(false);",
    );
  }
  if (!content.includes('metro-manager-toggle')) {
    content = content.replace(
      "      <CanvasToolDock />",
      "      <CanvasToolDock />\n      {viewLayerUi === 'underground' && (\n        <button className=\"metro-manager-toggle\" type=\"button\" onClick={() => setMetroManagerOpen((open) => !open)}>\n          🚇 Gerenciar linhas\n        </button>\n      )}\n      {metroManagerOpen && <MetroManagementPanel world={world} onClose={() => setMetroManagerOpen(false)} />}",
    );
  }

  write(rel, content);
}

function patchDetailsPanel() {
  const rel = 'src/components/DetailsPanel.tsx';
  let content = read(rel);
  backup(rel);
  if (!content.includes('Passageiros processados')) {
    content = content.replace(
      "          <p><span>Desembarques</span><strong>{selected.station.totalAlighted}</strong></p>\n          <p><span>Cobertura</span><strong>{selected.station.coverageRadius} tiles</strong></p>\n          <p><span>Linhas</span><strong>{world.getMetroLinesForStation(selected.station.id).map((line) => line.name).join(', ') || 'Nenhuma'}</strong></p>",
      "          <p><span>Desembarques</span><strong>{selected.station.totalAlighted}</strong></p>\n          <p><span>Passageiros processados</span><strong>{selected.station.totalPassengersHandled}</strong></p>\n          <p><span>Pico de fila</span><strong>{selected.station.peakWaitingPassengers}</strong></p>\n          <p><span>Carros evitados</span><strong>{selected.station.carsAvoidedFromStation}</strong></p>\n          <p><span>Cobertura</span><strong>{selected.station.coverageRadius} tiles</strong></p>\n          <p><span>Linhas</span><strong>{world.getMetroLinesForStation(selected.station.id).map((line) => line.name).join(', ') || 'Nenhuma'}</strong></p>\n          <p><span>Status</span><strong className={selected.station.activeLineIds.length ? 'good' : 'warn'}>{selected.station.activeLineIds.length ? 'Ativa' : 'Sem linha'}</strong></p>",
    );
  }
  if (!content.includes('Ciclos completos')) {
    content = content.replace(
      "          <p><span>Carros evitados</span><strong>{selected.line.carsAvoided}</strong></p>\n          <p><span>Frequência</span><strong>{selected.line.frequencySeconds}s</strong></p>",
      "          <p><span>Carros evitados</span><strong>{selected.line.carsAvoided}</strong></p>\n          <p><span>Passageiros atuais</span><strong>{selected.line.currentPassengers}</strong></p>\n          <p><span>Passageiros esperando</span><strong>{selected.line.waitingPassengers}</strong></p>\n          <p><span>Ciclos completos</span><strong>{selected.line.completedCycles}</strong></p>\n          <p><span>Frequência</span><strong>{selected.line.frequencySeconds}s</strong></p>",
    );
  }
  write(rel, content);
}

function patchAnalyticsPanel() {
  const rel = 'src/components/AnalyticsPanel.tsx';
  let content = read(rel);
  backup(rel);

  if (!content.includes('MetroAnalyticsCard')) {
    content = content.replace(
      "          { label: 'Carros evitados', value: latest.carTripsAvoided, initial: samples[0].carTripsAvoided },\n        ]} />",
      "          { label: 'Carros evitados', value: latest.carTripsAvoided, initial: samples[0].carTripsAvoided },\n          { label: 'Viagens de metrô', value: latest.metroTripsCompleted ?? 0, initial: samples[0].metroTripsCompleted ?? 0 },\n          { label: 'Carros evitados pelo metrô', value: latest.metroCarsAvoided ?? 0, initial: samples[0].metroCarsAvoided ?? 0 },\n        ]} />\n        <MetroAnalyticsCard world={world} latest={latest} />",
    );
    content = content.replace(
      "        <ChartCard title=\"Impacto do transporte público\" samples={samples} series={[\n          { label: 'Viagens por ônibus', color: 'good', values: samples.map((s) => s.publicTripsCompleted) },\n          { label: 'Carros evitados', color: 'accent', values: samples.map((s) => s.carTripsAvoided) },\n        ]} />",
      "        <ChartCard title=\"Impacto do transporte público\" samples={samples} series={[\n          { label: 'Viagens por ônibus', color: 'good', values: samples.map((s) => s.publicTripsCompleted) },\n          { label: 'Viagens por metrô', color: 'accent', values: samples.map((s) => s.metroTripsCompleted ?? 0) },\n          { label: 'Carros evitados', color: 'warn', values: samples.map((s) => s.carTripsAvoided) },\n        ]} />\n        <ChartCard title=\"Metrô: demanda e operação\" samples={samples} series={[\n          { label: 'Passageiros metrô', color: 'accent', values: samples.map((s) => s.metroPassengers ?? 0) },\n          { label: 'Esperando no metrô', color: 'warn', values: samples.map((s) => s.metroPassengersWaiting ?? 0) },\n          { label: 'Trens x 30', color: 'good', values: samples.map((s) => (s.metroTrains ?? 0) * 30) },\n        ]} />",
    );

    const helper = `
function MetroAnalyticsCard({ world, latest }: { world: GameWorld; latest: CityHistorySample }) {
  const busiestStation = [...world.metroStations].sort((a, b) => b.waitingPassengers - a.waitingPassengers)[0];
  const busiestLine = [...world.metroLines].sort((a, b) => b.totalPassengers - a.totalPassengers)[0];
  return (
    <article className="analytics-card metro-analytics-card">
      <header>
        <h3>Metrô</h3>
        <span>{latest.metroLines ?? 0} linhas ativas</span>
      </header>
      <div className="metro-analytics-grid">
        <p><span>Estações</span><strong>{latest.metroStations ?? world.metroStations.length}</strong></p>
        <p><span>Trens</span><strong>{latest.metroTrains ?? world.metroTrains.length}</strong></p>
        <p><span>Passageiros aguardando</span><strong>{latest.metroPassengersWaiting ?? 0}</strong></p>
        <p><span>Viagens por metrô</span><strong>{latest.metroTripsCompleted ?? 0}</strong></p>
        <p><span>Carros evitados pelo metrô</span><strong>{latest.metroCarsAvoided ?? 0}</strong></p>
        <p><span>Linha mais usada</span><strong>{busiestLine ? busiestLine.name + ' (' + busiestLine.totalPassengers + ')' : 'Nenhuma'}</strong></p>
        <p><span>Estação mais carregada</span><strong>{busiestStation ? busiestStation.name + ' (' + busiestStation.waitingPassengers + ')' : 'Nenhuma'}</strong></p>
      </div>
    </article>
  );
}
`;
    content = content.replace('function MetricGrid({ samples, metrics }', `${helper}\nfunction MetricGrid({ samples, metrics }`);
  }

  write(rel, content);
}

function patchHudBar() {
  const rel = 'src/components/HudBar.tsx';
  let content = read(rel);
  backup(rel);
  if (!content.includes('stats.metroTrains')) {
    content = content.replace(
      '<div className="hud-item"><BusFront size={16} /><span>{stats.metroPassengers}</span><small>metrô</small></div>',
      '<div className="hud-item"><BusFront size={16} /><span>{stats.metroPassengers}</span><small>{stats.metroTrains} trens</small></div>',
    );
  }
  write(rel, content);
}

function patchStyles() {
  appendStyleOnce(`/* Metro surface V2 */
.metro-manager-toggle {
  position: absolute;
  top: 102px;
  right: 16px;
  z-index: 12;
  min-height: 34px;
  padding: 8px 12px;
  border: 1px solid rgba(92, 200, 255, 0.32);
  border-radius: 999px;
  background: rgba(7, 17, 31, 0.78);
  color: #dff6ff;
  font-weight: 850;
  cursor: pointer;
  box-shadow: var(--shadow);
  backdrop-filter: blur(14px);
}

.metro-management-panel {
  position: absolute;
  top: 146px;
  right: 16px;
  z-index: 18;
  width: min(390px, calc(100% - 32px));
  max-height: calc(100% - 170px);
  overflow-y: auto;
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(92, 200, 255, 0.26);
  border-radius: 16px;
  background: rgba(7, 17, 31, 0.92);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.metro-management-panel header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.metro-management-panel h2 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
}

.metro-management-panel header p,
.metro-management-panel p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.metro-management-panel header button,
.metro-line-delete {
  border: 1px solid rgba(150, 167, 189, 0.22);
  border-radius: 10px;
  background: rgba(16, 26, 42, 0.82);
  color: var(--text);
  cursor: pointer;
}

.metro-management-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.metro-management-summary span,
.metro-line-kpis span {
  display: grid;
  gap: 2px;
  padding: 8px;
  border: 1px solid rgba(150, 167, 189, 0.16);
  border-radius: 10px;
  background: rgba(16, 26, 42, 0.66);
}

.metro-management-summary strong,
.metro-line-kpis span {
  color: #e8eef7;
  font-size: 14px;
}

.metro-management-summary small,
.metro-line-kpis small {
  color: var(--muted);
  font-size: 10px;
}

.metro-line-list {
  display: grid;
  gap: 10px;
}

.metro-line-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(150, 167, 189, 0.16);
  border-radius: 12px;
  background: rgba(16, 26, 42, 0.72);
}

.metro-line-main {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.metro-line-main i {
  width: 12px;
  height: 34px;
  border-radius: 999px;
  flex: 0 0 auto;
}

.metro-line-main span {
  display: grid;
  gap: 2px;
}

.metro-line-main small {
  color: var(--muted);
}

.metro-line-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  text-align: center;
}

.metro-line-details {
  display: grid;
  gap: 8px;
  padding: 8px;
  border-radius: 10px;
  background: rgba(7, 17, 31, 0.45);
}

.metro-line-details p {
  display: grid;
  gap: 3px;
}

.metro-line-details p span {
  color: var(--muted);
}

.metro-station-list {
  display: grid;
  gap: 6px;
}

.metro-station-list div {
  display: grid;
  gap: 2px;
  padding: 6px;
  border-radius: 8px;
  background: rgba(92, 200, 255, 0.08);
}

.metro-line-delete {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #ffd6d6;
}

.metro-analytics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 8px;
}

.metro-analytics-grid p {
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 9px;
  border: 1px solid rgba(150, 167, 189, 0.14);
  border-radius: 10px;
  background: rgba(16, 26, 42, 0.5);
}

.metro-analytics-grid span {
  color: var(--muted);
  font-size: 12px;
}
`);
}

function copyV2Files() {
  copyFromPackage('src/types/metro.types.ts');
  copyFromPackage('src/game/rendering/renderMetro.ts');
  copyFromPackage('src/components/MetroManagementPanel.tsx');
}

function main() {
  [
    'src/game/engine/simulation.ts',
    'src/game/rendering/PixiGame.tsx',
    'src/game/rendering/renderWorld.ts',
    'src/game/rendering/inputController.ts',
    'src/types/city.types.ts',
    'src/types/game.types.ts',
    'src/store/gameStore.ts',
    'src/components/HudBar.tsx',
    'src/components/DetailsPanel.tsx',
    'src/components/AnalyticsPanel.tsx',
    'src/styles.css',
  ].forEach(ensureFile);

  runMetroV1IfNeeded();
  copyV2Files();
  patchCityTypes();
  patchStore();
  patchSimulation();
  patchInputController();
  patchPixiGame();
  patchDetailsPanel();
  patchAnalyticsPanel();
  patchHudBar();
  patchStyles();

  const simulation = read('src/game/engine/simulation.ts');
  if (!simulation.includes("type: 'metroStation'")) throw new Error('Validação falhou: estação não ocupa tile de superfície.');
  if (!simulation.includes('deleteMetroLine(lineId: string)')) throw new Error('Validação falhou: deleteMetroLine não foi aplicado.');
  if (!read('src/components/AnalyticsPanel.tsx').includes('MetroAnalyticsCard')) throw new Error('Validação falhou: métricas de metrô no Analytics não foram aplicadas.');

  console.log('Metrô V2 aplicado com sucesso.');
  console.log('Inclui estação na superfície, animação, métricas no Analytics e gerenciamento de linhas.');
  console.log('Backups criados com sufixo:', BACKUP_SUFFIX);
  console.log('Execute: npm run build && npm run dev');
}

try {
  main();
} catch (error) {
  console.error('Falha ao aplicar Metrô V2:');
  console.error(error.message);
  process.exit(1);
}
