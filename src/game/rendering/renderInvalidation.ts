import type { GameWorld } from '../engine/simulation';

export function getStaticRenderSignature(world: GameWorld): string {
  const parts: string[] = [];

  for (const row of world.grid) {
    for (const tile of row) {
      if (tile.type === 'empty') continue;
      parts.push(`${tile.x},${tile.y}:${tile.type}:${'oneWay' in tile ? tile.oneWay ?? '' : ''}:${'buildingId' in tile ? tile.buildingId ?? '' : ''}`);
    }
  }

  parts.push('buildings');
  for (const building of world.buildings) {
    parts.push(`${building.id}:${building.x},${building.y}:${building.type}:l${building.level}:c${building.connected ? 1 : 0}`);
  }

  parts.push('stops');
  for (const stop of world.transitStops) {
    parts.push(`${stop.id}:${stop.x},${stop.y}:${stop.accessRoad?.x ?? ''},${stop.accessRoad?.y ?? ''}`);
  }

  parts.push('lights');
  for (const light of world.trafficLights.values()) {
    parts.push(`${light.x},${light.y}`);
  }

  return parts.join('|');
}
