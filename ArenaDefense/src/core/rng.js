/**
 * Deterministic RNG for every gameplay draw (wave gate selection, spawn
 * jitter, drop rolls). A seeded stream keeps runs reproducible for tests and
 * keeps `Math.random()` free for anything purely cosmetic.
 */

/**
 * mulberry32: small, fast, good-enough statistical quality for gameplay use,
 * and — unlike `Math.random` — seedable so the same seed always produces the
 * same sequence.
 *
 * @param {number} seed Any 32-bit integer; non-integers are floored.
 * @returns {() => number} A function returning floats in [0, 1).
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Uniformly picks one element of a non-empty array using the given RNG.
 *
 * @template T
 * @param {() => number} rng
 * @param {readonly T[]} items
 * @returns {T}
 */
export function pick(rng, items) {
  if (items.length === 0) throw new Error('pick: items must be non-empty');
  const i = Math.floor(rng() * items.length);
  // A floating-point rng() returning exactly 1 (should not happen, but
  // defends against it) must not index past the end of the array.
  return items[Math.min(i, items.length - 1)];
}
