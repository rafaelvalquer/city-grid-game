#!/usr/bin/env node
/*
 * Correção incremental do drag do metrô.
 *
 * Problema corrigido:
 * - Ao arrastar um trilho/linha e soltar em cima da estação, o draft podia não incluir
 *   a estação final porque a lógica dependia do pointermove passar exatamente pelo tile.
 *
 * Ajuste:
 * - O pointerup agora lê o tile final sob o cursor e adiciona a estação final ao draft
 *   antes de confirmar a criação do trilho ou da linha.
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const BACKUP_SUFFIX = '.bak-metro-drag-release-fix';

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  const target = filePath(relativePath);
  if (!fs.existsSync(target)) throw new Error(`Arquivo não encontrado: ${relativePath}`);
  return fs.readFileSync(target, 'utf8');
}

function backup(relativePath) {
  const target = filePath(relativePath);
  const backupPath = `${target}${BACKUP_SUFFIX}`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(target, backupPath);
}

function write(relativePath, content) {
  backup(relativePath);
  fs.writeFileSync(filePath(relativePath), content, 'utf8');
  console.log(`Atualizado: ${relativePath}`);
}

function replaceOrThrow(content, search, replacement, label) {
  if (typeof search === 'string') {
    if (!content.includes(search)) throw new Error(`Trecho não encontrado: ${label}`);
    return content.replace(search, replacement);
  }
  if (!search.test(content)) throw new Error(`Trecho não encontrado: ${label}`);
  return content.replace(search, replacement);
}

function updateInputController() {
  const relative = 'src/game/rendering/inputController.ts';
  let content = read(relative);

  if (!content.includes('commitMetroTrackDraft(world, pendingMetroTrackStationIds)')) {
    throw new Error('A correção visual de trilhos/linhas ainda não parece estar aplicada. Aplique primeiro city-grid-game-metro-track-line-fixes.zip.');
  }

  if (!content.includes('function addMetroStationUnderPointerOnRelease(')) {
    const pointerUpOld = `  window.addEventListener('pointerup', () => {`;
    const pointerUpNew = `  window.addEventListener('pointerup', (event) => {`;
    if (content.includes(pointerUpOld)) {
      content = content.replace(pointerUpOld, pointerUpNew);
    } else if (!content.includes(`window.addEventListener('pointerup', (event) => {`)) {
      throw new Error('Não foi possível localizar o listener pointerup em inputController.ts.');
    }

    const commitMarker = `    if (metroDragMode === 'track') {\n      const state = useGameStore.getState();\n      const result = commitMetroTrackDraft(world, pendingMetroTrackStationIds);`;
    const finalStationBlock = `    if (metroDragMode) {\n      addMetroStationUnderPointerOnRelease(\n        world,\n        camera.toWorldTile(event.clientX, event.clientY),\n        metroDragMode,\n        pendingMetroTrackStationIds,\n        pendingMetroLineStationIds,\n      );\n    }\n`;
    content = replaceOrThrow(content, commitMarker, `${finalStationBlock}${commitMarker}`, 'inserir captura da estação final no pointerup');

    const helperMarker = `function commitMetroTrackDraft(world: GameWorld, stationIds: string[]): { message: string } {`;
    const helper = `function addMetroStationUnderPointerOnRelease(\n  world: GameWorld,\n  tile: Vec2,\n  mode: 'track' | 'line',\n  trackStationIds: string[],\n  lineStationIds: string[],\n): void {\n  const station = world.getMetroStationAt(tile.x, tile.y);\n  if (!station) return;\n\n  if (mode === 'track') {\n    addMetroDraftStation(world, trackStationIds, station.id, false);\n    return;\n  }\n\n  addMetroDraftStation(world, lineStationIds, station.id, true);\n}\n\n`;
    content = replaceOrThrow(content, helperMarker, `${helper}${helperMarker}`, 'inserir helper addMetroStationUnderPointerOnRelease');
  }

  write(relative, content);
}

function main() {
  updateInputController();
  console.log('\nCorreção do release do drag do metrô aplicada com sucesso.');
}

try {
  main();
} catch (error) {
  console.error('Falha ao aplicar correção do drag do metrô:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
