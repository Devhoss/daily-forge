/**
 * Recovery — a rich, deterministic recovery analysis built from the same
 * typed data the other services consume. It never reads the clock and never
 * guesses: every factor either has enough data to be evaluated or is omitted
 * (with the analysis confidence reflecting coverage).
 *
 * All windows are anchored to `config.asOf`, which the caller chooses ("today"
 * in the UI, or a report week's end date for a snapshot).
 *
 * Reused services:
 *   - streaks       → src/services/streaks/streakEngine.ts (consecutive days,
 *                     last training date)
 *   - trends        → src/services/trends/trendEngine.ts (average)
 *   - program       → src/lib/programEngine.ts (scheduled rest days)
 *
 * Workout-specific measurement lives in acuteStrain.ts (the "signal" service);
 * this module only maps that normalized signal to an impact. Future Health
 * Adapter sources (sleep, HRV, heart rate, Samsung Health, Health Connect,
 * Apple Health) plug into the same pipeline by emitting the same normalized
 * strain signal and reusing `strainImpact` — the engine internals don't change.
 */
import type { SessionLog, SetLog } from '@/lib/db';
import { daysBetween, getTodayInfo } from '@/lib/programEngine';
import { average } from '@/services/trends/trendEngine';
import {
  computeConsecutiveTrainingDays,
  latestCompletedDate,
  isoOf,
} from '@/services/streaks/streakEngine';
import { analyzeLatestSession } from '@/services/recovery/acuteStrain';

export type RecoveryFactorKey =
  | 'rpe_trend'
  | 'volume_trend'
  | 'consecutive_training_days'
  | 'planned_rest'
  | 'consistency'
  | 'workload_trend'
  | 'time_since_last_workout'
  | 'acute_session_strain';

export type RecoveryFactorDirection = 'straining' | 'recovering' | 'neutral' | 'informational';

export interface RecoveryFactor {
  key: RecoveryFactorKey;
  label: string;
  direction: RecoveryFactorDirection;
  /** Signed points toward the 0-100 score (positive = more recovered). */
  impact: number;
  /** One-line, plain-language reading of this factor. */
  detail: string;
}

export type RecoveryLevel = 'fresh' | 'ready' | 'tired' | 'overtraining_risk';

export interface RecoveryAnalysis {
  /** 0-100 composite; higher = more recovered. */
  score: number;
  level: RecoveryLevel;
  /** Factors with enough data, in a stable order. */
  contributors: RecoveryFactor[];
  /** Composite plain-language summary of the signals. */
  explanation: string;
  /** Plain-language suggestion based on the level. */
  recommendation: string;
  /** How much of the factor set the analysis is based on. */
  confidence: 'low' | 'medium' | 'high';
}

export interface RecoveryConfig {
  /** ISO date the program started. Anchors rest days and program weeks. */
  startIso: string;
  /** "Now". Deterministic output requires the caller to fix this date. */
  asOf: Date;
}

/**
 * Developer-only instrumentation. `computeRecoveryScore` stays a pure,
 * deterministic function — it never reads the clock for its *output*. When a
 * developer enables debug mode, it additionally records the raw inputs and
 * per-factor evaluation of every call (for the hidden debug page and console),
 * and keeps a bounded ring buffer of the most recent traces so the state
 * before and after a workout can be compared.
 */
export interface RecoveryFactorTrace {
  key: RecoveryFactorKey;
  /** Raw inputs the factor evaluated (dev-only, never user-facing). */
  raw: Record<string, number | string | boolean | null | undefined>;
  /** The resulting factor, or null when there was not enough data. */
  factor: RecoveryFactor | null;
}

export interface RecoveryDebugTrace {
  /** ISO timestamp of the computation. */
  at: string;
  config: { startIso: string; asOfIso: string };
  inputs: {
    sessionLogCount: number;
    setLogCount: number;
    /** The `asOf` calendar date — whether today's session was logged yet. */
    todayIso: string;
    /** True when a completed session log dated `todayIso` was in the inputs. */
    todayCompletedIncluded: boolean;
  };
  factors: RecoveryFactorTrace[];
  output: RecoveryAnalysis;
}

let debugEnabled = false;
let tracingEnabled = true;
let recentTraces: RecoveryDebugTrace[] = [];
const MAX_RECENT_TRACES = 30;

/** Enable/disable the recovery debug mode (console logging of every call). */
export function setRecoveryDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isRecoveryDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Enable/disable the in-memory recovery trace ring buffer. Dev tooling only —
 * never affects the analysis output. Defaults to on so before/after traces are
 * available; disabling stops recording (and clears what was kept).
 */
export function setRecoveryTracingEnabled(enabled: boolean): void {
  tracingEnabled = enabled;
  if (!enabled) recentTraces = [];
}

export function isRecoveryTracingEnabled(): boolean {
  return tracingEnabled;
}

/** Most recent `computeRecoveryScore` traces, oldest first. */
export function getRecoveryDebugTraces(): readonly RecoveryDebugTrace[] {
  return recentTraces;
}

export function clearRecoveryDebugTraces(): void {
  recentTraces = [];
}

function clamp(v: number, min: number, max: number): number {
  // Normalize -0 to 0 so impact equality checks are stable.
  if (v === 0) return 0;
  return Math.min(max, Math.max(min, v));
}

function daysAgoIso(asOf: Date, days: number): string {
  const d = new Date(asOf);
  d.setDate(d.getDate() - days);
  return isoOf(d);
}

function completedIn(
  sessionLogs: SessionLog[],
  fromIso: string,
  toIso: string,
): SessionLog[] {
  return sessionLogs.filter((s) => s.completed && s.date >= fromIso && s.date <= toIso);
}

function volumeOf(sets: SetLog[], completedDates: Set<string>): number {
  return sets
    .filter((s) => completedDates.has(s.date))
    .reduce((sum, s) => sum + (s.repsCompleted ?? s.holdDurationSeconds ?? 0), 0);
}

interface EvalContext {
  sessionLogs: SessionLog[];
  setLogs: SetLog[];
  startIso: string;
  asOf: Date;
  /** Dev-only per-factor trace recorder (present only when instrumenting). */
  traces?: RecoveryFactorTrace[];
}

/** Record a factor evaluation into the dev trace, if one is being collected. */
function traceFactor(
  ctx: EvalContext,
  key: RecoveryFactorKey,
  raw: Record<string, number | string | boolean | null | undefined>,
  factor: RecoveryFactor | null,
): void {
  ctx.traces?.push({ key, raw, factor });
}

function evalRpeTrend(ctx: EvalContext): RecoveryFactor | null {
  const recent = completedIn(ctx.sessionLogs, daysAgoIso(ctx.asOf, 6), isoOf(ctx.asOf));
  const prior = completedIn(ctx.sessionLogs, daysAgoIso(ctx.asOf, 13), daysAgoIso(ctx.asOf, 7));
  const recentRpe = average(recent.map((s) => s.rpe).filter((v): v is number => v != null));
  const priorRpe = average(prior.map((s) => s.rpe).filter((v): v is number => v != null));

  let factor: RecoveryFactor | null = null;
  if (recentRpe != null && priorRpe != null) {
    const delta = recentRpe - priorRpe;
    const impact = clamp(Math.round(-delta * 8), -12, 12);
    const direction: RecoveryFactorDirection =
      delta > 0.5 ? 'straining' : delta < -0.5 ? 'recovering' : 'neutral';
    factor = {
      key: 'rpe_trend',
      label: 'Recent RPE',
      direction,
      impact,
      detail: `Average RPE ${recentRpe} this week vs ${priorRpe} the week before.`,
    };
  }
  traceFactor(ctx, 'rpe_trend', { recentRpe, priorRpe, recentCount: recent.length, priorCount: prior.length }, factor);
  return factor;
}

function evalVolumeTrend(ctx: EvalContext): RecoveryFactor | null {
  const recentDates = new Set(
    completedIn(ctx.sessionLogs, daysAgoIso(ctx.asOf, 6), isoOf(ctx.asOf)).map((s) => s.date),
  );
  const priorDates = new Set(
    completedIn(ctx.sessionLogs, daysAgoIso(ctx.asOf, 13), daysAgoIso(ctx.asOf, 7)).map((s) => s.date),
  );
  const recentVol = volumeOf(ctx.setLogs, recentDates);
  const priorVol = volumeOf(ctx.setLogs, priorDates);
  if (recentVol === 0 && priorVol === 0) {
    traceFactor(ctx, 'volume_trend', { recentVol, priorVol, pct: null }, null);
    return null;
  }
  if (priorVol === 0) {
    const factor: RecoveryFactor = {
      key: 'volume_trend',
      label: 'Recent volume',
      direction: 'straining',
      impact: -10,
      detail: 'Training volume jumped from nothing to a full workload this week.',
    };
    traceFactor(ctx, 'volume_trend', { recentVol, priorVol, pct: null }, factor);
    return factor;
  }
  const pct = (recentVol - priorVol) / priorVol;
  const impact = clamp(Math.round(-pct * 100 * 0.12), -12, 10);
  const direction: RecoveryFactorDirection =
    pct > 0.2 ? 'straining' : pct < -0.2 ? 'recovering' : 'neutral';
  const magnitude = Math.abs(Math.round(pct * 100));
  const factor: RecoveryFactor = {
    key: 'volume_trend',
    label: 'Recent volume',
    direction,
    impact,
    detail:
      pct === 0
        ? 'Weekly volume is steady vs the previous week.'
        : `Weekly volume ${pct > 0 ? 'up' : 'down'} ${magnitude}% vs the previous week.`,
  };
  traceFactor(ctx, 'volume_trend', { recentVol, priorVol, pct }, factor);
  return factor;
}

function evalConsecutiveDays(ctx: EvalContext): RecoveryFactor | null {
  const consecutive = computeConsecutiveTrainingDays(ctx.sessionLogs, ctx.asOf);
  const impact = consecutive <= 1 ? 0 : clamp(-(consecutive - 1) * 2, -14, 0);
  const direction: RecoveryFactorDirection = consecutive >= 4 ? 'straining' : 'neutral';
  const factor: RecoveryFactor = {
    key: 'consecutive_training_days',
    label: 'Consecutive training days',
    direction,
    impact,
    detail:
      consecutive <= 1
        ? 'No consecutive-day strain right now.'
        : `Trained ${consecutive} days in a row.`,
  };
  traceFactor(ctx, 'consecutive_training_days', { consecutive }, factor);
  return factor;
}

function evalPlannedRest(ctx: EvalContext): RecoveryFactor {
  const todayInfo = getTodayInfo(ctx.startIso, ctx.asOf);
  const tomorrow = new Date(ctx.asOf);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowInfo = getTodayInfo(ctx.startIso, tomorrow);
  const consecutive = computeConsecutiveTrainingDays(ctx.sessionLogs, ctx.asOf);

  let factor: RecoveryFactor;
  if (todayInfo.isRestDay) {
    factor = {
      key: 'planned_rest',
      label: 'Planned rest',
      direction: 'recovering',
      impact: 8,
      detail: 'Today is a scheduled rest day.',
    };
  } else if (tomorrowInfo.isRestDay) {
    factor = {
      key: 'planned_rest',
      label: 'Planned rest',
      direction: 'recovering',
      impact: 8,
      detail: 'A scheduled rest day is coming up tomorrow.',
    };
  } else if (consecutive >= 3) {
    factor = {
      key: 'planned_rest',
      label: 'Planned rest',
      direction: 'straining',
      impact: -4,
      detail: `No rest day in the next two days after ${consecutive} straight training days.`,
    };
  } else {
    factor = {
      key: 'planned_rest',
      label: 'Planned rest',
      direction: 'neutral',
      impact: 0,
      detail: 'The next scheduled days are training days.',
    };
  }
  traceFactor(
    ctx,
    'planned_rest',
    { todayIsRestDay: todayInfo.isRestDay, tomorrowIsRestDay: tomorrowInfo.isRestDay, consecutive },
    factor,
  );
  return factor;
}

function plannedSessionsInRange(startIso: string, fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const cursor = new Date(fy, fm - 1, fd);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const end = new Date(ty, tm - 1, td);
  let count = 0;
  while (cursor <= end) {
    if (!getTodayInfo(startIso, cursor).isRestDay) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Percentage of planned training days completed over the trailing 21 days (or
 * since the program start if the program is younger). `null` when no session
 * has ever been completed. Shared by the recovery `consistency` factor and the
 * recommendation engine's consistency signal.
 */
export function computeTrailingConsistencyPct(
  sessionLogs: SessionLog[],
  startIso: string,
  asOf: Date,
): number | null {
  const completed = sessionLogs.filter((s) => s.completed);
  if (completed.length === 0) return null;

  const fromIso = daysAgoIso(asOf, 20) < startIso ? startIso : daysAgoIso(asOf, 20);
  const done = completedIn(sessionLogs, fromIso, isoOf(asOf)).length;
  const planned = plannedSessionsInRange(startIso, fromIso, isoOf(asOf));
  return planned > 0 ? clamp(Math.round((done / planned) * 100), 0, 100) : 0;
}

function evalConsistency(ctx: EvalContext): RecoveryFactor | null {
  const pct = computeTrailingConsistencyPct(ctx.sessionLogs, ctx.startIso, ctx.asOf);
  if (pct == null) {
    traceFactor(ctx, 'consistency', { pct, completedSessions: ctx.sessionLogs.filter((s) => s.completed).length }, null);
    return null;
  }

  const impact = pct >= 85 ? 6 : pct >= 50 ? 0 : -4;
  const direction: RecoveryFactorDirection =
    pct >= 85 ? 'recovering' : pct < 50 ? 'straining' : 'neutral';
  const factor: RecoveryFactor = {
    key: 'consistency',
    label: 'Consistency',
    direction,
    impact,
    detail:
      pct >= 85
        ? `Consistent schedule — ${pct}% of planned sessions completed.`
        : pct >= 50
          ? `Mixed consistency — ${pct}% of planned sessions completed.`
          : `Erratic schedule — only ${pct}% of planned sessions completed.`,
  };
  traceFactor(
    ctx,
    'consistency',
    { pct, completedSessions: ctx.sessionLogs.filter((s) => s.completed).length },
    factor,
  );
  return factor;
}

function evalWorkloadTrend(ctx: EvalContext): RecoveryFactor | null {
  const completed = ctx.sessionLogs.filter((s) => s.completed);
  const weeks = [...new Set(completed.map((s) => s.weekNumber))].sort((a, b) => a - b);
  const lastWeek = weeks.at(-1);
  if (lastWeek == null || weeks.length < 2) {
    traceFactor(ctx, 'workload_trend', { weekCount: weeks.length }, null);
    return null;
  }
  const prevWeek = weeks[weeks.length - 2];

  const lastDates = new Set(
    completed.filter((s) => s.weekNumber === lastWeek).map((s) => s.date),
  );
  const prevDates = new Set(
    completed.filter((s) => s.weekNumber === prevWeek).map((s) => s.date),
  );
  const lastVol = volumeOf(ctx.setLogs, lastDates);
  const prevVol = volumeOf(ctx.setLogs, prevDates);
  if (lastVol === 0 || prevVol === 0) {
    traceFactor(ctx, 'workload_trend', { lastWeek, prevWeek, lastVol, prevVol, pct: null }, null);
    return null;
  }

  const pct = (lastVol - prevVol) / prevVol;
  const impact = clamp(Math.round(-pct * 100 * 0.08), -10, 8);
  const direction: RecoveryFactorDirection =
    pct > 0.2 ? 'straining' : pct < -0.2 ? 'recovering' : 'neutral';
  const magnitude = Math.abs(Math.round(pct * 100));
  const factor: RecoveryFactor = {
    key: 'workload_trend',
    label: 'Weekly workload',
    direction,
    impact,
    detail:
      pct === 0
        ? 'Weekly workload is steady vs the prior logged week.'
        : `Weekly workload ${pct > 0 ? 'up' : 'down'} ${magnitude}% from the prior logged week.`,
  };
  traceFactor(ctx, 'workload_trend', { lastWeek, prevWeek, lastVol, prevVol, pct }, factor);
  return factor;
}

function evalTimeSinceLastWorkout(ctx: EvalContext): RecoveryFactor | null {
  const last = latestCompletedDate(ctx.sessionLogs);
  if (last == null) {
    traceFactor(ctx, 'time_since_last_workout', { lastCompletedDate: null, days: null }, null);
    return null;
  }

  const days = Math.max(0, daysBetween(last, ctx.asOf));

  const impact = days === 0 ? -4 : days === 1 ? -2 : days === 2 ? 0 : days <= 6 ? 6 : days <= 14 ? 5 : 3;
  const direction: RecoveryFactorDirection = days >= 2 ? 'recovering' : 'neutral';
  const factor: RecoveryFactor = {
    key: 'time_since_last_workout',
    label: 'Time since last workout',
    direction,
    impact,
    detail:
      days === 0
        ? 'Trained today.'
        : `Last workout ${days} ${days === 1 ? 'day' : 'days'} ago.`,
  };
  traceFactor(ctx, 'time_since_last_workout', { lastCompletedDate: last, days }, factor);
  return factor;
}

/**
 * Map a measured strain signal (0-100) and its calendar-day recency (0 =
 * today) to a signed recovery impact. Shared by every strain signal the
 * readiness model consumes, so a future Health Adapter source (sleep, HRV,
 * heart rate) only has to emit the same signal shape that the acute-strain
 * service produces — no changes to this mapping.
 */
export function strainImpact(strain: number, recencyDays: number): number {
  const decay =
    recencyDays === 0 ? 1 : recencyDays === 1 ? 0.7 : recencyDays === 2 ? 0.4 : 0.2;
  return clamp(-Math.round(strain * 0.1 * decay), -10, 0);
}

function evalAcuteSessionStrain(ctx: EvalContext): RecoveryFactor | null {
  const analysis = analyzeLatestSession(ctx.sessionLogs, ctx.setLogs, ctx.asOf);
  const raw = {
    sessionDate: analysis.session?.date ?? null,
    recencyDays: analysis.recencyDays,
    inAcuteWindow: analysis.inAcuteWindow,
    strain: analysis.strain,
    level: analysis.level,
    setCount: analysis.signals?.setCount ?? null,
    volume: analysis.signals?.volume ?? null,
    load: analysis.signals?.load ?? null,
    rpe: analysis.signals?.rpe ?? null,
    durationMin: analysis.signals?.durationMin ?? null,
    energy: analysis.signals?.energy ?? null,
  };
  if (analysis.session == null || !analysis.inAcuteWindow || analysis.strain == null) {
    traceFactor(ctx, 'acute_session_strain', raw, null);
    return null;
  }

  const impact = strainImpact(analysis.strain, analysis.recencyDays ?? 0);
  const factor: RecoveryFactor = {
    key: 'acute_session_strain',
    label: 'Acute session strain',
    direction: impact < 0 ? 'straining' : 'neutral',
    impact,
    detail: analysis.detail,
  };
  traceFactor(ctx, 'acute_session_strain', raw, factor);
  return factor;
}

/** Compute the recovery analysis. Deterministic for a fixed `asOf`. */
export function computeRecoveryScore(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  config: RecoveryConfig,
): RecoveryAnalysis {
  const traces: RecoveryFactorTrace[] = [];
  const ctx: EvalContext = {
    sessionLogs,
    setLogs,
    startIso: config.startIso,
    asOf: config.asOf,
    traces,
  };

  const evaluated = [
    evalRpeTrend(ctx),
    evalVolumeTrend(ctx),
    evalConsecutiveDays(ctx),
    evalPlannedRest(ctx),
    evalConsistency(ctx),
    evalWorkloadTrend(ctx),
    evalTimeSinceLastWorkout(ctx),
    evalAcuteSessionStrain(ctx),
  ].filter((f): f is RecoveryFactor => f != null);

  const totalDelta = evaluated.reduce((sum, f) => sum + f.impact, 0);
  // Neutral base is 65 ("ready"): a fully untrained, well-rested state scores
  // as ready, and strain factors drive the score down from there.
  const score = clamp(Math.round(65 + totalDelta), 0, 100);

  const level: RecoveryLevel =
    score >= 85 ? 'fresh' : score >= 65 ? 'ready' : score >= 45 ? 'tired' : 'overtraining_risk';

  const strains = evaluated
    .filter((f) => f.direction === 'straining')
    .map((f) => f.label.toLowerCase());
  const recovers = evaluated
    .filter((f) => f.direction === 'recovering')
    .map((f) => f.label.toLowerCase());

  const explanation = `Recovery is estimated at ${score}/100 (${level}). ${
    strains.length ? `Strain signals: ${strains.join(', ')}.` : 'No major strain signals.'
  } ${
    recovers.length
      ? `Recovery signals: ${recovers.join(', ')}.`
      : ''
  }`;

  const recommendation =
    level === 'fresh'
      ? "You're fully recovered — today is a good day to push intensity."
      : level === 'ready'
        ? "You're recovered enough to follow your normal plan."
        : level === 'tired'
          ? 'Take it easy today — consider a lighter session or an extra rest day.'
          : 'Consider a rest day or a deload session. Prioritize sleep and keep RPE moderate.';

  const confidence: RecoveryAnalysis['confidence'] =
    evaluated.length >= 5 ? 'high' : evaluated.length >= 3 ? 'medium' : 'low';

  const output: RecoveryAnalysis = { score, level, contributors: evaluated, explanation, recommendation, confidence };

  if (traces.length > 0) {
    const trace: RecoveryDebugTrace = {
      at: new Date().toISOString(),
      config: { startIso: config.startIso, asOfIso: isoOf(config.asOf) },
      inputs: {
        sessionLogCount: sessionLogs.length,
        setLogCount: setLogs.length,
        todayIso: isoOf(config.asOf),
        todayCompletedIncluded: sessionLogs.some(
          (s) => s.completed && s.date === isoOf(config.asOf),
        ),
      },
      factors: traces,
      output,
    };
    if (tracingEnabled) {
      recentTraces.push(trace);
      if (recentTraces.length > MAX_RECENT_TRACES) recentTraces.shift();
    }

    if (debugEnabled) {
      console.debug('[recovery] computeRecoveryScore()', {
        config,
        inputSessionLogs: sessionLogs,
        inputSetLogs: setLogs,
        trace,
      });
    }
  }

  return output;
}
