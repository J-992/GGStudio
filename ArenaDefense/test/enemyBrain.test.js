import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import {
  chooseTarget, steer, attackReady, tickCooldown, hpFor,
  knockbackSpeed, decayKnockback, staggerFactor, knockbackTilt, knockbackIntensity,
} from '../src/core/enemyBrain.js';

test('melee picks the nearest turret over a farther player', () => {
  const enemy = { x: 0, z: 0, type: 'shambler' };
  const player = { x: 20, z: 0 };
  const turrets = [
    { id: 1, x: 15, z: 0, alive: true },
    { id: 2, x: 3, z: 0, alive: true },
  ];
  const target = chooseTarget(enemy, player, turrets, CONFIG);
  assert.equal(target.kind, 'turret');
  assert.equal(target.id, 2);
});

test('melee falls back to the player when no turret is alive', () => {
  const enemy = { x: 0, z: 0, type: 'shambler' };
  const player = { x: 20, z: 0 };
  const turrets = [{ id: 1, x: 1, z: 0, alive: false }];
  const target = chooseTarget(enemy, player, turrets, CONFIG);
  assert.equal(target.kind, 'player');
  assert.equal(target.id, null);
});

test('ranged prefers the player when inside preferPlayerRange, even with a closer turret', () => {
  const enemy = { x: 0, z: 0, type: 'spitter' };
  const preferRange = CONFIG.enemies.types.spitter.preferPlayerRange;
  const player = { x: preferRange - 1, z: 0 };
  const turrets = [{ id: 9, x: 2, z: 0, alive: true }];
  const target = chooseTarget(enemy, player, turrets, CONFIG);
  assert.equal(target.kind, 'player');
});

test('ranged targets the nearest turret when the player is outside preferPlayerRange', () => {
  const enemy = { x: 0, z: 0, type: 'spitter' };
  const preferRange = CONFIG.enemies.types.spitter.preferPlayerRange;
  const player = { x: preferRange + 5, z: 0 };
  const turrets = [
    { id: 5, x: 3, z: 0, alive: true },
    { id: 6, x: 10, z: 0, alive: true },
  ];
  const target = chooseTarget(enemy, player, turrets, CONFIG);
  assert.equal(target.kind, 'turret');
  assert.equal(target.id, 5);
});

test('ranged holds keepDistance: velocity is ~0 at that distance and points away when closer', () => {
  const typeDef = CONFIG.enemies.types.spitter;
  const kd = typeDef.keepDistance;

  const atKeepDistance = steer({ x: 0, z: 0 }, { x: kd, z: 0 }, [], CONFIG, typeDef);
  assert.ok(Math.abs(atKeepDistance.vx) < 1e-6, `expected ~0 vx at keepDistance, got ${atKeepDistance.vx}`);
  assert.ok(Math.abs(atKeepDistance.vz) < 1e-6, `expected ~0 vz at keepDistance, got ${atKeepDistance.vz}`);

  const closer = steer({ x: 0, z: 0 }, { x: kd - 3, z: 0 }, [], CONFIG, typeDef);
  // Target is in +x direction; being closer than keepDistance should push
  // the enemy away, i.e. in -x.
  assert.ok(closer.vx < -1e-6, `expected negative (away) vx when closer than keepDistance, got ${closer.vx}`);

  const farther = steer({ x: 0, z: 0 }, { x: kd + 3, z: 0 }, [], CONFIG, typeDef);
  assert.ok(farther.vx > 1e-6, `expected positive (approach) vx when farther than keepDistance, got ${farther.vx}`);
});

test('melee (no keepDistance) always seeks straight at the target, clamped to speed', () => {
  const typeDef = CONFIG.enemies.types.shambler;
  const { vx, vz } = steer({ x: 0, z: 0 }, { x: 100, z: 0 }, [], CONFIG, typeDef);
  assert.ok(Math.abs(vx - typeDef.speed) < 1e-6);
  assert.ok(Math.abs(vz) < 1e-6);
});

test('separation pushes two coincident enemies apart', () => {
  const typeDef = CONFIG.enemies.types.shambler;
  // Enemy and its single neighbour sit at the exact same point, both also
  // exactly on top of their shared target so the seek component is zero —
  // isolating the separation term.
  const enemy = { x: 5, z: 5 };
  const target = { x: 5, z: 5 };
  const neighbours = [{ x: 5, z: 5 }];
  const { vx, vz } = steer(enemy, target, neighbours, CONFIG, typeDef);
  const mag = Math.hypot(vx, vz);
  assert.ok(mag > 1e-6, `expected a nonzero separation push, got vx=${vx} vz=${vz}`);
});

test('separation has no effect once neighbours are outside separationRadius', () => {
  const typeDef = CONFIG.enemies.types.shambler;
  const far = CONFIG.enemies.separationRadius + 5;
  const enemy = { x: 0, z: 0 };
  const target = { x: 100, z: 0 };
  const neighbours = [{ x: far, z: 0 }];
  const withFar = steer(enemy, target, neighbours, CONFIG, typeDef);
  const withNone = steer(enemy, target, [], CONFIG, typeDef);
  assert.ok(Math.abs(withFar.vx - withNone.vx) < 1e-9);
  assert.ok(Math.abs(withFar.vz - withNone.vz) < 1e-9);
});

test('attackReady gates on both cooldown and range', () => {
  const typeDef = CONFIG.enemies.types.shambler;
  assert.equal(attackReady({ cooldown: 0 }, typeDef.range - 0.1, typeDef), true);
  assert.equal(attackReady({ cooldown: 0 }, typeDef.range + 0.1, typeDef), false);
  assert.equal(attackReady({ cooldown: 0.5 }, typeDef.range - 0.1, typeDef), false);
});

test('tickCooldown decays linearly, floored at 0, and does not mutate the input', () => {
  const enemy = Object.freeze({ cooldown: 1 });
  assert.equal(tickCooldown(enemy, 0.4), 0.6);
  assert.equal(tickCooldown(enemy, 10), 0);
  assert.equal(enemy.cooldown, 1);
});

test('hpFor scales base hp by hpMul', () => {
  const typeDef = CONFIG.enemies.types.shambler;
  assert.equal(hpFor(typeDef, 1), typeDef.hp);
  assert.equal(hpFor(typeDef, 1.5), typeDef.hp * 1.5);
});

test('knockbackSpeed scales with damage, per-type resistance, and clamps', () => {
  const shambler = CONFIG.enemies.types.shambler;
  const tungtung = CONFIG.enemies.types.tungtung;
  const k = CONFIG.enemies.knockback;

  // A reference-damage hit lands exactly the reference impulse.
  assert.ok(Math.abs(knockbackSpeed(k.refDmg, shambler, CONFIG) - k.speed) < 1e-9);
  // Twice the damage, twice the shove.
  assert.ok(
    knockbackSpeed(k.refDmg * 2, shambler, CONFIG) >
      knockbackSpeed(k.refDmg, shambler, CONFIG),
  );
  // A heavy body barely budges compared to a light one taking the same hit.
  assert.ok(knockbackSpeed(k.refDmg, tungtung, CONFIG) < knockbackSpeed(k.refDmg, shambler, CONFIG));
  // Even a cannon shell can't launch anything past its type's cap.
  assert.ok(knockbackSpeed(1e6, shambler, CONFIG) <= k.maxSpeed * shambler.knockbackScale + 1e-9);
  assert.equal(knockbackSpeed(0, shambler, CONFIG), 0);
  assert.equal(knockbackSpeed(-50, shambler, CONFIG), 0);
});

test('decayKnockback shrinks the impulse and snaps to a dead stop', () => {
  const { vx, vz } = decayKnockback(6, 0, 1 / 60, CONFIG);
  assert.ok(vx > 0 && vx < 6);
  assert.equal(vz, 0);

  // Below stopSpeed it must reach exactly zero, never creep forever.
  const stopped = decayKnockback(CONFIG.enemies.knockback.stopSpeed * 0.5, 0, 1 / 60, CONFIG);
  assert.deepEqual(stopped, { vx: 0, vz: 0 });

  // And it does so within a fraction of a second of a full-strength hit.
  let v = { vx: CONFIG.enemies.knockback.maxSpeed, vz: 0 };
  let steps = 0;
  while ((v.vx !== 0 || v.vz !== 0) && steps < 600) {
    v = decayKnockback(v.vx, v.vz, 1 / 60, CONFIG);
    steps++;
  }
  assert.ok(steps / 60 < 0.6, `knockback lasted ${steps / 60}s`);
});

test('knockback intensity, tilt and stagger stay bounded and monotonic', () => {
  const shambler = CONFIG.enemies.types.shambler;
  const k = CONFIG.enemies.knockback;
  const max = k.maxSpeed * shambler.knockbackScale;

  assert.equal(knockbackIntensity(0, shambler, CONFIG), 0);
  assert.equal(knockbackIntensity(max * 10, shambler, CONFIG), 1);
  assert.equal(knockbackTilt(0, shambler, CONFIG), 0);
  assert.ok(Math.abs(knockbackTilt(max, shambler, CONFIG) - k.tiltRad) < 1e-9);

  // Untouched enemies keep all of their own steering; a shoved one loses most of it.
  assert.equal(staggerFactor(0, shambler, CONFIG), 1);
  assert.ok(Math.abs(staggerFactor(max, shambler, CONFIG) - (1 - k.staggerDamp)) < 1e-9);

  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const tilt = knockbackTilt((max * i) / 20, shambler, CONFIG);
    assert.ok(tilt >= prev, 'tilt must grow with the impulse');
    assert.ok(tilt >= 0 && tilt <= k.tiltRad + 1e-9);
    prev = tilt;
  }
});
