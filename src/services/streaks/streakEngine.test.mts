import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { SessionLog } from '@/lib/db';

// The streak engine reads the program calendar (rest days) via
// `@/lib/programEngine` → `@/data/*.json`, so the alias loader is required.
await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { computeCurrentStreak, computeLongestStreak, computeConsecutiveTrainingDays, computeStreakSummary, latestCompletedDate } =
  await import('./streakEngine.ts');

// week 1: 07-26..08-01, week 2: 08-02..08-08. Rest day = offset 3, 10 (Thu).
const START = '2026-07-26';

function dateOf(offset: number): string {
  const d = new Date(2026, 6, 26 + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sess(offset: number, completed = true): SessionLog {
  return {
    date: dateOf(offset),
    weekNumber: Math.floor(offset / 7) + 1,
    sessionKey: 'push_a',
    completed,
    rpe: 7,
    durationMin: 30,
    energy: 6,
    sleepHours: 7.5,
  };
}

function logs(offsets: number[]): SessionLog[] {
  return offsets.map((o) => sess(o));
}

test('current streak: scheduled rest days never break the run', () => {
  // Trained Fri..Sun (4,5,6), then Mon..Wed (7,8,9), rest Thu (10), then Fri..Sun (11,12,13).
  const sessionLogs = logs([4, 5, 6, 7, 8, 9, 11, 12, 13]);
  const streak = computeCurrentStreak(sessionLogs, START, new Date(2026, 6, 26 + 13));
  assert.equal(streak, 9);
});

test('current streak: a missed training day resets to 0', () => {
  // Trained 4 and 5, skipped 6 (training day), trained 7.
  const sessionLogs = logs([4, 5, 7]);
  const streak = computeCurrentStreak(sessionLogs, START, new Date(2026, 6, 26 + 7));
  assert.equal(streak, 1);
});

test('current streak: an unlogged in-progress training day does not reset the run', () => {
  // Trained 4 and 5; asOf is a training day (6) not yet logged.
  const sessionLogs = logs([4, 5]);
  const streak = computeCurrentStreak(sessionLogs, START, new Date(2026, 6, 26 + 6));
  assert.equal(streak, 2);
});

test('current streak: asOf on a rest day counts the last training day', () => {
  // Trained Mon..Wed of week 2 (7,8,9); asOf is the following rest day (10).
  const sessionLogs = logs([4, 5, 6, 7, 8, 9]);
  const streak = computeCurrentStreak(sessionLogs, START, new Date(2026, 6, 26 + 10));
  assert.equal(streak, 6);
});

test('current streak: no completed sessions → 0', () => {
  assert.equal(computeCurrentStreak(logs([0, 1, 2]), START, new Date(2026, 6, 26 + 5)), 0);
});

test('current streak: ignores incomplete session logs', () => {
  const sessionLogs = [sess(4, false), sess(5, true), sess(6, true)];
  const streak = computeCurrentStreak(sessionLogs, START, new Date(2026, 6, 26 + 6));
  assert.equal(streak, 2);
});

test('longest streak: spans rest days across week boundaries', () => {
  // Two full 6-day weeks (0,1,2,4,5,6,7,8,9,11,12,13). Both Thu rest days are
  // skipped without breaking the run, so the streak is the full 12 training
  // days — exactly the semantics the streak milestones rely on.
  const sessionLogs = logs([0, 1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13]);
  assert.equal(computeLongestStreak(sessionLogs, START), 12);
});

test('longest streak: a missed training day splits the run', () => {
  // 4,5 then missed 6, then 7,8,9 → longest run is 3.
  const sessionLogs = logs([4, 5, 7, 8, 9]);
  assert.equal(computeLongestStreak(sessionLogs, START), 3);
});

test('longest streak: empty logs → 0', () => {
  assert.equal(computeLongestStreak([], START), 0);
});

test('longest streak: single training day → 1', () => {
  assert.equal(computeLongestStreak(logs([4]), START), 1);
});

test('consecutive training days: counts back-to-back calendar days', () => {
  const sessionLogs = logs([4, 5, 6, 7]);
  assert.equal(computeConsecutiveTrainingDays(sessionLogs, new Date(2026, 6, 26 + 7)), 4);
});

test('consecutive training days: a rest day breaks the consecutive run', () => {
  // Trained 4 and 6, with rest day 5 between them.
  const sessionLogs = logs([4, 6]);
  assert.equal(computeConsecutiveTrainingDays(sessionLogs, new Date(2026, 6, 26 + 6)), 1);
});

test('latestCompletedDate returns the newest completed date', () => {
  assert.equal(latestCompletedDate(logs([0, 4, 7])), dateOf(7));
  assert.equal(latestCompletedDate([]), null);
});

test('summary exposes current, longest, consecutive and lastTrainingDate', () => {
  const sessionLogs = logs([4, 5, 6, 7, 8, 9, 11]);
  const summary = computeStreakSummary(sessionLogs, START, new Date(2026, 6, 26 + 11));
  assert.deepEqual(summary, {
    current: 7,
    longest: 7,
    consecutive: 1, // rest day (10) sits between 9 and 11
    lastTrainingDate: dateOf(11),
  });
});

test('deterministic: identical inputs yield identical results', () => {
  const sessionLogs = logs([4, 5, 6, 7, 8, 9, 11, 12, 13]);
  const asOf = new Date(2026, 6, 26 + 13);
  const a = computeStreakSummary(sessionLogs, START, asOf);
  const b = computeStreakSummary(sessionLogs, START, asOf);
  assert.deepEqual(a, b);
});
