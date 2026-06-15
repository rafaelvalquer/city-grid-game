import type { MetroStation, MetroTrack } from '../../types/metro.types';

export type MetroGraph = Map<string, Array<{ stationId: string; distance: number }>>;

export function buildMetroGraph(stations: MetroStation[], tracks: MetroTrack[]): MetroGraph {
  const graph: MetroGraph = new Map(stations.map((station) => [station.id, []]));
  for (const track of tracks) {
    if (!track.active) continue;
    if (!graph.has(track.fromStationId) || !graph.has(track.toStationId)) continue;
    graph.get(track.fromStationId)?.push({ stationId: track.toStationId, distance: track.distance });
    graph.get(track.toStationId)?.push({ stationId: track.fromStationId, distance: track.distance });
  }
  return graph;
}

export function findMetroStationPath(
  stations: MetroStation[],
  tracks: MetroTrack[],
  fromStationId: string,
  toStationId: string,
): string[] {
  if (fromStationId === toStationId) return [fromStationId];

  const graph = buildMetroGraph(stations, tracks);
  if (!graph.has(fromStationId) || !graph.has(toStationId)) return [];

  const distances = new Map<string, number>([[fromStationId, 0]]);
  const previous = new Map<string, string>();
  const open = new Set<string>([fromStationId]);

  while (open.size) {
    let current = '';
    let bestDistance = Infinity;
    for (const candidate of open) {
      const distance = distances.get(candidate) ?? Infinity;
      if (distance < bestDistance) {
        bestDistance = distance;
        current = candidate;
      }
    }

    if (!current) break;
    open.delete(current);
    if (current === toStationId) return reconstructMetroPath(previous, current);

    for (const next of graph.get(current) ?? []) {
      const tentative = bestDistance + next.distance;
      if (tentative >= (distances.get(next.stationId) ?? Infinity)) continue;
      distances.set(next.stationId, tentative);
      previous.set(next.stationId, current);
      open.add(next.stationId);
    }
  }

  return [];
}

function reconstructMetroPath(previous: Map<string, string>, current: string): string[] {
  const path = [current];
  while (previous.has(current)) {
    current = previous.get(current)!;
    path.push(current);
  }
  return path.reverse();
}
