import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import {
  gatePositions,
  slotPositions,
  slotMapPositions,
  worldToMap,
  mapToWorld,
  clampToArena,
} from '../src/core/arenaGeometry.js';

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

test('slotMapPositions places every slot on the same map-unit radius, well outside the hub', () => {
  const slots = slotMapPositions(CONFIG);
  const expected = CONFIG.arena.slotRadius * (90 / CONFIG.arena.radius);
  assert.equal(slots.length, 9);
  for (const slot of slots) {
    const r = Math.hypot(slot.x, slot.z);
    assert.ok(Math.abs(r - expected) < 1e-9, `slot ${slot.id} map radius ${r}, expected ${expected}`);
  }
  // Guards the regression this function exists for: plotting raw world metres
  // put the slots at ~16 map units instead of ~55, a blob around the origin.
  assert.ok(expected > 40, `slots would render bunched at the map centre (radius ${expected})`);
});

test('slotMapPositions keeps same-gate slots far enough apart not to overlap', () => {
  const slots = slotMapPositions(CONFIG);
  // SLOT_VISUAL_R in BuildOverlay.js is 6 map units, so anything at or under
  // 12 apart draws as overlapping rings with unreadable stacked cost labels.
  const minGap = 2 * 6;
  for (const a of slots) {
    for (const b of slots) {
      if (a.id >= b.id) continue;
      const gap = Math.hypot(a.x - b.x, a.z - b.z);
      assert.ok(gap > minGap, `slots ${a.id} and ${b.id} are only ${gap} map units apart`);
    }
  }
});

test('slotMapPositions agrees with worldToMap applied to slotPositions', () => {
  const world = slotPositions(CONFIG);
  const mapped = slotMapPositions(CONFIG);
  assert.equal(world.length, mapped.length);
  for (let i = 0; i < world.length; i++) {
    const expected = worldToMap(world[i].x, world[i].z, CONFIG);
    assert.equal(mapped[i].id, world[i].id);
    assert.equal(mapped[i].gateId, world[i].gateId);
    assert.equal(mapped[i].angleDeg, world[i].angleDeg);
    assert.ok(Math.abs(mapped[i].x - expected.x) < 1e-9);
    assert.ok(Math.abs(mapped[i].z - expected.z) < 1e-9);
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
