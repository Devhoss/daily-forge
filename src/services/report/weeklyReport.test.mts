import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';

// --- environment (must run before importing the orchestrator) ---

// Milestone unlock dates persist to localStorage; polyfill it in-memory.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
} as unknown as Storage;

// Resolve the bundler aliases (`@/lib/db`, `@/data/*.json`, `@/types`).
await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { buildWeeklyReport } = await import('./weeklyReport.ts');

// --- fixtures ---

const START = '2026-07-26'; // week 1: 07-26..08-01, week 2: 08-02..08-08
const TRAINING_OFFSETS = [0, 1, 2, 4, 5, 6]; // rest day is offset 3

function dateOf(offset: number): string {
  const d = new Date(2026, 6, 26 + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const SESSION_KEYS = ['push_a', 'pull_a', 'legs_a', 'rest', 'push_b', 'pull_b', 'legs_b'];

function sess(offset: number, extra: Partial<SessionLog> = {}): SessionLog {
  return {
    date: dateOf(offset),
    weekNumber: Math.floor(offset / 7) + 1,
    sessionKey: SESSION_KEYS[offset % 7],
    completed: true,
    rpe: 7,
    durationMin: 30,
    energy: 6,
    sleepHours: 7.5,
    ...extra,
  };
}

function setLog(
  offset: number,
  extra: Partial<SetLog> = {},
): SetLog {
  return {
    date: dateOf(offset),
    sessionKey: SESSION_KEYS[offset % 7],
    exerciseId: 'dumbbell-floor-press',
    setIndex: 0,
    repsCompleted: 10,
    weightUsed: 12,
    completedAt: `${dateOf(offset)}T10:00:00.000Z`,
    ...extra,
  };
}

/** A fully completed week 1 (all 6 training days, one weighted set each). */
function fullWeek1() {
  const sessions = TRAINING_OFFSETS.map((o) => sess(o));
  const sets = TRAINING_OFFSETS.map((o) => setLog(o));
  return { sessions, sets };
}

// --- tests ---

test('empty history produces a valid empty week report', () => {
  const report = buildWeeklyReport([], [], [], { weekNumber: 2, startDate: START });
  assert.equal(report.weekNumber, 2);
  assert.equal(report.weekRange.startIso, '2026-08-02');
  assert.equal(report.weekRange.endIso, '2026-08-08');
  assert.equal(report.summary.sessionsCompleted, 0);
  assert.equal(report.summary.plannedSessions, 6);
  assert.equal(report.summary.consistencyPct, 0);
  assert.equal(report.summary.volume, 0);
  assert.deepEqual(report.workouts, []);
  assert.deepEqual(report.prs, []);
  assert.deepEqual(report.milestonesEarned, []);
  assert.equal(report.measurements.recorded, null);
  assert.equal(report.recoveryScore.score, 65); // neutral base with no training data
  assert.equal(report.recoveryScore.level, 'ready');
  assert.ok(report.recoveryScore.contributors.length >= 1);
  assert.ok(report.recoveryScore.explanation.length > 0);
  assert.ok(report.recoveryScore.recommendation.length > 0);
  assert.equal(report.focus.phase, 'Foundation');
  assert.equal(report.focus.next?.week, 3);
  assert.ok(report.narrative.some((l) => /No sessions completed/.test(l)));
});

test('a completed week summarises correctly and composes every facet', () => {
  const { sessions, sets } = fullWeek1();
  const report = buildWeeklyReport(sessions, sets, [], { weekNumber: 1, startDate: START });

  assert.equal(report.summary.sessionsCompleted, 6);
  assert.equal(report.summary.plannedSessions, 6);
  assert.equal(report.summary.consistencyPct, 100);
  assert.equal(report.summary.volume, 60);
  assert.equal(report.summary.currentStreak, 6);
  assert.equal(report.summary.longestStreak, 6);
  assert.equal(report.summary.lifetimeReps, 60);

  // workouts carry program titles
  assert.equal(report.workouts.length, 6);
  assert.ok(report.workouts.every((w) => w.title.length > 0));
  assert.match(report.workouts[0].title, /Push/i);

  // trends come straight from the Trend Engine
  assert.equal(report.trends.metrics.length, 7);
  const consistency = report.trends.metrics.find((m) => m.key === 'consistency')!;
  assert.equal(consistency.direction, 'insufficient'); // single week

  // PR engine composed
  assert.ok(report.prs.length > 0);
  assert.ok(report.prs.some((p) => p.exerciseId === 'dumbbell-floor-press'));

  // milestones composed (week complete, first workout, streak)
  const earned = report.milestonesEarned.map((m) => m.id);
  assert.ok(earned.includes('first-workout'));
  assert.ok(earned.includes('week-1-complete'));
  assert.ok(earned.includes('streak-3'));

  // focus data
  assert.equal(report.focus.isDeload, false);
  assert.equal(report.focus.next?.week, 2);

  // recommendations composed (sorted, self-explanatory)
  assert.ok(Array.isArray(report.recommendations));
  assert.ok(report.recommendations.every((r) => r.decision.length > 0 && r.reasoning.length > 0));
  assert.ok(report.recommendations.every((r) => r.title.length > 0));
  assert.ok(report.recommendations.every((r) => ['critical', 'high', 'normal', 'low'].includes(r.importance)));

  // narrative reads like a coach
  assert.ok(report.narrative.some((l) => /100% consistency/.test(l)));
  assert.ok(report.narrative.some((l) => /Milestone unlocked — Week 1 Complete/.test(l)));
});

test('PRs set later in the week are detected against earlier history', () => {
  const { sessions, sets } = fullWeek1();
  // week 2, day 1 (offset 7): heavier weight on the same exercise
  sessions.push(sess(7, { rpe: 8, weightUsed: undefined }));
  sets.push(setLog(7, { repsCompleted: 8, weightUsed: 14 }));

  const report = buildWeeklyReport(sessions, sets, [], { weekNumber: 2, startDate: START });
  const weightPr = report.prs.find((p) => p.exerciseId === 'dumbbell-floor-press' && p.type === 'weight');
  assert.ok(weightPr, 'expected a weight PR');
  assert.equal(weightPr?.previous, 12);
  assert.equal(weightPr?.current, 14);
});

test('measurements produce week-over-week deltas', () => {
  const measurements: MeasurementEntry[] = [
    { date: '2026-07-26', week: 1, weight: 80 },
    { date: '2026-08-03', week: 2, weight: 79, waist: 88 },
  ];
  const report = buildWeeklyReport([], [], measurements, { weekNumber: 2, startDate: START });
  assert.equal(report.measurements.recorded?.week, 2);
  assert.equal(report.measurements.previousWeek, 1);
  const weight = report.measurements.deltas.find((d) => d.key === 'weight')!;
  assert.deepEqual(weight, { key: 'weight', label: 'Weight', unit: 'kg', prev: 80, curr: 79, change: -1 });
  const waist = report.measurements.deltas.find((d) => d.key === 'waist')!;
  assert.equal(waist.prev, null); // baseline in the newer recording only
  assert.equal(waist.change, null);
});

test('a week with no prior measurement reports a baseline, not a fake jump', () => {
  const report = buildWeeklyReport([], [], [{ date: '2026-07-26', week: 1, weight: 80 }], {
    weekNumber: 1,
    startDate: START,
  });
  assert.equal(report.measurements.recorded?.week, 1);
  assert.equal(report.measurements.previousWeek, null);
  const weight = report.measurements.deltas.find((d) => d.key === 'weight')!;
  assert.equal(weight.prev, null);
  assert.equal(weight.change, null);
  assert.equal(weight.curr, 80);
});

test('milestones earned in a later week exclude earlier ones', () => {
  const { sessions, sets } = fullWeek1();
  for (const o of [7, 8, 9, 11, 12, 13]) {
    sessions.push(sess(o));
    sets.push(setLog(o));
  }
  const report = buildWeeklyReport(sessions, sets, [], { weekNumber: 2, startDate: START });
  const earned = report.milestonesEarned.map((m) => m.id);
  assert.ok(earned.includes('week-2-complete'));
  assert.ok(!earned.includes('first-workout'), 'first-workout belongs to week 1');
  assert.ok(!earned.includes('week-1-complete'));
});

test('the report is deterministic across runs', () => {
  const { sessions, sets } = fullWeek1();
  const a = buildWeeklyReport(sessions, sets, [], { weekNumber: 1, startDate: START });
  const b = buildWeeklyReport(sessions, sets, [], { weekNumber: 1, startDate: START });
  assert.deepEqual(a, b);
});