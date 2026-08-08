import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseCoachResponse } = await import('./responseParser.ts');

const VALID = {
  answer: 'You are recovered enough to follow your plan.',
  keyPoints: ['Recovery is 72/100', 'No major strain signals'],
  referencedFacts: ['recovery score 72', 'level ready'],
  suggestedAction: 'Do today\u2019s Push A session at the recommended loads.',
  confidence: 'medium',
  limitations: ['Sleep was not recorded.'],
};

test('parses a clean JSON object', () => {
  const res = parseCoachResponse(JSON.stringify(VALID));
  assert.equal(res.ok, true);
  assert.equal(res.error, null);
  assert.deepEqual(res.response, VALID);
});

test('parses JSON inside a markdown fence', () => {
  const res = parseCoachResponse('```json\n' + JSON.stringify(VALID) + '\n```');
  assert.equal(res.ok, true);
  assert.deepEqual(res.response, VALID);
});

test('parses JSON with prose around it (small models often wrap)', () => {
  const res = parseCoachResponse('Here you go:\n' + JSON.stringify(VALID) + '\nHope that helps!');
  assert.equal(res.ok, true);
  assert.deepEqual(res.response, VALID);
});

test('invalid JSON falls back to a response carrying the raw text', () => {
  const raw = 'Sure, you should train today.';
  const res = parseCoachResponse(raw);
  assert.equal(res.ok, false);
  assert.ok(res.error !== null);
  assert.equal(res.response.answer, raw);
  assert.equal(res.response.confidence, 'low');
  assert.ok(res.response.limitations.length > 0);
});

test('empty input falls back gracefully', () => {
  const res = parseCoachResponse('');
  assert.equal(res.ok, false);
  assert.ok(res.error !== null);
});

test('JSON missing an answer falls back', () => {
  const res = parseCoachResponse(JSON.stringify({ keyPoints: ['x'] }));
  assert.equal(res.ok, false);
  assert.equal(res.response.answer, '{"keyPoints":["x"]}');
});

test('coerces malformed optional fields to safe defaults', () => {
  const res = parseCoachResponse(
    JSON.stringify({
      answer: 'ok',
      keyPoints: ['a', 42, '', 'b'],
      referencedFacts: 'not-an-array',
      suggestedAction: '',
      confidence: 'extreme',
      limitations: ['x', 7],
    }),
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.response.keyPoints, ['a', 'b']);
  assert.deepEqual(res.response.referencedFacts, []);
  assert.equal(res.response.suggestedAction, null);
  assert.equal(res.response.confidence, 'low');
  assert.deepEqual(res.response.limitations, ['x']);
});

test('caps very long arrays', () => {
  const res = parseCoachResponse(
    JSON.stringify({
      ...VALID,
      keyPoints: Array.from({ length: 20 }, (_, i) => `point ${i}`),
      limitations: Array.from({ length: 20 }, (_, i) => `lim ${i}`),
    }),
  );
  assert.ok(res.response.keyPoints.length <= 8);
  assert.ok(res.response.limitations.length <= 5);
});

test('deterministic: same input parses identically every time', () => {
  const a = parseCoachResponse(JSON.stringify(VALID));
  const b = parseCoachResponse(JSON.stringify(VALID));
  assert.deepEqual(a, b);
});
