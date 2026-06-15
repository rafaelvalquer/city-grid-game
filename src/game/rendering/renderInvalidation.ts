import type { GameWorld } from '../engine/simulation';

/**
 * Static render invalidation now uses GameWorld's numeric render version.
 *
 * Previous versions rebuilt a large string by scanning the whole grid, buildings,
 * transit stops and traffic lights on every frame. The numeric version is updated
 * only when static map content changes, so this check stays O(1) per frame.
 */
export function getStaticRenderSignature(world: GameWorld, lightingKey = ''): string {
  return world.getStaticRenderSignature(lightingKey);
}
