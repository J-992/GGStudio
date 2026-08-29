import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Wires generated loading-screen assets into the first HTML response.
 *
 * The browser chooses a screen before Phaser is fetched. Each choice carries
 * its own low-resolution inline placeholder, aspect ratio, and live-bar
 * rectangle; only that choice's full WebP is then requested.
 */
const SRC = new URL('../src/', import.meta.url);

interface Track {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SplashScreen {
  id: string;
  aspect: number;
  track: Track;
}

const percent = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`;

export function inlineSplash(): Plugin {
  return {
    name: 'merge-ninja:inline-splash',
    // Ahead of Vite's own HTML pass, which would otherwise try to resolve the
    // deliberate placeholder token in the inline CSS as a normal URL.
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        const config = JSON.parse(
          readFileSync(fileURLToPath(new URL('splash-screens.json', SRC)), 'utf8'),
        ) as SplashScreen[];
        const screens = config.map((screen) => ({
          ...screen,
          art: `./assets/loading-splash-${screen.id}.webp`,
          placeholder: `data:image/webp;base64,${readFileSync(
            fileURLToPath(new URL(`splash-inline-${screen.id}.b64`, SRC)),
            'utf8',
          ).trim()}`,
        }));
        const first = screens[0];
        if (first === undefined) throw new Error('at least one splash screen is required');

        return html
          .replace('__SPLASH_PLACEHOLDER__', first.placeholder)
          .replace('__SPLASH_SCREENS__', JSON.stringify(screens))
          .replace('__TRACK_LEFT__', percent(first.track.left))
          .replace('__TRACK_TOP__', percent(first.track.top))
          .replace('__TRACK_WIDTH__', percent(first.track.width))
          .replace('__TRACK_HEIGHT__', percent(first.track.height));
      },
    },
  };
}
