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
import { drawCar, drawCarLod } from './renderVehicles';
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
import { PERFORMANCE_CONFIG } from '../config/performanceConfig';
import { DEFAULT_GRAPHICS_SETTINGS, type GraphicsSettings } from '../config/graphicsSettings';
import { drawAirLayer, drawHelipadCoverage, drawHelipads, getHelicopterPose } from './renderHelicopters';

export type RenderWorldState = {
  staticSignature: string | null;
  buildingConnections: Map<string, boolean> | null;
  smokeLastByTile: Map<string, number>;
  lastMoney: number | null;
  lastEnvironmentRenderAt: number;
  environmentSignature: string | null;
  lastOverlayRenderAt: number;
  overlaySignature: string | null;
};

export function createRenderWorldState(): RenderWorldState {
  return {
    staticSignature: null,
    buildingConnections: null,
    smokeLastByTile: new Map(),
    lastMoney: null,
    lastEnvironmentRenderAt: -Infinity,
    environmentSignature: null,
    lastOverlayRenderAt: -Infinity,
    overlaySignature: null,
  };
}

export function renderWorld(
  staticGraphics: Graphics,
  environmentGraphics: Graphics,
  vehicleGraphics: Graphics,
  airGraphics: Graphics,
  overlayGraphics: Graphics,
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
  graphics: GraphicsSettings = DEFAULT_GRAPHICS_SETTINGS,
): void {
  const ts = GAME_CONFIG.tileSize;
  const timeSeconds = performance.now() / 1000;
  const atmosphere = getAtmosphere(world.time.getPeriod(), timeSeconds);

  applyCamera(staticGraphics, camX, camY, scale);
  applyCamera(environmentGraphics, camX, camY, scale);
  applyCamera(vehicleGraphics, camX, camY, scale);
  applyCamera(airGraphics, camX, camY, scale);
  applyCamera(overlayGraphics, camX, camY, scale);
  applyCamera(labels, camX, camY, scale);

  const staticSignature = getStaticRenderSignature(world, atmosphere.period, graphics);
  if (state.staticSignature !== staticSignature) {
    state.staticSignature = staticSignature;
    renderStaticLayer(staticGraphics, world, ts, timeSeconds, atmosphere, graphics);
  }

  emitRenderParticles(state, world, timeSeconds, particles, graphics);
  pruneSmokeHistory(state, timeSeconds);
  const highLoad = world.cars.length >= PERFORMANCE_CONFIG.highLoadCars;
  const environmentFps = highLoad
    ? Math.min(graphics.environmentFps, PERFORMANCE_CONFIG.environmentRenderHighLoadFps)
    : graphics.environmentFps;
  const environmentSignature = `${viewLayer}|${atmosphere.period}|${world.getStaticRenderSignature()}|${environmentSettingsKey(graphics)}`;
  if (state.environmentSignature !== environmentSignature
    || shouldRenderTimedLayer(state.lastEnvironmentRenderAt, timeSeconds, environmentFps)) {
    state.environmentSignature = environmentSignature;
    state.lastEnvironmentRenderAt = timeSeconds;
    world.performanceProfiler.time('environmentRenderMs', () => {
      renderEnvironmentLayer(environmentGraphics, world, ts, timeSeconds, atmosphere, viewLayer, graphics);
    });
  }

  world.performanceProfiler.time('vehicleRenderMs', () => {
    renderVehicleLayer(vehicleGraphics, world, ts, timeSeconds, atmosphere, scale, visibleBounds, viewLayer, graphics);
  });
  if (viewLayer === 'surface') world.performanceProfiler.time('airRenderMs', () => drawAirLayer(airGraphics, world, ts, timeSeconds, graphics));
  else airGraphics.clear();

  const overlaySignature = getOverlaySignature(world, heatmapMode, hoverPreview, viewLayer, mobilityFocusMode);
  const overlayFps = highLoad ? PERFORMANCE_CONFIG.overlayRenderHighLoadFps : PERFORMANCE_CONFIG.overlayRenderFps;
  const overlayAnimated = heatmapMode !== 'off' || mobilityFocusMode !== 'off' || world.selected.kind === 'car';
  if (state.overlaySignature !== overlaySignature
    || (overlayAnimated && shouldRenderTimedLayer(state.lastOverlayRenderAt, timeSeconds, overlayFps))) {
    state.overlaySignature = overlaySignature;
    state.lastOverlayRenderAt = timeSeconds;
    world.performanceProfiler.time('overlayRenderMs', () => {
      renderOverlayLayer(overlayGraphics, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, mobilityFocusMode);
    });
  }
}

function applyCamera(container: Container, camX: number, camY: number, scale: number): void {
  container.position.set(camX, camY);
  container.scale.set(scale);
}

function renderStaticLayer(
  layer: Graphics,
  world: GameWorld,
  ts: number,
  timeSeconds: number,
  atmosphere: ReturnType<typeof getAtmosphere>,
  settings: GraphicsSettings,
): void {
  layer.clear();

  for (let y = 0; y < world.grid.length; y++) {
    for (let x = 0; x < (world.grid[y]?.length ?? 0); x++) {
      const tile = world.grid[y]?.[x];
      if (!tile) continue;
      drawBaseTile(layer, tile, x, y, ts);
      if (tile.type === 'mountain' || tile.type === 'lake') drawTerrainFeatureBase(layer, world.grid, tile, x, y, ts, timeSeconds);
      if (tile.type === 'empty' && settings.streetFurniture) drawLotDecoration(layer, x, y, ts);
      if (tile.type === 'road') drawRoad(layer, world.grid, x, y, ts, 'road');
      if (tile.type === 'avenue') drawRoad(layer, world.grid, x, y, ts, 'avenue');
      if (tile.type === 'roundabout') drawRoad(layer, world.grid, x, y, ts, 'roundabout');
      if (tile.type === 'roundaboutCenter') drawRoundaboutIsland(layer, world.grid, x, y, ts);
    }
  }

  for (let y = 0; y < world.grid.length; y++) {
    for (let x = 0; x < (world.grid[y]?.length ?? 0); x++) {
      const tile = world.grid[y]?.[x];
      if (!tile) continue;
      if (isRoadType(tile.type) && tile.type !== 'roundabout') drawRoadSignage(layer, world, x, y, ts);
      if ((tile.type === 'road' || tile.type === 'avenue') && tile.oneWay) drawOneWayArrow(layer, x, y, ts, tile.oneWay, tile.type === 'avenue');
    }
  }

  for (const building of world.buildings) {
    drawBuildingVariant(layer, building, ts, timeSeconds, atmosphere, settings.buildingLights);
    if (!building.connected) {
      layer.circle(building.x * ts + ts - 5, building.y * ts + 5, 4).fill(MAP_COLORS.disconnected);
    }
  }
}

function renderEnvironmentLayer(
  graphics: Graphics,
  world: GameWorld,
  ts: number,
  timeSeconds: number,
  atmosphere: ReturnType<typeof getAtmosphere>,
  viewLayer: ViewLayer,
  settings: GraphicsSettings,
): void {
  graphics.clear();

  if (viewLayer === 'underground') {
    renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);
    return;
  }

  if (settings.terrainAnimations) drawTerrainFeatureAnimation(graphics, world.grid, ts, timeSeconds);

  for (const stop of world.transitStops) {
    drawBusStop(graphics, world, stop.x, stop.y, ts, timeSeconds, atmosphere);
  }

  drawStreetFurniture(graphics, world, ts, timeSeconds, atmosphere, settings);
  if (settings.atmosphereOverlay) drawAtmosphereOverlay(graphics, world, atmosphere, 'off', ts);
  renderMetroLayer(graphics, world, viewLayer, ts, timeSeconds);
  drawHelipads(graphics, world, ts, timeSeconds);
  drawBuildingLife(graphics, world, ts, timeSeconds, atmosphere, settings);
  drawDisconnectedBuildingAlerts(graphics, world, ts, timeSeconds);
  drawTrafficLights(graphics, world, ts, timeSeconds);
}

function renderVehicleLayer(
  graphics: Graphics,
  world: GameWorld,
  ts: number,
  timeSeconds: number,
  atmosphere: ReturnType<typeof getAtmosphere>,
  scale: number,
  visibleBounds: ViewportTileBounds | undefined,
  viewLayer: ViewLayer,
  settings: GraphicsSettings,
): void {
  graphics.clear();
  if (viewLayer === 'underground') return;

  const carCullBounds = visibleBounds ? expandViewportBounds(visibleBounds, 2) : undefined;
  const useVehicleLod = settings.vehicleDetail === 'simplified'
    || (settings.vehicleDetail === 'auto' && (
      scale <= PERFORMANCE_CONFIG.vehicleLodScaleThreshold
      || (world.cars.length >= PERFORMANCE_CONFIG.vehicleLodHighLoadCars && scale <= PERFORMANCE_CONFIG.vehicleLodHighLoadScaleThreshold)
    ));
  let vehicleLodCars = 0;
  for (const car of world.cars) {
    const selectedCar = world.selected.kind === 'car' && world.selected.carId === car.id;
    if (carCullBounds && !selectedCar && !isCarInsideBounds(car, carCullBounds)) continue;
    if (useVehicleLod && !selectedCar && car.vehicleType !== 'bus') {
      drawCarLod(graphics, car, world, ts, atmosphere, settings);
      vehicleLodCars += 1;
    } else {
      drawCar(graphics, car, world, ts, timeSeconds, atmosphere, settings);
    }
  }
  world.performanceProfiler.setCounters({ vehicleLodCars });
  drawBikeTrips(graphics, world, ts, timeSeconds);
}

function renderOverlayLayer(
  graphics: Graphics,
  world: GameWorld,
  heatmapMode: HeatmapMode,
  hoverPreview: HoverPreview | null,
  ts: number,
  timeSeconds: number,
  atmosphere: ReturnType<typeof getAtmosphere>,
  viewLayer: ViewLayer,
  mobilityFocusMode: MobilityFocusMode,
): void {
  graphics.clear();
  if (viewLayer === 'surface') {
    drawHeatmapMode(graphics, world, heatmapMode, ts, atmosphere);
    drawSelectedRoute(graphics, world, ts);
  }
  drawMobilityFocusOverlay(graphics, world, mobilityFocusMode, ts, timeSeconds);

  if (hoverPreview) drawConstructionPreview(graphics, world, hoverPreview, ts, timeSeconds);
  if (world.selected.kind === 'tile') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'road') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'building') drawSelection(graphics, world.selected.building.x, world.selected.building.y, ts);
  if (world.selected.kind === 'busStop') {
    drawBusStopCoverage(graphics, world.selected.stop.x, world.selected.stop.y, ts, 0.09, 0.4);
    drawSelection(graphics, world.selected.stop.x, world.selected.stop.y, ts);
  }
  if (world.selected.kind === 'helipad') {
    drawHelipadCoverage(graphics, world.selected.helipad, ts, 0.06);
    drawSelection(graphics, world.selected.helipad.x, world.selected.helipad.y, ts);
  }
  drawSelectedCarMarker(graphics, world, ts);
  if (world.selected.kind === 'helicopter') {
    const helicopter = world.getHelicopter(world.selected.helicopterId);
    const pose = helicopter ? getHelicopterPose(world, helicopter) : undefined;
    if (pose) graphics.circle(pose.x * ts + ts / 2, pose.y * ts + ts / 2, 14).stroke({ color: MAP_COLORS.selection, width: 2 });
  }
}

function shouldRenderTimedLayer(lastRenderAt: number, timeSeconds: number, fps: number): boolean {
  return timeSeconds - lastRenderAt >= 1 / Math.max(1, fps);
}

function getOverlaySignature(
  world: GameWorld,
  heatmapMode: HeatmapMode,
  hoverPreview: HoverPreview | null,
  viewLayer: ViewLayer,
  mobilityFocusMode: MobilityFocusMode,
): string {
  const selected = world.selected;
  const selectedKey = selected.kind === 'car'
    ? `car:${selected.carId}`
    : selected.kind === 'building'
      ? `building:${selected.building.id}`
      : selected.kind === 'road' || selected.kind === 'tile'
        ? `${selected.kind}:${selected.x},${selected.y}`
        : selected.kind === 'busStop'
          ? `busStop:${selected.stop.id}`
          : selected.kind === 'metroStation'
            ? `metroStation:${selected.station.id}`
            : selected.kind === 'helipad'
              ? `helipad:${selected.helipad.id}`
            : selected.kind;
  const hoverKey = hoverPreview
    ? `${hoverPreview.x},${hoverPreview.y}:${hoverPreview.valid}:${hoverPreview.tool ?? ''}:${hoverPreview.lineTiles?.length ?? 0}`
    : 'none';
  return `${viewLayer}|${heatmapMode}|${mobilityFocusMode}|${selectedKey}|${hoverKey}|${world.getStaticRenderSignature()}`;
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

function emitRenderParticles(
  state: RenderWorldState,
  world: GameWorld,
  timeSeconds: number,
  particles: ParticleSystem | undefined,
  graphics: GraphicsSettings,
): void {
  if (!particles) {
    syncRenderHistory(state, world);
    return;
  }

  if (!state.buildingConnections) {
    state.buildingConnections = new Map(world.buildings.map((building) => [building.id, building.connected]));
  } else {
    for (const building of world.buildings) {
      const wasConnected = state.buildingConnections.get(building.id);
      if (graphics.constructionParticles && wasConnected === false && building.connected) {
        particles.emitConnectionPulse({ x: building.x, y: building.y });
      }
      state.buildingConnections.set(building.id, building.connected);
    }
  }

  if (graphics.congestionSmoke) for (const traffic of world.traffic.values()) {
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

function environmentSettingsKey(settings: GraphicsSettings): string {
  return [
    settings.terrainAnimations,
    settings.streetFurniture,
    settings.streetLights,
    settings.atmosphereOverlay,
    settings.pedestrians,
    settings.buildingLights,
    settings.environmentFps,
  ].map((value) => typeof value === 'boolean' ? Number(value) : value).join(':');
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
