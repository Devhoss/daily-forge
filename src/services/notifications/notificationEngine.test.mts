import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';
import type { CoachedNotification } from './notificationEngine.ts';

await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { buildDailyNotifications, buildWeeklyReviewNotification, categoryFor } =
  await import('./notificationEngine.ts');
const { buildWeeklyReport } = await import('@/services/report/weeklyReport');

// week 1: 07-26..08-01 (rest day offset 3 = Thu), week 2: 08-02..08-08,
// week 3: 08-09..08-15, week 4 (deload): 08-16..08-22, week 5: 08-23..08-29.
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

function daily(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  asOfOffset: number,
  extra: { reminderTime?: string; minImportance?: 'critical' | 'high' | 'normal' | 'low' } = {},
): CoachedNotification[] {
  return buildDailyNotifications(sessionLogs, setLogs, measurements, {
    startIso: START,
    asOf: new Date(2026, 6, 26 + asOfOffset),
    ...extra,
  });
}

test('nothing important yields no notification (anti-spam)', () => {
  assert.deepEqual(daily([], [], [], 5), []);
});

test('overload ready → one critical recommendation notification with next-session expiry', () => {
  const s = [sess(4), sess(5)];
  const sl = [setLog(4), setLog(5)];
  const list = daily(s, sl, [], 6);
  assert.equal(list.length, 1);
  const n = list[0];
  assert.equal(n.importance, 'critical');
  assert.equal(n.category, 'recommendation');
  assert.equal(n.title, 'Ready to Progress');
  assert.ok(n.body.includes('12.5 kg'));
  assert.ok(n.reason.length > 0);
  assert.ok(n.action && n.action.type === 'overload');
  assert.equal(n.action.exerciseId, 'dumbbell-floor-press');
});

test('overload expiry is end of the next session day for that exercise', () => {
  const s = [sess(4), sess(5)];
  const sl = [setLog(4), setLog(5)];
  // asOf = offset 6 (Sun, dayIndex 6). Next push_a is offset +1 (Mon).
  const n = daily(s, sl, [], 6)[0];
  const expected = new Date(2026, 6, 26 + 7);
  expected.setHours(23, 59, 59, 999);
  assert.equal(n.expiresAt, expected.toISOString());
});

test('recovery strain → recovery category expiring end of today', () => {
  const s = [
    sess(4, { rpe: 9 }), sess(5, { rpe: 9 }), sess(6, { rpe: 9 }),
    sess(11, { rpe: 9 }), sess(12, { rpe: 9 }), sess(13, { rpe: 9 }),
    sess(14, { rpe: 9 }),
  ];
  // Reps stay well inside the range so no overload (0.9) outranks recovery.
  const sl = [
    setLog(4, { repsCompleted: 9 }), setLog(5, { repsCompleted: 9 }), setLog(6, { repsCompleted: 9 }),
    setLog(11, { repsCompleted: 9 }), setLog(12, { repsCompleted: 9 }), setLog(13, { repsCompleted: 9 }),
    setLog(14, { repsCompleted: 9 }),
  ];
  const n = daily(s, sl, [], 14)[0];
  assert.equal(n.category, 'recovery');
  const expected = new Date(2026, 6, 26 + 14);
  expected.setHours(23, 59, 59, 999);
  assert.equal(n.expiresAt, expected.toISOString());
});

test('deload week → recommendation category expiring end of current week', () => {
  const n = daily([], [], [], 24)[0]; // week 4 (deload) = offsets 21-27
  assert.equal(n.category, 'recommendation');
  assert.equal(n.title, 'Deload Week');
  const expected = new Date(2026, 6, 26 + 27);
  expected.setHours(23, 59, 59, 999);
  assert.equal(n.expiresAt, expected.toISOString());
});

test('minImportance default (high) excludes normal-tier nudges', () => {
  // Measurement rec is priority 0.55 → 'normal'. Not sent by default.
  assert.deepEqual(daily([], [], [], 5, { minImportance: 'high' }), []);
  // With a lower floor it appears.
  const list = daily([], [], [], 5, { minImportance: 'normal' });
  assert.equal(list.length, 1);
  assert.equal(list[0].category, 'measurement');
});

test('at most one notification per day regardless of how many candidates', () => {
  const s = [
    sess(0), sess(1), sess(2), sess(4, { rpe: 9 }), sess(5, { rpe: 9 }), sess(6, { rpe: 9 }),
    sess(7), sess(8),
  ];
  const sl = [setLog(4), setLog(5), setLog(6), setLog(7), setLog(8)];
  const list = daily(s, sl, [], 9);
  assert.ok(list.length <= 1);
});

test('scheduledFor honors the configured reminder time', () => {
  const s = [sess(4), sess(5)];
  const sl = [setLog(4), setLog(5)];
  const n = daily(s, sl, [], 6, { reminderTime: '07:30' })[0];
  const expected = new Date(2026, 6, 26 + 6);
  expected.setHours(7, 30, 0, 0);
  assert.equal(n.scheduledFor, expected.toISOString());
});

test('deterministic: identical inputs yield identical notifications', () => {
  const s = [sess(4), sess(5)];
  const sl = [setLog(4), setLog(5)];
  const a = daily(s, sl, [], 6);
  const b = daily(s, sl, [], 6);
  assert.deepEqual(a, b);
});

test('categoryFor maps recommendation keys to notification categories', () => {
  assert.equal(categoryFor('overload'), 'recommendation');
  assert.equal(categoryFor('recovery'), 'recovery');
  assert.equal(categoryFor('deload'), 'recommendation');
  assert.equal(categoryFor('consistency'), 'consistency');
  assert.equal(categoryFor('measurement'), 'measurement');
  assert.equal(categoryFor('streak'), 'recommendation');
  assert.equal(categoryFor('milestone'), 'milestone');
});

test('weekly review only fires on the report week end date', () => {
  const s = [sess(0), sess(1), sess(2)];
  const sl = [setLog(0), setLog(1), setLog(2)];
  const report = buildWeeklyReport(s, sl, [], {
    weekNumber: 1,
    startDate: START,
  });

  const before = buildWeeklyReviewNotification(report, {
    startIso: START,
    asOf: new Date(2026, 6, 31), // Fri of week 1
  });
  assert.equal(before, null);

  const onEnd = buildWeeklyReviewNotification(report, {
    startIso: START,
    asOf: new Date(2026, 7, 1), // Sat 08-01 = week 1 end
  });
  assert.ok(onEnd);
  assert.equal(onEnd.category, 'weekly_review');
  assert.equal(onEnd.title, 'Week 1 Review');
  assert.ok(onEnd.body.length > 0);
  assert.ok(onEnd.reason.length > 0);
});

test('weekly review reason/body come from the report narrative, not re-derived', () => {
  const s = [sess(0), sess(1), sess(2)];
  const sl = [setLog(0), setLog(1), setLog(2)];
  const report = buildWeeklyReport(s, sl, [], {
    weekNumber: 1,
    startDate: START,
  });
  const n = buildWeeklyReviewNotification(report, {
    startIso: START,
    asOf: new Date(2026, 7, 1),
  })!;
  assert.ok(report.narrative.includes(n.body), 'body should be drawn from report.narrative');
});
