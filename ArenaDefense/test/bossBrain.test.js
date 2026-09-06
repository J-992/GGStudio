import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { BossBrain } from '../src/core/bossBrain.js';

const DEF = CONFIG.bosses.patapim;

// A target far enough away that the walk/attack branches never fire, so
// these tests can isolate the cast cadence in complete isolation.
const FAR_TARGET = { x: 1000, z: 0, dist: 1000 };
const IN_RANGE_TARGET = { x: 2, z: 0, dist: 2 };
const SELF = { x: 0, z: 0 };

test('casts on cadence, spawning exactly one add at 60% progress, then resumes walking', () => {
  const brain = new BossBrain(DEF, CONFIG);
  const STEP = 0.05;
  let addsAlive = 0;
  let sawCastStart = false;
  let spawnCount = 0;
  let castTicks = 0;
  let elapsed = 0;

  // Simulate in small fixed steps up to just past the cast's natural end,
  // tracking exactly when a cast starts, how many times it spawns an add,
  // and that no movement (moveDir) is ever reported while casting.
  const totalS = DEF.addEveryS + DEF.castDurationS + 0.5;
  while (elapsed < totalS) {
    const r = brain.update(STEP, { self: SELF, target: FAR_TARGET, addsAlive, time: elapsed });
    elapsed += STEP;
    if (r.action === 'cast') {
      castTicks++;
      sawCastStart = true;
      assert.equal(r.moveDir, null, 'no movement while casting');
      if (r.spawnAdd) {
        spawnCount++;
        addsAlive++; // mirror Boss.js incrementing addsAlive once its spawn call lands
      }
    } else {
      assert.equal(r.action, 'walk', 'off-cast ticks should be walking toward the far target');
    }
  }

  assert.ok(sawCastStart, 'expected a cast to start within one addEveryS + castDurationS window');
  assert.equal(spawnCount, 1, 'expected exactly one add spawned across the whole cast');
  assert.ok(castTicks >= 1);

  // The cadence timer was reset when the cast started, so exactly
  // `brain.castCooldown` more (non-casting) seconds must pass before a
  // second cast is eligible — not one tick sooner, and not one tick later.
  const remaining = brain.castCooldown;
  assert.ok(remaining > 0, 'expected a positive cast cooldown after the first cast started');

  let r = brain.update(remaining - 0.01, { self: SELF, target: FAR_TARGET, addsAlive, time: 0 });
  assert.notEqual(r.action, 'cast', 'no second cast one tick before the cadence elapses');

  r = brain.update(0.02, { self: SELF, target: FAR_TARGET, addsAlive, time: 0 });
  assert.equal(r.action, 'cast', 'second cast once the cadence has fully elapsed');
});

test('never casts while at the add cap, however long the cadence timer runs', () => {
  const brain = new BossBrain(DEF, CONFIG);
  for (let i = 0; i < 20; i++) {
    const r = brain.update(DEF.addEveryS, { self: SELF, target: FAR_TARGET, addsAlive: DEF.maxAdds, time: 0 });
    assert.notEqual(r.action, 'cast');
  }
});

test('starts casting again once a slot frees up below the add cap', () => {
  const brain = new BossBrain(DEF, CONFIG);
  // Tick well past the cadence timer while capped: no cast.
  let r = brain.update(DEF.addEveryS * 2, { self: SELF, target: FAR_TARGET, addsAlive: DEF.maxAdds, time: 0 });
  assert.notEqual(r.action, 'cast');
  // A slot frees up (an add died): the very next update casts.
  r = brain.update(0.01, { self: SELF, target: FAR_TARGET, addsAlive: DEF.maxAdds - 1, time: 0 });
  assert.equal(r.action, 'cast');
});

test('attacks when in range and off cooldown, then withholds until cooldown elapses', () => {
  const brain = new BossBrain(DEF, CONFIG);
  // Push addsAlive to the cap so casting never interferes with this test.
  const ctx = { self: SELF, target: IN_RANGE_TARGET, addsAlive: DEF.maxAdds, time: 0 };

  let r = brain.update(0.016, ctx);
  assert.equal(r.action, 'attack');

  // Immediately after: still on cooldown, falls back to walking (still
  // in range, but attack is gated).
  r = brain.update(0.016, ctx);
  assert.equal(r.action, 'walk');

  // Once the full cooldown has elapsed, it attacks again.
  r = brain.update(DEF.cooldown, ctx);
  assert.equal(r.action, 'attack');
});

test('does not attack out of range regardless of cooldown', () => {
  const brain = new BossBrain(DEF, CONFIG);
  const ctx = { self: SELF, target: FAR_TARGET, addsAlive: DEF.maxAdds, time: 0 };
  const r = brain.update(1000, ctx);
  assert.notEqual(r.action, 'attack');
});

test('walk direction is a unit vector pointing at the target', () => {
  const brain = new BossBrain(DEF, CONFIG);
  const target = { x: 3, z: 4, dist: 5 }; // 3-4-5 triangle, outside range, off cast cadence.
  const r = brain.update(0.016, { self: SELF, target, addsAlive: DEF.maxAdds, time: 0 });
  assert.equal(r.action, 'walk');
  assert.ok(Math.abs(r.moveDir.x - 0.6) < 1e-9);
  assert.ok(Math.abs(r.moveDir.z - 0.8) < 1e-9);
  assert.ok(Math.abs(Math.hypot(r.moveDir.x, r.moveDir.z) - 1) < 1e-9);
});

test('idle (no jitter) when already exactly at the target and off attack cooldown but in a state where attack cannot fire', () => {
  // Force attack to be on cooldown by attacking once first, then present a
  // coincident target — attack is gated by cooldown, so it should fall
  // through to idle rather than producing a degenerate walk direction.
  const brain = new BossBrain(DEF, CONFIG);
  const coincident = { x: 0, z: 0, dist: 0 };
  const ctx = { self: SELF, target: coincident, addsAlive: DEF.maxAdds, time: 0 };
  brain.update(0.016, ctx); // attacks (dist 0 <= range)
  const r = brain.update(0.016, ctx); // still on cooldown, dist is 0 -> idle, not a jittery walk
  assert.equal(r.action, 'idle');
  assert.equal(r.moveDir, null);
});
