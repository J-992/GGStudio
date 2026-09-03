import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/assets/ProceduralProps';

/**
 * The "Candy City" re-skin's literal colour requirements - pins the exact
 * hex values so a future palette tweak can't silently drift off what was
 * actually asked for.
 */

describe('candy city palette', () => {
  it('has the exact six building colours', () => {
    expect(PALETTE.coastalTeal).toBe(0x9df2c9); // mint green
    expect(PALETTE.coastalPeach).toBe(0xffd4b3); // soft peach
    expect(PALETTE.coastalYellow).toBe(0xfff2b8); // pale yellow
    expect(PALETTE.coastalBlue).toBe(0xb3e0ff); // baby blue
    expect(PALETTE.coastalCream).toBe(0xffc9dd); // pastel pink
    expect(PALETTE.coastalLavender).toBe(0xd6c3f0); // lavender
  });

  it('has the exact four rooftop colours the art direction asks for, plus two connective tones', () => {
    expect(PALETTE.roofCoral).toBe(0xff9eb0); // coral pink
    expect(PALETTE.roofTerracotta).toBe(0xff7a5c); // warm orange-red
    expect(PALETTE.roofWarmGray).toBe(0xc9a8e8); // soft purple
    expect(PALETTE.roofSand).toBe(0x9fe6d9); // light teal
    expect(PALETTE.roofCream).toBe(0xfff5db);
    expect(PALETTE.coastalPeach).toBe(0xffd4b3);
  });

  it('uses no black or near-black tone for a building facade colour', () => {
    const facadeColors = [
      PALETTE.coastalTeal,
      PALETTE.coastalPeach,
      PALETTE.coastalYellow,
      PALETTE.coastalBlue,
      PALETTE.coastalCream,
      PALETTE.coastalLavender,
    ];
    for (const hex of facadeColors) {
      const r = (hex >> 16) & 0xff;
      const g = (hex >> 8) & 0xff;
      const b = hex & 0xff;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(luma).toBeGreaterThan(150); // bright, not dark/black
    }
  });
});
