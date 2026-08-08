import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';
import type { EquipmentProfile } from '@/lib/equipment';

// Context building composes the real services (programEngine → JSON, recovery,
// streaks, milestones), so the alias loader is required.
await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { buildCoachContext } = await import('./coachContext.ts');

const START = '2026-07-26';

function dateOf(offset: number): string {
  const d = new Date(2026, 6, 26 + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sess(offset: number, extra: Partial<SessionLog> = {}): SessionLog {
  return {
    date: dateOf(offset),
    weekNumber: Math.floor(offset / 7) + 1,
    sessionKey: 'push_a',
    completed: true,
    rpe: 7,
    durationMin: 30,
    energy: 6,
    sleepHours: 7.5,
    ...extra,
  };
}

function setLog(offset: number, extra: Partial<SetLog> = {}): SetLog {
  return {
    date: dateOf(offset),
    sessionKey: 'push_a',
    exerciseId: 'dumbbell-floor-press',
    setIndex: 0,
    repsCompleted: 12,
    weightUsed: 10,
    completedAt: `${dateOf(offset)}T10:00:00.000Z`,
    ...extra,
  };
}

const EQUIPMENT: EquipmentProfile = {
  dumbbells: [5, 7.5, 10],
  hasBench: false,
  hasBands: false,
  hasPullUpBar: false,
  hasMat: true,
  hasKettlebell: false,
};

function cfg(offset = 5) {
  return { startIso: START, asOf: new Date(2026, 6, 26 + offset), equipment: EQUIPMENT };
}

test('empty history yields a context with explicit missing-data markers', () => {
  const ctx = buildCoachContext([], [], [], cfg());
  assert.equal(ctx.asOfIso, dateOf(5));
  assert.ok(ctx.missing.includes('no completed workouts'));
  assert.ok(ctx.missing.includes('no body measurements'));
  assert.equal(ctx.recentWorkouts.length, 0);
  // With no history, the only deterministic recommendation is the
  // measurement nudge ("log your starting measurements").
  assert.equal(ctx.recommendations.length, 1);
  assert.equal(ctx.recommendations[0].actionType, 'measurement');
  // Recovery still computed deterministically (ready baseline, no strain).
  assert.equal(ctx.recovery.score, 65);
  assert.equal(ctx.recovery.level, 'ready');
  assert.equal(ctx.streak.current, 0);
  assert.equal(ctx.program.weekNumber, 1);
});

test('rest day is reported as such, with today exercise list empty and rest marker', () => {
  // Offset 3 is a scheduled rest day (Thursday).
  const ctx = buildCoachContext([], [], [], cfg(3));
  assert.equal(ctx.today.isRestDay, true);
  assert.equal(ctx.today.sessionKey, null);
  assert.equal(ctx.today.exercises.length, 0);
  assert.ok(ctx.missing.includes('today is a scheduled rest day'));
});

test('training day lists today exercises from the program, no raw ids leak', () => {
  const ctx = buildCoachContext([], [], [], cfg());
  assert.equal(ctx.today.isRestDay, false);
  assert.ok(ctx.today.sessionKey !== null);
  assert.ok(ctx.today.exercises.length > 0, 'today has exercises');
  // Sanitization: the emitted exercises are human-facing names from the
  // program session, not internal exercise ids.
  assert.ok(!ctx.today.exercises.some((e) => e.includes('dumbbell-')));
});

test('recent workouts are capped, ordered newest-first, and sanitized', () => {
  const sessions = [sess(0), sess(1), sess(2), sess(4, { sessionKey: 'legs_b' })];
  const sets = [
    setLog(0),
    setLog(1),
    setLog(2),
    setLog(4, { sessionKey: 'legs_b', exerciseId: 'goblet-squat' }),
  ];
  const ctx = buildCoachContext(sessions, sets, [], cfg(5));
  assert.ok(ctx.recentWorkouts.length <= 5);
  assert.equal(ctx.recentWorkouts[0].date, dateOf(4));
  assert.ok(ctx.recentWorkouts[0].volume > 0);
  assert.ok(ctx.recentWorkouts[0].exercises.length > 0);
  // No raw ids or free-text notes in the emitted sections.
  const blob = JSON.stringify(ctx);
  assert.ok(!blob.includes('setIndex'));
  assert.ok(!blob.includes('completedAt'));
});

test('recommendations are included with decisions and reasoning, capped', () => {
  const sessions = [sess(0), sess(1), sess(2)];
  const sets = [setLog(0), setLog(1), setLog(2)];
  const ctx = buildCoachContext(sessions, sets, [], cfg(5));
  assert.ok(ctx.recommendations.length <= 5);
  for (const r of ctx.recommendations) {
    assert.ok(r.decision.length > 0);
    assert.ok(Array.isArray(r.reasoning));
  }
});

test('measurements section reflects the latest recorded entry and deltas', () => {
  const meas: MeasurementEntry[] = [
    { id: 1, date: dateOf(0), week: 1, weight: 80 },
    { id: 2, date: dateOf(7), week: 2, weight: 79 },
  ];
  // asOf in week 2 (offset 12) so the week-2 measurement is the latest at/before.
  const ctx = buildCoachContext([], [], meas, cfg(12));
  assert.equal(ctx.measurements.latest?.weight, 79);
  const weightDelta = ctx.measurements.deltas.find((d) => d.label === 'Weight');
  assert.equal(weightDelta?.change, -1);
  assert.ok(!ctx.missing.includes('no body measurements'));
});

test('deterministic: identical inputs produce deep-equal contexts', () => {
  const sessions = [sess(0), sess(1)];
  const sets = [setLog(0), setLog(1)];
  const meas: MeasurementEntry[] = [{ id: 1, date: dateOf(0), week: 1, weight: 80 }];
  const a = buildCoachContext(sessions, sets, meas, cfg());
  const b = buildCoachContext(sessions, sets, meas, cfg());
  assert.deepEqual(a, b);
});

test('coach context never reads the clock: asOf drives every section', () => {
  const ctx = buildCoachContext([], [], [], cfg(12));
  assert.equal(ctx.asOfIso, dateOf(12));
  assert.equal(ctx.program.weekNumber, 2);
});
