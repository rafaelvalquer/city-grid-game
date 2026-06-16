export type BuildingSpawnMode = 'organic' | 'compact' | 'districts' | 'corridors' | 'gridBlocks';

export type GameSetupOptions = {
  spawnMode: BuildingSpawnMode;
  allowRoadDemolition: boolean;
  enableTerrainRelief: boolean;
};

export const DEFAULT_GAME_SETUP: GameSetupOptions = {
  spawnMode: 'organic',
  allowRoadDemolition: false,
  enableTerrainRelief: true,
};

export const BUILDING_SPAWN_MODES: Array<{
  id: BuildingSpawnMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'organic',
    label: 'Aleatório atual',
    shortLabel: 'Aleatório',
    description: 'Crescimento semi-aleatório ao redor da cidade, mantendo o comportamento atual.',
  },
  {
    id: 'compact',
    label: 'Núcleo compacto',
    shortLabel: 'Compacto',
    description: 'Prédios nascem perto de um centro urbano, criando uma cidade mais densa.',
  },
  {
    id: 'districts',
    label: 'Bairros por zonas',
    shortLabel: 'Bairros',
    description: 'Casas, comércios e escritórios tendem a formar regiões distintas.',
  },
  {
    id: 'corridors',
    label: 'Corredores principais',
    shortLabel: 'Corredores',
    description: 'Construções aparecem perto de eixos, favorecendo avenidas e vias longas.',
  },
  {
    id: 'gridBlocks',
    label: 'Quadras planejadas',
    shortLabel: 'Quadras',
    description: 'Prédios respeitam blocos mais regulares, deixando espaço para ruas eficientes.',
  },
];

export function normalizeSpawnMode(value: unknown): BuildingSpawnMode {
  return BUILDING_SPAWN_MODES.some((mode) => mode.id === value)
    ? value as BuildingSpawnMode
    : DEFAULT_GAME_SETUP.spawnMode;
}
