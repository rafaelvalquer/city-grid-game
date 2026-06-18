export type GraphicsProfile = 'low' | 'medium' | 'high' | 'custom';
export type GraphicsResolutionScale = 0.75 | 1 | 1.25;
export type VehicleDetailLevel = 'simplified' | 'auto' | 'full';
export type EnvironmentFps = 15 | 30 | 60;

export type GraphicsSettings = {
  profile: GraphicsProfile;
  resolutionScale: GraphicsResolutionScale;
  antialias: boolean;
  vehicleShadows: boolean;
  vehicleLights: boolean;
  buildingLights: boolean;
  streetLights: boolean;
  atmosphereOverlay: boolean;
  pedestrians: boolean;
  streetFurniture: boolean;
  terrainAnimations: boolean;
  constructionParticles: boolean;
  congestionSmoke: boolean;
  vehicleDetail: VehicleDetailLevel;
  environmentFps: EnvironmentFps;
  showPerformanceDebug: boolean;
};

export const LEGACY_GRAPHICS_SETTINGS_STORAGE_KEY = 'cityGraphicsSettings:v1';

type PresetSettings = Omit<GraphicsSettings, 'profile' | 'showPerformanceDebug'>;

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsProfile, 'custom'>, PresetSettings> = {
  low: {
    resolutionScale: 0.75,
    antialias: false,
    vehicleShadows: false,
    vehicleLights: false,
    buildingLights: false,
    streetLights: false,
    atmosphereOverlay: false,
    pedestrians: false,
    streetFurniture: false,
    terrainAnimations: false,
    constructionParticles: false,
    congestionSmoke: false,
    vehicleDetail: 'simplified',
    environmentFps: 15,
  },
  medium: {
    resolutionScale: 1,
    antialias: true,
    vehicleShadows: true,
    vehicleLights: true,
    buildingLights: true,
    streetLights: true,
    atmosphereOverlay: true,
    pedestrians: true,
    streetFurniture: true,
    terrainAnimations: true,
    constructionParticles: true,
    congestionSmoke: true,
    vehicleDetail: 'auto',
    environmentFps: 30,
  },
  high: {
    resolutionScale: 1.25,
    antialias: true,
    vehicleShadows: true,
    vehicleLights: true,
    buildingLights: true,
    streetLights: true,
    atmosphereOverlay: true,
    pedestrians: true,
    streetFurniture: true,
    terrainAnimations: true,
    constructionParticles: true,
    congestionSmoke: true,
    vehicleDetail: 'full',
    environmentFps: 60,
  },
};

export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  profile: 'medium',
  ...GRAPHICS_PRESETS.medium,
  showPerformanceDebug: false,
};

export function getGraphicsRendererOptions(settings: GraphicsSettings, devicePixelRatio = 1): {
  antialias: boolean;
  resolution: number;
} {
  return {
    antialias: settings.antialias,
    resolution: Math.max(1, devicePixelRatio || 1) * settings.resolutionScale,
  };
}

export function applyGraphicsPreset(
  profile: Exclude<GraphicsProfile, 'custom'>,
  current: GraphicsSettings,
): GraphicsSettings {
  return {
    profile,
    ...GRAPHICS_PRESETS[profile],
    showPerformanceDebug: current.showPerformanceDebug,
  };
}

export function updateGraphicsSetting<K extends keyof GraphicsSettings>(
  current: GraphicsSettings,
  key: K,
  value: GraphicsSettings[K],
): GraphicsSettings {
  const next = { ...current, [key]: value };
  if (key === 'showPerformanceDebug') return next;
  return { ...next, profile: detectGraphicsProfile(next) };
}

export function detectGraphicsProfile(settings: GraphicsSettings): GraphicsProfile {
  for (const profile of ['low', 'medium', 'high'] as const) {
    const preset = GRAPHICS_PRESETS[profile];
    if (Object.entries(preset).every(([key, value]) => settings[key as keyof PresetSettings] === value)) {
      return profile;
    }
  }
  return 'custom';
}

export function normalizeGraphicsSettings(value: unknown): GraphicsSettings {
  if (!value || typeof value !== 'object') return DEFAULT_GRAPHICS_SETTINGS;
  const source = value as Partial<GraphicsSettings>;
  const normalized: GraphicsSettings = {
    ...DEFAULT_GRAPHICS_SETTINGS,
    resolutionScale: isOneOf(source.resolutionScale, [0.75, 1, 1.25]) ? source.resolutionScale : DEFAULT_GRAPHICS_SETTINGS.resolutionScale,
    antialias: booleanOrDefault(source.antialias, DEFAULT_GRAPHICS_SETTINGS.antialias),
    vehicleShadows: booleanOrDefault(source.vehicleShadows, DEFAULT_GRAPHICS_SETTINGS.vehicleShadows),
    vehicleLights: booleanOrDefault(source.vehicleLights, DEFAULT_GRAPHICS_SETTINGS.vehicleLights),
    buildingLights: booleanOrDefault(source.buildingLights, DEFAULT_GRAPHICS_SETTINGS.buildingLights),
    streetLights: booleanOrDefault(source.streetLights, DEFAULT_GRAPHICS_SETTINGS.streetLights),
    atmosphereOverlay: booleanOrDefault(source.atmosphereOverlay, DEFAULT_GRAPHICS_SETTINGS.atmosphereOverlay),
    pedestrians: booleanOrDefault(source.pedestrians, DEFAULT_GRAPHICS_SETTINGS.pedestrians),
    streetFurniture: booleanOrDefault(source.streetFurniture, DEFAULT_GRAPHICS_SETTINGS.streetFurniture),
    terrainAnimations: booleanOrDefault(source.terrainAnimations, DEFAULT_GRAPHICS_SETTINGS.terrainAnimations),
    constructionParticles: booleanOrDefault(source.constructionParticles, DEFAULT_GRAPHICS_SETTINGS.constructionParticles),
    congestionSmoke: booleanOrDefault(source.congestionSmoke, DEFAULT_GRAPHICS_SETTINGS.congestionSmoke),
    vehicleDetail: isOneOf(source.vehicleDetail, ['simplified', 'auto', 'full']) ? source.vehicleDetail : DEFAULT_GRAPHICS_SETTINGS.vehicleDetail,
    environmentFps: isOneOf(source.environmentFps, [15, 30, 60]) ? source.environmentFps : DEFAULT_GRAPHICS_SETTINGS.environmentFps,
    showPerformanceDebug: booleanOrDefault(source.showPerformanceDebug, DEFAULT_GRAPHICS_SETTINGS.showPerformanceDebug),
    profile: 'custom',
  };
  normalized.profile = detectGraphicsProfile(normalized);
  return normalized;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isOneOf<T>(value: unknown, options: readonly T[]): value is T {
  return options.includes(value as T);
}
