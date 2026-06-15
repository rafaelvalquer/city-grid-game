import { Application, Container, Graphics } from 'pixi.js';
import { MAP_COLORS } from './visualTheme';

export type PixiWorldView = {
  app: Application;
  root: Container;
  graphics: Graphics;
  labels: Container;
};

export async function createPixiApp(hostElement: HTMLDivElement, app = new Application()): Promise<PixiWorldView> {
  await app.init({ background: MAP_COLORS.bg, antialias: true, resizeTo: hostElement });
  hostElement.appendChild(app.canvas);
  app.canvas.className = 'game-canvas';

  const root = new Container();
  app.stage.addChild(root);

  const graphics = new Graphics();
  const labels = new Container();
  root.addChild(graphics);
  root.addChild(labels);

  return { app, root, graphics, labels };
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
