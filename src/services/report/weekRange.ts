/**
 * weekRange — pure calendar helpers for program weeks.
 *
 * Program weeks are anchored to `programStartDate` (the ISO date the program
 * began): week N runs from start + (N-1)*7 days through + (N*7)-1 days. All
 * parsing is local-time (matching `src/lib/programEngine.ts`), so results are
 * timezone-stable and deterministic.
 */
export function dateToIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysIso(iso: string, days: number): string {
  const base = parseDate(iso);
  base.setDate(base.getDate() + days);
  return dateToIso(base);
}

/** Inclusive ISO range for a 1-based program week. */
export function weekDateRange(
  startIso: string,
  weekNumber: number,
): { startIso: string; endIso: string } {
  const start = addDaysIso(startIso, (weekNumber - 1) * 7);
  return { startIso: start, endIso: addDaysIso(start, 6) };
}
