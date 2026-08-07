import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { SessionLog, SetLog } from '@/lib/db';
import type { LatestSessionAnalysis } from './acuteStrain.ts';

// The service reads recency via programEngine (calendar math only), so the
// alias loader is required for consistency with the other service tests.
await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const {
  analyzeLatestSession,
  acuteStrainOf,
  strainLevelOf,
  ACUTE_WINDOW_DAYS,
} = await import('./acuteStrain.ts');

function dateOf(offset: number): string {
  const d = new Date(2026, 6, 26 + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function asOf(offset: number, hour = 12): Date {
  return new Date(2026, 6, 26 + offset, hour, 0, 0);
}

function sess(
  offset: number,
  opts: { rpe?: number; durationMin?: number; energy?: number } = {},
): SessionLog {
  return {
    date: dateOf(offset),
    weekNumber: Math.floor(offset / 7) + 1,
    sessionKey: 'push_a',
    completed: true,
    rpe: opts.rpe ?? 7,
    durationMin: opts.durationMin ?? 30,
    energy: opts.energy ?? 3,
  };
}

function setLog(offset: number, volume: number, weight = 12): SetLog {
  return {
    date: dateOf(offset),
    sessionKey: 'push_a',
    exerciseId: 'dumbbell-floor-press',
    setIndex: 0,
    repsCompleted: volume,
    weightUsed: weight,
    completedAt: `${dateOf(offset)}T10:00:00.000Z`,
  };
}

function analyze(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  offset: number,
): LatestSessionAnalysis {
  return analyzeLatestSession(sessionLogs, setLogs, asOf(offset));
}

// ---------------------------------------------------------------------------
// Session selection
// ---------------------------------------------------------------------------

test('no completed sessions yields a null session and no strain', () => {
  const a = analyze([], [], 14);
  assert.equal(a.session, null);
  assert.equal(a.signals, null);
  assert.equal(a.strain, null);
  assert.equal(a.level, 'none');
  assert.equal(a.recencyDays, null);
  assert.equal(a.inAcuteWindow, false);
});

test('incomplete sessions are ignored', () => {
  const s = { ...sess(14), completed: false };
  const a = analyze([s], [], 14);
  assert.equal(a.session, null);
});

test('picks the latest completed day and reads its signals', () => {
  const s = [sess(5, { rpe: 6 }), sess(12, { rpe: 9, durationMin: 50, energy: 2 })];
  const a = analyze(s, [setLog(12, 40, 15)], 14);
  assert.deepEqual(a.session, { date: dateOf(12), weekNumber: 2, sessionKey: 'push_a' });
  assert.equal(a.signals?.rpe, 9);
  assert.equal(a.signals?.durationMin, 50);
  assert.equal(a.signals?.energy, 2);
  assert.equal(a.signals?.setCount, 1);
  assert.equal(a.signals?.volume, 40);
  assert.equal(a.signals?.load, 600);
});

test('same-day tie-break is deterministic (first sessionKey)', () => {
  const s = [sess(12, { rpe: 6 }), { ...sess(12, { rpe: 9 }), sessionKey: 'pull_b' }];
  const a = analyze(s, [], 14);
  assert.equal(a.session?.sessionKey, 'pull_b');
  const b = analyze([...s].reverse(), [], 14);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Recency
// ---------------------------------------------------------------------------

test('trained today is 0 days ago even with a late-day asOf', () => {
  const a = analyzeLatestSession([sess(14, { rpe: 7 })], [], new Date(2026, 6, 40, 23, 30));
  assert.equal(a.recencyDays, 0);
  assert.equal(a.inAcuteWindow, true);
});

test('recency counts whole calendar days', () => {
  assert.equal(analyze([sess(12)], [], 13).recencyDays, 1);
  assert.equal(analyze([sess(10)], [], 14).recencyDays, 4);
});

test('acute window boundary is inclusive', () => {
  assert.equal(analyze([sess(14 - ACUTE_WINDOW_DAYS)], [], 14).inAcuteWindow, true);
  assert.equal(analyze([sess(14 - ACUTE_WINDOW_DAYS - 1)], [], 14).inAcuteWindow, false);
});

// ---------------------------------------------------------------------------
// Strain normalization
// ---------------------------------------------------------------------------

test('strain is monotonic in each signal', () => {
  const base = analyze([sess(14, { rpe: 7, durationMin: 30, energy: 3 })], [setLog(14, 20)], 14);
  assert.ok(base.strain != null);
  assert.ok((analyze([sess(14, { rpe: 9 })], [], 14).strain ?? 0) > (base.strain ?? 0));
  assert.ok((analyze([sess(14, { durationMin: 90 })], [], 14).strain ?? 0) > (base.strain ?? 0));
  assert.ok((analyze([sess(14, { energy: 1 })], [], 14).strain ?? 0) > (base.strain ?? 0));
  assert.ok((analyze([sess(14)], [setLog(14, 120)], 14).strain ?? 0) > (base.strain ?? 0));
});

test('strain is bounded at 100', () => {
  const max = acuteStrainOf({
    rpe: 10,
    durationMin: 120,
    energy: 1,
    setCount: 20,
    volume: 400,
    load: 0,
  });
  assert.equal(max, 100);
});

test('a maximal session is very high and a light one is light', () => {
  assert.equal(strainLevelOf(100), 'very-high');
  assert.equal(strainLevelOf(85), 'very-high');
  assert.equal(strainLevelOf(60), 'high');
  assert.equal(strainLevelOf(40), 'moderate');
  assert.equal(strainLevelOf(15), 'light');
  assert.equal(strainLevelOf(0), 'none');
});

test('missing signals contribute nothing but do not null the strain', () => {
  const s = { ...sess(14), rpe: undefined, durationMin: undefined, energy: undefined };
  const a = analyze([s], [setLog(14, 50)], 14);
  assert.ok(a.strain != null);
  const onlyRpe = acuteStrainOf({ rpe: 7, durationMin: null, energy: null, setCount: 0, volume: 0, load: 0 });
  const onlySets = acuteStrainOf({ rpe: null, durationMin: null, energy: null, setCount: 20, volume: 0, load: 0 });
  assert.ok(onlyRpe != null);
  assert.ok(onlySets != null);
  assert.ok(onlyRpe > onlySets);
});

test('a session with no measurable inputs has null strain', () => {
  const s = { ...sess(14), rpe: undefined, durationMin: undefined, energy: undefined };
  const a = analyze([s], [], 14);
  assert.equal(a.strain, null);
  assert.equal(a.level, 'none');
});

test('out-of-window data is still measured but flagged non-acute', () => {
  const a = analyze([sess(10, { rpe: 9, durationMin: 90 })], [], 14);
  assert.equal(a.recencyDays, 4);
  assert.equal(a.inAcuteWindow, false);
  assert.ok(a.strain != null);
  assert.equal(a.level, 'high');
});

test('detail is a plain-language reading of the signals', () => {
  const a = analyze([sess(14, { rpe: 7, durationMin: 38, energy: 2 })], [setLog(14, 25)], 14);
  assert.match(a.detail, /7 RPE/);
  assert.match(a.detail, /38 min/);
  assert.match(a.detail, /energy 2\/5/);
  assert.match(a.detail, /25 sets|total reps/);
});

test('deterministic: identical inputs yield identical analyses', () => {
  const s = [sess(5, { rpe: 6 }), sess(12, { rpe: 9 })];
  const sl = [setLog(12, 30)];
  assert.deepEqual(analyze(s, sl, 14), analyze(s, sl, 14));
});

test('start date does not affect the analysis', () => {
  const a = analyze([sess(14, { rpe: 7 })], [], 14);
  const b = analyzeLatestSession([sess(14, { rpe: 7 })], [], asOf(14));
  assert.deepEqual(a, b);
});
