import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { sanitizePrefs, effectiveSens, DEFAULT_PREFS, SENS_MIN, SENS_MAX } from '../src/core/prefs.js';

test('sanitizePrefs returns the defaults for anything unusable', () => {
  for (const raw of [null, undefined, 0, '', 'nonsense', [], NaN, true]) {
    assert.deepEqual(sanitizePrefs(raw), { ...DEFAULT_PREFS });
  }
});

test('sanitizePrefs keeps valid values and fills the rest from defaults', () => {
  const p = sanitizePrefs({ invertY: true, sensMouse: 1.5 });
  assert.equal(p.invertY, true);
  assert.equal(p.sensMouse, 1.5);
  assert.equal(p.sensTouch, null);
  assert.equal(p.showFps, false);
  assert.equal(p.weapon, null);
});

test('sanitizePrefs clamps sensitivity into range', () => {
  assert.equal(sanitizePrefs({ sensMouse: 99 }).sensMouse, SENS_MAX);
  assert.equal(sanitizePrefs({ sensMouse: -4 }).sensMouse, SENS_MIN);
  assert.equal(sanitizePrefs({ sensTouch: 0 }).sensTouch, SENS_MIN);
});

test('sanitizePrefs rejects non-finite and non-numeric sensitivities', () => {
  for (const bad of [NaN, Infinity, -Infinity, '2', null, {}]) {
    assert.equal(sanitizePrefs({ sensMouse: bad }).sensMouse, null, `accepted ${String(bad)}`);
  }
});

test('sanitizePrefs coerces the booleans strictly', () => {
  // Only a literal `true` counts — a truthy string from a hand-edited value
  // should not silently enable a setting.
  assert.equal(sanitizePrefs({ invertY: 'yes' }).invertY, false);
  assert.equal(sanitizePrefs({ invertY: 1 }).invertY, false);
  assert.equal(sanitizePrefs({ showFps: true }).showFps, true);
});

test('sanitizePrefs only guarantees the weapon is a non-empty string', () => {
  assert.equal(sanitizePrefs({ weapon: 'm82' }).weapon, 'm82');
  assert.equal(sanitizePrefs({ weapon: '' }).weapon, null);
  assert.equal(sanitizePrefs({ weapon: 7 }).weapon, null);
  // Validity against the roster is `core/weapons.js#coerceWeaponId`'s job.
  assert.equal(sanitizePrefs({ weapon: 'bfg9000' }).weapon, 'bfg9000');
});

test('sanitizePrefs output round-trips through itself unchanged', () => {
  const once = sanitizePrefs({ sensMouse: 2, invertY: true, weapon: 'ak47' });
  assert.deepEqual(sanitizePrefs(once), once);
});

test('sanitizePrefs never leaks unknown keys through', () => {
  const p = sanitizePrefs({ evil: 1, __proto__: { x: 2 } });
  assert.deepEqual(Object.keys(p).sort(), Object.keys(DEFAULT_PREFS).sort());
});

test('effectiveSens falls back to the configured base when unset', () => {
  const base = CONFIG.player.lookSensMouse;
  assert.equal(effectiveSens(null, base), base);
  assert.equal(effectiveSens(2, base), base * 2);
  assert.equal(effectiveSens(0.5, base), base * 0.5);
});
