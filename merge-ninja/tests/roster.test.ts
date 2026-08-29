import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { imageSize } from './imageSize';
import { BOSS_COUNT, bossIdentity } from '../src/data/enemies';
import { BALANCE } from '../src/data/balance';
import { NINJAS } from '../src/data/ninjas';
import {
  BOSS_CATALOG_PORTRAITS,
  FLAME_SHOGUN_TIER,
  NINJA_CATALOG_PORTRAITS,
  ninjaCatalogPortrait,
} from '../src/render/atlasConfig';

describe('roster identity', () => {
  it('ships the curated 29-tier ninja climb with no reused portraits', () => {
    expect(NINJAS).toHaveLength(BALANCE.tiers.count);
    expect(BALANCE.tiers.count).toBe(29);
    expect(new Set(NINJAS.map((ninja) => ninja.textureKey)).size).toBe(BALANCE.tiers.count);
  });

  it('keeps every tier bound to the source portrait it was visually audited against', () => {
    expect(NINJA_CATALOG_PORTRAITS.map((portrait) => portrait.sourceTextureKey)).toEqual([
      'ninja_catalog_27', 'ninja_catalog_13', 'ninja_catalog_25', 'ninja_catalog_32', 'ninja_catalog_30',
      'provided_ninja_24', 'provided_ninja_10', 'ninja_catalog_34', 'ninja_catalog_26', 'ninja_catalog_35',
      'ninja_catalog_28', 'flame_shogun', 'provided_ninja_07', 'provided_ninja_17', 'provided_ninja_23',
      'provided_ninja_16', 'provided_ninja_18', 'ninja_catalog_33', 'provided_ninja_22', 'ninja_catalog_38',
      'ninja_catalog_29', 'provided_ninja_12', 'provided_ninja_08', 'provided_ninja_19', 'provided_ninja_20',
      'ninja_catalog_36', 'ninja_catalog_37', 'ninja_catalog_39', 'provided_ninja_final_evolution',
    ]);
    for (const portrait of NINJA_CATALOG_PORTRAITS) {
      expect(portrait.animation).toEqual(portrait.tier === 29
        ? { frameWidth: 256, frameHeight: 256 }
        : { frameWidth: 128, frameHeight: 128 });
    }
  });

  it('ships 37 uniquely textured boss identities', () => {
    const textures = Array.from({ length: BOSS_COUNT }, (_, index) => bossIdentity(index).textureKey);
    expect(BOSS_COUNT).toBe(37);
    expect(new Set(textures).size).toBe(BOSS_COUNT);
  });

  it('maps every roster texture to supplied portrait inventory and gives each unit two moves', () => {
    const suppliedTextures = new Set([
      ...NINJA_CATALOG_PORTRAITS.map((portrait) => portrait.textureKey),
      ...BOSS_CATALOG_PORTRAITS.map((portrait) => portrait.textureKey),
    ]);
    const bosses = Array.from({ length: BOSS_COUNT }, (_, index) => bossIdentity(index));

    for (const unit of [...NINJAS, ...bosses]) {
      expect(suppliedTextures.has(unit.textureKey)).toBe(true);
      expect(unit.textureKey).not.toMatch(/(?:ready|samurai)/);
      expect(unit.combat.basic.length).toBeGreaterThan(0);
      expect(unit.combat.special.length).toBeGreaterThan(0);
    }
  });

  it('gives every former static creature an authored eight-frame animation', () => {
    const bosses = Array.from({ length: BOSS_COUNT }, (_, index) => bossIdentity(index));

    expect(NINJAS.every((ninja) => ninja.animation === 'fourFrame')).toBe(true);
    expect(bosses.filter((boss) => boss.animation === 'eightFrame').map((boss) => boss.appearanceIndex)).toEqual([
      22, 23, 24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
    ]);
    expect(bosses.filter((boss) => boss.animation === 'fourFrame')).toHaveLength(22);
  });

  it('packs every creature strip as exactly eight equal 256px frames', () => {
    const animated = BOSS_CATALOG_PORTRAITS.filter((portrait) => portrait.textureKey.startsWith('boss_motion_'));
    expect(animated).toHaveLength(15);
    for (const portrait of animated) {
      expect(portrait.animation).toEqual({ frameWidth: 256, frameHeight: 256 });
      const [width, height] = imageSize(resolve('public', portrait.texturePath));
      expect(width).toBe(256 * 8);
      expect(height).toBe(256);
    }
  });

  it('keeps the accepted Flame Shogun strip as tier twelve rather than flattening it into a still portrait', () => {
    expect(NINJAS[FLAME_SHOGUN_TIER - 1]).toMatchObject({ name: 'Flame Shogun', textureKey: 'flame_shogun' });
    expect(ninjaCatalogPortrait(FLAME_SHOGUN_TIER)).toMatchObject({
      sourceTextureKey: 'flame_shogun',
      animation: { frameWidth: 128, frameHeight: 128 },
    });
  });
});
