/**
 * The bridge between Phaser's loader and the HTML loading screen.
 *
 * The splash is markup in `index.html` rather than a Phaser scene, because a
 * Phaser scene cannot exist until Phaser has been downloaded and parsed -- 1.4
 * MB of it -- which is most of the wait it would be reporting on. The markup
 * paints on the first frame; this module just moves its bar.
 *
 * Everything here tolerates the elements being absent. A missing splash must
 * never be able to stop the game from starting, so each lookup is optional and
 * each call is a no-op if the loading screen was removed or never rendered.
 */

const FADE_MS = 420;

let splash: HTMLElement | null = null;
let fill: HTMLElement | null = null;
let resolved = false;

function elements(): void {
  if (resolved) return;
  resolved = true;
  splash = document.getElementById('splash');
  fill = document.getElementById('splash-fill');
}

/**
 * Moves the bar. `value` is Phaser's 0..1 loader progress.
 *
 * The bar is deliberately not allowed to reach 100% here: the file loader
 * finishing is not the same moment as the game being ready, because textures
 * still have to be uploaded and animations built afterwards. A bar that sits
 * full for half a second reads as a hang, so the loader's own progress is
 * mapped onto 0..94% and `finish()` covers the rest.
 */
export function setSplashProgress(value: number): void {
  elements();
  if (fill === null) return;
  const clamped = Math.max(0, Math.min(1, value));
  fill.style.width = `${(clamped * 94).toFixed(1)}%`;
}

/**
 * Fills the bar, fades the screen out, and takes it out of the document.
 *
 * Removal matters: left in place the splash is a full-screen element sitting on
 * top of the canvas, and while it is invisible it would still be swallowing
 * every touch aimed at the game underneath it.
 */
export function finishSplash(): void {
  elements();
  if (splash === null) return;
  if (fill !== null) fill.style.width = '100%';

  const node = splash;
  node.classList.add('is-done');
  window.setTimeout(() => node.remove(), FADE_MS);
  splash = null;
  fill = null;
}
