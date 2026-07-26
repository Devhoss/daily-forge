import { db } from '@/lib/db';

const STORAGE_KEY = 'equipment';

export interface EquipmentProfile {
  dumbbells: number[];  // kg weights the user owns
  hasBench: boolean;
  hasBands: boolean;
  hasPullUpBar: boolean;
  hasMat: boolean;
  hasKettlebell: boolean;
}

export const ALL_DUMBBELL_WEIGHTS = [2, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25];

export const DEFAULT_EQUIPMENT: EquipmentProfile = {
  dumbbells: [5, 7.5],
  hasBench: false,
  hasBands: false,
  hasPullUpBar: false,
  hasMat: true,
  hasKettlebell: false,
};

export async function getEquipmentProfile(): Promise<EquipmentProfile> {
  const row = await db.settings.get(STORAGE_KEY);
  if (!row) return DEFAULT_EQUIPMENT;
  const data = JSON.parse(row.value);
  return { ...DEFAULT_EQUIPMENT, ...data };
}

export async function saveEquipmentProfile(profile: EquipmentProfile): Promise<void> {
  await db.settings.put({ key: STORAGE_KEY, value: JSON.stringify(profile) });
}
