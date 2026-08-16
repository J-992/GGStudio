/**
 * Virtual modules supplied by the plugins in `vite-plugins/`.
 *
 * These have no file on disk, so TypeScript needs to be told they resolve.
 */

declare module 'virtual:asset-manifest' {
  /**
   * Content hash per file under `public/assets`, keyed by path relative to that
   * directory (`'graveyard/SM-3-Tomb1.glb'`). Built by `assetManifest()`.
   */
  const manifest: Record<string, string | undefined>;
  export default manifest;
}
