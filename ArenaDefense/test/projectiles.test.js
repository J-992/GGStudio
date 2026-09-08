// `src/game/` is normally out of reach for `node --test` — those modules need
// a renderer, a DOM, or both. `Projectiles` is the exception worth taking:
// it only ever builds an `InstancedMesh` and does maths on typed arrays, so
// it constructs and ticks headlessly with no WebGL context.
//
// That is worth a test because this system is registered unconditionally in
// `Game`'s constructor and runs every fixed step from boot, so a fault in it
// is not an edge case — it takes the whole game down on the first frame. An
// out-of-scope variable in `update()` did exactly that, and passed
// `node --check`, the unit suite and a build, because a `ReferenceError` is
// only raised when the line actually runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CONFIG } from '../src/config.js';
import { Projectiles } from '../src/game/Projectiles.js';

const RPG = CONFIG.player.weapons.types.rpg7;

/** A `world` with the collaborators `Projectiles#update` reaches for. */
function makeWorld(overrides = {}) {
  return {
    enemies: null,
    boss: null,
    effects: { burst() {} },
    time: 0,
    ...overrides,
  };
}

function makeProjectiles() {
  return new Projectiles(new THREE.Scene(), CONFIG, { play() {} });
}

test('constructs and ticks with nothing in flight', () => {
  const p = makeProjectiles();
  const world = makeWorld();
  for (let i = 0; i < 10; i++) p.update(1 / 60, world);
});

test('a launched rocket detonates rather than travelling forever', () => {
  const bursts = [];
  const sounds = [];
  const p = new Projectiles(new THREE.Scene(), CONFIG, { play: (n) => sounds.push(n) });
  const world = makeWorld({ effects: { burst: (x, y, z) => bursts.push({ x, y, z }) } });

  // Fired level from the arena centre, so the wall is the only thing it can
  // reach — 26 m at 30 m/s is under a second of flight.
  p.launch(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(1, 0, 0), RPG);
  for (let i = 0; i < 120; i++) {
    world.time += 1 / 60;
    p.update(1 / 60, world);
  }

  assert.equal(bursts.length, 1, 'should detonate exactly once');
  assert.ok(
    Math.abs(Math.hypot(bursts[0].x, bursts[0].z) - CONFIG.arena.radius) < 1,
    'should detonate at the arena wall',
  );
  assert.deepEqual(sounds, [RPG.sound]);
});

test('a rocket fired at the floor detonates on the floor', () => {
  const bursts = [];
  const p = makeProjectiles();
  const world = makeWorld({ effects: { burst: (x, y, z) => bursts.push({ x, y, z }) } });

  p.launch(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, -1, 0), RPG);
  for (let i = 0; i < 60; i++) p.update(1 / 60, world);

  assert.equal(bursts.length, 1);
  assert.ok(Math.abs(bursts[0].y) < 0.5, 'should land at ground level');
});

test('splash reaches the enemy pool, and a direct hit is damaged on top', () => {
  const calls = { radius: [], direct: [] };
  const p = makeProjectiles();
  const world = makeWorld({
    enemies: {
      // One enemy dead ahead, 10 m out.
      raycast: (origin, dir, maxDist) => {
        const dist = 10 - origin.x;
        return dist > 0 && dist <= maxDist
          ? { idx: 3, point: { x: 10, y: 0.9, z: 0 }, dist }
          : null;
      },
      damageRadius: (...args) => calls.radius.push(args),
      damageAt: (...args) => calls.direct.push(args),
    },
  });

  p.launch(new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(1, 0, 0), RPG);
  for (let i = 0; i < 60; i++) p.update(1 / 60, world);

  assert.equal(calls.radius.length, 1, 'splash should be applied once');
  const [, , splash, splashDmg, source] = calls.radius[0];
  assert.equal(splash, RPG.splash);
  assert.equal(splashDmg, RPG.splashDmg);
  assert.equal(source, 'rpg7');
  assert.equal(calls.direct.length, 1, 'the struck enemy also takes direct damage');
  const [idx, dmg, src, knock] = calls.direct[0];
  assert.deepEqual([idx, dmg, src], [3, RPG.dmg, 'rpg7']);
  // Knocked back along the rocket's heading, like a hitscan pellet.
  assert.ok(knock.x > 0 && Math.abs(knock.z) < 1e-9, 'shoved along the rocket heading');
});

test('a fast rocket cannot tunnel through an enemy between fixed steps', () => {
  // 30 m/s at 1/60 s is a half-metre step, but a single huge `dt` is the
  // clearest way to prove the collision test sweeps the segment travelled
  // rather than sampling the endpoint: with a sampled check the rocket would
  // jump from 0 m to 60 m and miss the enemy at 10 m entirely.
  const hits = [];
  const p = makeProjectiles();
  const world = makeWorld({
    enemies: {
      raycast: (origin, dir, maxDist) => {
        const dist = 10 - origin.x;
        return dist > 0 && dist <= maxDist ? { idx: 1, point: { x: 10, y: 0.9, z: 0 }, dist } : null;
      },
      damageRadius: () => {},
      damageAt: (idx) => hits.push(idx),
    },
  });

  p.launch(new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(1, 0, 0), RPG);
  p.update(2, world);

  assert.deepEqual(hits, [1], 'the enemy in the middle of the step must still be hit');
});

test('clear() drops rockets in flight so they cannot cross into the next run', () => {
  const bursts = [];
  const p = makeProjectiles();
  const world = makeWorld({ effects: { burst: () => bursts.push(1) } });

  p.launch(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(1, 0, 0), RPG);
  p.update(1 / 60, world);
  p.clear();
  for (let i = 0; i < 120; i++) p.update(1 / 60, world);

  assert.equal(bursts.length, 0, 'a cleared rocket must never detonate');
});

test('exhausting the pool drops shots instead of throwing', () => {
  const p = makeProjectiles();
  const world = makeWorld();
  for (let i = 0; i < CONFIG.projectiles.cap * 3; i++) {
    p.launch(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(1, 0, 0), RPG);
  }
  p.update(1 / 60, world);
});
