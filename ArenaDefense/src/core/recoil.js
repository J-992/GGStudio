/**
 * Pure spring-damper behind the weapon recoil punch (see `game/Player.js`).
 *
 * One normalized scalar. A shot adds a *velocity* impulse rather than
 * stepping the value, so the kick ramps in over ~1/sqrt(stiffness) seconds
 * and eases back to exactly 0 — a punch, not a pop. `game/Player.js`
 * multiplies the value by the per-channel amplitudes in
 * `CONFIG.player.gun.recoil` (viewmodel slide/rise/pitch, camera pitch).
 *
 * `impulse` is normalized so one shot peaks the value at ~1.0; sustained
 * fire at `gun.rate` overlaps on the tail and plateaus around 1.3. Nothing
 * here touches three.js, the DOM, or `core/rng.js` — the spring is fully
 * deterministic, which is the whole point of it living in `core/` (see
 * `../../AGENTS.md`).
 */

/**
 * Target integrator step. Explicit integration of a stiff spring is stable
 * well before it is *accurate*: at the raw 1/60 fixed step the damping term
 * eats most of a fresh impulse in the first step and the kick peaks at about
 * half its analytic height. Sub-stepping to ~1/480 recovers ~95% of it, and
 * — more importantly — makes the felt response independent of
 * `timing.fixedStep`, so `impulse` stays normalized if that ever changes.
 *
 * Numerical guards, not balance knobs, so they stay here rather than in
 * `config.js`.
 */
const SUBSTEP_S = 1 / 480;

/** Cost ceiling: at `timing.fixedStep` this is exactly the count used. */
const MAX_SUBSTEPS = 8;

/** Below this on both value and velocity the spring is snapped to exact rest. */
const SETTLE_EPS = 1e-4;

/** @typedef {{ value: number, velocity: number }} RecoilSpring */

/** @returns {RecoilSpring} At rest. */
export function createRecoilSpring() {
  return { value: 0, velocity: 0 };
}

/**
 * Returns the spring to exact rest — value *and* velocity, so the very next
 * step writes the viewmodel at precisely its base transform rather than
 * drifting in from a leftover kick.
 *
 * @param {RecoilSpring} spring Mutated in place.
 */
export function resetRecoilSpring(spring) {
  spring.value = 0;
  spring.velocity = 0;
}

/**
 * Adds one shot's velocity impulse. Repeated kicks stack — sustained fire
 * climbs above a single shot's peak — and `stepRecoilSpring`'s `maxValue`
 * clamp is what bounds that stack.
 *
 * @param {RecoilSpring} spring Mutated in place.
 * @param {number} impulse Signed; a negative impulse mirrors a positive one.
 */
export function kickRecoilSpring(spring, impulse) {
  spring.velocity += impulse;
}

/**
 * Semi-implicit Euler step of `x'' = -stiffness * x - damping * x'`.
 *
 * Sub-stepped to `SUBSTEP_S` (see above) for accuracy, capped at
 * `MAX_SUBSTEPS` so an unusually long `dt` costs bounded work rather than
 * diverging — `Game.js` only ever passes `timing.fixedStep`, but the cap
 * makes that a property the tests can pin instead of an assumption.
 *
 * @param {RecoilSpring} spring Mutated in place.
 * @param {number} dt Seconds. Non-positive values are a no-op.
 * @param {import('./types.js').GameConfig} cfg
 */
export function stepRecoilSpring(spring, dt, cfg) {
  if (!(dt > 0)) return;
  const r = cfg.player.gun.recoil;

  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / SUBSTEP_S)));
  const h = dt / steps;

  for (let i = 0; i < steps; i++) {
    spring.velocity += (-r.stiffness * spring.value - r.damping * spring.velocity) * h;
    spring.value += spring.velocity * h;
    // Clamp the value *and* kill the velocity still pushing into the clamp,
    // so the state stays self-consistent instead of parking against the rail
    // with stored energy that unloads the moment the value comes off it.
    if (spring.value > r.maxValue) {
      spring.value = r.maxValue;
      if (spring.velocity > 0) spring.velocity = 0;
    } else if (spring.value < -r.maxValue) {
      spring.value = -r.maxValue;
      if (spring.velocity < 0) spring.velocity = 0;
    }
  }

  if (Math.abs(spring.value) < SETTLE_EPS && Math.abs(spring.velocity) < SETTLE_EPS) {
    spring.value = 0;
    spring.velocity = 0;
  }
}
