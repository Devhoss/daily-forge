import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { SessionLog, SetLog } from '@/lib/db';
import type { RecoveryAnalysis } from './recoveryScore.ts';

// Recovery reads the program calendar (rest days) via programEngine → JSON,
// so the alias loader is required.
await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { computeRecoveryScore, strainImpact, clearRecoveryDebugTraces, getRecoveryDebugTraces } =
  await import('./recoveryScore.ts');

// week 1: 07-26..08-01, week 2: 08-02..08-08. Rest days: offsets 3, 10, 17 (Thu).
const START = '2026-07-26';

function dateOf(offset: number): string {
  const d = new Date(2026, 6, 26 + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sess(offset: number, rpe: number): SessionLog {
  return {
    date: dateOf(offset),
    weekNumber: Math.floor(offset / 7) + 1,
    sessionKey: 'push_a',
    completed: true,
    rpe,
    durationMin: 30,
    energy: 6,
    sleepHours: 7.5,
  };
}

function setLog(offset: number, volume: number): SetLog {
  return {
    date: dateOf(offset),
    sessionKey: 'push_a',
    exerciseId: 'dumbbell-floor-press',
    setIndex: 0,
    repsCompleted: volume,
    weightUsed: 12,
    completedAt: `${dateOf(offset)}T10:00:00.000Z`,
  };
}

function sessions(offsets: number[], rpe: number): SessionLog[] {
  return offsets.map((o) => sess(o, rpe));
}

function sets(offsets: number[], volume: number): SetLog[] {
  return offsets.flatMap((o) => [setLog(o, volume)]);
}

function score(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  asOfOffset: number,
): RecoveryAnalysis {
  return computeRecoveryScore(sessionLogs, setLogs, {
    startIso: START,
    asOf: new Date(2026, 6, 26 + asOfOffset),
  });
}

function factorOf(a: RecoveryAnalysis, key: string) {
  return a.contributors.find((f) => f.key === key);
}

test('empty history: neutral ready score, low confidence', () => {
  const a = score([], [], 14);
  assert.equal(a.score, 65);
  assert.equal(a.level, 'ready');
  assert.equal(a.confidence, 'low');
  assert.equal(a.contributors.length, 2); // consecutive + planned rest only
  assert.ok(a.explanation.length > 0);
  assert.ok(a.recommendation.length > 0);
});

test('rpe_trend: rising recent RPE strains', () => {
  const s = sessions([4, 5, 6], 7).concat(sessions([11, 12, 13], 9));
  const a = score(s, [], 14);
  const f = factorOf(a, 'rpe_trend');
  assert.ok(f);
  assert.equal(f?.direction, 'straining');
  assert.ok((f?.impact ?? 0) < 0);
});

test('rpe_trend: falling recent RPE recovers', () => {
  const s = sessions([4, 5, 6], 9).concat(sessions([11, 12, 13], 7));
  const a = score(s, [], 14);
  const f = factorOf(a, 'rpe_trend');
  assert.ok(f);
  assert.equal(f?.direction, 'recovering');
  assert.ok((f?.impact ?? 0) > 0);
});

test('rpe_trend: omitted when either window lacks RPE data', () => {
  const a = score(sessions([4, 5, 6], 7), [], 14);
  assert.equal(factorOf(a, 'rpe_trend'), undefined);
});

test('volume_trend: a volume jump from nothing strains', () => {
  const a = score(sessions([4, 5, 6], 7), sets([4, 5, 6], 10), 10);
  const f = factorOf(a, 'volume_trend');
  assert.ok(f);
  assert.equal(f?.direction, 'straining');
  assert.equal(f?.impact, -10);
});

test('volume_trend: flat volume is neutral', () => {
  const s = sessions([4, 5, 6], 7).concat(sessions([11, 12, 13], 7));
  const a = score(s, sets([4, 5, 6, 11, 12, 13], 10), 14);
  const f = factorOf(a, 'volume_trend');
  assert.ok(f);
  assert.equal(f?.impact, 0);
  assert.equal(f?.direction, 'neutral');
});

test('volume_trend: omitted when no sets are recorded', () => {
  const a = score(sessions([4, 5, 6, 11, 12, 13], 7), [], 14);
  assert.equal(factorOf(a, 'volume_trend'), undefined);
});

test('consecutive training days: six in a row is maximal strain', () => {
  // The 6-day/week program has a rest day every 7th day, so 6 is the maximum
  // calendar-consecutive run: 6 days → (6-1)*2 = -10 impact.
  const s = sessions([4, 5, 6, 7, 8, 9], 7);
  const a = score(s, [], 9);
  const f = factorOf(a, 'consecutive_training_days');
  assert.ok(f);
  assert.equal(f?.impact, -10);
});

test('planned rest: a rest day today boosts recovery', () => {
  const a = score([], [], 10); // offset 10 is a scheduled rest day
  const f = factorOf(a, 'planned_rest');
  assert.ok(f);
  assert.equal(f?.impact, 8);
  assert.match(f?.detail ?? '', /Today is a scheduled rest day/);
});

test('planned rest: rest tomorrow still boosts recovery', () => {
  const a = score([], [], 9); // offset 9 is a training day, offset 10 is rest
  const f = factorOf(a, 'planned_rest');
  assert.ok(f);
  assert.equal(f?.impact, 8);
});

test('planned rest: no rest after 3+ straight days strains', () => {
  // Trained 4-9 and 11-13; asOf=13 is a training day and tomorrow is also a
  // training day, with 3 straight days logged (11,12,13).
  const s = sessions([4, 5, 6, 7, 8, 9, 11, 12, 13], 7);
  const a = score(s, [], 13);
  const f = factorOf(a, 'planned_rest');
  assert.ok(f);
  assert.equal(f?.impact, -4);
});

test('consistency: near-complete schedule recovers', () => {
  // 15 of 15 planned training days through offset 17 completed.
  const s = sessions([0, 1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16], 7);
  const a = score(s, [], 17);
  const f = factorOf(a, 'consistency');
  assert.ok(f);
  assert.equal(f?.direction, 'recovering');
  assert.equal(f?.impact, 6);
});

test('consistency: erratic schedule strains', () => {
  const s = sessions([0, 1, 2], 7); // 3 of 13 planned days
  const a = score(s, [], 14);
  const f = factorOf(a, 'consistency');
  assert.ok(f);
  assert.equal(f?.direction, 'straining');
  assert.equal(f?.impact, -4);
});

test('workload_trend: rising weekly workload strains', () => {
  const s = sessions([4, 5, 6, 11, 12, 13], 7);
  const a = score(s, sets([4, 5, 6], 10).concat(sets([11, 12, 13], 20)), 14);
  const f = factorOf(a, 'workload_trend');
  assert.ok(f);
  assert.equal(f?.direction, 'straining');
  assert.ok((f?.impact ?? 0) < 0);
});

test('workload_trend: omitted with fewer than two logged weeks', () => {
  const a = score(sessions([4, 5, 6], 7), sets([4, 5, 6], 10), 6);
  assert.equal(factorOf(a, 'workload_trend'), undefined);
});

test('time since last workout: trained today strains slightly', () => {
  const s = sessions([14], 7);
  const a = score(s, [], 14);
  const f = factorOf(a, 'time_since_last_workout');
  assert.ok(f);
  assert.equal(f?.impact, -4);
});

test('time since last workout: trained today stays day 0 with a late-day asOf', () => {
  const s = sessions([14], 7);
  const a = computeRecoveryScore(s, [], {
    startIso: START,
    asOf: new Date(2026, 6, 26 + 14, 23, 30),
  });
  const f = factorOf(a, 'time_since_last_workout');
  assert.ok(f);
  assert.equal(f?.impact, -4);
  assert.equal(f?.detail, 'Trained today.');
});

test('time since last workout: a few days off recovers', () => {
  const s = sessions([4, 5, 6], 7);
  const a = score(s, [], 10); // last workout 4 days ago
  const f = factorOf(a, 'time_since_last_workout');
  assert.ok(f);
  assert.equal(f?.impact, 6);
});

test('time since last workout: omitted with no sessions', () => {
  assert.equal(factorOf(score([], [], 10), 'time_since_last_workout'), undefined);
});

test('strainImpact: same-day is full weight, older recency decays', () => {
  assert.equal(strainImpact(100, 0), -10);
  assert.equal(strainImpact(50, 0), -5);
  assert.equal(strainImpact(50, 1), -4);
  assert.equal(strainImpact(50, 2), -2);
  assert.equal(strainImpact(50, 3), -1);
  assert.equal(strainImpact(1, 0), 0);
});

test('acute session strain: a hard workout today strains', () => {
  const a = score(sessions([14], 9), sets([14], 10), 14);
  const f = factorOf(a, 'acute_session_strain');
  assert.ok(f);
  assert.equal(f?.direction, 'straining');
  assert.ok((f?.impact ?? 0) < -2);
  assert.match(f?.detail ?? '', /acute strain/i);
});

test('acute session strain: impact decays as the workout recedes', () => {
  const today = factorOf(score(sessions([14], 9), sets([14], 10), 14), 'acute_session_strain')?.impact ?? 0;
  const yesterday = factorOf(score(sessions([14], 9), sets([14], 10), 15), 'acute_session_strain')?.impact ?? 0;
  assert.ok(today < yesterday);
});

test('acute session strain: omitted outside the acute window', () => {
  assert.equal(factorOf(score(sessions([10], 9), sets([10], 10), 14), 'acute_session_strain'), undefined);
});

test('acute session strain: omitted with no sessions', () => {
  assert.equal(factorOf(score([], [], 14), 'acute_session_strain'), undefined);
});

test('acute session strain: a harder workout lowers the score more than a light one', () => {
  const hard = score(sessions([14], 9), sets([14], 10), 14);
  const light = score(sessions([14], 5), sets([14], 2), 14);
  assert.ok(hard.score < light.score);
});

test('a heavy two-week block scores below ready', () => {
  const s = sessions([4, 5, 6], 6).concat(sessions([11, 12, 13], 9)).concat(sessions([14], 9));
  const a = score(s, sets([4, 5, 6, 11, 12, 13, 14], 10), 14);
  assert.ok(a.score < 65);
  assert.equal(a.confidence, 'high');
});

test('deterministic: identical inputs yield identical analyses', () => {
  const s = sessions([4, 5, 6], 6).concat(sessions([11, 12, 13], 9));
  const sl = sets([4, 5, 6, 11, 12, 13], 10);
  const a = score(s, sl, 14);
  const b = score(s, sl, 14);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Regression: calendar-day rollover & post-workout recomputation.
//
// These lock in behaviors verified against the engine and the Home wiring
// (Home.tsx recomputes recovery + recommendations together from the same fresh
// logs and `asOf` on every mount and data-changed event). No scoring changed.
// ---------------------------------------------------------------------------

function sessFull(offset: number, rpe: number, durationMin: number, energy: number): SessionLog {
  return {
    date: dateOf(offset),
    weekNumber: Math.floor(offset / 7) + 1,
    sessionKey: 'push_a',
    completed: true,
    rpe,
    durationMin,
    energy,
  };
}

test('calendar-day rollover recomputes factors even when the score is unchanged', () => {
  // Sessions 0,1,2,4 plus a hard offset-5 session (RPE 9, 60 min, energy 3 → strain 56).
  // asOf = 5 is the workout day; asOf = 6 is the next day with the same logs.
  const s = [...sessions([0, 1, 2, 4], 7), sessFull(5, 9, 60, 3)];

  const beforeMidnight = score(s, [], 5);
  const afterMidnight = score(s, [], 6);

  // time since last workout: trained today → trained yesterday
  assert.equal(factorOf(beforeMidnight, 'time_since_last_workout')?.impact, -4);
  assert.equal(factorOf(afterMidnight, 'time_since_last_workout')?.impact, -2);

  // acute session strain: full weight today → 0.7 recency decay tomorrow
  assert.equal(factorOf(beforeMidnight, 'acute_session_strain')?.impact, -6);
  assert.equal(factorOf(afterMidnight, 'acute_session_strain')?.impact, -4);

  // consecutive days: two logged days → zero (today isn't logged yet after midnight)
  assert.equal(factorOf(beforeMidnight, 'consecutive_training_days')?.impact, -2);
  assert.equal(factorOf(afterMidnight, 'consecutive_training_days')?.impact, 0);

  // consistency: 100% → 83% (the new planned day is not yet completed)
  assert.equal(factorOf(beforeMidnight, 'consistency')?.impact, 6);
  assert.equal(factorOf(afterMidnight, 'consistency')?.impact, 0);

  // The four shifts cancel out: the score lands on the same number, but the
  // analysis is recomputed from the changed factors (the explanation tracks it).
  assert.equal(beforeMidnight.score, afterMidnight.score);
  assert.match(beforeMidnight.explanation, /consistency/);
  assert.doesNotMatch(afterMidnight.explanation, /consistency/);
});

test('completing today’s workout recomputes recovery immediately with it included', () => {
  const yesterday = sessions([11], 7);
  const before = score(yesterday, [], 12);
  assert.equal(factorOf(before, 'time_since_last_workout')?.impact, -2);

  const today = [...yesterday, sessFull(12, 9, 40, 3)];
  const after = score(today, [], 12);

  // Today's completed session is now the basis for recency and acute strain.
  assert.equal(factorOf(after, 'time_since_last_workout')?.impact, -4);
  const acute = factorOf(after, 'acute_session_strain');
  assert.ok(acute);
  assert.equal(acute?.direction, 'straining');
  assert.match(acute?.detail ?? '', /9 RPE/);
  assert.ok(after.score < before.score);
  assert.notEqual(after.explanation, before.explanation);

  // The debug trace records whether today's session was part of the inputs.
  clearRecoveryDebugTraces();
  score(yesterday, [], 12);
  assert.equal(getRecoveryDebugTraces().at(-1)?.inputs.todayCompletedIncluded, false);
  clearRecoveryDebugTraces();
  score(today, [], 12);
  assert.equal(getRecoveryDebugTraces().at(-1)?.inputs.todayCompletedIncluded, true);
});
