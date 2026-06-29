import type { MutableRefObject } from 'react';
import { ROAD_CONFIG } from '../config/roadConfig';
import { TRANSIT_CONFIG, BUS_LANE_CONFIG } from '../config/transitConfig';
import { METRO_CONFIG } from '../config/metroConfig';
import { BIKE_LANE_CONFIG } from '../config/bikeConfig';
import { HELICOPTER_CONFIG } from '../config/helicopterConfig';
import { buildMetroTrackTiles } from '../metro/metroLineBuilder';
import { getBuildingDemolitionCost, type GameWorld } from '../engine/simulation';
import { inBounds, isRoadType, isTerrainBlocked, keyOf } from '../city/grid';
import { areRoadTilesConnected, roadDirectionOffset } from '../city/roadConnections';
import { isIntersection } from '../systems/trafficRules';
import { TRAFFIC_LIGHT_BUILD_COST } from '../systems/trafficLights';
import { canPlaceRoundabout, findRoundaboutCenterForTile, getRoundaboutArea, isRoundaboutCenter, isRoundaboutTile } from '../systems/roundabouts';
import { useGameStore } from '../../store/gameStore';
import type { RoadDirection, RoadType, Tile, Vec2 } from '../../types/city.types';
import type { Tool } from '../../types/game.types';
import type { ActionPreview } from './renderTypes';
import type { CameraController } from './cameraController';
import type { ParticleSystem } from './particleSystem';
import { getHelicopterPose } from './renderHelicopters';

export type RoadLineDrag = {
  startTile: Vec2;
  currentTile: Vec2;
  tool: 'road' | 'avenue' | 'busLane' | 'bikeLane' | 'roadTunnel' | 'avenueTunnel';
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
  const detectHelicopter = (tileX: number, tileY: number) => world.helicopters.find((helicopter) => {
    const pose = getHelicopterPose(world, helicopter);
    return Boolean(pose && Math.abs(pose.x - tileX) < 0.65 && Math.abs(pose.y - tileY) < 0.65);
  });

  let metroDragMode: 'track' | 'line' | null = null;
  let pendingMetroTrackStationIds: string[] = [];
  let pendingMetroLineStationIds: string[] = [];
  let pendingHelipadId: string | null = null;

  const applyTool = (tileX: number, tileY: number) => {
    const state = useGameStore.getState();
    const tileKey = keyOf(tileX, tileY);
    if (tileKey === refs.lastTileRef.current) return;
    refs.lastTileRef.current = tileKey;

    if (state.selectedTool === 'inspect') {
      const helicopter = detectHelicopter(tileX, tileY);
      const car = detectCar(tileX, tileY);
      const station = world.getMetroStationAt(tileX, tileY);
      const tunnel = state.viewLayer === 'underground' ? world.getTunnelAt(tileX, tileY) : undefined;
      if (state.viewLayer === 'surface' && helicopter) world.inspectHelicopter(helicopter.id);
      else if (state.viewLayer === 'underground' && station) world.inspectMetroStation(station.id);
      else if (state.viewLayer === 'underground' && tunnel) world.inspectTunnel(tunnel.id);
      else if (car) world.inspectCar(car.id);
      else world.inspectAt(tileX, tileY);
      state.setActionFeedback(null);
      return;
    }

    if (state.selectedTool === 'remove' && state.viewLayer === 'underground') {
      const tunnel = world.getTunnelAt(tileX, tileY);
      if (tunnel) {
        const result = world.removeTunnelAt(tileX, tileY);
        state.setActionFeedback(result.success
          ? `Túnel removido por $ ${result.cost}. Rotas recalculadas.`
          : result.reason ?? 'Não foi possível remover o túnel.');
        return;
      }
    }

    if (state.selectedTool === 'metroStation') {
      const preview = getActionPreview(world, tileX, tileY, state.selectedTool, state.stats.money);
      const didBuild = world.buildMetroStationAt(tileX, tileY);
      state.setActionFeedback(didBuild ? preview.successMessage : preview.reason ?? 'Não foi possível construir a estação.');
      return;
    }

    if (state.selectedTool === 'metroTrack') {
      if (state.viewLayer !== 'underground') state.setViewLayer('underground');
      const station = world.getMetroStationAt(tileX, tileY);
      if (!station) {
        if (metroDragMode === 'track' && pendingMetroTrackStationIds.length) {
          state.setHoverPreview(getMetroDraftPreview(world, pendingMetroTrackStationIds, { x: tileX, y: tileY }, 'metroTrack', state.stats.money));
        } else {
          state.setActionFeedback('Selecione uma estação de metrô para iniciar o trilho.');
        }
        return;
      }
      metroDragMode = 'track';
      const result = addMetroDraftStation(world, pendingMetroTrackStationIds, station.id, false);
      state.setHoverPreview(getMetroDraftPreview(world, pendingMetroTrackStationIds, { x: tileX, y: tileY }, 'metroTrack', state.stats.money));
      state.setActionFeedback(result.message ?? 'Arraste até outra estação para continuar o trilho.');
      return;
    }

    if (state.selectedTool === 'metroLine') {
      if (state.viewLayer !== 'underground') state.setViewLayer('underground');
      const station = world.getMetroStationAt(tileX, tileY);
      if (!station) {
        if (metroDragMode === 'line' && pendingMetroLineStationIds.length) {
          state.setHoverPreview(getMetroDraftPreview(world, pendingMetroLineStationIds, { x: tileX, y: tileY }, 'metroLine', state.stats.money));
        } else {
          state.setActionFeedback('Clique e arraste a partir de uma estação para criar a linha.');
        }
        return;
      }
      metroDragMode = 'line';
      const result = addMetroDraftStation(world, pendingMetroLineStationIds, station.id, true);
      state.setHoverPreview(getMetroDraftPreview(world, pendingMetroLineStationIds, { x: tileX, y: tileY }, 'metroLine', state.stats.money));
      state.setActionFeedback(result.message ?? 'Arraste sobre as próximas estações e solte para ativar a linha.');
      return;
    }
    if (state.selectedTool === 'helicopterLine') {
      const helipad = world.getHelipadAt(tileX, tileY);
      if (!helipad) {
        state.setActionFeedback('Selecione um heliponto para criar a linha aérea.');
        return;
      }
      if (!pendingHelipadId) {
        pendingHelipadId = helipad.id;
        state.setActionFeedback(`${helipad.name} selecionado. Clique no heliponto de destino.`);
        state.setHoverPreview(getHelicopterLinePreview(world, pendingHelipadId, { x: tileX, y: tileY }, state.stats.money));
        return;
      }
      const result = world.createHelicopterLine(pendingHelipadId, helipad.id);
      state.setActionFeedback(result.success ? `${result.name} ativada por $ ${result.cost}.` : result.reason ?? 'Não foi possível criar a linha aérea.');
      pendingHelipadId = null;
      state.setHoverPreview(null);
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
    if (state.selectedTool === 'roadConnection') {
      const target = getRoadConnectionTarget(camera, clientX, clientY);
      state.setHoverPreview(getRoadConnectionPreview(world, target.tile, target.direction));
      return;
    }
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
    if (metroDragMode === 'track') {
      state.setHoverPreview(getMetroDraftPreview(world, pendingMetroTrackStationIds, tile, 'metroTrack', state.stats.money));
      return;
    }
    if (metroDragMode === 'line') {
      state.setHoverPreview(getMetroDraftPreview(world, pendingMetroLineStationIds, tile, 'metroLine', state.stats.money));
      return;
    }
    if (state.selectedTool === 'helicopterLine' && pendingHelipadId) {
      state.setHoverPreview(getHelicopterLinePreview(world, pendingHelipadId, tile, state.stats.money));
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
    if (state.selectedTool === 'roadConnection') {
      const target = getRoadConnectionTarget(camera, event.clientX, event.clientY);
      const preview = getRoadConnectionPreview(world, target.tile, target.direction);
      const result = world.toggleRoadConnection(target.tile, target.direction);
      state.setHoverPreview(getRoadConnectionPreview(world, target.tile, target.direction));
      state.setActionFeedback(result.success
        ? `${result.connected ? 'Conexão aberta' : 'Conexão separada'} para ${directionLabel(target.direction)}.${result.signalRemoved ? ' Semáforo removido automaticamente.' : ''} Rotas recalculadas.`
        : result.reason ?? preview.reason ?? 'Não foi possível alterar a conexão.');
      refs.isDrawingRef.current = false;
      return;
    }
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

  window.addEventListener('pointerup', (event) => {
    const drag = refs.roadLineDragRef.current;
    const oneWayDrag = refs.oneWayLineDragRef.current;
    if (drag) {
      const state = useGameStore.getState();
      const lineTiles = getLineTiles(drag.startTile, drag.currentTile);
      const preview = getLineBuildPreview(world, lineTiles, drag.tool, state.stats.money);
      if (drag.tool === 'bikeLane') {
        const result = world.setBikeLaneLine(lineTiles);
        if (result.success) emitBikeLaneLineParticles(particles, lineTiles, result.cost);
        state.setActionFeedback(result.success
          ? bikeLaneSuccessMessage(result.changed, result.cost, Boolean(result.removed))
          : result.reason ?? preview.reason ?? 'Não foi possível alterar a ciclovia.');
        state.setHoverPreview(null);
      } else if (drag.tool === 'busLane') {
        const result = world.setBusLaneLine(lineTiles);
        if (result.success) emitBusLaneLineParticles(particles, lineTiles, result.cost);
        state.setActionFeedback(result.success
          ? busLaneSuccessMessage(result.changed, result.cost, Boolean(result.removed))
          : result.reason ?? preview.reason ?? 'Não foi possível alterar o corredor de ônibus.');
        state.setHoverPreview(null);
      } else if (drag.tool === 'roadTunnel' || drag.tool === 'avenueTunnel') {
        const result = world.buildTunnelLine(lineTiles, drag.tool);
        state.setActionFeedback(result.success
          ? `${ROAD_CONFIG[drag.tool].label} construído: ${lineTiles.length} tiles por $ ${result.cost}.`
          : result.reason ?? preview.reason ?? 'Não foi possível construir o túnel.');
        state.setHoverPreview(null);
      } else {
        const result = world.buildRoadLine(lineTiles, drag.tool);
        if (result.success) emitRoadLineParticles(particles, lineTiles, drag.tool, result.cost);
        if (result.success && (result.demolished ?? 0) > 0) {
          state.setActionFeedback(roadLineSuccessMessage(drag.tool, result.built, result.cost, result.demolished ?? 0));
        } else state.setActionFeedback(result.success
          ? `${ROAD_CONFIG[drag.tool].label} construída: ${result.built} tiles por $ ${result.cost}.`
          : result.reason ?? preview.reason ?? 'Não foi possível construir a linha.');
        state.setHoverPreview(null);
      }
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
    if (metroDragMode) {
      addMetroStationUnderPointerOnRelease(
        world,
        camera.toWorldTile(event.clientX, event.clientY),
        metroDragMode,
        pendingMetroTrackStationIds,
        pendingMetroLineStationIds,
      );
    }
    if (metroDragMode === 'track') {
      const state = useGameStore.getState();
      const result = commitMetroTrackDraft(world, pendingMetroTrackStationIds);
      state.setActionFeedback(result.message);
      state.setHoverPreview(null);
      metroDragMode = null;
      pendingMetroTrackStationIds = [];
    }
    if (metroDragMode === 'line') {
      const state = useGameStore.getState();
      const result = commitMetroLineDraft(world, pendingMetroLineStationIds);
      state.setActionFeedback(result.message);
      state.setHoverPreview(null);
      metroDragMode = null;
      pendingMetroLineStationIds = [];
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
    if (useGameStore.getState().selectedTool === 'roadConnection') return;
    const tile = camera.toWorldTile(event.clientX, event.clientY);
    applyTool(tile.x, tile.y);
  }, { signal });

  canvas.addEventListener('pointerleave', () => {
    if (refs.roadLineDragRef.current) return;
    if (refs.oneWayLineDragRef.current) return;
    if (metroDragMode) return;
    useGameStore.getState().setHoverPreview(null);
  }, { signal });

  canvas.addEventListener('wheel', (event) => {
    camera.handleWheel(event);
  }, { passive: false, signal });
}

function getRoadConnectionTarget(camera: CameraController, clientX: number, clientY: number): { tile: Vec2; direction: RoadDirection } {
  const position = camera.toWorldTilePosition(clientX, clientY);
  const tile = { x: Math.floor(position.x), y: Math.floor(position.y) };
  const localX = position.x - tile.x;
  const localY = position.y - tile.y;
  const edges: Array<{ direction: RoadDirection; distance: number }> = [
    { direction: 'north', distance: localY },
    { direction: 'east', distance: 1 - localX },
    { direction: 'south', distance: 1 - localY },
    { direction: 'west', distance: localX },
  ];
  edges.sort((a, b) => a.distance - b.distance);
  return { tile, direction: edges[0].direction };
}

export function getRoadConnectionPreview(world: GameWorld, tile: Vec2, direction: RoadDirection): ActionPreview {
  const offset = roadDirectionOffset(direction);
  const neighbor = { x: tile.x + offset.x, y: tile.y + offset.y };
  if (!inBounds(tile.x, tile.y) || !inBounds(neighbor.x, neighbor.y)) {
    return {
      ...tile,
      label: 'Conexão fora do mapa',
      valid: false,
      reason: 'A conexão precisa unir dois tiles dentro do mapa.',
      tool: 'roadConnection',
      connectionDirection: direction,
      successMessage: '',
    };
  }
  const fromTile = world.grid[tile.y]?.[tile.x];
  const toTile = world.grid[neighbor.y]?.[neighbor.x];
  if (!fromTile || !toTile || !isRoadType(fromTile.type) || !isRoadType(toTile.type)) {
    return {
      ...tile,
      label: 'Selecione a borda entre duas vias',
      valid: false,
      reason: 'Conexões só podem ser alteradas entre dois tiles viários adjacentes.',
      tool: 'roadConnection',
      connectionDirection: direction,
      successMessage: '',
    };
  }
  if (isRoundaboutTile(fromTile) || isRoundaboutTile(toTile)) {
    return {
      ...tile,
      label: 'Conexão de rotatória protegida',
      valid: false,
      reason: 'As conexões internas da rotatória são gerenciadas automaticamente.',
      tool: 'roadConnection',
      connectionDirection: direction,
      successMessage: '',
    };
  }
  const connected = areRoadTilesConnected(world.grid, tile, neighbor);
  return {
    ...tile,
    label: connected ? `Separar para ${directionLabel(direction)}` : `Conectar para ${directionLabel(direction)}`,
    valid: true,
    tool: 'roadConnection',
    connectionDirection: direction,
    connectionConnected: connected,
    successMessage: connected ? 'Conexão separada.' : 'Conexão aberta.',
  };
}


type MetroDraftTool = 'metroTrack' | 'metroLine';

type MetroDraftResult = { changed: boolean; message?: string };

function addMetroDraftStation(world: GameWorld, stationIds: string[], stationId: string, useRoute: boolean): MetroDraftResult {
  if (!stationIds.length) {
    stationIds.push(stationId);
    const station = world.getMetroStation(stationId);
    return { changed: true, message: station ? 'Início: ' + station.name + '. Arraste até a próxima estação.' : undefined };
  }

  const lastStationId = stationIds[stationIds.length - 1];
  if (lastStationId === stationId) return { changed: false };

  if (!useRoute) {
    stationIds.push(stationId);
    const station = world.getMetroStation(stationId);
    return { changed: true, message: station ? 'Conexão adicionada até ' + station.name + '.' : undefined };
  }

  const route = world.findMetroRoute(lastStationId, stationId);
  if (route.length < 2) {
    const station = world.getMetroStation(stationId);
    return { changed: false, message: station ? station.name + ' ainda não está ligada por trilhos.' : 'Estação sem trilho conectado.' };
  }

  let changed = false;
  for (const routeStationId of route.slice(1)) {
    const previous = stationIds[stationIds.length - 1];
    if (routeStationId === previous) continue;
    if (stationIds.includes(routeStationId)) continue;
    stationIds.push(routeStationId);
    changed = true;
  }

  const station = world.getMetroStation(stationId);
  return { changed, message: station ? 'Linha passando por ' + station.name + '.' : undefined };
}

function addMetroStationUnderPointerOnRelease(
  world: GameWorld,
  tile: Vec2,
  mode: 'track' | 'line',
  trackStationIds: string[],
  lineStationIds: string[],
): void {
  const station = world.getMetroStationAt(tile.x, tile.y);
  if (!station) return;

  if (mode === 'track') {
    addMetroDraftStation(world, trackStationIds, station.id, false);
    return;
  }

  addMetroDraftStation(world, lineStationIds, station.id, true);
}

function commitMetroTrackDraft(world: GameWorld, stationIds: string[]): { message: string } {
  const unique = dedupeIds(stationIds);
  if (unique.length < 2) return { message: 'Trilho cancelado: arraste entre pelo menos duas estações.' };

  let built = 0;
  let reused = 0;
  let totalCost = 0;
  let lastReason = '';

  for (let index = 0; index < unique.length - 1; index += 1) {
    const from = unique[index];
    const to = unique[index + 1];
    if (world.hasMetroTrackBetween(from, to)) {
      reused += 1;
      continue;
    }
    const result = world.buildMetroTrack(from, to);
    if (result.success) {
      built += 1;
      totalCost += result.cost ?? 0;
    } else {
      lastReason = result.reason ?? 'Não foi possível criar uma conexão.';
      break;
    }
  }

  if (built > 0) return { message: 'Trilho criado: ' + built + ' conexão(ões) por $ ' + totalCost + '.' + (reused ? ' ' + reused + ' já existia(m).' : '') };
  if (reused > 0 && !lastReason) return { message: 'As estações selecionadas já estavam conectadas por trilhos.' };
  return { message: lastReason || 'Não foi possível construir o trilho.' };
}

function commitMetroLineDraft(world: GameWorld, stationIds: string[]): { message: string } {
  const unique = dedupeIds(stationIds);
  if (unique.length < 2) return { message: 'Linha cancelada: arraste por pelo menos duas estações conectadas.' };
  const result = world.createMetroLine(unique);
  return { message: result.success ? String(result.name) + ' ativada por $ ' + result.cost + '.' : result.reason ?? 'Não foi possível criar a linha.' };
}

function getMetroDraftPreview(world: GameWorld, stationIds: string[], currentTile: Vec2, tool: MetroDraftTool, money: number): ActionPreview {
  const unique = dedupeIds(stationIds);
  const lineTiles = buildMetroDraftTiles(world, unique, currentTile, tool);
  const label = tool === 'metroTrack'
    ? unique.length < 2 ? 'Arraste o trilho até outra estação' : 'Trilho: ' + unique.length + ' estações'
    : unique.length < 2 ? 'Arraste a linha até outra estação' : 'Linha de metrô: ' + unique.length + ' estações';

  const cost = tool === 'metroTrack'
    ? estimateMetroTrackDraftCost(world, unique)
    : METRO_CONFIG.lineActivationCost;

  const valid = tool === 'metroTrack'
    ? unique.length >= 2 && money >= cost
    : unique.length >= 2 && isMetroLineDraftConnected(world, unique) && money >= cost;

  const reason = valid ? undefined : tool === 'metroTrack'
    ? unique.length < 2 ? 'Arraste até outra estação para criar o trilho.' : money < cost ? 'Faltam $ ' + (cost - money) + ' para construir.' : 'Não foi possível criar o trilho.'
    : unique.length < 2 ? 'Arraste por pelo menos duas estações.' : !isMetroLineDraftConnected(world, unique) ? 'Todas as estações da linha precisam estar conectadas por trilhos.' : 'Faltam $ ' + (cost - money) + ' para ativar a linha.';

  return {
    x: currentTile.x,
    y: currentTile.y,
    label,
    cost,
    valid,
    reason,
    tool,
    lineTiles,
    buildableTiles: unique.length,
    successMessage: tool === 'metroTrack' ? 'Trilho selecionado.' : 'Linha selecionada.',
  };
}

function getHelicopterLinePreview(world: GameWorld, fromId: string, currentTile: Vec2, money: number): ActionPreview {
  const from = world.getHelipad(fromId);
  const to = world.getHelipadAt(currentTile.x, currentTile.y);
  const distance = from && to ? Math.abs(from.x - to.x) + Math.abs(from.y - to.y) : 0;
  const valid = Boolean(
    from
    && to
    && from.id !== to.id
    && distance >= HELICOPTER_CONFIG.minLineDistance
    && money >= HELICOPTER_CONFIG.lineActivationCost,
  );
  const reason = !from
    ? 'Heliponto inicial indisponível.'
    : !to
      ? 'Clique no heliponto de destino.'
      : from.id === to.id
        ? 'Escolha outro heliponto.'
        : distance < HELICOPTER_CONFIG.minLineDistance
          ? `Distância mínima: ${HELICOPTER_CONFIG.minLineDistance} tiles.`
          : money < HELICOPTER_CONFIG.lineActivationCost
            ? `Faltam $ ${HELICOPTER_CONFIG.lineActivationCost - money}.`
            : undefined;
  return {
    x: currentTile.x,
    y: currentTile.y,
    label: valid ? `Linha aérea: ${distance} tiles` : 'Linha aérea',
    cost: HELICOPTER_CONFIG.lineActivationCost,
    valid,
    reason,
    tool: 'helicopterLine',
    lineTiles: from ? [{ x: from.x, y: from.y }, { x: currentTile.x, y: currentTile.y }] : [],
    successMessage: 'Linha aérea selecionada.',
  };
}

function buildMetroDraftTiles(world: GameWorld, stationIds: string[], currentTile: Vec2, tool: MetroDraftTool): Vec2[] {
  const tiles: Vec2[] = [];
  for (let index = 0; index < stationIds.length - 1; index += 1) {
    const fromId = stationIds[index];
    const toId = stationIds[index + 1];
    const from = world.getMetroStation(fromId);
    const to = world.getMetroStation(toId);
    if (!from || !to) continue;
    const segment = tool === 'metroLine'
      ? world.getMetroTrackTilesBetween(fromId, toId)
      : world.getMetroTrackTilesBetween(fromId, toId).length >= 2
        ? world.getMetroTrackTilesBetween(fromId, toId)
        : buildMetroTrackTiles(from, to);
    appendPreviewTiles(tiles, segment.length >= 2 ? segment : [from, to]);
  }

  const lastStation = world.getMetroStation(stationIds[stationIds.length - 1]);
  if (lastStation && (lastStation.x !== currentTile.x || lastStation.y !== currentTile.y)) {
    const currentStation = world.getMetroStationAt(currentTile.x, currentTile.y);
    const previewEnd = currentStation ?? currentTile;
    const existingTrack = currentStation ? world.getMetroTrackTilesBetween(lastStation.id, currentStation.id) : [];
    appendPreviewTiles(tiles, existingTrack.length >= 2 ? existingTrack : buildMetroTrackTiles(lastStation, previewEnd));
  }

  return dedupePreviewTiles(tiles);
}

function appendPreviewTiles(target: Vec2[], source: Vec2[]): void {
  for (const tile of source) target.push({ x: tile.x, y: tile.y });
}

function estimateMetroTrackDraftCost(world: GameWorld, stationIds: string[]): number {
  let cost = 0;
  for (let index = 0; index < stationIds.length - 1; index += 1) {
    const from = world.getMetroStation(stationIds[index]);
    const to = world.getMetroStation(stationIds[index + 1]);
    if (!from || !to || world.hasMetroTrackBetween(from.id, to.id)) continue;
    cost += Math.max(1, buildMetroTrackTiles(from, to).length - 1) * METRO_CONFIG.trackCostPerTile;
  }
  return cost;
}

function isMetroLineDraftConnected(world: GameWorld, stationIds: string[]): boolean {
  if (stationIds.length < 2) return false;
  for (let index = 0; index < stationIds.length - 1; index += 1) {
    if (!world.hasMetroTrackBetween(stationIds[index], stationIds[index + 1])) return false;
  }
  return true;
}

function dedupeIds(ids: string[]): string[] {
  const result: string[] = [];
  for (const id of ids) {
    if (result[result.length - 1] === id) continue;
    result.push(id);
  }
  return result;
}

function emitActionParticles(particles: ParticleSystem | undefined, pos: Vec2, tool: Tool, cost?: number): void {
  if (!particles) return;
  if (tool === 'road' || tool === 'avenue') particles.emitRoadDust(pos, tool === 'avenue' ? 12 : 8);
  if (tool === 'trafficLight') particles.emitTrafficLightSpark(pos);
  if (cost && cost > 0) particles.emitMoneyText(pos, -cost);
}

function emitRoadLineParticles(particles: ParticleSystem | undefined, lineTiles: Vec2[], tool: 'road' | 'avenue' | 'bikeLane', cost: number): void {
  if (!particles) return;
  const step = Math.max(1, Math.ceil(lineTiles.length / 18));
  for (let i = 0; i < lineTiles.length; i += step) {
    particles.emitRoadDust(lineTiles[i], tool === 'avenue' ? 10 : 7);
  }
  const anchor = lineTiles[lineTiles.length - 1];
  if (anchor && cost > 0) particles.emitMoneyText(anchor, -cost);
}

function emitBusLaneLineParticles(particles: ParticleSystem | undefined, lineTiles: Vec2[], cost: number): void {
  if (!particles) return;
  const step = Math.max(1, Math.ceil(lineTiles.length / 16));
  for (let i = 0; i < lineTiles.length; i += step) {
    particles.emitRoadDust(lineTiles[i], 6);
  }
  const anchor = lineTiles[lineTiles.length - 1];
  if (anchor && cost > 0) particles.emitMoneyText(anchor, -cost);
}

function emitBikeLaneLineParticles(particles: ParticleSystem | undefined, lineTiles: Vec2[], cost: number): void {
  if (!particles) return;
  const step = Math.max(1, Math.ceil(lineTiles.length / 18));
  for (let i = 0; i < lineTiles.length; i += step) {
    particles.emitRoadDust(lineTiles[i], 5);
  }
  const anchor = lineTiles[lineTiles.length - 1];
  if (anchor && cost > 0) particles.emitMoneyText(anchor, -cost);
}

function bikeLaneSuccessMessage(changed: number, cost: number, removed: boolean): string {
  const tileText = changed + ' tile' + (changed === 1 ? '' : 's');
  return removed
    ? 'Ciclovia removida: ' + tileText + ' por $ ' + cost + '.'
    : 'Ciclovia implantada: ' + tileText + ' por $ ' + cost + '.';
}


function busLaneSuccessMessage(changed: number, cost: number, removed: boolean): string {
  const tileText = `${changed} tile${changed === 1 ? '' : 's'}`;
  return removed
    ? `Corredor de ônibus removido: ${tileText} por $ ${cost}.`
    : `Corredor de ônibus implantado: ${tileText} por $ ${cost}.`;
}


function roadLineSuccessMessage(tool: 'road' | 'avenue' | 'bikeLane', built: number, cost: number, demolished: number): string {
  const label = tool === 'bikeLane' ? 'Ciclovia' : ROAD_CONFIG[tool].label;
  const demolitionText = demolished > 0
    ? ` ${demolished} prédio${demolished > 1 ? 's' : ''} demolido${demolished > 1 ? 's' : ''}.`
    : '';
  return `${label} construída: ${built} tiles por $ ${cost}.${demolitionText}`;
}

export function isRoadLineTool(tool: Tool): tool is 'road' | 'avenue' | 'busLane' | 'bikeLane' | 'roadTunnel' | 'avenueTunnel' {
  return tool === 'road' || tool === 'avenue' || tool === 'busLane' || tool === 'bikeLane' || tool === 'roadTunnel' || tool === 'avenueTunnel';
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


export function getLineBuildPreview(world: GameWorld, tiles: Vec2[], tool: 'road' | 'avenue' | 'busLane' | 'bikeLane' | 'roadTunnel' | 'avenueTunnel', money: number): ActionPreview {
  const uniqueTiles = dedupePreviewTiles(tiles);
  if (tool === 'busLane') return getBusLaneBuildPreview(world, uniqueTiles, money);
  if (tool === 'bikeLane') return getBikeLaneBuildPreview(world, uniqueTiles, money);
  if (tool === 'roadTunnel' || tool === 'avenueTunnel') return getTunnelBuildPreview(world, uniqueTiles, tool, money);
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
    if (isTerrainBlocked(tile)) {
      invalidTiles.push(pos);
      reason ??= tile.type === 'lake' ? 'A linha passa por um lago.' : 'A linha passa por uma montanha.';
      continue;
    }
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
    if (tile.type === 'metroStation') {
      invalidTiles.push(pos);
      reason ??= 'A linha passa por uma estação de metrô.';
      continue;
    }
    if (tile.type === 'helipad') {
      invalidTiles.push(pos);
      reason ??= 'A linha passa por um heliponto.';
      continue;
    }
    if (tile.type === 'tunnelPortal') {
      invalidTiles.push(pos);
      reason ??= 'A linha passa por um portal de túnel.';
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


function getBusLaneBuildPreview(world: GameWorld, uniqueTiles: Vec2[], money: number): ActionPreview {
  const invalidTiles: Vec2[] = [];
  let reason: string | undefined;
  let eligible = 0;
  let enabled = 0;

  for (const pos of uniqueTiles) {
    if (!inBounds(pos.x, pos.y)) {
      invalidTiles.push(pos);
      reason ??= 'A linha sai do mapa.';
      continue;
    }
    const tile = world.grid[pos.y]?.[pos.x];
    if (!tile || (tile.type !== 'road' && tile.type !== 'avenue')) {
      invalidTiles.push(pos);
      reason ??= 'Corredor de ônibus só pode ser aplicado em ruas e avenidas.';
      continue;
    }
    if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) {
      invalidTiles.push(pos);
      reason ??= 'Corredor de ônibus não pode ser aplicado em rotatórias.';
      continue;
    }
    eligible += 1;
    if (tile.busLane) enabled += 1;
  }

  const remove = eligible > 0 && enabled === eligible;
  const changed = remove ? enabled : eligible - enabled;
  const cost = remove
    ? Math.ceil(changed * BUS_LANE_CONFIG.buildCost * BUS_LANE_CONFIG.removeCostRatio)
    : changed * BUS_LANE_CONFIG.buildCost;

  if (!reason && eligible === 0) reason = 'Nenhuma via válida selecionada.';
  if (!reason && changed === 0) reason = remove ? 'O corredor já está removido.' : 'O corredor já existe em todo o trecho.';
  if (!reason && money < cost) reason = `Faltam $ ${cost - money} para ${remove ? 'remover' : 'implantar'} o corredor.`;

  return {
    x: uniqueTiles[uniqueTiles.length - 1]?.x ?? 0,
    y: uniqueTiles[uniqueTiles.length - 1]?.y ?? 0,
    label: remove ? `Remover corredor: ${changed} tiles` : `Corredor de ônibus: ${changed} tiles`,
    cost,
    valid: !reason,
    reason,
    tool: 'busLane',
    lineTiles: uniqueTiles,
    invalidTiles,
    buildableTiles: changed,
    successMessage: remove
      ? `Corredor removido em ${changed} tile${changed === 1 ? '' : 's'} por $ ${cost}.`
      : `Corredor implantado em ${changed} tile${changed === 1 ? '' : 's'} por $ ${cost}.`,
  };
}


function getBikeLaneBuildPreview(world: GameWorld, uniqueTiles: Vec2[], money: number): ActionPreview {
  const invalidTiles: Vec2[] = [];
  let reason: string | undefined;
  let eligible = 0;
  let enabled = 0;

  for (const pos of uniqueTiles) {
    if (!inBounds(pos.x, pos.y)) {
      invalidTiles.push(pos);
      reason ??= 'A linha sai do mapa.';
      continue;
    }
    const tile = world.grid[pos.y]?.[pos.x];
    if (!tile || tile.type !== 'road') {
      invalidTiles.push(pos);
      reason ??= 'Ciclovia só pode ser aplicada em ruas.';
      continue;
    }
    eligible += 1;
    if (tile.bikeLane) enabled += 1;
  }

  const remove = eligible > 0 && enabled === eligible;
  const changed = remove ? enabled : eligible - enabled;
  const cost = remove
    ? Math.ceil(changed * BIKE_LANE_CONFIG.buildCost * BIKE_LANE_CONFIG.removeCostRatio)
    : changed * BIKE_LANE_CONFIG.buildCost;

  if (!reason && eligible === 0) reason = 'Nenhuma rua válida selecionada.';
  if (!reason && changed === 0) reason = remove ? 'A ciclovia já está removida.' : 'A ciclovia já existe em todo o trecho.';
  if (!reason && money < cost) reason = 'Faltam $ ' + (cost - money) + ' para ' + (remove ? 'remover' : 'implantar') + ' a ciclovia.';

  return {
    x: uniqueTiles[uniqueTiles.length - 1]?.x ?? 0,
    y: uniqueTiles[uniqueTiles.length - 1]?.y ?? 0,
    label: remove ? 'Remover ciclovia: ' + changed + ' tiles' : 'Ciclovia: ' + changed + ' tiles',
    cost,
    valid: !reason,
    reason,
    tool: 'bikeLane',
    lineTiles: uniqueTiles,
    invalidTiles,
    buildableTiles: changed,
    successMessage: bikeLaneSuccessMessage(changed, cost, remove),
  };
}

function getTunnelBuildPreview(
  world: GameWorld,
  uniqueTiles: Vec2[],
  tool: 'roadTunnel' | 'avenueTunnel',
  money: number,
): ActionPreview {
  const invalidTiles: Vec2[] = [];
  let reason: string | undefined;
  const start = uniqueTiles[0];
  const end = uniqueTiles[uniqueTiles.length - 1];
  const config = ROAD_CONFIG[tool];
  const cost = config.portalCost * 2 + uniqueTiles.length * config.buildCost;
  if (!start || !end || uniqueTiles.length < 2) reason = 'Arraste do portal de entrada até o portal de saída.';
  if (!reason && start.x === end.x && start.y === end.y) reason = 'Entrada e saída precisam ser tiles diferentes.';

  for (const portal of [start, end].filter(Boolean) as Vec2[]) {
    if (!inBounds(portal.x, portal.y)) {
      invalidTiles.push(portal);
      reason ??= 'O portal sai do mapa.';
      continue;
    }
    const tile = world.grid[portal.y]?.[portal.x];
    if (!tile || tile.type !== 'empty') {
      invalidTiles.push(portal);
      reason ??= 'Portais precisam ser construídos em tiles vazios.';
      continue;
    }
    const opposite = portal.x === start?.x && portal.y === start?.y ? end : start;
    if (!opposite || !world.getTunnelAccessRoad(portal, opposite)) {
      invalidTiles.push(portal);
      reason ??= 'Cada portal precisa ficar ao lado de uma rua ou avenida.';
    }
  }
  if (!reason && money < cost) reason = `Faltam $ ${cost - money} para construir.`;
  return {
    x: end?.x ?? start?.x ?? 0,
    y: end?.y ?? start?.y ?? 0,
    label: `${config.label}: ${uniqueTiles.length} tiles`,
    cost,
    valid: !reason,
    reason,
    tool,
    lineTiles: uniqueTiles,
    invalidTiles,
    buildableTiles: uniqueTiles.length,
    successMessage: `${config.label} construído por $ ${cost}.`,
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
    if (tile.type === 'metroStation' || tile.type === 'helipad') return { x, y, label: 'Infraestrutura ocupa o tile', cost, valid: false, reason: 'Remova a infraestrutura de transporte antes de construir uma via.', successMessage: '' };
    if (tile.type === 'tunnelPortal') return { x, y, label: 'Portal ocupa o tile', cost, valid: false, reason: 'Remova o portal de túnel antes de construir uma via.', successMessage: '' };
    if (tile.type === 'building') return { x, y, label: 'Prédio ocupa o tile', cost, valid: false, reason: 'Não é possível construir sobre prédio.', successMessage: '' };
    if (isRoundaboutTile(tile) || isRoundaboutCenter(tile)) return { x, y, label: 'Rotatória ocupa o tile', cost, valid: false, reason: 'Remova a rotatória antes de construir outra via.', successMessage: '' };
    if (tile.type === tool) return { x, y, label: 'Via já construída', cost, valid: false, reason: 'Essa via já existe aqui.', successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para construir.`, successMessage: '' };
    return { x, y, label: tool === 'road' ? 'Construir rua' : 'Construir avenida', cost, valid: true, successMessage: `${tool === 'road' ? 'Rua' : 'Avenida'} construída por $ ${cost}.` };
  }

  if (tool === 'roundabout') {
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
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para construir.`, successMessage: '' };
    const demolitionText = buildingsToDemolish.length > 0
      ? ` ${buildingsToDemolish.length} prédio${buildingsToDemolish.length > 1 ? 's' : ''} será${buildingsToDemolish.length > 1 ? 'o' : ''} demolido${buildingsToDemolish.length > 1 ? 's' : ''}.`
      : '';
    return {
      x,
      y,
      label: buildingsToDemolish.length > 0 ? 'Demolir e construir rotatória' : 'Construir rotatória',
      cost,
      valid: true,
      demolishedBuildings: buildingsToDemolish.length,
      successMessage: `Rotatória construída por $ ${cost}.${demolitionText}`,
    };
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

  if (tool === 'metroStation') {
    const cost = METRO_CONFIG.stationBuildCost;
    if (world.getMetroStationAt(x, y)) return { x, y, label: 'Estação já existe', cost, valid: false, reason: 'Já existe uma estação de metrô nesse tile.', successMessage: '' };
    if (tile.type !== 'empty') return { x, y, label: 'Tile ocupado', cost, valid: false, reason: 'A estação precisa ocupar um tile vazio na superfície.', successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para construir a estação.`, successMessage: '' };
    return { x, y, label: 'Construir estação de metrô', cost, valid: true, successMessage: `Estação de metrô construída por $ ${cost}.` };
  }

  if (tool === 'helipad') {
    const cost = HELICOPTER_CONFIG.helipadBuildCost;
    const access = busStopPreviewAccess(world.grid, x, y);
    if (tile.type !== 'empty') return { x, y, label: 'Heliponto indisponível', cost, valid: false, reason: 'Use um lote vazio.', successMessage: '' };
    if (!access) return { x, y, label: 'Sem via de acesso', cost, valid: false, reason: 'O heliponto precisa ficar ao lado de uma rua ou avenida.', successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money}.`, successMessage: '' };
    return { x, y, label: 'Construir heliponto', cost, valid: true, successMessage: `Heliponto construído por $ ${cost}.` };
  }

  if (tool === 'metroTrack') {
    const station = world.getMetroStationAt(x, y);
    return { x, y, label: station ? `Selecionar ${station.name}` : 'Selecione uma estação', valid: Boolean(station), reason: station ? undefined : 'Trilhos ligam uma estação a outra.', successMessage: 'Estação selecionada.' };
  }

  if (tool === 'metroLine') {
    const station = world.getMetroStationAt(x, y);
    return { x, y, label: station ? `Linha a partir de ${station.name}` : 'Selecione uma estação', cost: METRO_CONFIG.lineActivationCost, valid: Boolean(station), reason: station ? undefined : 'Clique em uma estação para criar uma linha.', successMessage: 'Estação selecionada.' };
  }

  if (tool === 'helicopterLine') {
    const helipad = world.getHelipadAt(x, y);
    return {
      x, y,
      label: helipad ? `Selecionar ${helipad.name}` : 'Selecione um heliponto',
      cost: HELICOPTER_CONFIG.lineActivationCost,
      valid: Boolean(helipad),
      reason: helipad ? undefined : 'Linhas aéreas ligam dois helipontos.',
      successMessage: 'Heliponto selecionado.',
    };
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
    const metroStation = world.getMetroStationAt(x, y);
    const helipad = world.getHelipadAt(x, y);
    if (helipad) {
      const cost = HELICOPTER_CONFIG.helipadRemoveCost;
      if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money}.`, successMessage: '' };
      return { x, y, label: 'Remover heliponto', cost, valid: true, successMessage: `Heliponto removido por $ ${cost}. Linhas associadas também foram removidas.` };
    }
    if (metroStation) {
      return {
        x,
        y,
        label: 'Remover estação de metrô',
        valid: true,
        successMessage: 'Estação de metrô removida. Trilhos, linhas e trens dependentes também foram removidos.',
      };
    }
    if (tile.type === 'busStop') {
      const cost = Math.ceil(TRANSIT_CONFIG.busStopCost * TRANSIT_CONFIG.busStopRemoveCostRatio);
      if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para remover.`, successMessage: '' };
      return { x, y, label: 'Remover ponto de ônibus', cost, valid: true, successMessage: `Ponto de ônibus removido por $ ${cost}.` };
    }
    if (tile.type === 'tunnelPortal' && tile.tunnelPortalKind) {
      const cost = ROAD_CONFIG[tile.tunnelPortalKind].removeCost;
      if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para remover.`, successMessage: '' };
      return { x, y, label: 'Remover portal de túnel', cost, valid: true, successMessage: `Túnel removido por $ ${cost}.` };
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

