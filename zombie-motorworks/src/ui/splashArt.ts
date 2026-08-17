/**
 * The painted key art: what a player looks at while something is loading, and
 * what the rig picker shows for a rig under the pointer.
 *
 * Two jobs, one module, because they share the same asset folder and the same
 * pair of problems. The first is that a background image which arrives late is
 * worse than no image at all — it lands as a flash halfway through a load — so
 * everything here is preloaded before the surface that shows it is opened. The
 * second is legibility: every one of these is a busy, high-contrast painting,
 * and the bar, the label and the card's own glyphs have to stay readable on top
 * of it, which is what {@link SPLASH_SCRIM} is for.
 *
 * The boot splash in `index.html` cannot import this — it paints before the
 * module graph exists — so it carries its own copy of the two loading paths.
 * Renaming a file under `public/assets/splash` means editing there too.
 */

import { assetUrl } from '../core/assetVersion.ts';
import { BUILD_IDS, type BuildId } from '../core/builds.ts';

const SPLASH_ROOT = `${import.meta.env.BASE_URL}assets/splash`;

/**
 * Full-bleed art for loading screens, in no particular order.
 *
 * Two of them rather than one so the wait between waves is not the same picture
 * every time; a run sees both within its first few arena loads.
 *
 * Keep in sync with the array inlined in `index.html`.
 */
export const LOADING_SPLASH_URLS: readonly string[] = [
  assetUrl(`${SPLASH_ROOT}/loading-overrun.webp`),
  assetUrl(`${SPLASH_ROOT}/loading-breakout.webp`),
];

/** Key art per starting rig, keyed by build id. */
export const RIG_SPLASH_URLS: Record<BuildId, string> = {
  light: assetUrl(`${SPLASH_ROOT}/rig-light.webp`),
  medium: assetUrl(`${SPLASH_ROOT}/rig-medium.webp`),
  heavy: assetUrl(`${SPLASH_ROOT}/rig-heavy.webp`),
};

/**
 * The wash that goes over any of this art before UI is drawn on top.
 *
 * Darker at the edges than in the middle: the paintings all put their subject
 * centre-frame, and a flat 60% black would either bury it or leave the corners
 * — where the labels sit — too bright to read against.
 */
export const SPLASH_SCRIM =
  'radial-gradient(ellipse at center, rgb(6 8 6 / 0.42) 0%, ' +
  'rgb(6 8 6 / 0.72) 62%, rgb(6 8 6 / 0.9) 100%)';

/** One of the loading paintings, chosen at random. */
export function pickLoadingSplash(): string {
  const index = Math.floor(Math.random() * LOADING_SPLASH_URLS.length);
  // `Math.random()` can return values that round up at 1 through floating point,
  // and an undefined URL here would paint nothing at all.
  return LOADING_SPLASH_URLS[Math.min(index, LOADING_SPLASH_URLS.length - 1)];
}

/**
 * Paint `url` as a scrimmed, cover-fit background on `element`.
 *
 * Written as one `background` shorthand so a caller that also sets a flat
 * colour cannot end up with a half-applied stack.
 */
export function applySplashBackground(
  element: HTMLElement,
  url: string,
  scrim: string = SPLASH_SCRIM,
): void {
  element.style.background = `${scrim}, #0b0d0b center / cover no-repeat url("${url}")`;
}

const preloaded = new Set<string>();

/**
 * Warm the browser cache for `urls`, at most once each per session.
 *
 * Fire-and-forget: a failed decode is not worth reporting, because every
 * surface that shows this art already has a solid background behind it.
 */
export function preloadSplashArt(urls: Iterable<string>): void {
  for (const url of urls) {
    if (preloaded.has(url)) continue;
    preloaded.add(url);
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  }
}

/** Every rig painting, for the picker to warm before it opens. */
export function preloadRigSplashArt(): void {
  preloadSplashArt(BUILD_IDS.map((id) => RIG_SPLASH_URLS[id]));
}
