import { GAME_CONFIG } from '../config/gameConfig';
import type { Vec2 } from '../../types/city.types';

export type CameraState = {
  x: number;
  y: number;
  scale: number;
};

export type CameraController = {
  state: CameraState;
  toWorldTile: (clientX: number, clientY: number) => Vec2;
  handlePointerDown: (event: PointerEvent) => boolean;
  handlePointerMove: (event: PointerEvent) => boolean;
  handleWheel: (event: WheelEvent) => void;
  stopPanning: () => void;
};

export function createCameraController(canvas: HTMLCanvasElement, state: CameraState): CameraController {
  const panning = { active: false, x: 0, y: 0 };

  return {
    state,
    toWorldTile(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const worldX = (px - state.x) / state.scale;
      const worldY = (py - state.y) / state.scale;
      return {
        x: Math.floor(worldX / GAME_CONFIG.tileSize),
        y: Math.floor(worldY / GAME_CONFIG.tileSize),
      };
    },
    handlePointerDown(event) {
      if (event.button !== 1 && !event.altKey) return false;
      panning.active = true;
      panning.x = event.clientX;
      panning.y = event.clientY;
      return true;
    },
    handlePointerMove(event) {
      if (!panning.active) return false;
      state.x += event.clientX - panning.x;
      state.y += event.clientY - panning.y;
      panning.x = event.clientX;
      panning.y = event.clientY;
      return true;
    },
    handleWheel(event) {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      state.scale = Math.max(0.45, Math.min(2.2, state.scale * factor));
    },
    stopPanning() {
      panning.active = false;
    },
  };
}
