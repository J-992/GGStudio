import { defineConfig } from 'vitest/config';

/**
 * Test config kept separate from vite.config.ts so the production build never
 * pulls in vitest types or transforms.
 *
 * The suite runs in plain Node: it covers pure logic (save validation, route
 * maths, state transitions, level data) and deliberately avoids WebGL and the
 * Rapier WASM, which need a real browser to be meaningful.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
