import { defineConfig } from 'vitest/config';
import { dropDevArt } from './vite-plugins/dropDevArt';
import { inlineSplash } from './vite-plugins/inlineSplash';
import { platformSdk } from './vite-plugins/platformSdk';

/**
 * `--mode poki` is what makes a Poki build: it injects their loader tag and
 * inlines `__POKI__` as a literal `true`, which is what lets Rollup fold the
 * branch in `src/platform/platform.ts`. Every other mode -- the dev server,
 * `npm run build` -- gets a literal `false`, and the Poki module drops out of
 * the bundle entirely, along with any mention of their CDN.
 */
export default defineConfig(({ mode }) => {
  const poki = mode === 'poki';

  return {
    base: './',
    define: { __POKI__: JSON.stringify(poki) },
    plugins: [platformSdk(poki), inlineSplash(), dropDevArt()],
    server: { port: 5180, host: true },
    build: {
      target: 'es2020',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks: { phaser: ['phaser'] },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
