import { describe, expect, it } from 'vitest';
import { BOSS_COUNT } from '../src/data/enemies';
import { bossSpawnRecipe } from '../src/data/bossVfx';

const ENTRANCES = ['portal', 'pillar', 'riftTear', 'summonCircle', 'skyFall', 'eruption'] as const;
const MOTIFS = ['flame', 'bolt', 'petal', 'ember', 'shadow', 'spark', 'void'] as const;
const IMPACTS = ['none', 'dust', 'shockwave', 'crack'] as const;

const all = (): ReturnType<typeof bossSpawnRecipe>[] =>
  Array.from({ length: BOSS_COUNT }, (_, identity) => bossSpawnRecipe(identity));

describe('boss spawn vfx recipes', () => {
  it('resolves every identity 0..36 without gaps', () => {
    expect(BOSS_COUNT).toBe(37);
    for (let identity = 0; identity < BOSS_COUNT; identity += 1) {
      const recipe = bossSpawnRecipe(identity);
      expect(recipe).toBeTruthy();
      expect(ENTRANCES).toContain(recipe.entrance);
      expect(MOTIFS).toContain(recipe.motif);
      expect(IMPACTS).toContain(recipe.groundImpact);
    }
  });

  it('wraps out-of-range identities onto the same roster deterministically', () => {
    for (let identity = 0; identity < BOSS_COUNT; identity += 1) {
      const base = bossSpawnRecipe(identity);
      expect(bossSpawnRecipe(identity + BOSS_COUNT)).toEqual(base);
      expect(bossSpawnRecipe(identity - BOSS_COUNT)).toEqual(base);
      // Determinism: repeated calls never drift.
      expect(bossSpawnRecipe(identity)).toEqual(base);
    }
  });

  it('keeps every palette at 2-3 valid hex tints', () => {
    for (const recipe of all()) {
      expect(recipe.palette.length).toBeGreaterThanOrEqual(2);
      expect(recipe.palette.length).toBeLessThanOrEqual(3);
      for (const tint of recipe.palette) {
        expect(Number.isInteger(tint)).toBe(true);
        expect(tint).toBeGreaterThan(0);
        expect(tint).toBeLessThanOrEqual(0xffffff);
        // Distinct colors so a tinted aura never vanishes against the burst.
        expect(new Set(recipe.palette).size).toBe(recipe.palette.length);
      }
    }
  });

  it('stays inside the tuned timing and intensity envelope', () => {
    for (const recipe of all()) {
      expect(recipe.timingScale).toBeGreaterThanOrEqual(.8);
      expect(recipe.timingScale).toBeLessThanOrEqual(1.4);
      expect(recipe.intensity).toBeGreaterThan(0);
      expect(recipe.intensity).toBeLessThanOrEqual(2);
      expect([0, 1, 2]).toContain(recipe.shake);
      expect([0, 1, 2]).toContain(recipe.soundVariant);
    }
  });

  it('gives late-game creatures the strongest entrances', () => {
    for (let identity = 26; identity < BOSS_COUNT; identity += 1) {
      const recipe = bossSpawnRecipe(identity);
      expect(recipe.shake).toBe(2);
      expect(['skyFall', 'eruption']).toContain(recipe.entrance);
      expect(recipe.intensity).toBeGreaterThanOrEqual(1.3);
    }
  });

  it('makes the final dragon ladder heavier than everything before it', () => {
    for (let identity = 32; identity < BOSS_COUNT; identity += 1) {
      const recipe = bossSpawnRecipe(identity);
      expect(recipe.timingScale).toBeGreaterThanOrEqual(1.15);
      expect(recipe.intensity).toBeGreaterThanOrEqual(1.45);
    }
    // No early boss may out-drama the finale.
    for (let identity = 0; identity < 32; identity += 1) {
      expect(bossSpawnRecipe(identity).intensity).toBeLessThan(bossSpawnRecipe(36).intensity);
    }
  });

  it('uses at least six distinct entrance kinds across the roster', () => {
    const used = new Set(all().map((recipe) => recipe.entrance));
    expect(used.size).toBeGreaterThanOrEqual(6);
  });

  it('groups families sanely: dragons share a heavy shape with per-identity flavor', () => {
    const dragonMotifs = new Set<string>();
    for (let identity = 32; identity < BOSS_COUNT; identity += 1) {
      dragonMotifs.add(bossSpawnRecipe(identity).motif);
    }
    // Hand-tuned overrides keep the five dragons from being visual clones.
    expect(dragonMotifs.size).toBeGreaterThanOrEqual(4);
  });
});
