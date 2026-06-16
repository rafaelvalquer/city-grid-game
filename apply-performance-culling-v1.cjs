const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const BACKUP_SUFFIX = '.bak-performance-culling-v1';

function filePath(relativePath) {
  return path.join(ROOT, relativePath);
}

function read(relativePath) {
  const fullPath = filePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Arquivo não encontrado: ${relativePath}`);
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(filePath(relativePath), content, 'utf8');
}

function backup(relativePath) {
  const fullPath = filePath(relativePath);
  const backupPath = fullPath + BACKUP_SUFFIX;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(fullPath, backupPath);
  }
}

function replaceExact(content, from, to, label) {
  if (!content.includes(from)) {
    throw new Error(`Trecho não encontrado para patch: ${label}`);
  }
  return content.replace(from, to);
}

function replaceRegex(content, regex, replacer, label) {
  if (!regex.test(content)) {
    throw new Error(`Trecho não encontrado para patch: ${label}`);
  }
  return content.replace(regex, replacer);
}

function patchCameraController() {
  const relativePath = 'src/game/rendering/cameraController.ts';
  backup(relativePath);
  let content = read(relativePath);

  if (!content.includes('export type ViewportTileBounds')) {
    content = replaceExact(
      content,
      `export type CameraState = {\n  x: number;\n  y: number;\n  scale: number;\n};\n`,
      `export type CameraState = {\n  x: number;\n  y: number;\n  scale: number;\n};\n\nexport type ViewportTileBounds = {\n  minX: number;\n  minY: number;\n  maxX: number;\n  maxY: number;\n};\n`,
      'CameraState -> ViewportTileBounds',
    );
  }

  if (!content.includes('getVisibleTileBounds: (paddingTiles?: number) => ViewportTileBounds;')) {
    content = replaceExact(
      content,
      `  toWorldTile: (clientX: number, clientY: number) => Vec2;\n  handlePointerDown`,
      `  toWorldTile: (clientX: number, clientY: number) => Vec2;\n  getVisibleTileBounds: (paddingTiles?: number) => ViewportTileBounds;\n  handlePointerDown`,
      'CameraController interface getVisibleTileBounds',
    );
  }

  if (!content.includes('getVisibleTileBounds(paddingTiles = 2)')) {
    content = replaceExact(
      content,
      `    },\n    handlePointerDown(event) {`,
      `    },\n    getVisibleTileBounds(paddingTiles = 2) {\n      const rect = canvas.getBoundingClientRect();\n      const tileSize = GAME_CONFIG.tileSize;\n      const left = (-state.x) / state.scale;\n      const top = (-state.y) / state.scale;\n      const right = (rect.width - state.x) / state.scale;\n      const bottom = (rect.height - state.y) / state.scale;\n\n      return {\n        minX: Math.floor(left / tileSize) - paddingTiles,\n        minY: Math.floor(top / tileSize) - paddingTiles,\n        maxX: Math.ceil(right / tileSize) + paddingTiles,\n        maxY: Math.ceil(bottom / tileSize) + paddingTiles,\n      };\n    },\n    handlePointerDown(event) {`,
      'camera getVisibleTileBounds implementation',
    );
  }

  write(relativePath, content);
}

function patchPixiGame() {
  const relativePath = 'src/game/rendering/PixiGame.tsx';
  backup(relativePath);
  let content = read(relativePath);

  if (!content.includes('world.setActiveViewportBounds(visibleBounds);')) {
    content = replaceExact(
      content,
      `        world.update(dt, speed, paused);`,
      `        const visibleBounds = camera.getVisibleTileBounds(3);\n        world.setActiveViewportBounds(visibleBounds);\n        world.update(dt, speed, paused);`,
      'PixiGame cria bounds visíveis antes do update',
    );
  }

  if (!content.includes('          visibleBounds,\n        );')) {
    content = replaceExact(
      content,
      `          particles,\n        );`,
      `          particles,\n          visibleBounds,\n        );`,
      'PixiGame passa bounds para renderWorld',
    );
  }

  write(relativePath, content);
}

function patchRenderWorld() {
  const relativePath = 'src/game/rendering/renderWorld.ts';
  backup(relativePath);
  let content = read(relativePath);

  if (!content.includes("import type { Car } from '../../types/agent.types';")) {
    content = replaceExact(
      content,
      `import type { HeatmapMode, HoverPreview, ViewLayer } from '../../store/gameStore';\n`,
      `import type { HeatmapMode, HoverPreview, ViewLayer } from '../../store/gameStore';\nimport type { Car } from '../../types/agent.types';\n`,
      'renderWorld import Car',
    );
  }

  if (!content.includes('type ViewportTileBounds = {')) {
    content = replaceExact(
      content,
      `import { renderMetroLayer } from './renderMetro';\n`,
      `import { renderMetroLayer } from './renderMetro';\n\ntype ViewportTileBounds = {\n  minX: number;\n  minY: number;\n  maxX: number;\n  maxY: number;\n};\n`,
      'renderWorld ViewportTileBounds type',
    );
  }

  if (!content.includes('  visibleBounds?: ViewportTileBounds,\n): void {')) {
    content = replaceExact(
      content,
      `  viewLayer: ViewLayer,\n  particles?: ParticleSystem,\n): void {`,
      `  viewLayer: ViewLayer,\n  particles?: ParticleSystem,\n  visibleBounds?: ViewportTileBounds,\n): void {`,
      'renderWorld signature visibleBounds',
    );
  }

  if (!content.includes('renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, visibleBounds);')) {
    content = replaceExact(
      content,
      `  renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer);`,
      `  renderDynamicLayer(dynamicGraphics, state, world, heatmapMode, hoverPreview, ts, timeSeconds, atmosphere, viewLayer, visibleBounds);`,
      'renderWorld passa visibleBounds para camada dinâmica',
    );
  }

  if (!content.includes('  visibleBounds?: ViewportTileBounds,\n): void {\n  graphics.clear();')) {
    content = replaceExact(
      content,
      `  atmosphere: ReturnType<typeof getAtmosphere>,\n  viewLayer: ViewLayer,\n): void {\n  graphics.clear();`,
      `  atmosphere: ReturnType<typeof getAtmosphere>,\n  viewLayer: ViewLayer,\n  visibleBounds?: ViewportTileBounds,\n): void {\n  graphics.clear();`,
      'renderDynamicLayer signature visibleBounds',
    );
  }

  if (!content.includes('const carCullBounds = visibleBounds ? expandViewportBounds(visibleBounds, 2) : undefined;')) {
    content = replaceExact(
      content,
      `  for (const car of world.cars) {\n    drawCar(graphics, car, world, ts, timeSeconds, atmosphere);\n  }`,
      `  const carCullBounds = visibleBounds ? expandViewportBounds(visibleBounds, 2) : undefined;\n  for (const car of world.cars) {\n    const selectedCar = world.selected.kind === 'car' && world.selected.carId === car.id;\n    if (carCullBounds && !selectedCar && !isCarInsideBounds(car, carCullBounds)) continue;\n    drawCar(graphics, car, world, ts, timeSeconds, atmosphere);\n  }`,
      'renderWorld culling de carros',
    );
  }

  if (!content.includes('function expandViewportBounds(bounds: ViewportTileBounds')) {
    content = replaceExact(
      content,
      `  pruneSmokeHistory(state, timeSeconds);\n}\n\nfunction emitRenderParticles`,
      `  pruneSmokeHistory(state, timeSeconds);\n}\n\nfunction expandViewportBounds(bounds: ViewportTileBounds, paddingTiles: number): ViewportTileBounds {\n  return {\n    minX: bounds.minX - paddingTiles,\n    minY: bounds.minY - paddingTiles,\n    maxX: bounds.maxX + paddingTiles,\n    maxY: bounds.maxY + paddingTiles,\n  };\n}\n\nfunction isCarInsideBounds(car: Car, bounds: ViewportTileBounds): boolean {\n  if (car.x >= bounds.minX && car.x <= bounds.maxX && car.y >= bounds.minY && car.y <= bounds.maxY) return true;\n  const current = car.route[car.routeIndex];\n  const next = car.route[car.routeIndex + 1];\n  return Boolean(\n    (current && current.x >= bounds.minX && current.x <= bounds.maxX && current.y >= bounds.minY && current.y <= bounds.maxY)\n    || (next && next.x >= bounds.minX && next.x <= bounds.maxX && next.y >= bounds.minY && next.y <= bounds.maxY)\n  );\n}\n\nfunction emitRenderParticles`,
      'renderWorld helpers de culling',
    );
  }

  write(relativePath, content);
}

function patchSimulation() {
  const relativePath = 'src/game/engine/simulation.ts';
  backup(relativePath);
  let content = read(relativePath);

  if (!content.includes('type PerformanceViewportBounds = {')) {
    content = replaceRegex(
      content,
      /type RerouteOptions = \{[\s\S]*?\};\n/,
      (match) => `${match}\ntype PerformanceViewportBounds = {\n  minX: number;\n  minY: number;\n  maxX: number;\n  maxY: number;\n};\n\nconst REDUCED_CAR_UPDATE_THRESHOLD = 450;\nconst DISTANT_CAR_UPDATE_EVERY_TICKS = 3;\nconst DISTANT_CAR_VIEWPORT_PADDING_TILES = 8;\n`,
      'simulation performance viewport type/constants',
    );
  }

  if (!content.includes('private activeViewportBounds?: PerformanceViewportBounds;')) {
    content = replaceExact(
      content,
      `  private readonly allowRoadDemolition: boolean;\n  private staticRenderVersion = 0;`,
      `  private readonly allowRoadDemolition: boolean;\n  private staticRenderVersion = 0;\n  private activeViewportBounds?: PerformanceViewportBounds;\n  private performanceUpdateTick = 0;`,
      'simulation performance properties',
    );
  }

  if (!content.includes('setActiveViewportBounds(bounds?: PerformanceViewportBounds): void')) {
    content = replaceExact(
      content,
      `  private markStaticRenderDirty(): void {\n    this.staticRenderVersion = (this.staticRenderVersion + 1) % Number.MAX_SAFE_INTEGER;\n  }\n\n  getSnapshot(): CityStats {`,
      `  private markStaticRenderDirty(): void {\n    this.staticRenderVersion = (this.staticRenderVersion + 1) % Number.MAX_SAFE_INTEGER;\n  }\n\n  setActiveViewportBounds(bounds?: PerformanceViewportBounds): void {\n    this.activeViewportBounds = bounds;\n  }\n\n  getSnapshot(): CityStats {`,
      'simulation setActiveViewportBounds method',
    );
  }

  if (!content.includes('this.performanceUpdateTick = (this.performanceUpdateTick + 1) % 300000;')) {
    content = replaceExact(
      content,
      `  private updateCars(dt: number): void {\n    const arrived: Car[] = [];`,
      `  private updateCars(dt: number): void {\n    this.performanceUpdateTick = (this.performanceUpdateTick + 1) % 300000;\n    const arrived: Car[] = [];`,
      'simulation updateCars tick counter',
    );
  }

  if (!content.includes('for (let carIndex = 0; carIndex < sortedCars.length; carIndex += 1)')) {
    content = replaceExact(
      content,
      `    for (const car of sortedCars) {\n      car.travelTime += dt;`,
      `    for (let carIndex = 0; carIndex < sortedCars.length; carIndex += 1) {\n      const car = sortedCars[carIndex];\n      car.travelTime += dt;\n      if (this.shouldUseReducedCarUpdate(car)) {\n        this.advanceDistantCarLightweight(car, dt);\n        continue;\n      }`,
      'simulation updateCars distant skip',
    );
  }

  if (!content.includes('private shouldUseReducedCarUpdate(car: Car): boolean')) {
    const helperBlock = `\n  private shouldUseReducedCarUpdate(car: Car): boolean {\n    if (!this.activeViewportBounds) return false;\n    if (this.cars.length < REDUCED_CAR_UPDATE_THRESHOLD) return false;\n    if (car.vehicleType === 'bus') return false;\n    if (this.selected.kind === 'car' && this.selected.carId === car.id) return false;\n    if (car.lifecyclePhase !== 'driving') return false;\n    if (car.status !== 'moving' || car.trafficState !== 'moving') return false;\n    if (car.currentSpeed < 0.35 || car.targetSpeed < 0.2) return false;\n    if (car.stuckSeconds > 0.2 || car.immobileSeconds > 0.2 || car.rerouteCooldownSeconds > 0) return false;\n    if (car.intersectionStopKey || car.signalTransitionGraceSeconds > 0) return false;\n\n    const current = { x: car.currentTileX, y: car.currentTileY };\n    const next = car.route[car.routeIndex + 1];\n    if (!next) return false;\n    if (this.isTileInsideActiveViewport(current.x, current.y, DISTANT_CAR_VIEWPORT_PADDING_TILES)) return false;\n    if (this.isTileInsideActiveViewport(next.x, next.y, DISTANT_CAR_VIEWPORT_PADDING_TILES)) return false;\n    if (isIntersection(this.grid, current) || isIntersection(this.grid, next)) return false;\n\n    return this.performanceUpdateTick % DISTANT_CAR_UPDATE_EVERY_TICKS !== this.carUpdateBucket(car);\n  }\n\n  private advanceDistantCarLightweight(car: Car, dt: number): void {\n    const desired = Math.max(0.25, car.desiredSpeed || car.baseSpeed);\n    const speed = Math.max(0.25, Math.min(desired, car.currentSpeed || car.targetSpeed || car.baseSpeed));\n    car.currentSpeed = speed;\n    car.targetSpeed = desired;\n    car.status = 'moving';\n    car.trafficState = 'moving';\n    car.stuckSeconds = Math.max(0, car.stuckSeconds - dt * 2);\n    car.immobileSeconds = Math.max(0, car.immobileSeconds - dt * 3);\n\n    car.progressToNext += speed * dt;\n    while (car.progressToNext >= 1 && car.routeIndex < car.route.length - 1) {\n      car.progressToNext -= 1;\n      car.routeIndex += 1;\n      const pos = car.route[car.routeIndex];\n      car.currentTileX = pos.x;\n      car.currentTileY = pos.y;\n      car.x = pos.x;\n      car.y = pos.y;\n      if (isIntersection(this.grid, pos)) break;\n    }\n\n    if (car.routeIndex >= car.route.length - 1) {\n      car.lifecyclePhase = 'destinationEntry';\n      car.lifecycleProgress = 0;\n      car.currentSpeed = Math.min(car.currentSpeed, 0.5);\n      car.targetSpeed = 0;\n      return;\n    }\n\n    const current = car.route[car.routeIndex];\n    const next = car.route[car.routeIndex + 1];\n    if (!current || !next) return;\n    car.x = current.x + (next.x - current.x) * car.progressToNext + car.laneOffset.x;\n    car.y = current.y + (next.y - current.y) * car.progressToNext + car.laneOffset.y;\n  }\n\n  private isTileInsideActiveViewport(x: number, y: number, paddingTiles = 0): boolean {\n    const bounds = this.activeViewportBounds;\n    if (!bounds) return true;\n    return x >= bounds.minX - paddingTiles\n      && x <= bounds.maxX + paddingTiles\n      && y >= bounds.minY - paddingTiles\n      && y <= bounds.maxY + paddingTiles;\n  }\n\n  private carUpdateBucket(car: Car): number {\n    let hash = 0;\n    for (let index = 0; index < car.id.length; index += 1) {\n      hash = ((hash << 5) - hash + car.id.charCodeAt(index)) | 0;\n    }\n    return Math.abs(hash) % DISTANT_CAR_UPDATE_EVERY_TICKS;\n  }\n`;
    content = replaceExact(
      content,
      `\n  private hasBusLaneForCar(car: Car, next?: Vec2): boolean {`,
      `${helperBlock}\n  private hasBusLaneForCar(car: Car, next?: Vec2): boolean {`,
      'simulation reduced update helper methods',
    );
  }

  write(relativePath, content);
}

function validate() {
  const camera = read('src/game/rendering/cameraController.ts');
  const pixi = read('src/game/rendering/PixiGame.tsx');
  const renderWorld = read('src/game/rendering/renderWorld.ts');
  const simulation = read('src/game/engine/simulation.ts');

  const required = [
    [camera, 'getVisibleTileBounds(paddingTiles = 2)', 'camera getVisibleTileBounds'],
    [pixi, 'world.setActiveViewportBounds(visibleBounds);', 'PixiGame viewport bounds'],
    [renderWorld, 'isCarInsideBounds(car, carCullBounds)', 'renderWorld car culling'],
    [simulation, 'shouldUseReducedCarUpdate(car: Car): boolean', 'simulation reduced update'],
    [simulation, 'advanceDistantCarLightweight(car: Car, dt: number): void', 'simulation lightweight advance'],
  ];

  for (const [content, token, label] of required) {
    if (!content.includes(token)) throw new Error(`Validação falhou: ${label}`);
  }
}

function main() {
  patchCameraController();
  patchPixiGame();
  patchRenderWorld();
  patchSimulation();
  validate();
  console.log('Performance Culling V1 aplicado com sucesso. Rode npm run build para validar o projeto.');
}

main();
