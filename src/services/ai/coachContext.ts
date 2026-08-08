/**
 * CoachContext — the deterministic snapshot the AI coach is allowed to see.
 *
 * This module builds a compact, sanitized `CoachContext` from the app's
 * existing service layer. It contains NO raw database dump: every value is the
 * output of a trusted, deterministic service (recovery, recommendations,
 * streaks, trends, milestones, measurements), plus today's program plan and
 * the user's equipment profile. This is the only bridge between the model and
 * the user's data — the model never reads storage and never re-derives a
 * number.
 *
 * Determinism: `asOf` is injected (never the clock), all inputs are plain
 * data, and the output is stable for a fixed input. Sanitization: free-text
 * notes and raw session/set ids are stripped; only human-meaningful, bounded
 * facts are emitted.
 */
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';
import { program, getExercisesForSession, getWeekRow } from '@/lib/data';
import { getTodayInfo, todayIso } from '@/lib/programEngine';
import { computeRecoveryScore } from '@/services/recovery/recoveryScore';
import { buildRecommendations, type Recommendation } from '@/services/recommendations/recommendationEngine';
import { computeStreakSummary } from '@/services/streaks/streakEngine';
import { computeTrendReport } from '@/services/trends/trendEngine';
import {
  gatherMilestoneData,
  getMilestoneProgress,
  type MilestoneProgress,
} from '@/lib/milestones';
import {
  latestMeasurementAtOrBefore,
  measurementDelta,
} from '@/services/measurements/measurementDeltas';
import type { EquipmentProfile } from '@/lib/equipment';
import type {
  CoachContext,
  CoachWorkoutSection,
  CoachMilestoneSection,
  CoachMeasurementsSection,
  CoachTrendSection,
} from './aiTypes.ts';

export interface CoachContextConfig {
  /** ISO date the program started. */
  startIso: string;
  /** "Now". Deterministic output requires the caller to fix this date. */
  asOf: Date;
  /** The user's equipment profile (dumbbell ladder etc.). */
  equipment: EquipmentProfile;
  /** Cap on recent workouts / recommendations / trends included. Defaults sensible. */
  maxRecentWorkouts?: number;
  maxRecommendations?: number;
  maxTrends?: number;
  maxMilestones?: number;
}

const TREND_PRIORITY = ['consistency', 'volume', 'load', 'energy', 'sleep', 'rpe', 'duration'] as const;

function workoutSection(session: SessionLog, setLogs: SetLog[]): CoachWorkoutSection {
  const mine = setLogs.filter(
    (l) => l.date === session.date && l.sessionKey === session.sessionKey,
  );
  const exercises = getExercisesForSession(session.sessionKey).map((e) => e.name);
  const volume = mine.reduce((sum, l) => sum + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);
  const load = mine.reduce((sum, l) => sum + (l.weightUsed ?? 0) * (l.repsCompleted ?? 0), 0);
  return {
    date: session.date,
    sessionLabel: program.sessions[session.sessionKey]?.title ?? session.sessionKey,
    rpe: session.rpe ?? null,
    durationMin: session.durationMin ?? null,
    energy: session.energy ?? null,
    exercises,
    volume,
    load,
  };
}

function milestoneSections(
  progress: MilestoneProgress[],
  maxMilestones: number,
): CoachMilestoneSection[] {
  return progress
    .filter((p) => p.id !== 'first-workout' && p.progressCurrent < p.progressTarget)
    .sort((a, b) => {
      const ra = a.progressTarget - a.progressCurrent;
      const rb = b.progressTarget - b.progressCurrent;
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    })
    .slice(0, maxMilestones)
    .map((p) => ({
      id: p.id,
      title: p.title,
      current: p.progressCurrent,
      target: p.progressTarget,
    }));
}

function measurementsSection(
  measurements: MeasurementEntry[],
  weekNumber: number,
): CoachMeasurementsSection {
  const latest = latestMeasurementAtOrBefore(measurements, weekNumber);
  const prev = latest == null ? null : latestMeasurementAtOrBefore(measurements, latest.week - 1);
  return {
    latest: latest ? { date: latest.date, weight: latest.weight ?? null } : null,
    deltas: measurementDelta(prev, latest).map((d) => ({
      label: d.label,
      change: d.change,
      unit: d.unit,
    })),
  };
}

/**
 * Build the deterministic, sanitized snapshot the coach is allowed to see.
 * Missing data is *marked*, never invented: `missing` lists what is absent so
 * the model can say "that isn't recorded yet" instead of guessing.
 */
export function buildCoachContext(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  config: CoachContextConfig,
): CoachContext {
  const maxRecentWorkouts = config.maxRecentWorkouts ?? 5;
  const maxRecommendations = config.maxRecommendations ?? 5;
  const maxTrends = config.maxTrends ?? 4;
  const maxMilestones = config.maxMilestones ?? 3;

  const today = getTodayInfo(config.startIso, config.asOf);
  const asOfIso = todayIso(config.asOf);

  const recovery = computeRecoveryScore(sessionLogs, setLogs, {
    startIso: config.startIso,
    asOf: config.asOf,
  });

  const recommendations = buildRecommendations(sessionLogs, setLogs, measurements, {
    startIso: config.startIso,
    asOf: config.asOf,
    maxResults: maxRecommendations,
    availableWeights: config.equipment.dumbbells,
  });

  const streak = computeStreakSummary(sessionLogs, config.startIso, config.asOf);

  const report = computeTrendReport(sessionLogs, setLogs);
  const trendByKey = new Map(report.metrics.map((m) => [m.key, m]));
  const trendSections: CoachTrendSection[] = [];
  for (const key of TREND_PRIORITY) {
    if (trendSections.length >= maxTrends) break;
    const m = trendByKey.get(key);
    if (m && m.direction !== 'insufficient') {
      trendSections.push({ key: m.key, label: m.label, direction: m.direction, explanation: m.explanation });
    }
  }

  const milestones = milestoneSections(
    getMilestoneProgress(gatherMilestoneData(sessionLogs, setLogs, config.startIso, config.asOf)),
    maxMilestones,
  );

  const completed = sessionLogs
    .filter((s) => s.completed)
    .sort((a, b) => b.date.localeCompare(a.date) || b.sessionKey.localeCompare(a.sessionKey));
  const recentWorkouts = completed.slice(0, maxRecentWorkouts).map((s) => workoutSection(s, setLogs));

  const todayEntry = program.weekly_template[today.dayIndex];
  const todayExercises = today.isRestDay
    ? []
    : getExercisesForSession(todayEntry.session_key).map((e) => e.name);

  const missing: string[] = [];
  if (completed.length === 0) missing.push('no completed workouts');
  if (recovery.contributors.length < 3) missing.push('limited recovery signals');
  if (measurements.length === 0) missing.push('no body measurements');
  if (trendSections.length === 0) missing.push('no trends yet');
  if (today.isRestDay) missing.push("today is a scheduled rest day");

  const weekRow = getWeekRow(today.weekNumber);
  const nextTraining = (() => {
    const template = program.weekly_template;
    for (let offset = 1; offset < template.length + 1; offset++) {
      const day = template[(today.dayIndex + offset) % template.length];
      if (day.session_key !== 'rest') return day.label;
    }
    return null;
  })();

  return {
    asOfIso,
    program: {
      startIso: config.startIso,
      weekNumber: today.weekNumber,
      weekRow: weekRow ? { phase: weekRow.phase, focus: weekRow.focus, isDeload: weekRow.deload } : null,
      isProgramComplete: today.isProgramComplete,
      nextSessionLabel: nextTraining,
    },
    today: {
      isRestDay: today.isRestDay,
      sessionKey: today.isRestDay ? null : todayEntry.session_key,
      sessionLabel: today.isRestDay ? null : todayEntry.label,
      exercises: todayExercises,
    },
    recovery: {
      score: recovery.score,
      level: recovery.level,
      explanation: recovery.explanation,
      recommendation: recovery.recommendation,
      confidence: recovery.confidence,
      contributors: recovery.contributors.map((f) => ({
        label: f.label,
        direction: f.direction,
        detail: f.detail,
      })),
    },
    recentWorkouts,
    recommendations: recommendations.map((r: Recommendation) => ({
      title: r.title,
      decision: r.decision,
      reasoning: r.reasoning,
      confidence: r.confidence,
      actionType: r.action.type,
    })),
    trends: trendSections,
    streak: {
      current: streak.current,
      longest: streak.longest,
      consecutive: streak.consecutive,
      lastTrainingDate: streak.lastTrainingDate,
    },
    milestones,
    measurements: measurementsSection(measurements, today.weekNumber),
    equipment: {
      dumbbellsKg: config.equipment.dumbbells,
      hasBench: config.equipment.hasBench,
      hasBands: config.equipment.hasBands,
      hasPullUpBar: config.equipment.hasPullUpBar,
      hasMat: config.equipment.hasMat,
      hasKettlebell: config.equipment.hasKettlebell,
    },
    missing,
  };
}
