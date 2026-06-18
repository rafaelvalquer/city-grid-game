import type { Vec2 } from './city.types';

export type HelicopterFlightState = 'takingOff' | 'flying' | 'landing' | 'dwelling';

export type HelicopterPassengerGroup = {
  destinationHelipadId: string;
  count: number;
};

export type Helipad = {
  id: string;
  name: string;
  x: number;
  y: number;
  accessRoad: Vec2;
  coverageRadius: number;
  capacity: number;
  waiting: HelicopterPassengerGroup[];
  totalBoarded: number;
  totalAlighted: number;
  peakWaitingPassengers: number;
  carsAvoidedFromHelipad: number;
  activeLineIds: string[];
  createdAtDay: number;
};

export type HelicopterLine = {
  id: string;
  name: string;
  color: string;
  helipadIds: [string, string];
  active: boolean;
  helicopterCount: number;
  totalPassengers: number;
  currentPassengers: number;
  waitingPassengers: number;
  carsAvoided: number;
  completedCycles: number;
};

export type Helicopter = {
  id: string;
  lineId: string;
  fromHelipadId: string;
  toHelipadId: string;
  progress: number;
  speed: number;
  capacity: number;
  passengers: HelicopterPassengerGroup[];
  state: HelicopterFlightState;
  stateProgress: number;
  dwellSeconds: number;
};

export type HelicopterLineStats = {
  id: string;
  name: string;
  active: boolean;
  helicopters: number;
  waitingPassengers: number;
  currentPassengers: number;
  totalPassengers: number;
  carsAvoided: number;
  completedCycles: number;
  helipadIds: [string, string];
};
