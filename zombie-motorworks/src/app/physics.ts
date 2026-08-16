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
 * Start (or join) the wasm compile. Cheap to call repeatedly — the first call
 * owns the work and everything after it gets the same promise.
 */
export function beginPhysicsInit(): Promise<void> {
  pending ??= RAPIER.init();
  return pending;
}

/**
 * Resolve once physics can be used. Identical to `beginPhysicsInit`, named for
 * the reading side so a caller that is waiting does not look like a caller that
 * is starting something.
 */
export function whenPhysicsReady(): Promise<void> {
  return beginPhysicsInit();
}
