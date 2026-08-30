/**
 * The URL prefix every runtime asset fetch hangs off.
 *
 * `import.meta.env.BASE_URL` is `'./'` in a production build (see
 * `vite.config.ts`), and a document-relative `./assets/...` resolves against
 * everything up to the last `/` in the *document's* path. Poki serves a build
 * at `https://games.poki.com/<gameId>/<buildId>?tag=...` with no trailing
 * slash, so that rule drops `<buildId>` and every asset 404s - the failure
 * mode that froze the first upload on its loading screen.
 *
 * `index.html` computes the real build directory into `__ASSET_BASE__` before
 * anything else runs, so prefer it and keep `BASE_URL` only as the fallback
 * for the non-browser contexts (the test suite, the headless playtest) where
 * there is no document to measure.
 */
declare global {
  interface Window {
    __ASSET_BASE__?: string;
  }
}

const base =
  (typeof window !== 'undefined' ? window.__ASSET_BASE__ : undefined) ??
  import.meta.env.BASE_URL ??
  '/';

/** Never has a trailing slash, so callers write `${ASSET_BASE}/assets/...`. */
export const ASSET_BASE = base.replace(/\/$/, '');
