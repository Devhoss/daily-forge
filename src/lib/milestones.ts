import type { SessionLog, SetLog } from '@/lib/db';
import { program } from '@/lib/data';
import { computeCurrentStreak } from '@/lib/analytics';

/* ---------- types ---------- */

export type MilestoneCategory = 'Consistency' | 'Performance' | 'Program';

export interface MilestoneDef {
  id: string;
  title: string;
  category: MilestoneCategory;
  description: string;
  celebration?: string;
}

export interface MilestoneState {
  def: MilestoneDef;
  unlocked: boolean;
  unlockDate: string | null;
  progressCurrent: number;
  progressTarget: number;
}

export interface MilestoneData {
  completedSessions: number;
  sessionsPerWeek: Record<number, number>;
  totalTrainingDays: number;
  currentStreak: number;
  longestStreak: number;
  lifetimeReps: number;
  totalProgramWeeks: number;
  programComplete: boolean;
  sessionLogs: SessionLog[];
  allSetLogs: SetLog[];
  startDate: string;
}

/* ---------- persistence ---------- */

const STORAGE_KEY = 'milestone_unlock_dates';

function loadPersistedDates(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function persistDate(id: string, date: string): void {
  try {
    const existing = loadPersistedDates();
    if (!existing[id]) {
      existing[id] = date;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    }
  } catch {}
}

/* ---------- definitions ---------- */

function define(
  id: string,
  title: string,
  category: MilestoneCategory,
  description: string,
  celebration?: string,
): MilestoneDef {
  return { id, title, category, description, celebration };
}

const ALL_MILESTONES: MilestoneDef[] = [
  // ----- Consistency -----
  define('first-workout', 'First Workout', 'Consistency', 'Complete your first workout', 'You showed up! The journey begins.'),
  define('workouts-5', '5 Workouts', 'Consistency', 'Complete 5 workouts'),
  define('workouts-10', '10 Workouts', 'Consistency', 'Complete 10 workouts'),
  define('workouts-25', '25 Workouts', 'Consistency', 'Complete 25 workouts'),
  define('workouts-50', '50 Workouts', 'Consistency', 'Complete 50 workouts'),
  define('workouts-100', '100 Workouts', 'Consistency', 'Complete 100 workouts'),
  define('streak-3', '3-Day Streak', 'Consistency', 'Complete 3 training days in a row'),
  define('streak-5', '5-Day Streak', 'Consistency', 'Complete 5 training days in a row'),
  define('streak-7', '7-Day Streak', 'Consistency', 'Complete 7 training days in a row'),
  define('streak-10', '10-Day Streak', 'Consistency', 'Complete 10 training days in a row'),
  define('streak-15', '15-Day Streak', 'Consistency', 'Complete 15 training days in a row'),
  define('streak-20', '20-Day Streak', 'Consistency', 'Complete 20 training days in a row'),
  define('streak-30', '30-Day Streak', 'Consistency', 'Complete 30 training days in a row'),
  define('streak-50', '50-Day Streak', 'Consistency', 'Complete 50 training days in a row'),
  define('streak-75', '75-Day Streak', 'Consistency', 'Complete 75 training days in a row'),
  define('streak-100', '100-Day Streak', 'Consistency', 'Complete 100 training days in a row'),

  // ----- Performance -----
  define('reps-100', '100 Lifetime Reps', 'Performance', 'Accumulate 100 total reps'),
  define('reps-500', '500 Lifetime Reps', 'Performance', 'Accumulate 500 total reps'),
  define('reps-1000', '1,000 Lifetime Reps', 'Performance', 'Accumulate 1,000 total reps'),
  define('reps-2000', '2,000 Lifetime Reps', 'Performance', 'Accumulate 2,000 total reps'),
  define('reps-5000', '5,000 Lifetime Reps', 'Performance', 'Accumulate 5,000 total reps'),
  define('reps-10000', '10,000 Lifetime Reps', 'Performance', 'Accumulate 10,000 total reps'),

  // ----- Program -----
  ...Array.from({ length: program.week_table.length }, (_, i) => {
    const week = i + 1;
    return define(
      `week-${week}-complete`,
      `Week ${week} Complete`,
      'Program',
      `Complete all ${getTrainingDaysPerWeek()} workouts in Week ${week}`,
    );
  }),
  define('foundation-complete', 'Foundation Complete', 'Program', 'Complete all 12 weeks of the program', 'You built your foundation. Incredible work.'),
];

function getTrainingDaysPerWeek(): number {
  return program.weekly_template.filter((d) => d.session_key !== 'rest').length;
}

/* ---------- unlock condition ---------- */

function isUnlocked(def: MilestoneDef, data: MilestoneData): boolean {
  const { completedSessions, sessionsPerWeek, totalTrainingDays, longestStreak, lifetimeReps, programComplete } = data;

  switch (def.id) {
    case 'first-workout': return completedSessions >= 1;
    case 'workouts-5': return completedSessions >= 5;
    case 'workouts-10': return completedSessions >= 10;
    case 'workouts-25': return completedSessions >= 25;
    case 'workouts-50': return completedSessions >= 50;
    case 'workouts-100': return completedSessions >= 100;

    case 'streak-3': return longestStreak >= 3;
    case 'streak-5': return longestStreak >= 5;
    case 'streak-7': return longestStreak >= 7;
    case 'streak-10': return longestStreak >= 10;
    case 'streak-15': return longestStreak >= 15;
    case 'streak-20': return longestStreak >= 20;
    case 'streak-30': return longestStreak >= 30;
    case 'streak-50': return longestStreak >= 50;
    case 'streak-75': return longestStreak >= 75;
    case 'streak-100': return longestStreak >= 100;

    case 'reps-100': return lifetimeReps >= 100;
    case 'reps-500': return lifetimeReps >= 500;
    case 'reps-1000': return lifetimeReps >= 1000;
    case 'reps-2000': return lifetimeReps >= 2000;
    case 'reps-5000': return lifetimeReps >= 5000;
    case 'reps-10000': return lifetimeReps >= 10000;

    default: {
      if (def.id.startsWith('week-')) {
        const weekNum = parseInt(def.id.replace('week-', '').replace('-complete', ''), 10);
        return (sessionsPerWeek[weekNum] ?? 0) >= totalTrainingDays;
      }
      if (def.id === 'foundation-complete') return programComplete;
      return false;
    }
  }
}

/* ---------- unlock date computation ---------- */

function computeUnlockDate(
  def: MilestoneDef,
  data: MilestoneData,
): string | null {
  const persisted = loadPersistedDates();
  if (persisted[def.id]) return persisted[def.id];

  const { sessionLogs, totalTrainingDays } = data;
  const completed = [...sessionLogs.filter((s) => s.completed)].sort((a, b) => a.date.localeCompare(b.date));

  switch (def.id) {
    case 'first-workout': return completed[0]?.date ?? null;
    case 'workouts-5': return completed[4]?.date ?? null;
    case 'workouts-10': return completed[9]?.date ?? null;
    case 'workouts-25': return completed[24]?.date ?? null;
    case 'workouts-50': return completed[49]?.date ?? null;
    case 'workouts-100': return completed[99]?.date ?? null;

    case 'streak-3':
    case 'streak-5':
    case 'streak-7':
    case 'streak-10':
    case 'streak-15':
    case 'streak-20':
    case 'streak-30':
    case 'streak-50':
    case 'streak-75':
    case 'streak-100': {
      return findStreakUnlockDate(def, completed, data);
    }

    case 'reps-100': return findRepUnlockDate(100, data);
    case 'reps-500': return findRepUnlockDate(500, data);
    case 'reps-1000': return findRepUnlockDate(1000, data);
    case 'reps-2000': return findRepUnlockDate(2000, data);
    case 'reps-5000': return findRepUnlockDate(5000, data);
    case 'reps-10000': return findRepUnlockDate(10000, data);

    default: {
      if (def.id.startsWith('week-')) {
        const weekNum = parseInt(def.id.replace('week-', '').replace('-complete', ''), 10);
        return findWeekUnlockDate(weekNum, totalTrainingDays, data);
      }
      if (def.id === 'foundation-complete') {
        return completed[completed.length - 1]?.date ?? null;
      }
      return null;
    }
  }
}

function findStreakUnlockDate(
  def: MilestoneDef,
  completed: SessionLog[],
  _data: MilestoneData,
): string | null {
  const target = parseInt(def.id.replace('streak-', ''), 10);
  const dates = [...new Set(completed.map((s) => s.date))].sort();
  let run = 0;
  for (let i = 0; i < dates.length; i++) {
    if (i === 0) { run = 1; continue; }
    const prev = new Date(dates[i - 1] + 'T00:00:00');
    const curr = new Date(dates[i] + 'T00:00:00');
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    run = diff === 1 ? run + 1 : 1;
    if (run >= target) return dates[i];
  }
  return null;
}

function findRepUnlockDate(target: number, data: MilestoneData): string | null {
  const { sessionLogs, allSetLogs } = data;
  const sessions = sessionLogs.filter((s) => s.completed).sort((a, b) => a.date.localeCompare(b.date));
  let cumulative = 0;
  for (const s of sessions) {
    const sets = allSetLogs.filter((l) => l.date === s.date && l.sessionKey === s.sessionKey);
    cumulative += sets.reduce((sum, l) => sum + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);
    if (cumulative >= target) return s.date;
  }
  return null;
}

function findWeekUnlockDate(
  weekNum: number,
  totalTrainingDays: number,
  data: MilestoneData,
): string | null {
  const { sessionLogs } = data;
  const weekSessions = sessionLogs
    .filter((s) => s.completed && s.weekNumber === weekNum)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weekSessions.length >= totalTrainingDays) {
    return weekSessions[totalTrainingDays - 1].date;
  }
  return null;
}

/* ---------- data gathering ---------- */

export function gatherMilestoneData(
  sessionLogs: SessionLog[],
  allSetLogs: SetLog[],
  startDate: string,
): MilestoneData {
  const completed = sessionLogs.filter((s) => s.completed);
  const sessionsPerWeek: Record<number, number> = {};
  for (const s of completed) {
    sessionsPerWeek[s.weekNumber] = (sessionsPerWeek[s.weekNumber] ?? 0) + 1;
  }
  const totalTrainingDays = getTrainingDaysPerWeek();
  const currentStreak = computeCurrentStreak(sessionLogs, startDate);
  const lifetimeReps = allSetLogs.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);
  const totalProgramWeeks = program.week_table.length;

  const allDates = [...new Set(completed.map((s) => s.date))].sort();
  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < allDates.length; i++) {
    if (i === 0) { run = 1; continue; }
    const prev = new Date(allDates[i - 1] + 'T00:00:00');
    const curr = new Date(allDates[i] + 'T00:00:00');
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    run = diff === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }
  if (allDates.length > 0 && longestStreak === 0) longestStreak = 1;

  const completedWeeks = Object.keys(sessionsPerWeek).map(Number).sort((a, b) => a - b);
  const programComplete = completedWeeks.length >= totalProgramWeeks
    && completedWeeks.slice(0, totalProgramWeeks).every((w) => (sessionsPerWeek[w] ?? 0) >= totalTrainingDays);

  return {
    completedSessions: completed.length,
    sessionsPerWeek,
    totalTrainingDays,
    currentStreak,
    longestStreak,
    lifetimeReps,
    totalProgramWeeks,
    programComplete,
    sessionLogs,
    allSetLogs,
    startDate,
  };
}

/* ---------- compute all milestone states ---------- */

export interface MilestoneWithState {
  id: string;
  title: string;
  category: MilestoneCategory;
  description: string;
  celebration?: string;
  unlocked: boolean;
  unlockDate: string | null;
  progressCurrent: number;
  progressTarget: number;
}

export function computeMilestoneStates(data: MilestoneData): MilestoneWithState[] {
  return ALL_MILESTONES.map((def) => {
    const unlocked = isUnlocked(def, data);
    const unlockDate = unlocked ? computeUnlockDate(def, data) : null;
    if (unlocked && unlockDate) persistDate(def.id, unlockDate);

    const progress = computeProgress(def, data);

    return {
      id: def.id,
      title: def.title,
      category: def.category,
      description: def.description,
      celebration: def.celebration,
      unlocked,
      unlockDate,
      progressCurrent: progress.current,
      progressTarget: progress.target,
    };
  });
}

function computeProgress(
  def: MilestoneDef,
  data: MilestoneData,
): { current: number; target: number } {
  const { completedSessions, sessionsPerWeek, totalTrainingDays, longestStreak, lifetimeReps } = data;

  switch (def.id) {
    case 'first-workout': return { current: Math.min(completedSessions, 1), target: 1 };
    case 'workouts-5': return { current: Math.min(completedSessions, 5), target: 5 };
    case 'workouts-10': return { current: Math.min(completedSessions, 10), target: 10 };
    case 'workouts-25': return { current: Math.min(completedSessions, 25), target: 25 };
    case 'workouts-50': return { current: Math.min(completedSessions, 50), target: 50 };
    case 'workouts-100': return { current: Math.min(completedSessions, 100), target: 100 };

    case 'streak-3': return { current: Math.min(longestStreak, 3), target: 3 };
    case 'streak-5': return { current: Math.min(longestStreak, 5), target: 5 };
    case 'streak-7': return { current: Math.min(longestStreak, 7), target: 7 };
    case 'streak-10': return { current: Math.min(longestStreak, 10), target: 10 };
    case 'streak-15': return { current: Math.min(longestStreak, 15), target: 15 };
    case 'streak-20': return { current: Math.min(longestStreak, 20), target: 20 };
    case 'streak-30': return { current: Math.min(longestStreak, 30), target: 30 };
    case 'streak-50': return { current: Math.min(longestStreak, 50), target: 50 };
    case 'streak-75': return { current: Math.min(longestStreak, 75), target: 75 };
    case 'streak-100': return { current: Math.min(longestStreak, 100), target: 100 };

    case 'reps-100': return { current: Math.min(lifetimeReps, 100), target: 100 };
    case 'reps-500': return { current: Math.min(lifetimeReps, 500), target: 500 };
    case 'reps-1000': return { current: Math.min(lifetimeReps, 1000), target: 1000 };
    case 'reps-2000': return { current: Math.min(lifetimeReps, 2000), target: 2000 };
    case 'reps-5000': return { current: Math.min(lifetimeReps, 5000), target: 5000 };
    case 'reps-10000': return { current: Math.min(lifetimeReps, 10000), target: 10000 };

    default: {
      if (def.id.startsWith('week-')) {
        const weekNum = parseInt(def.id.replace('week-', '').replace('-complete', ''), 10);
        return { current: Math.min(sessionsPerWeek[weekNum] ?? 0, totalTrainingDays), target: totalTrainingDays };
      }
      if (def.id === 'foundation-complete') {
        const completedWeeks = Object.keys(sessionsPerWeek).filter(
          (w) => (sessionsPerWeek[Number(w)] ?? 0) >= totalTrainingDays,
        ).length;
        return { current: Math.min(completedWeeks, data.totalProgramWeeks), target: data.totalProgramWeeks };
      }
      return { current: 0, target: 1 };
    }
  }
}

/* ---------- new milestone detection for celebrations ---------- */

export function getNewlyUnlockedMilestones(
  prevData: MilestoneData | null,
  currentData: MilestoneData,
): MilestoneWithState[] {
  const currentStates = computeMilestoneStates(currentData);
  if (!prevData) {
    return currentStates.filter((m) => m.unlocked);
  }
  const prevStates = computeMilestoneStates(prevData);
  const prevUnlocked = new Set(prevStates.filter((m) => m.unlocked).map((m) => m.id));
  return currentStates.filter((m) => m.unlocked && !prevUnlocked.has(m.id));
}

/* ---------- helpers ---------- */

export function formatCategory(cat: MilestoneCategory): string {
  return cat;
}

export function getMilestonesByCategory(states: MilestoneWithState[]) {
  const groups: Record<MilestoneCategory, MilestoneWithState[]> = {
    Consistency: [],
    Performance: [],
    Program: [],
  };
  for (const m of states) {
    groups[m.category].push(m);
  }
  return groups;
}
