/**
 * Talks to the splash markup inlined in `index.html`.
 *
 * The element and its driver are written straight into the HTML so they paint
 * on the first parse, before this module — or any module — has been fetched.
 * That means everything here has to tolerate the driver being absent: a stale
 * cached `index.html`, a host that rewrites the document, or a test harness
 * mounting the app into a bare DOM all end up here with no splash to talk to.
 */

interface BootSplashDriver {
  set(fraction: number, label?: string): void;
  done(): void;
}

function driver(): BootSplashDriver | null {
  const host = window as unknown as { __bootSplash?: BootSplashDriver };
  return host.__bootSplash ?? null;
}

/**
 * Boot stages, as fractions of the bar.
 *
 * These are deliberately not evenly spaced. The bar is a promise about how much
 * waiting is left, and the stages behind it take wildly different amounts of
 * time — the engine fetch dominates a cold load and the mode mount is nearly
 * instant — so evenly spaced stops would stall at 25% and then jump to done.
 */
export const BOOT_STAGES = {
  /** The module graph arrived and `main.ts` is running. */
  scriptsReady: { at: 0.12, label: 'Unpacking the toolbox' },
  /** The portal SDK has been asked for, one way or the other. */
  platformReady: { at: 0.2, label: 'Checking in' },
  /** App and audio modules are imported; the physics engine is still coming. */
  modulesReady: { at: 0.34, label: 'Loading the workshop' },
  /** The renderer exists and the canvas is in the document. */
  rendererReady: { at: 0.45, label: 'Lighting the bay' },
  /** Rapier's wasm has compiled. The long pole on a cold boot. */
  engineReady: { at: 0.9, label: 'Spinning up physics' },
  /** A mode is mounted and the frame loop is running. */
  modeReady: { at: 1, label: 'Ready' },
} as const;

export type BootStage = keyof typeof BOOT_STAGES;

/** Advance the boot bar to a named stage. Safe to call when no splash exists. */
export function reportBootStage(stage: BootStage): void {
  const { at, label } = BOOT_STAGES[stage];
  driver()?.set(at, label);
}

/**
 * Fade the splash out and drop it from the document.
 *
 * Idempotent, and safe to call from a `finally` — a boot that threw still has
 * to give the screen back, because a stuck splash hides whatever error UI the
 * app managed to put up.
 */
export function dismissBootSplash(): void {
  driver()?.done();
}
