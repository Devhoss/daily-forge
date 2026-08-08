import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';
import type { EquipmentProfile } from '@/lib/equipment';

await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { buildCoachContext } = await import('./coachContext.ts');
const { buildSystemPrompt, buildUserPrompt } = await import('./coachPrompt.ts');

const START = '2026-07-26';

function dateOf(offset: number): string {
  const d = new Date(2026, 6, 26 + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sess(offset: number): SessionLog {
  return {
    date: dateOf(offset),
    weekNumber: 1,
    sessionKey: 'push_a',
    completed: true,
    rpe: 7,
    durationMin: 30,
    energy: 6,
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

function sampleContext(): ReturnType<typeof buildCoachContext> {
  const sessions: SessionLog[] = [sess(0), sess(1)];
  const sets: SetLog[] = [
    {
      date: dateOf(0),
      sessionKey: 'push_a',
      exerciseId: 'dumbbell-floor-press',
      setIndex: 0,
      repsCompleted: 12,
      weightUsed: 10,
      completedAt: `${dateOf(0)}T10:00:00.000Z`,
    },
    {
      date: dateOf(1),
      sessionKey: 'push_a',
      exerciseId: 'dumbbell-floor-press',
      setIndex: 0,
      repsCompleted: 12,
      weightUsed: 10,
      completedAt: `${dateOf(1)}T10:00:00.000Z`,
    },
  ];
  const meas: MeasurementEntry[] = [{ id: 1, date: dateOf(0), week: 1, weight: 80 }];
  return buildCoachContext(sessions, sets, meas, {
    startIso: START,
    asOf: new Date(2026, 6, 26 + 5),
    equipment: EQUIPMENT,
  });
}

test('system prompt encodes every grounding rule', () => {
  const prompt = buildSystemPrompt();
  const required = [
    'never invent',
    'not recorded',
    'never override',
    'medical',
    'not a medical measurement',
    'JSON object',
    'suggestedAction',
    'confidence',
  ];
  for (const phrase of required) {
    assert.ok(prompt.toLowerCase().includes(phrase.toLowerCase()), `missing: ${phrase}`);
  }
});

test('system prompt demands structured JSON only output', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /"answer":\s*string/);
  assert.match(prompt, /"keyPoints":\s*string\[\]/);
  assert.match(prompt, /"referencedFacts":\s*string\[\]/);
  assert.match(prompt, /"suggestedAction":\s*string \| null/);
  assert.match(prompt, /"confidence":\s*"(high|medium|low)"/);
  assert.match(prompt, /"limitations":\s*string\[\]/);
});

test('user prompt embeds the sanitized context and the question', () => {
  const ctx = sampleContext();
  const question = 'Should I push hard today?';
  const user = buildUserPrompt(ctx, question);
  assert.ok(user.includes(question));
  assert.ok(user.includes(ctx.asOfIso));
  assert.ok(user.includes('recovery'));
  assert.ok(user.includes('"score"'));
  assert.ok(user.includes('"missing"'));
});

test('user prompt does not include raw free-text fields or internal ids', () => {
  const ctx = sampleContext();
  const user = buildUserPrompt(ctx, 'How is my recovery?');
  assert.ok(!user.includes('notes'));
  assert.ok(!user.includes('completedAt'));
  assert.ok(!user.includes('setIndex'));
  assert.ok(!user.includes('exerciseId'));
});

test('grounding rules treat context values as authoritative, not suggestions', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /authoritative/i);
  assert.match(prompt, /facts vs advice|distinguish/i);
});
