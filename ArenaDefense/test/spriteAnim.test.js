import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { bob, castRaise, hitFlash, hitSquash } from '../src/core/spriteAnim.js';

test('bob stays within cfg.sprites bounds across many t/speed samples', () => {
  const { bobAmp, squash } = CONFIG.sprites;
  for (let i = 0; i < 200; i++) {
    const t = i * 0.037;
    const speed = (i % 5) * 1.3;
    const { y, sx, sy } = bob(t, speed, CONFIG);
    assert.ok(y >= -bobAmp - 1e-9 && y <= bobAmp + 1e-9, `y=${y} out of bounds at t=${t}`);
    assert.ok(sx >= 1 - squash - 1e-9 && sx <= 1 + squash + 1e-9, `sx=${sx} out of bounds`);
    assert.ok(sy >= 1 - squash - 1e-9 && sy <= 1 + squash + 1e-9, `sy=${sy} out of bounds`);
  }
});

test('bob with speed 0 does not bob', () => {
  const { y } = bob(5, 0, CONFIG);
  assert.ok(Math.abs(y) < 1e-9);
});

test('castRaise runs from 1 at progress=0 to 1.35 at progress=1, staying in range', () => {
  assert.ok(Math.abs(castRaise(0) - 1) < 1e-9);
  assert.ok(Math.abs(castRaise(1) - 1.35) < 1e-9);
  for (let i = 0; i <= 20; i++) {
    const p = i / 20;
    const scale = castRaise(p);
    assert.ok(scale >= 1 - 1e-9 && scale <= 1.35 + 1e-9, `scale=${scale} at progress=${p}`);
  }
});

test('castRaise clamps progress outside [0, 1]', () => {
  assert.ok(Math.abs(castRaise(-1) - 1) < 1e-9);
  assert.ok(Math.abs(castRaise(2) - 1.35) < 1e-9);
});

test('hitFlash decays from 1 to 0 over flashS and stays clamped', () => {
  const { flashS } = CONFIG.sprites;
  assert.ok(Math.abs(hitFlash(0, CONFIG) - 1) < 1e-9);
  assert.ok(Math.abs(hitFlash(flashS, CONFIG) - 0) < 1e-9);
  assert.ok(Math.abs(hitFlash(flashS / 2, CONFIG) - 0.5) < 1e-9);
  assert.equal(hitFlash(flashS * 10, CONFIG), 0);
  assert.equal(hitFlash(-1, CONFIG), 1);
});

test('hitSquash flattens and widens with intensity, and is neutral at rest', () => {
  const { squash } = CONFIG.enemies.knockback;
  assert.deepEqual(hitSquash(0, CONFIG), { sx: 1, sy: 1 });

  const full = hitSquash(1, CONFIG);
  assert.ok(Math.abs(full.sx - (1 + squash)) < 1e-9);
  assert.ok(Math.abs(full.sy - (1 - squash)) < 1e-9);

  // Out-of-range intensities clamp instead of turning the body inside out.
  assert.deepEqual(hitSquash(5, CONFIG), full);
  assert.deepEqual(hitSquash(-1, CONFIG), { sx: 1, sy: 1 });
});
