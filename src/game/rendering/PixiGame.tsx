import { useEffect, useRef } from 'react';
import type { Application, Container } from 'pixi.js';
import { GameWorld } from '../engine/simulation';
import { useGameStore } from '../../store/gameStore';
import { CanvasToolDock } from '../../components/CanvasToolDock';
import { createPixiApp, safelyDestroyPixiApp } from './pixiAppLifecycle';
import { createCameraController, type CameraState } from './cameraController';
import { connectInputController, type OneWayLineDrag, type RoadLineDrag } from './inputController';
import { heatmapLabel } from './renderHeatmap';
import { createRenderWorldState, renderWorld } from './renderWorld';

const UI_SYNC_INTERVAL_SECONDS = 0.2;

export function PixiGame({ world }: { world: GameWorld }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);
  const isDrawingRef = useRef(false);
  const lastTileRef = useRef<string>('');
  const roadLineDragRef = useRef<RoadLineDrag | null>(null);
  const oneWayLineDragRef = useRef<OneWayLineDrag | null>(null);
  const cameraRef = useRef<CameraState>({ x: 56, y: 42, scale: 0.75 });
  const renderStateRef = useRef(createRenderWorldState());
  const hoverPreview = useGameStore((s) => s.hoverPreview);
  const actionFeedback = useGameStore((s) => s.actionFeedback);
  const heatmapModeUi = useGameStore((s) => s.heatmapMode);

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
      const view = await createPixiApp(hostElement);
      app = view.app;
      appRef.current = view.app;
      initialized = true;
      if (disposed) {
        safelyDestroyPixiApp(view.app);
        return;
      }

      stageRef.current = view.root;
      const camera = createCameraController(view.app.canvas, cameraRef.current);
      connectInputController({
        canvas: view.app.canvas,
        signal: abortController.signal,
        world,
        camera,
        refs: {
          isDrawingRef,
          lastTileRef,
          roadLineDragRef,
          oneWayLineDragRef,
        },
      });

      const initialState = useGameStore.getState();
      initialState.setStats(world.getSnapshot());
      initialState.setSelected(world.selected);
      let uiTimer = UI_SYNC_INTERVAL_SECONDS;

      view.app.ticker.add((ticker) => {
        const { paused, speed, heatmapMode, setStats, setSelected } = useGameStore.getState();
        const dt = ticker.deltaMS / 1000;
        world.update(dt, speed, paused);
        const hover = useGameStore.getState().hoverPreview;
        renderWorld(
          view.staticGraphics,
          view.dynamicGraphics,
          view.labels,
          renderStateRef.current,
          world,
          heatmapMode,
          hover,
          cameraRef.current.x,
          cameraRef.current.y,
          cameraRef.current.scale,
        );

        uiTimer += dt;
        if (uiTimer >= UI_SYNC_INTERVAL_SECONDS) {
          uiTimer = 0;
          setStats(world.getSnapshot());
          setSelected(world.selected);
        }
      });
    }

    start();
    return () => {
      disposed = true;
      abortController.abort();
      if (initialized && app) {
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
        <span>Clique e arraste: traçar rua/avenida</span>
      </div>
      <CanvasToolDock />
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
