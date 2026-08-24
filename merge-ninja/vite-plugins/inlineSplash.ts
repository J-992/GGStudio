import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Wires the loading screen's generated pieces into the document.
 *
 * Three things come from `tools/make_splash.py` and none of them belong in
 * hand-written HTML:
 *
 *   The placeholder. A ~1 KB blur of the key art, inlined as a data URI so it
 *   paints on the browser's first frame. As a file it would be a request queued
 *   alongside the 1.4 MB bundle it exists to cover for; as base64 in the head
 *   it is already in the bytes being parsed. It is kept in its own file rather
 *   than pasted into `index.html` so regenerating the art is a script run
 *   instead of a hand edit of a long line.
 *
 *   The groove coordinates. The real progress bar is a DOM element sitting on
 *   top of the bar painted into the art, which only looks right if the two are
 *   registered exactly. The script measures the groove off the image and writes
 *   fractions; they become percentages here.
 *
 *   The preload hint. The full-quality art should be in flight before the
 *   module script is even discovered, so it is announced in the head rather
 *   than waiting to be found on an `<img>` near the end of the body.
 */
const SRC = new URL('../src/', import.meta.url);

const SPLASH_ART = './assets/loading-splash.webp';

interface Track {
  left: number;
  top: number;
  width: number;
  height: number;
}

const percent = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`;

export function inlineSplash(): Plugin {
  return {
    name: 'merge-ninja:inline-splash',
    // Ahead of Vite's own HTML pass. It walks `url()` values looking for assets
    // to rewrite, and would otherwise reach the placeholder first and warn that
    // it cannot resolve a file called `__SPLASH_PLACEHOLDER__`.
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        const b64 = readFileSync(fileURLToPath(new URL('splash-inline.b64', SRC)), 'utf8').trim();
        const track = JSON.parse(
          readFileSync(fileURLToPath(new URL('splash-track.json', SRC)), 'utf8'),
        ) as Track;

        const withArt = html
          .replace('__SPLASH_PLACEHOLDER__', `data:image/webp;base64,${b64}`)
          .replace('__TRACK_LEFT__', percent(track.left))
          .replace('__TRACK_TOP__', percent(track.top))
          .replace('__TRACK_WIDTH__', percent(track.width))
          .replace('__TRACK_HEIGHT__', percent(track.height));

        return {
          html: withArt,
          tags: [
            {
              tag: 'link',
              attrs: { rel: 'preload', as: 'image', href: SPLASH_ART },
              injectTo: 'head' as const,
            },
          ],
        };
      },
    },
  };
}
