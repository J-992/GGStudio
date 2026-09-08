import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { gatePositions, slotPositions, worldToMap, mapToWorld, clampToArena } from '../src/core/arenaGeometry.js';

/** Smallest angular distance between two angles in degrees, 0..180. */
function angleDist(a, b) {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

test('gatePositions returns one entry per configured gate angle', () => {
  const gates = gatePositions(CONFIG);
  assert.equal(gates.length, CONFIG.arena.gateAngles.length);
  for (const gate of gates) {
    assert.ok(Number.isFinite(gate.x));
    assert.ok(Number.isFinite(gate.z));
    assert.ok(Math.abs(Math.hypot(gate.x, gate.z) - CONFIG.arena.gateRadius) < 1e-9);
  }
});

test('slotPositions returns exactly 9 slots, all at slotRadius', () => {
  const slots = slotPositions(CONFIG);
  assert.equal(slots.length, 9);
  for (const slot of slots) {
    const r = Math.hypot(slot.x, slot.z);
    assert.ok(Math.abs(r - CONFIG.arena.slotRadius) < 1e-9, `slot ${slot.id} radius ${r}`);
  }
});

test('no slot sits within ±gateWidth degrees of any gate angle', () => {
  const slots = slotPositions(CONFIG);
  const gateAngles = CONFIG.arena.gateAngles;
  for (const slot of slots) {
    for (const gateAngle of gateAngles) {
      const d = angleDist(slot.angleDeg, gateAngle);
      assert.ok(
        d > CONFIG.arena.gateWidth,
        `slot ${slot.id} at ${slot.angleDeg}deg is only ${d}deg from gate at ${gateAngle}deg`,
      );
    }
  }
});

test('worldToMap / mapToWorld round-trip', () => {
  const points = [[0, 0], [10, -5], [-26, 26], [3.14159, -2.71828]];
  for (const [x, z] of points) {
    const mapped = worldToMap(x, z, CONFIG);
    const back = mapToWorld(mapped.x, mapped.z, CONFIG);
    assert.ok(Math.abs(back.x - x) < 1e-9, `x round-trip: ${back.x} vs ${x}`);
    assert.ok(Math.abs(back.z - z) < 1e-9, `z round-trip: ${back.z} vs ${z}`);
  }
});

test('worldToMap scales the arena radius to 90 map units', () => {
  const mapped = worldToMap(CONFIG.arena.radius, 0, CONFIG);
  assert.ok(Math.abs(mapped.x - 90) < 1e-9);
});

test('clampToArena leaves interior points untouched', () => {
  const p = clampToArena(1, 1, 10);
  assert.deepEqual(p, { x: 1, z: 1 });
});

test('clampToArena projects exterior points onto the circle boundary', () => {
  const p = clampToArena(20, 0, 10);
  assert.ok(Math.abs(p.x - 10) < 1e-9);
  assert.ok(Math.abs(p.z) < 1e-9);
  assert.ok(Math.abs(Math.hypot(p.x, p.z) - 10) < 1e-9);
});
