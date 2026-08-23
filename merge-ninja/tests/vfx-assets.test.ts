import { resolve } from 'node:path';
import { imageSize } from './imageSize';
import { describe, expect, it } from 'vitest';
import {
  VFX_ANIMATION_ORDER,
  VFX_ANIMATIONS,
  vfxDurationMs,
} from '../src/data/vfxAssets';

describe('authored VFX strips', () => {
  it('keeps every effect in one complete, uniquely keyed registry', () => {
    expect(VFX_ANIMATION_ORDER).toHaveLength(7);
    expect(new Set(VFX_ANIMATION_ORDER).size).toBe(VFX_ANIMATION_ORDER.length);
    expect(Object.keys(VFX_ANIMATIONS).sort()).toEqual([...VFX_ANIMATION_ORDER].sort());
    expect(new Set(VFX_ANIMATION_ORDER.map((id) => VFX_ANIMATIONS[id].textureKey)).size).toBe(7);
    expect(new Set(VFX_ANIMATION_ORDER.map((id) => VFX_ANIMATIONS[id].animationKey)).size).toBe(7);
  });

  it('ships each animation as exactly eight equal 256px RGBA-ready frames', () => {
    for (const id of VFX_ANIMATION_ORDER) {
      const def = VFX_ANIMATIONS[id];
      const [width, height] = imageSize(resolve(process.cwd(), 'public', def.path));
      expect(width).toBe(def.frameWidth * def.frames);
      expect(height).toBe(def.frameHeight);
      expect(def.frameWidth).toBe(256);
      expect(def.frameHeight).toBe(256);
      expect(def.frames).toBe(8);
    }
  });

  it('keeps one-shot effects brief enough to read without stalling play', () => {
    for (const id of VFX_ANIMATION_ORDER) {
      expect(vfxDurationMs(id)).toBeGreaterThanOrEqual(250);
      expect(vfxDurationMs(id)).toBeLessThanOrEqual(500);
    }
  });
});
