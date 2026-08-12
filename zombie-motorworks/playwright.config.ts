import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4183',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    // The suite drives the app through the `?debug=1` seam, which a production
    // bundle only exposes when built with VITE_E2E=1. Building here rather than
    // previewing whatever `dist/` happens to hold also keeps a stale build from
    // silently deciding the results — and keeps the shipped bundle seamless.
    command:
      'VITE_E2E=1 npx vite build && npx vite preview --port 4183 --strictPort',
    url: 'http://localhost:4183',
    reuseExistingServer: !process.env.CI,
  },
});
