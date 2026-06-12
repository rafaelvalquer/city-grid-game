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
} as const;
