const fs = require('fs');
const path = require('path');

const root = process.cwd();
const simulationPath = path.join(root, 'src/game/engine/simulation.ts');

function fail(message) {
  console.error(`Falha ao reparar Metrô V2: ${message}`);
  process.exit(1);
}

function backup(filePath) {
  const backupPath = `${filePath}.bak-metro-v2-syntax-fix`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath);
}

function findMethodStart(content, methodName) {
  const regex = new RegExp(`\\n  (?:(?:private|public|protected)\\s+)?${methodName}\\s*\\(`, 'm');
  const match = content.match(regex);
  return match ? match.index + 1 : -1;
}

function findNextMethodStart(content, fromIndex, markers) {
  const indexes = markers
    .map((marker) => content.indexOf(marker, fromIndex + 1))
    .filter((index) => index >= 0);
  if (!indexes.length) return -1;
  return Math.min(...indexes);
}

function replaceCreateMetroLine(content) {
  const start = findMethodStart(content, 'createMetroLine');
  if (start < 0) fail('Método createMetroLine não encontrado em src/game/engine/simulation.ts.');

  const next = findNextMethodStart(content, start, [
    '\n  private spawnMetroTrain',
    '\n  public spawnMetroTrain',
    '\n  protected spawnMetroTrain',
    '\n  spawnMetroTrain',
    '\n  private updateMetro',
    '\n  public updateMetro',
    '\n  protected updateMetro',
    '\n  updateMetro',
  ]);

  if (next < 0) fail('Não encontrei o próximo método depois de createMetroLine.');

  const replacement = `  createMetroLine(stationIds: string[]): { success: boolean; name?: string; cost?: number; reason?: string } {
    const uniqueStationIds = dedupeIds(stationIds);
    if (uniqueStationIds.length < METRO_CONFIG.minStationsForLine) {
      return { success: false, reason: 'A linha precisa ter ao menos duas estações.' };
    }

    for (let i = 0; i < uniqueStationIds.length - 1; i += 1) {
      if (!this.hasMetroTrackBetween(uniqueStationIds[i], uniqueStationIds[i + 1])) {
        return { success: false, reason: 'Todas as estações consecutivas precisam estar conectadas por trilhos.' };
      }
    }

    if (this.money < METRO_CONFIG.lineActivationCost) {
      return {
        success: false,
        cost: METRO_CONFIG.lineActivationCost,
        reason: \`Faltam $ \${METRO_CONFIG.lineActivationCost - this.money} para ativar a linha.\`,
      };
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
      if (!station) continue;
      station.activeLineIds ??= [];
      if (!station.activeLineIds.includes(line.id)) station.activeLineIds.push(line.id);
    }

    this.spawnMetroTrain(line.id);
    line.trainsActive = this.metroTrains.filter((train) => train.lineId === line.id).length;
    line.currentPassengers = this.metroTrains
      .filter((train) => train.lineId === line.id)
      .reduce((sum, train) => sum + train.passengers, 0);
    line.waitingPassengers = uniqueStationIds
      .map((stationId) => this.getMetroStation(stationId))
      .filter((station): station is MetroStation => Boolean(station))
      .reduce((sum, station) => sum + station.waitingPassengers, 0);

    this.money -= METRO_CONFIG.lineActivationCost;
    this.selected = { kind: 'metroLine', line };
    this.markStaticRenderDirty();
    this.emit();

    return { success: true, name: line.name, cost: METRO_CONFIG.lineActivationCost };
  }
`;

  return content.slice(0, start) + replacement + content.slice(next);
}

function patchBrokenObjectReturnMarkers(content) {
  // Remove a very specific broken pattern caused by the previous replacement:
  //   } {
  //     const uniqueStationIds = ...
  // This function is intentionally conservative. The full method is replaced afterwards.
  return content.replace(/\n  \} \{\n\s+const uniqueStationIds = dedupeIds\(stationIds\);/g, '\n  }\n\n  createMetroLine__BROKEN_DUPLICATE_MARKER() {\n    const uniqueStationIds = dedupeIds(stationIds);');
}

if (!fs.existsSync(simulationPath)) {
  fail('Execute este script na raiz do projeto city-grid-game.');
}

backup(simulationPath);

let content = fs.readFileSync(simulationPath, 'utf8');
content = patchBrokenObjectReturnMarkers(content);
content = replaceCreateMetroLine(content);

// Remove any temporary marker left by a previous malformed patch if it survived.
content = content.replace(/\n  createMetroLine__BROKEN_DUPLICATE_MARKER\(\) \{[\s\S]*?(?=\n  (?:private |public |protected )?(?:spawnMetroTrain|updateMetro)\b)/, '\n');

fs.writeFileSync(simulationPath, content, 'utf8');

console.log('Reparo aplicado em src/game/engine/simulation.ts');
console.log('Backup criado em src/game/engine/simulation.ts.bak-metro-v2-syntax-fix');
console.log('Agora rode: npm run build');
