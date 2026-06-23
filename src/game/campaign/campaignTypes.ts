import type { BuildingType, CityStats, Tile, VegetationKind } from '../../types/city.types';
import type { CampaignCityId } from '../config/gameSetup';

export type CampaignBaseObjectiveMetric = keyof Pick<CityStats,
  | 'population'
  | 'satisfaction'
  | 'averageCongestion'
  | 'bikeLaneTiles'
  | 'bikeTripsCompleted'
  | 'busLaneTiles'
  | 'activeBuses'
  | 'busTripsCompleted'
  | 'metroStations'
  | 'metroLines'
  | 'metroTripsCompleted'
  | 'helipads'
  | 'helicopterLines'
  | 'helicopters'
  | 'helicopterTripsCompleted'
>;

export type CampaignDerivedObjectiveMetric =
  | 'busLaneCoveragePercent'
  | 'minMetroStationsPerActiveLine'
  | 'secondsSinceBikeTrip'
  | 'secondsSinceMetroTrip'
  | 'connectedCampaignZones';

export type CampaignObjectiveMetric = CampaignBaseObjectiveMetric | CampaignDerivedObjectiveMetric;

export type CampaignObjectiveRequirement = {
  metric: CampaignObjectiveMetric;
  comparator: 'min' | 'max';
  target: number;
  label: string;
  unit?: '%' | 'tiles' | 'viagens' | 's' | 'zonas';
};

export type CampaignObjectiveDefinition = {
  id: string;
  label: string;
  description: string;
  requirements: CampaignObjectiveRequirement[];
};

export type CampaignMissionDefinition = {
  holdSeconds: number;
  objectives: CampaignObjectiveDefinition[];
};

export type CampaignBuildingDefinition = {
  x: number;
  y: number;
  type: BuildingType;
};

export type CampaignZoneDefinition = {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
};

export type CampaignCityDefinition = {
  id: CampaignCityId;
  name: string;
  country: string;
  description: string;
  biome: string;
  accent: string;
  vegetation: VegetationKind[];
  campaignLevel: 1 | 2 | 3;
  startingMoney: number;
  mission: CampaignMissionDefinition;
  featuredObjectives?: Array<'bike' | 'bus' | 'metro' | 'air'>;
  zones?: CampaignZoneDefinition[];
  applyMap: (grid: Tile[][]) => CampaignBuildingDefinition[];
};

export type CampaignObjectiveRequirementSnapshot = CampaignObjectiveRequirement & {
  current: number;
  met: boolean;
};

export type CampaignObjectiveSnapshot = {
  id: string;
  label: string;
  description: string;
  met: boolean;
  requirements: CampaignObjectiveRequirementSnapshot[];
};

export type CampaignMissionSnapshot = {
  cityId: CampaignCityId;
  population: number;
  satisfaction: number;
  traffic: number;
  holdSeconds: number;
  objectives: CampaignObjectiveSnapshot[];
  stabilitySeconds: number;
  completed: boolean;
  elapsedSeconds: number;
  day: number;
  timeLabel: string;
};

export type CampaignCompletionRecord = {
  cityId: CampaignCityId;
  completedAt: string;
  population: number;
  satisfaction: number;
  traffic: number;
  elapsedSeconds: number;
  day: number;
  timeLabel: string;
};
