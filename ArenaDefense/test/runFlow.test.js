import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyDoubler, coinsForRun, bestWaveAfter } from '../src/core/runFlow.js';

test('applyDoubler doubles only when doubled is true', () => {
  assert.equal(applyDoubler(10, true), 20);
  assert.equal(applyDoubler(10, false), 10);
  assert.equal(applyDoubler(0, true), 0);
});

test('coinsForRun adds earned coins onto the saved total', () => {
  assert.equal(coinsForRun(100, 25), 125);
  assert.equal(coinsForRun(0, 0), 0);
});

test('coinsForRun composes with applyDoubler for a doubled run', () => {
  const earned = applyDoubler(12, true);
  assert.equal(coinsForRun(50, earned), 74);
});

test('bestWaveAfter keeps the higher of the previous best and the cleared wave', () => {
  assert.equal(bestWaveAfter(0, 3), 3);
  assert.equal(bestWaveAfter(5, 3), 5);
  assert.equal(bestWaveAfter(5, 5), 5);
});
