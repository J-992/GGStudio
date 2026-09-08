import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import {
  createRecoilSpring,
  kickRecoilSpring,
  resetRecoilSpring,
  stepRecoilSpring,
} from '../src/core/recoil.js';

const STEP = CONFIG.timing.fixedStep;
// The spring's own constants are shared by every weapon; the amplitudes it
// drives are per-weapon. These tests exercise the spring against the default
// weapon, which is the one its impulse was normalized against.
const SPRING = CONFIG.player.recoil;
const BASE_WEAPON = CONFIG.player.weapons.types[CONFIG.player.defaultWeapon];
const RECOIL = { ...SPRING, ...BASE_WEAPON.recoil };

/** Steps `spring` for `seconds`, kicking every `1/rate` seconds when `rate` is given. */
function simulate(spring, seconds, rate = 0) {
  const framesPerShot = rate > 0 ? Math.round(1 / (rate * STEP)) : 0;
  let peak = 0;
  const frames = Math.round(seconds / STEP);
  for (let f = 0; f < frames; f++) {
    if (framesPerShot > 0 && f % framesPerShot === 0) kickRecoilSpring(spring, RECOIL.impulse);
    stepRecoilSpring(spring, STEP, CONFIG);
    peak = Math.max(peak, spring.value);
  }
  return peak;
}

test('a fresh spring is at exact rest', () => {
  assert.deepEqual(createRecoilSpring(), { value: 0, velocity: 0 });
});

test('one shot reads as a punch: ramps in, peaks near 1, then settles to exactly 0', () => {
  const s = createRecoilSpring();
  kickRecoilSpring(s, RECOIL.impulse);

  // A velocity impulse must ramp in rather than pop: the first frame is well
  // short of the peak. This is the difference between a kick and a jump cut.
  stepRecoilSpring(s, STEP, CONFIG);
  const firstFrame = s.value;

  const peak = Math.max(firstFrame, simulate(s, 0.5));
  assert.ok(peak > 0.85 && peak < 1.2, `single-shot peak ${peak} is not normalized to ~1`);
  assert.ok(firstFrame < peak * 0.6, `no ramp-in: first frame ${firstFrame} vs peak ${peak}`);

  // Settled to *exactly* rest, so the viewmodel parks on its base transform
  // instead of hovering a hair off it forever. The visible motion is over far
  // sooner — under 0.25 deg of view pitch by 0.4s — but the tail takes ~1s to
  // cross SETTLE_EPS, so allow 1.5s here.
  simulate(s, 1);
  assert.equal(s.value, 0);
  assert.equal(s.velocity, 0);
});

test('critically damped: a single shot never dips below rest on the way back', () => {
  // The camera pitch offset is this same value. Overshooting past 0 would
  // swing the view *below* where the player aimed — the thing that makes
  // recoil nauseating rather than punchy.
  const s = createRecoilSpring();
  kickRecoilSpring(s, RECOIL.impulse);
  for (let f = 0; f < 60; f++) {
    stepRecoilSpring(s, STEP, CONFIG);
    assert.ok(s.value >= 0, `undershot to ${s.value} at frame ${f}`);
  }
});

test('sustained fire stacks, then plateaus below maxValue', () => {
  const s = createRecoilSpring();
  const peak = simulate(s, 10, BASE_WEAPON.rate);
  assert.ok(peak > 1.15, `sustained peak ${peak} shows no stacking over a single shot`);
  assert.ok(peak <= RECOIL.maxValue, `sustained peak ${peak} exceeded maxValue ${RECOIL.maxValue}`);
  // Headroom: the plateau should sit under the clamp rather than riding it,
  // so the kick stays a spring and does not flat-top into a square wave.
  assert.ok(peak < RECOIL.maxValue * 0.95, `sustained peak ${peak} is riding the maxValue rail`);
});

test('the camera punch stays a small fraction of the touch auto-fire cone', () => {
  // Recoil offsets the rendered camera only — `Player#_aimDirection` derives
  // aim from yaw/pitch — so this is a readability bound, not a correctness
  // one: a punch far larger than the cone would read as a camera spasm.
  const s = createRecoilSpring();
  const peakDeg = simulate(s, 10, BASE_WEAPON.rate) * RECOIL.camPitchDeg;
  assert.ok(peakDeg < BASE_WEAPON.coneDegTouch * 0.5, `camera punch ${peakDeg}deg is too large`);
});

test('a long dt stays finite and bounded, and the spring recovers afterwards', () => {
  // `Game#_fixedStep` only ever passes `timing.fixedStep`, but the sub-step
  // cap means a pathological dt must saturate at the clamp rather than
  // diverge — and must not latch there.
  const s = createRecoilSpring();
  kickRecoilSpring(s, RECOIL.impulse);
  stepRecoilSpring(s, 1, CONFIG);
  assert.ok(Number.isFinite(s.value) && Number.isFinite(s.velocity), 'spring diverged');
  assert.ok(Math.abs(s.value) <= RECOIL.maxValue, `value ${s.value} escaped maxValue`);

  simulate(s, 1.5);
  assert.equal(s.value, 0, 'spring latched instead of recovering');
});

test('a non-positive dt is a no-op', () => {
  const s = createRecoilSpring();
  kickRecoilSpring(s, RECOIL.impulse);
  stepRecoilSpring(s, 0, CONFIG);
  stepRecoilSpring(s, -STEP, CONFIG);
  assert.equal(s.value, 0);
  assert.equal(s.velocity, RECOIL.impulse);
});

test('a negative impulse mirrors a positive one exactly', () => {
  const up = createRecoilSpring();
  const down = createRecoilSpring();
  kickRecoilSpring(up, RECOIL.impulse);
  kickRecoilSpring(down, -RECOIL.impulse);
  for (let f = 0; f < 40; f++) {
    stepRecoilSpring(up, STEP, CONFIG);
    stepRecoilSpring(down, STEP, CONFIG);
    assert.ok(Math.abs(up.value + down.value) < 1e-12, `asymmetry at frame ${f}`);
  }
});

test('resetRecoilSpring clears velocity as well as value', () => {
  // Clearing only `value` would leave stored velocity to kick the gun on the
  // first frame of a fresh run.
  const s = createRecoilSpring();
  kickRecoilSpring(s, RECOIL.impulse);
  stepRecoilSpring(s, STEP, CONFIG);
  assert.notEqual(s.value, 0);

  resetRecoilSpring(s);
  assert.deepEqual(s, { value: 0, velocity: 0 });
  stepRecoilSpring(s, STEP, CONFIG);
  assert.deepEqual(s, { value: 0, velocity: 0 });
});
