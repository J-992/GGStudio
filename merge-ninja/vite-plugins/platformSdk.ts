import type { Plugin } from 'vite';

/**
 * Puts the portal's SDK tag in the document head.
 *
 * Poki's integration checklist asks for their loader in the head of
 * `index.html`, served from their CDN and never bundled -- the script has to be
 * live for them to swap it, and it wants to be resolving while the browser is
 * still fetching Phaser. `src/platform/pokiSdk.ts` can inject the tag itself
 * and does when it has to, but that is the recovery path, not the one a
 * submitted build should be taking.
 *
 * The tag cannot simply live in `index.html`, because the same file also builds
 * the CrazyGames and playtest bundles, which have no business reaching out to
 * Poki's CDN. So it is written in here, only for the build that wants it.
 */
const POKI_SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

export function platformSdk(poki: boolean): Plugin {
  return {
    name: 'merge-ninja:platform-sdk',
    transformIndexHtml() {
      if (!poki) return [];

      return [
        { tag: 'script', attrs: { src: POKI_SDK_URL }, injectTo: 'head' as const },
      ];
    },
  };
}
