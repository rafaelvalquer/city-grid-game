import assert from 'node:assert/strict';
import {
  DEFAULT_GRAPHICS_SETTINGS,
  GRAPHICS_PRESETS,
  applyGraphicsPreset,
  getGraphicsRendererOptions,
  normalizeGraphicsSettings,
  updateGraphicsSetting,
} from '../src/game/config/graphicsSettings.ts';
import {
  GAME_SETUP_STORAGE_KEY,
  loadGameSetupOptions,
  normalizeGameSetupOptions,
  saveGameSetupOptions,
} from '../src/game/config/gameSetup.ts';

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

assert.deepEqual(DEFAULT_GRAPHICS_SETTINGS, {
  profile: 'medium',
  ...GRAPHICS_PRESETS.medium,
  showPerformanceDebug: false,
});
assert.deepEqual(getGraphicsRendererOptions(applyGraphicsPreset('low', DEFAULT_GRAPHICS_SETTINGS), 2), {
  antialias: false,
  resolution: 1.5,
});
assert.deepEqual(getGraphicsRendererOptions(applyGraphicsPreset('high', DEFAULT_GRAPHICS_SETTINGS), 2), {
  antialias: true,
  resolution: 2.5,
});

for (const profile of ['low', 'medium', 'high']) {
  const applied = applyGraphicsPreset(profile, { ...DEFAULT_GRAPHICS_SETTINGS, showPerformanceDebug: true });
  assert.deepEqual(applied, { profile, ...GRAPHICS_PRESETS[profile], showPerformanceDebug: true });
}

assert.equal(
  updateGraphicsSetting(DEFAULT_GRAPHICS_SETTINGS, 'vehicleShadows', false).profile,
  'custom',
);
assert.equal(
  updateGraphicsSetting(
    updateGraphicsSetting(DEFAULT_GRAPHICS_SETTINGS, 'vehicleShadows', false),
    'vehicleShadows',
    true,
  ).profile,
  'medium',
);

const invalid = normalizeGraphicsSettings({
  resolutionScale: 3,
  environmentFps: 12,
  vehicleDetail: 'ultra',
  antialias: 'yes',
});
assert.deepEqual(invalid, DEFAULT_GRAPHICS_SETTINGS);

const storage = new MemoryStorage();
storage.setItem('citySpawnMode', 'districts');
storage.setItem('cityAllowRoadDemolition', '1');
storage.setItem('cityEnableTerrainRelief', '0');
storage.setItem('cityGraphicsSettings:v1', JSON.stringify(applyGraphicsPreset('high', DEFAULT_GRAPHICS_SETTINGS)));
const migrated = loadGameSetupOptions(storage);
assert.equal(migrated.spawnMode, 'districts');
assert.equal(migrated.allowRoadDemolition, true);
assert.equal(migrated.enableTerrainRelief, false);
assert.equal(migrated.graphics.profile, 'high');

saveGameSetupOptions(migrated, storage);
assert.ok(storage.getItem(GAME_SETUP_STORAGE_KEY));
assert.deepEqual(loadGameSetupOptions(storage), migrated);

storage.setItem(GAME_SETUP_STORAGE_KEY, JSON.stringify({
  spawnMode: 'invalid',
  allowRoadDemolition: 'invalid',
  enableTerrainRelief: null,
  graphics: { resolutionScale: 8 },
}));
assert.deepEqual(loadGameSetupOptions(storage), normalizeGameSetupOptions({}));

console.log('graphics settings tests passed');
