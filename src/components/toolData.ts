import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BusFront, Bike, Circle, CircleDot, Eye, Gauge, Plane, Route, TrafficCone, Trash2, Wrench } from 'lucide-react';
import { ROAD_CONFIG } from '../game/config/roadConfig';
import { TRANSIT_CONFIG, BUS_LANE_CONFIG } from '../game/config/transitConfig';
import { METRO_CONFIG } from '../game/config/metroConfig';
import { BIKE_LANE_CONFIG } from '../game/config/bikeConfig';
import { HELICOPTER_CONFIG } from '../game/config/helicopterConfig';
import { TRAFFIC_LIGHT_BUILD_COST } from '../game/systems/trafficLights';
import type { Tool } from '../types/game.types';

export type ToolItem = {
  id: Tool;
  label: string;
  cost?: number;
  Icon: LucideIcon;
};

export type ToolGroup = {
  id: 'roads' | 'traffic' | 'underground' | 'air' | 'edit';
  label: string;
  Icon: LucideIcon;
  tools: ToolItem[];
};

export const toolGroups: ToolGroup[] = [
  {
    id: 'roads',
    label: 'Vias',
    Icon: Route,
    tools: [
      { id: 'road', label: 'Rua', cost: ROAD_CONFIG.road.buildCost, Icon: Route },
      { id: 'avenue', label: 'Avenida', cost: ROAD_CONFIG.avenue.buildCost, Icon: Gauge },
      { id: 'roundabout', label: 'Rotatória', cost: ROAD_CONFIG.roundabout.buildCost, Icon: Circle },
    ],
  },
  {
    id: 'traffic',
    label: 'Trânsito',
    Icon: TrafficCone,
    tools: [
      { id: 'trafficLight', label: 'Semáforo', cost: TRAFFIC_LIGHT_BUILD_COST, Icon: CircleDot },
      { id: 'oneWay', label: 'Mão única', Icon: ArrowRight },
      { id: 'busStop', label: 'Ponto de ônibus', cost: TRANSIT_CONFIG.busStopCost, Icon: BusFront },
      { id: 'busLane', label: 'Corredor de ônibus', cost: BUS_LANE_CONFIG.buildCost, Icon: BusFront },
      { id: 'bikeLane', label: 'Ciclovia', cost: BIKE_LANE_CONFIG.buildCost, Icon: Bike },
    ],
  },
  {
    id: 'underground',
    label: 'Subsolo',
    Icon: CircleDot,
    tools: [
      { id: 'metroStation', label: 'Estação', cost: METRO_CONFIG.stationBuildCost, Icon: CircleDot },
      { id: 'metroTrack', label: 'Trilho', cost: METRO_CONFIG.trackCostPerTile, Icon: Route },
      { id: 'metroLine', label: 'Criar linha', cost: METRO_CONFIG.lineActivationCost, Icon: BusFront },
    ],
  },
  {
    id: 'air',
    label: 'Aéreo',
    Icon: Plane,
    tools: [
      { id: 'helipad', label: 'Heliponto', cost: HELICOPTER_CONFIG.helipadBuildCost, Icon: CircleDot },
      { id: 'helicopterLine', label: 'Linha aérea', cost: HELICOPTER_CONFIG.lineActivationCost, Icon: Plane },
    ],
  },
  {
    id: 'edit',
    label: 'Edição',
    Icon: Wrench,
    tools: [
      { id: 'remove', label: 'Remover', cost: ROAD_CONFIG.road.removeCost, Icon: Trash2 },
      { id: 'inspect', label: 'Inspecionar', Icon: Eye },
    ],
  },
];

export const tools = toolGroups.flatMap((group) => group.tools);

export function toolLabelWithCost(tool: ToolItem): string {
  return tool.cost === undefined ? tool.label : `${tool.label} · $${tool.cost}`;
}

export function groupForTool(tool: Tool): ToolGroup {
  return toolGroups.find((group) => group.tools.some((item) => item.id === tool)) ?? toolGroups[0];
}
