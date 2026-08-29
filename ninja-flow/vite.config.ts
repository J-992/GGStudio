import { defineConfig } from 'vite';

export default defineConfig({
  // Poki serves the build from a versioned sub-path, so every URL must be relative.
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // three is the only heavy vendor chunk; splitting it keeps the game code
        // cache-bustable on its own during rapid Poki iteration.
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  server: { host: true },
});
