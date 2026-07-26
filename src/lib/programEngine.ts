import { program } from "@/lib/data";
import type { WeeklyTemplateDay, WeekTableRow } from "@/types";

export interface TodayInfo {
  weekNumber: number;
  dayIndex: number;
  weeklyTemplateEntry: WeeklyTemplateDay;
  weekRow: WeekTableRow | undefined;
  isRestDay: boolean;
  isProgramComplete: boolean;
  daysSinceStart: number;
}

export function getNextWorkoutLabel(dayIndex: number): string {
  const template = program.weekly_template;
  const tomorrow = template[(dayIndex + 1) % template.length];
  return tomorrow.label;
}

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function daysBetween(startIso: string, today: Date): number {
  const start = parseLocalDate(startIso).getTime();
  const now = toMidnight(today);
  return Math.floor((now - start) / 86_400_000);
}

export function getTodayInfo(
  startIso: string,
  today: Date = new Date(),
): TodayInfo {
  const daysSinceStart = daysBetween(startIso, today);
  const totalDays = program.week_table.length * program.weekly_template.length;

  const clampedDay = Math.max(0, daysSinceStart);
  const weekIndex = Math.floor(clampedDay / 7);
  const dayIndex = clampedDay % 7;
  const weekNumber = Math.min(weekIndex + 1, program.week_table.length);

  const weeklyTemplateEntry = program.weekly_template[dayIndex];
  const weekRow = program.week_table.find((w) => w.week === weekNumber);
  const isProgramComplete = daysSinceStart >= totalDays;

  return {
    weekNumber,
    dayIndex,
    weeklyTemplateEntry,
    weekRow,
    isRestDay: weeklyTemplateEntry.session_key === "rest",
    isProgramComplete,
    daysSinceStart,
  };
}

export function todayIso(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
