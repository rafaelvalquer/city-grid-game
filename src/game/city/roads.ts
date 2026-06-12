import type { RoadType } from '../../types/city.types';
import { ROAD_CONFIG } from '../config/roadConfig';

export function getRoadCapacity(type: RoadType): number {
  return ROAD_CONFIG[type].capacity;
}

export function getRoadSpeed(type: RoadType): number {
  return ROAD_CONFIG[type].speed;
}
