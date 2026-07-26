import type { Exercise } from '@/types';
import { getEquipmentProfile } from '@/lib/equipment';
import { getExercisesForSession } from '@/lib/data';

export interface WeightRecommendation {
  weight: number;
  available: number | null;
  repRange: string;
  adjustment: string | null;
}

const DEFAULT_WEIGHT = 5;

function loadKeys(loads: Record<string, { repRange: string }>): number[] {
  return Object.keys(loads).map(Number).sort((a, b) => a - b);
}

function closestLoadKey(keys: number[], target: number): number {
  return keys.reduce((best, k) =>
    Math.abs(k - target) < Math.abs(best - target) ? k : best,
  );
}

export async function recommendWeight(ex: Exercise): Promise<WeightRecommendation> {
  const profile = await getEquipmentProfile();
  const loads = ex.recommendedLoads;

  if (!loads || Object.keys(loads).length === 0) {
    return {
      weight: 0,
      available: null,
      repRange: '',
      adjustment: 'Bodyweight exercise \u2014 no weight needed.',
    };
  }

  const keys = loadKeys(loads);

  if (profile.dumbbells.length === 0) {
    const mid = keys[Math.floor(keys.length / 2)];
    const entry = loads[String(mid)];
    return {
      weight: mid,
      available: null,
      repRange: entry.repRange,
      adjustment: 'No dumbbells configured. Set your equipment in Settings.',
    };
  }

  const chosen = closestLoadKey(keys, profile.dumbbells[0]);

  for (const dw of profile.dumbbells) {
    if (loads[String(dw)]) {
      const entry = loads[String(dw)];
      return {
        weight: dw,
        available: dw,
        repRange: entry.repRange,
        adjustment: null,
      };
    }
  }

  const entry = loads[String(chosen)];
  const adjustment = chosen < profile.dumbbells[0]
    ? `Use ${chosen} kg \u2014 increase reps to ${entry.repRange}`
    : `Use ${chosen} kg \u2014 stay in ${entry.repRange} rep range`;

  return {
    weight: chosen,
    available: chosen,
    repRange: entry.repRange,
    adjustment,
  };
}

/** Return a session-wide weight summary for display before a workout starts. */
export async function getSessionWeightSummary(sessionKey: string): Promise<string[]> {
  const exercises = getExercisesForSession(sessionKey);
  const lines: string[] = [];
  for (const ex of exercises) {
    const rec = await recommendWeight(ex);
    if (rec.available == null) {
      if (!ex.recommendedLoads || Object.keys(ex.recommendedLoads).length === 0) {
        lines.push(`${ex.name}: bodyweight`);
      } else {
        lines.push(`${ex.name}: set your equipment`);
      }
    } else {
      lines.push(`${ex.name}: ${rec.available} kg (${rec.repRange} reps)`);
    }
  }
  return lines;
}

/** Return the total recommended volume weight for a session. */
export async function getSessionVolume(sessionKey: string): Promise<number> {
  const exercises = getExercisesForSession(sessionKey);
  const profile = await getEquipmentProfile();
  let total = 0;
  for (const ex of exercises) {
    const loads = ex.recommendedLoads;
    if (!loads || Object.keys(loads).length === 0) continue;
    const keys = loadKeys(loads);
    let weight = DEFAULT_WEIGHT;
    if (profile.dumbbells.length > 0) {
      for (const dw of profile.dumbbells) {
        if (loads[String(dw)]) { weight = dw; break; }
      }
      if (!loads[String(weight)]) {
        weight = closestLoadKey(keys, profile.dumbbells[0]);
      }
    }
    const sets = parseInt(ex.sets.match(/(\d+)/)?.[1] ?? '3', 10);
    const reps = parseInt(ex.reps.match(/(\d+)/)?.[1] ?? '10', 10);
    total += weight * sets * reps;
  }
  return total;
}
