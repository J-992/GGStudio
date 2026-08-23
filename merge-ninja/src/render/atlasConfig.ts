/**
 * THE ART SWAP SEAM.
 *
 * Every sprite in the game is drawn as `scene.add.image(x, y, ATLAS_KEY, frameName)`.
 * Nothing outside this folder knows whether those frames came from a PNG or from
 * code. To ship real art, drop the packed sheet into `public/assets/` and change
 * `mode` to 'file' below. No gameplay, UI, or effect file changes.
 */

/** The one texture key the whole game renders from. */
export const ATLAS_KEY = 'game';

export interface AtlasSource {
  /** 'placeholder' draws the sheet at boot with code. 'file' loads a packed PNG + JSON. */
  mode: 'placeholder' | 'file';
  /** Used when mode === 'file'. Paths are relative to the site root. */
  texturePath: string;
  jsonPath: string;
}

export const ATLAS: AtlasSource = {
  mode: 'file',
  texturePath: 'assets/game.webp',
  jsonPath: 'assets/game.json',
};

/** Nominal on-sheet size of a character frame. Real art should match this box. */
export const CHAR_FRAME = 128;

/** Frame name for a ninja tier. Real art must use these same names. */
export const ninjaFrame = (tier: number): string => `ninja_t${tier}`;
/** Frame name for an enemy by its slot in the enemy pool (0-4 regular, 5 boss). */
export const enemyFrame = (poolIndex: number): string => `enemy_${poolIndex}`;

/**
 * One full-body, identity-audited portrait or authored frame strip per roster
 * slot. Every motion strip retains the source key it was compared against.
 */
export interface CatalogPortrait {
  tier: number;
  textureKey: string;
  texturePath: string;
  footInset: number;
  /**
   * The exact current-roster portrait visually matched to this texture.
   * Motion strips keep this key so a future art swap cannot quietly change a
   * tier's character identity.
   */
  sourceTextureKey: string;
  /** A real sprite strip; unlike transform wobble, each frame moves its own anatomy and equipment. */
  animation?: { frameWidth: number; frameHeight: number };
}

const CATALOG_FOOT_INSET = 3;
const FOUR_FRAME_128 = { frameWidth: 128, frameHeight: 128 };
const FOUR_FRAME_256 = { frameWidth: 256, frameHeight: 256 };
const EIGHT_FRAME_256 = { frameWidth: 256, frameHeight: 256 };
const portrait = (
  tier: number,
  textureKey: string,
  texturePath: string,
  footInset = CATALOG_FOOT_INSET,
  animation?: CatalogPortrait['animation'],
  sourceTextureKey = textureKey,
): CatalogPortrait => ({
  tier,
  textureKey,
  texturePath,
  footInset,
  sourceTextureKey,
  animation,
});

/**
 * Each strip was visually checked against its former current-roster portrait
 * before assignment. The original source key remains in the data so this
 * identity mapping stays reviewable without relying on tier number alone.
 */
const motionPortrait = (
  tier: number,
  sourceTextureKey: string,
  footInset = CATALOG_FOOT_INSET,
  animation: NonNullable<CatalogPortrait['animation']> = FOUR_FRAME_128,
): CatalogPortrait => {
  const suffix = String(tier).padStart(2, '0');
  return portrait(
    tier,
    `ninja_motion_t${suffix}`,
    `assets/ninja-motion-t${suffix}.webp`,
    footInset,
    animation,
    sourceTextureKey,
  );
};

/** The accepted four-pose katana strip remains a showcase unit at its original tier. */
export const FLAME_SHOGUN_TIER = 12;

/** Curated from the retained user-approved ninja art, least imposing to most imposing. */
export const NINJA_CATALOG_PORTRAITS: readonly CatalogPortrait[] = [
  motionPortrait(1, 'ninja_catalog_27'),
  motionPortrait(2, 'ninja_catalog_13'),
  motionPortrait(3, 'ninja_catalog_25'),
  motionPortrait(4, 'ninja_catalog_32'),
  motionPortrait(5, 'ninja_catalog_30'),
  motionPortrait(6, 'provided_ninja_24'),
  motionPortrait(7, 'provided_ninja_10'),
  motionPortrait(8, 'ninja_catalog_34'),
  motionPortrait(9, 'ninja_catalog_26'),
  motionPortrait(10, 'ninja_catalog_35'),
  motionPortrait(11, 'ninja_catalog_28'),
  portrait(FLAME_SHOGUN_TIER, 'flame_shogun', 'assets/samurai-ready.webp', CATALOG_FOOT_INSET, FOUR_FRAME_128, 'flame_shogun'),
  motionPortrait(13, 'provided_ninja_07'),
  motionPortrait(14, 'provided_ninja_17'),
  motionPortrait(15, 'provided_ninja_23'),
  motionPortrait(16, 'provided_ninja_16'),
  motionPortrait(17, 'provided_ninja_18'),
  motionPortrait(18, 'ninja_catalog_33'),
  motionPortrait(19, 'provided_ninja_22'),
  motionPortrait(20, 'ninja_catalog_38'),
  motionPortrait(21, 'ninja_catalog_29'),
  motionPortrait(22, 'provided_ninja_12'),
  motionPortrait(23, 'provided_ninja_08'),
  motionPortrait(24, 'provided_ninja_19'),
  motionPortrait(25, 'provided_ninja_20'),
  motionPortrait(26, 'ninja_catalog_36'),
  motionPortrait(27, 'ninja_catalog_37'),
  motionPortrait(28, 'ninja_catalog_39'),
  motionPortrait(29, 'provided_ninja_final_evolution', 18, FOUR_FRAME_256),
];

export function ninjaCatalogPortrait(tier: number): CatalogPortrait | undefined {
  return NINJA_CATALOG_PORTRAITS[tier - 1];
}

/** Eight authored creature poses packed left-to-right in identical 256px cells. */
const bossMotionPortrait = (
  appearance: number,
  sourceTextureKey: string,
): CatalogPortrait => {
  const suffix = String(appearance).padStart(2, '0');
  return portrait(
    appearance,
    `boss_motion_a${suffix}`,
    `assets/boss-motion-a${suffix}.webp`,
    8,
    EIGHT_FRAME_256,
    sourceTextureKey,
  );
};

/** Curated humanoid-first boss ladder; animal and monster encounters are late-stage only. */
export const BOSS_CATALOG_PORTRAITS: readonly CatalogPortrait[] = [
  portrait(1, 'boss_catalog_26', 'assets/boss-catalog-26.webp'),
  portrait(2, 'boss_catalog_39', 'assets/boss-catalog-39.webp'),
  portrait(3, 'boss_catalog_25', 'assets/boss-catalog-25.webp'),
  portrait(4, 'ninja_catalog_28', 'assets/ninja-catalog-28.webp'),
  portrait(5, 'boss_catalog_31', 'assets/boss-catalog-31.webp'),
  portrait(6, 'ninja_catalog_30', 'assets/ninja-catalog-30.webp'),
  portrait(7, 'ninja_catalog_31', 'assets/ninja-catalog-31.webp'),
  portrait(8, 'boss_catalog_33', 'assets/boss-catalog-33.webp'),
  portrait(9, 'ninja_catalog_35', 'assets/ninja-catalog-35.webp'),
  portrait(10, 'boss_catalog_34', 'assets/boss-catalog-34.webp'),
  portrait(11, 'boss_catalog_38', 'assets/boss-catalog-38.webp'),
  portrait(12, 'boss_catalog_35', 'assets/boss-catalog-35.webp'),
  portrait(13, 'boss_catalog_28', 'assets/boss-catalog-28.webp'),
  portrait(14, 'ninja_catalog_32', 'assets/ninja-catalog-32.webp'),
  portrait(15, 'ninja_catalog_33', 'assets/ninja-catalog-33.webp'),
  portrait(16, 'ninja_catalog_34', 'assets/ninja-catalog-34.webp'),
  portrait(17, 'boss_catalog_32', 'assets/boss-catalog-32.webp'),
  portrait(18, 'ninja_catalog_29', 'assets/ninja-catalog-29.webp'),
  portrait(19, 'boss_catalog_37', 'assets/boss-catalog-37.webp'),
  portrait(20, 'boss_catalog_27', 'assets/boss-catalog-27.webp'),
  portrait(21, 'boss_catalog_36', 'assets/boss-catalog-36.webp'),
  bossMotionPortrait(22, 'ninja_catalog_37'),
  bossMotionPortrait(23, 'ninja_catalog_36'),
  bossMotionPortrait(24, 'ninja_catalog_38'),
  portrait(25, 'ninja_catalog_39', 'assets/ninja-catalog-39.webp'),
  bossMotionPortrait(26, 'boss_catalog_29'),
  bossMotionPortrait(27, 'boss_catalog_30'),
  bossMotionPortrait(28, 'provided_boss_07'),
  bossMotionPortrait(29, 'provided_boss_05'),
  bossMotionPortrait(30, 'provided_boss_08'),
  bossMotionPortrait(31, 'provided_boss_09'),
  bossMotionPortrait(32, 'provided_boss_06'),
  bossMotionPortrait(33, 'provided_boss_01'),
  bossMotionPortrait(34, 'provided_boss_02'),
  bossMotionPortrait(35, 'provided_boss_03'),
  bossMotionPortrait(36, 'provided_boss_04'),
  bossMotionPortrait(37, 'provided_boss_10'),
];

export function bossCatalogPortrait(appearance: number): CatalogPortrait | undefined {
  return BOSS_CATALOG_PORTRAITS.find((portrait) => portrait.tier === appearance);
}

/** Non-character frames the effects layer relies on. */
export const FX_FRAMES = {
  coin: 'fx_coin',
  star: 'fx_star',
  puff: 'fx_puff',
  spark: 'fx_spark',
  ring: 'fx_ring',
  slash: 'fx_slash',
  flame: 'vfx_flame', portal: 'vfx_portal', boltA: 'vfx_bolt_a', boltB: 'vfx_bolt_b', boltC: 'vfx_bolt_c', boltD: 'vfx_bolt_d', boltE: 'vfx_bolt_e',
} as const;
