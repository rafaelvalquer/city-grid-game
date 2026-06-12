import { useEffect, useRef } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import { GameWorld } from '../engine/simulation';
import { GAME_CONFIG } from '../config/gameConfig';
import { ROAD_CONFIG } from '../config/roadConfig';
import { useGameStore, type HoverPreview } from '../../store/gameStore';
import { inBounds, isRoadType, keyOf } from '../city/grid';
import type { Car } from '../../types/agent.types';
import type { BuildingType, RoadType, Tile, TrafficLightState, Vec2 } from '../../types/city.types';
import type { Tool } from '../../types/game.types';
import { MAP_COLORS, congestionColor } from './visualTheme';
import { getDirection, getLaneOffset, isIntersection } from '../systems/trafficRules';
import { getTrafficLightOpenAxis, TRAFFIC_LIGHT_BUILD_COST } from '../systems/trafficLights';

type ActionPreview = HoverPreview & {
  reason?: string;
  successMessage: string;
};

type CarRenderPose = {
  x: number;
  y: number;
  angle: number;
  turningAmount: number;
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
  const cameraRef = useRef({ x: 56, y: 42, scale: 0.75 });
  const panningRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const hoverPreview = useGameStore((s) => s.hoverPreview);
  const actionFeedback = useGameStore((s) => s.actionFeedback);
  const showHeatmapUi = useGameStore((s) => s.showHeatmap);

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
        const preview = getActionPreview(world, tileX, tileY, state.selectedTool, state.stats.money);
        const didBuild = world.buildAt(tileX, tileY, state.selectedTool);
        state.setActionFeedback(didBuild ? preview.successMessage : preview.reason ?? 'Ação indisponível neste tile.');
      };

      const updateHover = (clientX: number, clientY: number) => {
        const state = useGameStore.getState();
        const tile = toWorldTile(clientX, clientY);
        state.setHoverPreview(getActionPreview(world, tile.x, tile.y, state.selectedTool, state.stats.money));
      };

      app.canvas.addEventListener('pointerdown', (event) => {
        if (event.button === 1 || event.altKey) {
          panningRef.current = { active: true, x: event.clientX, y: event.clientY };
          return;
        }
        isDrawingRef.current = true;
        lastTileRef.current = '';
        const tile = toWorldTile(event.clientX, event.clientY);
        updateHover(event.clientX, event.clientY);
        applyTool(tile.x, tile.y);
      }, { signal: abortController.signal });

      window.addEventListener('pointerup', () => {
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
        const tile = toWorldTile(event.clientX, event.clientY);
        applyTool(tile.x, tile.y);
      }, { signal: abortController.signal });

      app.canvas.addEventListener('pointerleave', () => {
        useGameStore.getState().setHoverPreview(null);
      }, { signal: abortController.signal });

      app.canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        const cam = cameraRef.current;
        const factor = event.deltaY < 0 ? 1.1 : 0.9;
        cam.scale = Math.max(0.45, Math.min(2.2, cam.scale * factor));
      }, { passive: false, signal: abortController.signal });

      app.ticker.add((ticker) => {
        const { paused, speed, showHeatmap, setStats, setSelected } = useGameStore.getState();
        world.update(ticker.deltaMS / 1000, speed, paused);
        setStats(world.getSnapshot());
        setSelected(world.selected);
        const hover = useGameStore.getState().hoverPreview;
        draw(graphics, labels, world, showHeatmap, hover, cameraRef.current.x, cameraRef.current.y, cameraRef.current.scale);
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
        <span>Clique/arraste: construir</span>
      </div>
      {hoverPreview && (
        <div className={`tile-preview ${hoverPreview.valid ? 'valid' : 'invalid'}`}>
          <strong>{hoverPreview.label}</strong>
          <span>{hoverPreview.cost !== undefined ? `$ ${hoverPreview.cost}` : `${hoverPreview.x}, ${hoverPreview.y}`}</span>
        </div>
      )}
      {actionFeedback && <div className="action-feedback">{actionFeedback}</div>}
      <div className="heatmap-legend" aria-hidden={!showHeatmapUi}>
        <span>Trânsito</span>
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
  showHeatmap: boolean,
  hoverPreview: HoverPreview | null,
  camX: number,
  camY: number,
  scale: number,
): void {
  const ts = GAME_CONFIG.tileSize;
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
      if (tile.type === 'road') drawRoad(graphics, world.grid, x, y, ts, 'road');
      if (tile.type === 'avenue') drawRoad(graphics, world.grid, x, y, ts, 'avenue');
    }
  }

  drawTrafficLights(graphics, world, ts);

  if (showHeatmap) {
    for (const t of world.traffic.values()) {
      if (t.congestion <= 0) continue;
      graphics.roundRect(t.x * ts + 5, t.y * ts + 5, ts - 10, ts - 10, 5).fill({ color: congestionColor(t.congestion), alpha: Math.min(0.5, 0.12 + t.congestion * 0.18) });
    }
  }

  for (const building of world.buildings) {
    drawBuilding(graphics, building.type, building.x, building.y, building.connected, ts);
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
    drawCar(graphics, car, world.grid, ts);
  }

  if (hoverPreview) drawPreview(graphics, hoverPreview.x, hoverPreview.y, hoverPreview.valid, ts);
  if (world.selected.kind === 'tile') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'road') drawSelection(graphics, world.selected.x, world.selected.y, ts);
  if (world.selected.kind === 'building') drawSelection(graphics, world.selected.building.x, world.selected.building.y, ts);
  if (world.selected.kind === 'car') {
    const car = world.getCar(world.selected.carId);
    if (car) {
      const pose = getCarRenderPose(car, world.grid);
      graphics.circle(pose.x * ts + ts / 2, pose.y * ts + ts / 2, 9).stroke({ color: MAP_COLORS.selection, width: 2 });
    }
  }
}

function drawSelection(graphics: Graphics, x: number, y: number, ts: number): void {
  graphics.roundRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2, 5).stroke({ color: MAP_COLORS.selection, width: 2 });
}

function drawBaseTile(graphics: Graphics, tile: Tile, x: number, y: number, ts: number): void {
  const base = (x + y) % 2 === 0 ? MAP_COLORS.block : MAP_COLORS.blockAlt;
  graphics.rect(x * ts, y * ts, ts, ts).fill(base).stroke({ width: 1, color: MAP_COLORS.grid, alpha: 0.28 });
  if (tile.type === 'empty') {
    graphics.roundRect(x * ts + 5, y * ts + 5, ts - 10, ts - 10, 6).stroke({ width: 1, color: MAP_COLORS.lotStroke, alpha: 0.22 });
  }
}

function drawRoad(graphics: Graphics, grid: Tile[][], x: number, y: number, ts: number, type: RoadType): void {
  const isAvenue = type === 'avenue';
  const px = x * ts;
  const py = y * ts;
  const roadColor = isAvenue ? MAP_COLORS.avenue : MAP_COLORS.road;
  const edgeColor = isAvenue ? MAP_COLORS.avenueEdge : MAP_COLORS.roadEdge;
  const roadW = isAvenue ? 34 : 24;
  const walkW = Math.min(ts - 4, roadW + 8);
  const halfRoad = roadW / 2;
  const halfWalk = walkW / 2;
  const center = ts / 2;
  const neighbors = roadNeighbors(grid, x, y);

  drawRoadConnectors(graphics, px, py, ts, halfWalk, MAP_COLORS.sidewalk, neighbors);
  graphics.circle(px + center, py + center, halfWalk).fill(MAP_COLORS.sidewalk);

  drawRoadConnectors(graphics, px, py, ts, halfRoad, roadColor, neighbors);
  graphics.circle(px + center, py + center, halfRoad).fill(roadColor).stroke({ color: edgeColor, width: 1, alpha: 0.75 });

  drawLaneMarkings(graphics, px, py, ts, isAvenue, neighbors);
}

function drawTrafficLights(graphics: Graphics, world: GameWorld, ts: number): void {
  for (const light of world.trafficLights.values()) {
    drawTrafficLight(graphics, light, ts);
  }
}

function drawTrafficLight(graphics: Graphics, light: TrafficLightState, ts: number): void {
  const px = light.x * ts;
  const py = light.y * ts;
  const center = ts / 2;
  const axis = getTrafficLightOpenAxis(light);
  const yellow = light.phase === 'horizontalYellow' || light.phase === 'verticalYellow';
  const horizontalColor = axis === 'horizontal' ? (yellow ? SIGNAL_YELLOW : SIGNAL_GREEN) : SIGNAL_RED;
  const verticalColor = axis === 'vertical' ? (yellow ? SIGNAL_YELLOW : SIGNAL_GREEN) : SIGNAL_RED;

  graphics.circle(px + center, py + center, 6).fill({ color: MAP_COLORS.shadow, alpha: 0.48 });

  drawSignalDot(graphics, px + center - 13, py + 7, verticalColor);
  drawSignalDot(graphics, px + center + 13, py + ts - 7, verticalColor);
  drawSignalDot(graphics, px + 7, py + center + 13, horizontalColor);
  drawSignalDot(graphics, px + ts - 7, py + center - 13, horizontalColor);
}

function drawSignalDot(graphics: Graphics, x: number, y: number, color: number): void {
  graphics.circle(x, y, 5).fill(SIGNAL_OFF).stroke({ color: MAP_COLORS.laneSoft, width: 1, alpha: 0.65 });
  graphics.circle(x, y, 3.2).fill(color);
}

function drawBuilding(graphics: Graphics, type: BuildingType, x: number, y: number, connected: boolean, ts: number): void {
  const px = x * ts;
  const py = y * ts;
  graphics.roundRect(px + 6, py + 7, ts - 8, ts - 7, 4).fill({ color: MAP_COLORS.shadow, alpha: 0.28 });
  if (type === 'house') {
    graphics.poly([px + 5, py + 12, px + ts / 2, py + 4, px + ts - 5, py + 12]).fill(MAP_COLORS.houseRoof);
    graphics.roundRect(px + 6, py + 11, ts - 12, ts - 16, 3).fill(MAP_COLORS.house);
  } else if (type === 'shop') {
    graphics.roundRect(px + 5, py + 7, ts - 10, ts - 10, 3).fill(MAP_COLORS.shop);
    graphics.rect(px + 6, py + 8, ts - 12, 4).fill(MAP_COLORS.shopAwning);
    graphics.rect(px + 9, py + 15, ts - 18, 3).fill({ color: MAP_COLORS.shadow, alpha: 0.22 });
  } else {
    graphics.roundRect(px + 5, py + 4, ts - 10, ts - 7, 3).fill(MAP_COLORS.office);
    for (let row = 0; row < 3; row += 1) {
      graphics.rect(px + 8, py + 7 + row * 5, 3, 2).fill({ color: MAP_COLORS.officeGlass, alpha: 0.75 });
      graphics.rect(px + 14, py + 7 + row * 5, 3, 2).fill({ color: MAP_COLORS.officeGlass, alpha: 0.75 });
    }
  }
  graphics.roundRect(px + 4, py + 4, ts - 8, ts - 8, 4).stroke({ color: connected ? MAP_COLORS.lotStroke : MAP_COLORS.disconnected, width: connected ? 1 : 3, alpha: connected ? 0.8 : 1 });
}

function drawCar(graphics: Graphics, car: Car, grid: Tile[][], ts: number): void {
  const pose = getCarRenderPose(car, grid);
  const cx = pose.x * ts + ts / 2;
  const cy = pose.y * ts + ts / 2;
  const length = 13;
  const width = 7;
  const color = car.trafficState === 'intersection'
    ? MAP_COLORS.carAltC
    : car.trafficState === 'queued'
      ? MAP_COLORS.carAltA
      : carColor(car.id);
  drawCapsule(graphics, cx + 3, cy + 4, length, width, pose.angle, MAP_COLORS.shadow, 0.28);
  drawCapsule(graphics, cx, cy, length, width, pose.angle, color, 1, MAP_COLORS.roadEdge);
  drawRotatedRect(graphics, cx + Math.cos(pose.angle) * 1.8, cy + Math.sin(pose.angle) * 1.8, 4.2, 3.2, pose.angle, MAP_COLORS.carWindow, 0.88);
  graphics
    .circle(cx + Math.cos(pose.angle) * (length / 2 - 1.2), cy + Math.sin(pose.angle) * (length / 2 - 1.2), 1.35)
    .fill(MAP_COLORS.laneSoft);
}

function getCarRenderPose(car: Car, grid: Tile[][]): CarRenderPose {
  const current = car.route[car.routeIndex];
  const next = car.route[car.routeIndex + 1];
  if (!current || !next) return { x: car.x, y: car.y, angle: directionAngle(car.direction), turningAmount: 0 };

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
  };
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
  return { x, y, angle: Math.atan2(dy, dx), turningAmount: Math.sin(Math.PI * t) };
}

function laneOffsetForSegment(car: Car, grid: Tile[][], from: Vec2, to: Vec2): Vec2 {
  return getLaneOffset(getDirection(from, to), roadTypeAt(grid, from), car.id).offset;
}

function roadTypeAt(grid: Tile[][], pos: Vec2): RoadType {
  return grid[pos.y]?.[pos.x]?.type === 'avenue' ? 'avenue' : 'road';
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

function drawPreview(graphics: Graphics, x: number, y: number, valid: boolean, ts: number): void {
  if (!inBounds(x, y)) return;
  const color = valid ? MAP_COLORS.previewValid : MAP_COLORS.previewInvalid;
  graphics.roundRect(x * ts + 2, y * ts + 2, ts - 4, ts - 4, 5).fill({ color, alpha: valid ? 0.12 : 0.16 }).stroke({ color, width: 2, alpha: 0.9 });
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
    if (tile.type === tool) return { x, y, label: 'Via já construída', cost, valid: false, reason: 'Essa via já existe aqui.', successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para construir.`, successMessage: '' };
    return { x, y, label: tool === 'road' ? 'Construir rua' : 'Construir avenida', cost, valid: true, successMessage: `${tool === 'road' ? 'Rua' : 'Avenida'} construída por $ ${cost}.` };
  }

  if (tool === 'trafficLight') {
    const cost = TRAFFIC_LIGHT_BUILD_COST;
    const key = keyOf(x, y);
    if (!isRoadType(tile.type)) return { x, y, label: 'Semáforo indisponível', cost, valid: false, reason: 'Semáforos só podem ser adicionados em ruas e avenidas.', successMessage: '' };
    if (!isIntersection(world.grid, { x, y })) return { x, y, label: 'Não é cruzamento', cost, valid: false, reason: 'Coloque o semáforo apenas em cruzamentos ou cruzamentos em T.', successMessage: '' };
    if (world.trafficLights.has(key)) return { x, y, label: 'Semáforo já instalado', cost, valid: false, reason: 'Este cruzamento já possui semáforo.', successMessage: '' };
    if (money < cost) return { x, y, label: 'Dinheiro insuficiente', cost, valid: false, reason: `Faltam $ ${cost - money} para instalar o semáforo.`, successMessage: '' };
    return { x, y, label: 'Instalar semáforo', cost, valid: true, successMessage: `Semáforo instalado por $ ${cost}.` };
  }

  if (tool === 'remove') {
    if (!isRoadType(tile.type)) return { x, y, label: 'Nada para remover', valid: false, reason: 'Só é possível remover ruas e avenidas.', successMessage: '' };
    const roadType = tile.type as RoadType;
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
