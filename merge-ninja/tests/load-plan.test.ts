import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOOT_BOSS_APPEARANCES,
  BOOT_NINJA_TIERS,
  bootPortraits,
  bootThemeArt,
  deferredPortraits,
  deferredThemeArt,
  FIRST_SESSION,
  type ResumePoint,
} from '../src/render/loadPlan';
import {
  BOSS_CATALOG_PORTRAITS,
  NINJA_CATALOG_PORTRAITS,
} from '../src/render/atlasConfig';
import { ARENA_THEMES, themeForStage } from '../src/data/arenaThemes';
import { bossForStage } from '../src/data/enemies';
import { ninjaDef } from '../src/data/ninjas';

const assetPath = (path: string): string => resolve(process.cwd(), 'public', path);

const atlasFrames = (): ReadonlySet<string> => {
  const json = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/assets/game.json'), 'utf8'),
  ) as { frames: Record<string, unknown> };
  return new Set(Object.keys(json.frames));
};

/** A first session, a mid-game save, and a late one. */
const RESUMES: readonly ResumePoint[] = [
  FIRST_SESSION,
  { stage: 14, highestTier: 7, boardTiers: [3, 5, 7, 7] },
  { stage: 41, highestTier: 22, boardTiers: [18, 20, 22] },
  { stage: 80, highestTier: 29, boardTiers: [26, 29] },
];

/**
 * The load plan is the one place where art can go missing silently.
 *
 * Anything in neither list is never requested at all, and Phaser answers a
 * request for an unloaded texture with its green missing-texture pattern rather
 * than an error -- so art dropped from both lists ships, and shows up mid-fight.
 * These tests exist so that mistake fails here instead.
 */
describe('load plan', () => {
  it.each(RESUMES)('accounts for every catalog portrait exactly once (stage $stage)', (at) => {
    const planned = [...bootPortraits(at), ...deferredPortraits(at)].map((p) => p.textureKey);
    const all = [...NINJA_CATALOG_PORTRAITS, ...BOSS_CATALOG_PORTRAITS].map((p) => p.textureKey);

    expect(new Set(planned).size).toBe(planned.length);
    expect([...planned].sort()).toEqual([...all].sort());
  });

  it.each(RESUMES)('accounts for every backdrop and floor exactly once (stage $stage)', (at) => {
    const planned = [...bootThemeArt(at), ...deferredThemeArt(at)].map((a) => a.key);
    const all = ARENA_THEMES.flatMap((t) => [t.backdropKey, t.floorTextureKey]);

    expect(new Set(planned).size).toBe(planned.length);
    expect([...planned].sort()).toEqual([...all].sort());
  });

  it('points every planned load at a file that exists', () => {
    for (const at of RESUMES) {
      for (const portrait of [...bootPortraits(at), ...deferredPortraits(at)]) {
        expect(existsSync(assetPath(portrait.texturePath))).toBe(true);
      }
      for (const art of [...bootThemeArt(at), ...deferredThemeArt(at)]) {
        expect(existsSync(assetPath(art.path))).toBe(true);
      }
    }
  });

  /**
   * The regression this whole resume-point mechanism exists for: a save
   * restored into act four booted act one's art, so the arena drew the
   * missing-texture pattern until the stream happened to reach that backdrop.
   * Backdrops have no stand-in, so this has to be right at boot, not eventually.
   */
  it.each(RESUMES)('boots the room the save resumes into (stage $stage)', (at) => {
    const booted = new Set(bootThemeArt(at).map((a) => a.key));
    const room = themeForStage(at.stage);

    expect(booted.has(room.backdropKey)).toBe(true);
    expect(booted.has(room.floorTextureKey)).toBe(true);
    // GameScene paints this behind the whole screen at every stage.
    expect(booted.has(ARENA_THEMES[0]!.backdropKey)).toBe(true);
  });

  it.each(RESUMES)('boots the boss and roster art the save opens on (stage $stage)', (at) => {
    const booted = new Set(bootPortraits(at).map((p) => p.textureKey));

    expect(booted.has(bossForStage(at.stage).textureKey)).toBe(true);
    expect(booted.has(ninjaDef(at.highestTier).textureKey)).toBe(true);
  });

  it('boots enough headroom to cover the opening half minute of a new game', () => {
    // Lead times from tests/pacing.test.ts: stage 4 lands at ~16 s and tier 5
    // at ~32 s. If the boot set shrinks below that, stand-in art stops being
    // something only a bad connection ever shows.
    const booted = new Set(bootPortraits().map((p) => p.textureKey));
    for (let stage = 1; stage <= BOOT_BOSS_APPEARANCES; stage += 1) {
      expect(booted.has(bossForStage(stage).textureKey)).toBe(true);
    }
    for (let tier = 1; tier <= BOOT_NINJA_TIERS; tier += 1) {
      expect(booted.has(ninjaDef(tier).textureKey)).toBe(true);
    }
  });

  it.each(RESUMES)('boots the complete catalog before the scene starts (stage $stage)', (at) => {
    const total = NINJA_CATALOG_PORTRAITS.length + BOSS_CATALOG_PORTRAITS.length;
    expect(bootPortraits(at)).toHaveLength(total);
  });

  it('defers neither character nor arena art', () => {
    expect(deferredPortraits()).toEqual([]);
    expect(deferredThemeArt()).toEqual([]);
  });

  it('gives every roster and boss entry an atlas frame to stand in with', () => {
    // portraitTexture.ts falls back to `spriteKey` whenever the real portrait
    // has not arrived. A spriteKey that is not in the packed atlas would make
    // that fallback draw the very green box it exists to prevent.
    const frames = atlasFrames();
    for (let tier = 1; tier <= NINJA_CATALOG_PORTRAITS.length; tier += 1) {
      expect(frames.has(ninjaDef(tier).spriteKey)).toBe(true);
    }
    for (let stage = 1; stage <= BOSS_CATALOG_PORTRAITS.length; stage += 1) {
      expect(frames.has(bossForStage(stage).spriteKey)).toBe(true);
    }
  });
});
