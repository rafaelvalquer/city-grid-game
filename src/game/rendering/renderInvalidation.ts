import type { GameWorld } from '../engine/simulation';
import type { GraphicsSettings } from '../config/graphicsSettings';

/**
 * Static render invalidation now uses GameWorld's numeric render version.
 *
 * Previous versions rebuilt a large string by scanning the whole grid, buildings,
 * transit stops and traffic lights on every frame. The numeric version is updated
 * only when static map content changes, so this check stays O(1) per frame.
 */
export function getStaticRenderSignature(
  world: GameWorld,
  lightingKey = '',
  graphics?: Pick<GraphicsSettings, 'buildingLights' | 'streetFurniture'>,
): string {
  const graphicsKey = graphics ? `${graphics.buildingLights ? 1 : 0}${graphics.streetFurniture ? 1 : 0}` : '';
  return world.getStaticRenderSignature(`${lightingKey}|${graphicsKey}`);
}
