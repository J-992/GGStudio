import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readJoystick, clampStickOffset, DEFAULT_JOYSTICK_CONFIG } from '../src/core/joystick.js';

test('inside the deadzone reads as neutral', () => {
  const { deadzone, radiusPx } = DEFAULT_JOYSTICK_CONFIG;
  const v = readJoystick(0, 0, deadzone * radiusPx * 0.5, 0);
  assert.equal(v.active, false);
  assert.equal(v.magnitude, 0);
  assert.equal(v.x, 0);
  assert.equal(v.y, 0);
});

test('deadzone is rescaled away rather than merely offset', () => {
  const { deadzone, radiusPx } = DEFAULT_JOYSTICK_CONFIG;
  // Just past the deadzone: magnitude should be small, not jump.
  const justPast = readJoystick(0, 0, (deadzone + 0.001) * radiusPx, 0);
  assert.ok(justPast.magnitude > 0 && justPast.magnitude < 0.05, `magnitude ${justPast.magnitude}`);
});

test('at or beyond saturation, magnitude saturates to exactly 1', () => {
  const { saturation, radiusPx } = DEFAULT_JOYSTICK_CONFIG;
  const atSat = readJoystick(0, 0, saturation * radiusPx, 0);
  assert.equal(atSat.magnitude, 1);
  const beyond = readJoystick(0, 0, radiusPx * 5, 0);
  assert.equal(beyond.magnitude, 1);
});

test('direction: rightward pointer travel gives positive x, zero y', () => {
  const v = readJoystick(0, 0, DEFAULT_JOYSTICK_CONFIG.radiusPx, 0);
  assert.ok(v.x > 0.9);
  assert.ok(Math.abs(v.y) < 1e-9);
});

test('direction: upward (screen -y) pointer travel gives positive y (already flipped)', () => {
  const v = readJoystick(0, 0, 0, -DEFAULT_JOYSTICK_CONFIG.radiusPx);
  assert.ok(v.y > 0.9);
  assert.ok(Math.abs(v.x) < 1e-9);
});

test('non-finite input returns the neutral reading', () => {
  const v = readJoystick(0, 0, NaN, 0);
  assert.equal(v.active, false);
  assert.equal(v.magnitude, 0);
});

test('clampStickOffset leaves points inside the radius untouched', () => {
  const p = clampStickOffset(0, 0, 10, 10, 56);
  assert.deepEqual(p, { x: 10, y: 10 });
});

test('clampStickOffset pins points beyond the radius to the rim', () => {
  const p = clampStickOffset(0, 0, 200, 0, 56);
  assert.ok(Math.abs(p.x - 56) < 1e-9);
  assert.ok(Math.abs(p.y) < 1e-9);
  assert.ok(Math.abs(Math.hypot(p.x, p.y) - 56) < 1e-9);
});
