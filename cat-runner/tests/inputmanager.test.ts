import { describe, expect, it, afterEach, vi } from 'vitest';

import { detectTouchCapability } from '../src/game/InputManager';

/**
 * `InputManager` itself unconditionally calls `window.addEventListener` in
 * its constructor, which isn't meaningful to exercise in this suite's plain
 * Node environment (see vitest.config.ts) - that's left to manual/browser
 * testing. `detectTouchCapability()` is pure logic, though, and is exactly
 * the piece that fixed a real bug (touch controls never auto-mounting on a
 * first-time mobile visitor), so it's worth covering directly.
 */
describe('detectTouchCapability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false with no window or navigator', () => {
    expect(detectTouchCapability()).toBe(false);
  });

  it('returns false when neither signal is present', () => {
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    vi.stubGlobal('window', { matchMedia: (_query: string) => ({ matches: false }) });
    expect(detectTouchCapability()).toBe(false);
  });

  it('returns true when maxTouchPoints > 0', () => {
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    expect(detectTouchCapability()).toBe(true);
  });

  it('returns true when the pointer is coarse', () => {
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }) });
    expect(detectTouchCapability()).toBe(true);
  });
});
