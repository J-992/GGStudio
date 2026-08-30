import { describe, expect, it, afterEach } from 'vitest';

import { getMaterial, disposeProceduralCache } from '../src/assets/ProceduralProps';

/**
 * Shared-resource marking.
 *
 * `userData.shared` is the contract that is supposed to stand between level
 * teardown and freeing the caches' GPU resources out from under every object
 * still holding them - `Cat.collectMaterials` clears it on a cloned material
 * for exactly this reason. There is currently no live disposal path that
 * reads the flag (the helper that used to - `disposeObject` - was unused dead
 * code and has been removed), so these tests only cover the marking itself,
 * not the skip-on-dispose behaviour it exists to enable.
 */

describe('shared resource marking', () => {
  afterEach(() => {
    disposeProceduralCache();
  });

  it('marks cached procedural materials as shared', () => {
    const mat = getMaterial(0x123456);
    expect(mat.userData.shared).toBe(true);
  });

  it('hands out the same material instance for the same key', () => {
    expect(getMaterial(0x123456)).toBe(getMaterial(0x123456));
    expect(getMaterial(0x123456)).not.toBe(getMaterial(0x654321));
  });
});
