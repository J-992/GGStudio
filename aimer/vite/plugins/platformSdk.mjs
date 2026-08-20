/**
 * Puts the portal's SDK tag in the document head.
 *
 * Poki's integration checklist asks for their loader in the head of
 * `index.html`, served from their CDN and never bundled -- the script has to be
 * live for them to swap it, and it wants to be resolving while the browser is
 * still fetching Phaser. `src/game/platform/pokiSdk.ts` can inject the tag
 * itself and does when it has to, but that is the recovery path, not the one a
 * submitted build should be taking.
 *
 * The tag cannot simply live in `index.html`, because the same file also builds
 * the playtest link, which has no business reaching out to Poki's CDN. So it is
 * written in here, only for the build that wants it, off the same platform name
 * `vite/config.shared.mjs` inlines for `src/game/platform/platform.ts` to read.
 */

const POKI_SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

export function platformSdk (platform)
{
    return {
        name: 'aimer:platform-sdk',
        transformIndexHtml ()
        {
            if (platform === 'none') return [];

            return [
                {
                    tag: 'script',
                    attrs: { src: POKI_SDK_URL },
                    injectTo: 'head'
                }
            ];
        }
    };
}
