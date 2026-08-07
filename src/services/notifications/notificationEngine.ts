import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';
import {
  buildRecommendations,
  type Recommendation,
  type RecommendationAction,
  type RecommendationImportance,
  type RecommendationKey,
} from '@/services/recommendations/recommendationEngine';
import { getTodayInfo } from '@/lib/programEngine';
import { program, getExercisesForSession } from '@/lib/data';
import { weekDateRange, parseDate } from '@/services/report/weekRange';
import type { WeeklyReport } from '@/services/report/weeklyReport';

export type NotificationCategory =
  | 'workout'
  | 'recovery'
  | 'recommendation'
  | 'milestone'
  | 'consistency'
  | 'measurement'
  | 'progress_photos'
  | 'weekly_review';

export interface CoachedNotification {
  id: string;
  category: NotificationCategory;
  importance: RecommendationImportance;
  title: string;
  body: string;
  reason: string[];
  action: RecommendationAction | null;
  scheduledFor: string;
  expiresAt: string;
}

export interface NotificationEngineConfig {
  startIso: string;
  asOf: Date;
  reminderTime?: string;
  minImportance?: RecommendationImportance;
  /** Dumbbell weights (kg) the user owns — overload notifications never name
   *  an unowned load when the caller supplies the equipment profile. */
  availableWeights?: number[];
}

const IMPORTANCE_RANK: Record<RecommendationImportance, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export function categoryFor(key: RecommendationKey): NotificationCategory {
  switch (key) {
    case 'overload': return 'recommendation';
    case 'recovery': return 'recovery';
    case 'deload': return 'recommendation';
    case 'consistency': return 'consistency';
    case 'measurement': return 'measurement';
    case 'streak': return 'recommendation';
    case 'milestone': return 'milestone';
  }
}

function atTimeIso(date: Date, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function endOfCurrentWeek(startIso: string, asOf: Date): Date {
  const week = getTodayInfo(startIso, asOf).weekNumber;
  const endIso = weekDateRange(startIso, week).endIso;
  return endOfDay(parseDate(endIso));
}

function nextSessionDateForExercise(
  exerciseId: string,
  dayIndex: number,
  from: Date,
): Date {
  const template = program.weekly_template;
  for (let offset = 0; offset < template.length; offset++) {
    const day = template[(dayIndex + offset) % template.length];
    if (day.session_key === 'rest') continue;
    const scheduled = getExercisesForSession(day.session_key);
    if (scheduled.some((e) => e.id === exerciseId)) {
      const d = new Date(from);
      d.setDate(d.getDate() + offset);
      return d;
    }
  }
  return from;
}

function expiresAtFor(rec: Recommendation, config: NotificationEngineConfig): Date {
  switch (rec.key) {
    case 'overload': {
      const exerciseId = rec.action.type === 'overload' ? rec.action.exerciseId : null;
      if (exerciseId) {
        const dayIndex = getTodayInfo(config.startIso, config.asOf).dayIndex;
        return endOfDay(nextSessionDateForExercise(exerciseId, dayIndex, config.asOf));
      }
      return endOfDay(config.asOf);
    }
    case 'recovery':
    case 'streak':
      return endOfDay(config.asOf);
    case 'deload':
    case 'consistency':
    case 'measurement':
    case 'milestone':
      return endOfCurrentWeek(config.startIso, config.asOf);
  }
}

function formatNotification(
  rec: Recommendation,
  config: NotificationEngineConfig,
  reminderTime: string,
): CoachedNotification {
  return {
    id: `${categoryFor(rec.key)}:${rec.id}`,
    category: categoryFor(rec.key),
    importance: rec.importance,
    title: rec.title,
    body: rec.decision,
    reason: rec.reasoning,
    action: rec.action,
    scheduledFor: atTimeIso(config.asOf, reminderTime),
    expiresAt: expiresAtFor(rec, config).toISOString(),
  };
}

export function buildDailyNotifications(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  config: NotificationEngineConfig,
): CoachedNotification[] {
  const minImportance = config.minImportance ?? 'high';
  const reminderTime = config.reminderTime ?? '18:00';

  const recommendations = buildRecommendations(sessionLogs, setLogs, measurements, {
    startIso: config.startIso,
    asOf: config.asOf,
    maxResults: 5,
    availableWeights: config.availableWeights,
  });

  const floor = IMPORTANCE_RANK[minImportance];
  const best = recommendations.find(
    (r) => IMPORTANCE_RANK[r.importance] >= floor,
  );

  if (!best) return [];
  return [formatNotification(best, config, reminderTime)];
}

/**
 * A weekly check-in notification built from the Weekly Report service. Only
 * produces output when `asOf` falls on the report week's end date (the natural
 * "week's over" moment). The body and reason come entirely from the report's
 * own narrative and summary — the engine formats, it never re-derives.
 */
export function buildWeeklyReviewNotification(
  report: WeeklyReport,
  config: { startIso: string; asOf: Date; reminderTime?: string },
): CoachedNotification | null {
  const todayIso = parseDateIso(config.asOf);
  if (todayIso !== report.weekRange.endIso) return null;

  const reminderTime = config.reminderTime ?? '18:00';
  const body =
    report.narrative[0] ??
    `${report.summary.sessionsCompleted} of ${report.summary.plannedSessions} sessions completed this week.`;

  return {
    id: `weekly_review:${report.weekNumber}`,
    category: 'weekly_review',
    importance: 'normal',
    title: `Week ${report.weekNumber} Review`,
    body,
    reason: report.narrative.slice(1, 4),
    action: null,
    scheduledFor: atTimeIso(config.asOf, reminderTime),
    expiresAt: endOfDay(config.asOf).toISOString(),
  };
}

function parseDateIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
