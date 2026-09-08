/**
 * Wave table GENERATION and spawn-schedule flattening.
 *
 * `waveDef` used to be a lookup into a hand-written `CONFIG.waves` table; it
 * is now computed from `CONFIG.waveCurve` and `CONFIG.run` (see the comment
 * block above `waveCurve` in `src/config.js` for the two test-enforced
 * constraints any change here must keep satisfying: wave 1 pinned to exactly
 * `baseCount` shamblers, and `maxAlive` always clamped to `enemies.cap`).
 *
 * `flattenSpawns` resolves each spawn group's count/interval into individual
 * timed instances but deliberately does NOT resolve `gateId` to a real arena
 * gate id — it emits 0/1, an index into whichever two-gate pair is active for
 * that wave (see `FlatSpawnEntry` in `types.js`). The active pair itself can
 * change every wave via `pickActiveGates`, so keeping the two concerns apart
 * means a wave's spawn table never needs to know which physical gates are lit.
 */

/** Fixed gate count for v1 — one arena, three gates (see `CONFIG.arena.gateAngles`). */
const GATE_COUNT = 3;

/**
 * Seconds between one mix entry's first spawn and the next one's, so a wave
 * doesn't dump every active type at the same instant — shambler always leads
 * at `startS: 0`, the next type in `waveCurve.mix` order enters a few seconds
 * in, the one after that later still. A flat gap (rather than something
 * scaled off `everyS`) keeps the entrance stagger legible even once `everyS`
 * has floored out on a late wave.
 */
const MIX_STAGGER_S = 4;

/**
 * @param {number} value
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Total enemy count for wave `n`, geometric growth off `baseCount`.
 * @param {import('./types.js').GameConfig} cfg
 * @param {number} n
 * @returns {number}
 */
function waveCount(cfg, n) {
  const { baseCount, countGrowth, countMax } = cfg.waveCurve;
  return clamp(Math.round(baseCount * countGrowth ** (n - 1)), 1, countMax);
}

/**
 * Concurrency cap for wave `n`, geometric growth off `maxAliveBase`, always
 * clamped to `cfg.enemies.cap` — the hard constraint from `src/config.js`.
 * @param {import('./types.js').GameConfig} cfg
 * @param {number} n
 * @returns {number}
 */
function waveMaxAlive(cfg, n) {
  const { maxAliveBase, maxAliveGrowth } = cfg.waveCurve;
  const raw = Math.round(maxAliveBase * maxAliveGrowth ** (n - 1));
  return clamp(raw, 1, cfg.enemies.cap);
}

/**
 * HP multiplier for wave `n`, linear off `hpMulBase` (matches the comment on
 * `hpMulPerWave` in `src/config.js`: "+3.5%/wave -> ~1.84x by wave 25", which
 * only holds for a linear ramp, not a compounding one).
 * @param {import('./types.js').GameConfig} cfg
 * @param {number} n
 * @returns {number}
 */
function waveHpMul(cfg, n) {
  const { hpMulBase, hpMulPerWave } = cfg.waveCurve;
  return hpMulBase + hpMulPerWave * (n - 1);
}

/**
 * Base spawn interval for wave `n`, floored at `everyS.min`. Each mix entry
 * scales this by its own `everySMul`, so the floor applies to the fastest
 * type in the wave rather than to every type independently.
 * @param {import('./types.js').GameConfig} cfg
 * @param {number} n
 * @returns {number}
 */
function waveEveryS(cfg, n) {
  const { base, perWave, min } = cfg.waveCurve.everyS;
  return Math.max(min, base + perWave * (n - 1));
}

/**
 * @param {import('./types.js').GameConfig} cfg
 * @param {number} n
 * @returns {string|undefined} The boss id for wave `n`, or `undefined` if it
 *   carries no boss.
 */
function bossForWave(cfg, n) {
  const { bossEvery, bossOrder } = cfg.run;
  if (!bossEvery || n % bossEvery !== 0) return undefined;
  const k = n / bossEvery; // 1-based: k-th boss wave.
  // If a run outlives the roster (finalWave / bossEvery > bossOrder.length),
  // wrap back to the start of bossOrder rather than throwing or repeating the
  // finale indefinitely — every `bossEvery`th wave still gets a real fight.
  // Not exercised by the current config (25 / 5 == bossOrder.length == 5
  // exactly), but the generator shouldn't fall over the day someone bumps
  // `finalWave` without also growing the roster.
  return bossOrder[(k - 1) % bossOrder.length];
}

/**
 * Splits `total` enemies across `active` mix entries proportional to
 * `weight`, using the largest-remainder method so the per-type counts always
 * sum to exactly `total` (plain rounding per entry can drift by ± a couple
 * either way).
 * @param {{enemy:string, weight:number}[]} active
 * @param {number} total
 * @returns {number[]} Counts, same order/length as `active`.
 */
function allocateCounts(active, total) {
  const weightSum = active.reduce((sum, m) => sum + m.weight, 0);
  const shares = active.map((m) => (m.weight / weightSum) * total);
  const floors = shares.map(Math.floor);
  const allocated = floors.reduce((sum, v) => sum + v, 0);
  const remaining = total - allocated;
  const byRemainder = shares
    .map((s, i) => ({ i, frac: s - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const counts = floors.slice();
  for (let k = 0; k < remaining; k++) {
    counts[byRemainder[k % byRemainder.length].i] += 1;
  }
  return counts;
}

/**
 * @param {import('./types.js').GameConfig} cfg
 * @param {number} n Wave number, 1-based.
 * @returns {import('./types.js').WaveDef}
 */
export function waveDef(cfg, n) {
  if (!Number.isInteger(n) || n < 1 || n > cfg.run.finalWave) {
    throw new Error(`waveDef: no wave ${n}`);
  }

  const hpMul = waveHpMul(cfg, n);
  const maxAlive = waveMaxAlive(cfg, n);
  const boss = bossForWave(cfg, n);

  // A boss wave carries no ordinary spawns — the boss itself is spawned and
  // driven by `game/bossPhase.js`, not this scheduler (see the module doc
  // comment above and `Game.js#_startWave`).
  if (boss) {
    return { n, hpMul, maxAlive, boss, spawns: [] };
  }

  const total = waveCount(cfg, n);
  const active = cfg.waveCurve.mix.filter((m) => n >= m.from);
  const everyS = waveEveryS(cfg, n);
  const counts = allocateCounts(active, total);

  const spawns = active
    .map((m, i) => ({
      enemy: m.enemy,
      n: counts[i],
      // Per-type cadence: a heavy arrives at a fraction of a shambler's rate.
      everyS: everyS * (m.everySMul ?? 1),
      startS: i * MIX_STAGGER_S,
    }))
    .filter((s) => s.n > 0);

  return { n, hpMul, maxAlive, spawns };
}

/**
 * @param {import('./types.js').GameConfig} cfg
 * @param {number} n
 * @returns {boolean} Whether wave `n` carries a boss.
 */
export function isBossWave(cfg, n) {
  return waveDef(cfg, n).boss !== undefined;
}

/**
 * Total energy a wave awards if every enemy in it (and its boss, if any) is
 * killed — used to size the economy against turret costs.
 *
 * @param {import('./types.js').GameConfig} cfg
 * @param {number} n
 * @returns {number}
 */
export function waveEnergyTotal(cfg, n) {
  const def = waveDef(cfg, n);
  let total = 0;
  for (const spawn of def.spawns) {
    const type = cfg.enemies.types[spawn.enemy];
    total += spawn.n * type.energy;
  }
  if (def.boss) {
    total += cfg.bosses[def.boss].energy;
  }
  return total;
}

/**
 * Picks 2 distinct gate ids out of `{0, ..., GATE_COUNT - 1}`, never equal
 * (as an unordered pair) to `prevPair`. Used at the start of every wave so
 * the "lit" gates change from the previous one.
 *
 * @param {() => number} rng
 * @param {[number, number]|null} prevPair
 * @param {number} [gateCount]
 * @returns {[number, number]} Sorted ascending.
 */
export function pickActiveGates(rng, prevPair, gateCount = GATE_COUNT) {
  const prevKey = prevPair ? pairKey(prevPair) : null;
  const all = Array.from({ length: gateCount }, (_, i) => i);

  // Enumerate every unordered pair up front rather than rejection-sampling:
  // with only 3 gates a naive "reroll until different" loop is fine too, but
  // this stays O(1) draws regardless of gate count and is trivially provable
  // never to loop forever.
  const pairs = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      pairs.push([all[i], all[j]]);
    }
  }
  const candidates = prevKey === null ? pairs : pairs.filter((p) => pairKey(p) !== prevKey);
  const chosen = candidates[Math.floor(rng() * candidates.length) % candidates.length];
  return [chosen[0], chosen[1]];
}

/**
 * @param {[number, number]} pair
 * @returns {string}
 */
function pairKey(pair) {
  return `${pair[0]},${pair[1]}`;
}

/**
 * Expands a wave's spawn groups into individual timed instances.
 *
 * @param {import('./types.js').WaveDef} def
 * @returns {import('./types.js').FlatSpawnEntry[]} Sorted ascending by `t`.
 */
export function flattenSpawns(def) {
  const out = [];
  for (const spawn of def.spawns) {
    const start = spawn.startS ?? 0;
    for (let i = 0; i < spawn.n; i++) {
      out.push({ enemy: spawn.enemy, t: start + i * spawn.everyS, gateId: i % 2 });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
