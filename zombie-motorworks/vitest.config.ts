import { defineConfig } from 'vitest/config';

import { assetManifest } from './vite-plugins/assetManifest.ts';

export default defineConfig({
  // The unit suite imports real modules, and several of them reach the asset
  // URL helper, which reads the build-time hash manifest. Without the plugin
  // that publishes it, `virtual:asset-manifest` is simply unresolvable and
  // every one of those imports fails.
  plugins: [assetManifest()],
  test: {
    include: ['unit/**/*.test.ts'],
    environment: 'node',
  },
});
