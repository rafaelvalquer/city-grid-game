import { Gauge } from 'lucide-react';
import { useGameStore } from '../store/gameStore';

export function PerformanceDebugPanel({ enabled }: { enabled: boolean }) {
  const metrics = useGameStore((s) => s.performanceMetrics);
  if (!enabled) return null;
  if (!metrics) return null;

  return (
    <section className="performance-debug-panel" aria-label="Performance">
      <header><Gauge size={14} /> Performance V4</header>
      <div><span>FPS</span><strong>{metrics.fps}</strong></div>
      <div><span>Frame</span><strong>{metrics.frameMs.toFixed(1)}ms</strong></div>
      <div><span>Frame P95</span><strong>{metrics.frameP95Ms.toFixed(1)}ms</strong></div>
      <div><span>Fixed steps</span><strong>{metrics.fixedSteps}</strong></div>
      <div><span>Dívida inicial</span><strong>{metrics.simulationDebtBeforeMs.toFixed(1)}ms</strong></div>
      <div><span>Dívida restante</span><strong>{metrics.simulationDebtRemainingMs.toFixed(1)}ms</strong></div>
      <div><span>Steps pendentes</span><strong>{metrics.simulationPendingStepsBefore} → {metrics.simulationPendingStepsAfter}</strong></div>
      <div><span>Fatia sim.</span><strong>{metrics.simulationSliceMs.toFixed(1)}ms</strong></div>
      <div><span>Orçamento esgotado</span><strong>{metrics.simulationBudgetExhausted ? 'sim' : 'não'}</strong></div>
      <div><span>Renders omitidos</span><strong>{metrics.renderFramesSkipped}</strong></div>
      <div><span>Carga alta</span><strong>{metrics.highLoadMode ? 'sim' : 'não'}</strong></div>
      <div><span>Carros</span><strong>{metrics.activeCars}</strong></div>
      <div><span>Visíveis</span><strong>{metrics.visibleCars}</strong></div>
      <div><span>Update</span><strong>{metrics.updateMs.toFixed(1)}ms</strong></div>
      <div><span>Step médio</span><strong>{metrics.updateStepMs.toFixed(1)}ms</strong></div>
      <div><span>Carros</span><strong>{metrics.updateCarsMs.toFixed(1)}ms</strong></div>
      <div><span>Agrupamento</span><strong>{metrics.carGroupingMs.toFixed(1)}ms</strong></div>
      <div><span>Detalhados</span><strong>{metrics.detailedCarsMs.toFixed(1)}ms</strong></div>
      <div><span>Leves</span><strong>{metrics.lightweightCarsMs.toFixed(1)}ms</strong></div>
      <div><span>Tráfego</span><strong>{metrics.trafficMapMs.toFixed(1)}ms</strong></div>
      <div><span>Traffic worker</span><strong>{metrics.trafficWorkerMs.toFixed(1)}ms</strong></div>
      <div><span>Render</span><strong>{metrics.renderWorldMs.toFixed(1)}ms</strong></div>
      <div><span>Ambiente</span><strong>{metrics.environmentRenderMs.toFixed(1)}ms</strong></div>
      <div><span>Veículos</span><strong>{metrics.vehicleRenderMs.toFixed(1)}ms</strong></div>
      <div><span>Overlays</span><strong>{metrics.overlayRenderMs.toFixed(1)}ms</strong></div>
      <div><span>Camada aérea</span><strong>{metrics.airRenderMs.toFixed(1)}ms</strong></div>
      <div><span>LOD veículos</span><strong>{metrics.vehicleLodCars}</strong></div>
      <div><span>Snapshot</span><strong>{metrics.snapshotMs.toFixed(1)}ms</strong></div>
      <div><span>Transit</span><strong>{metrics.transitStopsMs.toFixed(1)}ms</strong></div>
      <div><span>Metro</span><strong>{metrics.metroMs.toFixed(1)}ms</strong></div>
      <div><span>Helicópteros</span><strong>{metrics.helicopterMs.toFixed(1)}ms</strong></div>
      <div><span>Bikes</span><strong>{metrics.bikeTripsMs.toFixed(1)}ms</strong></div>
      <div><span>Economia</span><strong>{metrics.economyMs.toFixed(1)}ms</strong></div>
      <div><span>Trips</span><strong>{metrics.generateTripsMs.toFixed(1)}ms</strong></div>
      <div><span>Trip skip</span><strong>{metrics.tripAttemptsSkipped}</strong></div>
      <div><span>Spawn skip</span><strong>{metrics.tripSpawnsSkipped}</strong></div>
      <div><span>Path sync</span><strong>{metrics.pathfindingSyncMs.toFixed(1)}ms</strong></div>
      <div><span>Path worker</span><strong>{metrics.pathfindingWorkerMs.toFixed(1)}ms</strong></div>
      <div><span>Path pend.</span><strong>{metrics.pathfindingPending}</strong></div>
      <div><span>Path dedup</span><strong>{metrics.pathfindingDeduped}</strong></div>
      <div><span>Path throttle</span><strong>{metrics.pathfindingThrottled}</strong></div>
      <div><span>Path drop</span><strong>{metrics.pathfindingDropped}</strong></div>
      <div><span>Sort prioridade</span><strong>{metrics.sortedPriorityCars}</strong></div>
      <div><span>Sort normal</span><strong>{metrics.sortedNormalCars}</strong></div>
      <div><span>Leves</span><strong>{metrics.reducedCars}</strong></div>
      <div><span>Críticos</span><strong>{metrics.criticalCars}</strong></div>
      <div><span>Visíveis det.</span><strong>{metrics.visibleDetailedCars}</strong></div>
      <div><span>Fundo atualizado</span><strong>{metrics.backgroundCarsUpdated}/{metrics.backgroundCars}</strong></div>
    </section>
  );
}
