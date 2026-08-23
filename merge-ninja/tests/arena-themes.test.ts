import { resolve } from 'node:path';
import { imageSize } from './imageSize';
import { describe, expect, it } from 'vitest';
import {
  ARENA_THEMES,
  FLOOR_THEMES_MANIFEST,
  THEMES_MANIFEST,
  themeForStage,
  themeTransition,
} from '../src/data/arenaThemes';

const LAST_STAGE = 80;
const BOUNDARIES = new Set([10, 19, 28, 37]);
const BACKDROP_FILES: Readonly<Record<string, string>> = {
  dojo_night_backdrop: 'dojo-night-backdrop.webp',
  arena_mountain: 'arena-mountain.webp',
  arena_storm: 'arena-storm.webp',
  arena_rift_stage: 'arena-rift-stage.webp',
  arena_shrine: 'arena-shrine.webp',
};

const backdropDimensions = (filename: string): readonly [number, number] =>
  imageSize(resolve(process.cwd(), 'public', 'assets', filename));

describe('arena theme data', () => {
  it('resolves stages 1..80 deterministically and monotonically through the acts', () => {
    let lastIndex = 0;
    for (let stage = 1; stage <= LAST_STAGE; stage += 1) {
      const t = themeForStage(stage);
      expect(t).toBe(themeForStage(stage));
      const index = ARENA_THEMES.indexOf(t);
      expect(index).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = index;
    }
    expect(themeForStage(0).id).toBe(themeForStage(1).id);
    expect(themeForStage(3.7).id).toBe(themeForStage(3).id);
  });

  it('switches acts exactly at stages 10, 19, 28, 37', () => {
    for (let stage = 1; stage <= LAST_STAGE; stage += 1) {
      expect(themeTransition(stage, stage + 1)).toBe(BOUNDARIES.has(stage + 1));
      expect(themeTransition(stage, stage)).toBe(false);
    }
    expect(themeForStage(9).id).toBe('dojo-dusk');
    expect(themeForStage(10).id).toBe('mountain-temple');
    expect(themeForStage(18).id).toBe('mountain-temple');
    expect(themeForStage(19).id).toBe('storm-sea');
    expect(themeForStage(27).id).toBe('storm-sea');
    expect(themeForStage(28).id).toBe('rift');
    expect(themeForStage(36).id).toBe('rift');
  });

  it('pins stage 37+ to the dragon shrine', () => {
    for (const stage of [37, 38, 49, 63, LAST_STAGE, 120, 999]) {
      expect(themeForStage(stage).id).toBe('dragon-shrine');
      expect(themeForStage(stage).backdropKey).toBe('arena_shrine');
    }
  });

  it('uses distinct backdrop keys covered by the manifest', () => {
    const keys = ARENA_THEMES.map((t) => t.backdropKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(THEMES_MANIFEST).toContain(key);
  });

  it('pairs every act with one distinct preloaded perspective floor', () => {
    const keys = ARENA_THEMES.map((t) => t.floorTextureKey);
    expect(new Set(keys).size).toBe(ARENA_THEMES.length);
    expect(keys).toEqual(FLOOR_THEMES_MANIFEST);
  });

  it('holds every act backdrop to the stage-1 source resolution', () => {
    const stageOneDimensions = backdropDimensions(BACKDROP_FILES.dojo_night_backdrop!);
    for (const key of THEMES_MANIFEST) {
      expect(backdropDimensions(BACKDROP_FILES[key]!)).toEqual(stageOneDimensions);
    }
    expect(stageOneDimensions).toEqual([1672, 941]);
  });

  it('manifest matches the expected BootScene preload list exactly', () => {
    expect([...THEMES_MANIFEST]).toEqual([
      'dojo_night_backdrop',
      'arena_mountain',
      'arena_storm',
      'arena_rift_stage',
      'arena_shrine',
    ]);
    const derived = Array.from(new Set(ARENA_THEMES.map((t) => t.backdropKey)));
    expect(THEMES_MANIFEST.every((k) => derived.includes(k))).toBe(true);
  });

  it('keeps every theme structurally valid with contiguous stage ranges', () => {
    let nextStart = 1;
    for (const t of ARENA_THEMES) {
      expect(t.stageRange[0]).toBe(nextStart);
      expect(t.label.length).toBeGreaterThan(0);
      expect(['planks', 'stone']).toContain(t.floor.plankOrStone);
      const colors = [
        t.accent, t.sky.top, t.sky.bottom,
        t.floor.baseColor, t.floor.lightColor, t.floor.shadowColor,
        t.portalTint, t.vfxTint,
      ];
      for (const c of colors) {
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
      nextStart = t.stageRange[1] === null ? nextStart : t.stageRange[1] + 1;
    }
    expect(ARENA_THEMES[ARENA_THEMES.length - 1]!.stageRange[1]).toBeNull();
  });
});
