import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

await register(
  new URL('../../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { localGemmaProvider } = await import('./localGemmaProvider.ts');

test('default provider identity metadata is stable (local-gemma / LiteRT-LM)', () => {
  assert.equal(localGemmaProvider.id, 'local-gemma');
  assert.equal(localGemmaProvider.runtime, 'LiteRT-LM (com.google.ai.edge.litertlm)');
  assert.equal(localGemmaProvider.modelName, 'Gemma 4 E2B-it');
  assert.equal(localGemmaProvider.quantization, 'int4 (mixed-bit)');
});

test('on a non-native platform isAvailable() returns false and status is unavailable', async () => {
  const available = await localGemmaProvider.isAvailable();
  assert.equal(available, false);
  assert.equal(localGemmaProvider.getStatus(), 'unavailable');
});

test('on a non-native platform, load() throws and status stays unavailable', async () => {
  await assert.rejects(() => localGemmaProvider.load());
  assert.equal(localGemmaProvider.getStatus(), 'unavailable');
});

test('on a non-native platform, generate() rejects with a clear message', async () => {
  await assert.rejects(
    () => localGemmaProvider.generate({ systemPrompt: 'x', userPrompt: 'y' }),
    /not loaded/,
  );
});

test('on a non-native platform, cancel() resolves false without throwing', async () => {
  const cancelled = await localGemmaProvider.cancel();
  assert.equal(cancelled, false);
});

test('on a non-native platform, diagnostics report honest unavailable state', () => {
  const diag = localGemmaProvider.getDiagnostics();
  assert.equal(diag.providerId, 'local-gemma');
  assert.equal(diag.loaded, false);
  assert.equal(diag.status, 'unavailable');
  // Native-only fields are null/absent, never fabricated.
  assert.equal(diag.modelFormat, null);
  assert.equal(diag.modelPath, null);
  assert.equal(diag.modelExists, null);
  assert.equal(diag.baselineMemoryKb, null);
  assert.equal(diag.loadMemoryKb, null);
  assert.equal(diag.decodeTokensPerSecond, null);
});

test('unload() is safe before any load attempt (idempotent)', async () => {
  // unload() on a non-native platform is a no-op that resolves and does not
  // flip the status (native support is what determines the reported state).
  const before = localGemmaProvider.getStatus();
  await localGemmaProvider.unload();
  assert.equal(localGemmaProvider.getStatus(), before);
});