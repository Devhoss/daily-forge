import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The event bus lives under src/lib, which the service tests' alias loader
// already resolves (@/lib → ./src/lib), so the same loader is required.
await register(
  new URL('../../scripts/service-loader.mjs', import.meta.url).href,
  { parentURL: import.meta.url },
);

const { onDataChanged, emitDataChanged, getDataVersion } = await import(
  '@/lib/events.ts'
);

test('subscriber fires on every emit and can unsubscribe', () => {
  const calls: string[] = [];
  const off = onDataChanged(() => calls.push('fired'));

  emitDataChanged();
  emitDataChanged();
  assert.deepEqual(calls, ['fired', 'fired']);

  off();
  emitDataChanged();
  assert.equal(calls.length, 2, 'unsubscribed listener must not fire again');
});

test('multiple subscribers all receive the event', () => {
  let a = 0;
  let b = 0;
  const offA = onDataChanged(() => { a += 1; });
  const offB = onDataChanged(() => { b += 1; });

  emitDataChanged();
  assert.equal(a, 1);
  assert.equal(b, 1);

  offA();
  emitDataChanged();
  assert.equal(a, 1, 'A unsubscribed');
  assert.equal(b, 2, 'B still subscribed');
  offB();
});

test('version is monotonic and increments on every emit', () => {
  const before = getDataVersion();
  emitDataChanged();
  emitDataChanged();
  assert.equal(getDataVersion(), before + 2);
});

test('a listener added during a dispatch is not called for that dispatch', () => {
  let innerCalls = 0;
  const off = onDataChanged(() => {
    onDataChanged(() => { innerCalls += 1; });
  });
  emitDataChanged();
  assert.equal(innerCalls, 0, 'late subscriber must not fire for the current emit');
  emitDataChanged();
  assert.equal(innerCalls, 1, 'late subscriber fires on the next emit');
  off();
});
