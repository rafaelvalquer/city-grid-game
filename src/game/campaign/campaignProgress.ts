import type { CampaignCityId } from '../config/gameSetup';
import type { CampaignCompletionRecord } from './campaignTypes';
import { CAMPAIGN_LEVEL_1_CITIES, CAMPAIGN_LEVEL_2_CITIES } from './campaignMaps';

export const CAMPAIGN_PROGRESS_STORAGE_KEY = 'cityCampaignProgress:v3';
export const LEGACY_CAMPAIGN_PROGRESS_V2_STORAGE_KEY = 'cityCampaignProgress:v2';
export const LEGACY_CAMPAIGN_PROGRESS_STORAGE_KEY = 'cityCampaignProgress:v1';
export type CampaignProgress = Partial<Record<CampaignCityId, CampaignCompletionRecord>>;

export function loadCampaignProgress(storage: Pick<Storage, 'getItem'> = localStorage): CampaignProgress {
  try {
    const raw = storage.getItem(CAMPAIGN_PROGRESS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as CampaignProgress;
    const legacyV2 = storage.getItem(LEGACY_CAMPAIGN_PROGRESS_V2_STORAGE_KEY);
    if (legacyV2) return JSON.parse(legacyV2) as CampaignProgress;
    const legacyV1 = storage.getItem(LEGACY_CAMPAIGN_PROGRESS_STORAGE_KEY);
    return legacyV1 ? JSON.parse(legacyV1) as CampaignProgress : {};
  } catch {
    return {};
  }
}

export function saveCampaignCompletion(
  record: CampaignCompletionRecord,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): CampaignProgress {
  const progress = loadCampaignProgress(storage);
  const previous = progress[record.cityId];
  if (!previous || record.elapsedSeconds < previous.elapsedSeconds) progress[record.cityId] = record;
  storage.setItem(CAMPAIGN_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  return progress;
}

export function isCampaignLevel2Unlocked(progress: CampaignProgress): boolean {
  return CAMPAIGN_LEVEL_1_CITIES.every((city) => Boolean(progress[city.id]));
}

export function isCampaignLevel3Unlocked(progress: CampaignProgress): boolean {
  return CAMPAIGN_LEVEL_2_CITIES.every((city) => Boolean(progress[city.id]));
}
