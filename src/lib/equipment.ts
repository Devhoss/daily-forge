import { db } from '@/lib/db';
import { emitDataChanged } from '@/lib/events';

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
  emitDataChanged();
}

/**
 * Converts a raw internal equipment label from exercises.json into a
 * human-friendly name, e.g.:
 *   "2 x 5kg Dumbbells"                  → "Pair of 5 kg dumbbells"
 *   "1 x 5kg Dumbbell"                   → "Single 5 kg dumbbell"
 *   "2 x 5kg Dumbbells (used as one load) or 1 Dumbbell" → "Pair of 5 kg dumbbells (or single)"
 *   "1 x 5kg Dumbbell (or both stacked)" → "Single 5 kg dumbbell (or two stacked)"
 *   "Chair (optional, for the Bulgarian variation)" → "Chair"
 *   "Sturdy chair or low bed edge"       → "Chair or low bed edge"
 */
export function humanizeEquipment(raw: string): string {
  let s = raw.trim();

  // Drop purely "optional" parentheticals.
  s = s.replace(/\s*\(optional[^)]*\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
  if (!s) return "Other";

  // Dumbbell pair / single, e.g. "2 x 5kg Dumbbells", "1 x 5kg Dumbbell".
  const dbMatch = s.match(/^(\d)\s*x\s*([\d.]+)\s*(kg|lbs?)?\s*dumbbell/i);
  if (dbMatch) {
    const count = parseInt(dbMatch[1], 10);
    const weight = dbMatch[2];
    const unit = (dbMatch[3] ?? "kg").toLowerCase().replace("lbs", "lb") || "kg";
    const inner = s.slice(dbMatch[0].length).trim().toLowerCase();
    let label =
      count >= 2
        ? `Pair of ${weight} ${unit} dumbbells`
        : `Single ${weight} ${unit} dumbbell`;
    if (inner.includes("used as one")) label += " (or single)";
    else if (inner.includes("both stacked") || inner.includes("stacked")) label += " (or two stacked)";
    return label;
  }

  // Chair variants.
  s = s
    .replace(/^sturdy\s+chair/i, "Chair")
    .replace(/^sturdy\s+low\s+surface/i, "Low table or chair")
    .replace(/sturdy\s+low\s+surface/gi, "low table")
    .replace(/low\s+bed\s+edge/i, "low bed edge");

  return s;
}

/** Returns a de-duplicated, human-friendly equipment list for a set of exercises. */
export function humanizeEquipmentList(equipment: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const eq of equipment) {
    const name = humanizeEquipment(eq);
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
