import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { EquipmentProfile } from '@/lib/equipment';

// The service composes real prompt/parser code, but the provider is injected,
// so this test never touches the Capacitor-backed local provider.
await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { buildCoachContext } = await import('./coachContext.ts');
const { askCoach } = await import('./coachService.ts');
const { localGemmaProvider } = await import('./localGemmaProvider.ts');

import type {
  AiProvider,
  AiDiagnostics,
  GenerationRequest,
  GenerationResult,
  CoachContext,
  ProviderStatus,
} from './aiTypes.ts';

const START = '2026-07-26';

const EQUIPMENT: EquipmentProfile = {
  dumbbells: [5, 7.5, 10],
  hasBench: false,
  hasBands: false,
  hasPullUpBar: false,
  hasMat: true,
  hasKettlebell: false,
};

function emptyContext(): CoachContext {
  return buildCoachContext([], [], [], {
    startIso: START,
    asOf: new Date(2026, 6, 26 + 5),
    equipment: EQUIPMENT,
  });
}

const VALID_JSON = JSON.stringify({
  answer: 'You are ready to follow the plan.',
  keyPoints: ['Recovery looks good.'],
  referencedFacts: ['recovery level ready'],
  suggestedAction: null,
  confidence: 'medium',
  limitations: [],
});

interface FakeProviderOpts {
  available?: boolean;
  loadError?: string;
  generateError?: string;
  text?: string;
}

/** Fully in-memory AiProvider for service tests. */
function fakeProvider(opts: FakeProviderOpts = {}): AiProvider & { diagnostics: AiDiagnostics } {
  const diag: AiDiagnostics = {
    providerId: 'fake',
    runtime: 'fake-runtime',
    modelName: 'Fake Model',
    modelVersion: '1.0',
    quantization: 'int4',
    backend: 'cpu',
    status: 'idle',
    loaded: false,
    loadTimeMs: null,
    promptTokens: null,
    generatedTokens: null,
    latencyMs: null,
    lastRequestAt: null,
    lastResponsePreview: null,
    lastError: null,
    runtimeVersion: null,
    modelFormat: null,
    modelPath: null,
    modelExists: null,
    modelSizeBytes: null,
    baselineMemoryKb: null,
    loadMemoryKb: null,
    firstTokenMs: null,
    prefillTokensPerSecond: null,
    decodeTokensPerSecond: null,
    timeToFirstTokenInSecond: null,
    lastCancelled: null,
  };
  return {
    id: 'fake',
    runtime: 'fake-runtime',
    modelName: 'Fake Model',
    modelVersion: '1.0',
    quantization: 'int4',
    diagnostics: diag,
    getStatus(): ProviderStatus {
      return diag.status;
    },
    async isAvailable() {
      return opts.available ?? true;
    },
    async load() {
      if (opts.loadError) {
        diag.status = 'error';
        diag.lastError = opts.loadError;
        throw new Error(opts.loadError);
      }
      diag.loaded = true;
      diag.status = 'ready';
      diag.loadTimeMs = 42;
    },
    async unload() {
      diag.loaded = false;
      diag.status = 'idle';
    },
    async cancel() {
      return false;
    },
    async generate(request: GenerationRequest): Promise<GenerationResult> {
      if (opts.generateError) {
        diag.lastError = opts.generateError;
        throw new Error(opts.generateError);
      }
      const text = opts.text ?? VALID_JSON;
      diag.lastRequestAt = new Date().toISOString();
      diag.lastResponsePreview = text.slice(0, 200);
      diag.promptTokens = (request.systemPrompt + request.userPrompt).split(/\s+/).length;
      diag.generatedTokens = text.split(/\s+/).length;
      diag.latencyMs = 12;
      return { text };
    },
    getDiagnostics() {
      return diag;
    },
  };
}

test('askCoach returns a parsed response, raw text, and diagnostics', async () => {
  const ctx = emptyContext();
  const provider = fakeProvider();
  const result = await askCoach(ctx, 'How should I train today?', { provider });
  assert.equal(result.ok, true);
  assert.equal(result.response.answer, 'You are ready to follow the plan.');
  assert.equal(result.response.confidence, 'medium');
  assert.equal(result.raw, VALID_JSON);
  assert.equal(result.diagnostics.providerId, 'fake');
  assert.equal(typeof result.diagnostics.promptTokens, 'number');
  assert.equal(typeof result.diagnostics.latencyMs, 'number');
});

test('askCoach grounds the prompt with the system grounding rules', async () => {
  const ctx = emptyContext();
  let captured = '';
  const provider: AiProvider = {
    ...fakeProvider(),
    async generate(request: GenerationRequest) {
      captured = request.systemPrompt;
      return { text: VALID_JSON };
    },
  };
  await askCoach(ctx, 'anything', { provider });
  assert.ok(captured.includes('Never invent'));
  assert.ok(captured.includes('JSON object'));
});

test('unavailable provider returns a structured fallback with diagnostics', async () => {
  const ctx = emptyContext();
  const provider = fakeProvider({ available: false });
  const result = await askCoach(ctx, 'How is my recovery?', { provider });
  assert.equal(result.ok, false);
  assert.ok(result.response.answer.includes("isn't available"));
  assert.equal(result.response.confidence, 'low');
  assert.equal(result.diagnostics.providerId, 'fake');
});

test('provider load failure degrades to a structured fallback', async () => {
  const ctx = emptyContext();
  const provider = fakeProvider({ loadError: 'out of memory' });
  const result = await askCoach(ctx, 'hi', { provider });
  assert.equal(result.ok, false);
  assert.match(result.response.limitations.join(' '), /out of memory/);
});

test('generation failure returns an honest fallback and surfaces the error', async () => {
  const ctx = emptyContext();
  const provider = fakeProvider({ generateError: 'tokens exhausted' });
  const result = await askCoach(ctx, 'hi', { provider });
  assert.equal(result.ok, false);
  assert.match(result.response.limitations.join(' '), /tokens exhausted/);
  assert.equal(result.diagnostics.lastError, 'tokens exhausted');
});

test('a user-cancelled generation reports cancelled=true with an explicit reply', async () => {
  const ctx = emptyContext();
  const provider: AiProvider = {
    ...fakeProvider(),
    async generate() {
      throw new Error('Generation cancelled');
    },
  };
  const result = await askCoach(ctx, 'long question', { provider });
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.match(result.response.answer, /stopped/i);
});

test('unparseable model output is surfaced but still structured', async () => {
  const ctx = emptyContext();
  const provider = fakeProvider({ text: 'Sure, rest today.' });
  const result = await askCoach(ctx, 'Rest?', { provider });
  assert.equal(result.ok, false);
  assert.equal(result.response.answer, 'Sure, rest today.');
  assert.ok(result.response.limitations.length > 0);
  assert.equal(result.raw, 'Sure, rest today.');
});

test('loads the provider before generating when not ready', async () => {
  const ctx = emptyContext();
  let loadCalls = 0;
  const provider = fakeProvider();
  const original = provider.load.bind(provider);
  provider.load = async () => {
    loadCalls++;
    await original();
  };
  await askCoach(ctx, 'hi', { provider });
  assert.equal(loadCalls, 1);
  assert.equal(provider.getDiagnostics().loaded, true);
});

test('deterministic for identical inputs with a deterministic provider', async () => {
  const ctx = emptyContext();
  const a = await askCoach(ctx, 'same question', { provider: fakeProvider() });
  const b = await askCoach(ctx, 'same question', { provider: fakeProvider() });
  assert.deepEqual(a.response, b.response);
  assert.equal(a.raw, b.raw);
});

test('default provider resolves to the local Gemma provider', () => {
  assert.equal(localGemmaProvider.id, 'local-gemma');
  assert.equal(localGemmaProvider.runtime.includes('LiteRT-LM'), true);
});
