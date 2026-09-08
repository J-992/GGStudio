import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import {
  gatePositions, slotPositions, slotMapPositions, worldToMap, mapToWorld, clampToArena,
  rayArenaHit,
} from '../src/core/arenaGeometry.js';

// `ui/BuildOverlay.js`'s `SLOT_VISUAL_R` — mirrored here because that module
// touches the DOM and can't be imported under `node --test`.
const SLOT_VISUAL_R = 6;

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

const EYE = { x: 0, y: CONFIG.player.eyeHeight, z: 0 };
const FAR = CONFIG.arena.radius * 4;

test('rayArenaHit: a shot straight down lands on the floor under the shooter', () => {
  const hit = rayArenaHit(EYE, { x: 0, y: -1, z: 0 }, FAR, CONFIG);
  assert.equal(hit.surface, 'ground');
  assert.equal(hit.y, 0);
  assert.ok(Math.abs(hit.x) < 1e-9 && Math.abs(hit.z) < 1e-9);
  assert.ok(Math.abs(hit.dist - CONFIG.player.eyeHeight) < 1e-9);
});

test('rayArenaHit: a level shot lands on the wall at the arena radius', () => {
  for (const dir of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: -0.6, y: 0, z: 0.8 }]) {
    const hit = rayArenaHit(EYE, dir, FAR, CONFIG);
    assert.equal(hit.surface, 'wall');
    assert.ok(Math.abs(Math.hypot(hit.x, hit.z) - CONFIG.arena.radius) < 1e-9);
    assert.ok(Math.abs(hit.y - CONFIG.player.eyeHeight) < 1e-9);
  }
});

test('rayArenaHit: a shot angled over the wall top hits nothing', () => {
  assert.equal(rayArenaHit(EYE, { x: 0, y: 1, z: 0 }, FAR, CONFIG), null);
  // Rises past `wallHeight` before reaching the wall, so neither surface is hit.
  assert.equal(rayArenaHit(EYE, { x: 0.2, y: 1, z: 0 }, FAR, CONFIG), null);
});

test('rayArenaHit: hits beyond maxDist are discarded', () => {
  const near = CONFIG.player.eyeHeight * 0.5;
  assert.equal(rayArenaHit(EYE, { x: 0, y: -1, z: 0 }, near, CONFIG), null);
  assert.equal(rayArenaHit(EYE, { x: 1, y: 0, z: 0 }, CONFIG.arena.radius - 1, CONFIG), null);
});

test('rayArenaHit: the nearer of floor and wall wins', () => {
  // Steeply down and outward from near the wall: the floor comes first.
  const origin = { x: CONFIG.arena.radius - 2, y: CONFIG.player.eyeHeight, z: 0 };
  const hit = rayArenaHit(origin, { x: 1, y: -4, z: 0 }, FAR, CONFIG);
  assert.equal(hit.surface, 'ground');
  assert.ok(Math.hypot(hit.x, hit.z) <= CONFIG.arena.radius);
});

test('rayArenaHit: every shot from inside the arena that is not angled upward lands somewhere', () => {
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const hit = rayArenaHit(EYE, { x: Math.sin(a), y: -0.2, z: Math.cos(a) }, FAR, CONFIG);
    assert.ok(hit, `no hit at angle ${a}`);
    assert.ok(hit.dist > 0);
  }
});

test('slotMapPositions puts every slot at the map-unit slot radius', () => {
  const expected = (90 * CONFIG.arena.slotRadius) / CONFIG.arena.radius;
  for (const slot of slotMapPositions(CONFIG)) {
    const r = Math.hypot(slot.x, slot.z);
    assert.ok(Math.abs(r - expected) < 1e-9, `slot ${slot.id} map radius ${r}, expected ${expected}`);
  }
});

test('slot markers never overlap on the build map', () => {
  // The build overlay draws each slot as a circle of `SLOT_VISUAL_R` map
  // units, so two slot centres closer together than one diameter would draw
  // markers on top of each other. Feeding raw world metres into the map's
  // viewBox (the bug this guards) collapses the 3 slots of a gate to ~5.6
  // units apart, well inside that.
  const slots = slotMapPositions(CONFIG);
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const d = Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z);
      assert.ok(
        d > 2 * SLOT_VISUAL_R,
        `slots ${slots[i].id} and ${slots[j].id} are only ${d.toFixed(2)} map units apart`,
      );
    }
  }
});
