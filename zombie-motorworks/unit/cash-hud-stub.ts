/**
 * Minimal stand-ins for everything a banked kill touches on its way through
 * `SurvivalMode` — the cash counter, the toast column, the camera, and the
 * first-wave HUD reveal set.
 *
 * The reward tests drive `SurvivalMode` through the prototype seam in a plain
 * node environment — there is no jsdom in this project — so every handle the
 * code path touches has to be handed to it. Banking a kill floats a `+$N` chit
 * off the counter, may throw a streak chit and nudge the camera, and asks
 * whether the tutorial is running; none of the pure money maths can be
 * exercised without these. Kept here rather than copied into each harness so a
 * future flourish on the kill path is stubbed once.
 */

/** The `document.createElement` result `popCashGain` builds a chit out of. */
function createChitStub(): Record<string, unknown> {
  return {
    className: '',
    textContent: '',
    style: { setProperty: () => {} },
    addEventListener: () => {},
    remove: () => {},
  };
}

/**
 * The fields to `Object.assign` onto a seam-built `SurvivalMode`, plus the
 * global `document` the chit is created from. Call the returned `restore` in
 * an `afterEach` so the stub does not leak into another file's run.
 */
export function installCashHudStub(): {
  fields: Record<string, unknown>;
  restore(): void;
} {
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => createChitStub(),
  };
  return {
    fields: {
      lastCashGain: null,
      lastCashGainAt: 0,
      cashGains: { appendChild: () => {} },
      cashCounter: {
        offsetWidth: 0,
        classList: { add: () => {}, remove: () => {} },
      },
      // Streak chits land in the supply-crate column and nudge the camera.
      pickupToasts: { appendChild: () => {} },
      followCamera: { addShake: () => {} },
      waveElapsedSeconds: 0,
      killStreak: 0,
      killStreakExpiresAt: -1,
      // Not the tutorial: no coach, so no milestone ladder and no HUD reveals.
      firstPlay: null,
      firstPlayKills: 0,
      firstPlayHud: new Set<string>(),
    },
    restore() {
      if (previous === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = previous;
      }
    },
  };
}
