/**
 * Decides which control scheme to present, without touching the DOM itself —
 * the caller reads `navigator.maxTouchPoints` / `matchMedia('(pointer: coarse)')`
 * and passes the results in, so this stays testable without a browser.
 */

/**
 * @param {object} input
 * @param {number} input.touchPoints `navigator.maxTouchPoints` (or similar).
 * @param {boolean} input.coarse Whether the primary pointer is coarse (`matchMedia('(pointer: coarse)').matches`).
 * @param {'touch'|'keyboard'|null} [input.override] A `?touch=1`/`?touch=0`-style forced mode; wins outright.
 * @returns {'touch'|'keyboard'}
 */
export function decideInputMode({ touchPoints, coarse, override = null }) {
  if (override === 'touch' || override === 'keyboard') return override;
  return touchPoints > 0 && coarse ? 'touch' : 'keyboard';
}
