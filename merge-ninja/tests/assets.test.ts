import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARENA_THEMES } from '../src/data/arenaThemes';
import { POWERUP_ORDER, POWERUPS } from '../src/data/powerups';
import { VFX_ANIMATION_ORDER, VFX_ANIMATIONS } from '../src/data/vfxAssets';
import {
  ATLAS,
  BOSS_CATALOG_PORTRAITS,
  NINJA_CATALOG_PORTRAITS,
} from '../src/render/atlasConfig';
import {
  ACHIEVEMENTS_ICON_PATH,
  REVEAL_ASSETS,
} from '../src/render/revealAssets';
import { BOSS_STICKERS } from '../src/data/dojoStyles';

const ARENA_PATHS: Readonly<Record<string, string>> = {
  dojo_night_backdrop: 'assets/dojo-night-backdrop.webp',
  arena_mountain: 'assets/arena-mountain.webp',
  arena_storm: 'assets/arena-storm.webp',
  arena_rift_stage: 'assets/arena-rift-stage.webp',
  arena_shrine: 'assets/arena-shrine.webp',
  floor_dojo: 'assets/floor-dojo.webp',
  floor_temple: 'assets/floor-temple.webp',
  floor_storm: 'assets/floor-storm.webp',
  floor_rift: 'assets/floor-rift.webp',
  floor_shrine: 'assets/floor-shrine.webp',
};

describe('shipping asset manifest', () => {
  it('contains every statically configured runtime file and none are empty', () => {
    const files = new Set<string>([
      ATLAS.texturePath,
      ATLAS.jsonPath,
      'assets/font.png',
      'assets/font.xml',
      'assets/arena-cloud-bank.webp',
      'assets/dojo-roster-deck.webp',
      'assets/tex/tex_0.webp',
      'assets/tex/tex_1.webp',
      'assets/tex/tex_2.webp',
      'assets/tex/tex_3.webp',
      'assets/tex/tex_4.webp',
      'assets/tex/tex_5.webp',
      'assets/tex/tex_industrial.webp',
      ACHIEVEMENTS_ICON_PATH,
      ...NINJA_CATALOG_PORTRAITS.map((portrait) => portrait.texturePath),
      ...BOSS_CATALOG_PORTRAITS.map((portrait) => portrait.texturePath),
      ...POWERUP_ORDER.map((id) => POWERUPS[id].iconPath),
      ...VFX_ANIMATION_ORDER.map((id) => VFX_ANIMATIONS[id].path),
      ...Object.values(REVEAL_ASSETS).map((asset) => asset.path),
      ...BOSS_STICKERS.map((sticker) => sticker.texturePath),
      ...ARENA_THEMES.flatMap((arena) => [
        ARENA_PATHS[arena.backdropKey]!,
        ARENA_PATHS[arena.floorTextureKey]!,
      ]),
    ]);

    expect(files.size).toBeGreaterThan(80);
    for (const file of files) {
      const path = resolve(process.cwd(), 'public', file);
      expect(existsSync(path), `missing ${file}`).toBe(true);
      expect(statSync(path).size, `empty ${file}`).toBeGreaterThan(0);
    }
  });
});
