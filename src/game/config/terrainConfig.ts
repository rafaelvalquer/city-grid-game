export const TERRAIN_CONFIG = {
  enabledByDefault: true,

  protectedCenterRadius: 5,
  protectedSpawnAreaWidth: 12,
  protectedSpawnAreaHeight: 8,

  mountainClusterCount: { min: 3, max: 6 },
  lakeClusterCount: { min: 2, max: 4 },

  smallMountainSize: { min: 4, max: 9 },
  mediumMountainSize: { min: 10, max: 18 },
  largeMountainSize: { min: 19, max: 34 },

  smallLakeSize: { min: 5, max: 12 },
  largeLakeSize: { min: 18, max: 36 },

  maxBlockedRatio: 0.16,
  lakeAnimationSpeed: 0.8,
  mountainShadowAlpha: 0.22,
} as const;
