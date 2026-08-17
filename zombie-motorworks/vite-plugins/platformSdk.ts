import type { Plugin } from 'vite';

/**
 * Put the portal's SDK tag in the document head.
 *
 * Poki's integration checklist asks for their loader in the head of
 * `index.html`, served from their CDN and never bundled — the SDK has to be
 * live for them to swap it, and it wants to be resolving before the module
 * graph starts fetching 17 MB of game. `src/app/pokiSdk.ts` can inject the tag
 * itself and does when it has to, but that is the recovery path, not the one a
 * submitted build should be taking.
 *
 * The tag cannot simply live in `index.html`, because the same file builds for
 * CrazyGames and for the Vercel playtest link, and neither should be reaching
 * out to Poki's CDN. So it is written in here, only for the build that wants
 * it, keyed off the same `VITE_PLATFORM` value `src/app/platform.ts` reads.
 */

const POKI_SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

export function platformSdk(): Plugin {
  let platform = '';
  return {
    name: 'scrap-rig:platform-sdk',
    configResolved(config) {
      platform = (config.env.VITE_PLATFORM as string | undefined)?.trim() ?? '';
    },
    transformIndexHtml() {
      if (platform !== 'poki') return [];
      return [
        {
          tag: 'script',
          attrs: { src: POKI_SDK_URL },
          injectTo: 'head',
        },
      ];
    },
  };
}
