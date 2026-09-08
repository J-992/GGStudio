/**
 * Wave table lookups and spawn-schedule flattening.
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
 * @param {import('./types.js').GameConfig} cfg
 * @param {number} n Wave number, 1-based.
 * @returns {import('./types.js').WaveDef}
 */
export function waveDef(cfg, n) {
  const def = cfg.waves.find((w) => w.n === n);
  if (!def) throw new Error(`waveDef: no wave ${n}`);
  return def;
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
