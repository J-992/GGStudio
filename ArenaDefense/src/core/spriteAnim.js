/**
 * Pure billboard animation curves consumed by `game/Billboards.js`. Nothing
 * here touches three.js — it produces plain numbers the renderer feeds into
 * per-instance shader attributes.
 */

/**
 * Walk bob + squash: a vertical bob paired with an opposite horizontal/
 * vertical squash so the sprite reads as weight shifting between feet.
 * Both outputs are bounded by `cfg.sprites` regardless of `t`/`speed`.
 *
 * @param {number} t Seconds, any real value.
 * @param {number} speed Movement speed scalar; 0 holds the sprite still.
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{ y: number, sx: number, sy: number }} `y` in `[-bobAmp, bobAmp]`; `sx`/`sy` in `[1 - squash, 1 + squash]`.
 */
export function bob(t, speed, cfg) {
  const s = cfg.sprites;
  const phase = 2 * Math.PI * s.bobHz * Math.max(0, speed) * t;
  const y = Math.sin(phase) * s.bobAmp;
  const squash = Math.cos(phase) * s.squash;
  return { y, sx: 1 - squash, sy: 1 + squash };
}

/**
 * @param {number} value
 * @returns {number}
 */
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * @param {number} value 0..1
 * @returns {number} Ease-in-ease-out (3t² - 2t³).
 */
function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/**
 * Boss/tank "raise" scale-up played during a cast — grows from 1x to 1.35x
 * with a smoothstep ease at both ends of the cast.
 *
 * @param {number} progress 0..1 through the cast.
 * @returns {number} Scale multiplier in `[1, 1.35]`.
 */
export function castRaise(progress) {
  return 1 + smoothstep(progress) * 0.35;
}

/**
 * White hit-flash intensity, decaying linearly from 1 to 0 over `flashS`.
 *
 * @param {number} tSince Seconds since the hit (negative treated as 0).
 * @param {import('./types.js').GameConfig} cfg
 * @returns {number} 0..1.
 */
export function hitFlash(tSince, cfg) {
  const flashS = cfg.sprites.flashS;
  if (flashS <= 0) return 0;
  return clamp01(1 - Math.max(0, tSince) / flashS);
}

/**
 * Flinch squash for a body taking a hit: it compresses along its own height
 * and widens as the impulse lands, easing back as the knockback decays.
 * Multiplies (rather than replaces) the walk `bob` squash so a hit reads on
 * top of the walk cycle instead of freezing it.
 *
 * @param {number} intensity 0..1, from `core/enemyBrain.knockbackIntensity`.
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{ sx:number, sy:number }} Scale multipliers, 1/1 when untouched.
 */
export function hitSquash(intensity, cfg) {
  const amount = cfg.enemies.knockback.squash * clamp01(intensity);
  return { sx: 1 + amount, sy: 1 - amount };
}
