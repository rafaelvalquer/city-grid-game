#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BACKUP_SUFFIX = '.bak-district-visual-roundabout-fix';

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, content) {
  fs.writeFileSync(file, content, 'utf8');
}

function backup(file) {
  const backupPath = file + BACKUP_SUFFIX;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(file, backupPath);
}

function ensureFile(file) {
  if (!fs.existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`);
}

function replaceExact(content, from, to, label) {
  if (!content.includes(from)) {
    console.log(`- ${label}: trecho não encontrado, talvez já esteja aplicado.`);
    return content;
  }
  console.log(`- ${label}`);
  return content.replace(from, to);
}

function replaceRegex(content, regex, to, label) {
  if (!regex.test(content)) {
    console.log(`- ${label}: trecho não encontrado, talvez já esteja aplicado.`);
    return content;
  }
  console.log(`- ${label}`);
  return content.replace(regex, to);
}

function patchRenderEffects() {
  const file = path.join('src', 'game', 'rendering', 'renderEffects.ts');
  ensureFile(file);
  backup(file);
  let content = read(file);

  content = replaceRegex(
    content,
    /export function drawAtmosphereOverlay\([\s\S]*?\n}\n\n\nexport function drawStreetFurniture/,
`export function drawAtmosphereOverlay(graphics: Graphics, world: GameWorld, atmosphere: Atmosphere, heatmapMode: HeatmapMode, ts: number): void {
  if (atmosphere.overlayAlpha <= 0) return;
  const heatmapFactor = heatmapMode === 'off' ? 1 : 0.55;
  const width = world.grid[0]?.length ?? 0;
  const height = world.grid.length;
  graphics.rect(0, 0, width * ts, height * ts)
    .fill({ color: atmosphere.overlayColor, alpha: atmosphere.overlayAlpha * heatmapFactor });
}


export function drawStreetFurniture`,
    'renderEffects: overlay de atmosfera agora cobre o grid dinâmico inteiro',
  );

  content = replaceRegex(
    content,
    /export function drawStreetFurniture\([\s\S]*?\n}\n\n\nexport function drawEmptyLotMicroDetails/,
`export function drawStreetFurniture(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number, atmosphere: Atmosphere): void {
  for (let y = 0; y < world.grid.length; y += 1) {
    const row = world.grid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x += 1) {
      const tile = row[x];
      if (!tile) continue;
      if (tile.type === 'empty') {
        drawEmptyLotMicroDetails(graphics, x, y, ts, timeSeconds, atmosphere);
        continue;
      }
      if ((tile.type === 'road' || tile.type === 'avenue') && hash2(x, y, 29) % 7 === 0) {
        drawStreetLamp(graphics, x, y, ts, atmosphere, timeSeconds, false);
      }
    }
  }
}


export function drawEmptyLotMicroDetails`,
    'renderEffects: detalhes de rua agora usam world.grid dinâmico',
  );

  // Se GAME_CONFIG deixou de ser usado neste arquivo, remove o import para manter o código limpo.
  if (!/GAME_CONFIG\./.test(content)) {
    content = content.replace("import { GAME_CONFIG } from '../config/gameConfig';\n", '');
  }

  write(file, content);
}

function patchRenderWorld() {
  const file = path.join('src', 'game', 'rendering', 'renderWorld.ts');
  ensureFile(file);
  backup(file);
  let content = read(file);

  content = replaceExact(
    content,
    `drawAtmosphereOverlay(graphics, atmosphere, heatmapMode, ts);`,
    `drawAtmosphereOverlay(graphics, world, atmosphere, heatmapMode, ts);`,
    'renderWorld: passa world para o overlay de atmosfera',
  );

  content = replaceExact(
    content,
    `  for (let y = 0; y < GAME_CONFIG.gridHeight; y++) {
    for (let x = 0; x < GAME_CONFIG.gridWidth; x++) {
      const tile = world.grid[y][x];`,
    `  for (let y = 0; y < world.grid.length; y += 1) {
    const row = world.grid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x += 1) {
      const tile = row[x];
      if (!tile) continue;`,
    'renderWorld: primeiro loop estático usa grid dinâmico',
  );

  content = replaceExact(
    content,
    `  for (let y = 0; y < GAME_CONFIG.gridHeight; y++) {
    for (let x = 0; x < GAME_CONFIG.gridWidth; x++) {
      const tile = world.grid[y][x];`,
    `  for (let y = 0; y < world.grid.length; y += 1) {
    const row = world.grid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x += 1) {
      const tile = row[x];
      if (!tile) continue;`,
    'renderWorld: segundo loop estático usa grid dinâmico',
  );

  content = replaceExact(
    content,
    `return { x: Math.floor(GAME_CONFIG.gridWidth / 2), y: Math.floor(GAME_CONFIG.gridHeight / 2) };`,
    `return { x: Math.floor((world.grid[0]?.length ?? 1) / 2), y: Math.floor(world.grid.length / 2) };`,
    'renderWorld: fallback de partículas usa centro do grid atual',
  );

  write(file, content);
}

function patchRoundabouts() {
  const file = path.join('src', 'game', 'systems', 'roundabouts.ts');
  ensureFile(file);
  backup(file);
  let content = read(file);

  content = replaceRegex(
    content,
    /export function canPlaceRoundabout\(grid: Tile\[\]\[\], center: Vec2\): \{ valid: boolean; reason\?: string \} \{[\s\S]*?\n}\n\nexport function isInsideRoundabout/,
`export function canPlaceRoundabout(grid: Tile[][], center: Vec2, allowBuildingDemolition = false): { valid: boolean; reason?: string } {
  for (const tilePos of getRoundaboutArea(center)) {
    if (!inBounds(tilePos.x, tilePos.y)) return { valid: false, reason: 'A rotatória precisa caber em uma área 3x3.' };
    const tile = grid[tilePos.y]?.[tilePos.x];
    if (!tile) return { valid: false, reason: 'A rotatória precisa caber em uma área 3x3.' };
    if (tile.type === 'building' && !allowBuildingDemolition) return { valid: false, reason: 'Não é possível construir rotatória sobre prédio.' };
    if (tile.type === 'busStop') return { valid: false, reason: 'Remova o ponto de ônibus antes de construir a rotatória.' };
    if (tile.type === 'metroStation') return { valid: false, reason: 'Remova a estação de metrô antes de construir a rotatória.' };
  }
  return { valid: true };
}

export function isInsideRoundabout`,
    'roundabouts: canPlaceRoundabout aceita demolição de prédios quando habilitada',
  );

  write(file, content);
}

function patchSimulationRoundaboutBuild() {
  const file = path.join('src', 'game', 'engine', 'simulation.ts');
  ensureFile(file);
  backup(file);
  let content = read(file);

  content = replaceRegex(
    content,
    /    if \(tool === 'roundabout'\) \{[\s\S]*?\n      return true;\n    \}\n\n    if \(tool === 'trafficLight'\)/,
`    if (tool === 'roundabout') {
      const center = { x, y };
      const area = getRoundaboutArea(center);
      const placement = canPlaceRoundabout(this.grid, center, this.allowRoadDemolition);
      if (!placement.valid) return false;

      const buildingsToDemolish = area
        .map((pos) => {
          const areaTile = this.grid[pos.y]?.[pos.x];
          return areaTile?.type === 'building' && areaTile.buildingId ? this.getBuilding(areaTile.buildingId) : undefined;
        })
        .filter((building): building is Building => Boolean(building));
      const demolitionCost = buildingsToDemolish.reduce((sum, building) => sum + getBuildingDemolitionCost(building), 0);
      const cost = ROAD_CONFIG.roundabout.buildCost + demolitionCost;
      if (this.money < cost) return false;

      for (const building of buildingsToDemolish) {
        this.removeBuildingForRoad(building.id);
      }
      for (const pos of area) {
        this.trafficLights.delete(getTrafficLightKey(pos.x, pos.y));
        this.grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'empty' };
      }
      for (const pos of getRoundaboutRing(center)) {
        this.grid[pos.y][pos.x] = { x: pos.x, y: pos.y, type: 'roundabout' };
      }
      this.grid[y][x] = { x, y, type: 'roundaboutCenter' };
      this.markStaticRenderDirty();
      this.rerouteCarsAffectedBy(area);
      this.money -= cost;
      this.updateConnections();
      this.rebuildTransitLine();
      this.inspectAt(x, y - 1);
      this.emit();
      return true;
    }

    if (tool === 'trafficLight')`,
    'simulation: rotatória demole prédios da área 3x3 quando permitido e cobra custo de demolição',
  );

  write(file, content);
}

function patchInputRoundaboutPreview() {
  const file = path.join('src', 'game', 'rendering', 'inputController.ts');
  ensureFile(file);
  backup(file);
  let content = read(file);

  content = replaceExact(
    content,
    `import { canPlaceRoundabout, findRoundaboutCenterForTile, isRoundaboutCenter, isRoundaboutTile } from '../systems/roundabouts';`,
    `import { canPlaceRoundabout, findRoundaboutCenterForTile, getRoundaboutArea, isRoundaboutCenter, isRoundaboutTile } from '../systems/roundabouts';`,
    'inputController: importa getRoundaboutArea para preview da rotatória',
  );

  content = replaceRegex(
    content,
    /  if \(tool === 'roundabout'\) \{[\s\S]*?\n  \}\n\n  if \(tool === 'trafficLight'\)/,
`  if (tool === 'roundabout') {
    const area = getRoundaboutArea({ x, y });
    const placement = canPlaceRoundabout(world.grid, { x, y }, world.canBuildRoadOverBuildings());
    const buildingsToDemolish = area
      .map((pos) => {
        const areaTile = world.grid[pos.y]?.[pos.x];
        return areaTile?.type === 'building' && areaTile.buildingId ? world.getBuilding(areaTile.buildingId) : undefined;
      })
      .filter((building): building is NonNullable<ReturnType<GameWorld['getBuilding']>> => Boolean(building));
    const demolitionCost = buildingsToDemolish.reduce((sum, building) => sum + getBuildingDemolitionCost(building), 0);
    const cost = ROAD_CONFIG.roundabout.buildCost + demolitionCost;
    if (!placement.valid) return { x, y, label: 'Rotatória indisponível', cost, valid: false, reason: placement.reason, successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: \`Faltam $ \${cost - money} para construir.\`, successMessage: '' };
    const demolitionText = buildingsToDemolish.length > 0
      ? \` \${buildingsToDemolish.length} prédio\${buildingsToDemolish.length > 1 ? 's' : ''} será\${buildingsToDemolish.length > 1 ? 'o' : ''} demolido\${buildingsToDemolish.length > 1 ? 's' : ''}.\`
      : '';
    return {
      x,
      y,
      label: buildingsToDemolish.length > 0 ? 'Demolir e construir rotatória' : 'Construir rotatória',
      cost,
      valid: true,
      demolishedBuildings: buildingsToDemolish.length,
      successMessage: \`Rotatória construída por $ \${cost}.\${demolitionText}\`,
    };
  }

  if (tool === 'trafficLight')`,
    'inputController: preview da rotatória considera demolição e custo total',
  );

  write(file, content);
}

function main() {
  console.log('Aplicando correções: expansão visual + rotatória com demolição...');
  patchRenderEffects();
  patchRenderWorld();
  patchRoundabouts();
  patchSimulationRoundaboutBuild();
  patchInputRoundaboutPreview();
  console.log('\nConcluído. Rode: npm run build');
  console.log(`Backups criados com sufixo ${BACKUP_SUFFIX}`);
}

main();
