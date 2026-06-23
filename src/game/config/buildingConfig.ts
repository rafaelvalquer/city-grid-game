import type { BuildingLevel, BuildingType } from '../../types/city.types';

export type BuildingLevelConfig = {
  label: string;
  visualLabel: string;
  population: number;
  jobs: number;
  attraction: number;
};

export const BUILDING_CONSTRUCTION_SECONDS: Record<BuildingType, number> = {
  house: 8,
  shop: 12,
  office: 16,
};

export const BUILDING_CONFIG: Record<BuildingType, { label: string; levels: Record<BuildingLevel, BuildingLevelConfig> }> = {
  house: {
    label: 'Residencial',
    levels: {
      1: { label: 'Casa', visualLabel: 'Casa', population: 3, jobs: 0, attraction: 1 },
      2: { label: 'Residencial', visualLabel: 'Sobrado', population: 7, jobs: 0, attraction: 2 },
      3: { label: 'Prédio residencial', visualLabel: 'Residencial vertical', population: 16, jobs: 1, attraction: 4 },
    },
  },
  shop: {
    label: 'Comércio',
    levels: {
      1: { label: 'Loja pequena', visualLabel: 'Loja', population: 0, jobs: 2, attraction: 4 },
      2: { label: 'Mercado local', visualLabel: 'Mercado', population: 0, jobs: 5, attraction: 8 },
      3: { label: 'Centro comercial', visualLabel: 'Centro comercial', population: 0, jobs: 11, attraction: 15 },
    },
  },
  office: {
    label: 'Escritório',
    levels: {
      1: { label: 'Escritório pequeno', visualLabel: 'Escritório', population: 0, jobs: 8, attraction: 7 },
      2: { label: 'Prédio corporativo', visualLabel: 'Corporativo', population: 0, jobs: 16, attraction: 11 },
      3: { label: 'Torre compacta', visualLabel: 'Torre', population: 0, jobs: 30, attraction: 18 },
    },
  },
};

export function getBuildingLevelConfig(type: BuildingType, level: BuildingLevel): BuildingLevelConfig {
  return BUILDING_CONFIG[type].levels[level];
}
