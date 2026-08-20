/// <reference types="vite/client" />

//  Merges into Vite's own ImportMetaEnv.
interface ImportMetaEnv
{
    /**
     * Whether this build talks to Poki. Inlined as a literal by
     * `vite/config.shared.mjs` so the bundler can fold the branch in
     * `src/game/platform/platform.ts` and drop the unused platform entirely.
     */
    readonly VITE_POKI: boolean;
}
