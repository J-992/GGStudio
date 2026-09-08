/**
 * Save-data shape enforcement and the tiny injected-`io` persistence wrapper.
 *
 * `io` is `{ get(key), set(key, str) }` rather than `localStorage` directly so
 * this module never touches `window` — the DOM-facing `platform/storage.js`
 * supplies the real `localStorage`-backed `io`, and tests supply a plain
 * object.
 */
import { CONFIG } from '../config.js';

/**
 * Coerces arbitrary (possibly corrupt, possibly attacker-controlled) data
 * into a well-typed, clamped save object. Never throws.
 *
 * @param {any} raw
 * @returns {import('./types.js').SaveData}
 */
export function sanitize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    coins: clampInt(src.coins, 0, CONFIG.save.maxCoins),
    bestWave: clampInt(src.bestWave, 0, CONFIG.run.finalWave),
    unlocks: sanitizeUnlocks(src.unlocks),
  };
}

/**
 * @param {any} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInt(value, min, max) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : min;
  return Math.min(max, Math.max(min, n));
}

/**
 * @param {any} value
 * @returns {string[]}
 */
function sanitizeUnlocks(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

/**
 * @param {import('./types.js').SaveIO} io
 * @returns {import('./types.js').SaveData}
 */
export function loadSave(io) {
  let raw = null;
  try {
    const text = io.get(CONFIG.save.key);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  return sanitize(raw);
}

/**
 * Merges `patch` onto the currently saved data, sanitizes the result, and
 * persists + returns it.
 *
 * @param {import('./types.js').SaveIO} io
 * @param {Partial<import('./types.js').SaveData>} patch
 * @returns {import('./types.js').SaveData}
 */
export function saveSave(io, patch) {
  const current = loadSave(io);
  const merged = sanitize({ ...current, ...patch });
  io.set(CONFIG.save.key, JSON.stringify(merged));
  return merged;
}
