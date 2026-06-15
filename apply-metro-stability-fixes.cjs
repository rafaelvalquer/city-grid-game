#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupSuffix = '.bak-metro-stability-fixes';
const changes = [];
const warnings = [];

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  const target = filePath(relativePath);
  if (!fs.existsSync(target)) throw new Error(`Arquivo não encontrado: ${relativePath}`);
  return fs.readFileSync(target, 'utf8');
}

function write(relativePath, content) {
  const target = filePath(relativePath);
  if (!fs.existsSync(`${target}${backupSuffix}`)) {
    fs.copyFileSync(target, `${target}${backupSuffix}`);
  }
  fs.writeFileSync(target, content, 'utf8');
  changes.push(relativePath);
}

function replaceOrThrow(content, pattern, replacement, label) {
  if (!pattern.test(content)) throw new Error(`Ponto de alteração não encontrado: ${label}`);
  return content.replace(pattern, replacement);
}

function addMetroStationToTileType() {
  const relativePath = 'src/types/city.types.ts';
  let content = read(relativePath);
  const match = content.match(/export type TileType\s*=\s*([^;]+);/s);
  if (!match) throw new Error('Tipo TileType não encontrado em src/types/city.types.ts');
  if (match[1].includes("'metroStation'")) return;

  const nextType = `export type TileType = ${match[1].trim()} | 'metroStation';`;
  content = content.replace(match[0], nextType);
  write(relativePath, content);
}

function addMetroMetricsToHistorySample() {
  const relativePath = 'src/game/engine/simulation.ts';
  let content = read(relativePath);
  if (content.includes('metroTripsCompleted: snapshot.metroTripsCompleted')) return;

  const needle = '      carTripsAvoided: snapshot.carTripsAvoided,\n      averageCongestion: snapshot.averageCongestion,';
  const replacement = '      carTripsAvoided: snapshot.carTripsAvoided,\n      metroTripsCompleted: snapshot.metroTripsCompleted,\n      metroCarsAvoided: snapshot.metroCarsAvoided,\n      metroPassengers: snapshot.metroPassengers,\n      metroPassengersWaiting: snapshot.metroPassengersWaiting,\n      metroStations: snapshot.metroStations,\n      metroLines: snapshot.metroLines,\n      metroTrains: snapshot.metroTrains,\n      averageCongestion: snapshot.averageCongestion,';

  if (!content.includes(needle)) {
    throw new Error('Não encontrei o trecho de recordHistorySample para inserir métricas do metrô.');
  }
  content = content.replace(needle, replacement);
  write(relativePath, content);
}

function fixInputControllerPreviews() {
  const relativePath = 'src/game/rendering/inputController.ts';
  let content = read(relativePath);
  let changed = false;

  if (!content.includes("A linha passa por uma estação de metrô.")) {
    const needle = `    if (tile.type === 'busStop') {\n      invalidTiles.push(pos);\n      reason ??= 'A linha passa por um ponto de ônibus.';\n      continue;\n    }`;
    const replacement = `${needle}\n    if (tile.type === 'metroStation') {\n      invalidTiles.push(pos);\n      reason ??= 'A linha passa por uma estação de metrô.';\n      continue;\n    }`;
    if (!content.includes(needle)) {
      throw new Error('Não encontrei o trecho de getLineBuildPreview para bloquear estação de metrô.');
    }
    content = content.replace(needle, replacement);
    changed = true;
  }

  if (!content.includes('Remover estação de metrô')) {
    const needle = `  if (tool === 'remove') {\n    const roundaboutCenter = findRoundaboutCenterForTile(world.grid, { x, y });`;
    const replacement = `${needle}\n    const metroStation = world.getMetroStationAt(x, y);\n    if (metroStation) {\n      return {\n        x,\n        y,\n        label: 'Remover estação de metrô',\n        valid: true,\n        successMessage: 'Estação de metrô removida. Trilhos, linhas e trens dependentes também foram removidos.',\n      };\n    }`;
    if (!content.includes(needle)) {
      throw new Error('Não encontrei o bloco de preview da ferramenta remover.');
    }
    content = content.replace(needle, replacement);
    changed = true;
  }

  if (changed) write(relativePath, content);
}

function fixUndergroundRendering() {
  const relativePath = 'src/game/rendering/renderWorld.ts';
  let content = read(relativePath);
  if (content.includes("if (viewLayer === 'underground') {\n    renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);")) return;

  const needle = `function renderDynamicLayer(\n  graphics: Graphics,\n  state: RenderWorldState,\n  world: GameWorld,\n  heatmapMode: HeatmapMode,\n  hoverPreview: HoverPreview | null,\n  ts: number,\n  timeSeconds: number,\n  atmosphere: ReturnType<typeof getAtmosphere>,\n  viewLayer: ViewLayer,\n): void {\n  graphics.clear();`;

  const replacement = `${needle}\n\n  if (viewLayer === 'underground') {\n    renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);\n    if (hoverPreview) drawConstructionPreview(graphics, world, hoverPreview, ts, timeSeconds);\n    if (world.selected.kind === 'tile') drawSelection(graphics, world.selected.x, world.selected.y, ts);\n    if (world.selected.kind === 'metroStation') drawSelection(graphics, world.selected.station.x, world.selected.station.y, ts);\n    pruneSmokeHistory(state, timeSeconds);\n    return;\n  }`;

  if (!content.includes(needle)) {
    throw new Error('Não encontrei o início de renderDynamicLayer para ajustar o modo Subsolo.');
  }

  content = content.replace(needle, replacement);
  write(relativePath, content);
}

function listSourceFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      result.push(...listSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx|js|jsx|cjs|mjs)$/.test(entry.name)) result.push(fullPath);
  }
  return result;
}

function removeIfUnreferenced(relativePath, tokens) {
  const target = filePath(relativePath);
  if (!fs.existsSync(target)) return;

  const sourceFiles = listSourceFiles(path.join(root, 'src')).filter((candidate) => candidate !== target);
  const referencedBy = [];
  for (const sourceFile of sourceFiles) {
    const content = fs.readFileSync(sourceFile, 'utf8');
    if (tokens.some((token) => content.includes(token))) {
      referencedBy.push(path.relative(root, sourceFile));
    }
  }

  if (referencedBy.length) {
    warnings.push(`Não removido ${relativePath}: ainda há referência em ${referencedBy.join(', ')}`);
    return;
  }

  const backupTarget = `${target}${backupSuffix}`;
  if (!fs.existsSync(backupTarget)) fs.copyFileSync(target, backupTarget);
  fs.unlinkSync(target);
  changes.push(`${relativePath} (removido)`);
}

function removeUnusedMetroFiles() {
  removeIfUnreferenced('src/game/metro/metroTripResolver.ts', ['metroTripResolver']);
  removeIfUnreferenced('src/components/MetroLineEditor.tsx', ['MetroLineEditor']);
  removeIfUnreferenced('src/game/metro/metroRouting.ts', ['metroRouting']);
}

try {
  addMetroStationToTileType();
  addMetroMetricsToHistorySample();
  fixInputControllerPreviews();
  fixUndergroundRendering();
  removeUnusedMetroFiles();

  console.log('Correções do metrô aplicadas com sucesso.');
  if (changes.length) {
    console.log('\nArquivos alterados/removidos:');
    for (const item of changes) console.log(`- ${item}`);
  } else {
    console.log('\nNenhuma alteração necessária.');
  }
  if (warnings.length) {
    console.log('\nAvisos:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  console.log(`\nBackups criados com sufixo: ${backupSuffix}`);
} catch (error) {
  console.error('Falha ao aplicar correções do metrô:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
