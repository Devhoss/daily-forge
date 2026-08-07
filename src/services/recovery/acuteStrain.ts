/**
 * Acute Session Strain — a pure, deterministic measurement service for the
 * most recently completed workout. It is deliberately "measure, not model":
 * it turns raw session/set logs into a single normalized strain score (0-100)
 * plus the raw signals behind it (RPE, duration, energy, completed sets,
 * volume, load) and the calendar-day recency of that workout.
 *
 * The recovery readiness model (recoveryScore.ts) consumes this output as one
 * factor; it never re-derives workout-specific math. That split is the plug-in
 * point for future Health Adapter sources (sleep, HRV, heart rate, Samsung
 * Health, Health Connect, Apple Health): each adapter is a pure measurement
 * service that emits the same normalized signal — a 0-100 strain, a recency,
 * and a plain-language detail — and the readiness model maps it to an impact
 * with the same code path. No recovery-engine internals change.
 *
 * Determinism: like the rest of the service layer, this never reads the clock
 * for its output. `asOf` is supplied by the caller and recency is measured in
 * whole calendar days (via daysBetween), so a workout logged today is "0 days
 * ago" at any time of day.
 *
 * Same-day tie-break: when several sessions are completed on the latest day,
 * the lexicographically first sessionKey is used. Deterministic; the common
 * case is a single session per day.
 */
import type { SessionLog, SetLog } from '@/lib/db';
import { daysBetween } from '@/lib/programEngine';

/** A workout older than this many calendar days is no longer "acute". */
export const ACUTE_WINDOW_DAYS = 3;

export type StrainLevel = 'none' | 'light' | 'moderate' | 'high' | 'very-high';

export interface LatestSessionRef {
  date: string;
  weekNumber: number;
  sessionKey: string;
}

/** Raw, human-meaningful signals of the latest workout (null = not logged). */
export interface AcuteSessionSignals {
  /** Rated perceived exertion, 1-10. */
  rpe: number | null;
  /** Session length in minutes. */
  durationMin: number | null;
  /** Subjective energy at session start, 1-5 (lower = started more drained). */
  energy: number | null;
  /** Number of set logs recorded for the session. */
  setCount: number;
  /** Sum of reps (or hold-seconds for timed sets) across the session. */
  volume: number;
  /** Sum of weightUsed (kg) × reps for loaded sets (informational only). */
  load: number;
}

/**
 * The normalized strain signal the readiness model consumes. A future health
 * adapter (sleep, HRV, heart rate) emits the same shape: a 0-100 `strain`, a
 * calendar-day `recencyDays`, and a `detail`. The engine's impact mapping then
 * applies unchanged.
 */
export interface LatestSessionAnalysis {
  /** The analyzed workout, or null when no completed session exists. */
  session: LatestSessionRef | null;
  /** Calendar days between the session date and `asOf` (0 = today). */
  recencyDays: number | null;
  /** True when the workout is recent enough to still be "acute". */
  inAcuteWindow: boolean;
  signals: AcuteSessionSignals | null;
  /** 0-100, or null when the session recorded no measurable strain inputs. */
  strain: number | null;
  level: StrainLevel;
  /** One-line, plain-language reading used directly as the factor detail. */
  detail: string;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Bucket a 0-100 strain into a plain-language level. */
export function strainLevelOf(strain: number): StrainLevel {
  if (strain === 0) return 'none';
  if (strain < 30) return 'light';
  if (strain < 55) return 'moderate';
  if (strain < 80) return 'high';
  return 'very-high';
}

function latestSessionOf(sessionLogs: SessionLog[]): SessionLog | null {
  const completed = sessionLogs.filter((s) => s.completed);
  if (completed.length === 0) return null;
  const latestDate = completed.reduce((max, s) => (s.date > max ? s.date : max), completed[0].date);
  const thatDay = completed.filter((s) => s.date === latestDate);
  return thatDay.sort((a, b) => a.sessionKey.localeCompare(b.sessionKey))[0] ?? null;
}

function signalsOf(session: SessionLog, setLogs: SetLog[]): AcuteSessionSignals {
  const mine = setLogs.filter(
    (l) => l.date === session.date && l.sessionKey === session.sessionKey,
  );
  const volume = mine.reduce((sum, l) => sum + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);
  const load = mine.reduce((sum, l) => sum + (l.weightUsed ?? 0) * (l.repsCompleted ?? 0), 0);
  return {
    rpe: session.rpe ?? null,
    durationMin: session.durationMin ?? null,
    energy: session.energy ?? null,
    setCount: mine.length,
    volume,
    load,
  };
}

/**
 * Normalize the raw signals into a bounded 0-100 acute strain. Effort (RPE)
 * dominates, then duration, then how drained the athlete started (energy),
 * then mechanical work (sets/volume). Each signal is capped so a single
 * extreme value can't dominate. Returns null when no signal was recorded.
 */
export function acuteStrainOf(signals: AcuteSessionSignals): number | null {
  if (
    signals.rpe == null &&
    signals.durationMin == null &&
    signals.energy == null &&
    signals.setCount === 0 &&
    signals.volume === 0
  ) {
    return null;
  }
  const rpeShare = signals.rpe == null ? 0 : clamp01((signals.rpe - 1) / 9) * 40;
  const energyShare = signals.energy == null ? 0 : clamp01((5 - signals.energy) / 4) * 15;
  const durationShare = signals.durationMin == null ? 0 : clamp01(signals.durationMin / 120) * 25;
  const setShare = clamp01(signals.setCount / 20) * 10;
  const volumeShare = clamp01(signals.volume / 400) * 10;
  return Math.round(rpeShare + energyShare + durationShare + setShare + volumeShare);
}

function detailOf(level: StrainLevel, signals: AcuteSessionSignals): string {
  const parts: string[] = [];
  if (signals.rpe != null) parts.push(`${signals.rpe} RPE`);
  if (signals.durationMin != null) parts.push(`${signals.durationMin} min`);
  if (signals.energy != null) parts.push(`energy ${signals.energy}/5`);
  if (signals.setCount > 0) parts.push(`${signals.setCount} sets`);
  if (signals.volume > 0) parts.push(`${signals.volume} total reps`);
  const label =
    level === 'none'
      ? 'No measurable'
      : level === 'light'
        ? 'Light'
        : level === 'moderate'
          ? 'Moderate'
          : level === 'high'
            ? 'High'
            : 'Very high';
  return parts.length > 0
    ? `${label} acute strain — ${parts.join(', ')}.`
    : `${label} acute strain this session.`;
}

/**
 * Analyze the most recently completed workout into a normalized acute strain
 * signal. Deterministic for a fixed `asOf`.
 */
export function analyzeLatestSession(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  asOf: Date,
): LatestSessionAnalysis {
  const session = latestSessionOf(sessionLogs);
  if (session == null) {
    return {
      session: null,
      recencyDays: null,
      inAcuteWindow: false,
      signals: null,
      strain: null,
      level: 'none',
      detail: 'No completed workout on record.',
    };
  }

  const signals = signalsOf(session, setLogs);
  const recencyDays = Math.max(0, daysBetween(session.date, asOf));
  const strain = acuteStrainOf(signals);
  const level = strain == null ? 'none' : strainLevelOf(strain);

  return {
    session: {
      date: session.date,
      weekNumber: session.weekNumber,
      sessionKey: session.sessionKey,
    },
    recencyDays,
    inAcuteWindow: recencyDays <= ACUTE_WINDOW_DAYS,
    signals,
    strain,
    level,
    detail: detailOf(level, signals),
  };
}
