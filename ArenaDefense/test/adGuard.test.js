import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AdGuard, withWatchdog } from '../src/core/adGuard.js';

test('start()/stop() are idempotent', () => {
  const guard = new AdGuard();
  assert.equal(guard.start(), true);
  assert.equal(guard.started, true);
  // A second start() in a row must not "double start" — no-op, returns false.
  assert.equal(guard.start(), false);
  assert.equal(guard.started, true);

  assert.equal(guard.stop(), true);
  assert.equal(guard.started, false);
  // A second stop() in a row must not throw or re-fire — no-op, returns false.
  assert.equal(guard.stop(), false);
  assert.equal(guard.started, false);
});

test('beginAd() stops gameplay unconditionally, even if it was never started', () => {
  const guard = new AdGuard();
  // Never started at all — beginAd() must still be safe and must still
  // leave `started` false (the central invariant is "stopped before the ad",
  // not "was running before the ad").
  assert.equal(guard.beginAd(), false);
  assert.equal(guard.started, false);
  assert.equal(guard.adPlaying, true);

  guard.endAd();
  const guard2 = new AdGuard();
  guard2.start();
  assert.equal(guard2.started, true);
  // This time gameplay WAS running — beginAd() reports that and still stops it.
  assert.equal(guard2.beginAd(), true);
  assert.equal(guard2.started, false);
  assert.equal(guard2.adPlaying, true);
});

test('gameplayStart is refused for as long as an ad is playing', () => {
  const guard = new AdGuard();
  guard.beginAd();
  assert.equal(guard.canStart(), false);
  assert.equal(guard.start(), false);
  assert.equal(guard.started, false);

  guard.endAd();
  assert.equal(guard.canStart(), true);
  assert.equal(guard.start(), true);
  assert.equal(guard.started, true);
});

test('a full commercial-break sequence never double-fires start or skips the stop', () => {
  const guard = new AdGuard();
  const log = [];

  // Simulates the exact sequence `platform/poki.js#commercialBreak` drives.
  guard.start();
  log.push(guard.started ? 'started' : 'not-started');

  const wasStarted = guard.beginAd();
  log.push(wasStarted ? 'stopped-from-running' : 'stopped-from-idle');
  assert.equal(guard.canStart(), false, 'no gameplayStart while the ad plays');

  guard.endAd();
  assert.equal(guard.start(), true, 'gameplayStart is legal again once the ad ends');

  assert.deepEqual(log, ['started', 'stopped-from-running']);
});

test('withWatchdog resolves with the factory’s value when it settles in time', async () => {
  const result = await withWatchdog(() => Promise.resolve('sdk-result'), 50, 'fallback');
  assert.equal(result, 'sdk-result');
});

test('withWatchdog releases with the fallback when the promise hangs forever', async () => {
  const hung = new Promise(() => {}); // never settles — simulates a broken SDK call.
  const result = await withWatchdog(() => hung, 15, 'fallback');
  assert.equal(result, 'fallback');
});

test('withWatchdog releases with the fallback when the factory rejects', async () => {
  const result = await withWatchdog(() => Promise.reject(new Error('sdk broke')), 50, 'fallback');
  assert.equal(result, 'fallback');
});

test('withWatchdog releases with the fallback when the factory throws synchronously', async () => {
  const result = await withWatchdog(() => {
    throw new Error('sdk broke synchronously');
  }, 50, 'fallback');
  assert.equal(result, 'fallback');
});
