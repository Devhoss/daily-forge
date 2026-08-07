/**
 * Central export for the training-intelligence service layer.
 *
 * Every service here is a pure, typed, deterministic function over the app's
 * data (session/set/measurement logs) plus an explicitly passed-in `asOf`
 * date. Services never touch React, Dexie, localStorage, or the clock.
 *
 * The UI, notifications, and the future Gemma coach all consume these same
 * functions — that keeps explanations and numbers consistent everywhere.
 */
export * from '@/services/trends/trendEngine';
export * from '@/services/streaks/streakEngine';
export * from '@/services/recovery/recoveryScore';
export * from '@/services/recommendations/recommendationEngine';
export * from '@/services/notifications/notificationEngine';
export {
  buildCoachSummary,
  type CoachSummary,
  type CoachSummaryConfig,
} from '@/services/coaching/coachSummary';
export {
  buildWeeklyReport,
  type WeeklyReport,
  type WeeklyReportConfig,
} from '@/services/report/weeklyReport';
