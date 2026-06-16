#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const BACKUP_SUFFIX = '.bak-district-expansion-v1';

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  const full = filePath(relativePath);
  if (!fs.existsSync(full)) throw new Error(`Arquivo não encontrado: ${relativePath}`);
  return fs.readFileSync(full, 'utf8');
}

function write(relativePath, content) {
  const full = filePath(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full)) {
    const backup = `${full}${BACKUP_SUFFIX}`;
    if (!fs.existsSync(backup)) fs.copyFileSync(full, backup);
  }
  fs.writeFileSync(full, content, 'utf8');
}

function writeNew(relativePath, content) {
  const full = filePath(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full)) {
    const current = fs.readFileSync(full, 'utf8');
    if (current === content) return;
    const backup = `${full}${BACKUP_SUFFIX}`;
    if (!fs.existsSync(backup)) fs.copyFileSync(full, backup);
  }
  fs.writeFileSync(full, content, 'utf8');
}

function replaceOnce(content, search, replacement, label) {
  if (content.includes(replacement)) return content;
  if (!content.includes(search)) throw new Error(`Trecho não encontrado para aplicar: ${label}`);
  return content.replace(search, replacement);
}

function replaceAllLiteral(content, search, replacement) {
  return content.split(search).join(replacement);
}

function ensureContains(content, marker, insertion, label) {
  if (content.includes(insertion.trim().split('\n')[0])) return content;
  if (!content.includes(marker)) throw new Error(`Marcador não encontrado para inserir: ${label}`);
  return content.replace(marker, `${insertion}${marker}`);
}

function patchGrid() {
  const content = `import { GAME_CONFIG } from '../config/gameConfig';
import type { Tile, TileType, Vec2 } from '../../types/city.types';

let activeGridWidth = GAME_CONFIG.gridWidth;
let activeGridHeight = GAME_CONFIG.gridHeight;

export function setGridBounds(width: number, height: number): void {
  activeGridWidth = Math.max(1, Math.floor(width));
  activeGridHeight = Math.max(1, Math.floor(height));
}

export function getGridWidth(): number {
  return activeGridWidth;
}

export function getGridHeight(): number {
  return activeGridHeight;
}

export function createGrid(width = GAME_CONFIG.gridWidth, height = GAME_CONFIG.gridHeight): Tile[][] {
  setGridBounds(width, height);
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({ x, y, type: 'empty' as TileType }))
  );
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < activeGridWidth && y < activeGridHeight;
}

export function inBoundsForGrid(grid: Tile[][], x: number, y: number): boolean {
  return x >= 0 && y >= 0 && y < grid.length && x < (grid[y]?.length ?? 0);
}

export function keyOf(x: number, y: number): string {
  return \`${'${x},${y}'}\`;
}

export function getNeighbors4(pos: Vec2): Vec2[] {
  return [
    { x: pos.x + 1, y: pos.y },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x, y: pos.y - 1 },
  ].filter((p) => inBounds(p.x, p.y));
}

export function getNeighbors4ForGrid(grid: Tile[][], pos: Vec2): Vec2[] {
  return [
    { x: pos.x + 1, y: pos.y },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x, y: pos.y - 1 },
  ].filter((p) => inBoundsForGrid(grid, p.x, p.y));
}

export function isRoadType(type: TileType | undefined): boolean {
  return type === 'road' || type === 'avenue' || type === 'roundabout';
}
`;
  write('src/game/city/grid.ts', content);
}

function createDistrictConfig() {
  const content = `export const DISTRICT_EXPANSION_CONFIG = {
  eastDistrictId: 'district-east',
  eastDistrictName: 'Bairro Leste',
  requiredCityLevel: 3,
  requiredSatisfaction: 55,
  requiredPopulation: 250,
  cost: 20000,
  baseMaxBuses: 2,
  eastGrowthChance: 0.55,
  eastGrowthRoadRadius: 4,
} as const;
`;
  writeNew('src/game/config/districtConfig.ts', content);
}

function patchTypes() {
  let content = read('src/types/city.types.ts');

  content = replaceOnce(
    content,
    "export type RoadDirection = 'north' | 'south' | 'east' | 'west';\n\nexport type Vec2 = { x: number; y: number };",
    "export type RoadDirection = 'north' | 'south' | 'east' | 'west';\n\nexport type DistrictStatus = 'owned' | 'available' | 'locked';\nexport type DistrictDirection = 'center' | 'east';\n\nexport type District = {\n  id: string;\n  name: string;\n  direction: DistrictDirection;\n  status: DistrictStatus;\n  xStart: number;\n  yStart: number;\n  width: number;\n  height: number;\n  cost: number;\n  purchasedAtDay?: number;\n};\n\nexport type Vec2 = { x: number; y: number };",
    'District types',
  );

  content = replaceOnce(
    content,
    "  activeBuses: number;\n  metroStations: number;",
    "  activeBuses: number;\n  districtsOwned: number;\n  cityAreaTiles: number;\n  maxCars: number;\n  maxBuses: number;\n  eastDistrictPurchased: boolean;\n  metroStations: number;",
    'CityStats district fields',
  );

  content = replaceOnce(
    content,
    "  activeBuses: number;\n  waitingPassengers: number;",
    "  activeBuses: number;\n  districtsOwned: number;\n  cityAreaTiles: number;\n  maxCars: number;\n  maxBuses: number;\n  waitingPassengers: number;",
    'CityHistorySample district fields',
  );

  write('src/types/city.types.ts', content);
}

function patchStore() {
  let content = read('src/store/gameStore.ts');
  content = replaceOnce(
    content,
    "  activeBuses: 0,\n  metroStations: 0,",
    "  activeBuses: 0,\n  districtsOwned: 1,\n  cityAreaTiles: 0,\n  maxCars: 0,\n  maxBuses: 0,\n  eastDistrictPurchased: false,\n  metroStations: 0,",
    'initialStats district fields',
  );
  write('src/store/gameStore.ts', content);
}

function patchSimulation() {
  let content = read('src/game/engine/simulation.ts');

  content = replaceOnce(
    content,
    "import type { Building, BuildingLevel, CityHistorySample, CityStats, RoadDirection, RoadType, SelectedEntity, Tile, TrafficCell, TrafficHeatmapCell, TrafficHeatmapSample, TrafficHeatmapSummary, TrafficLightAxis, TrafficLightState, TransitLine, TransitPassengerGroup, TransitStop, Vec2 } from '../../types/city.types';",
    "import type { Building, BuildingLevel, CityHistorySample, CityStats, District, RoadDirection, RoadType, SelectedEntity, Tile, TrafficCell, TrafficHeatmapCell, TrafficHeatmapSample, TrafficHeatmapSummary, TrafficLightAxis, TrafficLightState, TransitLine, TransitPassengerGroup, TransitStop, Vec2 } from '../../types/city.types';",
    'District type import',
  );

  content = replaceOnce(
    content,
    "import { METRO_CONFIG } from '../config/metroConfig';\nimport { createGrid, inBounds, isRoadType, keyOf } from '../city/grid';",
    "import { METRO_CONFIG } from '../config/metroConfig';\nimport { DISTRICT_EXPANSION_CONFIG } from '../config/districtConfig';\nimport { createGrid, inBounds, isRoadType, keyOf, setGridBounds } from '../city/grid';",
    'district config and setGridBounds import',
  );

  content = replaceOnce(
    content,
    "import { applyBuildingLevel, updateBuildingConnection } from '../city/buildings';",
    "import { applyBuildingLevel, createBuilding, updateBuildingConnection } from '../city/buildings';",
    'createBuilding import',
  );

  content = replaceOnce(
    content,
    "export class GameWorld {\n  grid: Tile[][] = createGrid();",
    "export class GameWorld {\n  private readonly baseGridWidth = GAME_CONFIG.gridWidth;\n  private readonly baseGridHeight = GAME_CONFIG.gridHeight;\n  grid: Tile[][] = createGrid();\n  districts: District[] = [];",
    'district fields',
  );

  content = replaceOnce(
    content,
    "  constructor(options: Partial<GameSetupOptions> = {}) {\n    this.allowRoadDemolition = options.allowRoadDemolition ?? false;\n    this.generator = new CityGenerator(options);",
    "  constructor(options: Partial<GameSetupOptions> = {}) {\n    setGridBounds(GAME_CONFIG.gridWidth, GAME_CONFIG.gridHeight);\n    this.grid = createGrid(GAME_CONFIG.gridWidth, GAME_CONFIG.gridHeight);\n    this.initializeDistricts();\n    this.allowRoadDemolition = options.allowRoadDemolition ?? false;\n    this.generator = new CityGenerator(options);",
    'constructor grid reset and districts init',
  );

  const districtMethods = `
  private initializeDistricts(): void {
    this.districts = [
      {
        id: 'district-center',
        name: 'Centro',
        direction: 'center',
        status: 'owned',
        xStart: 0,
        yStart: 0,
        width: this.baseGridWidth,
        height: this.baseGridHeight,
        cost: 0,
        purchasedAtDay: 1,
      },
      {
        id: DISTRICT_EXPANSION_CONFIG.eastDistrictId,
        name: DISTRICT_EXPANSION_CONFIG.eastDistrictName,
        direction: 'east',
        status: 'available',
        xStart: this.baseGridWidth,
        yStart: 0,
        width: this.baseGridWidth,
        height: this.baseGridHeight,
        cost: DISTRICT_EXPANSION_CONFIG.cost,
      },
    ];
  }

  getOwnedDistrictCount(): number {
    return this.districts.filter((district) => district.status === 'owned').length;
  }

  getMaxCars(): number {
    return GAME_CONFIG.maxCars * this.getOwnedDistrictCount();
  }

  getMaxBuses(): number {
    return DISTRICT_EXPANSION_CONFIG.baseMaxBuses * this.getOwnedDistrictCount();
  }

  isEastDistrictPurchased(): boolean {
    return this.districts.some((district) => district.id === DISTRICT_EXPANSION_CONFIG.eastDistrictId && district.status === 'owned');
  }

  getEastDistrict(): District | undefined {
    return this.districts.find((district) => district.id === DISTRICT_EXPANSION_CONFIG.eastDistrictId);
  }

  getEastDistrictRequirementStatus(): Array<{ label: string; met: boolean; current: number; required: number }> {
    const snapshot = this.getSnapshot();
    return [
      { label: 'Cidade nível 3', met: snapshot.cityLevel >= DISTRICT_EXPANSION_CONFIG.requiredCityLevel, current: snapshot.cityLevel, required: DISTRICT_EXPANSION_CONFIG.requiredCityLevel },
      { label: 'População 250+', met: snapshot.population >= DISTRICT_EXPANSION_CONFIG.requiredPopulation, current: snapshot.population, required: DISTRICT_EXPANSION_CONFIG.requiredPopulation },
      { label: 'Satisfação 55%+', met: snapshot.satisfaction >= DISTRICT_EXPANSION_CONFIG.requiredSatisfaction, current: snapshot.satisfaction, required: DISTRICT_EXPANSION_CONFIG.requiredSatisfaction },
      { label: '$ 20.000 disponíveis', met: snapshot.money >= DISTRICT_EXPANSION_CONFIG.cost, current: snapshot.money, required: DISTRICT_EXPANSION_CONFIG.cost },
    ];
  }

  canPurchaseEastDistrict(): { canPurchase: boolean; reason?: string; cost: number; requirements: ReturnType<GameWorld['getEastDistrictRequirementStatus']> } {
    const requirements = this.getEastDistrictRequirementStatus();
    const district = this.getEastDistrict();
    if (!district) return { canPurchase: false, reason: 'Bairro Leste não configurado.', cost: DISTRICT_EXPANSION_CONFIG.cost, requirements };
    if (district.status === 'owned') return { canPurchase: false, reason: 'Bairro Leste já foi comprado.', cost: district.cost, requirements };
    const missing = requirements.find((requirement) => !requirement.met);
    if (missing) return { canPurchase: false, reason: 'Requisito pendente: ' + missing.label + '.', cost: district.cost, requirements };
    return { canPurchase: true, cost: district.cost, requirements };
  }

  purchaseEastDistrict(): { success: boolean; reason?: string; district?: District } {
    const availability = this.canPurchaseEastDistrict();
    if (!availability.canPurchase) return { success: false, reason: availability.reason };

    const district = this.getEastDistrict();
    if (!district) return { success: false, reason: 'Bairro Leste não configurado.' };

    const oldWidth = this.grid[0]?.length ?? this.baseGridWidth;
    const oldHeight = this.grid.length || this.baseGridHeight;
    const expansionWidth = district.width || this.baseGridWidth;
    const newWidth = oldWidth + expansionWidth;

    for (let y = 0; y < oldHeight; y += 1) {
      const row = this.grid[y];
      if (!row) continue;
      for (let x = oldWidth; x < newWidth; x += 1) {
        row[x] = { x, y, type: 'empty' };
      }
    }

    district.status = 'owned';
    district.xStart = oldWidth;
    district.yStart = 0;
    district.width = expansionWidth;
    district.height = oldHeight;
    district.purchasedAtDay = this.time.getDay();

    this.money -= district.cost;
    setGridBounds(newWidth, oldHeight);
    this.updateConnections();
    this.updateTrafficMap();
    this.recordHistorySample(true);
    this.markStaticRenderDirty();
    this.selected = { kind: 'tile', x: oldWidth, y: Math.floor(oldHeight / 2), type: 'empty' };
    this.emit();
    return { success: true, district };
  }

  private getPrivateCarCount(): number {
    return this.cars.filter((car) => car.vehicleType !== 'bus').length;
  }

`;
  content = ensureContains(content, "  getStaticRenderSignature(lightingKey = ''): string {", districtMethods, 'district methods before getStaticRenderSignature');

  content = replaceOnce(
    content,
    "      activeBuses: this.getTransitBuses().length,\n      metroStations: this.metroStations.length,",
    "      activeBuses: this.getTransitBuses().length,\n      districtsOwned: this.getOwnedDistrictCount(),\n      cityAreaTiles: this.grid.length * (this.grid[0]?.length ?? 0),\n      maxCars: this.getMaxCars(),\n      maxBuses: this.getMaxBuses(),\n      eastDistrictPurchased: this.isEastDistrictPurchased(),\n      metroStations: this.metroStations.length,",
    'getSnapshot district stats',
  );

  content = replaceOnce(
    content,
    "      activeBuses: snapshot.activeBuses,\n      waitingPassengers: snapshot.waitingPassengers,",
    "      activeBuses: snapshot.activeBuses,\n      districtsOwned: snapshot.districtsOwned,\n      cityAreaTiles: snapshot.cityAreaTiles,\n      maxCars: snapshot.maxCars,\n      maxBuses: snapshot.maxBuses,\n      waitingPassengers: snapshot.waitingPassengers,",
    'history district stats',
  );

  content = replaceOnce(
    content,
    "      if (this.cars.length >= GAME_CONFIG.maxCars) return;",
    "      if (this.getPrivateCarCount() >= this.getMaxCars()) return;",
    'dynamic max cars',
  );

  content = replaceOnce(
    content,
    "    const busCount = this.transitLine.stopIds.length >= 5 ? 2 : 1;\n    for (let index = 0; index < busCount; index += 1) {",
    "    const baseBusCount = this.transitLine.stopIds.length >= 5 ? 2 : 1;\n    const busCount = Math.min(\n      this.getMaxBuses(),\n      Math.max(1, baseBusCount * this.getOwnedDistrictCount()),\n      Math.max(1, this.transitLine.stopIds.length),\n    );\n    for (let index = 0; index < busCount; index += 1) {",
    'dynamic max buses',
  );

  const expansionGrowthMethods = `
  private trySpawnEastDistrictBuilding(): Building | null {
    const district = this.getEastDistrict();
    if (!district || district.status !== 'owned') return null;
    if (Math.random() > DISTRICT_EXPANSION_CONFIG.eastGrowthChance) return null;

    const candidates: Vec2[] = [];
    const minX = Math.max(district.xStart + 1, 1);
    const maxX = Math.min(district.xStart + district.width - 2, (this.grid[0]?.length ?? 1) - 2);
    const minY = Math.max(district.yStart + 1, 1);
    const maxY = Math.min(district.yStart + district.height - 2, this.grid.length - 2);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (this.grid[y]?.[x]?.type !== 'empty') continue;
        if (this.isTooCloseToBuilding({ x, y })) continue;
        if (!this.hasRoadNearby({ x, y }, DISTRICT_EXPANSION_CONFIG.eastGrowthRoadRadius)) continue;
        candidates.push({ x, y });
      }
    }

    if (!candidates.length) return null;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    return createBuilding(this.generator.chooseType(this.cityLevel), chosen.x, chosen.y);
  }

  private isTooCloseToBuilding(pos: Vec2): boolean {
    return this.buildings.some((building) => Math.abs(building.x - pos.x) + Math.abs(building.y - pos.y) < 2);
  }

  private hasRoadNearby(pos: Vec2, radius: number): boolean {
    for (let y = pos.y - radius; y <= pos.y + radius; y += 1) {
      for (let x = pos.x - radius; x <= pos.x + radius; x += 1) {
        if (Math.abs(pos.x - x) + Math.abs(pos.y - y) > radius) continue;
        if (isRoadType(this.grid[y]?.[x]?.type)) return true;
      }
    }
    return false;
  }

`;
  content = ensureContains(content, '  private growCity(): void {', expansionGrowthMethods, 'east district growth methods');

  content = replaceOnce(
    content,
    "  private growCity(): void {\n    const stats = this.getSnapshot();\n    if (stats.population > 120) this.cityLevel = Math.max(this.cityLevel, 2);\n    if (stats.population > 280) this.cityLevel = Math.max(this.cityLevel, 3);\n    if (this.satisfaction < 35) return;\n    const building = this.generator.spawn(this.grid, this.buildings, this.cityLevel);\n    if (building) this.addBuilding(building);\n  }",
    "  private growCity(): void {\n    const stats = this.getSnapshot();\n    if (stats.population > 120) this.cityLevel = Math.max(this.cityLevel, 2);\n    if (stats.population > 280) this.cityLevel = Math.max(this.cityLevel, 3);\n    if (this.satisfaction < 35) return;\n    const building = this.trySpawnEastDistrictBuilding() ?? this.generator.spawn(this.grid, this.buildings, this.cityLevel);\n    if (building) this.addBuilding(building);\n  }",
    'growCity east district growth',
  );

  write('src/game/engine/simulation.ts', content);
}

function patchRenderWorld() {
  let content = read('src/game/rendering/renderWorld.ts');

  content = replaceOnce(
    content,
    "  for (let y = 0; y < GAME_CONFIG.gridHeight; y++) {\n    for (let x = 0; x < GAME_CONFIG.gridWidth; x++) {\n      const tile = world.grid[y][x];\n      drawBaseTile(graphics, tile, x, y, ts);",
    "  for (let y = 0; y < world.grid.length; y++) {\n    for (let x = 0; x < (world.grid[y]?.length ?? 0); x++) {\n      const tile = world.grid[y]?.[x];\n      if (!tile) continue;\n      drawBaseTile(graphics, tile, x, y, ts);",
    'dynamic static base loop',
  );

  content = replaceOnce(
    content,
    "  for (let y = 0; y < GAME_CONFIG.gridHeight; y++) {\n    for (let x = 0; x < GAME_CONFIG.gridWidth; x++) {\n      const tile = world.grid[y][x];\n      if (isRoadType(tile.type) && tile.type !== 'roundabout') drawRoadSignage(graphics, world, x, y, ts);",
    "  for (let y = 0; y < world.grid.length; y++) {\n    for (let x = 0; x < (world.grid[y]?.length ?? 0); x++) {\n      const tile = world.grid[y]?.[x];\n      if (!tile) continue;\n      if (isRoadType(tile.type) && tile.type !== 'roundabout') drawRoadSignage(graphics, world, x, y, ts);",
    'dynamic static signage loop',
  );

  content = replaceOnce(
    content,
    "  return { x: Math.floor(GAME_CONFIG.gridWidth / 2), y: Math.floor(GAME_CONFIG.gridHeight / 2) };",
    "  return { x: Math.floor((world.grid[0]?.length ?? GAME_CONFIG.gridWidth) / 2), y: Math.floor((world.grid.length || GAME_CONFIG.gridHeight) / 2) };",
    'dynamic money particle fallback',
  );

  write('src/game/rendering/renderWorld.ts', content);
}

function patchDetailsPanel() {
  let content = read('src/components/DetailsPanel.tsx');
  content = replaceOnce(
    content,
    "import { TrafficChart } from './TrafficChart';",
    "import { TrafficChart } from './TrafficChart';\nimport { DistrictExpansionCard } from './DistrictExpansionCard';",
    'DistrictExpansionCard import',
  );
  content = replaceOnce(
    content,
    "      {selected.kind === 'none' && <p className=\"muted\">Selecione uma rua, prédio ou carro.</p>}\n\n      <TrafficChart world={world} />",
    "      <DistrictExpansionCard world={world} />\n\n      {selected.kind === 'none' && <p className=\"muted\">Selecione uma rua, prédio ou carro.</p>}\n\n      <TrafficChart world={world} />",
    'DistrictExpansionCard placement',
  );
  write('src/components/DetailsPanel.tsx', content);
}

function createDistrictExpansionCard() {
  const content = `import { CheckCircle2, CircleDashed, Map, ShoppingCart } from 'lucide-react';
import type { GameWorld } from '../game/engine/simulation';
import { DISTRICT_EXPANSION_CONFIG } from '../game/config/districtConfig';
import { useGameStore } from '../store/gameStore';

export function DistrictExpansionCard({ world }: { world: GameWorld }) {
  const stats = useGameStore((s) => s.stats);
  const setStats = useGameStore((s) => s.setStats);
  const setSelected = useGameStore((s) => s.setSelected);
  const setActionFeedback = useGameStore((s) => s.setActionFeedback);
  const purchased = world.isEastDistrictPurchased();
  const availability = world.canPurchaseEastDistrict();
  const requirements = availability.requirements;

  const handlePurchase = () => {
    const result = world.purchaseEastDistrict();
    setStats(world.getSnapshot());
    setSelected(world.selected);
    setActionFeedback(result.success
      ? 'Bairro Leste comprado. A área à direita foi liberada para construção.'
      : result.reason ?? 'Não foi possível comprar o bairro.');
  };

  return (
    <div className={'detail-card district-expansion-card ' + (purchased ? 'purchased' : availability.canPurchase ? 'available' : 'locked')}>
      <h3><Map size={15} /> Expansão urbana</h3>
      {purchased ? (
        <>
          <p><span>Status</span><strong className="good">Bairro Leste comprado</strong></p>
          <p><span>Bairros</span><strong>{stats.districtsOwned}</strong></p>
          <p><span>Área liberada</span><strong>{stats.cityAreaTiles} tiles</strong></p>
          <p><span>Carros máximos</span><strong>{stats.activeCars}/{stats.maxCars}</strong></p>
          <p><span>Ônibus máximos</span><strong>{stats.activeBuses}/{stats.maxBuses}</strong></p>
          <p className="muted">Construa vias, ônibus e metrô para conectar o novo bairro ao Centro.</p>
        </>
      ) : (
        <>
          <p><span>Novo bairro</span><strong>{DISTRICT_EXPANSION_CONFIG.eastDistrictName}</strong></p>
          <p><span>Custo</span><strong>$ {DISTRICT_EXPANSION_CONFIG.cost.toLocaleString('pt-BR')}</strong></p>
          <div className="district-requirements">
            {requirements.map((requirement) => (
              <span key={requirement.label} className={requirement.met ? 'met' : 'missing'}>
                {requirement.met ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}
                {requirement.label}
              </span>
            ))}
          </div>
          <div className="district-benefits">
            <span>+100% área construível</span>
            <span>+100% capacidade de carros</span>
            <span>+100% capacidade de ônibus</span>
          </div>
          <button className="district-purchase-button" type="button" disabled={!availability.canPurchase} onClick={handlePurchase}>
            <ShoppingCart size={14} /> Comprar Bairro Leste
          </button>
          {!availability.canPurchase && availability.reason && <p className="muted">{availability.reason}</p>}
        </>
      )}
    </div>
  );
}
`;
  writeNew('src/components/DistrictExpansionCard.tsx', content);
}

function patchStyles() {
  const cssPath = 'src/styles.css';
  let content = read(cssPath);
  if (content.includes('.district-expansion-card')) {
    write(cssPath, content);
    return;
  }
  content += `

.district-expansion-card {
  border-color: rgba(92, 200, 255, 0.24);
  background: linear-gradient(180deg, rgba(92, 200, 255, 0.08), rgba(11, 21, 36, 0.92));
}

.district-expansion-card.available {
  border-color: rgba(53, 208, 127, 0.42);
  box-shadow: 0 0 0 1px rgba(53, 208, 127, 0.08), 0 12px 28px rgba(53, 208, 127, 0.08);
}

.district-expansion-card.purchased {
  border-color: rgba(53, 208, 127, 0.32);
}

.district-requirements,
.district-benefits {
  display: grid;
  gap: 6px;
  margin: 10px 0;
}

.district-requirements span,
.district-benefits span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 12px;
}

.district-requirements span.met {
  color: var(--good);
}

.district-requirements span.missing {
  color: var(--warn);
}

.district-benefits span::before {
  content: "+";
  display: inline-grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: rgba(92, 200, 255, 0.16);
  color: var(--accent);
  font-size: 10px;
  font-weight: 800;
}

.district-purchase-button {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 8px;
  padding: 9px 10px;
  border: 1px solid rgba(92, 200, 255, 0.42);
  border-radius: 9px;
  background: rgba(92, 200, 255, 0.14);
  color: var(--text);
  cursor: pointer;
}

.district-purchase-button:not(:disabled):hover {
  background: rgba(92, 200, 255, 0.22);
}

.district-purchase-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`;
  write(cssPath, content);
}

function patchCityGenerator() {
  let content = read('src/game/city/cityGenerator.ts');
  if (!content.includes('function gridWidth(grid: Tile[][]): number')) {
    content += `

function gridWidth(grid: Tile[][]): number {
  return grid[0]?.length ?? GAME_CONFIG.gridWidth;
}

function gridHeight(grid: Tile[][]): number {
  return grid.length || GAME_CONFIG.gridHeight;
}
`;
  }
  content = replaceAllLiteral(content, 'this.randInt(2, GAME_CONFIG.gridWidth - 3)', 'this.randInt(2, gridWidth(grid) - 3)');
  content = replaceAllLiteral(content, 'this.randInt(2, GAME_CONFIG.gridHeight - 3)', 'this.randInt(2, gridHeight(grid) - 3)');
  content = replaceAllLiteral(content, 'Math.min(GAME_CONFIG.gridWidth - 3, this.corridorAxes.x + spanX)', 'Math.min(gridWidth(grid) - 3, this.corridorAxes.x + spanX)');
  content = replaceAllLiteral(content, 'Math.min(GAME_CONFIG.gridHeight - 3, this.corridorAxes.y + spanY)', 'Math.min(gridHeight(grid) - 3, this.corridorAxes.y + spanY)');
  content = replaceAllLiteral(content, 'x > GAME_CONFIG.gridWidth - 3', 'x > gridWidth(grid) - 3');
  content = replaceAllLiteral(content, 'y > GAME_CONFIG.gridHeight - 3', 'y > gridHeight(grid) - 3');
  write('src/game/city/cityGenerator.ts', content);
}

function patchReadme() {
  const content = `# Expansão urbana V1 — Bairro Leste

Este pacote adiciona a primeira versão de expansão urbana para o jogo Cidade em Fluxo.

## Como aplicar

\`\`\`powershell
cd C:\\Projetos\\city-grid-game
node apply-district-expansion-v1.cjs
npm run build
npm run dev
\`\`\`

## O que entra nesta versão

- Liberação de expansão no nível 3.
- Satisfação mínima reduzida para 55%.
- População mínima de 250.
- Custo de $ 20.000.
- Compra apenas do Bairro Leste.
- Grid aumenta para a direita, dobrando a largura inicial.
- Novos tiles entram como \`empty\`.
- Capacidade máxima de carros dobra com o segundo bairro.
- Capacidade máxima de ônibus dobra com o segundo bairro.
- Card visual de expansão no painel de detalhes.
- Backups automáticos com sufixo \`.bak-district-expansion-v1\`.

## Observação

A V1 não força viagens interbairros. O novo bairro começa vazio e passa a receber construções quando houver vias próximas na área leste.
`;
  writeNew('README-district-expansion-v1.md', content);
}

function main() {
  patchGrid();
  createDistrictConfig();
  patchTypes();
  patchStore();
  patchSimulation();
  patchRenderWorld();
  patchDetailsPanel();
  createDistrictExpansionCard();
  patchStyles();
  patchCityGenerator();
  patchReadme();
  console.log('Expansão urbana V1 aplicada com sucesso.');
  console.log('Arquivos alterados/criados:');
  console.log('- src/game/config/districtConfig.ts');
  console.log('- src/game/city/grid.ts');
  console.log('- src/game/city/cityGenerator.ts');
  console.log('- src/game/engine/simulation.ts');
  console.log('- src/types/city.types.ts');
  console.log('- src/store/gameStore.ts');
  console.log('- src/game/rendering/renderWorld.ts');
  console.log('- src/components/DistrictExpansionCard.tsx');
  console.log('- src/components/DetailsPanel.tsx');
  console.log('- src/styles.css');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
