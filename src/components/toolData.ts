import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BusFront, Circle, CircleDot, Eye, Gauge, Route, TrafficCone, Trash2, Wrench } from 'lucide-react';
import { ROAD_CONFIG } from '../game/config/roadConfig';
import { TRANSIT_CONFIG } from '../game/config/transitConfig';
import { TRAFFIC_LIGHT_BUILD_COST } from '../game/systems/trafficLights';
import type { Tool } from '../types/game.types';

export type ToolItem = {
  id: Tool;
  label: string;
  cost?: number;
  Icon: LucideIcon;
};

export type ToolGroup = {
  id: 'roads' | 'traffic' | 'edit';
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
