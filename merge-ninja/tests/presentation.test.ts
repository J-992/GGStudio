import { describe, expect, it } from 'vitest';
import { BOSS_COUNT } from '../src/data/enemies';
import { BALANCE } from '../src/data/balance';
import {
  almanacPageCount,
  almanacPageSlice,
  bossScale,
  FLAME_SHOGUN_IDLE_FOUR_FRAME,
  fourFramePoseAt,
  HUMANOID_BOSS_BASIC_FOUR_FRAME,
  HUMANOID_BOSS_IDLE_FOUR_FRAME,
  HUMANOID_BOSS_SPECIAL_FOUR_FRAME,
  NINJA_BASIC_FOUR_FRAME,
  ninjaIdleFrameAt,
  ninjaBoardAnchorY,
  NINJA_IDLE_FOUR_FRAME,
  NINJA_SPECIAL_FOUR_FRAME,
  ninjaScale,
} from '../src/data/presentation';
import { REVEAL_ASSETS, REVEAL_NINJA_RIGS, revealNinjaRig } from '../src/render/revealAssets';

const ARENA = { w: 735, h: 570 };

describe('New Ninja ceremony art', () => {
  it('uses a dedicated uniquely keyed asset set', () => {
    const assets = Object.values(REVEAL_ASSETS);
    expect(new Set(assets.map((asset) => asset.key)).size).toBe(assets.length);
    expect(new Set(assets.map((asset) => asset.path)).size).toBe(assets.length);
    for (const asset of assets) expect(asset.path).toMatch(/^assets\/ui\/new-ninja-reveal-.+\.webp$/);
  });

  it('rigs every ninja reveal to visible pixels inside its source frame', () => {
    expect(REVEAL_NINJA_RIGS).toHaveLength(29);
    for (let tier = 1; tier <= REVEAL_NINJA_RIGS.length; tier += 1) {
      const bounds = revealNinjaRig(tier);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.w).toBeLessThanOrEqual(bounds.frameW);
      expect(bounds.y + bounds.h).toBeLessThanOrEqual(bounds.frameH);
    }
  });
});

describe('boss presence', () => {
  it('makes a same-shaped boss clearly larger than a ninja', () => {
    const ninja = ninjaScale(128, 128, 96);
    const boss = bossScale(128, 128, 190, ARENA);

    expect(boss / ninja).toBeGreaterThan(1.6);
  });

  it('gives the wide final ninja more board presence than a normal ninja', () => {
    const normalFootprint = 128 * ninjaScale(128, 128, 96);
    const finalFootprint = 256 * ninjaScale(256, 256, 96, 29);

    expect(finalFootprint).toBeGreaterThan(normalFootprint);
    expect(finalFootprint / normalFootprint).toBeCloseTo(3);
  });

  it('keeps the final ninja feet on the merge tile despite its 256px frame', () => {
    const scale = ninjaScale(256, 256, 128, 29);
    const centreY = ninjaBoardAnchorY(256, scale, 18, 29);

    // The bottom of a 256px frame is 128px below its centre. It should land
    // at the same 2px visual foot inset as every normal board ninja.
    expect(centreY + 128 * scale).toBeCloseTo(2);
  });

  it('still reads as big when the art is squat and wide', () => {
    const tall = bossScale(128, 200, 190, ARENA);
    const squat = bossScale(220, 96, 190, ARENA);

    // Scaling on height alone shrinks a wide, short boss into a smudge. Both
    // shapes have to end up covering a comparable amount of the stage.
    const area = (w: number, h: number, s: number): number => w * s * h * s;
    expect(area(220, 96, squat) / area(128, 200, tall)).toBeGreaterThan(0.6);
    expect(area(220, 96, squat) / area(128, 200, tall)).toBeLessThan(1.7);
    expect(squat).toBeGreaterThan(ninjaScale(220, 96, 96));
  });

  it('never lets a boss outgrow the stage it stands on', () => {
    for (const [w, h] of [[128, 128], [512, 512], [1024, 300], [300, 1024]] as const) {
      const scale = bossScale(w, h, 190, ARENA);
      expect(h * scale).toBeLessThanOrEqual(ARENA.h * 0.62);
      expect(w * scale).toBeLessThanOrEqual(ARENA.w * 0.52);
      expect(scale).toBeGreaterThan(0);
    }
  });
});

describe('four-frame character motion', () => {
  const animations = [
    NINJA_IDLE_FOUR_FRAME,
    FLAME_SHOGUN_IDLE_FOUR_FRAME,
    NINJA_BASIC_FOUR_FRAME,
    NINJA_SPECIAL_FOUR_FRAME,
    HUMANOID_BOSS_IDLE_FOUR_FRAME,
    HUMANOID_BOSS_BASIC_FOUR_FRAME,
    HUMANOID_BOSS_SPECIAL_FOUR_FRAME,
  ];

  it('keeps every idle, basic, and special move at exactly four poses', () => {
    for (const animation of animations) expect(animation).toHaveLength(4);
  });

  it('resolves each frame in order and loops back to the ready pose', () => {
    for (const animation of animations) {
      let elapsed = 0;
      for (let index = 0; index < animation.length; index += 1) {
        expect(fourFramePoseAt(animation, elapsed).index).toBe(index);
        elapsed += animation[index]!.duration;
      }
      expect(fourFramePoseAt(animation, elapsed).index).toBe(0);
    }
  });

  it('keeps idle frame timing neutral so the source strip, never a container transform, moves the weapon', () => {
    for (const pose of NINJA_IDLE_FOUR_FRAME) {
      expect(pose).toMatchObject({ x: 0, y: 0, angle: 0, scaleX: 1, scaleY: 1 });
    }
  });

  it('resolves every ninja strip through four visible idle frames', () => {
    const frames = [0, 260, 430, 600].map((elapsed) => ninjaIdleFrameAt(elapsed, 0, false));

    expect(frames).toEqual([0, 1, 2, 3]);
  });
});

describe('almanac paging', () => {
  const perSection = 12;

  it('covers the whole roster rather than only the first page', () => {
    const pages = almanacPageCount(BALANCE.tiers.count, BOSS_COUNT, perSection);
    const seenNinjas = new Set<number>();
    const seenBosses = new Set<number>();

    for (let page = 0; page < pages; page += 1) {
      const ninjas = almanacPageSlice(BALANCE.tiers.count, page, perSection);
      const bosses = almanacPageSlice(BOSS_COUNT, page, perSection);
      for (let i = ninjas.start; i < ninjas.end; i += 1) seenNinjas.add(i);
      for (let i = bosses.start; i < bosses.end; i += 1) seenBosses.add(i);
    }

    expect(seenNinjas.size).toBe(BALANCE.tiers.count);
    expect(seenBosses.size).toBe(BOSS_COUNT);
  });

  it('sizes the book by whichever list is longer', () => {
    expect(almanacPageCount(50, 54, 12)).toBe(5);
    expect(almanacPageCount(50, 4, 12)).toBe(5);
    expect(almanacPageCount(0, 0, 12)).toBe(1);
  });

  it('runs the shorter list out instead of wrapping it', () => {
    const last = almanacPageSlice(4, 3, 12);
    expect(last.end - last.start).toBe(0);
  });

  it('never returns a slice past the end of a list', () => {
    for (let page = 0; page < 8; page += 1) {
      const slice = almanacPageSlice(50, page, 12);
      expect(slice.start).toBeGreaterThanOrEqual(0);
      expect(slice.end).toBeLessThanOrEqual(50);
      expect(slice.end).toBeGreaterThanOrEqual(slice.start);
    }
  });
});
