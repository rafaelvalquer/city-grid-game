export const PERFORMANCE_CONFIG = {
  enablePerformanceProfiler: true,

  // Load detection and accelerated render cadence.
  highLoadCars: 700,
  highLoadFrameMs: 48,
  highLoadUpdateMs: 45,
  simulationBudgetMs: 10,
  renderFps2x: 30,
  renderFps2xHighLoad: 15,
  renderFps4x: 20,
  renderFps4xHighLoad: 10,

  // Sort de carros e atualização reduzida.
  reducedSortThresholdCars: 650,
  priorityIntersectionProgressThreshold: 0.9,
  priorityStuckSeconds: 3.2,
  priorityImmobileSeconds: 2.4,

  reducedCarViewportPaddingTiles: 3,
  reducedCarMaxStuckSeconds: 4.5,
  reducedCarUpdateEveryTicks: 3,
  visibleReducedUpdateThresholdCars: 650,
  visibleReducedUpdateEveryTicks: 2,
  visibleReducedUpdateEveryTicksExtreme: 3,
  visibleReducedExtremeCars: 1050,
  visibleReducedIntersectionProgressThreshold: 0.72,

  connectionUpdateHighLoadThresholdCars: 650,
  connectionUpdateIntervalSeconds: 0.22,
  connectionUpdateHighLoadIntervalSeconds: 0.42,

  snapshotThrottleThresholdCars: 700,
  snapshotThrottleMs: 350,

  trafficWorkerThresholdCars: 700,
  trafficWorkerIntervalSeconds: 0.16,
  trafficWorkerHighLoadThresholdCars: 1000,
  trafficWorkerHighLoadIntervalSeconds: 0.24,

  // Geração de viagens com orçamento em carga alta.
  tripBudgetThresholdCars: 700,
  tripAttemptBudgetHighLoad: 10,
  tripAttemptBudgetExtremeLoad: 5,
  tripSpawnBudgetHighLoad: 4,
  tripSpawnBudgetExtremeLoad: 2,
  tripBudgetExtremeCars: 1000,
  tripBudgetDebtMax: 80,

  // Pathfinding worker com throttle/dedup/cache.
  pathfindingWorkerThresholdCars: 650,
  pathfindingWorkerMaxWorkers: 4,
  pathfindingWorkerMaxPending: 80,
  pathfindingWorkerMaxPendingHighLoad: 32,
  pathfindingWorkerMaxPendingExtremeLoad: 14,
  pathfindingWorkerTimeoutMs: 1800,
  pathfindingWorkerHighLoadRequestsPerSecond: 16,
  pathfindingWorkerExtremeRequestsPerSecond: 8,
  pathfindingWorkerSnapshotSyncMs: 450,

  // LOD visual para zoom aberto e carga alta.
  vehicleLodScaleThreshold: 0.56,
  vehicleLodHighLoadScaleThreshold: 0.72,
  vehicleLodHighLoadCars: 850,

  // Simulação em grupos.
  groupedCarUpdateThreshold: 300,
  groupedCarUpdateExtremeThreshold: 700,
  groupedCarUpdateBatches: 2,
  groupedCarUpdateExtremeBatches: 3,
  groupedCarViewportPaddingTiles: 4,
  groupedCarMaxAccumulatedDt: 0.12,
  groupedCarIntersectionPromotionProgress: 0.62,

  // Frequência independente das camadas de renderização.
  environmentRenderFps: 30,
  environmentRenderHighLoadFps: 15,
  overlayRenderFps: 20,
  overlayRenderHighLoadFps: 10,
  enableEntityIndexValidation: false,
  entityIndexValidationEveryTicks: 300,
} as const;
