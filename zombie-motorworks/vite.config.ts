import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

import { assetManifest } from './vite-plugins/assetManifest.ts';
import { platformSdk } from './vite-plugins/platformSdk.ts';
import { rapierWasm, rapierWasmAssertion } from './vite-plugins/rapierWasm.ts';

/**
 * Serve `art-src/` in dev.
 *
 * The OBJ and FBX sources the arena props are built from used to live in
 * `public/`, which meant they shipped to every player alongside the GLBs built
 * from them. They moved out; the portrait renderer (`scripts/render-portraits`,
 * driving `portrait.html`) still needs the originals, because it poses walkers
 * by moving individual triangles and so depends on OBJ's unwelded output.
 * This hands them to it in dev, and only in dev.
 */
function artSourceDir(): Plugin {
  return {
    name: 'scrap-rig:art-src',
    apply: 'serve',
    configureServer(server) {
      const root = path.join(server.config.root, 'art-src');
      server.middlewares.use('/art-src', (req, res, next) => {
        const requested = decodeURIComponent((req.url ?? '').split('?')[0]);
        const full = path.join(root, requested);
        // Refuse anything that escapes the directory; this is a dev server, but
        // a path-traversal hole is a path-traversal hole.
        if (!full.startsWith(root) || !fs.existsSync(full)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(full).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    rapierWasm(),
    rapierWasmAssertion(),
    assetManifest(),
    platformSdk(),
    artSourceDir(),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        // Three and Rapier are the bulk of the bundle and change only when we
        // bump them. Splitting them out lets a returning player reuse both from
        // cache when only game code shipped, and lets the browser fetch the
        // three chunks in parallel on a cold load.
        manualChunks(id: string) {
          if (id.includes('node_modules/@dimforge/rapier3d-compat')) {
            return 'rapier';
          }
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
});
