import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';

// The coach summary composes the real services (programEngine → JSON,
// recovery, streaks, milestones), so the alias loader is required.
await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { buildCoachSummary } = await import('./coachSummary.ts');
const { computeRecoveryScore } = await import('@/services/recovery/recoveryScore.ts');

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

test('empty history still yields a short, honest summary (recovery + measurement nudge)', () => {
  const summary = buildCoachSummary([], [], [], { startIso: START, asOf: new Date(2026, 6, 31) });
  assert.equal(summary.sentences[0], 'Recovery looks good \u2014 a solid day to train.');
  assert.ok(summary.paragraph.includes('Log your starting measurements this week.'));
  assert.equal(summary.paragraph, summary.sentences.join(' '));
});

test('recovery sentence always leads and mirrors the recovery service level', () => {
  const s = [sess(0), sess(1), sess(2)];
  const summary = buildCoachSummary(s, [setLog(0), setLog(1), setLog(2)], [], {
    startIso: START,
    asOf: new Date(2026, 6, 31),
  });
  const level = computeRecoveryScore(s, [setLog(0), setLog(1), setLog(2)], {
    startIso: START,
    asOf: new Date(2026, 6, 31),
  }).level;
  const expected = {
    fresh: 'Recovery is excellent',
    ready: 'Recovery looks good',
    tired: 'Recovery is a little tired',
    overtraining_risk: 'Recovery is in the red',
  }[level];
  assert.ok(summary.sentences[0].startsWith(expected), summary.sentences[0]);
});

test('near milestones are stated once, from the milestone service (no duplicate decision)', () => {
  const s = Array.from({ length: 9 }, (_, i) => sess(i >= 3 ? i + 1 : i)); // 9 workouts
  const summary = buildCoachSummary(s, [], [], { startIso: START, asOf: new Date(2026, 6, 26 + 12) });
  assert.ok(summary.paragraph.includes('close to unlocking 2 milestones'), summary.paragraph);
  assert.ok(!summary.paragraph.includes('Almost there'), 'milestone decision duplicated');
  assert.ok(summary.sentences[0].startsWith('Recovery'));
});

test('maxSentences caps the paragraph', () => {
  const s = Array.from({ length: 9 }, (_, i) => sess(i >= 3 ? i + 1 : i));
  const summary = buildCoachSummary(s, [], [], {
    startIso: START,
    asOf: new Date(2026, 6, 26 + 12),
    maxSentences: 2,
  });
  assert.equal(summary.sentences.length, 2);
});

test('deterministic: identical inputs yield identical summaries', () => {
  const s = [sess(0), sess(1), sess(2)];
  const meas: MeasurementEntry[] = [{ id: 1, date: dateOf(0), week: 1, weight: 80 }];
  const cfg = { startIso: START, asOf: new Date(2026, 6, 31) };
  const a = buildCoachSummary(s, [setLog(0), setLog(1), setLog(2)], meas, cfg);
  const b = buildCoachSummary(s, [setLog(0), setLog(1), setLog(2)], meas, cfg);
  assert.deepEqual(a, b);
});
