import { useEffect, useRef } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import { GameWorld } from '../engine/simulation';
import { GAME_CONFIG } from '../config/gameConfig';
import { ROAD_CONFIG } from '../config/roadConfig';
import { useGameStore, type HeatmapMode, type HoverPreview } from '../../store/gameStore';
import { inBounds, isRoadType, keyOf } from '../city/grid';
import type { Car } from '../../types/agent.types';
import type { Building, RoadDirection, RoadType, Tile, TrafficLightState, Vec2 } from '../../types/city.types';
import type { Tool } from '../../types/game.types';
import { MAP_COLORS, congestionColor } from './visualTheme';
import { getDirection, getLaneOffset, isIntersection } from '../systems/trafficRules';
import { getTrafficLightSignal, TRAFFIC_LIGHT_BUILD_COST } from '../systems/trafficLights';
import { canPlaceRoundabout, findRoundaboutCenterForTile, getRoundaboutCenter, getRoundaboutRing, isRoundaboutCenter, isRoundaboutTile } from '../systems/roundabouts';

type ActionPreview = HoverPreview & {
  reason?: string;
  successMessage: string;
};

type LotDecor = 'trees' | 'park' | 'parking' | 'garden' | 'plaza' | 'plain';

type CarRenderPose = {
  x: number;
  y: number;
  angle: number;
  turningAmount: number;
  alpha: number;
};

type RoadLineDrag = {
  startTile: Vec2;
  currentTile: Vec2;
  tool: 'road' | 'avenue';
};

type OneWayLineDrag = {
  startTile: Vec2;
  currentTile: Vec2;
};

const TURN_IN_START = 0.64;
const TURN_OUT_END = 0.36;
const SIGNAL_RED = 0xef4444;
const SIGNAL_YELLOW = 0xfacc15;
const SIGNAL_GREEN = 0x22c55e;
const SIGNAL_OFF = 0x172033;

export function PixiGame({ world }: { world: GameWorld }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);
  const isDrawingRef = useRef(false);
  const lastTileRef = useRef<string>('');
  const roadLineDragRef = useRef<RoadLineDrag | null>(null);
  const oneWayLineDragRef = useRef<OneWayLineDrag | null>(null);
  const cameraRef = useRef({ x: 56, y: 42, scale: 0.75 });
  const panningRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const hoverPreview = useGameStore((s) => s.hoverPreview);
  const actionFeedback = useGameStore((s) => s.actionFeedback);
  const heatmapModeUi = useGameStore((s) => s.heatmapMode);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostElement = host;
    let disposed = false;
    let initialized = false;
    const abortController = new AbortController();
    const app = new Application();
    appRef.current = app;

    async function start() {
      await app.init({ background: MAP_COLORS.bg, antialias: true, resizeTo: hostElement });
      initialized = true;
      if (disposed) {
        safelyDestroyPixiApp(app);
        return;
      }
      hostElement.appendChild(app.canvas);
      app.canvas.className = 'game-canvas';

      const root = new Container();
      stageRef.current = root;
      app.stage.addChild(root);

      const graphics = new Graphics();
      const labels = new Container();
      root.addChild(graphics);
      root.addChild(labels);

      const toWorldTile = (clientX: number, clientY: number) => {
        const rect = app.canvas.getBoundingClientRect();
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        const cam = cameraRef.current;
        const worldX = (px - cam.x) / cam.scale;
        const worldY = (py - cam.y) / cam.scale;
        return {
          x: Math.floor(worldX / GAME_CONFIG.tileSize),
          y: Math.floor(worldY / GAME_CONFIG.tileSize),
        };
      };

      const detectCar = (tileX: number, tileY: number) => {
        return world.cars.find((c) => Math.abs(c.x - tileX) < 0.45 && Math.abs(c.y - tileY) < 0.45);
      };

      const applyTool = (tileX: number, tileY: number) => {
        const state = useGameStore.getState();
        const tileKey = keyOf(tileX, tileY);
        if (tileKey === lastTileRef.current) return;
        lastTileRef.current = tileKey;

        if (state.selectedTool === 'inspect') {
          const car = detectCar(tileX, tileY);
          if (car) world.inspectCar(car.id);
          else world.inspectAt(tileX, tileY);
          state.setActionFeedback(null);
          return;
        }
        const preview = { ...getActionPreview(world, tileX, tileY, state.selectedTool, state.stats.money), tool: state.selectedTool };
        const didBuild = world.buildAt(tileX, tileY, state.selectedTool);
        state.setActionFeedback(didBuild ? preview.successMessage : preview.reason ?? 'Ação indisponível neste tile.');
      };

      const updateHover = (clientX: number, clientY: number) => {
        const state = useGameStore.getState();
        const tile = toWorldTile(clientX, clientY);
        const drag = roadLineDragRef.current;
        if (drag) {
          drag.currentTile = tile;
          state.setHoverPreview(getLineBuildPreview(world, getLineTiles(drag.startTile, tile), drag.tool, state.stats.money));
          return;
        }
        const oneWayDrag = oneWayLineDragRef.current;
        if (oneWayDrag) {
          oneWayDrag.currentTile = tile;
          const lineTiles = getLineTiles(oneWayDrag.startTile, tile);
          const direction = getLineDirection(oneWayDrag.startTile, tile);
          state.setHoverPreview(getOneWayPreview(world, lineTiles, direction));
          return;
        }
        state.setHoverPreview({ ...getActionPreview(world, tile.x, tile.y, state.selectedTool, state.stats.money), tool: state.selectedTool });
      };

      app.canvas.addEventListener('pointerdown', (event) => {
        if (event.button === 1 || event.altKey) {
          panningRef.current = { active: true, x: event.clientX, y: event.clientY };
          return;
        }
        isDrawingRef.current = true;
        lastTileRef.current = '';
        const tile = toWorldTile(event.clientX, event.clientY);
        const state = useGameStore.getState();
        if (isRoadLineTool(state.selectedTool)) {
          roadLineDragRef.current = { startTile: tile, currentTile: tile, tool: state.selectedTool };
          state.setHoverPreview(getLineBuildPreview(world, [tile], state.selectedTool, state.stats.money));
          state.setActionFeedback(null);
          return;
        }
        if (state.selectedTool === 'oneWay') {
          oneWayLineDragRef.current = { startTile: tile, currentTile: tile };
          state.setHoverPreview(getOneWayPreview(world, [tile], 'east'));
          state.setActionFeedback(null);
          return;
        }
        updateHover(event.clientX, event.clientY);
        applyTool(tile.x, tile.y);
      }, { signal: abortController.signal });

      window.addEventListener('pointerup', () => {
        const drag = roadLineDragRef.current;
        const oneWayDrag = oneWayLineDragRef.current;
        if (drag) {
          const state = useGameStore.getState();
          const lineTiles = getLineTiles(drag.startTile, drag.currentTile);
          const preview = getLineBuildPreview(world, lineTiles, drag.tool, state.stats.money);
          const result = world.buildRoadLine(lineTiles, drag.tool);
          state.setActionFeedback(result.success
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
        roadLineDragRef.current = null;
        oneWayLineDragRef.current = null;
        isDrawingRef.current = false;
        panningRef.current.active = false;
        lastTileRef.current = '';
      }, { signal: abortController.signal });

      app.canvas.addEventListener('pointermove', (event) => {
        if (panningRef.current.active) {
          const cam = cameraRef.current;
          cam.x += event.clientX - panningRef.current.x;
          cam.y += event.clientY - panningRef.current.y;
          panningRef.current.x = event.clientX;
          panningRef.current.y = event.clientY;
          return;
        }
        updateHover(event.clientX, event.clientY);
        if (!isDrawingRef.current) return;
        if (roadLineDragRef.current) return;
        if (oneWayLineDragRef.current) return;
        const tile = toWorldTile(event.clientX, event.clientY);
        applyTool(tile.x, tile.y);
      }, { signal: abortController.signal });

      app.canvas.addEventListener('pointerleave', () => {
        if (roadLineDragRef.current) return;
        if (oneWayLineDragRef.current) return;
        useGameStore.getState().setHoverPreview(null);
      }, { signal: abortController.signal });

      app.canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        const cam = cameraRef.current;
        const factor = event.deltaY < 0 ? 1.1 : 0.9;
        cam.scale = Math.max(0.45, Math.min(2.2, cam.scale * factor));
      }, { passive: false, signal: abortController.signal });

      app.ticker.add((ticker) => {
        const { paused, speed, heatmapMode, setStats, setSelected } = useGameStore.getState();
        world.update(ticker.deltaMS / 1000, speed, paused);
        setStats(world.getSnapshot());
        setSelected(world.selected);
        const hover = useGameStore.getState().hoverPreview;
        draw(graphics, labels, world, heatmapMode, hover, cameraRef.current.x, cameraRef.current.y, cameraRef.current.scale);
      });
    }

    start();
    return () => {
      disposed = true;
      abortController.abort();
      if (initialized) {
        safelyDestroyPixiApp(app);
      }
      appRef.current = null;
    };
  }, [world]);

  return (
    <main ref={hostRef} className="game-host">
      <div className="canvas-overlay top">
        <span>Alt + arrastar ou botão do meio: mover</span>
        <span>Scroll: zoom</span>
        <span>Clique e arraste: traçar rua/avenida</span>
      </div>
      {hoverPreview && (
        <div className={`tile-preview ${hoverPreview.valid ? 'valid' : 'invalid'}`}>
          <strong>{hoverPreview.label}</strong>
          <span>{hoverPreview.reason ?? (hoverPreview.cost !== undefined ? `$ ${hoverPreview.cost}` : `${hoverPreview.x}, ${hoverPreview.y}`)}</span>
        </div>
      )}
      {actionFeedback && <div className="action-feedback">{actionFeedback}</div>}
      <div className="heatmap-legend" aria-hidden={heatmapModeUi === 'off'}>
        <span>{heatmapLabel(heatmapModeUi)}</span>
        <i className="low" />
        <i className="mid" />
        <i className="high" />
      </div>
    </main>
  );
}

function draw(
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
    }
  }

  for (let y = 0; y < GAME_CONFIG.gridHeight; y++) {
    for (let x = 0; x < GAME_CONFIG.gridWidth; x++) {
      const tile = world.grid[y][x];
      if (isRoadType(tile.type) && tile.type !== 'roundabout') drawRoadSignage(graphics, world, x, y, ts);
      if ((tile.type === 'road' || tile.type === 'avenue') && tile.oneWay) drawOneWayArrow(graphics, x, y, ts, tile.oneWay, tile.type === 'avenue');
    }
  }

  drawTrafficLights(graphics, world, ts, timeSeconds);

  drawHeatmapMode(graphics, world, heatmapMode, ts);

  for (const building of world.buildings) {
    drawBuildingVariant(graphics, building, ts);
    if (!building.connected) {
      graphics.circle(building.x * ts + ts - 5, building.y * ts + 5, 4).fill(MAP_COLORS.disconnected);
    }
  }

  const route = world.getSelectedCarRoute();
  if (route.length) {
    graphics.poly(route.flatMap((p) => [p.x * ts + ts / 2, p.y * ts + ts / 2])).stroke({ color: MAP_COLORS.route, width: 5, alpha: 0.28 });
    graphics.poly(route.flatMap((p) => [p.x * ts + ts / 2, p.y * ts + ts / 2])).stroke({ color: MAP_COLORS.route, width: 2, alpha: 0.9 });
  }

  for (const car of world.cars) {
    drawCar(graphics, car, world, ts, timeSeconds);
  }

  if (hoverPreview) drawConstructionPreview(graphics, world, hoverPreview, ts, timeSeconds);
  if (world.selected.kind === 'tile') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'road') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'building') drawSelection(graphics, world.selected.building.x, world.selected.building.y, ts);
  if (world.selected.kind === 'car') {
    const car = world.getCar(world.selected.carId);
    if (car) {
      const pose = getCarRenderPose(car, world);
      graphics.circle(pose.x * ts + ts / 2, pose.y * ts + ts / 2, 9).stroke({ color: MAP_COLORS.selection, width: 2 });
    }
  }
}

function drawSelection(graphics: Graphics, x: number, y: number, ts: number): void {
  graphics.roundRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2, 5).stroke({ color: MAP_COLORS.selection, width: 2 });
}

function drawBaseTile(graphics: Graphics, tile: Tile, x: number, y: number, ts: number): void {
  const tone = hash2(x, y, 3) % 7;
  const base = tone === 0 ? MAP_COLORS.blockWarm : (x + y) % 2 === 0 ? MAP_COLORS.block : MAP_COLORS.blockAlt;
  graphics.rect(x * ts, y * ts, ts, ts).fill(base).stroke({ width: 1, color: MAP_COLORS.grid, alpha: 0.28 });
  if (tile.type === 'empty') {
    const inset = 5 + (hash2(x, y, 5) % 2);
    graphics.roundRect(x * ts + inset, y * ts + inset, ts - inset * 2, ts - inset * 2, 6).stroke({ width: 1, color: MAP_COLORS.lotStroke, alpha: 0.18 + (tone % 3) * 0.035 });
  }
}

function drawLotDecoration(graphics: Graphics, x: number, y: number, ts: number): void {
  const decor = lotDecorAt(x, y);
  if (decor === 'plain') return;

  const px = x * ts;
  const py = y * ts;
  if (decor === 'trees') {
    drawTree(graphics, px + 13, py + 25, 5);
    drawTree(graphics, px + 25, py + 18, 4);
    if (hash2(x, y, 9) % 2 === 0) drawTree(graphics, px + 28, py + 29, 3.5);
    return;
  }

  if (decor === 'park') {
    graphics.roundRect(px + 7, py + 7, ts - 14, ts - 14, 8).fill({ color: MAP_COLORS.park, alpha: 0.54 });
    graphics.circle(px + 15, py + 17, 4).fill({ color: MAP_COLORS.treeLight, alpha: 0.82 });
    graphics.circle(px + 27, py + 25, 4).fill({ color: MAP_COLORS.tree, alpha: 0.78 });
    graphics.rect(px + 13, py + 29, 14, 2).fill({ color: MAP_COLORS.lotStroke, alpha: 0.28 });
    return;
  }

  if (decor === 'plaza') {
    graphics.roundRect(px + 8, py + 8, ts - 16, ts - 16, 5).fill({ color: MAP_COLORS.plaza, alpha: 0.5 });
    graphics.rect(px + 13, py + 13, ts - 26, 1).fill({ color: MAP_COLORS.parkingLine, alpha: 0.34 });
    graphics.rect(px + 13, py + ts - 14, ts - 26, 1).fill({ color: MAP_COLORS.parkingLine, alpha: 0.34 });
    graphics.circle(px + ts / 2, py + ts / 2, 3).fill({ color: MAP_COLORS.garden, alpha: 0.76 });
    drawTree(graphics, px + 12, py + 27, 3.2);
    return;
  }

  if (decor === 'parking') {
    graphics.roundRect(px + 7, py + 8, ts - 14, ts - 15, 4).fill({ color: MAP_COLORS.parking, alpha: 0.34 });
    for (let i = 0; i < 3; i += 1) {
      graphics.rect(px + 11 + i * 8, py + 12, 1, 18).fill({ color: MAP_COLORS.parkingLine, alpha: 0.42 });
    }
    graphics.rect(px + 10, py + 30, ts - 20, 1).fill({ color: MAP_COLORS.parkingLine, alpha: 0.42 });
    return;
  }

  graphics.roundRect(px + 8, py + 9, ts - 16, ts - 18, 7).fill({ color: MAP_COLORS.garden, alpha: 0.2 });
  graphics.circle(px + 14, py + 17, 2.2).fill({ color: MAP_COLORS.garden, alpha: 0.8 });
  graphics.circle(px + 22, py + 24, 2.2).fill({ color: MAP_COLORS.lane, alpha: 0.72 });
  graphics.circle(px + 29, py + 17, 2).fill({ color: MAP_COLORS.officeGlass, alpha: 0.7 });
}

function drawTree(graphics: Graphics, x: number, y: number, radius: number): void {
  graphics.circle(x + 3, y + 4, radius).fill({ color: MAP_COLORS.shadow, alpha: 0.18 });
  graphics.circle(x + radius * 0.15, y + radius * 0.15, radius * 0.88).fill(MAP_COLORS.treeDark);
  graphics.circle(x, y, radius).fill(MAP_COLORS.tree);
  graphics.circle(x - radius * 0.45, y + radius * 0.15, radius * 0.55).fill(MAP_COLORS.treeLight);
}

function lotDecorAt(x: number, y: number): LotDecor {
  const value = hash2(x, y, 17) % 100;
  if (value < 10) return 'park';
  if (value < 23) return 'trees';
  if (value < 31) return 'parking';
  if (value < 38) return 'plaza';
  if (value < 49) return 'garden';
  return 'plain';
}

function drawRoad(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number, type: RoadType): void {
  const isAvenue = type === 'avenue';
  const isRoundabout = type === 'roundabout';
  const px = x * ts;
  const py = y * ts;
  const roadColor = isAvenue ? MAP_COLORS.avenue : MAP_COLORS.road;
  const edgeColor = isAvenue ? MAP_COLORS.avenueEdge : MAP_COLORS.roadEdge;
  const roadW = isAvenue ? 34 : isRoundabout ? 28 : 24;
  const walkW = Math.min(ts - 4, roadW + 8);
  const halfRoad = roadW / 2;
  const halfWalk = walkW / 2;
  const center = ts / 2;
  const neighbors = roadNeighbors(grid, x, y);

  drawRoadConnectors(graphics, px + 2, py + 3, ts, halfWalk, MAP_COLORS.curbShadow, neighbors);
  graphics.circle(px + center + 2, py + center + 3, halfWalk).fill(MAP_COLORS.curbShadow);

  drawRoadConnectors(graphics, px, py, ts, halfWalk, MAP_COLORS.sidewalk, neighbors);
  graphics.circle(px + center, py + center, halfWalk).fill(MAP_COLORS.sidewalk);

  drawRoadConnectors(graphics, px + 1, py + 2, ts, halfRoad, MAP_COLORS.shadow, neighbors);
  graphics.circle(px + center + 1, py + center + 2, halfRoad).fill({ color: MAP_COLORS.shadow, alpha: 0.24 });

  drawRoadConnectors(graphics, px, py, ts, halfRoad, roadColor, neighbors);
  graphics.circle(px + center, py + center, halfRoad).fill(roadColor).stroke({ color: edgeColor, width: 1, alpha: 0.75 });

  if (isRoundabout) {
    drawRoundaboutMarkings(graphics, grid, x, y, ts);
  } else {
    drawLaneMarkings(graphics, px, py, ts, isAvenue, neighbors);
  }
}

function drawRoundaboutIsland(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number): void {
  const px = x * ts;
  const py = y * ts;
  const center = ts / 2;
  graphics.circle(px + center + 2, py + center + 3, 15).fill({ color: MAP_COLORS.shadow, alpha: 0.22 });
  graphics.circle(px + center, py + center, 16).fill(MAP_COLORS.sidewalk);
  graphics.circle(px + center, py + center, 12).fill({ color: MAP_COLORS.park, alpha: 0.9 });
  graphics.circle(px + center - 4, py + center - 2, 3).fill(MAP_COLORS.tree);
  graphics.circle(px + center + 5, py + center + 4, 2.6).fill(MAP_COLORS.treeLight);

  for (const ring of getRoundaboutRing({ x, y })) {
    if (!isRoundaboutTile(grid[ring.y]?.[ring.x])) continue;
    const rx = ring.x * ts + center;
    const ry = ring.y * ts + center;
    const angle = Math.atan2(ry - (py + center), rx - (px + center)) - Math.PI / 2;
    drawTurnArrow(graphics, rx, ry, angle);
  }
}

function drawRoundaboutMarkings(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number): void {
  const center = getRoundaboutCenter(grid, { x, y });
  if (!center) return;
  const px = x * ts;
  const py = y * ts;
  const localCenterX = center.x * ts + ts / 2;
  const localCenterY = center.y * ts + ts / 2;
  const cx = px + ts / 2;
  const cy = py + ts / 2;
  const angle = Math.atan2(cy - localCenterY, cx - localCenterX) - Math.PI / 2;
  drawTurnArrow(graphics, cx, cy, angle);
}

function drawRoadSignage(graphics: Graphics, world: GameWorld, x: number, y: number, ts: number): void {
  if (!isIntersection(world.grid, { x, y })) return;
  if (world.trafficLights.has(keyOf(x, y))) return;

  const px = x * ts;
  const py = y * ts;
  const center = ts / 2;
  const neighbors = roadNeighbors(world.grid, x, y);
  const markColor = MAP_COLORS.laneSoft;

  drawIntersectionBox(graphics, px, py, ts);

  if (neighbors.west) {
    drawCrosswalk(graphics, px + 5, py + center - 15, false, markColor);
    drawStopMark(graphics, px + 8, py + center + 10, true);
  }
  if (neighbors.east) {
    drawCrosswalk(graphics, px + ts - 11, py + center - 15, false, markColor);
    drawStopMark(graphics, px + ts - 17, py + center - 12, true);
  }
  if (neighbors.north) {
    drawCrosswalk(graphics, px + center - 15, py + 5, true, markColor);
    drawStopMark(graphics, px + center - 12, py + 8, false);
  }
  if (neighbors.south) {
    drawCrosswalk(graphics, px + center - 15, py + ts - 11, true, markColor);
    drawStopMark(graphics, px + center + 10, py + ts - 17, false);
  }
}

function drawIntersectionBox(graphics: Graphics, px: number, py: number, ts: number): void {
  const inset = 11;
  graphics.roundRect(px + inset, py + inset, ts - inset * 2, ts - inset * 2, 5)
    .fill({ color: MAP_COLORS.laneSoft, alpha: 0.08 })
    .stroke({ color: MAP_COLORS.laneSoft, width: 1, alpha: 0.16 });
}

function drawCrosswalk(graphics: Graphics, x: number, y: number, horizontal: boolean, color: number): void {
  for (let i = 0; i < 4; i += 1) {
    if (horizontal) graphics.roundRect(x + i * 7, y, 4, 2, 1).fill({ color, alpha: 0.52 });
    else graphics.roundRect(x, y + i * 7, 2, 4, 1).fill({ color, alpha: 0.52 });
  }
}

function drawStopMark(graphics: Graphics, x: number, y: number, horizontal: boolean): void {
  if (horizontal) graphics.roundRect(x, y, 9, 2, 1).fill({ color: MAP_COLORS.laneSoft, alpha: 0.58 });
  else graphics.roundRect(x, y, 2, 9, 1).fill({ color: MAP_COLORS.laneSoft, alpha: 0.58 });
}

function drawTurnArrow(graphics: Graphics, x: number, y: number, angle: number): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const points = [
    x + dx * 5, y + dy * 5,
    x - dx * 3 + px * 3, y - dy * 3 + py * 3,
    x - dx * 1, y - dy * 1,
    x - dx * 3 - px * 3, y - dy * 3 - py * 3,
  ];
  graphics.poly(points).fill({ color: MAP_COLORS.laneSoft, alpha: 0.62 });
}

function drawTrafficLights(graphics: Graphics, world: GameWorld, ts: number, timeSeconds: number): void {
  for (const light of world.trafficLights.values()) {
    drawTrafficLight(graphics, light, ts, timeSeconds);
  }
}

function drawTrafficLight(graphics: Graphics, light: TrafficLightState, ts: number, timeSeconds: number): void {
  const px = light.x * ts;
  const py = light.y * ts;
  const center = ts / 2;
  const startupBlink = light.startupSeconds > 0 && Math.floor(light.startupSeconds * 3) % 2 === 0;
  const horizontalColor = startupBlink ? SIGNAL_OFF : signalColor(getTrafficLightSignal(light, 'east'));
  const verticalColor = startupBlink ? SIGNAL_OFF : signalColor(getTrafficLightSignal(light, 'north'));
  const phase = (light.x * 0.17) + (light.y * 0.11);

  graphics.circle(px + center, py + center, 6).fill({ color: MAP_COLORS.shadow, alpha: 0.48 });

  drawSignalDot(graphics, px + center - 13, py + 7, verticalColor, timeSeconds, phase);
  drawSignalDot(graphics, px + center + 13, py + ts - 7, verticalColor, timeSeconds, phase + 0.13);
  drawSignalDot(graphics, px + 7, py + center + 13, horizontalColor, timeSeconds, phase + 0.27);
  drawSignalDot(graphics, px + ts - 7, py + center - 13, horizontalColor, timeSeconds, phase + 0.41);
}

function drawSignalDot(graphics: Graphics, x: number, y: number, color: number, timeSeconds: number, phase = 0): void {
  const active = color !== SIGNAL_OFF;
  if (active) {
    const glow = pulse(timeSeconds, 0.9, phase);
    graphics.circle(x, y, 6.8 + glow * 1.7).fill({ color, alpha: 0.08 + glow * 0.09 });
  }
  graphics.circle(x, y, 5).fill(SIGNAL_OFF).stroke({ color: MAP_COLORS.laneSoft, width: 1, alpha: 0.65 });
  graphics.circle(x, y, 3.2).fill({ color, alpha: active ? 0.82 + pulse(timeSeconds, 0.7, phase + 0.3) * 0.18 : 1 });
}

function signalColor(signal: 'green' | 'yellow' | 'red'): number {
  if (signal === 'green') return SIGNAL_GREEN;
  if (signal === 'yellow') return SIGNAL_YELLOW;
  return SIGNAL_RED;
}

function drawHeatmapMode(graphics: Graphics, world: GameWorld, mode: HeatmapMode, ts: number): void {
  if (mode === 'off') return;

  if (mode === 'traffic') {
    for (const t of world.traffic.values()) {
      if (t.congestion <= 0) continue;
      graphics.roundRect(t.x * ts + 5, t.y * ts + 5, ts - 10, ts - 10, 5).fill({ color: congestionColor(t.congestion), alpha: Math.min(0.5, 0.12 + t.congestion * 0.18) });
    }
    return;
  }

  if (mode === 'flow') {
    for (const t of world.traffic.values()) {
      if (t.cars <= 0) continue;
      const intensity = Math.min(1, t.cars / Math.max(1, t.capacity));
      graphics.roundRect(t.x * ts + 6, t.y * ts + 6, ts - 12, ts - 12, 5).fill({ color: MAP_COLORS.route, alpha: 0.12 + intensity * 0.38 });
    }
    return;
  }

  const citySatisfaction = world.getSnapshot().satisfaction;
  const cityColor = citySatisfaction >= 70 ? MAP_COLORS.treeLight : citySatisfaction >= 40 ? MAP_COLORS.lane : MAP_COLORS.disconnected;
  for (const building of world.buildings) {
    const nearbyCongestion = nearbyTrafficCongestion(world, building.x, building.y);
    const localStress = building.connected ? nearbyCongestion : 1.2;
    const color = localStress > 0.9 || !building.connected ? MAP_COLORS.disconnected : cityColor;
    graphics.roundRect(building.x * ts + 4, building.y * ts + 4, ts - 8, ts - 8, 6).fill({ color, alpha: Math.min(0.45, 0.16 + localStress * 0.18) });
  }
}

function nearbyTrafficCongestion(world: GameWorld, x: number, y: number): number {
  let max = 0;
  for (const next of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
    const traffic = world.traffic.get(keyOf(next.x, next.y));
    if (traffic) max = Math.max(max, traffic.congestion);
  }
  return max;
}

function heatmapLabel(mode: HeatmapMode): string {
  if (mode === 'traffic') return 'Trânsito';
  if (mode === 'satisfaction') return 'Satisfação';
  if (mode === 'flow') return 'Fluxo';
  return 'Heatmap';
}

function drawBuildingVariant(graphics: Graphics, building: Building, ts: number): void {
  const { type, x, y, connected } = building;
  const px = x * ts;
  const py = y * ts;
  const variant = hash2(x, y, type.length);
  const activity = Math.min(1, (building.population + building.jobs + building.attraction) / 16);
  const growth = building.level - 1;
  graphics.roundRect(px + 7, py + 8, ts - 7, ts - 7, 5).fill({ color: MAP_COLORS.buildingShadow, alpha: 0.22 + activity * 0.16 });
  if (type === 'house') {
    const roofShift = variant % 2 === 0 ? 0 : 3;
    const bodyInset = growth === 2 ? 3 : growth === 1 ? 5 : 6;
    const roofTop = growth === 2 ? py + 2 : py + 4;
    if (growth < 2) {
      graphics.poly([px + bodyInset - 1, py + 14, px + ts / 2 + roofShift, roofTop, px + ts - bodyInset + 1, py + 14]).fill(MAP_COLORS.houseRoof);
      graphics.poly([px + ts - bodyInset + 1, py + 14, px + ts / 2 + roofShift, roofTop, px + ts / 2 + roofShift + 5, py + 15]).fill({ color: MAP_COLORS.shadow, alpha: 0.16 });
    } else {
      graphics.roundRect(px + bodyInset, py + 5, ts - bodyInset * 2, 7, 2).fill(MAP_COLORS.houseRoof);
    }
    graphics.roundRect(px + bodyInset, py + (growth === 2 ? 9 : 13), ts - bodyInset * 2, ts - 16 + growth * 2, 3).fill(MAP_COLORS.house);
    graphics.rect(px + bodyInset + 6, py + 21, 5, 7).fill({ color: MAP_COLORS.carWindow, alpha: 0.42 + activity * 0.34 });
    graphics.rect(px + ts - bodyInset - 11, py + 18, 6, 5).fill({ color: MAP_COLORS.laneSoft, alpha: 0.34 + activity * 0.42 });
    if (growth > 0) graphics.rect(px + ts / 2 - 4, py + 25, 8, 7).fill({ color: MAP_COLORS.houseTrim, alpha: 0.72 });
    if (growth === 2) {
      graphics.rect(px + 11, py + 13, 4, 3).fill({ color: MAP_COLORS.laneSoft, alpha: 0.75 });
      graphics.rect(px + 25, py + 13, 4, 3).fill({ color: MAP_COLORS.laneSoft, alpha: 0.75 });
    }
  } else if (type === 'shop') {
    const heightBoost = growth * 2;
    graphics.roundRect(px + 5, py + 6 - heightBoost, ts - 10, ts - 10 + heightBoost, 3).fill(MAP_COLORS.shop);
    graphics.rect(px + 7, py + 8 - heightBoost, ts - 14, 4).fill(MAP_COLORS.shopSign);
    for (let i = 0; i < 4; i += 1) {
      graphics.rect(px + 6 + i * 7, py + 12 - heightBoost, 5, 4).fill(i % 2 === 0 ? MAP_COLORS.shopAwning : MAP_COLORS.laneSoft);
    }
    graphics.rect(px + 9, py + 18, ts - 18, 6).fill({ color: MAP_COLORS.shopGlass, alpha: 0.4 + activity * 0.35 });
    graphics.rect(px + 16, py + 26, 8, 7).fill({ color: MAP_COLORS.shadow, alpha: 0.22 });
    if (growth === 2) graphics.rect(px + 10, py + 28, ts - 20, 2).fill({ color: MAP_COLORS.shopAwning, alpha: 0.78 });
  } else {
    const floors = 3 + (variant % 2) + growth;
    const top = py + 6 - growth * 2;
    const height = ts - 9 + growth * 2;
    graphics.roundRect(px + 5, top, ts - 10, height, 3).fill(MAP_COLORS.office);
    graphics.rect(px + ts - 11, top + 4, 4, height - 8).fill({ color: MAP_COLORS.officeDark, alpha: 0.38 });
    for (let row = 0; row < floors; row += 1) {
      const yy = top + 4 + row * 5;
      graphics.rect(px + 8, yy, 3, 2).fill({ color: MAP_COLORS.officeGlass, alpha: 0.55 + activity * 0.35 });
      graphics.rect(px + 14, yy, 3, 2).fill({ color: MAP_COLORS.officeGlass, alpha: 0.55 + activity * 0.35 });
      graphics.rect(px + 22, yy, 3, 2).fill({ color: MAP_COLORS.officeGlass, alpha: 0.45 + activity * 0.3 });
    }
    graphics.rect(px + 7, py + ts - 8, ts - 14, 2).fill({ color: MAP_COLORS.officeDark, alpha: 0.5 });
  }
  drawBuildingLevelBadge(graphics, px, py, building.level);
  graphics.roundRect(px + 4, py + 4, ts - 8, ts - 8, 4).stroke({ color: connected ? MAP_COLORS.lotStroke : MAP_COLORS.disconnected, width: connected ? 1 : 3, alpha: connected ? 0.8 : 1 });
}

function drawBuildingLevelBadge(graphics: Graphics, px: number, py: number, level: number): void {
  const badgeX = px + 7;
  const badgeY = py + 31;
  graphics.roundRect(badgeX - 2, badgeY - 2, 14, 6, 3).fill({ color: MAP_COLORS.shadow, alpha: 0.32 });
  for (let i = 0; i < level; i += 1) {
    graphics.rect(badgeX + i * 4, badgeY, 2, 3).fill({ color: MAP_COLORS.laneSoft, alpha: 0.9 });
  }
}

function drawCar(graphics: Graphics, car: Car, world: GameWorld, ts: number, timeSeconds: number): void {
  const pose = getCarRenderPose(car, world);
  const cx = pose.x * ts + ts / 2;
  const cy = pose.y * ts + ts / 2;
  const length = 13;
  const width = 7;
  const color = car.trafficState === 'intersection'
    ? blendCarStateColor(carDestinationColor(world, car), MAP_COLORS.carAltC)
    : car.trafficState === 'queued'
      ? blendCarStateColor(carDestinationColor(world, car), MAP_COLORS.carAltA)
      : carDestinationColor(world, car);
  if (car.lifecyclePhase === 'driving' && (car.trafficState === 'queued' || car.trafficState === 'intersection')) {
    const halo = car.trafficState === 'queued' ? MAP_COLORS.carTail : MAP_COLORS.lane;
    graphics.circle(cx, cy, 7.5).fill({ color: halo, alpha: car.trafficState === 'queued' ? 0.16 : 0.2 });
  }
  drawCapsule(graphics, cx + 3, cy + 4, length, width, pose.angle, MAP_COLORS.shadow, 0.28 * pose.alpha);
  drawCapsule(graphics, cx, cy, length, width, pose.angle, color, pose.alpha, MAP_COLORS.roadEdge);
  drawRotatedRect(graphics, cx + Math.cos(pose.angle) * 1.8, cy + Math.sin(pose.angle) * 1.8, 4.2, 3.2, pose.angle, MAP_COLORS.carWindow, 0.88 * pose.alpha);
  drawCarLights(graphics, car, cx, cy, length, width, pose.angle, timeSeconds, pose.alpha);
}

function drawCarLights(graphics: Graphics, car: Car, cx: number, cy: number, length: number, width: number, angle: number, timeSeconds: number, alpha = 1): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const frontX = cx + dx * (length / 2 - 1.2);
  const frontY = cy + dy * (length / 2 - 1.2);
  const backX = cx - dx * (length / 2 - 1.5);
  const backY = cy - dy * (length / 2 - 1.5);
  const queuedPulse = car.trafficState === 'queued' ? pulse(timeSeconds, 1.15, idPhase(car.id)) : 1;
  const lightAlpha = (car.trafficState === 'queued' ? 0.55 + queuedPulse * 0.45 : 0.88) * alpha;
  const tailAlpha = (car.trafficState === 'queued' ? 0.5 + queuedPulse * 0.5 : 0.86) * alpha;
  const lightRadius = car.trafficState === 'queued' ? 1.05 + queuedPulse * 0.45 : 1.15;
  const tailRadius = car.trafficState === 'queued' ? 0.85 + queuedPulse * 0.3 : 0.95;
  graphics.circle(frontX + px * (width * 0.22), frontY + py * (width * 0.22), lightRadius).fill({ color: MAP_COLORS.carLight, alpha: lightAlpha });
  graphics.circle(frontX - px * (width * 0.22), frontY - py * (width * 0.22), lightRadius).fill({ color: MAP_COLORS.carLight, alpha: lightAlpha });
  graphics.circle(backX + px * (width * 0.2), backY + py * (width * 0.2), tailRadius).fill({ color: MAP_COLORS.carTail, alpha: tailAlpha });
  graphics.circle(backX - px * (width * 0.2), backY - py * (width * 0.2), tailRadius).fill({ color: MAP_COLORS.carTail, alpha: tailAlpha });
}

function carDestinationColor(world: GameWorld, car: Car): number {
  const destination = world.getBuilding(car.destinationBuildingId)?.type;
  if (destination === 'house') return MAP_COLORS.carHouse;
  if (destination === 'shop') return MAP_COLORS.carShop;
  if (destination === 'office') return MAP_COLORS.carOffice;
  return carColor(car.id);
}

function blendCarStateColor(base: number, overlay: number): number {
  const br = (base >> 16) & 255;
  const bg = (base >> 8) & 255;
  const bb = base & 255;
  const or = (overlay >> 16) & 255;
  const og = (overlay >> 8) & 255;
  const ob = overlay & 255;
  return ((Math.round(br * 0.65 + or * 0.35) << 16)
    | (Math.round(bg * 0.65 + og * 0.35) << 8)
    | Math.round(bb * 0.65 + ob * 0.35));
}

function getCarRenderPose(car: Car, world: GameWorld): CarRenderPose {
  const grid = world.grid;
  if (car.lifecyclePhase === 'spawnExit') {
    const pose = getLifecyclePose(car, world, 'spawnExit');
    if (pose) return pose;
  }
  if (car.lifecyclePhase === 'destinationEntry') {
    const pose = getLifecyclePose(car, world, 'destinationEntry');
    if (pose) return pose;
  }

  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  if (!current || !next) return { x: car.x, y: car.y, angle: directionAngle(car.direction), turningAmount: 0, alpha: 1 };

  const after = car.route[car.routeIndex + 2];
  if (after && isRouteTurn(current, next, after) && car.progressToNext >= TURN_IN_START) {
    const curve = buildTurnCurve(car, grid, current, next, after);
    const t = ((car.progressToNext - TURN_IN_START) / (1 - TURN_IN_START)) * 0.5;
    return poseOnCurve(curve, t);
  }

  const previous = car.route[car.routeIndex - 1];
  if (previous && isRouteTurn(previous, current, next) && car.progressToNext <= TURN_OUT_END) {
    const curve = buildTurnCurve(car, grid, previous, current, next);
    const t = 0.5 + (car.progressToNext / TURN_OUT_END) * 0.5;
    return poseOnCurve(curve, t);
  }

  const offset = laneOffsetForSegment(car, grid, current, next);
  return {
    x: current.x + (next.x - current.x) * car.progressToNext + offset.x,
    y: current.y + (next.y - current.y) * car.progressToNext + offset.y,
    angle: Math.atan2(next.y - current.y, next.x - current.x),
    turningAmount: 0,
    alpha: 1,
  };
}

function getLifecyclePose(car: Car, world: GameWorld, phase: 'spawnExit' | 'destinationEntry'): CarRenderPose | undefined {
  const building = world.getBuilding(phase === 'spawnExit' ? car.originBuildingId : car.destinationBuildingId);
  if (!building) return undefined;

  const t = smoothStep(Math.max(0, Math.min(1, car.lifecycleProgress)));
  if (phase === 'spawnExit') {
    const from = buildingPoint(building);
    const routeStart = car.route[0];
    const routeNext = car.route[1];
    if (!routeStart || !routeNext) return undefined;
    const roadPoint = {
      x: routeStart.x + car.laneOffset.x,
      y: routeStart.y + car.laneOffset.y,
    };
    const direction = getDirection(routeStart, routeNext);
    const curve = {
      p0: from,
      p1: {
        x: roadPoint.x - Math.cos(directionAngle(direction)) * 0.3,
        y: roadPoint.y - Math.sin(directionAngle(direction)) * 0.3,
      },
      p2: roadPoint,
    };
    return { ...poseOnCurve(curve, t), alpha: 0.65 + t * 0.35 };
  }

  const routeEnd = car.route[car.route.length - 1];
  const routePrevious = car.route[car.route.length - 2];
  if (!routeEnd || !routePrevious) return undefined;
  const offset = laneOffsetForSegment(car, world.grid, routePrevious, routeEnd);
  const roadPoint = {
    x: routeEnd.x + offset.x,
    y: routeEnd.y + offset.y,
  };
  const to = buildingPoint(building);
  const approachAngle = Math.atan2(routeEnd.y - routePrevious.y, routeEnd.x - routePrevious.x);
  const curve = {
    p0: roadPoint,
    p1: {
      x: roadPoint.x + Math.cos(approachAngle) * 0.24,
      y: roadPoint.y + Math.sin(approachAngle) * 0.24,
    },
    p2: to,
  };
  return { ...poseOnCurve(curve, t), alpha: 1 - t * 0.25 };
}

function buildingPoint(building: Building): Vec2 {
  return { x: building.x, y: building.y };
}

function buildTurnCurve(car: Car, grid: Tile[][], from: Vec2, corner: Vec2, to: Vec2): { p0: Vec2; p1: Vec2; p2: Vec2 } {
  const incomingOffset = laneOffsetForSegment(car, grid, from, corner);
  const outgoingOffset = laneOffsetForSegment(car, grid, corner, to);
  return {
    p0: {
      x: from.x + (corner.x - from.x) * TURN_IN_START + incomingOffset.x,
      y: from.y + (corner.y - from.y) * TURN_IN_START + incomingOffset.y,
    },
    p1: { x: corner.x, y: corner.y },
    p2: {
      x: corner.x + (to.x - corner.x) * TURN_OUT_END + outgoingOffset.x,
      y: corner.y + (to.y - corner.y) * TURN_OUT_END + outgoingOffset.y,
    },
  };
}

function poseOnCurve(curve: { p0: Vec2; p1: Vec2; p2: Vec2 }, rawT: number): CarRenderPose {
  const t = Math.max(0, Math.min(1, rawT));
  const mt = 1 - t;
  const x = mt * mt * curve.p0.x + 2 * mt * t * curve.p1.x + t * t * curve.p2.x;
  const y = mt * mt * curve.p0.y + 2 * mt * t * curve.p1.y + t * t * curve.p2.y;
  const dx = 2 * mt * (curve.p1.x - curve.p0.x) + 2 * t * (curve.p2.x - curve.p1.x);
  const dy = 2 * mt * (curve.p1.y - curve.p0.y) + 2 * t * (curve.p2.y - curve.p1.y);
  return { x, y, angle: Math.atan2(dy, dx), turningAmount: Math.sin(Math.PI * t), alpha: 1 };
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

function laneOffsetForSegment(car: Car, grid: Tile[][], from: Vec2, to: Vec2): Vec2 {
  return getLaneOffset(getDirection(from, to), roadTypeAt(grid, from), car.id).offset;
}

function roadTypeAt(grid: Tile[][], pos: Vec2): RoadType {
  const type = grid[pos.y]?.[pos.x]?.type;
  if (type === 'avenue' || type === 'roundabout') return type;
  return 'road';
}

function isRouteTurn(from: Vec2, corner: Vec2, to: Vec2): boolean {
  return getDirection(from, corner) !== getDirection(corner, to);
}

function directionAngle(direction: Car['direction']): number {
  if (direction === 'west') return Math.PI;
  if (direction === 'north') return -Math.PI / 2;
  if (direction === 'south') return Math.PI / 2;
  return 0;
}

function drawCapsule(
  graphics: Graphics,
  cx: number,
  cy: number,
  length: number,
  width: number,
  angle: number,
  color: number,
  alpha = 1,
  strokeColor?: number,
): void {
  const radius = width / 2;
  const halfStraight = Math.max(0, (length - width) / 2);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const front = { x: cx + dx * halfStraight, y: cy + dy * halfStraight };
  const back = { x: cx - dx * halfStraight, y: cy - dy * halfStraight };
  const body = [
    back.x + px * radius, back.y + py * radius,
    front.x + px * radius, front.y + py * radius,
    front.x - px * radius, front.y - py * radius,
    back.x - px * radius, back.y - py * radius,
  ];

  graphics.poly(body).fill({ color, alpha });
  graphics.circle(front.x, front.y, radius).fill({ color, alpha });
  graphics.circle(back.x, back.y, radius).fill({ color, alpha });
  if (strokeColor !== undefined) {
    graphics.poly(body).stroke({ color: strokeColor, width: 1, alpha: 0.55 });
    graphics.circle(front.x, front.y, radius).stroke({ color: strokeColor, width: 1, alpha: 0.55 });
    graphics.circle(back.x, back.y, radius).stroke({ color: strokeColor, width: 1, alpha: 0.55 });
  }
}

function drawRotatedRect(graphics: Graphics, cx: number, cy: number, width: number, height: number, angle: number, color: number, alpha = 1): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const hw = width / 2;
  const hh = height / 2;
  graphics.poly([
    cx - dx * hw - px * hh, cy - dy * hw - py * hh,
    cx + dx * hw - px * hh, cy + dy * hw - py * hh,
    cx + dx * hw + px * hh, cy + dy * hw + py * hh,
    cx - dx * hw + px * hh, cy - dy * hw + py * hh,
  ]).fill({ color, alpha });
}

function roadNeighbors(grid: Tile[][], x: number, y: number): Record<'north' | 'south' | 'east' | 'west', boolean> {
  const hasRoad = (tx: number, ty: number) => isRoadType(grid[ty]?.[tx]?.type);
  return {
    north: hasRoad(x, y - 1),
    south: hasRoad(x, y + 1),
    east: hasRoad(x + 1, y),
    west: hasRoad(x - 1, y),
  };
}

function drawRoadConnectors(
  graphics: Graphics,
  px: number,
  py: number,
  ts: number,
  halfWidth: number,
  color: number,
  neighbors: Record<'north' | 'south' | 'east' | 'west', boolean>,
): void {
  const center = ts / 2;
  if (neighbors.west) graphics.rect(px, py + center - halfWidth, center, halfWidth * 2).fill(color);
  if (neighbors.east) graphics.rect(px + center, py + center - halfWidth, center, halfWidth * 2).fill(color);
  if (neighbors.north) graphics.rect(px + center - halfWidth, py, halfWidth * 2, center).fill(color);
  if (neighbors.south) graphics.rect(px + center - halfWidth, py + center, halfWidth * 2, center).fill(color);
}

function drawLaneMarkings(
  graphics: Graphics,
  px: number,
  py: number,
  ts: number,
  isAvenue: boolean,
  neighbors: Record<'north' | 'south' | 'east' | 'west', boolean>,
): void {
  const horizontal = neighbors.east || neighbors.west;
  const vertical = neighbors.north || neighbors.south;
  const center = ts / 2;
  if (horizontal) drawDashedLine(graphics, px + 5, py + center - 1, ts - 10, true, MAP_COLORS.lane);
  if (vertical) drawDashedLine(graphics, px + center - 1, py + 5, ts - 10, false, MAP_COLORS.lane);
  if (isAvenue && horizontal) {
    drawDashedLine(graphics, px + 6, py + center - 11, ts - 12, true, MAP_COLORS.laneSoft, 0.52);
    drawDashedLine(graphics, px + 6, py + center + 9, ts - 12, true, MAP_COLORS.laneSoft, 0.52);
  }
  if (isAvenue && vertical) {
    drawDashedLine(graphics, px + center - 11, py + 6, ts - 12, false, MAP_COLORS.laneSoft, 0.52);
    drawDashedLine(graphics, px + center + 9, py + 6, ts - 12, false, MAP_COLORS.laneSoft, 0.52);
  }
}

function drawDashedLine(graphics: Graphics, x: number, y: number, length: number, horizontal: boolean, color: number, alpha = 0.82): void {
  const dash = 5;
  const gap = 5;
  for (let offset = 0; offset < length; offset += dash + gap) {
    const size = Math.min(dash, length - offset);
    if (horizontal) graphics.rect(x + offset, y, size, 2).fill({ color, alpha });
    else graphics.rect(x, y + offset, 2, size).fill({ color, alpha });
  }
}

function carColor(id: string): number {
  const colors = [MAP_COLORS.carBody, MAP_COLORS.carAltA, MAP_COLORS.carAltB, MAP_COLORS.carAltC];
  let total = 0;
  for (let i = 0; i < id.length; i += 1) total += id.charCodeAt(i);
  return colors[total % colors.length];
}

function hash2(x: number, y: number, salt = 0): number {
  let value = Math.imul(x + 101, 374761393) ^ Math.imul(y + 17, 668265263) ^ Math.imul(salt + 31, 2246822519);
  value = (value ^ (value >>> 13)) >>> 0;
  return value;
}

function pulse(timeSeconds: number, speed: number, phase = 0): number {
  return (Math.sin((timeSeconds * speed + phase) * Math.PI * 2) + 1) / 2;
}

function idPhase(id: string): number {
  let total = 0;
  for (let i = 0; i < id.length; i += 1) total += id.charCodeAt(i) * (i + 1);
  return (total % 997) / 997;
}

function isRoadLineTool(tool: Tool): tool is 'road' | 'avenue' {
  return tool === 'road' || tool === 'avenue';
}

function getLineTiles(start: Vec2, end: Vec2): Vec2[] {
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

function getLineBuildPreview(world: GameWorld, tiles: Vec2[], tool: 'road' | 'avenue', money: number): ActionPreview {
  const uniqueTiles = dedupePreviewTiles(tiles);
  const invalidTiles: Vec2[] = [];
  let buildableTiles = 0;
  let reason: string | undefined;

  for (const pos of uniqueTiles) {
    if (!inBounds(pos.x, pos.y)) {
      invalidTiles.push(pos);
      reason ??= 'A linha sai do mapa.';
      continue;
    }

    const tile = world.grid[pos.y][pos.x];
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

  const cost = buildableTiles * ROAD_CONFIG[tool].buildCost;
  if (!reason && buildableTiles === 0) reason = 'Essa via já existe em toda a linha.';
  if (!reason && money < cost) reason = `Faltam $ ${cost - money} para construir.`;

  const label = `${tool === 'road' ? 'Construir rua' : 'Construir avenida'}: ${uniqueTiles.length} tiles`;
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
    successMessage: `${tool === 'road' ? 'Rua' : 'Avenida'} construída: ${buildableTiles} tiles por $ ${cost}.`,
  };
}

function dedupePreviewTiles(tiles: Vec2[]): Vec2[] {
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

function drawConstructionPreview(graphics: Graphics, world: GameWorld, preview: HoverPreview, ts: number, timeSeconds: number): void {
  const { x, y, valid, tool } = preview;
  if (preview.lineTiles?.length && tool && isRoadLineTool(tool)) {
    drawRoadLinePreview(graphics, preview, tool, ts, timeSeconds);
    return;
  }
  if (preview.lineTiles?.length && tool === 'oneWay' && preview.oneWayDirection) {
    drawOneWayLinePreview(graphics, preview, preview.oneWayDirection, ts, timeSeconds);
    return;
  }
  if (!inBounds(x, y)) return;
  const color = valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;
  const px = x * ts;
  const py = y * ts;
  const previewPulse = pulse(timeSeconds, valid ? 1.2 : 1.75, x * 0.19 + y * 0.13);

  if (tool === 'roundabout') {
    const areaPx = (x - 1) * ts;
    const areaPy = (y - 1) * ts;
    graphics.roundRect(areaPx + 2, areaPy + 2, ts * 3 - 4, ts * 3 - 4, 10)
      .fill({ color, alpha: valid ? 0.08 + previewPulse * 0.06 : 0.15 + previewPulse * 0.06 })
      .stroke({ color, width: 2 + previewPulse, alpha: valid ? 0.76 : 0.88 });
    graphics.circle(px + ts / 2, py + ts / 2, ts * 0.44).fill({ color: MAP_COLORS.park, alpha: valid ? 0.42 : 0.2 });
    graphics.circle(px + ts / 2, py + ts / 2, ts * 1.05).stroke({ color: valid ? MAP_COLORS.road : color, width: 12, alpha: valid ? 0.34 : 0.22 });
    if (!valid && preview.reason) {
      graphics.rect(areaPx + 9, areaPy + ts * 3 - 13, ts * 3 - 18, 4).fill({ color: MAP_COLORS.previewInvalid, alpha: 0.86 });
    }
    return;
  }

  const outerInset = 2 - previewPulse * 1.2;
  graphics.roundRect(px + outerInset, py + outerInset, ts - outerInset * 2, ts - outerInset * 2, 5)
    .fill({ color, alpha: valid ? 0.1 + previewPulse * 0.07 : 0.16 + previewPulse * 0.06 })
    .stroke({ color, width: 1.6 + previewPulse * 1.1, alpha: valid ? 0.68 + previewPulse * 0.28 : 0.76 + previewPulse * 0.2 });
  graphics.roundRect(px + 7, py + 7, ts - 14, ts - 14, 5).stroke({ color, width: 1, alpha: valid ? 0.4 + previewPulse * 0.25 : 0.56 + previewPulse * 0.22 });

  if (tool === 'road' || tool === 'avenue') {
    const roadW = tool === 'avenue' ? 30 : 21;
    graphics.roundRect(px + ts / 2 - roadW / 2, py + 5, roadW, ts - 10, 6).fill({ color: valid ? MAP_COLORS.road : MAP_COLORS.previewInvalid, alpha: valid ? 0.38 + previewPulse * 0.1 : 0.22 + previewPulse * 0.06 });
    graphics.roundRect(px + 5, py + ts / 2 - roadW / 2, ts - 10, roadW, 6).fill({ color: valid ? MAP_COLORS.road : MAP_COLORS.previewInvalid, alpha: valid ? 0.16 + previewPulse * 0.07 : 0.1 + previewPulse * 0.05 });
  } else if (tool === 'trafficLight') {
    graphics.circle(px + ts / 2, py + ts / 2, 8.5 + previewPulse * 1.6).fill({ color, alpha: 0.1 + previewPulse * 0.1 });
    graphics.circle(px + ts / 2, py + ts / 2, 7).fill({ color: valid ? SIGNAL_GREEN : SIGNAL_RED, alpha: 0.68 + previewPulse * 0.18 });
    graphics.circle(px + ts / 2, py + ts / 2, 3).fill(SIGNAL_OFF);
  } else if (tool === 'remove') {
    graphics.moveTo(px + 10, py + 10).lineTo(px + ts - 10, py + ts - 10).stroke({ color, width: 3, alpha: 0.85 });
    graphics.moveTo(px + ts - 10, py + 10).lineTo(px + 10, py + ts - 10).stroke({ color, width: 3, alpha: 0.85 });
  } else if (tool === 'inspect') {
    const car = world.cars.find((c) => Math.abs(c.x - x) < 0.45 && Math.abs(c.y - y) < 0.45);
    if (car) graphics.circle(px + ts / 2, py + ts / 2, 10).stroke({ color: MAP_COLORS.selection, width: 2, alpha: 0.9 });
  }

  if (!valid && preview.reason) {
    graphics.rect(px + 7, py + ts - 10, ts - 14, 3).fill({ color: MAP_COLORS.previewInvalid, alpha: 0.86 });
  }
}

function drawRoadLinePreview(graphics: Graphics, preview: HoverPreview, tool: 'road' | 'avenue', ts: number, timeSeconds: number): void {
  const lineTiles = preview.lineTiles ?? [];
  const visibleTiles = lineTiles.filter((tile) => inBounds(tile.x, tile.y));
  if (!visibleTiles.length) return;

  const previewPulse = pulse(timeSeconds, preview.valid ? 1.15 : 1.7, (preview.x * 0.19) + (preview.y * 0.13));
  const color = preview.valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;
  const roadColor = preview.valid ? (tool === 'avenue' ? MAP_COLORS.avenue : MAP_COLORS.road) : MAP_COLORS.previewInvalid;
  const roadW = tool === 'avenue' ? 32 : 23;
  const minX = Math.min(...visibleTiles.map((tile) => tile.x));
  const maxX = Math.max(...visibleTiles.map((tile) => tile.x));
  const minY = Math.min(...visibleTiles.map((tile) => tile.y));
  const maxY = Math.max(...visibleTiles.map((tile) => tile.y));
  const horizontal = minY === maxY;

  graphics.roundRect(
    minX * ts + 2,
    minY * ts + 2,
    (maxX - minX + 1) * ts - 4,
    (maxY - minY + 1) * ts - 4,
    9,
  ).fill({ color, alpha: preview.valid ? 0.08 + previewPulse * 0.05 : 0.13 + previewPulse * 0.06 })
    .stroke({ color, width: 1.5 + previewPulse, alpha: preview.valid ? 0.56 + previewPulse * 0.28 : 0.72 + previewPulse * 0.2 });

  if (horizontal) {
    const y = minY * ts + ts / 2 - roadW / 2;
    graphics.roundRect(minX * ts + 4, y, (maxX - minX + 1) * ts - 8, roadW, 9)
      .fill({ color: roadColor, alpha: preview.valid ? 0.45 + previewPulse * 0.12 : 0.28 + previewPulse * 0.08 });
  } else {
    const x = minX * ts + ts / 2 - roadW / 2;
    graphics.roundRect(x, minY * ts + 4, roadW, (maxY - minY + 1) * ts - 8, 9)
      .fill({ color: roadColor, alpha: preview.valid ? 0.45 + previewPulse * 0.12 : 0.28 + previewPulse * 0.08 });
  }

  const invalidKeys = new Set((preview.invalidTiles ?? []).map((tile) => keyOf(tile.x, tile.y)));
  for (const tile of visibleTiles) {
    const px = tile.x * ts;
    const py = tile.y * ts;
    const invalid = invalidKeys.has(keyOf(tile.x, tile.y));
    graphics.roundRect(px + 5, py + 5, ts - 10, ts - 10, 5)
      .stroke({ color: invalid ? MAP_COLORS.previewInvalid : MAP_COLORS.previewValid, width: invalid ? 2 : 1, alpha: invalid ? 0.92 : 0.44 });
    if (invalid) {
      graphics.moveTo(px + 12, py + 12).lineTo(px + ts - 12, py + ts - 12).stroke({ color: MAP_COLORS.previewInvalid, width: 2.5, alpha: 0.9 });
      graphics.moveTo(px + ts - 12, py + 12).lineTo(px + 12, py + ts - 12).stroke({ color: MAP_COLORS.previewInvalid, width: 2.5, alpha: 0.9 });
    }
  }
}

function drawOneWayLinePreview(graphics: Graphics, preview: HoverPreview, direction: RoadDirection, ts: number, timeSeconds: number): void {
  const lineTiles = preview.lineTiles ?? [];
  const visibleTiles = lineTiles.filter((tile) => inBounds(tile.x, tile.y));
  if (!visibleTiles.length) return;

  const previewPulse = pulse(timeSeconds, preview.valid ? 1.1 : 1.7, preview.x * 0.17 + preview.y * 0.11);
  const color = preview.valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;
  const invalidKeys = new Set((preview.invalidTiles ?? []).map((tile) => keyOf(tile.x, tile.y)));

  for (const tile of visibleTiles) {
    const px = tile.x * ts;
    const py = tile.y * ts;
    const invalid = invalidKeys.has(keyOf(tile.x, tile.y));
    graphics.roundRect(px + 4, py + 4, ts - 8, ts - 8, 7)
      .fill({ color: invalid ? MAP_COLORS.previewInvalid : MAP_COLORS.previewValid, alpha: invalid ? 0.16 : 0.08 + previewPulse * 0.05 })
      .stroke({ color: invalid ? MAP_COLORS.previewInvalid : color, width: invalid ? 2 : 1.4 + previewPulse * 0.7, alpha: invalid ? 0.9 : 0.58 + previewPulse * 0.22 });
    drawOneWayArrow(graphics, tile.x, tile.y, ts, direction, false, invalid ? MAP_COLORS.previewInvalid : MAP_COLORS.previewValid, invalid ? 0.72 : 0.85);
  }
}

function getOneWayPreview(world: GameWorld, tiles: Vec2[], direction: RoadDirection): ActionPreview {
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

function drawOneWayArrow(
  graphics: Graphics,
  x: number,
  y: number,
  ts: number,
  direction: RoadDirection,
  isAvenue: boolean,
  color = MAP_COLORS.lane,
  alpha = 0.78,
): void {
  const cx = x * ts + ts / 2;
  const cy = y * ts + ts / 2;
  const angle = directionAngle(direction);
  const length = isAvenue ? 14 : 11;
  const head = isAvenue ? 5 : 4;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const startX = cx - dx * length * 0.42;
  const startY = cy - dy * length * 0.42;
  const endX = cx + dx * length * 0.42;
  const endY = cy + dy * length * 0.42;

  graphics.moveTo(startX, startY).lineTo(endX, endY).stroke({ color, width: isAvenue ? 2.2 : 2, alpha });
  graphics.poly([
    endX + dx * head, endY + dy * head,
    endX - dx * head * 0.8 + px * head * 0.8, endY - dy * head * 0.8 + py * head * 0.8,
    endX - dx * head * 0.8 - px * head * 0.8, endY - dy * head * 0.8 - py * head * 0.8,
  ]).fill({ color, alpha });
}

function getLineDirection(start: Vec2, end: Vec2): RoadDirection {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'west' : 'east';
  return dy < 0 ? 'north' : 'south';
}

function directionLabel(direction: RoadDirection): string {
  if (direction === 'north') return 'norte';
  if (direction === 'south') return 'sul';
  if (direction === 'west') return 'oeste';
  return 'leste';
}

function getActionPreview(world: GameWorld, x: number, y: number, tool: Tool, money: number): ActionPreview {
  if (!inBounds(x, y)) {
    return { x, y, label: 'Fora do mapa', valid: false, reason: 'Fora do mapa.', successMessage: '' };
  }

  const tile = world.grid[y][x];
  if (tool === 'inspect') {
    return { x, y, label: 'Inspecionar', valid: true, successMessage: 'Detalhes atualizados.' };
  }

  if (tool === 'road' || tool === 'avenue') {
    const cost = ROAD_CONFIG[tool].buildCost;
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
    if (!isRoadType(tile.type) && !roundaboutCenter) return { x, y, label: 'Nada para remover', valid: false, reason: 'Só é possível remover ruas e avenidas.', successMessage: '' };
    const roadType = roundaboutCenter ? 'roundabout' : tile.type as RoadType;
    const cost = ROAD_CONFIG[roadType].removeCost;
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para remover.`, successMessage: '' };
    const hasSignal = world.trafficLights.has(keyOf(x, y));
    return { x, y, label: `Remover ${ROAD_CONFIG[roadType].label.toLowerCase()}`, cost, valid: true, successMessage: `${ROAD_CONFIG[roadType].label} removida por $ ${cost}.${hasSignal ? ' Semáforo removido junto.' : ''}` };
  }

  return { x, y, label: 'Ação indisponível', valid: false, reason: 'Ação indisponível.', successMessage: '' };
}

function safelyDestroyPixiApp(app: Application): void {
  try {
    const maybeApp = app as unknown as { _cancelResize?: () => void; destroy: Application['destroy'] };
    if (typeof maybeApp._cancelResize !== 'function') {
      maybeApp._cancelResize = () => undefined;
    }
    app.destroy(true, { children: true, texture: true });
  } catch (error) {
    console.warn('Pixi cleanup ignored:', error);
  }
}
