/**
 * WeeklyReport — orchestrates the existing services into a single typed report
 * for one program week. This module is a *thin composer*: it contains no
 * analytics formulas. Every calculation is delegated to a reusable service:
 *
 *   - trends            → src/services/trends/trendEngine.ts      (M1)
 *   - PRs set this week → src/lib/prs.ts (detectPRsSetInDateRange)
 *   - milestones earned → src/lib/milestones.ts (gatherMilestoneData,
 *                          getNewlyUnlockedMilestones)
 *   - streak            → src/services/streaks/streakEngine.ts
 *   - recovery          → src/services/recovery/recoveryScore.ts
 *   - recommendations   → src/services/recommendations/recommendationEngine.ts
 *   - measurements      → src/services/measurements/measurementDeltas.ts
 *   - week calendar     → src/services/report/weekRange.ts
 *
 * Everything is deterministic: week snapshots are anchored to the report
 * week's end date, never to `Date.now()`.
 *
 * Side-effect note: composing milestones invokes `computeMilestoneStates`,
 * which persists milestone unlock dates to localStorage (idempotent, existing
 * app behavior). Report building does not otherwise write anything.
 */
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';
import { program, getWeekRow, getExercise } from '@/lib/data';
import { computeTrendReport, type TrendReport } from '@/services/trends/trendEngine';
import { detectPRsSetInDateRange, type SessionPR } from '@/lib/prs';
import {
  gatherMilestoneData,
  getNewlyUnlockedMilestones,
  type MilestoneWithState,
} from '@/lib/milestones';
import { computeCurrentStreak, computeLongestStreak } from '@/services/streaks/streakEngine';
import { computeRecoveryScore, type RecoveryAnalysis } from '@/services/recovery/recoveryScore';
import { buildRecommendations, type Recommendation } from '@/services/recommendations/recommendationEngine';
import { weekDateRange, parseDate } from './weekRange.ts';
import {
  latestMeasurementAtOrBefore,
  measurementDelta,
  type MeasurementDelta,
} from '@/services/measurements/measurementDeltas';

export interface WeeklyReportConfig {
  /** 1-based program week to report on. */
  weekNumber: number;
  /** ISO date the program started. Anchors week ranges + streak. */
  startDate: string;
  /** Overrides the program's training-sessions-per-week for consistency. */
  trainingSessionsPerWeek?: number;
  /** Dumbbell weights (kg) the user owns — embedded overload recommendations
   *  never name an unowned load when the caller supplies the equipment. */
  availableWeights?: number[];
}

export interface WeeklyWorkoutEntry {
  date: string;
  sessionKey: string;
  title: string;
  rpe: number | null;
  durationMin: number | null;
  energy: number | null;
  sleepHours: number | null;
  bodyWeight: number | null;
  notes: string | null;
}

export interface WeeklyMeasurements {
  /** Measurement recorded in or before the report week (latest wins). */
  recorded: MeasurementEntry | null;
  /** Week of the earlier measurement used for deltas (null = baseline). */
  previousWeek: number | null;
  deltas: MeasurementDelta[];
}

export interface WeeklyFocus {
  phase: string;
  focus: string;
  isDeload: boolean;
  next: { week: number; phase: string; focus: string; isDeload: boolean } | null;
}

/** Recovery analysis anchored to the report week's end date. */
export interface WeeklyReport {
  weekNumber: number;
  weekRange: { startIso: string; endIso: string };
  summary: {
    sessionsCompleted: number;
    plannedSessions: number;
    consistencyPct: number;
    volume: number;
    avgRpe: number | null;
    avgDurationMin: number | null;
    avgEnergy: number | null;
    avgSleep: number | null;
    currentStreak: number;
    longestStreak: number;
    lifetimeReps: number;
  };
  workouts: WeeklyWorkoutEntry[];
  trends: TrendReport;
  prs: SessionPR[];
  milestonesEarned: MilestoneWithState[];
  measurements: WeeklyMeasurements;
  recoveryScore: RecoveryAnalysis;
  recommendations: Recommendation[];
  focus: WeeklyFocus;
  /** Coach-style highlights composed from the services' own explanations. */
  narrative: string[];
}

function trainingSessionsPerWeek(cfg: WeeklyReportConfig): number {
  if (cfg.trainingSessionsPerWeek != null) return cfg.trainingSessionsPerWeek;
  return program.weekly_template.filter((d) => d.session_key !== 'rest').length;
}

function avgOf(
  sessions: SessionLog[],
  get: (s: SessionLog) => number | undefined,
): number | null {
  const vals: number[] = [];
  for (const s of sessions) {
    const v = get(s);
    if (typeof v === 'number') vals.push(v);
  }
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

/** Compose narrative highlights from facets the services already produced. */
function buildNarrative(
  report: {
    summary: WeeklyReport['summary'];
    workouts: WeeklyWorkoutEntry[];
    prs: SessionPR[];
    milestonesEarned: MilestoneWithState[];
    measurements: WeeklyMeasurements;
    trends: TrendReport;
  },
): string[] {
  const lines: string[] = [];

  const { sessionsCompleted, plannedSessions, consistencyPct, volume } = report.summary;
  if (sessionsCompleted > 0) {
    lines.push(
      `${sessionsCompleted} of ${plannedSessions} sessions completed — ${consistencyPct}% consistency, ${volume} total reps.`,
    );
  } else {
    lines.push(
      `No sessions completed this week. ${plannedSessions} sessions were planned.`,
    );
  }

  // Up to two strongest trend signals (deterministic order: consistency, volume, load).
  const priority = ['consistency', 'volume', 'load'] as const;
  let added = 0;
  for (const key of priority) {
    if (added >= 2) break;
    const m = report.trends.metrics.find((t) => t.key === key);
    if (m && m.direction !== 'insufficient' && m.direction !== 'steady') {
      lines.push(m.explanation);
      added++;
    }
  }

  for (const pr of report.prs) {
    lines.push(prSentence(pr));
  }

  for (const m of report.milestonesEarned) {
    lines.push(`Milestone unlocked — ${m.title}.`);
  }

  for (const d of report.measurements.deltas) {
    if (d.change != null) {
      lines.push(
        `${d.label}: ${d.prev} → ${d.curr} ${d.unit} (${d.change > 0 ? '+' : ''}${d.change}).`,
      );
    }
  }

  return lines;
}

function prSentence(pr: SessionPR): string {
  const name = getExercise(pr.exerciseId)?.name ?? pr.exerciseId;
  const label =
    pr.type === 'weight'
      ? `load PR (${pr.current} kg)`
      : pr.type === 'reps'
        ? `rep PR (${pr.current} reps)`
        : pr.type === 'volume'
          ? `volume PR (${pr.current} kg·reps)`
          : `hold PR (${pr.current}s)`;
  return `New ${name} ${label}.`;
}

/**
 * Build the typed weekly report. Inputs are the full histories; the builder
 * snapshots everything to the report week (data on or before `endIso`) so a
 * historical week reads the same as the current one.
 */
export function buildWeeklyReport(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  config: WeeklyReportConfig,
): WeeklyReport {
  const planned = trainingSessionsPerWeek(config);
  const { startIso, endIso } = weekDateRange(config.startDate, config.weekNumber);
  const beforeWeek = (date: string) => date < startIso;
  const inWeek = (date: string) => date >= startIso && date <= endIso;
  const throughWeek = (date: string) => date <= endIso;

  // ---- snapshots ----
  const throughLogs = sessionLogs.filter((s) => throughWeek(s.date));
  const throughSets = setLogs.filter((s) => throughWeek(s.date));
  const weekSessions = sessionLogs
    .filter((s) => s.completed && inWeek(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const completedDates = new Set(weekSessions.map((s) => s.date));
  const weekSets = throughSets.filter((s) => completedDates.has(s.date));

  // ---- facets (delegated to services) ----
  const trends = computeTrendReport(throughLogs, throughSets, { trainingSessionsPerWeek: planned });
  const prs = detectPRsSetInDateRange(throughSets, startIso, endIso);

  const logsBeforeWeek = sessionLogs.filter((s) => beforeWeek(s.date));
  const currentData = gatherMilestoneData(throughLogs, throughSets, config.startDate);
  const prevData = gatherMilestoneData(logsBeforeWeek, throughSets, config.startDate);
  const milestonesEarned = getNewlyUnlockedMilestones(prevData, currentData);

  const recorded = latestMeasurementAtOrBefore(measurements, config.weekNumber);
  const prevMeas =
    recorded == null ? null : latestMeasurementAtOrBefore(measurements, recorded.week - 1);

  const weekRow = getWeekRow(config.weekNumber);
  const nextRow = getWeekRow(config.weekNumber + 1);

  // ---- assemble ----
  const report: WeeklyReport = {
    weekNumber: config.weekNumber,
    weekRange: { startIso, endIso },
    summary: {
      sessionsCompleted: weekSessions.length,
      plannedSessions: planned,
      consistencyPct: Math.round((weekSessions.length / planned) * 100),
      volume: weekSets.reduce(
        (sum, s) => sum + (s.repsCompleted ?? s.holdDurationSeconds ?? 0),
        0,
      ),
      avgRpe: avgOf(weekSessions, (s) => s.rpe),
      avgDurationMin: avgOf(weekSessions, (s) => s.durationMin),
      avgEnergy: avgOf(weekSessions, (s) => s.energy),
      avgSleep: avgOf(weekSessions, (s) => s.sleepHours),
      currentStreak: computeCurrentStreak(throughLogs, config.startDate, parseDate(endIso)),
      longestStreak: computeLongestStreak(throughLogs, config.startDate),
      lifetimeReps: currentData.lifetimeReps,
    },
    workouts: weekSessions.map((s) => ({
      date: s.date,
      sessionKey: s.sessionKey,
      title: program.sessions[s.sessionKey]?.title ?? s.sessionKey,
      rpe: s.rpe ?? null,
      durationMin: s.durationMin ?? null,
      energy: s.energy ?? null,
      sleepHours: s.sleepHours ?? null,
      bodyWeight: s.bodyWeight ?? null,
      notes: s.notes ?? null,
    })),
    trends,
    prs,
    milestonesEarned,
    measurements: {
      recorded,
      previousWeek: prevMeas?.week ?? null,
      deltas: measurementDelta(prevMeas, recorded),
    },
    recoveryScore: computeRecoveryScore(throughLogs, throughSets, {
      startIso: config.startDate,
      asOf: parseDate(endIso),
    }),
    recommendations: buildRecommendations(throughLogs, throughSets, measurements, {
      startIso: config.startDate,
      asOf: parseDate(endIso),
      availableWeights: config.availableWeights,
    }),
    focus: {
      phase: weekRow?.phase ?? 'Foundation',
      focus: weekRow?.focus ?? '',
      isDeload: weekRow?.deload ?? false,
      next: nextRow
        ? { week: nextRow.week, phase: nextRow.phase, focus: nextRow.focus, isDeload: nextRow.deload }
        : null,
    },
    narrative: [],
  };

  report.narrative = buildNarrative(report);
  return report;
}
