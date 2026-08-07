import type { SessionLog } from '@/lib/db';
import { getTodayInfo } from '@/lib/programEngine';

/**
 * Single source of truth for streak calculations.
 *
 * Semantics (shared by every consumer — Home, Overview, Workout Review,
 * Workout Mode, Milestones, Weekly Report, and the Recovery service):
 *   - A scheduled rest day never breaks a streak; it is simply skipped.
 *   - Any scheduled training day with no completed session breaks the run.
 *   - Every function is deterministic for a given input: nothing here reads
 *     the clock. "Now" must be passed in as `asOf` by the caller.
 */

/** Local calendar date as `YYYY-MM-DD` for the given `Date`. */
export function isoOf(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function completedDatesOf(sessionLogs: SessionLog[]): Set<string> {
  return new Set(sessionLogs.filter((s) => s.completed).map((s) => s.date));
}

/**
 * Counts consecutive completed training days working backwards from `asOf`.
 * If `asOf` is a training day that hasn't been logged yet, counting starts
 * from the previous day so an in-progress day doesn't reset the streak to 0.
 * Rest days never break the streak — they're skipped over. Stops at the first
 * training day with no completed session log.
 */
export function computeCurrentStreak(
  sessionLogs: SessionLog[],
  startIso: string,
  asOf: Date,
): number {
  const completedDates = completedDatesOf(sessionLogs);

  let streak = 0;
  const cursor = new Date(asOf);

  const asOfInfo = getTodayInfo(startIso, cursor);
  if (!asOfInfo.isRestDay && !completedDates.has(isoOf(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  for (let i = 0; i < 365; i++) {
    const info = getTodayInfo(startIso, cursor);
    if (info.daysSinceStart < 0) break;
    const dateStr = isoOf(cursor);

    if (info.isRestDay) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (completedDates.has(dateStr)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Longest run of completed training days, scanning forward from the program
 * start to the latest completed date. Uses the same semantics as
 * `computeCurrentStreak`: rest days are skipped and never break the run,
 * while any missed training day resets it.
 */
export function computeLongestStreak(
  sessionLogs: SessionLog[],
  startIso: string,
): number {
  const completedDates = completedDatesOf(sessionLogs);
  if (completedDates.size === 0) return 0;

  const [sy, sm, sd] = startIso.split('-').map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const maxDate = [...completedDates].sort().at(-1) as string;
  const [ey, em, ed] = maxDate.split('-').map(Number);
  const end = new Date(ey, em - 1, ed);

  let run = 0;
  let longest = 0;
  while (cursor <= end) {
    const info = getTodayInfo(startIso, cursor);
    if (!info.isRestDay) {
      if (completedDates.has(isoOf(cursor))) {
        run++;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return longest;
}

/**
 * Counts consecutive calendar days with a completed session, working
 * backwards from `asOf`. Unlike the streak functions, a rest day DOES break
 * this run — it measures physical back-to-back training (strain), not
 * consistency.
 */
export function computeConsecutiveTrainingDays(
  sessionLogs: SessionLog[],
  asOf: Date,
): number {
  const completedDates = completedDatesOf(sessionLogs);

  let count = 0;
  const cursor = new Date(asOf);
  for (let i = 0; i < 365; i++) {
    if (completedDates.has(isoOf(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return count;
}

/** Date (`YYYY-MM-DD`) of the most recent completed session, or `null`. */
export function latestCompletedDate(sessionLogs: SessionLog[]): string | null {
  const completedDates = completedDatesOf(sessionLogs);
  if (completedDates.size === 0) return null;
  return [...completedDates].sort().at(-1) as string;
}

export interface StreakSummary {
  current: number;
  longest: number;
  /** Back-to-back calendar training days as of `asOf` (rest days break it). */
  consecutive: number;
  /** Most recent completed session date, or `null` if none. */
  lastTrainingDate: string | null;
}

/** All streak numbers a consumer may need, from one deterministic call. */
export function computeStreakSummary(
  sessionLogs: SessionLog[],
  startIso: string,
  asOf: Date,
): StreakSummary {
  return {
    current: computeCurrentStreak(sessionLogs, startIso, asOf),
    longest: computeLongestStreak(sessionLogs, startIso),
    consecutive: computeConsecutiveTrainingDays(sessionLogs, asOf),
    lastTrainingDate: latestCompletedDate(sessionLogs),
  };
}
