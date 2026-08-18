/**
 * Owns the one-time Rapier wasm handshake, so boot can start it early and wait
 * for it late.
 *
 * `RAPIER.init()` used to be the first line of `App.start()`, which put a
 * multi-megabyte wasm compile in front of the renderer being constructed — the
 * canvas did not exist, and so nothing could be drawn, until physics was ready
 * even though the first thing on screen never touches physics. Boot now kicks
 * this off alongside the platform handshake and the module imports, and only
 * blocks on it at the point a mode genuinely needs a `World`.
 *
 * The wasm itself is no longer inlined as base64: `vite.config.ts` rewrites
 * Rapier's loader to fetch a real `.wasm` asset, which lets the browser compile
 * it while it downloads instead of after.
 */

import RAPIER from '@dimforge/rapier3d-compat';

let pending: Promise<void> | null = null;

/**
 * How long to wait before the second attempt.
 *
 * The failure this exists for is `RangeError: WebAssembly.instantiate(): Out of
 * memory`, which on a low-memory phone is usually a moment rather than a state:
 * the tab is competing with the portal page and its pre-roll ad for a device
 * that has nothing spare, and a beat later it does. Long enough to be worth
 * something, short enough that a player who is going to see the game at all
 * still sees it quickly.
 */
const RETRY_DELAY_MS = 400;

/**
 * Start (or join) the wasm compile. Cheap to call repeatedly — the first call
 * owns the work and everything after it gets the same promise.
 */
export function beginPhysicsInit(): Promise<void> {
  pending ??= initWithRetry();
  return pending;
}

/**
 * One retry, because the common failure is transient.
 *
 * Rapier only latches its exports on success, so a failed `init()` leaves the
 * module untouched and a second call redoes the whole handshake rather than
 * returning the broken first result. The retry also takes a different route to
 * the bytes — see `rapierWasmResponse`, which buffers on its second call — so
 * this is not purely a matter of asking the same question twice.
 */
async function initWithRetry(): Promise<void> {
  try {
    await RAPIER.init();
    return;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  // Deliberately unguarded: if the engine cannot start twice over, the failure
  // belongs to the caller, which surfaces it rather than mounting a mode onto
  // a physics engine that does not exist.
  await RAPIER.init();
}

/**
 * Resolve once physics can be used. Identical to `beginPhysicsInit`, named for
 * the reading side so a caller that is waiting does not look like a caller that
 * is starting something.
 */
export function whenPhysicsReady(): Promise<void> {
  return beginPhysicsInit();
}
