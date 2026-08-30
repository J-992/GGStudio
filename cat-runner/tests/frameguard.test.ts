import { describe, expect, it, vi } from 'vitest';
import { runGuarded } from '../src/game/frameGuard';

/**
 * `runGuarded` is the mechanism behind `Game.frame()`'s error boundary (see
 * its own doc comment) - a throw anywhere in a frame used to silently freeze
 * the game forever (rAF kept re-arming, but nothing after the throw, most
 * importantly `renderer.render()`, ever ran again). `Game` itself can't be
 * constructed here (needs a live WebGLRenderer + Rapier world), so this
 * tests the mechanism in isolation.
 */
describe('runGuarded', () => {
  it('calls fn and never calls onError on success', () => {
    const fn = vi.fn();
    const onError = vi.fn();
    runGuarded(fn, onError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not rethrow, and calls onError exactly once with the thrown value', () => {
    const boom = new Error('boom');
    const fn = () => {
      throw boom;
    };
    const onError = vi.fn();

    expect(() => runGuarded(fn, onError)).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('lets a throwing onError propagate - it owns its own safety', () => {
    const fn = () => {
      throw new Error('boom');
    };
    const onError = () => {
      throw new Error('handler also broke');
    };

    expect(() => runGuarded(fn, onError)).toThrow('handler also broke');
  });
});
