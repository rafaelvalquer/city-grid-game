import {
  DEFAULT_GRAPHICS_SETTINGS,
  LEGACY_GRAPHICS_SETTINGS_STORAGE_KEY,
  normalizeGraphicsSettings,
  type GraphicsSettings,
} from './graphicsSettings.ts';

export type BuildingSpawnMode = 'organic' | 'compact' | 'districts' | 'corridors' | 'gridBlocks';

export type GameSetupOptions = {
  spawnMode: BuildingSpawnMode;
  allowRoadDemolition: boolean;
  enableTerrainRelief: boolean;
  graphics: GraphicsSettings;
};

export const DEFAULT_GAME_SETUP: GameSetupOptions = {
  spawnMode: 'organic',
  allowRoadDemolition: false,
  enableTerrainRelief: true,
  graphics: DEFAULT_GRAPHICS_SETTINGS,
};

export const GAME_SETUP_STORAGE_KEY = 'cityGameSetup:v2';
const LEGACY_SPAWN_MODE_STORAGE_KEY = 'citySpawnMode';
const LEGACY_ROAD_DEMOLITION_STORAGE_KEY = 'cityAllowRoadDemolition';
const LEGACY_TERRAIN_RELIEF_STORAGE_KEY = 'cityEnableTerrainRelief';

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

export function loadGameSetupOptions(storage: ReadStorage = localStorage): GameSetupOptions {
  try {
    const current = storage.getItem(GAME_SETUP_STORAGE_KEY);
    if (current) return normalizeGameSetupOptions(JSON.parse(current));

    return normalizeGameSetupOptions({
      spawnMode: storage.getItem(LEGACY_SPAWN_MODE_STORAGE_KEY),
      allowRoadDemolition: storage.getItem(LEGACY_ROAD_DEMOLITION_STORAGE_KEY) === '1',
      enableTerrainRelief: legacyBoolean(storage.getItem(LEGACY_TERRAIN_RELIEF_STORAGE_KEY), DEFAULT_GAME_SETUP.enableTerrainRelief),
      graphics: parseLegacyGraphics(storage.getItem(LEGACY_GRAPHICS_SETTINGS_STORAGE_KEY)),
    });
  } catch {
    return cloneDefaultGameSetup();
  }
}

export function saveGameSetupOptions(options: GameSetupOptions, storage: WriteStorage = localStorage): void {
  storage.setItem(GAME_SETUP_STORAGE_KEY, JSON.stringify(normalizeGameSetupOptions(options)));
}

export function normalizeGameSetupOptions(value: unknown): GameSetupOptions {
  if (!value || typeof value !== 'object') return cloneDefaultGameSetup();
  const source = value as Partial<GameSetupOptions>;
  return {
    spawnMode: normalizeSpawnMode(source.spawnMode),
    allowRoadDemolition: typeof source.allowRoadDemolition === 'boolean'
      ? source.allowRoadDemolition
      : DEFAULT_GAME_SETUP.allowRoadDemolition,
    enableTerrainRelief: typeof source.enableTerrainRelief === 'boolean'
      ? source.enableTerrainRelief
      : DEFAULT_GAME_SETUP.enableTerrainRelief,
    graphics: normalizeGraphicsSettings(source.graphics),
  };
}

function parseLegacyGraphics(raw: string | null): unknown {
  if (!raw) return DEFAULT_GRAPHICS_SETTINGS;
  try {
    return JSON.parse(raw);
  } catch {
    return DEFAULT_GRAPHICS_SETTINGS;
  }
}

function legacyBoolean(raw: string | null, fallback: boolean): boolean {
  return raw === null ? fallback : raw === '1';
}

function cloneDefaultGameSetup(): GameSetupOptions {
  return { ...DEFAULT_GAME_SETUP, graphics: { ...DEFAULT_GRAPHICS_SETTINGS } };
}

export const BUILDING_SPAWN_MODES: Array<{
  id: BuildingSpawnMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'organic',
    label: 'Aleatório atual',
    shortLabel: 'Aleatório',
    description: 'Crescimento semi-aleatório ao redor da cidade, mantendo o comportamento atual.',
  },
  {
    id: 'compact',
    label: 'Núcleo compacto',
    shortLabel: 'Compacto',
    description: 'Prédios nascem perto de um centro urbano, criando uma cidade mais densa.',
  },
  {
    id: 'districts',
    label: 'Bairros por zonas',
    shortLabel: 'Bairros',
    description: 'Casas, comércios e escritórios tendem a formar regiões distintas.',
  },
  {
    id: 'corridors',
    label: 'Corredores principais',
    shortLabel: 'Corredores',
    description: 'Construções aparecem perto de eixos, favorecendo avenidas e vias longas.',
  },
  {
    id: 'gridBlocks',
    label: 'Quadras planejadas',
    shortLabel: 'Quadras',
    description: 'Prédios respeitam blocos mais regulares, deixando espaço para ruas eficientes.',
  },
];

export function normalizeSpawnMode(value: unknown): BuildingSpawnMode {
  return BUILDING_SPAWN_MODES.some((mode) => mode.id === value)
    ? value as BuildingSpawnMode
    : DEFAULT_GAME_SETUP.spawnMode;
}
