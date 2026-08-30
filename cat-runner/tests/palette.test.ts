import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/assets/ProceduralProps';

/**
 * The "colorful coastal city" re-skin's literal colour requirements - pins
 * the exact hex values so a future palette tweak can't silently drift off
 * what was actually asked for.
 */

describe('coastal palette', () => {
  it('has the exact five building colours', () => {
    expect(PALETTE.coastalTeal).toBe(0x5dd9c1);
    expect(PALETTE.coastalPeach).toBe(0xffbe98);
    expect(PALETTE.coastalYellow).toBe(0xffd54f);
    expect(PALETTE.coastalBlue).toBe(0xa7d8ff);
    expect(PALETTE.coastalCream).toBe(0xfff3d1);
  });

  it('has the exact three rooftop colours, all warm/sunlit tones', () => {
    expect(PALETTE.roofCream).toBe(0xfff3d1);
    expect(PALETTE.roofSand).toBe(0xf5d7a1);
    expect(PALETTE.roofTerracotta).toBe(0xe8b07a);
  });
});
