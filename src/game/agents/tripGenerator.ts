import type { Building } from '../../types/city.types';
import type { DayPeriod } from '../engine/timeSystem';

export function chooseTrip(buildings: Building[], period: DayPeriod): { origin: Building; destination: Building } | null {
  const connected = buildings.filter((b) => b.connected);
  const houses = connected.filter((b) => b.type === 'house');
  const shops = connected.filter((b) => b.type === 'shop');
  const offices = connected.filter((b) => b.type === 'office');

  let origins: Building[] = [];
  let destinations: Building[] = [];

  if (period === 'morning') {
    origins = houses;
    destinations = offices.length ? offices : shops;
  } else if (period === 'noon') {
    origins = offices.length ? offices : houses;
    destinations = shops.length ? shops : houses;
  } else if (period === 'evening') {
    origins = [...offices, ...shops];
    destinations = houses;
  } else {
    origins = houses;
    destinations = [...shops, ...offices];
  }

  if (!origins.length || !destinations.length) return null;
  const origin = origins[Math.floor(Math.random() * origins.length)];
  const validDestinations = destinations.filter((d) => d.id !== origin.id);
  if (!validDestinations.length) return null;
  const destination = validDestinations[Math.floor(Math.random() * validDestinations.length)];
  return { origin, destination };
}
