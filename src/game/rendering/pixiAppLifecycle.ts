import { Application, Container, Graphics } from 'pixi.js';
import { MAP_COLORS } from './visualTheme';

export type PixiWorldView = {
  app: Application;
  root: Container;
  staticGraphics: Graphics;
  dynamicGraphics: Graphics;
  particleGraphics: Graphics;
  particleLabels: Container;
  labels: Container;
};

export async function createPixiApp(hostElement: HTMLDivElement, app = new Application()): Promise<PixiWorldView> {
  await app.init({ background: MAP_COLORS.bg, antialias: true, resizeTo: hostElement });
  hostElement.appendChild(app.canvas);
  app.canvas.className = 'game-canvas';

  const root = new Container();
  app.stage.addChild(root);

  const staticGraphics = new Graphics();
  const dynamicGraphics = new Graphics();
  const particleGraphics = new Graphics();
  const particleLabels = new Container();
  const labels = new Container();
  root.addChild(staticGraphics);
  root.addChild(dynamicGraphics);
  root.addChild(particleGraphics);
  root.addChild(particleLabels);
  root.addChild(labels);

  return { app, root, staticGraphics, dynamicGraphics, particleGraphics, particleLabels, labels };
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
