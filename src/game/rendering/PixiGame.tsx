import { useEffect, useRef, useState } from 'react';
import type { Application, Container } from 'pixi.js';
import { GameWorld } from '../engine/simulation';
import { GAME_CONFIG } from '../config/gameConfig';
import { useGameStore } from '../../store/gameStore';
import { CanvasToolDock } from '../../components/CanvasToolDock';
import { MetroManagementPanel } from '../../components/MetroManagementPanel';
import { LayerToggle } from '../../components/LayerToggle';
import { createPixiApp, safelyDestroyPixiApp } from './pixiAppLifecycle';
import { createCameraController, type CameraState } from './cameraController';
import { connectInputController, type OneWayLineDrag, type RoadLineDrag } from './inputController';
import { heatmapLabel } from './renderHeatmap';
import { createRenderWorldState, renderWorld } from './renderWorld';
import { ParticleSystem } from './particleSystem';
import { PerformanceDebugPanel } from '../../components/PerformanceDebugPanel';
import type { GraphicsSettings } from '../config/graphicsSettings';

const UI_SYNC_INTERVAL_SECONDS = 0.2;

export function PixiGame({ world, graphics }: { world: GameWorld; graphics: GraphicsSettings }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);
  const isDrawingRef = useRef(false);
  const lastTileRef = useRef<string>('');
  const roadLineDragRef = useRef<RoadLineDrag | null>(null);
  const oneWayLineDragRef = useRef<OneWayLineDrag | null>(null);
  const cameraRef = useRef<CameraState>({ x: 56, y: 42, scale: 0.75 });
  const renderStateRef = useRef(createRenderWorldState());
  const particleSystemRef = useRef<ParticleSystem | null>(null);
  const hoverPreview = useGameStore((s) => s.hoverPreview);
  const actionFeedback = useGameStore((s) => s.actionFeedback);
  const heatmapModeUi = useGameStore((s) => s.heatmapMode);
  const viewLayerUi = useGameStore((s) => s.viewLayer);
  const [metroManagerOpen, setMetroManagerOpen] = useState(false);
  const viewLayer = useGameStore((s) => s.viewLayer);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostElement = host;
    let disposed = false;
    let initialized = false;
    const abortController = new AbortController();
    let app: Application | null = null;
    renderStateRef.current = createRenderWorldState();

    async function start() {
      const view = await createPixiApp(hostElement, graphics);
      app = view.app;
      appRef.current = view.app;
      initialized = true;
      if (disposed) {
        safelyDestroyPixiApp(view.app);
        return;
      }

      stageRef.current = view.root;
      const particles = new ParticleSystem(view.particleLabels, graphics);
      particleSystemRef.current = particles;
      const camera = createCameraController(view.app.canvas, cameraRef.current);
      connectInputController({
        canvas: view.app.canvas,
        signal: abortController.signal,
        world,
        camera,
        particles,
        refs: {
          isDrawingRef,
          lastTileRef,
          roadLineDragRef,
          oneWayLineDragRef,
        },
      });

      const initialState = useGameStore.getState();
      const benchmarkCars = Number(new URLSearchParams(globalThis.location?.search ?? '').get('benchmarkCars') ?? 0);
      if (Number.isFinite(benchmarkCars) && benchmarkCars > 0) {
        world.seedPerformanceBenchmarkCars(benchmarkCars);
      }
      initialState.setStats(world.getSnapshotForUi());
      initialState.setSelected(world.selected);
      let uiTimer = UI_SYNC_INTERVAL_SECONDS;

      view.app.ticker.add((ticker) => {
        const { paused, speed, heatmapMode, viewLayer, mobilityFocusMode, setStats, setSelected, setPerformanceMetrics } = useGameStore.getState();
        const dt = ticker.deltaMS / 1000;
        const visibleBounds = camera.getVisibleTileBounds(3);
        world.performanceProfiler.recordFrame(dt);
        world.performanceProfiler.setCounters({
          activeCars: world.cars.length,
          visibleCars: Math.min(world.countVisibleCarsInBounds(visibleBounds, 2), world.cars.length),
        });
        world.setActiveViewportBounds(visibleBounds);
        const updateStart = performance.now();
        world.update(dt, speed, paused);
        world.performanceProfiler.setCounters({ updateMs: performance.now() - updateStart });
        const hover = useGameStore.getState().hoverPreview;
        const renderStart = performance.now();
        renderWorld(
          view.staticGraphics,
          view.environmentGraphics,
          view.vehicleGraphics,
          view.overlayGraphics,
          view.labels,
          renderStateRef.current,
          world,
          heatmapMode,
          hover,
          cameraRef.current.x,
          cameraRef.current.y,
          cameraRef.current.scale,
          viewLayer,
          mobilityFocusMode,
          particles,
          visibleBounds,
          graphics,
        );
        world.performanceProfiler.recordRender(performance.now() - renderStart);
        applyParticleCamera(view.particleGraphics, view.particleLabels, cameraRef.current);
        particles.update(dt);
        particles.draw(view.particleGraphics, GAME_CONFIG.tileSize);

        uiTimer += dt;
        if (uiTimer >= UI_SYNC_INTERVAL_SECONDS) {
          uiTimer = 0;
          setStats(world.getSnapshotForUi());
          setSelected(world.selected);
          setPerformanceMetrics(world.performanceProfiler.getSnapshot());
        }
      });
    }

    start();
    return () => {
      disposed = true;
      abortController.abort();
      particleSystemRef.current?.destroy();
      particleSystemRef.current = null;
      if (initialized && app) {
        safelyDestroyPixiApp(app);
      }
      appRef.current = null;
    };
  }, [world, graphics]);

  return (
    <main ref={hostRef} className="game-host">
      <div className="canvas-overlay top">
        <span>Alt + arrastar ou botão do meio: mover</span>
        <span>Scroll: zoom</span>
        <span>Clique e arraste: traçar rua/avenida</span>
      </div>
      <LayerToggle />
      <PerformanceDebugPanel enabled={graphics.showPerformanceDebug} />
      <CanvasToolDock />
      <button className={`metro-manager-toggle ${viewLayerUi}`} type="button" onClick={() => setMetroManagerOpen((open) => !open)}>
        {viewLayerUi === 'underground' ? '🚇' : '🚌'} Gerenciar linhas
      </button>
      {metroManagerOpen && <MetroManagementPanel world={world} onClose={() => setMetroManagerOpen(false)} />}
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

function applyParticleCamera(graphics: Container, labels: Container, camera: CameraState): void {
  graphics.position.set(camera.x, camera.y);
  graphics.scale.set(camera.scale);
  labels.position.set(camera.x, camera.y);
  labels.scale.set(camera.scale);
}
