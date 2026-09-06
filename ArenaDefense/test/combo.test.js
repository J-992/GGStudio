import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { ComboTracker } from '../src/core/combo.js';

test('tierFor: below first tier is 0, at tiers matches configured coins', () => {
  const combo = new ComboTracker(CONFIG);
  assert.equal(combo.tierFor(2), 0);
  assert.equal(combo.tierFor(3), 1);
  assert.equal(combo.tierFor(8), 8);
});

test('tierFor holds the highest tier reached between thresholds', () => {
  const combo = new ComboTracker(CONFIG);
  assert.equal(combo.tierFor(4), 1); // past tier(3,1) but short of tier(5,3)
  assert.equal(combo.tierFor(19), 15);
  assert.equal(combo.tierFor(20), 30);
  assert.equal(combo.tierFor(1000), 30);
});

test('window expiry ends the combo exactly once, reporting final kills/coins', () => {
  const combo = new ComboTracker(CONFIG);
  combo.onKill(0);
  combo.onKill(0.5);
  combo.onKill(1.0); // 3 kills -> tier(3,1)

  // Still inside the window.
  let result = combo.update(1.0 + CONFIG.combo.windowS - 0.01);
  assert.equal(result.ended, false);

  // Window has now elapsed since the LAST kill (t=1.0).
  result = combo.update(1.0 + CONFIG.combo.windowS + 0.01);
  assert.equal(result.ended, true);
  assert.equal(result.kills, 3);
  assert.equal(result.coins, 1);

  // Must not fire again on a later poll.
  result = combo.update(1.0 + CONFIG.combo.windowS + 100);
  assert.equal(result.ended, false);
  assert.equal(result.kills, 0);
});

test('a new kill resets the rolling window rather than the combo start time', () => {
  const combo = new ComboTracker(CONFIG);
  combo.onKill(0);
  // Almost expired...
  let result = combo.update(CONFIG.combo.windowS - 0.01);
  assert.equal(result.ended, false);
  // ...but a fresh kill lands just in time and resets the window.
  combo.onKill(CONFIG.combo.windowS - 0.01);
  result = combo.update(CONFIG.combo.windowS - 0.01 + CONFIG.combo.windowS - 0.01);
  assert.equal(result.ended, false);
  assert.equal(result.kills, 2);
});

test('remaining() is 1 right after a kill, 0 once expired, and 0 with no active combo', () => {
  const combo = new ComboTracker(CONFIG);
  assert.equal(combo.remaining(0), 0);
  combo.onKill(10);
  assert.ok(Math.abs(combo.remaining(10) - 1) < 1e-9);
  assert.ok(Math.abs(combo.remaining(10 + CONFIG.combo.windowS / 2) - 0.5) < 1e-9);
  assert.equal(combo.remaining(10 + CONFIG.combo.windowS + 1), 0);
});
