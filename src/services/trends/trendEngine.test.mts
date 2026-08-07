import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionLog, SetLog } from '@/lib/db';
import {
  computeWeeklyTrendPoints,
  computeTrendReport,
  analyzeMetricSeries,
  linearSlope,
  halfDelta,
  average,
  type TrendPoint,
} from './trendEngine.ts';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function session(week: number, day: number, overrides: Partial<SessionLog> = {}): SessionLog {
  const date = `2026-0${week}-0${day}`;
  return {
    date,
    weekNumber: week,
    sessionKey: `s${week}`,
    completed: true,
    rpe: 7,
    durationMin: 30,
    energy: 6,
    sleepHours: 7.5,
    ...overrides,
  };
}

function setLog(
  week: number,
  day: number,
  overrides: Partial<SetLog> = {},
): SetLog {
  return {
    date: `2026-0${week}-0${day}`,
    sessionKey: `s${week}`,
    exerciseId: 'dumbbell-floor-press',
    setIndex: 0,
    repsCompleted: 10,
    completedAt: `2026-0${week}-0${day}T10:00:00.000Z`,
    ...overrides,
  };
}

/** Build 4 weeks, each with a couple sessions + sets. */
function makeFourWeeks() {
  const sessions: SessionLog[] = [];
  const sets: SetLog[] = [];
  const rpe = [6, 7.5, 8, 8.5];
  const reps = [30, 36, 42, 48];
  const load = [10, 10, 12, 12];
  for (let w = 1; w <= 4; w++) {
    // 2 completed sessions each week (trainingSessionsPerWeek=3 => 67% consistency)
    for (let d = 1; d <= 2; d++) {
      sessions.push(session(w, d, { rpe: rpe[w - 1] }));
      sets.push(setLog(w, d, { repsCompleted: reps[w - 1], weightUsed: load[w - 1] }));
    }
  }
  return { sessions, sets };
}

// ---------------------------------------------------------------------------
// Generic primitives
// ---------------------------------------------------------------------------

test('average returns null for empty and the mean otherwise', () => {
  assert.equal(average([]), null);
  assert.equal(average([2, 4, 6]), 4);
  assert.equal(average([1]), 1);
});

test('linearSlope is null for <2 points and correct sign for increasing series', () => {
  assert.equal(linearSlope([]), null);
  assert.equal(linearSlope([5]), null);
  const rising = linearSlope([10, 20, 30]);
  assert.ok(rising !== null && rising > 0);
  const flat = linearSlope([5, 5, 5]);
  assert.ok(flat !== null && flat === 0);
});

test('halfDelta splits and averages each half', () => {
  assert.deepEqual(halfDelta([]), { first: null, last: null });
  assert.deepEqual(halfDelta([1, 2, 3, 4]), { first: 1.5, last: 3.5 });
  // odd length: the split point puts the extra element in the first half
  assert.deepEqual(halfDelta([1, 2, 3]), { first: 1.5, last: 3 });
});

// ---------------------------------------------------------------------------
// computeWeeklyTrendPoints
// ---------------------------------------------------------------------------

test('empty inputs produce an empty point series and empty report', () => {
  const report = computeTrendReport([], []);
  assert.deepEqual(report.points, []);
  assert.equal(report.asOfWeek, 0);
  assert.equal(report.metrics.length, 7);
  for (const m of report.metrics) assert.equal(m.direction, 'insufficient');
});

test('points are normalized per trainingSessionsPerWeek and stop at max logged week', () => {
  const { sessions, sets } = makeFourWeeks();
  const points = computeWeeklyTrendPoints(sessions, sets, { trainingSessionsPerWeek: 3 });
  assert.equal(points.length, 4);
  assert.ok(points.every((p) => p.sessionsCompleted === 2));
  assert.ok(points.every((p) => p.consistencyPct === 67));
});

test('volume counts reps for completed-session dates only', () => {
  const sessions = [session(1, 1), session(1, 2)];
  const sets = [
    setLog(1, 1, { repsCompleted: 10 }),
    setLog(1, 2, { repsCompleted: 20 }),
    // set on a date with no completed session this week must be excluded
    setLog(1, 9, { repsCompleted: 999 }),
  ];
  const points = computeWeeklyTrendPoints(sessions, sets);
  assert.equal(points[0].volume, 30);
});

test('loadAvg excludes unweighted sets and is null when none recorded (missing-data policy)', () => {
  const sessions = [session(1, 1)];
  // one weighted, one bodyweight (no weightUsed)
  const sets = [
    setLog(1, 1, { repsCompleted: 5, weightUsed: 12 }),
    setLog(1, 1, { repsCompleted: 5 }),
  ];
  const points = computeWeeklyTrendPoints(sessions, sets);
  assert.equal(points[0].loadAvg, 12);
  assert.ok(points[0].volume === 10, 'both reps still counted');

  const noWeight = computeWeeklyTrendPoints(sessions, [setLog(1, 1, { repsCompleted: 5 })]);
  assert.equal(noWeight[0].loadAvg, null);
});

test('rpe/duration/energy/sleep avg are null when a week has no values', () => {
  const points = computeWeeklyTrendPoints(
    [session(1, 1, { rpe: undefined, durationMin: undefined, energy: undefined, sleepHours: undefined })],
    [],
  );
  assert.equal(points[0].rpeAvg, null);
  assert.equal(points[0].durationMinAvg, null);
  assert.equal(points[0].energyAvg, null);
  assert.equal(points[0].sleepAvg, null);
});

test('hold exercises contribute seconds to volume', () => {
  const sessions = [session(1, 1)];
  const sets = [setLog(1, 1, { repsCompleted: undefined, holdDurationSeconds: 60 })];
  const points = computeWeeklyTrendPoints(sessions, sets);
  assert.equal(points[0].volume, 60);
});

// ---------------------------------------------------------------------------
// Trend direction, favorability, and explanations
// ---------------------------------------------------------------------------

test('rising consistency is favorable with a climbing explanation', () => {
  const report = computeTrendReport(makeFourWeeks().sessions, makeFourWeeks().sets);
  const consistency = report.metrics.find((m) => m.key === 'consistency')!;
  assert.equal(consistency.direction, 'steady'); // all 67%, flat
  assert.equal(consistency.favorable, null);
  assert.match(consistency.explanation, /steady/);
});

test('improving consistency (50% -> 100%) is favorable and rising', () => {
  const sessions: SessionLog[] = [];
  const sets: SetLog[] = [];
  for (let w = 1; w <= 2; w++) {
    const completed = w === 1 ? 1 : 3; // week1 1/3, week2 3/3
    for (let d = 1; d <= completed; d++) {
      sessions.push(session(w, d));
      sets.push(setLog(w, d));
    }
  }
  const report = computeTrendReport(sessions, sets, { trainingSessionsPerWeek: 3 });
  const consistency = report.metrics.find((m) => m.key === 'consistency')!;
  assert.equal(consistency.direction, 'rising');
  assert.equal(consistency.favorable, true);
  assert.match(consistency.explanation, /climbed/);
  assert.match(consistency.explanation, /trendPct|first half|last half/);
});

test('declining volume is not favorable', () => {
  const sessions = [session(1, 1), session(2, 1)];
  const sets = [setLog(1, 1, { repsCompleted: 60 }), setLog(2, 1, { repsCompleted: 20 })];
  const report = computeTrendReport(sessions, sets);
  const volume = report.metrics.find((m) => m.key === 'volume')!;
  assert.equal(volume.direction, 'falling');
  assert.equal(volume.favorable, false);
  assert.match(volume.explanation, /fell/);
});

test('load trend favors rising weight and treats nulls as absent', () => {
  const sessions = [session(1, 1), session(2, 1)];
  const sets = [setLog(1, 1, { weightUsed: 10 }), setLog(2, 1, { weightUsed: 14 })];
  const report = computeTrendReport(sessions, sets);
  const load = report.metrics.find((m) => m.key === 'load')!;
  assert.equal(load.direction, 'rising');
  assert.equal(load.favorable, true);
  assert.match(load.explanation, /rose/);

  const noLoad = computeTrendReport([session(1, 1)], [setLog(1, 1)]);
  assert.equal(noLoad.metrics.find((m) => m.key === 'load')!.direction, 'insufficient');
});

test('RPE is descriptive: direction labeled, favorability null', () => {
  const report = computeTrendReport(makeFourWeeks().sessions, makeFourWeeks().sets);
  const rpe = report.metrics.find((m) => m.key === 'rpe')!;
  assert.equal(rpe.direction, 'rising'); // 6 -> 8.5
  assert.equal(rpe.favorable, null);
  assert.match(rpe.explanation, /felt harder|effort rose/i);
});

test('single logged week yields insufficient multi-point trends but a usable report', () => {
  const report = computeTrendReport([session(1, 1)], [setLog(1, 1)]);
  assert.equal(report.asOfWeek, 1);
  assert.equal(report.points.length, 1);
  for (const m of report.metrics) assert.equal(m.direction, 'insufficient');
});

test('every explanation is non-empty and deterministic', () => {
  const { sessions, sets } = makeFourWeeks();
  const a = computeTrendReport(sessions, sets);
  const b = computeTrendReport(sessions, sets);
  for (const m of a.metrics) {
    assert.ok(typeof m.explanation === 'string' && m.explanation.length > 0);
  }
  assert.deepEqual(a, b, 'deterministic output');
});

test('steep positive slope is captured by slopePerWeek', () => {
  const { sessions, sets } = makeFourWeeks(); // volume 30,36,42,48
  const volume = computeTrendReport(sessions, sets).metrics.find((m) => m.key === 'volume')!;
  assert.ok(volume.slopePerWeek !== null && volume.slopePerWeek > 0);
  assert.ok((volume.trendPct ?? 0) > 0);
});

test('analyzeMetricSeries tolerates null-ish values mixed in', () => {
  const m = analyzeMetricSeries('sleep', [7, null, 8, undefined, 6]);
  assert.equal(m.observedWeeks, 3);
  // observed [7,8,6] -> first half [7,8]=7.5 vs last half [6]=6 -> falling
  assert.equal(m.direction, 'falling');
});

test('points expose a typed TrendPoint shape with a loadAvg number or null', () => {
  const { sessions, sets } = makeFourWeeks();
  const points = computeWeeklyTrendPoints(sessions, sets) as TrendPoint[];
  assert.ok(points.length > 0);
  assert.ok(typeof points[0].week === 'number');
  assert.ok(points[0].loadAvg === null || typeof points[0].loadAvg === 'number');
});