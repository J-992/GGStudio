/**
 * Runs `fn`, routing any throw to `onError` instead of letting it escape.
 *
 * `Game.frame()` re-arms `requestAnimationFrame` as its very first line, before
 * any per-frame work runs - so an uncaught exception mid-frame does not stop
 * the render loop, it just leaves that frame (and every frame after it, since
 * the same broken state persists) silently skipping the rest of its own body,
 * most importantly `renderer.render()`. Physics/chunk-streaming keeps running
 * headless while the screen never updates again: a permanent, silent freeze
 * that looks like a stuck/clipped cat with dead input. This has already
 * happened once for a specific throw site (see commit 951b6ac). `runGuarded`
 * turns any *future* instance of this class of bug into a loud, recoverable
 * event instead - see `Game.handleFrameError`.
 *
 * Extracted as a standalone function because `Game` itself needs a live
 * `WebGLRenderer` + Rapier world and cannot be constructed in the test
 * environment - this makes the mechanism unit-testable on its own.
 */
export function runGuarded(fn: () => void, onError: (error: unknown) => void): void {
  try {
    fn();
  } catch (error) {
    onError(error);
  }
}
