import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Collectible, COLLECT_ANIM_DURATION } from '../src/entities/Collectible';

/**
 * The fish coin's collection feedback.
 *
 * A collected coin used to vanish on the exact frame it was picked up, which
 * gave the pickup no read at all at a run's speed. It now plays a very short
 * "pop" (a swell-and-shrink plus a small rise) before hiding itself - purely
 * a transform animation on the group that already exists, driven by the same
 * per-frame `update()` the pools already call for every fish in a live chunk
 * regardless of whether it has been collected.
 *
 * The thing that must NOT change is scoring: `update()` returns true on
 * exactly one frame, the frame the pickup is detected, and never again while
 * the pop plays out.
 */

const FAR_AWAY = new THREE.Vector3(0, 0, 1000);

function coinAt(x = 0, y = 0, z = 0): Collectible {
  return new Collectible(new THREE.Vector3(x, y, z), 0, true);
}

describe('Collectible collection pop', () => {
  it('scores exactly once, on the frame it is collected', () => {
    const coin = coinAt();
    const player = new THREE.Vector3(0, 0, 0);

    expect(coin.update(1 / 60, FAR_AWAY)).toBe(false);
    expect(coin.update(1 / 60, player)).toBe(true);
    expect(coin.collected).toBe(true);

    // Every later frame, right through the pop and past its end.
    for (let i = 0; i < 60; i++) {
      expect(coin.update(1 / 60, player)).toBe(false);
    }
  });

  it('stays visible for the whole pop, then hides itself', () => {
    const coin = coinAt();
    const player = new THREE.Vector3(0, 0, 0);
    coin.update(1 / 60, player);
    expect(coin.root.visible).toBe(true);

    // Step just short of the duration - still on screen the whole way.
    const step = COLLECT_ANIM_DURATION / 8;
    let elapsed = 0;
    for (let i = 0; i < 7; i++) {
      coin.update(step, player);
      elapsed += step;
      expect(coin.root.visible, `visible at t=${elapsed.toFixed(3)}`).toBe(true);
    }

    // ...and the last step takes it past the end.
    coin.update(step * 2, player);
    expect(coin.root.visible).toBe(false);
  });

  it('actually animates: the coin swells and rises while the pop plays', () => {
    const coin = coinAt(0, 5, 0);
    const player = new THREE.Vector3(0, 5, 0);
    coin.update(1 / 60, player);
    const startY = coin.root.position.y;

    coin.update(COLLECT_ANIM_DURATION / 2, player);
    expect(coin.root.scale.x).toBeGreaterThan(1);
    expect(coin.root.position.y).toBeGreaterThan(startY);
  });

  it('leaves the scale back at 1 once the pop is over, so a recycled coin is clean', () => {
    const coin = coinAt();
    const player = new THREE.Vector3(0, 0, 0);
    coin.update(1 / 60, player);
    coin.update(COLLECT_ANIM_DURATION, player);
    expect(coin.root.scale.x).toBe(1);
    expect(coin.root.visible).toBe(false);
  });

  it('a coin recycled mid-pop never starts the next chunk half-popped', () => {
    // `moveTo()` is how the pool reuses an instance for a fresh chunk - see
    // `FishPool` - and it can land at any point in the 0.16 s window.
    const coin = coinAt();
    const player = new THREE.Vector3(0, 0, 0);
    coin.update(1 / 60, player);
    coin.update(COLLECT_ANIM_DURATION / 2, player);
    expect(coin.root.scale.x).toBeGreaterThan(1);

    coin.moveTo(new THREE.Vector3(3, 2, 40));
    expect(coin.collected).toBe(false);
    expect(coin.root.visible).toBe(true);
    expect(coin.root.scale.x).toBe(1);
    expect(coin.root.position.toArray()).toEqual([3, 2, 40]);

    // And it is collectable again, exactly once.
    expect(coin.update(1 / 60, FAR_AWAY)).toBe(false);
    expect(coin.update(1 / 60, new THREE.Vector3(3, 2, 40))).toBe(true);
    expect(coin.update(1 / 60, new THREE.Vector3(3, 2, 40))).toBe(false);
  });
});
