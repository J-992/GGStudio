import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { makeRng } from '../src/core/rng.js';
import { waveDef, isBossWave, waveEnergyTotal, pickActiveGates, flattenSpawns } from '../src/core/waves.js';

const FINAL_WAVE = CONFIG.run.finalWave;

test('wave 1 total energy equals the gun turret cost', () => {
  assert.equal(waveEnergyTotal(CONFIG, 1), CONFIG.turrets.types.gun.cost);
});

test('wave 1 is exactly the pinned composition: 5 shamblers and nothing else', () => {
  const def = waveDef(CONFIG, 1);
  assert.equal(def.boss, undefined);
  assert.equal(def.n, 1);
  assert.equal(CONFIG.waveCurve.baseCount, 5);
  assert.deepEqual(def.spawns, [
    { enemy: 'shambler', n: 5, everyS: CONFIG.waveCurve.everyS.base, startS: 0 },
  ]);
});

test('every wave maxAlive stays at or below the enemy cap', () => {
  for (let n = 1; n <= FINAL_WAVE; n++) {
    const wave = waveDef(CONFIG, n);
    assert.ok(wave.maxAlive <= CONFIG.enemies.cap, `wave ${wave.n} maxAlive ${wave.maxAlive} > cap ${CONFIG.enemies.cap}`);
  }
});

test('boss waves land on exactly bossEvery multiples with bossOrder ids, everything else has none', () => {
  const { bossEvery, bossOrder } = CONFIG.run;
  for (let n = 1; n <= FINAL_WAVE; n++) {
    const isBoss = n % bossEvery === 0;
    assert.equal(isBossWave(CONFIG, n), isBoss, `wave ${n} boss mismatch`);
    if (isBoss) {
      const k = n / bossEvery;
      assert.equal(waveDef(CONFIG, n).boss, bossOrder[(k - 1) % bossOrder.length], `wave ${n} boss id mismatch`);
    }
  }
  assert.equal(FINAL_WAVE, 25);
});

test('waveDef throws for an unknown wave number', () => {
  assert.throws(() => waveDef(CONFIG, 99));
  assert.throws(() => waveDef(CONFIG, 0));
  assert.throws(() => waveDef(CONFIG, 1.5));
});

test('pickActiveGates: 500 seeded draws always 2 distinct gates from {0,1,2}, never the previous pair', () => {
  const rng = makeRng(1234);
  let prev = null;
  for (let i = 0; i < 500; i++) {
    const pair = pickActiveGates(rng, prev);
    assert.equal(pair.length, 2);
    assert.notEqual(pair[0], pair[1]);
    for (const gate of pair) {
      assert.ok(gate === 0 || gate === 1 || gate === 2, `unexpected gate id ${gate}`);
    }
    if (prev) {
      const prevSorted = [...prev].sort();
      const pairSorted = [...pair].sort();
      assert.notDeepEqual(pairSorted, prevSorted, `repeated previous pair on draw ${i}`);
    }
    prev = pair;
  }
});

test('flattenSpawns produces absolute times startS + i*everyS, sorted ascending', () => {
  const def = {
    n: 999,
    hpMul: 1,
    maxAlive: 99,
    spawns: [
      { enemy: 'shambler', n: 3, everyS: 2, startS: 1 },
      { enemy: 'spitter', n: 2, everyS: 5 },
    ],
  };
  const flat = flattenSpawns(def);
  assert.equal(flat.length, 5);
  const shamblerTimes = flat.filter((e) => e.enemy === 'shambler').map((e) => e.t);
  assert.deepEqual(shamblerTimes, [1, 3, 5]);
  const spitterTimes = flat.filter((e) => e.enemy === 'spitter').map((e) => e.t);
  assert.deepEqual(spitterTimes, [0, 5]);
  for (let i = 1; i < flat.length; i++) {
    assert.ok(flat[i].t >= flat[i - 1].t, 'entries must be sorted ascending by t');
  }
  for (const entry of flat) {
    assert.ok(entry.gateId === 0 || entry.gateId === 1, 'gateId must round-robin over the active pair (0/1)');
  }
});

// --- Generator coverage: a curve is exactly the kind of thing that silently drifts. ---

test('generator: hpMul increases monotonically across every wave, boss waves included', () => {
  let prevHpMul = -Infinity;
  for (let n = 1; n <= FINAL_WAVE; n++) {
    const def = waveDef(CONFIG, n);
    assert.ok(def.hpMul > prevHpMul, `wave ${n} hpMul ${def.hpMul} did not increase past ${prevHpMul}`);
    prevHpMul = def.hpMul;
  }
});

test('generator: maxAlive is non-decreasing across the run', () => {
  let prevMaxAlive = -Infinity;
  for (let n = 1; n <= FINAL_WAVE; n++) {
    const def = waveDef(CONFIG, n);
    assert.ok(def.maxAlive >= prevMaxAlive, `wave ${n} maxAlive ${def.maxAlive} dropped below ${prevMaxAlive}`);
    prevMaxAlive = def.maxAlive;
  }
});

test('generator: non-boss wave spawn totals are non-decreasing across the run', () => {
  let prevTotal = -Infinity;
  for (let n = 1; n <= FINAL_WAVE; n++) {
    const def = waveDef(CONFIG, n);
    if (def.boss) continue; // boss waves deliberately carry zero ordinary spawns
    const total = def.spawns.reduce((sum, s) => sum + s.n, 0);
    assert.ok(total >= prevTotal, `wave ${n} spawn total ${total} dropped below ${prevTotal}`);
    prevTotal = total;
  }
});

test('generator: every non-boss wave has at least one spawn, every boss wave has zero', () => {
  for (let n = 1; n <= FINAL_WAVE; n++) {
    const def = waveDef(CONFIG, n);
    if (def.boss) {
      assert.deepEqual(def.spawns, [], `boss wave ${n} should carry no ordinary spawns`);
    } else {
      assert.ok(def.spawns.length > 0, `non-boss wave ${n} has no spawns`);
      const total = def.spawns.reduce((sum, s) => sum + s.n, 0);
      assert.ok(total > 0, `non-boss wave ${n} spawns sum to 0`);
    }
  }
});

test('generator: a type never appears before its waveCurve.mix `from` wave', () => {
  const fromByEnemy = Object.fromEntries(CONFIG.waveCurve.mix.map((m) => [m.enemy, m.from]));
  for (let n = 1; n <= FINAL_WAVE; n++) {
    const def = waveDef(CONFIG, n);
    for (const spawn of def.spawns) {
      assert.ok(n >= fromByEnemy[spawn.enemy], `${spawn.enemy} appeared on wave ${n}, before its from:${fromByEnemy[spawn.enemy]}`);
    }
  }
});

test('generator: everyS never drops below waveCurve.everyS.min', () => {
  for (let n = 1; n <= FINAL_WAVE; n++) {
    const def = waveDef(CONFIG, n);
    for (const spawn of def.spawns) {
      assert.ok(spawn.everyS >= CONFIG.waveCurve.everyS.min, `wave ${n} ${spawn.enemy} everyS ${spawn.everyS} below min ${CONFIG.waveCurve.everyS.min}`);
    }
  }
});
