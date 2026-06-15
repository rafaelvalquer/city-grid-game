import type { MutableRefObject } from 'react';
import { ROAD_CONFIG } from '../config/roadConfig';
import { TRANSIT_CONFIG } from '../config/transitConfig';
import { getBuildingDemolitionCost, type GameWorld } from '../engine/simulation';
import { inBounds, isRoadType, keyOf } from '../city/grid';
import { isIntersection } from '../systems/trafficRules';
import { TRAFFIC_LIGHT_BUILD_COST } from '../systems/trafficLights';
import { canPlaceRoundabout, findRoundaboutCenterForTile, isRoundaboutCenter, isRoundaboutTile } from '../systems/roundabouts';
import { useGameStore } from '../../store/gameStore';
import type { RoadDirection, RoadType, Tile, Vec2 } from '../../types/city.types';
import type { Tool } from '../../types/game.types';
import type { ActionPreview } from './renderTypes';
import type { CameraController } from './cameraController';
import type { ParticleSystem } from './particleSystem';

export type RoadLineDrag = {
  startTile: Vec2;
  currentTile: Vec2;
  tool: 'road' | 'avenue';
};

export type OneWayLineDrag = {
  startTile: Vec2;
  currentTile: Vec2;
};

export type InputControllerRefs = {
  isDrawingRef: MutableRefObject<boolean>;
  lastTileRef: MutableRefObject<string>;
  roadLineDragRef: MutableRefObject<RoadLineDrag | null>;
  oneWayLineDragRef: MutableRefObject<OneWayLineDrag | null>;
};

export function connectInputController(params: {
  canvas: HTMLCanvasElement;
  signal: AbortSignal;
  world: GameWorld;
  camera: CameraController;
  refs: InputControllerRefs;
  particles?: ParticleSystem;
}): void {
  const { canvas, signal, world, camera, refs, particles } = params;

  const detectCar = (tileX: number, tileY: number) => {
    return world.cars.find((c) => Math.abs(c.x - tileX) < 0.45 && Math.abs(c.y - tileY) < 0.45);
  };

  const applyTool = (tileX: number, tileY: number) => {
    const state = useGameStore.getState();
    const tileKey = keyOf(tileX, tileY);
    if (tileKey === refs.lastTileRef.current) return;
    refs.lastTileRef.current = tileKey;

    if (state.selectedTool === 'inspect') {
      const car = detectCar(tileX, tileY);
      if (car) world.inspectCar(car.id);
      else world.inspectAt(tileX, tileY);
      state.setActionFeedback(null);
      return;
    }
    const preview = { ...getActionPreview(world, tileX, tileY, state.selectedTool, state.stats.money), tool: state.selectedTool };
    const didBuild = world.buildAt(tileX, tileY, state.selectedTool);
    if (didBuild) emitActionParticles(particles, { x: tileX, y: tileY }, state.selectedTool, preview.cost);
    state.setActionFeedback(didBuild ? preview.successMessage : preview.reason ?? 'Ação indisponível neste tile.');
  };

  const updateHover = (clientX: number, clientY: number) => {
    const state = useGameStore.getState();
    const tile = camera.toWorldTile(clientX, clientY);
    const drag = refs.roadLineDragRef.current;
    if (drag) {
      drag.currentTile = tile;
      state.setHoverPreview(getLineBuildPreview(world, getLineTiles(drag.startTile, tile), drag.tool, state.stats.money));
      return;
    }
    const oneWayDrag = refs.oneWayLineDragRef.current;
    if (oneWayDrag) {
      oneWayDrag.currentTile = tile;
      const lineTiles = getLineTiles(oneWayDrag.startTile, tile);
      const direction = getLineDirection(oneWayDrag.startTile, tile);
      state.setHoverPreview(getOneWayPreview(world, lineTiles, direction));
      return;
    }
    state.setHoverPreview({ ...getActionPreview(world, tile.x, tile.y, state.selectedTool, state.stats.money), tool: state.selectedTool });
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (camera.handlePointerDown(event)) return;
    refs.isDrawingRef.current = true;
    refs.lastTileRef.current = '';
    const tile = camera.toWorldTile(event.clientX, event.clientY);
    const state = useGameStore.getState();
    if (isRoadLineTool(state.selectedTool)) {
      refs.roadLineDragRef.current = { startTile: tile, currentTile: tile, tool: state.selectedTool };
      state.setHoverPreview(getLineBuildPreview(world, [tile], state.selectedTool, state.stats.money));
      state.setActionFeedback(null);
      return;
    }
    if (state.selectedTool === 'oneWay') {
      refs.oneWayLineDragRef.current = { startTile: tile, currentTile: tile };
      state.setHoverPreview(getOneWayPreview(world, [tile], 'east'));
      state.setActionFeedback(null);
      return;
    }
    updateHover(event.clientX, event.clientY);
    applyTool(tile.x, tile.y);
  }, { signal });

  window.addEventListener('pointerup', () => {
    const drag = refs.roadLineDragRef.current;
    const oneWayDrag = refs.oneWayLineDragRef.current;
    if (drag) {
      const state = useGameStore.getState();
      const lineTiles = getLineTiles(drag.startTile, drag.currentTile);
      const preview = getLineBuildPreview(world, lineTiles, drag.tool, state.stats.money);
      const result = world.buildRoadLine(lineTiles, drag.tool);
      if (result.success) emitRoadLineParticles(particles, lineTiles, drag.tool, result.cost);
      if (result.success && (result.demolished ?? 0) > 0) {
        state.setActionFeedback(roadLineSuccessMessage(drag.tool, result.built, result.cost, result.demolished ?? 0));
      } else state.setActionFeedback(result.success
        ? `${ROAD_CONFIG[drag.tool].label} construída: ${result.built} tiles por $ ${result.cost}.`
        : result.reason ?? preview.reason ?? 'Não foi possível construir a linha.');
      state.setHoverPreview(null);
    }
    if (oneWayDrag) {
      const state = useGameStore.getState();
      const sameTile = oneWayDrag.startTile.x === oneWayDrag.currentTile.x && oneWayDrag.startTile.y === oneWayDrag.currentTile.y;
      if (sameTile) {
        const result = world.toggleOneWayAt(oneWayDrag.startTile.x, oneWayDrag.startTile.y);
        state.setActionFeedback(result.success
          ? result.cleared ? 'Mão única removida.' : `Mão única aplicada para ${directionLabel(result.direction ?? 'east')}.`
          : result.reason ?? 'Não foi possível alterar a mão única.');
      } else {
        const lineTiles = getLineTiles(oneWayDrag.startTile, oneWayDrag.currentTile);
        const direction = getLineDirection(oneWayDrag.startTile, oneWayDrag.currentTile);
        const preview = getOneWayPreview(world, lineTiles, direction);
        const result = world.setOneWayLine(lineTiles, direction);
        state.setActionFeedback(result.success
          ? `Mão única aplicada: ${lineTiles.length} tiles para ${directionLabel(direction)}.`
          : result.reason ?? preview.reason ?? 'Não foi possível aplicar mão única.');
      }
      state.setHoverPreview(null);
    }
    refs.roadLineDragRef.current = null;
    refs.oneWayLineDragRef.current = null;
    refs.isDrawingRef.current = false;
    camera.stopPanning();
    refs.lastTileRef.current = '';
  }, { signal });

  canvas.addEventListener('pointermove', (event) => {
    if (camera.handlePointerMove(event)) return;
    updateHover(event.clientX, event.clientY);
    if (!refs.isDrawingRef.current) return;
    if (refs.roadLineDragRef.current) return;
    if (refs.oneWayLineDragRef.current) return;
    const tile = camera.toWorldTile(event.clientX, event.clientY);
    applyTool(tile.x, tile.y);
  }, { signal });

  canvas.addEventListener('pointerleave', () => {
    if (refs.roadLineDragRef.current) return;
    if (refs.oneWayLineDragRef.current) return;
    useGameStore.getState().setHoverPreview(null);
  }, { signal });

  canvas.addEventListener('wheel', (event) => {
    camera.handleWheel(event);
  }, { passive: false, signal });
}

function emitActionParticles(particles: ParticleSystem | undefined, pos: Vec2, tool: Tool, cost?: number): void {
  if (!particles) return;
  if (tool === 'road' || tool === 'avenue') particles.emitRoadDust(pos, tool === 'avenue' ? 12 : 8);
  if (tool === 'trafficLight') particles.emitTrafficLightSpark(pos);
  if (cost && cost > 0) particles.emitMoneyText(pos, -cost);
}

function emitRoadLineParticles(particles: ParticleSystem | undefined, lineTiles: Vec2[], tool: 'road' | 'avenue', cost: number): void {
  if (!particles) return;
  const step = Math.max(1, Math.ceil(lineTiles.length / 18));
  for (let i = 0; i < lineTiles.length; i += step) {
    particles.emitRoadDust(lineTiles[i], tool === 'avenue' ? 10 : 7);
  }
  const anchor = lineTiles[lineTiles.length - 1];
  if (anchor && cost > 0) particles.emitMoneyText(anchor, -cost);
}

function roadLineSuccessMessage(tool: 'road' | 'avenue', built: number, cost: number, demolished: number): string {
  const label = ROAD_CONFIG[tool].label;
  const demolitionText = demolished > 0
    ? ` ${demolished} prédio${demolished > 1 ? 's' : ''} demolido${demolished > 1 ? 's' : ''}.`
    : '';
  return `${label} construída: ${built} tiles por $ ${cost}.${demolitionText}`;
}

export function isRoadLineTool(tool: Tool): tool is 'road' | 'avenue' {
  return tool === 'road' || tool === 'avenue';
}


export function getLineTiles(start: Vec2, end: Vec2): Vec2[] {
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const tiles: Vec2[] = [];
  if (horizontal) {
    const step = end.x >= start.x ? 1 : -1;
    for (let x = start.x; step > 0 ? x <= end.x : x >= end.x; x += step) tiles.push({ x, y: start.y });
    return tiles;
  }

  const step = end.y >= start.y ? 1 : -1;
  for (let y = start.y; step > 0 ? y <= end.y : y >= end.y; y += step) tiles.push({ x: start.x, y });
  return tiles;
}


export function getLineBuildPreview(world: GameWorld, tiles: Vec2[], tool: 'road' | 'avenue', money: number): ActionPreview {
  const uniqueTiles = dedupePreviewTiles(tiles);
  const invalidTiles: Vec2[] = [];
  let buildableTiles = 0;
  let demolishedBuildings = 0;
  let demolitionCost = 0;
  let reason: string | undefined;

  for (const pos of uniqueTiles) {
    if (!inBounds(pos.x, pos.y)) {
      invalidTiles.push(pos);
      reason ??= 'A linha sai do mapa.';
      continue;
    }

    const tile = world.grid[pos.y][pos.x];
    if (tile.type === 'building' && world.canBuildRoadOverBuildings()) {
      const building = tile.buildingId ? world.getBuilding(tile.buildingId) : undefined;
      if (building) {
        buildableTiles += 1;
        demolishedBuildings += 1;
        demolitionCost += getBuildingDemolitionCost(building);
        continue;
      }
    }
    if (tile.type === 'busStop') {
      invalidTiles.push(pos);
      reason ??= 'A linha passa por um ponto de ônibus.';
      continue;
    }
    if (tile.type === 'building') {
      invalidTiles.push(pos);
      reason ??= 'A linha passa por um prédio.';
      continue;
    }
    if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) {
      invalidTiles.push(pos);
      reason ??= 'A linha passa por uma rotatória.';
      continue;
    }
    if (tile.type !== tool) buildableTiles += 1;
  }

  const cost = buildableTiles * ROAD_CONFIG[tool].buildCost + demolitionCost;
  if (!reason && buildableTiles === 0) reason = 'Essa via já existe em toda a linha.';
  if (!reason && money < cost) reason = `Faltam $ ${cost - money} para construir.`;

  const label = `${tool === 'road' ? 'Construir rua' : 'Construir avenida'}: ${uniqueTiles.length} tiles${demolishedBuildings > 0 ? `, ${demolishedBuildings} demolições` : ''}`;
  return {
    x: uniqueTiles[uniqueTiles.length - 1]?.x ?? 0,
    y: uniqueTiles[uniqueTiles.length - 1]?.y ?? 0,
    label,
    cost,
    valid: !reason,
    reason,
    tool,
    lineTiles: uniqueTiles,
    invalidTiles,
    buildableTiles,
    demolishedBuildings,
    successMessage: `${tool === 'road' ? 'Rua' : 'Avenida'} construída: ${buildableTiles} tiles por $ ${cost}.`,
  };
}


export function dedupePreviewTiles(tiles: Vec2[]): Vec2[] {
  const seen = new Set<string>();
  const result: Vec2[] = [];
  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tile);
  }
  return result;
}


export function getOneWayPreview(world: GameWorld, tiles: Vec2[], direction: RoadDirection): ActionPreview {
  const uniqueTiles = dedupePreviewTiles(tiles);
  const invalidTiles: Vec2[] = [];
  let reason: string | undefined;

  for (const pos of uniqueTiles) {
    if (!inBounds(pos.x, pos.y)) {
      invalidTiles.push(pos);
      reason ??= 'A linha sai do mapa.';
      continue;
    }
    const tile = world.grid[pos.y][pos.x];
    if (tile.type !== 'road' && tile.type !== 'avenue') {
      invalidTiles.push(pos);
      reason ??= 'Mão única só pode ser aplicada em ruas e avenidas.';
    }
  }

  const label = `Mão única: ${uniqueTiles.length} tiles para ${directionLabel(direction)}`;
  return {
    x: uniqueTiles[uniqueTiles.length - 1]?.x ?? 0,
    y: uniqueTiles[uniqueTiles.length - 1]?.y ?? 0,
    label,
    valid: !reason,
    reason,
    tool: 'oneWay',
    lineTiles: uniqueTiles,
    invalidTiles,
    buildableTiles: uniqueTiles.length - invalidTiles.length,
    oneWayDirection: direction,
    successMessage: `Mão única aplicada: ${uniqueTiles.length} tiles para ${directionLabel(direction)}.`,
  };
}


export function getLineDirection(start: Vec2, end: Vec2): RoadDirection {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'west' : 'east';
  return dy < 0 ? 'north' : 'south';
}


export function directionLabel(direction: RoadDirection): string {
  if (direction === 'north') return 'norte';
  if (direction === 'south') return 'sul';
  if (direction === 'west') return 'oeste';
  return 'leste';
}


export function getActionPreview(world: GameWorld, x: number, y: number, tool: Tool, money: number): ActionPreview {
  if (!inBounds(x, y)) {
    return { x, y, label: 'Fora do mapa', valid: false, reason: 'Fora do mapa.', successMessage: '' };
  }

  const tile = world.grid[y][x];
  if (tool === 'inspect') {
    return { x, y, label: 'Inspecionar', valid: true, successMessage: 'Detalhes atualizados.' };
  }

  if (tool === 'road' || tool === 'avenue') {
    const cost = ROAD_CONFIG[tool].buildCost;
    if (tile.type === 'building' && world.canBuildRoadOverBuildings()) {
      const building = tile.buildingId ? world.getBuilding(tile.buildingId) : undefined;
      if (building) {
        const demolitionCost = getBuildingDemolitionCost(building);
        const totalCost = cost + demolitionCost;
        if (money < totalCost) return { x, y, label: 'Dinheiro insuficiente', cost: totalCost, valid: false, reason: `Faltam $ ${totalCost - money} para demolir e construir.`, successMessage: '' };
        return {
          x,
          y,
          label: tool === 'road' ? 'Demolir e construir rua' : 'Demolir e construir avenida',
          cost: totalCost,
          valid: true,
          demolishedBuildings: 1,
          successMessage: `${tool === 'road' ? 'Rua' : 'Avenida'} construída por $ ${totalCost}. 1 prédio demolido.`,
        };
      }
    }
    if (tile.type === 'busStop') return { x, y, label: 'Ponto ocupa o tile', cost, valid: false, reason: 'Remova o ponto de ônibus antes de construir uma via.', successMessage: '' };
    if (tile.type === 'building') return { x, y, label: 'Prédio ocupa o tile', cost, valid: false, reason: 'Não é possível construir sobre prédio.', successMessage: '' };
    if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) return { x, y, label: 'Rotatória ocupa o tile', cost, valid: false, reason: 'Remova a rotatória antes de construir outra via.', successMessage: '' };
    if (tile.type === tool) return { x, y, label: 'Via já construída', cost, valid: false, reason: 'Essa via já existe aqui.', successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para construir.`, successMessage: '' };
    return { x, y, label: tool === 'road' ? 'Construir rua' : 'Construir avenida', cost, valid: true, successMessage: `${tool === 'road' ? 'Rua' : 'Avenida'} construída por $ ${cost}.` };
  }

  if (tool === 'roundabout') {
    const cost = ROAD_CONFIG.roundabout.buildCost;
    const placement = canPlaceRoundabout(world.grid, { x, y });
    if (!placement.valid) return { x, y, label: 'Rotatória indisponível', cost, valid: false, reason: placement.reason, successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para construir.`, successMessage: '' };
    return { x, y, label: 'Construir rotatória', cost, valid: true, successMessage: `Rotatória construída por $ ${cost}.` };
  }

  if (tool === 'trafficLight') {
    const cost = TRAFFIC_LIGHT_BUILD_COST;
    const key = keyOf(x, y);
    if (!isRoadType(tile.type)) return { x, y, label: 'Semáforo indisponível', cost, valid: false, reason: 'Semáforos só podem ser adicionados em ruas e avenidas.', successMessage: '' };
    if (isRoundaboutTile(tile)) return { x, y, label: 'Semáforo indisponível', cost, valid: false, reason: 'Rotatórias já controlam a prioridade de entrada.', successMessage: '' };
    if (!isIntersection(world.grid, { x, y })) return { x, y, label: 'Não é cruzamento', cost, valid: false, reason: 'Coloque o semáforo apenas em cruzamentos ou cruzamentos em T.', successMessage: '' };
    if (world.trafficLights.has(key)) return { x, y, label: 'Semáforo já instalado', cost, valid: false, reason: 'Este cruzamento já possui semáforo.', successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para instalar o semáforo.`, successMessage: '' };
    return { x, y, label: 'Instalar semáforo', cost, valid: true, successMessage: `Semáforo instalado por $ ${cost}.` };
  }

  if (tool === 'busStop') {
    const cost = TRANSIT_CONFIG.busStopCost;
    const access = busStopPreviewAccess(world.grid, x, y);
    if (tile.type !== 'empty') return { x, y, label: 'Ponto indisponível', cost, valid: false, reason: 'Use um lote vazio ao lado de uma rua ou avenida.', successMessage: '' };
    if (!access) return { x, y, label: 'Sem via de acesso', cost, valid: false, reason: 'O ponto precisa ficar em um lote vazio adjacente a rua ou avenida.', successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para construir o ponto.`, successMessage: '' };
    return { x, y, label: 'Construir ponto de ônibus', cost, valid: true, successMessage: `Ponto de ônibus construído por $ ${cost}.` };
  }

  if (tool === 'oneWay') {
    if (tile.type !== 'road' && tile.type !== 'avenue') {
      return { x, y, label: 'Mão única indisponível', valid: false, reason: 'Use apenas em ruas e avenidas.', successMessage: '' };
    }
    return {
      x,
      y,
      label: tile.oneWay ? 'Alternar mão única' : 'Aplicar mão única',
      valid: true,
      successMessage: tile.oneWay ? 'Mão única alterada.' : 'Mão única aplicada.',
    };
  }

  if (tool === 'remove') {
    const roundaboutCenter = findRoundaboutCenterForTile(world.grid, { x, y });
    if (tile.type === 'busStop') {
      const cost = Math.ceil(TRANSIT_CONFIG.busStopCost * TRANSIT_CONFIG.busStopRemoveCostRatio);
      if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para remover.`, successMessage: '' };
      return { x, y, label: 'Remover ponto de ônibus', cost, valid: true, successMessage: `Ponto de ônibus removido por $ ${cost}.` };
    }
    if (!isRoadType(tile.type) && !roundaboutCenter) return { x, y, label: 'Nada para remover', valid: false, reason: 'Só é possível remover ruas e avenidas.', successMessage: '' };
    const roadType = roundaboutCenter ? 'roundabout' : tile.type as RoadType;
    const cost = ROAD_CONFIG[roadType].removeCost;
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para remover.`, successMessage: '' };
    const hasSignal = world.trafficLights.has(keyOf(x, y));
    return { x, y, label: `Remover ${ROAD_CONFIG[roadType].label.toLowerCase()}`, cost, valid: true, successMessage: `${ROAD_CONFIG[roadType].label} removida por $ ${cost}.${hasSignal ? ' Semáforo removido junto.' : ''}` };
  }

  return { x, y, label: 'Ação indisponível', valid: false, reason: 'Ação indisponível.', successMessage: '' };
}


export function busStopPreviewAccess(grid: Tile[][], x: number, y: number): Vec2 | undefined {
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ].filter((pos) => inBounds(pos.x, pos.y));
  return neighbors
    .filter((pos) => {
      const tile = grid[pos.y]?.[pos.x];
      return tile?.type === 'road' || tile?.type === 'avenue';
    })
    .sort((a, b) => {
      const aScore = grid[a.y][a.x].type === 'avenue' ? 0 : 1;
      const bScore = grid[b.y][b.x].type === 'avenue' ? 0 : 1;
      return aScore - bScore;
    })[0];
}

