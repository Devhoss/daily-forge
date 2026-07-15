import type { SessionLog, SetLog } from "@/lib/db";
import { program } from "@/lib/data";
import { getTodayInfo } from "@/lib/programEngine";

export interface WeeklyStat {
  week: number;
  consistencyPct: number;
  totalReps: number;
  avgRpe: number | null;
  avgEnergy: number | null;
  avgSleep: number | null;
  sessionsCompleted: number;
}

const TRAINING_SESSIONS_PER_WEEK = program.weekly_template.filter(
  (d) => d.session_key !== "rest",
).length;

export function computeWeeklyStats(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
): WeeklyStat[] {
  const maxWeek = program.week_table.length;
  const stats: WeeklyStat[] = [];

  for (let week = 1; week <= maxWeek; week++) {
    const weekSessions = sessionLogs.filter(
      (s) => s.weekNumber === week && s.completed,
    );
    const weekDates = new Set(weekSessions.map((s) => s.date));
    const weekSetLogs = setLogs.filter((sl) => weekDates.has(sl.date));

    const totalReps = weekSetLogs.reduce(
      (sum, sl) => sum + (sl.repsCompleted ?? 0),
      0,
    );

    const rpeValues = weekSessions
      .map((s) => s.rpe)
      .filter((v): v is number => v != null);
    const energyValues = weekSessions
      .map((s) => s.energy)
      .filter((v): v is number => v != null);
    const sleepValues = weekSessions
      .map((s) => s.sleepHours)
      .filter((v): v is number => v != null);

    stats.push({
      week,
      consistencyPct: Math.round(
        (weekSessions.length / TRAINING_SESSIONS_PER_WEEK) * 100,
      ),
      totalReps,
      avgRpe: average(rpeValues),
      avgEnergy: average(energyValues),
      avgSleep: average(sleepValues),
      sessionsCompleted: weekSessions.length,
    });
  }

  return stats;
}

export interface OverallStats {
  totalSessionsCompleted: number;
  totalReps: number;
  avgRpe: number | null;
  weeksLogged: number;
}

export function computeOverallStats(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
): OverallStats {
  const completed = sessionLogs.filter((s) => s.completed);
  const totalReps = setLogs.reduce(
    (sum, sl) => sum + (sl.repsCompleted ?? 0),
    0,
  );
  const rpeValues = completed
    .map((s) => s.rpe)
    .filter((v): v is number => v != null);
  const weeksLogged = new Set(completed.map((s) => s.weekNumber)).size;

  return {
    totalSessionsCompleted: completed.length,
    totalReps,
    avgRpe: average(rpeValues),
    weeksLogged,
  };
}

export function computeProgramCompletionPct(daysSinceStart: number): number {
  const totalDays = program.week_table.length * program.weekly_template.length;
  return Math.min(
    100,
    Math.max(0, Math.round((daysSinceStart / totalDays) * 100)),
  );
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return (
    Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
  );
}

/** Counts consecutive training days completed working backwards from today
 * (or yesterday, if today hasn't been trained yet). Rest days never break
 * the streak — they're just skipped over. Stops at the first training day
 * with no completed session log. */
export function computeCurrentStreak(
  sessionLogs: SessionLog[],
  startIso: string,
  today: Date = new Date(),
): number {
  const completedDates = new Set(
    sessionLogs.filter((s) => s.completed).map((s) => s.date),
  );

  let streak = 0;
  const cursor = new Date(today);

  // If today is a training day but not yet logged, start checking from
  // yesterday instead so an in-progress day doesn't reset the streak to 0.
  const todayInfo = getTodayInfo(startIso, cursor);
  const todayIsoStr = isoOf(cursor);
  if (!todayInfo.isRestDay && !completedDates.has(todayIsoStr)) {
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

function isoOf(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Only returns weeks that actually have at least one logged session —
 * avoids a flat line of zeros stretching out to week 12 before you get there. */
export function trimToLoggedWeeks(stats: WeeklyStat[]): WeeklyStat[] {
  const lastLoggedIndex = [...stats]
    .reverse()
    .findIndex((s) => s.sessionsCompleted > 0);
  if (lastLoggedIndex === -1) return stats.slice(0, 1);
  const cutoff = stats.length - lastLoggedIndex;
  return stats.slice(0, cutoff);
}
