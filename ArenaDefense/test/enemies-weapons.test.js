// `Enemies` normally needs a real `assets.js` (a loaded GLTF) to build its
// two voxel `InstancedMesh`es, which is out of reach for `node --test` (see
// `AGENTS.md`). But `instanceSource()` only ever hands back a plain
// `{geometry, material, localMatrix}` triple, so a stub assets object that
// returns bare three.js primitives for `zed_1`/`zed_3` is enough to
// construct and tick the whole thing headlessly — same idea as
// `test/projectiles.test.js`'s stubbing of `Projectiles`' collaborators.
//
// This exists to cover the seam the brief calls out: an armed shambler's
// resolved `EnemyTypeDef` must have `kind: 'ranged'` (so `_performAttack`
// picks `_spawnProjectile` over a melee hit) and the tier's `dmg`/
// `cooldown`/`projSpeed`/`range`, not just a colour — the kind of thing a
// syntax check and a build can both pass while being wrong at runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CONFIG } from '../src/config.js';
import { Enemies } from '../src/game/Enemies.js';

function makeAssets() {
  const source = () => ({
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: new THREE.MeshBasicMaterial(),
    localMatrix: new THREE.Matrix4(),
  });
  return { instanceSource: () => source() };
}

function makeBillboards() {
  return { alloc: () => -1, free() {}, set() {}, update() {} };
}

function makeBus() {
  return { emit() {} };
}

function makeAudio() {
  return { play() {} };
}

function makeEnemies() {
  return new Enemies(new THREE.Scene(), makeAssets(), CONFIG, makeBus(), makeBillboards(), makeAudio());
}

/** A `world` with the collaborators `Enemies#update` reaches for. */
function makeWorld(overrides = {}) {
  return {
    time: 0,
    player: { x: 0, z: 0, takeDamage() {} },
    turrets: { list: () => [], damage() {} },
    effects: { burst() {} },
    ...overrides,
  };
}

test('constructs and ticks with nothing spawned', () => {
  const e = makeEnemies();
  const world = makeWorld();
  for (let i = 0; i < 10; i++) e.update(1 / 60, world);
});

test('an unarmed shambler resolves to the base melee def', () => {
  const e = makeEnemies();
  const idx = e.spawn('shambler', 0, 1, 'normal', 20, false);
  assert.notEqual(idx, -1);
  const typeDef = e._typeDefAt(idx);
  assert.equal(typeDef.kind, 'melee');
  assert.equal(typeDef.armed, undefined);
});

test('an armed shambler resolves to the wave-appropriate ranged tier', () => {
  const e = makeEnemies();
  // Wave 12 -> 'smg' per cfg.enemies.weapons.tiers (from: 12).
  const idx = e.spawn('shambler', 0, 1, 'normal', 12, true);
  const typeDef = e._typeDefAt(idx);
  const smg = CONFIG.enemies.weapons.tiers.find((t) => t.id === 'smg');
  assert.equal(typeDef.kind, 'ranged');
  assert.equal(typeDef.armed, true);
  assert.equal(typeDef.dmg, smg.dmg);
  assert.equal(typeDef.cooldown, smg.cooldown);
  assert.equal(typeDef.projSpeed, smg.projSpeed);
  assert.equal(typeDef.range, smg.range);
  assert.equal(typeDef.weaponColor, smg.color);
  // hp/speed/energy stay the base shambler's — arming must not be a
  // backdoor stat buff, and must not change what killing it is worth.
  assert.equal(typeDef.hp, CONFIG.enemies.types.shambler.hp);
  assert.equal(typeDef.energy, CONFIG.enemies.types.shambler.energy);
});

test('spitter is weapon-tier-driven even with armed left false', () => {
  const e = makeEnemies();
  const idx = e.spawn('spitter', 0, 1, 'normal', 1, false);
  const typeDef = e._typeDefAt(idx);
  const scrap = CONFIG.enemies.weapons.tiers.find((t) => t.id === 'scrap');
  assert.equal(typeDef.armed, true);
  assert.equal(typeDef.dmg, scrap.dmg);
});

test('an armed enemy in range fires a projectile from its gun, not its chest', () => {
  const e = makeEnemies();
  const world = makeWorld({ player: { x: 5, z: 0, takeDamage() {} } });
  const idx = e.spawn('spitter', 0, 1, 'normal', 1, false);
  e._x[idx] = 0;
  e._z[idx] = 0;
  e._yaw[idx] = 0; // forward = -z
  e._cooldown[idx] = 0;

  for (let i = 0; i < 5; i++) {
    world.time += 1 / 60;
    e.update(1 / 60, world);
  }

  assert.ok(e._projActive[0] === 1 || e._projActive.some((a) => a === 1), 'a shot should be in flight');
  const hold = CONFIG.enemies.weapons.hold;
  const shotIdx = e._projActive.findIndex((a) => a === 1);
  assert.ok(shotIdx >= 0);
  // Origin should be offset from the body centre by roughly the hold
  // config, not sitting dead-centre at (0, hitHeight/2, 0).
  assert.ok(Math.abs(e._projY[shotIdx] - hold.height) < 1e-6, 'muzzle height, not chest height');
  assert.notEqual(e._projX[shotIdx], 0, 'muzzle should be forward/side-offset from body centre');
});

// `Matrix4#decompose` doesn't extract a clean (0,0,0) scale back out of a
// zero-scale matrix (it falls back to 1 to avoid dividing by a zero column
// length), so compare `ZERO_SCALE`'s own elements directly instead — the
// same matrix every other pooled mesh in this file hides an instance with.
function isZeroScaled(mesh, idx) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(idx, m);
  return m.equals(new THREE.Matrix4().makeScale(0, 0, 0));
}

test('a dead armed enemy leaves no gun instance behind', () => {
  const e = makeEnemies();
  const idx = e.spawn('shambler', 0, 1, 'normal', 12, true);
  e.damageAt(idx, 1e6, 'player');
  assert.equal(e.alive, 0);
  assert.ok(isZeroScaled(e._gunMesh, idx), 'dead enemy gun instance should be zero-scaled');
});

test('clear() drops every gun instance', () => {
  const e = makeEnemies();
  e.spawn('shambler', 0, 1, 'normal', 12, true);
  e.spawn('spitter', 1, 1, 'normal', 1, false);
  e.update(1 / 60, makeWorld());
  e.clear();
  for (let i = 0; i < CONFIG.enemies.cap; i++) {
    assert.ok(isZeroScaled(e._gunMesh, i), `gun instance ${i} should be zero-scaled after clear()`);
  }
});

test('exactly one gun draw call backs every tier and both armed types', () => {
  const e = makeEnemies();
  assert.equal(e._gunMesh.isInstancedMesh, true);
  assert.equal(e._gunMesh.count, CONFIG.enemies.cap);
});
