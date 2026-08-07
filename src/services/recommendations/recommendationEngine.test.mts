import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';
import type { Recommendation } from './recommendationEngine.ts';

// The engine composes the real services (programEngine → JSON, recovery,
// streaks, milestones), so the alias loader is required.
await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const {
  buildRecommendations,
  resolveImportance,
  findNextSessionForExercise,
  groupRecommendations,
} = await import('./recommendationEngine.ts');

// week 1: 07-26..08-01 (rest day offset 3 = Thu), week 2: 08-02..08-08, week 3: 08-09..08-15,
// week 4 (deload): 08-16..08-22, week 5: 08-23..08-29.
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

function recs(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  asOfOffset: number,
  extra: { maxResults?: number; maxOverload?: number; availableWeights?: number[] } = {},
): Recommendation[] {
  return buildRecommendations(sessionLogs, setLogs, measurements, {
    startIso: START,
    asOf: new Date(2026, 6, 26 + asOfOffset),
    ...extra,
  });
}

function ofKey(list: Recommendation[], key: string): Recommendation | undefined {
  return list.find((r) => r.key === key);
}

test('every recommendation carries decision, reasoning, and confidence', () => {
  const list = recs([sess(0), sess(1), sess(2)], [setLog(0), setLog(1), setLog(2)], [], 5);
  assert.ok(list.length > 0);
  for (const r of list) {
    assert.ok(r.decision.length > 0, `decision empty for ${r.id}`);
    assert.ok(r.reasoning.length > 0, `reasoning empty for ${r.id}`);
    assert.ok(['low', 'medium', 'high'].includes(r.confidence), `bad confidence for ${r.id}`);
    assert.ok(r.priority >= 0 && r.priority <= 1);
    assert.ok(r.action.type.length > 0);
    assert.ok(r.source.length > 0);
    // presentation metadata is always stamped
    assert.ok(['critical', 'high', 'normal', 'low'].includes(r.importance), `bad importance for ${r.id}`);
    assert.ok(r.title.length > 0, `empty title for ${r.id}`);
    assert.equal(r.importance, resolveImportance(r.priority), `importance mismatch for ${r.id}`);
  }
});

test('importance tiers map deterministically from priority', () => {
  assert.equal(resolveImportance(0.95), 'critical');
  assert.equal(resolveImportance(0.9), 'critical');
  assert.equal(resolveImportance(0.85), 'high');
  assert.equal(resolveImportance(0.7), 'high');
  assert.equal(resolveImportance(0.6), 'normal');
  assert.equal(resolveImportance(0.5), 'normal');
  assert.equal(resolveImportance(0.4), 'low');
});

test('the next session for an exercise is found deterministically', () => {
  // dumbbell-floor-press is on Push A (day 0) — from day 3 (rest) it is tomorrow.
  const fromRest = findNextSessionForExercise('dumbbell-floor-press', 3);
  assert.equal(fromRest?.sessionKey, 'push_a');
  // an exercise not scheduled anywhere resolves to null
  assert.equal(findNextSessionForExercise('does-not-exist', 0), null);
});

test('empty history yields at most gentle, non-overload recommendations', () => {
  const list = recs([], [], [], 5);
  assert.equal(list.find((r) => r.key === 'overload'), undefined);
  assert.equal(list.find((r) => r.key === 'recovery'), undefined);
  assert.equal(list.find((r) => r.key === 'streak'), undefined);
  assert.ok(list.every((r) => r.priority <= 0.55));
});

test('overload: two sessions at the top of the range recommend a load increase (high confidence)', () => {
  // dumbbell-floor-press: 10 kg → target 10-12 reps. 12 reps twice = qualified.
  const s = [sess(4), sess(5)];
  const sl = [setLog(4), setLog(5)];
  const o = ofKey(recs(s, sl, [], 6), 'overload');
  assert.ok(o);
  assert.equal(o?.confidence, 'high');
  assert.equal(o?.action.type, 'overload');
  const step = (o!.action as { type: 'overload'; step: { kind: string; target: { loadKg?: number } } }).step;
  assert.equal(step.kind, 'increase_weight');
  assert.equal(step.target.loadKg, 12.5); // next prescribed load after 10 kg
  assert.match(o?.decision ?? '', /12\.5 kg/);
});

test('overload: never recommends a weight the user does not own (equipment-aware)', () => {
  // User owns [5, 7.5, 10]: 10 kg is the top of their range. The next
  // prescribed rung (12.5 kg) is named as an equipment gap, not recommended.
  const s = [sess(4), sess(5)];
  const sl = [setLog(4), setLog(5)];
  const o = ofKey(recs(s, sl, [], 6, { availableWeights: [5, 7.5, 10] }), 'overload');
  assert.ok(o);
  const step = (o!.action as { type: 'overload'; step: { kind: string; target: { loadKg?: number; note?: string } } }).step;
  assert.equal(step.kind, 'progress'); // no load increase
  assert.ok((step.target.note ?? '').length > 0);
  assert.match(o?.decision ?? '', /top of your available dumbbells/);
  assert.match(o?.decision ?? '', /12\.5 kg/); // names the needed weight
  assert.ok(!/Move .* to 12\.5 kg/.test(o?.decision ?? ''), 'must not prescribe an unowned weight');
});

test('overload: skips to the next owned ladder rung when the program step is owned', () => {
  const s = [sess(4), sess(5)];
  const sl = [setLog(4), setLog(5)];
  const o = ofKey(recs(s, sl, [], 6, { availableWeights: [5, 7.5, 10, 12.5] }), 'overload');
  assert.ok(o);
  const step = (o!.action as { type: 'overload'; step: { kind: string; target: { loadKg?: number } } }).step;
  assert.equal(step.kind, 'increase_weight');
  assert.equal(step.target.loadKg, 12.5);
});

test('overload: an owned weight that is not a ladder rung never becomes a target', () => {
  // User owns 17.5 kg but the ladder tops out at 15 kg — 17.5 is not a
  // prescribed rung and must be ignored.
  const s = [sess(4), sess(5)];
  const sl = [setLog(4), setLog(5)];
  const o = ofKey(recs(s, sl, [], 6, { availableWeights: [5, 7.5, 10, 17.5] }), 'overload');
  assert.ok(o);
  const step = (o!.action as { type: 'overload'; step: { kind: string } }).step;
  assert.equal(step.kind, 'progress');
  assert.match(o?.decision ?? '', /top of your available dumbbells/);
});

test('overload: a single qualifying session at the top owned rung never jumps weight', () => {
  // User owns [5, 7.5, 10]. One session at 10 kg with 12 reps is not yet
  // "confirmed" — the engine must not recommend the unowned 12.5 kg.
  const s = [sess(2, { rpe: 7 }), sess(4)];
  const sl = [setLog(2, { repsCompleted: 8 }), setLog(4)];
  const o = ofKey(recs(s, sl, [], 6, { availableWeights: [5, 7.5, 10] }), 'overload');
  assert.equal(o, undefined);
});

test('overload: a single qualifying session lowers confidence and asks for confirmation', () => {
  const s = [sess(2), sess(4)];
  // Session at offset 4 hits the top; the earlier session (offset 2) missed.
  const sl = [setLog(2, { repsCompleted: 8 }), setLog(4)];
  const o = ofKey(recs(s, sl, [], 6), 'overload');
  assert.ok(o);
  assert.equal(o?.confidence, 'medium');
});

test('overload: not near the top of the range produces no overload prompt', () => {
  const s = [sess(4)];
  const sl = [setLog(4, { repsCompleted: 9 })]; // target 10-12, well below top
  assert.equal(ofKey(recs(s, sl, [], 6), 'overload'), undefined);
});

test('overload: bodyweight progression after mastering the top of the range', () => {
  // push-up: reps "8-20". 20 reps twice → move to progression.
  const s = [sess(4), sess(5)];
  const sl = [
    setLog(4, { exerciseId: 'push-up', repsCompleted: 20, weightUsed: undefined }),
    setLog(5, { exerciseId: 'push-up', repsCompleted: 20, weightUsed: undefined }),
  ];
  const o = ofKey(recs(s, sl, [], 6), 'overload');
  assert.ok(o);
  const step = (o!.action as { type: 'overload'; step: { kind: string; target: { note?: string } } }).step;
  assert.equal(step.kind, 'progress');
  assert.ok(step.target.note);
});

test('overload: hold exercises suggest longer holds', () => {
  // plank target is 60s (mid of "30-90 second holds"). Two sessions at/above
  // 60s qualify → extend to 65s.
  const s = [sess(4), sess(5)];
  const sl = [
    setLog(4, { exerciseId: 'plank', holdDurationSeconds: 60 }),
    setLog(5, { exerciseId: 'plank', holdDurationSeconds: 65 }),
  ];
  const o = ofKey(recs(s, sl, [], 6), 'overload');
  assert.ok(o);
  const step = (o!.action as { type: 'overload'; step: { kind: string; target: { holdSeconds?: number } } }).step;
  assert.equal(step.kind, 'increase_hold');
  assert.equal(step.target.holdSeconds, 70);
});

test('recovery: a heavy block surfaces a rest recommendation with confidence', () => {
  // High RPE two weeks + trained today → tired/overtraining.
  const s = [
    sess(4, { rpe: 9 }), sess(5, { rpe: 9 }), sess(6, { rpe: 9 }),
    sess(11, { rpe: 9 }), sess(12, { rpe: 9 }), sess(13, { rpe: 9 }),
    sess(14, { rpe: 9 }),
  ];
  const sl = [
    setLog(4, { repsCompleted: 12 }), setLog(5, { repsCompleted: 12 }), setLog(6, { repsCompleted: 12 }),
    setLog(11, { repsCompleted: 12 }), setLog(12, { repsCompleted: 12 }), setLog(13, { repsCompleted: 12 }),
    setLog(14, { repsCompleted: 12 }),
  ];
  const r = ofKey(recs(s, sl, [], 14), 'recovery');
  assert.ok(r);
  assert.ok(r?.priority >= 0.8);
  assert.ok((r!.action as { type: 'recovery'; level: string }).level !== 'ready');
});

test('deload: current deload week is called out as the top priority', () => {
  const list = recs([], [], [], 24); // week 4 (deload) = offsets 21-27
  const d = ofKey(list, 'deload');
  assert.ok(d);
  assert.equal(d?.priority, 0.9);
  assert.equal((d!.action as { type: 'deload'; weekNumber: number }).weekNumber, 4);
});

test('deload: the week before a deload gets a heads-up', () => {
  const d = ofKey(recs([], [], [], 20), 'deload'); // week 3 ends offset 20; week 4 is deload
  assert.ok(d);
  assert.equal(d?.priority, 0.5);
});

test('consistency: low trailing consistency surfaces a habit nudge', () => {
  const s = [sess(0), sess(1), sess(2)]; // 3 of ~13 planned in the first 3 weeks
  const c = ofKey(recs(s, [], [], 14), 'consistency');
  assert.ok(c);
  assert.equal((c!.action as { type: 'consistency'; consistencyPct: number }).consistencyPct, 23);
});

test('measurement: nothing recorded yet recommends a first log', () => {
  const m = ofKey(recs([], [], [], 5), 'measurement');
  assert.ok(m);
  assert.equal((m!.action as { type: 'measurement'; daysSinceLast: number | null }).daysSinceLast, null);
});

test('measurement: a stale reading (>14 days) triggers a reminder', () => {
  const m = ofKey(
    recs([], [], [{ id: 1, date: dateOf(0), week: 1, weight: 80 }], 17),
    'measurement',
  );
  assert.ok(m);
  assert.equal((m!.action as { type: 'measurement'; daysSinceLast: number }).daysSinceLast, 17);
});

test('measurement: a recent reading produces no reminder', () => {
  const m = ofKey(
    recs([], [], [{ id: 1, date: dateOf(2), week: 1, weight: 80 }], 5),
    'measurement',
  );
  assert.equal(m, undefined);
});

test('streak: a broken streak with history recommends restarting', () => {
  const s = [sess(0), sess(1), sess(2)]; // trained week-1 Mon-Wed, then missed
  const st = ofKey(recs(s, [], [], 7), 'streak');
  assert.ok(st);
  assert.equal(st?.priority, 0.65);
});

test('milestone: one session away from an unlock is highlighted', () => {
  const s = Array.from({ length: 9 }, (_, i) => sess(i >= 3 ? i + 1 : i)); // 9 workouts
  const m = ofKey(recs(s, [], [], 12), 'milestone');
  assert.ok(m);
  const action = m!.action as {
    type: 'milestone';
    remaining: number;
    progressCurrent: number;
    progressTarget: number;
  };
  assert.equal(action.remaining, 1);
  assert.equal(action.progressTarget - action.progressCurrent, 1);
});

test('grouping: milestone and hold-overload nudges merge into family cards', () => {
  const base: Omit<Recommendation, 'id' | 'key' | 'priority' | 'importance' | 'title'> = {
    decision: 'test',
    reasoning: ['test'],
    confidence: 'high',
    action: { type: 'recovery', level: 'ready' },
    source: 'test',
  };
  const mk = (over: Partial<Recommendation>): Recommendation => ({ ...base, ...over } as Recommendation);

  const list: Recommendation[] = [
    mk({
      id: 'milestone:a',
      key: 'milestone',
      priority: 0.72,
      importance: 'high',
      title: 'Milestone Ahead',
      action: { type: 'milestone', milestoneId: 'a', remaining: 1, progressCurrent: 4, progressTarget: 5 },
    }),
    mk({
      id: 'milestone:b',
      key: 'milestone',
      priority: 0.62,
      importance: 'normal',
      title: 'Milestone Ahead',
      action: { type: 'milestone', milestoneId: 'b', remaining: 2, progressCurrent: 8, progressTarget: 10 },
    }),
    mk({
      id: 'overload:plank',
      key: 'overload',
      priority: 0.85,
      importance: 'high',
      title: 'Ready to Progress',
      action: {
        type: 'overload',
        exerciseId: 'plank',
        step: {
          exerciseId: 'plank',
          exerciseName: 'Plank',
          kind: 'increase_hold',
          current: { holdSeconds: 45 },
          target: { holdSeconds: 50 },
          qualifyingSessions: 2,
        },
      },
    }),
    mk({
      id: 'overload:wall-sit',
      key: 'overload',
      priority: 0.5,
      importance: 'normal',
      title: 'Keep Pushing',
      action: {
        type: 'overload',
        exerciseId: 'wall-sit',
        step: {
          exerciseId: 'wall-sit',
          exerciseName: 'Wall Sit',
          kind: 'increase_hold',
          current: { holdSeconds: 30 },
          target: { holdSeconds: 35 },
          qualifyingSessions: 1,
        },
      },
    }),
    mk({
      id: 'overload:press',
      key: 'overload',
      priority: 0.9,
      importance: 'critical',
      title: 'Ready to Progress',
      action: {
        type: 'overload',
        exerciseId: 'dumbbell-floor-press',
        step: {
          exerciseId: 'dumbbell-floor-press',
          exerciseName: 'Dumbbell Floor Press',
          kind: 'increase_weight',
          current: { loadKg: 10, reps: 12 },
          target: { loadKg: 12.5, reps: 12 },
          qualifyingSessions: 2,
        },
      },
    }),
  ];

  const groups = groupRecommendations(list);

  const milestones = groups.find((g) => g.id === 'milestones');
  const holds = groups.find((g) => g.id === 'hold-progression');
  const press = groups.find((g) => g.id === 'overload:press');

  assert.ok(milestones);
  assert.equal(milestones.title, 'Milestones Ahead');
  assert.equal(milestones.items.length, 2);
  assert.equal(milestones.importance, 'high');

  assert.ok(holds);
  assert.equal(holds.title, 'Hold Progression');
  assert.equal(holds.items.length, 2);
  assert.equal(holds.importance, 'high');

  assert.ok(press);
  assert.equal(press.items.length, 1);
  assert.equal(press.importance, 'critical');

  // ordered by importance tier first (critical card leads), then priority
  assert.deepEqual(
    groups.map((g) => g.id),
    ['overload:press', 'hold-progression', 'milestones'],
  );
});

test('grouping: singleton cards pass through and input is not mutated', () => {
  const mk = (over: Partial<Recommendation>): Recommendation =>
    ({ decision: 't', reasoning: ['t'], confidence: 'high', action: { type: 'streak', currentStreak: 2 }, source: 't', ...over }) as Recommendation;

  const list = [
    mk({ id: 'streak', key: 'streak', priority: 0.65, importance: 'high', title: 'Restart Your Streak' }),
    mk({ id: 'measurement', key: 'measurement', priority: 0.55, importance: 'normal', title: 'Track Your Progress' }),
  ];
  const before = JSON.stringify(list);
  const groups = groupRecommendations(list);

  assert.deepEqual(groups.map((g) => g.id), ['streak', 'measurement']);
  assert.equal(JSON.stringify(list), before, 'input must not be mutated');
});

test('results are sorted by priority and capped by maxResults', () => {
  const s = [
    sess(0), sess(1), sess(2), sess(4, { rpe: 9 }), sess(5, { rpe: 9 }), sess(6, { rpe: 9 }),
    sess(7), sess(8),
  ];
  const sl = [setLog(4), setLog(5), setLog(6), setLog(7), setLog(8)];
  const list = recs(s, sl, [], 9, { maxResults: 3 });
  assert.ok(list.length <= 3);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1].priority >= list[i].priority);
  }
});

test('deterministic: identical inputs yield identical lists', () => {
  const s = [
    sess(0), sess(1), sess(2), sess(4, { rpe: 9 }), sess(5, { rpe: 9 }), sess(6, { rpe: 9 }),
    sess(7), sess(8),
  ];
  const sl = [setLog(4), setLog(5), setLog(6), setLog(7), setLog(8)];
  const meas: MeasurementEntry[] = [{ id: 1, date: dateOf(0), week: 1, weight: 80 }];
  const a = recs(s, sl, meas, 9);
  const b = recs(s, sl, meas, 9);
  assert.deepEqual(a, b);
});
