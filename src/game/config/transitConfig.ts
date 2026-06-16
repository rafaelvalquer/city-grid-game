export const TRANSIT_CONFIG = {
  busStopCost: 45,
  busStopRemoveCostRatio: 0.4,
  coverageRadius: 5,
  busCapacity: 32,
  busBaseSpeed: 1.15,
  busDwellSeconds: 1.8,
  passengerConversionChance: 0.78,
  busTrafficWeight: 1.8,
} as const;


export const BUS_LANE_CONFIG = {
  buildCost: 85,
  removeCostRatio: 0.35,
  busSpeedMultiplier: 1.35,
  busCongestionResistance: 0.55,
  busTrafficWeightMultiplier: 0.7,
  busPathCostMultiplier: 0.58,
  carCapacityMultiplier: 0.75,
  carPathPenalty: 1.18,
  passengerConversionBonus: 0.12,
  defaultBuses: 2,
  maxBusesPerDistrict: 5,
  busPurchaseCost: 750,
} as const;
