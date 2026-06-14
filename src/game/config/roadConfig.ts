export const ROAD_CONFIG = {
  road: {
    label: 'Rua',
    speed: 1,
    capacity: 5,
    buildCost: 10,
    removeCost: 5,
    pathCost: 10,
  },
  avenue: {
    label: 'Avenida',
    speed: 1.55,
    capacity: 12,
    buildCost: 25,
    removeCost: 8,
    pathCost: 6,
  },
  roundabout: {
    label: 'Rotatória',
    speed: 0.85,
    capacity: 18,
    buildCost: 90,
    removeCost: 18,
    pathCost: 5,
  },
} as const;

export const ROUNDABOUT_CONFIG = ROAD_CONFIG.roundabout;
