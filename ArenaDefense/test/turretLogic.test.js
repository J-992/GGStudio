import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import {
  statsFor, upgradeCost, repairCost, pickTarget, fireReady, turretHitDamage,
} from '../src/core/turretLogic.js';
import { hpFor } from '../src/core/enemyBrain.js';
import { waveDef } from '../src/core/waves.js';

const TYPES = CONFIG.turrets.order;

test('statsFor: dmg/rate/range never decrease as level rises, for every type', () => {
  for (const type of TYPES) {
    let prev = statsFor(type, 0, CONFIG);
    for (let level = 1; level <= 2; level++) {
      const stats = statsFor(type, level, CONFIG);
      assert.ok(stats.dmg >= prev.dmg, `${type} L${level} dmg regressed`);
      assert.ok(stats.rate >= prev.rate, `${type} L${level} rate regressed`);
      assert.ok(stats.range >= prev.range, `${type} L${level} range regressed`);
      if (stats.splash !== undefined) assert.ok(stats.splash >= (prev.splash ?? 0), `${type} L${level} splash regressed`);
      if (stats.slow !== undefined) assert.ok(stats.slow >= (prev.slow ?? 0), `${type} L${level} slow regressed`);
      if (stats.slowDurS !== undefined) assert.ok(stats.slowDurS >= (prev.slowDurS ?? 0), `${type} L${level} slowDurS regressed`);
      prev = stats;
    }
  }
});

test('statsFor: level 0 matches the type\'s base numbers exactly', () => {
  for (const type of TYPES) {
    const def = CONFIG.turrets.types[type];
    const stats = statsFor(type, 0, CONFIG);
    assert.equal(stats.dmg, def.dmg);
    assert.equal(stats.rate, def.rate);
    assert.equal(stats.range, def.range);
  }
});

test('statsFor: splash/slow/slowDurS keys only appear for types that define them', () => {
  const gun = statsFor('gun', 1, CONFIG);
  assert.equal(gun.splash, undefined);
  assert.equal(gun.slow, undefined);
  assert.equal(gun.slowDurS, undefined);

  const tesla = statsFor('tesla', 1, CONFIG);
  assert.equal(tesla.splash, undefined);
  assert.equal(typeof tesla.slow, 'number');
  assert.equal(typeof tesla.slowDurS, 'number');

  const cannon = statsFor('cannon', 1, CONFIG);
  assert.equal(typeof cannon.splash, 'number');
  assert.equal(cannon.slow, undefined);
});

test('statsFor: out-of-range levels clamp instead of throwing', () => {
  const clampedHigh = statsFor('gun', 99, CONFIG);
  const maxLevel = statsFor('gun', 2, CONFIG);
  assert.deepEqual(clampedHigh, maxLevel);

  const clampedLow = statsFor('gun', -5, CONFIG);
  const baseLevel = statsFor('gun', 0, CONFIG);
  assert.deepEqual(clampedLow, baseLevel);
});

test('upgradeCost matches config.turrets.types[type].upgradeCost and is undefined at max level', () => {
  for (const type of TYPES) {
    const def = CONFIG.turrets.types[type];
    assert.equal(upgradeCost(type, 0, CONFIG), def.upgradeCost[0]);
    assert.equal(upgradeCost(type, 1, CONFIG), def.upgradeCost[1]);
    assert.equal(upgradeCost(type, 2, CONFIG), undefined, `${type} L2 should have no further upgrade`);
  }
});

test('repairCost is 0 at full health', () => {
  const turret = { hp: 200, hpMax: 200 };
  assert.equal(repairCost(turret, CONFIG), 0);
});

test('repairCost follows ceil(missing * costPerHpMissing), floored by minCost', () => {
  const { costPerHpMissing, minCost } = CONFIG.turrets.repair;
  const turret = { hp: 150, hpMax: 200 }; // 50 missing
  const expected = Math.max(minCost, Math.ceil(50 * costPerHpMissing));
  assert.equal(repairCost(turret, CONFIG), expected);
});

test('repairCost never goes below minCost even for a sliver of missing hp', () => {
  const { minCost } = CONFIG.turrets.repair;
  const turret = { hp: 199, hpMax: 200 }; // 1 missing
  assert.equal(repairCost(turret, CONFIG), minCost);
});

test('repairCost at zero hp uses the full hpMax as missing', () => {
  const { costPerHpMissing, minCost } = CONFIG.turrets.repair;
  const turret = { hp: 0, hpMax: 200 };
  const expected = Math.max(minCost, Math.ceil(200 * costPerHpMissing));
  assert.equal(repairCost(turret, CONFIG), expected);
});

test('pickTarget: -1 when nothing is within range', () => {
  const turret = { type: 'gun', x: 0, z: 0 };
  const stats = statsFor('gun', 0, CONFIG); // range 14
  const enemies = [{ x: 100, z: 0 }, { x: 0, z: -50 }];
  assert.equal(pickTarget(turret, enemies, stats), -1);
});

test('pickTarget: gun/tesla pick the nearest in-range enemy', () => {
  const turret = { type: 'gun', x: 0, z: 0 };
  const stats = statsFor('gun', 0, CONFIG); // range 14
  const enemies = [
    { x: 10, z: 0 },  // dist 10, in range
    { x: 3, z: 0 },   // dist 3, in range, nearest
    { x: 200, z: 0 }, // way out of range
  ];
  assert.equal(pickTarget(turret, enemies, stats), 1);
});

test('pickTarget: out-of-range candidates never win even if nominally "nearest" among all entries', () => {
  const turret = { type: 'gun', x: 0, z: 0 };
  const stats = statsFor('gun', 0, CONFIG); // range 14
  const enemies = [{ x: 13, z: 0 }, { x: 50, z: 0 }];
  assert.equal(pickTarget(turret, enemies, stats), 0);
});

test('pickTarget: cannon prefers the denser cluster over the nearest lone target', () => {
  const turret = { type: 'cannon', x: 0, z: 0 };
  const stats = statsFor('cannon', 0, CONFIG); // range 18, splash 2.5
  const enemies = [
    { x: 2, z: 0 },    // nearest, alone
    { x: 12, z: 0 },   // farther, but...
    { x: 13, z: 0 },   // ...clustered with the one above (dist 1 <= splash 2.5)
    { x: 13, z: 1 },   // and this one too
  ];
  // index 1 has 2 neighbours within splash (idx 2, idx 3); idx 0 has 0.
  assert.equal(pickTarget(turret, enemies, stats), 1);
});

test('pickTarget: cannon cluster ties break toward the nearer candidate', () => {
  const turret = { type: 'cannon', x: 0, z: 0 };
  const stats = statsFor('cannon', 0, CONFIG);
  const enemies = [
    { x: 5, z: 0 },  // 0 neighbours, nearer
    { x: 10, z: 0 }, // 0 neighbours, farther
  ];
  assert.equal(pickTarget(turret, enemies, stats), 0);
});

test('pickTarget: sparse arrays (holes) are skipped, not crashed on', () => {
  const turret = { type: 'gun', x: 0, z: 0 };
  const stats = statsFor('gun', 0, CONFIG);
  const enemies = [null, { x: 5, z: 0 }, undefined];
  assert.equal(pickTarget(turret, enemies, stats), 1);
});

test('fireReady: fires immediately on a fresh turret with no cooldown yet', () => {
  const turret = {};
  const stats = { rate: 2 };
  assert.equal(fireReady(turret, 0, stats), true);
});

test('fireReady: cadence over a fixed-step simulation matches rate * duration', () => {
  const stats = { rate: 2 }; // one shot every 0.5s
  const turret = { cooldown: 0 };
  const dt = 1 / 60;
  const durationS = 10;
  let fires = 0;
  for (let t = 0; t < durationS; t += dt) {
    if (fireReady(turret, dt, stats)) fires++;
  }
  const expected = Math.round(durationS * stats.rate);
  assert.ok(Math.abs(fires - expected) <= 1, `expected ~${expected} fires, got ${fires}`);
});

test('fireReady: does not fire again before its cooldown elapses', () => {
  const stats = { rate: 1 }; // one shot per second
  const turret = { cooldown: 0 };
  assert.equal(fireReady(turret, 0, stats), true);
  assert.equal(fireReady(turret, 0.5, stats), false);
  assert.equal(fireReady(turret, 0.4, stats), false);
  assert.equal(fireReady(turret, 0.1, stats), true); // 0.5 + 0.4 + 0.1 = 1.0s elapsed
});

test('no turret type, at any level, one-shots any enemy on any wave', () => {
  const hpMuls = Array.from(
    { length: CONFIG.run.finalWave },
    (_, i) => waveDef(CONFIG, i + 1).hpMul,
  );
  for (const type of TYPES) {
    const levels = CONFIG.turrets.types[type].levels.length;
    for (let level = 0; level < levels; level++) {
      const { dmg } = statsFor(type, level, CONFIG);
      for (const [name, typeDef] of Object.entries(CONFIG.enemies.types)) {
        for (const hpMul of hpMuls) {
          const hpMax = hpFor(typeDef, hpMul);
          const applied = turretHitDamage(dmg, hpMax, CONFIG);
          assert.ok(
            applied < hpMax,
            `${type} L${level} deals ${applied} to a ${name} with ${hpMax} hp — a one-shot`,
          );
        }
      }
    }
  }
});

test('turretHitDamage leaves damage alone when it cannot one-shot anyway', () => {
  // A 40-damage cannon shell against the 900hp boss is nowhere near the cap.
  assert.equal(turretHitDamage(40, 900, CONFIG), 40);
  // Degenerate inputs pass through rather than producing a zero-damage hit.
  assert.equal(turretHitDamage(40, 0, CONFIG), 40);
});

test('the cap is per-hit, not a floor on hp: three capped hits still kill', () => {
  // `maxDamageFracPerHit` is 1/3, so the strongest turret in the game needs
  // exactly three shots on the weakest enemy — no more (the cap must not
  // outrun the health pool) and no fewer (that's the whole point).
  const hpMax = hpFor(CONFIG.enemies.types.shambler, 1);
  const { dmg } = statsFor('cannon', 2, CONFIG);
  const applied = turretHitDamage(dmg, hpMax, CONFIG);
  assert.ok(applied * 2 < hpMax, `two hits of ${applied} already finish ${hpMax} hp`);
  assert.ok(applied * 3 >= hpMax, `three hits of ${applied} do not finish ${hpMax} hp`);
});

test('no turret needs more shots than cfg.turrets.maxDamageFracPerHit implies', () => {
  // The cap sets the *floor* on shots-to-kill; a turret whose raw damage is
  // already below it keeps its own (longer) time-to-kill. What must never
  // happen is the cap itself stretching a kill past `1 / frac` hits.
  const shots = Math.ceil(1 / CONFIG.turrets.maxDamageFracPerHit);
  for (const type of TYPES) {
    const levels = CONFIG.turrets.types[type].levels.length;
    for (let level = 0; level < levels; level++) {
      const { dmg } = statsFor(type, level, CONFIG);
      for (const [name, typeDef] of Object.entries(CONFIG.enemies.types)) {
        const hpMax = hpFor(typeDef, 1);
        const applied = turretHitDamage(dmg, hpMax, CONFIG);
        if (applied < dmg) {
          assert.ok(
            applied * shots >= hpMax,
            `${type} L${level} capped to ${applied} needs more than ${shots} hits on a ${name}`,
          );
        }
      }
    }
  }
});
