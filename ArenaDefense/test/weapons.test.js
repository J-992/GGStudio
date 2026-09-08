import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { weaponIds, resolveWeapon, coerceWeaponId, nextWeapon, spreadDirs } from '../src/core/weapons.js';

const DEG2RAD = Math.PI / 180;

/** A deterministic stand-in for `Math.random`, cycling a fixed sequence. */
function seededRand(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function angleBetweenDeg(a, b) {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.min(1, Math.max(-1, dot))) / DEG2RAD;
}

test('every weapon in `order` has a def with the keys the firing path reads', () => {
  const ids = weaponIds(CONFIG);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length, 'weapon ids must be unique');

  for (const id of ids) {
    const w = resolveWeapon(id, CONFIG);
    assert.ok(w, `${id} is in order but has no def`);
    for (const key of ['name', 'dmg', 'rate', 'range', 'spreadDeg', 'pellets', 'coneDegTouch', 'model', 'color', 'sound', 'recoil']) {
      assert.ok(w[key] !== undefined, `${id} is missing ${key}`);
    }
    for (const key of ['impulse', 'viewBackM', 'viewUpM', 'viewPitchDeg', 'camPitchDeg']) {
      assert.ok(typeof w.recoil[key] === 'number', `${id}.recoil is missing ${key}`);
    }
    // The spring peaks at ~1.0 per shot only because every weapon shares the
    // normalized impulse; a per-weapon value would hit `maxValue`'s clamp and
    // count the weapon's heft twice. Heft belongs in the amplitudes.
    assert.equal(w.recoil.impulse, 46.5, `${id}.recoil.impulse must stay normalized`);
    // Camera punch must stay well inside the aim cone, or a burst walks the
    // view off the target the player was pointing at.
    assert.ok(
      w.recoil.camPitchDeg < w.coneDegTouch * 0.5,
      `${id}'s camera punch (${w.recoil.camPitchDeg}deg) is too large for its ${w.coneDegTouch}deg cone`,
    );
    assert.ok(w.dmg > 0 && w.rate > 0 && w.range > 0, `${id} has a non-positive core stat`);
    assert.ok(Number.isInteger(w.pellets) && w.pellets >= 1, `${id}.pellets must be a positive integer`);
    assert.ok(w.spreadDeg >= 0, `${id}.spreadDeg must not be negative`);
  }
});

test('`types` holds nothing that `order` does not list', () => {
  assert.deepEqual(
    Object.keys(CONFIG.player.weapons.types).sort(),
    [...weaponIds(CONFIG)].sort(),
  );
});

test('the default weapon is a real weapon', () => {
  assert.ok(resolveWeapon(CONFIG.player.defaultWeapon, CONFIG));
});

test('resolveWeapon rejects unknown ids rather than throwing', () => {
  assert.equal(resolveWeapon('bfg9000', CONFIG), null);
  assert.equal(resolveWeapon('', CONFIG), null);
  assert.equal(resolveWeapon(undefined, CONFIG), null);
});

test('coerceWeaponId falls back to the default for anything invalid', () => {
  const fallback = CONFIG.player.defaultWeapon;
  assert.equal(coerceWeaponId('bfg9000', CONFIG), fallback);
  assert.equal(coerceWeaponId(null, CONFIG), fallback);
  assert.equal(coerceWeaponId('m82', CONFIG), 'm82');
});

test('nextWeapon steps through order and wraps both ways', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(nextWeapon('a', order, 1), 'b');
  assert.equal(nextWeapon('c', order, 1), 'a');
  assert.equal(nextWeapon('a', order, -1), 'c');
  assert.equal(nextWeapon('a', order, 0), 'a');
  assert.equal(nextWeapon('nope', order, 1), 'a', 'an unknown id starts from the top');
});

test('spreadDirs returns one unit vector per pellet', () => {
  const dirs = spreadDirs({ x: 0, y: 0, z: -1 }, 9, 9, seededRand([0.1, 0.4, 0.7, 0.9]));
  assert.equal(dirs.length, 9);
  for (const d of dirs) {
    assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);
  }
});

test('spreadDirs keeps every pellet inside the cone', () => {
  const aim = { x: 0.3, y: -0.2, z: -0.9 };
  const len = Math.hypot(aim.x, aim.y, aim.z);
  const unitAim = { x: aim.x / len, y: aim.y / len, z: aim.z / len };
  const rand = () => Math.random();

  for (const spreadDeg of [1, 3, 9, 20]) {
    for (let i = 0; i < 200; i++) {
      const [d] = spreadDirs(aim, spreadDeg, 1, rand);
      // 1e-9 slack for the float round-trip through normalise().
      assert.ok(
        angleBetweenDeg(unitAim, d) <= spreadDeg + 1e-9,
        `pellet escaped a ${spreadDeg} deg cone`,
      );
    }
  }
});

test('spreadDirs with zero spread returns the aim direction exactly', () => {
  const dirs = spreadDirs({ x: 0, y: 0, z: -2 }, 0, 3, () => 0.5);
  for (const d of dirs) {
    assert.ok(Math.abs(d.x) < 1e-12 && Math.abs(d.y) < 1e-12);
    assert.ok(Math.abs(d.z + 1) < 1e-12, 'should be the normalised aim direction');
  }
});

test('spreadDirs is deterministic for a given rand sequence', () => {
  const seq = [0.11, 0.22, 0.33, 0.44, 0.55, 0.66];
  const a = spreadDirs({ x: 1, y: 0, z: 0 }, 5, 3, seededRand(seq));
  const b = spreadDirs({ x: 1, y: 0, z: 0 }, 5, 3, seededRand(seq));
  assert.deepEqual(a, b);
});

test('spreadDirs handles an aim direction parallel to the basis reference axis', () => {
  // Straight up is the case that makes a naive cross product degenerate.
  for (const aim of [{ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }]) {
    const dirs = spreadDirs(aim, 5, 4, () => 0.5);
    for (const d of dirs) {
      assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z));
      assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);
      assert.ok(angleBetweenDeg(aim, d) <= 5 + 1e-9);
    }
  }
});
