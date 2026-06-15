import type { Container, Graphics } from 'pixi.js';
import type { HeatmapMode, HoverPreview } from '../../store/gameStore';
import { GAME_CONFIG } from '../config/gameConfig';
import type { GameWorld } from '../engine/simulation';
import { isRoadType } from '../city/grid';
import { MAP_COLORS } from './visualTheme';
import { getAtmosphere, drawAtmosphereOverlay, drawBuildingLife, drawStreetFurniture } from './renderEffects';
import { drawBaseTile, drawLotDecoration } from './renderTerrain';
import { drawBusStop, drawBusStopCoverage, drawRoad, drawRoadSignage, drawRoundaboutIsland, drawTrafficLights, drawOneWayArrow } from './renderRoads';
import { drawHeatmapMode } from './renderHeatmap';
import { drawBuildingVariant } from './renderBuildings';
import { drawCar } from './renderVehicles';
import { drawConstructionPreview, drawSelectedCarMarker, drawSelectedRoute, drawSelection } from './renderUiOverlays';

export function renderWorld(
  graphics: Graphics,
  labels: Container,
  world: GameWorld,
  heatmapMode: HeatmapMode,
  hoverPreview: HoverPreview | null,
  camX: number,
  camY: number,
  scale: number,
): void {
  const ts = GAME_CONFIG.tileSize;
  const timeSeconds = performance.now() / 1000;
  const snapshot = world.getSnapshot();
  const atmosphere = getAtmosphere(snapshot.dayPeriod, timeSeconds);
  graphics.clear();
  labels.removeChildren();
  graphics.position.set(camX, camY);
  graphics.scale.set(scale);
  labels.position.set(camX, camY);
  labels.scale.set(scale);

  for (let y = 0; y < GAME_CONFIG.gridHeight; y++) {
    for (let x = 0; x < GAME_CONFIG.gridWidth; x++) {
      const tile = world.grid[y][x];
      drawBaseTile(graphics, tile, x, y, ts);
      if (tile.type === 'empty') drawLotDecoration(graphics, x, y, ts);
      if (tile.type === 'road') drawRoad(graphics, world.grid, x, y, ts, 'road');
      if (tile.type === 'avenue') drawRoad(graphics, world.grid, x, y, ts, 'avenue');
      if (tile.type === 'roundabout') drawRoad(graphics, world.grid, x, y, ts, 'roundabout');
      if (tile.type === 'roundaboutCenter') drawRoundaboutIsland(graphics, world.grid, x, y, ts);
      if (tile.type === 'busStop') drawBusStop(graphics, world, x, y, ts, timeSeconds, atmosphere);
    }
  }

  for (let y = 0; y < GAME_CONFIG.gridHeight; y++) {
    for (let x = 0; x < GAME_CONFIG.gridWidth; x++) {
      const tile = world.grid[y][x];
      if (isRoadType(tile.type) && tile.type !== 'roundabout') drawRoadSignage(graphics, world, x, y, ts);
      if ((tile.type === 'road' || tile.type === 'avenue') && tile.oneWay) drawOneWayArrow(graphics, x, y, ts, tile.oneWay, tile.type === 'avenue');
    }
  }

  drawHeatmapMode(graphics, world, heatmapMode, ts);

  for (const building of world.buildings) {
    drawBuildingVariant(graphics, building, ts, timeSeconds, atmosphere);
    if (!building.connected) {
      graphics.circle(building.x * ts + ts - 5, building.y * ts + 5, 4).fill(MAP_COLORS.disconnected);
    }
  }

  drawStreetFurniture(graphics, world, ts, timeSeconds, atmosphere);
  drawAtmosphereOverlay(graphics, atmosphere, heatmapMode, ts);
  drawBuildingLife(graphics, world, ts, timeSeconds, atmosphere);
  drawTrafficLights(graphics, world, ts, timeSeconds);
  drawSelectedRoute(graphics, world, ts);

  for (const car of world.cars) {
    drawCar(graphics, car, world, ts, timeSeconds);
  }

  if (hoverPreview) drawConstructionPreview(graphics, world, hoverPreview, ts, timeSeconds);
  if (world.selected.kind === 'tile') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'road') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'building') drawSelection(graphics, world.selected.building.x, world.selected.building.y, ts);
  if (world.selected.kind === 'busStop') {
    drawBusStopCoverage(graphics, world.selected.stop.x, world.selected.stop.y, ts, 0.09, 0.4);
    drawSelection(graphics, world.selected.stop.x, world.selected.stop.y, ts);
  }
  drawSelectedCarMarker(graphics, world, ts);
}
