import type { SetLog } from '@/lib/db';
import { getExercise } from '@/lib/data';

/** Long-run "best" metrics for a single exercise across all recorded sets. */
export interface ExerciseRecord {
  exerciseId: string;
  /** Heaviest load used (kg). Null for bodyweight-only history. */
  bestWeightKg: number | null;
  /** Most reps in a single (non-hold) set. */
  bestReps: number | null;
  /** Highest single-set volume = weight × reps (kg·reps). */
  bestVolume: number | null;
  /** Longest time-based set (seconds). */
  bestHoldSeconds: number | null;
}

export type PRType = 'weight' | 'reps' | 'volume' | 'hold';

export interface SessionPR {
  exerciseId: string;
  type: PRType;
  previous: number | null;
  current: number;
}

function emptyRecord(exerciseId: string): ExerciseRecord {
  return {
    exerciseId,
    bestWeightKg: null,
    bestReps: null,
    bestVolume: null,
    bestHoldSeconds: null,
  };
}

function mergeInto(rec: ExerciseRecord, set: SetLog): void {
  if (set.holdDurationSeconds != null && set.holdDurationSeconds > 0) {
    if (rec.bestHoldSeconds == null || set.holdDurationSeconds > rec.bestHoldSeconds) {
      rec.bestHoldSeconds = set.holdDurationSeconds;
    }
    return;
  }
  const reps = set.repsCompleted ?? 0;
  const weight = set.weightUsed ?? 0;
  if (reps > 0) {
    if (rec.bestReps == null || reps > rec.bestReps) rec.bestReps = reps;
    const volume = reps * weight;
    if (weight > 0 && (rec.bestVolume == null || volume > rec.bestVolume)) {
      rec.bestVolume = volume;
    }
  }
  if (weight > 0 && (rec.bestWeightKg == null || weight > rec.bestWeightKg)) {
    rec.bestWeightKg = weight;
  }
}

/**
 * Compute the best recorded metrics per exercise from a set of set-logs.
 * Legacy sets (no `weightUsed`) contribute reps/volume only when a weight is present.
 */
export function computeExerciseRecords(allSetLogs: SetLog[]): Map<string, ExerciseRecord> {
  const records = new Map<string, ExerciseRecord>();
  for (const set of allSetLogs) {
    let rec = records.get(set.exerciseId);
    if (!rec) {
      rec = emptyRecord(set.exerciseId);
      records.set(set.exerciseId, rec);
    }
    mergeInto(rec, set);
  }
  return records;
}

const BEST: Record<PRType, (r: ExerciseRecord) => number | null> = {
  weight: (r) => r.bestWeightKg,
  reps: (r) => r.bestReps,
  volume: (r) => r.bestVolume,
  hold: (r) => r.bestHoldSeconds,
};

/**
 * Keep only meaningful PR types per exercise: holds report only 'hold';
 * bodyweight-only movements never claim a weight PR.
 */
function filterMeaningfulPRs(prs: SessionPR[]): SessionPR[] {
  return prs.filter((p) => {
    const ex = getExercise(p.exerciseId);
    if (!ex) return true;
    const weighted =
      ex.recommendedLoads && Object.keys(ex.recommendedLoads).length > 0;
    if (p.type === 'weight' && !weighted) {
      // A bodyweight exercise with no recorded loads can't claim a weight PR.
      return false;
    }
    if (p.type === 'hold') {
      // Only meaningful for time-based exercises.
      return /hold|isometric|second/i.test((ex.reps ?? '') + ' ' + (ex.tempo ?? ''));
    }
    return true;
  });
}

/**
 * Detect personal records set during the inclusive ISO range `[startIso,
 * endIso]` by comparing that range's best per exercise against everything
 * recorded before `startIso`. Used by the Weekly Report ("PRs set this week").
 */
export function detectPRsSetInDateRange(
  allSetLogs: SetLog[],
  startIso: string,
  endIso: string,
): SessionPR[] {
  const history: SetLog[] = [];
  const rangeSets: SetLog[] = [];
  for (const set of allSetLogs) {
    if (set.date >= startIso && set.date <= endIso) {
      rangeSets.push(set);
    } else {
      history.push(set);
    }
  }

  const before = computeExerciseRecords(history);
  const rangeRecords = computeExerciseRecords(rangeSets);
  const prs: SessionPR[] = [];

  for (const [exerciseId, current] of rangeRecords) {
    const prev = before.get(exerciseId) ?? emptyRecord(exerciseId);
    for (const type of (['weight', 'reps', 'volume', 'hold'] as PRType[])) {
      const cur = BEST[type](current);
      const old = BEST[type](prev);
      if (cur == null) continue;
      if (old == null || cur > old) {
        prs.push({ exerciseId, type, previous: old, current: cur });
      }
    }
  }

  return filterMeaningfulPRs(prs);
}

/**
 * Detect personal records set during `currentDate`/`sessionKey` by comparing that
 * session's sets against every other recorded set (the surrounding history).
 */
export function detectSessionPRs(
  allSetLogs: SetLog[],
  currentDate: string,
  sessionKey: string,
): SessionPR[] {
  const history: SetLog[] = [];
  const sessionSets: SetLog[] = [];
  for (const set of allSetLogs) {
    if (set.date === currentDate && set.sessionKey === sessionKey) {
      sessionSets.push(set);
    } else {
      history.push(set);
    }
  }

  const before = computeExerciseRecords(history);
  const sessionRecords = computeExerciseRecords(sessionSets);
  const prs: SessionPR[] = [];

  for (const [exerciseId, current] of sessionRecords) {
    const prev = before.get(exerciseId) ?? emptyRecord(exerciseId);
    for (const type of (['weight', 'reps', 'volume', 'hold'] as PRType[])) {
      const cur = BEST[type](current);
      const old = BEST[type](prev);
      if (cur == null) continue;
      if (old == null || cur > old) {
        prs.push({ exerciseId, type, previous: old, current: cur });
      }
    }
  }

  return filterMeaningfulPRs(prs);
}

/** Human-friendly label and value for a session PR. */
export function prLabel(type: PRType, value: number): string {
  switch (type) {
    case 'weight':
      return `New load PR \u2014 ${value} kg`;
    case 'reps':
      return `New rep PR \u2014 ${value} reps`;
    case 'volume':
      return `New volume PR \u2014 ${value} kg\u00b7reps`;
    case 'hold':
      return `New hold PR \u2014 ${value}s`;
  }
}