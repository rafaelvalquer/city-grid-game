const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const BACKUP_SUFFIX = '.bak-satisfaction-balance-v1';

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function backupFile(filePath) {
  const backupPath = filePath + BACKUP_SUFFIX;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
}

function replaceOrThrow(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Não encontrei o trecho esperado para aplicar: ${label}`);
  }
  return content.replace(pattern, replacement);
}

const simulationPath = path.join(ROOT, 'src', 'game', 'engine', 'simulation.ts');

if (!fs.existsSync(simulationPath)) {
  throw new Error(`Arquivo não encontrado: ${simulationPath}`);
}

let simulation = readFile(simulationPath);
backupFile(simulationPath);

const newUpdateEconomyAndSatisfaction = `  private updateEconomyAndSatisfaction(): void {
    const connectedShops = this.buildings.filter((b) => b.type === 'shop' && b.connected).length;
    const connectedOffices = this.buildings.filter((b) => b.type === 'office' && b.connected).length;
    const recentTrips = this.tripHistory.slice(-20).length;
    this.money += recentTrips * 1.5 + connectedShops * 4 + connectedOffices * 6;

    const snapshot = this.getSnapshot();

    // Regra V1 balanceada:
    // - Mantém prédios desconectados como problema importante, mas menos punitivo.
    // - Cria tolerância para congestionamento comum de cidade média/grande.
    // - Alivia tempo médio de viagem para não punir agressivamente rotas longas.
    // - Reduz o peso de viagens falhadas recentes.
    // - Dá pequeno bônus para transporte público/metrô e cidade totalmente conectada.
    const disconnectedPenalty = Math.min(32, snapshot.disconnectedBuildings * 3.2);

    const congestionTolerance = 25;
    const congestionOverTolerance = Math.max(0, snapshot.averageCongestion - congestionTolerance);
    const congestionPenalty = Math.min(34, congestionOverTolerance * 0.16);

    const failedPenalty = Math.min(18, this.failedTripPressure * 0.65);

    const travelComfortSeconds = 12;
    const travelOverComfort = Math.max(0, this.averageTravelTime - travelComfortSeconds);
    const travelPenalty = Math.min(18, Math.pow(travelOverComfort, 0.9) * 0.75);

    const publicTransportRelief = Math.min(8, (snapshot.publicTripsCompleted + snapshot.metroTripsCompleted) * 0.015);
    const connectivityBonus = snapshot.disconnectedBuildings === 0 ? 3 : 0;

    const targetSatisfaction = 100
      - disconnectedPenalty
      - congestionPenalty
      - failedPenalty
      - travelPenalty
      + publicTransportRelief
      + connectivityBonus;

    this.satisfaction = Math.max(0, Math.min(100, targetSatisfaction));
    this.failedTripPressure *= FAILED_TRIP_PRESSURE_DECAY;
  }
`;

simulation = replaceOrThrow(
  simulation,
  /  private updateEconomyAndSatisfaction\(\): void \{[\s\S]*?\n  \}\n\n  private recordFailedTrip\(\): void \{/,
  `${newUpdateEconomyAndSatisfaction}\n  private recordFailedTrip(): void {`,
  'updateEconomyAndSatisfaction'
);

writeFile(simulationPath, simulation);

console.log('Correção aplicada com sucesso.');
console.log(`Backup criado em: src/game/engine/simulation.ts${BACKUP_SUFFIX}`);
console.log('');
console.log('Nova lógica de satisfação:');
console.log('- congestionamento: tolerância até 25%, penalidade máxima 34');
console.log('- tempo médio: conforto até 12s, penalidade máxima 18');
console.log('- viagens falhadas: penalidade máxima 18');
console.log('- prédios desconectados: 3.2 por prédio, máximo 32');
console.log('- bônus leve por transporte público/metrô e cidade totalmente conectada');
