import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { makeRng } from '../src/core/rng.js';
import { waveDef, isBossWave, waveEnergyTotal, pickActiveGates, flattenSpawns } from '../src/core/waves.js';

test('wave 1 total energy equals the gun turret cost', () => {
  assert.equal(waveEnergyTotal(CONFIG, 1), CONFIG.turrets.types.gun.cost);
});

test('every wave maxAlive stays at or below the enemy cap', () => {
  for (const wave of CONFIG.waves) {
    assert.ok(wave.maxAlive <= CONFIG.enemies.cap, `wave ${wave.n} maxAlive ${wave.maxAlive} > cap ${CONFIG.enemies.cap}`);
  }
});

test('only wave 5 carries a boss, and the final wave is 10', () => {
  for (const wave of CONFIG.waves) {
    assert.equal(isBossWave(CONFIG, wave.n), wave.n === 5, `wave ${wave.n} boss mismatch`);
  }
  assert.equal(CONFIG.run.finalWave, 10);
  assert.equal(Math.max(...CONFIG.waves.map((w) => w.n)), 10);
});

test('waveDef throws for an unknown wave number', () => {
  assert.throws(() => waveDef(CONFIG, 99));
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
