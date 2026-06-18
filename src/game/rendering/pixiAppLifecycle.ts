import { Application, Container, Graphics } from 'pixi.js';
import { MAP_COLORS } from './visualTheme';
import type { GraphicsSettings } from '../config/graphicsSettings';
import { getGraphicsRendererOptions } from '../config/graphicsSettings';

export type PixiWorldView = {
  app: Application;
  root: Container;
  staticGraphics: Graphics;
  environmentGraphics: Graphics;
  vehicleGraphics: Graphics;
  airGraphics: Graphics;
  overlayGraphics: Graphics;
  particleGraphics: Graphics;
  particleLabels: Container;
  labels: Container;
};

export async function createPixiApp(
  hostElement: HTMLDivElement,
  graphics: GraphicsSettings,
  app = new Application(),
): Promise<PixiWorldView> {
  const rendererOptions = getGraphicsRendererOptions(graphics, globalThis.devicePixelRatio);
  await app.init({
    background: MAP_COLORS.bg,
    antialias: rendererOptions.antialias,
    autoDensity: true,
    resolution: rendererOptions.resolution,
    resizeTo: hostElement,
  });
  hostElement.appendChild(app.canvas);
  app.canvas.className = 'game-canvas';

  const root = new Container();
  app.stage.addChild(root);

  const staticGraphics = new Graphics();
  const environmentGraphics = new Graphics();
  const vehicleGraphics = new Graphics();
  const airGraphics = new Graphics();
  const overlayGraphics = new Graphics();
  const particleGraphics = new Graphics();
  const particleLabels = new Container();
  const labels = new Container();
  root.addChild(staticGraphics);
  root.addChild(environmentGraphics);
  root.addChild(vehicleGraphics);
  root.addChild(airGraphics);
  root.addChild(overlayGraphics);
  root.addChild(particleGraphics);
  root.addChild(particleLabels);
  root.addChild(labels);

  return {
    app,
    root,
    staticGraphics,
    environmentGraphics,
    vehicleGraphics,
    airGraphics,
    overlayGraphics,
    particleGraphics,
    particleLabels,
    labels,
  };
}

export function safelyDestroyPixiApp(app: Application): void {
  try {
    const maybeApp = app as unknown as { _cancelResize?: () => void; destroy: Application['destroy'] };
    if (typeof maybeApp._cancelResize !== 'function') {
      maybeApp._cancelResize = () => undefined;
    }
    app.destroy(true, { children: true, texture: true });
  } catch (error) {
    console.warn('Pixi cleanup ignored:', error);
  }
}
