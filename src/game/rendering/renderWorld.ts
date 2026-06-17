import type { Container, Graphics } from 'pixi.js';
import type { HeatmapMode, HoverPreview, ViewLayer, MobilityFocusMode } from '../../store/gameStore';
import type { Car } from '../../types/agent.types';
import { GAME_CONFIG } from '../config/gameConfig';
import type { GameWorld } from '../engine/simulation';
import { isRoadType, keyOf } from '../city/grid';
import { MAP_COLORS } from './visualTheme';
import { getAtmosphere, drawAtmosphereOverlay, drawBuildingLife, drawStreetFurniture } from './renderEffects';
import { drawBaseTile, drawLotDecoration } from './renderTerrain';
import { drawTerrainFeatureAnimation, drawTerrainFeatureBase } from './renderTerrainFeatures';
import { drawBusStop, drawBusStopCoverage, drawRoad, drawRoadSignage, drawRoundaboutIsland, drawTrafficLights, drawOneWayArrow } from './renderRoads';
import { drawHeatmapMode } from './renderHeatmap';
import { drawBuildingVariant } from './renderBuildings';
import { drawCar } from './renderVehicles';
import { getStaticRenderSignature } from './renderInvalidation';
import { drawConstructionPreview, drawSelectedCarMarker, drawSelectedRoute, drawSelection } from './renderUiOverlays';
import type { ParticleSystem } from './particleSystem';
import { renderMetroLayer } from './renderMetro';
import { drawMobilityFocusOverlay } from './renderMobilityFocus';

type ViewportTileBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
import { drawBikeTrips } from './renderBikes';

export type RenderWorldState = {
  staticSignature: string | null;
  buildingConnections: Map<string, boolean> | null;
  smokeLastByTile: Map<string, number>;
  lastMoney: number | null;
};

export function createRenderWorldState(): RenderWorldState {
  return {
    staticSignature: null,
    buildingConnections: null,
    smokeLastByTile: new Map(),
    lastMoney: null,
  };
}

export function renderWorld(
  staticGraphics: Graphics,
  dynamicGraphics: Graphics,
  labels: Container,
  state: RenderWorldState,
  world: GameWorld,
  heatmapMode: HeatmapMode,
  hoverPreview: HoverPreview | null,
  camX: number,
  camY: number,
  scale: number,
  viewLayer: ViewLayer,
  mobilityFocusMode: MobilityFocusMode = 'off',
  particles?: ParticleSystem,
  visibleBounds?: ViewportTileBounds,
): void {
  const ts = GAME_CONFIG.tileSize;
  const timeSeconds = performance.now() / 1000;
  const atmosphere = getAtmosphere(world.time.getPeriod(), timeSeconds);

  applyCamera(staticGraphics, camX, camY, scale);
  applyCamera(dynamicGraphics, camX, camY, scale);
  applyCamera(labels, camX, camY, scale);

  const staticSignature = getStaticRenderSignature(world, atmosphere.period);
  if (state.staticSignature !== staticSignature) {
    state.staticSignature = staticSignature;
    renderStaticLayer(staticGraphics, world, ts, timeSeconds, atmosphere);
  }

  emitRenderParticles(state, world, timeSeconds, particles);
  renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, mobilityFocusMode, visibleBounds);
}

function applyCamera(container: Container, camX: number, camY: number, scale: number): void {
  container.position.set(camX, camY);
  container.scale.set(scale);
}

function renderStaticLayer(
  graphics: Graphics,
  world: GameWorld,
  ts: number,
  timeSeconds: number,
  atmosphere: ReturnType<typeof getAtmosphere>,
): void {
  graphics.clear();

  for (let y = 0; y < world.grid.length; y++) {
    for (let x = 0; x < (world.grid[y]?.length ?? 0); x++) {
      const tile = world.grid[y]?.[x];
      if (!tile) continue;
      drawBaseTile(graphics, tile, x, y, ts);
      if (tile.type === 'mountain' || tile.type === 'lake') drawTerrainFeatureBase(graphics, world.grid, tile, x, y, ts, timeSeconds);
      if (tile.type === 'empty') drawLotDecoration(graphics, x, y, ts);
      if (tile.type === 'road') drawRoad(graphics, world.grid, x, y, ts, 'road');
      if (tile.type === 'avenue') drawRoad(graphics, world.grid, x, y, ts, 'avenue');
      if (tile.type === 'roundabout') drawRoad(graphics, world.grid, x, y, ts, 'roundabout');
      if (tile.type === 'roundaboutCenter') drawRoundaboutIsland(graphics, world.grid, x, y, ts);
    }
  }

  for (let y = 0; y < world.grid.length; y++) {
    for (let x = 0; x < (world.grid[y]?.length ?? 0); x++) {
      const tile = world.grid[y]?.[x];
      if (!tile) continue;
      if (isRoadType(tile.type) && tile.type !== 'roundabout') drawRoadSignage(graphics, world, x, y, ts);
      if ((tile.type === 'road' || tile.type === 'avenue') && tile.oneWay) drawOneWayArrow(graphics, x, y, ts, tile.oneWay, tile.type === 'avenue');
    }
  }

  for (const building of world.buildings) {
    drawBuildingVariant(graphics, building, ts, timeSeconds, atmosphere);
    if (!building.connected) {
      graphics.circle(building.x * ts + ts - 5, building.y * ts + 5, 4).fill(MAP_COLORS.disconnected);
    }
  }
}

function renderDynamicLayer(
  graphics: Graphics,
  state: RenderWorldState,
  world: GameWorld,
  heatmapMode: HeatmapMode,
  hoverPreview: HoverPreview | null,
  ts: number,
  timeSeconds: number,
  atmosphere: ReturnType<typeof getAtmosphere>,
  viewLayer: ViewLayer,
  mobilityFocusMode: MobilityFocusMode,
  visibleBounds?: ViewportTileBounds,
): void {
  graphics.clear();

  if (viewLayer === 'underground') {
    renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);
    drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);
    if (hoverPreview) drawConstructionPreview(graphics, world, hoverPreview, ts, timeSeconds);
    if (world.selected.kind === 'tile') drawSelection(graphics, world.selected.x, world.selected.y, ts);
    if (world.selected.kind === 'metroStation') drawSelection(graphics, world.selected.station.x, world.selected.station.y, ts);
    pruneSmokeHistory(state, timeSeconds);
    return;
  }

  drawTerrainFeatureAnimation(graphics, world.grid, ts, timeSeconds);

  for (const stop of world.transitStops) {
    drawBusStop(graphics, world, stop.x, stop.y, ts, timeSeconds, atmosphere);
  }

  drawHeatmapMode(graphics, world, heatmapMode, ts, atmosphere);
  drawTerrainFeatureAnimation(graphics, world, ts, timeSeconds);
  drawStreetFurniture(graphics, world, ts, timeSeconds, atmosphere);
  drawAtmosphereOverlay(graphics, world, atmosphere, heatmapMode, ts);
  renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);
  drawBuildingLife(graphics, world, ts, timeSeconds, atmosphere);
  drawDisconnectedBuildingAlerts(graphics, world, ts, timeSeconds);
  drawTrafficLights(graphics, world, ts, timeSeconds);
  drawSelectedRoute(graphics, world, ts);

  const carCullBounds = visibleBounds ? expandViewportBounds(visibleBounds, 2) : undefined;
  for (const car of world.cars) {
    const selectedCar = world.selected.kind === 'car' && world.selected.carId === car.id;
    if (carCullBounds && !selectedCar && !isCarInsideBounds(car, carCullBounds)) continue;
    drawCar(graphics, car, world, ts, timeSeconds, atmosphere);
  }
  drawBikeTrips(graphics, world, ts, timeSeconds);
  drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);

  if (hoverPreview) drawConstructionPreview(graphics, world, hoverPreview, ts, timeSeconds);
  if (world.selected.kind === 'tile') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'road') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'building') drawSelection(graphics, world.selected.building.x, world.selected.building.y, ts);
  if (world.selected.kind === 'busStop') {
    drawBusStopCoverage(graphics, world.selected.stop.x, world.selected.stop.y, ts, 0.09, 0.4);
    drawSelection(graphics, world.selected.stop.x, world.selected.stop.y, ts);
  }
  drawSelectedCarMarker(graphics, world, ts);
  pruneSmokeHistory(state, timeSeconds);
}

function expandViewportBounds(bounds: ViewportTileBounds, paddingTiles: number): ViewportTileBounds {
  return {
    minX: bounds.minX - paddingTiles,
    minY: bounds.minY - paddingTiles,
    maxX: bounds.maxX + paddingTiles,
    maxY: bounds.maxY + paddingTiles,
  };
}

function isCarInsideBounds(car: Car, bounds: ViewportTileBounds): boolean {
  if (car.x >= bounds.minX && car.x <= bounds.maxX && car.y >= bounds.minY && car.y <= bounds.maxY) return true;
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  return Boolean(
    (current && current.x >= bounds.minX && current.x <= bounds.maxX && current.y >= bounds.minY && current.y <= bounds.maxY)
    || (next && next.x >= bounds.minX && next.x <= bounds.maxX && next.y >= bounds.minY && next.y <= bounds.maxY)
  );
}

function emitRenderParticles(state: RenderWorldState, world: GameWorld, timeSeconds: number, particles?: ParticleSystem): void {
  if (!particles) {
    syncRenderHistory(state, world);
    return;
  }

  if (!state.buildingConnections) {
    state.buildingConnections = new Map(world.buildings.map((building) => [building.id, building.connected]));
  } else {
    for (const building of world.buildings) {
      const wasConnected = state.buildingConnections.get(building.id);
      if (wasConnected === false && building.connected) {
        particles.emitConnectionPulse({ x: building.x, y: building.y });
      }
      state.buildingConnections.set(building.id, building.connected);
    }
  }

  for (const traffic of world.traffic.values()) {
    if (traffic.congestion < 1.35) continue;
    const key = keyOf(traffic.x, traffic.y);
    const lastSmoke = state.smokeLastByTile.get(key) ?? -Infinity;
    if (timeSeconds - lastSmoke < 1.15) continue;
    state.smokeLastByTile.set(key, timeSeconds);
    particles.emitCongestionSmoke(traffic);
  }

  const money = Math.floor(world.money);
  if (state.lastMoney !== null && money > state.lastMoney) {
    const anchor = moneyParticleAnchor(world);
    particles.emitMoneyText(anchor, money - state.lastMoney);
  }
  state.lastMoney = money;
}

function syncRenderHistory(state: RenderWorldState, world: GameWorld): void {
  if (!state.buildingConnections) {
    state.buildingConnections = new Map(world.buildings.map((building) => [building.id, building.connected]));
    state.lastMoney = Math.floor(world.money);
    return;
  }
  for (const building of world.buildings) {
    state.buildingConnections.set(building.id, building.connected);
  }
  state.lastMoney = Math.floor(world.money);
}

function moneyParticleAnchor(world: GameWorld): { x: number; y: number } {
  const activeBuilding = world.buildings.find((building) => building.connected && (building.type === 'shop' || building.type === 'office'))
    ?? world.buildings.find((building) => building.connected);
  if (activeBuilding) return { x: activeBuilding.x, y: activeBuilding.y };
  return { x: Math.floor((world.grid[0]?.length ?? GAME_CONFIG.gridWidth) / 2), y: Math.floor((world.grid.length || GAME_CONFIG.gridHeight) / 2) };
}

function drawDisconnectedBuildingAlerts(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  const pulse = 0.5 + Math.sin(timeSeconds * 3.8) * 0.5;
  for (const building of world.buildings) {
    if (building.connected) continue;
    const px = building.x * ts;
    const py = building.y * ts;
    graphics.roundRect(px + 2, py + 2, ts - 4, ts - 4, 7).stroke({ color: MAP_COLORS.disconnected, width: 1.5 + pulse * 1.2, alpha: 0.28 + pulse * 0.36 });
    graphics.circle(px + ts - 5, py + 5, 4 + pulse * 1.5).fill({ color: MAP_COLORS.disconnected, alpha: 0.16 + pulse * 0.22 });
  }
}

function pruneSmokeHistory(state: RenderWorldState, timeSeconds: number): void {
  for (const [key, lastSmoke] of state.smokeLastByTile) {
    if (timeSeconds - lastSmoke > 8) state.smokeLastByTile.delete(key);
  }
}
