/**
 * RecommendationEngine — a general, deterministic recommendation service.
 *
 * Unlike an overload-only service, this engine considers the whole training
 * picture and returns a ranked list of recommendations that can power the
 * Home screen, Workout Review, Weekly Reports, notifications, and the future
 * offline Gemma coach.
 *
 * Every recommendation carries:
 *   - `decision`   — plain-language action ("Add 2.5 kg to Dumbbell Floor Press next session")
 *   - `reasoning`  — the *why*, composed from the underlying services' own
 *                    numbers/explanations (never invented sentences)
 *   - `confidence` — how much data the signal is based on
 *   - `action`     — a machine-readable decision the UI/coach can act on directly
 *
 * Determinism: `asOf` is injected (never read from the clock), all inputs are
 * plain data, and no module reads or writes storage. Milestone progress uses
 * a pure, non-persisting path.
 */
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';
import type { Exercise } from '@/types';
import {
  getExercise,
  getExercisesForSession,
  getWeekRow,
  program,
  isTimeBasedExercise,
  parseHoldDuration,
} from '@/lib/data';
import { getTodayInfo } from '@/lib/programEngine';
import { computeCurrentStreak, isoOf } from '@/services/streaks/streakEngine';
import {
  computeRecoveryScore,
  computeTrailingConsistencyPct,
  type RecoveryLevel,
} from '@/services/recovery/recoveryScore';
import {
  gatherMilestoneData,
  getMilestoneProgress,
  type MilestoneProgress,
} from '@/lib/milestones';
import { latestMeasurementAtOrBefore } from '@/services/measurements/measurementDeltas';

export type Confidence = 'low' | 'medium' | 'high';

/**
 * Presentation importance — a display tier for consumers (Home, Weekly
 * Report, notifications), separate from the 0..1 `priority` sort key. Derived
 * deterministically from `priority`; screens choose which tiers to render.
 */
export type RecommendationImportance = 'critical' | 'high' | 'normal' | 'low';

/** Map a recommendation's priority to its presentation importance tier. */
export function resolveImportance(priority: number): RecommendationImportance {
  if (priority >= 0.9) return 'critical';
  if (priority >= 0.7) return 'high';
  if (priority >= 0.5) return 'normal';
  return 'low';
}

/** Short, encouraging headline for a recommendation (presentation metadata). */
export function resolveTitle(key: RecommendationKey, action: RecommendationAction): string {
  switch (key) {
    case 'overload': {
      const kind = action.type === 'overload' ? action.step.kind : 'increase_reps';
      if (kind === 'increase_weight' || kind === 'increase_hold') return 'Ready to Progress';
      if (kind === 'progress') return 'Level Up';
      return 'Keep Pushing';
    }
    case 'recovery':
      return action.type === 'recovery'
        ? action.level === 'fresh'
          ? 'Push Today'
          : action.level === 'tired'
            ? 'Take It Easy'
            : action.level === 'overtraining_risk'
              ? 'Prioritize Recovery'
              : 'Recovery'
        : 'Recovery';
    case 'deload': return 'Deload Week';
    case 'consistency': return 'Build Consistency';
    case 'measurement': return 'Track Your Progress';
    case 'streak': return 'Restart Your Streak';
    case 'milestone': return 'Milestone Ahead';
  }
}

/**
 * The next session (cycling through the weekly template from `startDayIndex`,
 * rest days skipped) that schedules `exerciseId`, or `null` if no session does.
 * Used by consumers to turn an overload recommendation into a target workout.
 */
export function findNextSessionForExercise(
  exerciseId: string,
  startDayIndex: number,
): { sessionKey: string; label: string } | null {
  const template = program.weekly_template;
  for (let offset = 0; offset < template.length; offset++) {
    const day = template[(startDayIndex + offset) % template.length];
    if (day.session_key === 'rest') continue;
    const scheduled = getExercisesForSession(day.session_key);
    if (scheduled.some((e) => e.id === exerciseId)) {
      return { sessionKey: day.session_key, label: day.label };
    }
  }
  return null;
}

export type RecommendationKey =
  | 'overload'
  | 'recovery'
  | 'deload'
  | 'consistency'
  | 'measurement'
  | 'streak'
  | 'milestone';

export type OverloadKind = 'increase_weight' | 'increase_reps' | 'increase_hold' | 'progress';

export interface OverloadTarget {
  loadKg?: number;
  reps?: number;
  holdSeconds?: number;
  note?: string;
}

export interface OverloadStep {
  exerciseId: string;
  exerciseName: string;
  kind: OverloadKind;
  /** Working set from the most recent logged session. */
  current: { loadKg?: number; reps?: number; holdSeconds?: number };
  /** The prescribed next step (kg/reps/seconds/note). */
  target: OverloadTarget;
  /** Sessions in a row that earned this step. */
  qualifyingSessions: number;
}

export type RecommendationAction =
  | { type: 'overload'; exerciseId: string; step: OverloadStep }
  | { type: 'recovery'; level: RecoveryLevel }
  | { type: 'deload'; weekNumber: number }
  | { type: 'consistency'; consistencyPct: number }
  | { type: 'measurement'; daysSinceLast: number | null }
  | { type: 'streak'; currentStreak: number }
  | {
      type: 'milestone';
      milestoneId: string;
      milestoneTitle: string;
      remaining: number;
      progressCurrent: number;
      progressTarget: number;
    };

export interface Recommendation {
  /** Stable id (`key` or `key:exerciseId`). */
  id: string;
  key: RecommendationKey;
  /** 0..1 sort key; higher = more actionable. */
  priority: number;
  /** Presentation tier for screens (Home: critical+high, report: all). */
  importance: RecommendationImportance;
  /** Short, encouraging headline. */
  title: string;
  /** Plain-language decision. */
  decision: string;
  /** Why — bullets composed from the underlying services. */
  reasoning: string[];
  confidence: Confidence;
  /** Machine-readable decision for UI/coach. */
  action: RecommendationAction;
  /** Which service/data produced the signal (traceability). */
  source: string;
}

export interface RecommendationConfig {
  /** ISO date the program started. */
  startIso: string;
  /** "Now". Deterministic output requires the caller to fix this date. */
  asOf: Date;
  /** Cap on the returned list, ordered by priority. Defaults to 5. */
  maxResults?: number;
  /** Max per-exercise overload prompts. Defaults to 3. */
  maxOverload?: number;
  /**
   * Dumbbell weights (kg) the user owns, ascending. When provided, overload
   * targets are clamped to owned ladder rungs so coaching never recommends an
   * unavailable weight — the top-of-range step becomes "add heavier dumbbells"
   * instead. When omitted, the full program ladder is assumed (default, so
   * notifications/reports that don't know the user's gear keep today's output).
   */
  availableWeights?: number[];
}

/** Candidate shape is a Recommendation minus the presentation metadata the orchestrator stamps. */
interface Candidate extends Omit<Recommendation, 'importance' | 'title'> {}

interface EngineContext {
  sessionLogs: SessionLog[];
  setLogs: SetLog[];
  measurements: MeasurementEntry[];
  startIso: string;
  asOf: Date;
  asOfIso: string;
  weekNumber: number;
  maxOverload: number;
  availableWeights: number[] | undefined;
}

/* ---------- shared helpers ---------- */

/** Parse "8-12" / "8-20" into an inclusive {min, max}. */
function parseRepRange(range: string): { min: number; max: number } {
  const nums = (range.match(/\d+/g) ?? []).map(Number);
  if (nums.length < 2) return { min: nums[0] ?? 1, max: nums[0] ?? 1 };
  return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
}

function loadKeys(loads: Record<string, { repRange: string }>): number[] {
  return Object.keys(loads).map(Number).sort((a, b) => a - b);
}

function closestLoadKey(keys: number[], target: number): number {
  return keys.reduce((best, k) =>
    Math.abs(k - target) < Math.abs(best - target) ? k : best,
  );
}

function daysSinceIso(asOf: Date, iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Math.max(0, Math.round((asOf.getTime() - date.getTime()) / 86400000));
}

/* ---------- overload ---------- */

interface ExSession {
  date: string;
  working: SetLog;
}

interface ExHistory {
  exerciseId: string;
  exerciseName: string;
  sessions: ExSession[]; // ascending by date
}

/** Sets logged on completed-session dates on/before `asOf`, grouped by exercise. */
function collectExerciseHistories(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  asOfIso: string,
): ExHistory[] {
  const completedDates = new Set(
    sessionLogs.filter((s) => s.completed && s.date <= asOfIso).map((s) => s.date),
  );
  const byExercise = new Map<string, SetLog[]>();
  for (const set of setLogs) {
    if (!completedDates.has(set.date)) continue;
    const list = byExercise.get(set.exerciseId);
    if (list) list.push(set);
    else byExercise.set(set.exerciseId, [set]);
  }

  const histories: ExHistory[] = [];
  for (const [exerciseId, sets] of byExercise) {
    const byDate = new Map<string, SetLog[]>();
    for (const set of sets) {
      const list = byDate.get(set.date);
      if (list) list.push(set);
      else byDate.set(set.date, [set]);
    }
    const exercise = getExercise(exerciseId);
    const dates = [...byDate.keys()].sort();
    const sessions: ExSession[] = dates.map((date) => ({
      date,
      working: pickWorkingSet(exercise, byDate.get(date) ?? []),
    }));
    histories.push({
      exerciseId,
      exerciseName: exercise?.name ?? exerciseId,
      sessions,
    });
  }
  return histories;
}

/** The "working" set of a session: heaviest load (weighted), longest hold, or max reps. */
function pickWorkingSet(
  exercise: { tempo: string; reps: string } | undefined,
  sets: SetLog[],
): SetLog {
  if (exercise && isTimeBasedExercise(exercise)) {
    return sets.reduce((best, s) =>
      (s.holdDurationSeconds ?? 0) > (best.holdDurationSeconds ?? 0) ? s : best,
    );
  }
  return sets.reduce((best, s) => {
    const bw = best.weightUsed ?? 0;
    const sw = s.weightUsed ?? 0;
    if (sw > bw) return s;
    if (sw === bw) {
      return (s.repsCompleted ?? 0) > (best.repsCompleted ?? 0) ? s : best;
    }
    return best;
  });
}

/** Count consecutive sessions (newest first) whose working set meets `ok`. */
function consecutiveQualifying(sessions: ExSession[], ok: (w: SetLog) => boolean): number {
  let count = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (ok(sessions[i].working)) count++;
    else break;
  }
  return count;
}

function overloadForExercise(hist: ExHistory, availableWeights?: number[]): Candidate | null {
  const exercise = getExercise(hist.exerciseId);
  const last = hist.sessions[hist.sessions.length - 1];
  if (!exercise || !last) return null;

  const timeBased = isTimeBasedExercise(exercise);
  const weighted = exercise.recommendedLoads && Object.keys(exercise.recommendedLoads).length > 0;

  if (weighted) return overloadWeighted(hist, exercise, last, availableWeights);
  if (timeBased) return overloadHold(hist, exercise, last);
  return overloadBodyweight(hist, exercise, last);
}

function overloadWeighted(
  hist: ExHistory,
  exercise: Exercise,
  last: ExSession,
  availableWeights?: number[],
): Candidate | null {
  const loads = exercise.recommendedLoads ?? {};
  const keys = loadKeys(loads);
  // The next prescribed step is a rung the user actually owns. When no owned
  // weights are given (default), the full program ladder is assumed.
  const ownedRungs =
    availableWeights && availableWeights.length > 0
      ? availableWeights.filter((w) => loads[String(w)] !== undefined).sort((a, b) => a - b)
      : [];
  const ladder = ownedRungs.length > 0 ? ownedRungs : keys;
  const working = last.working;
  const weight = working.weightUsed ?? 0;
  const reps = working.repsCompleted ?? 0;
  if (weight <= 0 || reps <= 0) return null;

  const onKey = closestLoadKey(keys, weight);
  const onRange = parseRepRange(loads[String(onKey)]?.repRange ?? exercise.reps);
  const qualifying = consecutiveQualifying(hist.sessions, (w) => {
    const wt = w.weightUsed ?? 0;
    const rp = w.repsCompleted ?? 0;
    if (wt <= 0 || rp <= 0) return false;
    const k = closestLoadKey(keys, wt);
    const rr = parseRepRange(loads[String(k)]?.repRange ?? exercise.reps);
    return rp >= rr.max;
  });
  const nextKey = ladder.find((k) => k > onKey);
  // A prescribed rung above the current one exists, but the user doesn't own
  // it — the step is capped by equipment, not by the program.
  const cappedByEquipment = ownedRungs.length > 0 && keys.some((k) => k > onKey);
  const programNext = cappedByEquipment ? keys.find((k) => k > onKey) : undefined;

  const base = `you hit ${reps} reps at ${weight} kg (target ${onRange.min}-${onRange.max} reps)`;

  if (nextKey != null && qualifying >= 2) {
    const nextRange = parseRepRange(loads[String(nextKey)].repRange);
    return {
      id: `overload:${hist.exerciseId}`,
      key: 'overload',
      priority: 0.9,
      decision: `Move ${hist.exerciseName} to ${nextKey} kg next session (aim ${nextRange.min}-${nextRange.max} reps).`,
      reasoning: [
        `${hist.exerciseName}: ${base} for ${qualifying} sessions in a row.`,
        `Next prescribed load: ${nextKey} kg (${nextRange.min}-${nextRange.max} reps).`,
      ],
      confidence: 'high',
      action: {
        type: 'overload',
        exerciseId: hist.exerciseId,
        step: {
          exerciseId: hist.exerciseId,
          exerciseName: hist.exerciseName,
          kind: 'increase_weight',
          current: { loadKg: weight, reps },
          target: { loadKg: nextKey, reps: nextRange.max },
          qualifyingSessions: qualifying,
        },
      },
      source: 'program:recommendedLoads',
    };
  }

  if (nextKey != null && qualifying === 1) {
    const nextRange = parseRepRange(loads[String(nextKey)].repRange);
    return {
      id: `overload:${hist.exerciseId}`,
      key: 'overload',
      priority: 0.75,
      decision: `One more session at the top of the range, then move ${hist.exerciseName} to ${nextKey} kg.`,
      reasoning: [
        `${hist.exerciseName}: ${base} once.`,
        `Confirm it again at ${weight} kg before moving to ${nextKey} kg (${nextRange.min}-${nextRange.max} reps).`,
      ],
      confidence: 'medium',
      action: {
        type: 'overload',
        exerciseId: hist.exerciseId,
        step: {
          exerciseId: hist.exerciseId,
          exerciseName: hist.exerciseName,
          kind: 'increase_reps',
          current: { loadKg: weight, reps },
          target: { loadKg: weight, reps: onRange.max },
          qualifyingSessions: qualifying,
        },
      },
      source: 'program:recommendedLoads',
    };
  }

  if (nextKey != null && reps >= onRange.max - 2) {
    return {
      id: `overload:${hist.exerciseId}`,
      key: 'overload',
      priority: 0.6,
      decision: `Push ${hist.exerciseName} to ${onRange.max} reps at ${weight} kg before adding weight.`,
      reasoning: [
        `${hist.exerciseName}: ${reps} reps at ${weight} kg (target ${onRange.min}-${onRange.max}).`,
      ],
      confidence: 'medium',
      action: {
        type: 'overload',
        exerciseId: hist.exerciseId,
        step: {
          exerciseId: hist.exerciseId,
          exerciseName: hist.exerciseName,
          kind: 'increase_reps',
          current: { loadKg: weight, reps },
          target: { loadKg: weight, reps: onRange.max },
          qualifyingSessions: qualifying,
        },
      },
      source: 'program:recommendedLoads',
    };
  }

  if (nextKey == null && qualifying >= 2) {
    const atTop = !cappedByEquipment;
    return {
      id: `overload:${hist.exerciseId}`,
      key: 'overload',
      priority: 0.7,
      decision: atTop
        ? `${hist.exerciseName} is at the top of the prescribed ladder — consider heavier dumbbells or a harder variation.`
        : `${hist.exerciseName} is at the top of your available dumbbells — add ${programNext} kg (or heavier) to keep progressing.`,
      reasoning: atTop
        ? [
            `${hist.exerciseName}: ${base} for ${qualifying} sessions in a row.`,
            'No heavier prescribed load remains in the program.',
          ]
        : [
            `${hist.exerciseName}: ${base} for ${qualifying} sessions in a row.`,
            `Next prescribed step: ${programNext} kg — not in your equipment profile.`,
          ],
      confidence: 'high',
      action: {
        type: 'overload',
        exerciseId: hist.exerciseId,
        step: {
          exerciseId: hist.exerciseId,
          exerciseName: hist.exerciseName,
          kind: 'progress',
          current: { loadKg: weight, reps },
          target: { note: 'Heavier dumbbells or a harder variation.' },
          qualifyingSessions: qualifying,
        },
      },
      source: 'program:recommendedLoads',
    };
  }

  return null;
}

function overloadHold(
  hist: ExHistory,
  exercise: { name: string; reps: string },
  last: ExSession,
): Candidate | null {
  const targetSecs = parseHoldDuration(exercise.reps);
  const hold = last.working.holdDurationSeconds ?? 0;
  if (hold <= 0) return null;

  const qualifying = consecutiveQualifying(hist.sessions, (w) => (w.holdDurationSeconds ?? 0) >= targetSecs);
  const nextSecs = hold + 5;

  if (qualifying >= 2) {
    return {
      id: `overload:${hist.exerciseId}`,
      key: 'overload',
      priority: 0.85,
      decision: `Extend ${hist.exerciseName} holds to ${nextSecs}s next session.`,
      reasoning: [
        `${hist.exerciseName}: ${hold}s hold (target ${targetSecs}s) for ${qualifying} sessions in a row.`,
        `Next step: ${nextSecs}s.`,
      ],
      confidence: 'high',
      action: {
        type: 'overload',
        exerciseId: hist.exerciseId,
        step: {
          exerciseId: hist.exerciseId,
          exerciseName: hist.exerciseName,
          kind: 'increase_hold',
          current: { holdSeconds: hold },
          target: { holdSeconds: nextSecs },
          qualifyingSessions: qualifying,
        },
      },
      source: 'program:reps',
    };
  }

  if (hold >= targetSecs - 5) {
    return {
      id: `overload:${hist.exerciseId}`,
      key: 'overload',
      priority: 0.5,
      decision: `Work ${hist.exerciseName} holds up to ${targetSecs}s before extending them.`,
      reasoning: [
        `${hist.exerciseName}: ${hold}s hold (target ${targetSecs}s).`,
      ],
      confidence: 'medium',
      action: {
        type: 'overload',
        exerciseId: hist.exerciseId,
        step: {
          exerciseId: hist.exerciseId,
          exerciseName: hist.exerciseName,
          kind: 'increase_reps',
          current: { holdSeconds: hold },
          target: { holdSeconds: targetSecs },
          qualifyingSessions: qualifying,
        },
      },
      source: 'program:reps',
    };
  }

  return null;
}

function overloadBodyweight(
  hist: ExHistory,
  exercise: { name: string; reps: string; progressions: string[] },
  last: ExSession,
): Candidate | null {
  const range = parseRepRange(exercise.reps);
  const reps = last.working.repsCompleted ?? 0;
  if (reps <= 0) return null;

  const qualifying = consecutiveQualifying(hist.sessions, (w) => (w.repsCompleted ?? 0) >= range.max);
  const progression = exercise.progressions[0];

  if (qualifying >= 2 && progression) {
    return {
      id: `overload:${hist.exerciseId}`,
      key: 'overload',
      priority: 0.85,
      decision: `Move on from ${hist.exerciseName} — try ${progression}.`,
      reasoning: [
        `${hist.exerciseName}: ${reps} reps (target ${range.min}-${range.max}) for ${qualifying} sessions in a row.`,
        'Bodyweight progression: switch exercises once the top of the range is mastered.',
      ],
      confidence: 'high',
      action: {
        type: 'overload',
        exerciseId: hist.exerciseId,
        step: {
          exerciseId: hist.exerciseId,
          exerciseName: hist.exerciseName,
          kind: 'progress',
          current: { reps },
          target: { note: progression },
          qualifyingSessions: qualifying,
        },
      },
      source: 'program:progressions',
    };
  }

  if (reps >= range.max - 3) {
    return {
      id: `overload:${hist.exerciseId}`,
      key: 'overload',
      priority: 0.5,
      decision: `Push ${hist.exerciseName} to ${range.max} reps before moving on.`,
      reasoning: [
        `${hist.exerciseName}: ${reps} reps (target ${range.min}-${range.max}).`,
      ],
      confidence: 'medium',
      action: {
        type: 'overload',
        exerciseId: hist.exerciseId,
        step: {
          exerciseId: hist.exerciseId,
          exerciseName: hist.exerciseName,
          kind: 'increase_reps',
          current: { reps },
          target: { reps: range.max },
          qualifyingSessions: qualifying,
        },
      },
      source: 'program:progressions',
    };
  }

  return null;
}

function buildOverloadCandidates(ctx: EngineContext): Candidate[] {
  const histories = collectExerciseHistories(ctx.sessionLogs, ctx.setLogs, ctx.asOfIso);
  histories.sort((a, b) => a.sessions[a.sessions.length - 1].date.localeCompare(
    b.sessions[b.sessions.length - 1].date,
  ));
  const taken = new Set<string>();
  const out: Candidate[] = [];
  for (let i = histories.length - 1; i >= 0 && out.length < ctx.maxOverload; i--) {
    const cand = overloadForExercise(histories[i], ctx.availableWeights);
    if (cand && !taken.has(cand.id)) {
      out.push(cand);
      taken.add(cand.id);
    }
  }
  return out;
}

/* ---------- recovery ---------- */

function buildRecoveryCandidate(ctx: EngineContext): Candidate | null {
  const rec = computeRecoveryScore(ctx.sessionLogs, ctx.setLogs, {
    startIso: ctx.startIso,
    asOf: ctx.asOf,
  });
  if (rec.level === 'ready') return null;

  const straining = rec.contributors.filter((f) => f.direction === 'straining').map((f) => f.detail);
  const reasoning = [
    rec.explanation,
    ...straining.slice(0, 3),
  ];

  if (rec.level === 'overtraining_risk') {
    return {
      id: 'recovery',
      key: 'recovery',
      priority: 0.95,
      decision: rec.recommendation,
      reasoning,
      confidence: rec.confidence,
      action: { type: 'recovery', level: rec.level },
      source: 'recovery',
    };
  }
  if (rec.level === 'tired') {
    return {
      id: 'recovery',
      key: 'recovery',
      priority: 0.8,
      decision: rec.recommendation,
      reasoning,
      confidence: rec.confidence,
      action: { type: 'recovery', level: rec.level },
      source: 'recovery',
    };
  }
  // fresh — a positive nudge.
  return {
    id: 'recovery',
    key: 'recovery',
    priority: 0.6,
    decision: "You're fully recovered — today is a good day to push intensity.",
    reasoning,
    confidence: rec.confidence,
    action: { type: 'recovery', level: rec.level },
    source: 'recovery',
  };
}

/* ---------- deload ---------- */

function buildDeloadCandidate(ctx: EngineContext): Candidate | null {
  const row = getWeekRow(ctx.weekNumber);
  const next = getWeekRow(ctx.weekNumber + 1);
  if (row?.deload) {
    return {
      id: 'deload',
      key: 'deload',
      priority: 0.9,
      decision: `Week ${ctx.weekNumber} is a deload — follow the deload protocol.`,
      reasoning: [
        `Program deload week ${ctx.weekNumber}: ${program.deload_protocol.note}`,
        'Reduced volume this week protects progress and resets fatigue.',
      ],
      confidence: 'high',
      action: { type: 'deload', weekNumber: ctx.weekNumber },
      source: 'program:week_table',
    };
  }
  if (next?.deload) {
    return {
      id: 'deload',
      key: 'deload',
      priority: 0.5,
      decision: `Week ${ctx.weekNumber + 1} is a deload — plan a lighter week.`,
      reasoning: [
        `The program schedules a deload in week ${ctx.weekNumber + 1}.`,
        'Use this week to finish strong and set up a clean deload.',
      ],
      confidence: 'high',
      action: { type: 'deload', weekNumber: ctx.weekNumber + 1 },
      source: 'program:week_table',
    };
  }
  return null;
}

/* ---------- consistency ---------- */

function buildConsistencyCandidate(ctx: EngineContext): Candidate | null {
  const pct = computeTrailingConsistencyPct(ctx.sessionLogs, ctx.startIso, ctx.asOf);
  if (pct == null || pct >= 50) return null;
  return {
    id: 'consistency',
    key: 'consistency',
    priority: 0.7,
    decision: 'Build consistency — aim for a smaller, achievable weekly goal.',
    reasoning: [
      `You completed ${pct}% of planned training days in the last 3 weeks.`,
      'A sustainable schedule beats a perfect one — pick a realistic session count for this week.',
    ],
    confidence: 'medium',
    action: { type: 'consistency', consistencyPct: pct },
    source: 'recovery:consistency',
  };
}

/* ---------- measurement ---------- */

function buildMeasurementCandidate(ctx: EngineContext): Candidate | null {
  const latest = latestMeasurementAtOrBefore(ctx.measurements, ctx.weekNumber);
  if (!latest) {
    return {
      id: 'measurement',
      key: 'measurement',
      priority: 0.55,
      decision: 'Log your starting measurements this week.',
      reasoning: ['No body measurements recorded yet.', 'Weekly measurements make the progress charts meaningful.'],
      confidence: 'high',
      action: { type: 'measurement', daysSinceLast: null },
      source: 'measurements',
    };
  }
  const daysSince = daysSinceIso(ctx.asOf, latest.date);
  if (daysSince > 14) {
    return {
      id: 'measurement',
      key: 'measurement',
      priority: 0.5,
      decision: 'Take your weekly measurements.',
      reasoning: [`Last recorded ${daysSince} days ago.`],
      confidence: 'medium',
      action: { type: 'measurement', daysSinceLast: daysSince },
      source: 'measurements',
    };
  }
  return null;
}

/* ---------- streak ---------- */

function buildStreakCandidate(ctx: EngineContext): Candidate | null {
  const current = computeCurrentStreak(ctx.sessionLogs, ctx.startIso, ctx.asOf);
  const hasHistory = ctx.sessionLogs.some((s) => s.completed);
  if (current === 0 && hasHistory) {
    return {
      id: 'streak',
      key: 'streak',
      priority: 0.65,
      decision: 'Get back on schedule — restart your streak today.',
      reasoning: ['Your streak reset after a missed training day.', 'One session today rebuilds the run.'],
      confidence: 'high',
      action: { type: 'streak', currentStreak: current },
      source: 'streaks',
    };
  }
  return null;
}

/* ---------- milestone ---------- */

function buildMilestoneCandidates(ctx: EngineContext): Candidate[] {
  const data = gatherMilestoneData(ctx.sessionLogs, ctx.setLogs, ctx.startIso, ctx.asOf);
  const progress = getMilestoneProgress(data);
  const close = progress
    .filter(
      (p) =>
        p.id !== 'first-workout' &&
        p.progressCurrent < p.progressTarget &&
        p.progressTarget - p.progressCurrent <= 2,
    )
    .sort((a, b) => {
      const ra = a.progressTarget - a.progressCurrent;
      const rb = b.progressTarget - b.progressCurrent;
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    })
    .slice(0, 2);

  return close.map((p: MilestoneProgress) => {
    const remaining = p.progressTarget - p.progressCurrent;
    return {
      id: `milestone:${p.id}`,
      key: 'milestone',
      priority: remaining === 1 ? 0.72 : 0.62,
      decision: `Almost there — ${remaining} more ${remaining === 1 ? 'session' : 'sessions'} to unlock "${p.title}".`,
      reasoning: [
        `${p.title}: ${p.progressCurrent} of ${p.progressTarget} done.`,
        'Milestones unlock automatically as you complete the target.',
      ],
      confidence: 'high',
      action: { type: 'milestone', milestoneId: p.id, milestoneTitle: p.title, remaining, progressCurrent: p.progressCurrent, progressTarget: p.progressTarget },
      source: 'milestones',
    };
  });
}

/* ---------- orchestrator ---------- */

/**
 * Ranked, deterministic recommendations. Every item explains itself; the
 * engine never suggests anything it cannot justify from the logged data or
 * the program definition.
 */
export function buildRecommendations(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  config: RecommendationConfig,
): Recommendation[] {
  const maxResults = config.maxResults ?? 5;
  const ctx: EngineContext = {
    sessionLogs,
    setLogs,
    measurements,
    startIso: config.startIso,
    asOf: config.asOf,
    asOfIso: isoOf(config.asOf),
    weekNumber: getTodayInfo(config.startIso, config.asOf).weekNumber,
    maxOverload: config.maxOverload ?? 3,
    availableWeights: config.availableWeights,
  };

  const candidates: Candidate[] = [
    ...buildOverloadCandidates(ctx),
    ...buildMilestoneCandidates(ctx),
    buildRecoveryCandidate(ctx),
    buildDeloadCandidate(ctx),
    buildConsistencyCandidate(ctx),
    buildMeasurementCandidate(ctx),
    buildStreakCandidate(ctx),
  ].filter((c): c is Candidate => c != null);

  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });

  const ranked: Recommendation[] = candidates.map((c) => ({
    ...c,
    importance: resolveImportance(c.priority),
    title: resolveTitle(c.key, c.action),
  }));

  return ranked.slice(0, maxResults);
}

/* ---------- grouping ---------- */

const IMPORTANCE_RANK: Record<RecommendationImportance, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function maxPriority(items: Recommendation[]): number {
  return items.reduce((max, r) => Math.max(max, r.priority), 0);
}

export interface RecommendationGroup {
  /** Stable id — a family id ("milestones", "hold-progression") or a single recommendation id. */
  id: string;
  key: RecommendationKey;
  /** Short card headline for the whole group. */
  title: string;
  /** Highest importance tier among the group's items. */
  importance: RecommendationImportance;
  /** Highest priority among the group's items (0..1 sort key). */
  priority: number;
  items: Recommendation[];
}

function singletonGroup(rec: Recommendation): RecommendationGroup {
  return {
    id: rec.id,
    key: rec.key,
    title: rec.title,
    importance: rec.importance,
    priority: rec.priority,
    items: [rec],
  };
}

/**
 * Group related recommendations before rendering so screens present fewer,
 * more meaningful cards:
 *   - every milestone nudge   → one "Milestones Ahead" group (with per-item progress)
 *   - every hold-based overload → one "Hold Progression" group
 * Groups are ordered by importance tier, then by priority. Never mutates the
 * input; deterministic given the same recommendation list.
 */
export function groupRecommendations(recommendations: Recommendation[]): RecommendationGroup[] {
  const isHold = (r: Recommendation): boolean =>
    r.key === 'overload' && r.action.type === 'overload' && r.action.step.kind === 'increase_hold';

  const milestones = recommendations.filter((r) => r.key === 'milestone');
  const holds = recommendations.filter(isHold);
  const others = recommendations.filter((r) => r.key !== 'milestone' && !isHold(r));

  const groups: RecommendationGroup[] = [];
  if (milestones.length > 0) {
    groups.push({
      id: 'milestones',
      key: 'milestone',
      title: 'Milestones Ahead',
      importance: resolveImportance(maxPriority(milestones)),
      priority: maxPriority(milestones),
      items: milestones,
    });
  }
  if (holds.length > 0) {
    groups.push({
      id: 'hold-progression',
      key: 'overload',
      title: 'Hold Progression',
      importance: resolveImportance(maxPriority(holds)),
      priority: maxPriority(holds),
      items: holds,
    });
  }
  groups.push(...others.map(singletonGroup));

  groups.sort((a, b) => {
    const ia = IMPORTANCE_RANK[a.importance];
    const ib = IMPORTANCE_RANK[b.importance];
    if (ia !== ib) return ia - ib;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });

  return groups;
}
