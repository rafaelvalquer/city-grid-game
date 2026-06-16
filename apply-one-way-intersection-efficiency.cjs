const fs = require('fs');
const path = require('path');

const root = process.cwd();
const target = path.join(root, 'src', 'game', 'systems', 'roundabouts.ts');
const backupSuffix = '.bak-one-way-intersection-efficiency';

function fail(message) {
  console.error(`Falha ao aplicar melhoria de mão única: ${message}`);
  process.exit(1);
}

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Arquivo não encontrado: ${path.relative(root, filePath)}`);
  }
}

function writeBackup(filePath) {
  const backupPath = `${filePath}${backupSuffix}`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
}

function replaceDrivableNeighborsBlock(content) {
  const marker = 'export function getDrivableNeighbors';
  const nextMarker = 'export function isLegalRoadMove';
  const start = content.indexOf(marker);
  const end = content.indexOf(nextMarker, start);

  if (start < 0) fail('Função getDrivableNeighbors não encontrada em roundabouts.ts.');
  if (end < 0) fail('Função isLegalRoadMove não encontrada após getDrivableNeighbors.');

  const replacement = `export function getDrivableNeighbors(grid: Tile[][], current: Vec2): Vec2[] {
  const tile = grid[current.y]?.[current.x];
  if (!tile || isRoundaboutCenter(tile)) return [];

  const neighbors = getNeighbors4(current).filter((next) => isRoadType(grid[next.y]?.[next.x]?.type));

  if (!isRoundaboutTile(tile)) {
    const currentIsIntersection = isRoadIntersectionTile(grid, current);

    return neighbors.filter((next) => {
      const nextTile = grid[next.y]?.[next.x];
      const direction = movementDirection(current, next);

      // Em trechos normais, respeita a mão única do tile atual.
      // Em cruzamentos, libera a escolha da melhor saída para o pathfinding poder cruzar reto
      // ou sair da avenida antes do fim quando isso for mais eficiente.
      if (tile.oneWay && !currentIsIntersection && direction !== tile.oneWay) return false;

      // Evita entrar no meio de uma via de mão única pelo sentido errado.
      // A exceção é o próprio cruzamento: ele funciona como uma caixa de conversão/cruzamento,
      // permitindo atravessar ou acessar a saída mais eficiente sem prender o carro na direção da avenida.
      if (
        nextTile?.oneWay
        && !isRoadIntersectionTile(grid, next)
        && direction !== nextTile.oneWay
      ) return false;

      return !isRoundaboutTile(nextTile) || isEntrySide(grid, current, next);
    });
  }

  const allowed = new Map<string, Vec2>();
  const roundaboutNext = getRoundaboutNext(grid, current);
  if (roundaboutNext) allowed.set(keyOf(roundaboutNext.x, roundaboutNext.y), roundaboutNext);

  for (const next of neighbors) {
    if (isRoundaboutTile(grid[next.y]?.[next.x])) continue;
    if (isRoundaboutCenter(grid[next.y]?.[next.x])) continue;
    if (!isExitSide(grid, current, next)) continue;
    allowed.set(keyOf(next.x, next.y), next);
  }
  return [...allowed.values()];
}

function isRoadIntersectionTile(grid: Tile[][], pos: Vec2): boolean {
  const tile = grid[pos.y]?.[pos.x];
  if (!tile || !isRoadType(tile.type)) return false;
  if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) return false;
  return getNeighbors4(pos).filter((next) => isRoadType(grid[next.y]?.[next.x]?.type)).length >= 3;
}

`;

  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

ensureFile(target);
writeBackup(target);

let content = fs.readFileSync(target, 'utf8');
const before = content;
content = replaceDrivableNeighborsBlock(content);

if (content === before) {
  console.log('Nenhuma alteração necessária em roundabouts.ts.');
} else {
  fs.writeFileSync(target, content, 'utf8');
  console.log('Atualizado: src/game/systems/roundabouts.ts');
}

console.log('Melhoria aplicada. Rode npm run build e npm run dev para validar.');
