import type { Vec2 } from './city.types';

export type MetroStation = {
  id: string;
  name: string;
  x: number;
  y: number;
  coverageRadius: number;
  capacity: number;
  waitingPassengers: number;
  totalBoarded: number;
  totalAlighted: number;
  totalPassengersHandled: number;
  activeLineIds: string[];
  peakWaitingPassengers: number;
  carsAvoidedFromStation: number;
  createdAtDay: number;
};

export type MetroTrack = {
  id: string;
  fromStationId: string;
  toStationId: string;
  tiles: Vec2[];
  distance: number;
  active: boolean;
};

export type MetroLine = {
  id: string;
  name: string;
  color: string;
  stationIds: string[];
  active: boolean;
  frequencySeconds: number;
  trainCapacity: number;
  totalPassengers: number;
  currentPassengers: number;
  waitingPassengers: number;
  carsAvoided: number;
  trainsActive: number;
  completedCycles: number;
};

export type MetroTrain = {
  id: string;
  lineId: string;
  stationIndex: number;
  nextStationIndex: number;
  progress: number;
  speed: number;
  passengers: number;
  capacity: number;
  direction: 1 | -1;
  dwellSeconds?: number;
};

export type MetroLineStats = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  stations: number;
  trains: number;
  waitingPassengers: number;
  currentPassengers: number;
  totalPassengers: number;
  carsAvoided: number;
  completedCycles: number;
  stationIds: string[];
};
