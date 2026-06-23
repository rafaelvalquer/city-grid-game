import type { CampaignCityId } from '../config/gameSetup';
import type { CampaignProgress } from './campaignProgress';

export function wrapCampaignIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return ((index % total) + total) % total;
}

export function getInitialCampaignIndex(cityIds: CampaignCityId[], progress: CampaignProgress): number {
  const firstIncomplete = cityIds.findIndex((id) => !progress[id]);
  return firstIncomplete >= 0 ? firstIncomplete : 0;
}

export function getCampaignCardOffset(index: number, selectedIndex: number, total: number): number {
  if (total <= 1) return 0;
  let offset = wrapCampaignIndex(index - selectedIndex, total);
  if (offset > total / 2) offset -= total;
  return offset;
}

export function getCampaignWheelDirection(deltaX: number, deltaY: number): -1 | 0 | 1 {
  const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (Math.abs(dominantDelta) < 12) return 0;
  return dominantDelta > 0 ? 1 : -1;
}

export function getCampaignSwipeDirection(deltaX: number, threshold = 55): -1 | 0 | 1 {
  if (Math.abs(deltaX) < threshold) return 0;
  return deltaX < 0 ? 1 : -1;
}
