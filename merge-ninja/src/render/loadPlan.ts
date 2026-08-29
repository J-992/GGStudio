import {
  BOSS_CATALOG_PORTRAITS,
  type CatalogPortrait,
  NINJA_CATALOG_PORTRAITS,
} from './atlasConfig';
import { ARENA_THEMES } from '../data/arenaThemes';

/**
 * Complete art loading plan. The loading screen stays up until all catalog
 * portraits and arena rooms are available, so a slow or restrictive network
 * can never leave a player looking at a temporary ninja or missing backdrop.
 */

/**
 * Ninja tiers loaded before the first frame.
 *
 * The simulation reaches tier 3 at ~11 s and tier 4 at ~17 s, and the stream
 * finishes long before either on any connection that is not already in trouble.
 * This used to be five, which cost 60 KB up front to cover a case the stream
 * already covers -- and the tiers a returning save actually has on the board
 * come from `boardTiers`, not from this number.
 */
export const BOOT_NINJA_TIERS = NINJA_CATALOG_PORTRAITS.length;

/**
 * Boss appearances loaded before the first frame.
 *
 * Bosses arrive strictly in order, one per stage, and stage 4 lands at ~16 s.
 * Counted the way `CatalogPortrait.tier` counts bosses -- from 1, matching
 * `BossDef.appearanceIndex` rather than the 0-based identity index that
 * `bossIdentityFor` returns.
 */
export const BOOT_BOSS_APPEARANCES = BOSS_CATALOG_PORTRAITS.length;


/**
 * Where the player is actually resuming from.
 *
 * The boot set is a window around this point, not everything up to it. That
 * distinction is the whole game: a save at stage 17 used to boot every boss
 * from the first to the twenty-first, because "up to here" reads as reasonable
 * right until you notice only one boss is ever on screen. It cost 2.2 MB and
 * about fifty seconds before the board appeared.
 *
 * Bosses arrive strictly one per stage in order, so the window is the next few.
 * Roster tiers are different -- the board holds a dozen at once and the buy
 * button keeps making tier ones -- so what is needed is whatever the save says
 * is actually sitting on the board, not a range.
 */
export interface ResumePoint {
  readonly stage: number;
  readonly highestTier: number;
  /** Tiers occupying board slots in the save being restored. */
  readonly boardTiers: readonly number[];
}

export const FIRST_SESSION: ResumePoint = { stage: 1, highestTier: 1, boardTiers: [] };

/** Every portrait is available before GameScene is allowed to start. */
export function bootPortraits(_at: ResumePoint = FIRST_SESSION): readonly CatalogPortrait[] {
  return [...NINJA_CATALOG_PORTRAITS, ...BOSS_CATALOG_PORTRAITS];
}

/**
 * Catalog art streamed afterwards, in the order the player will meet it.
 *
 * Ordered outward from where the player is standing rather than from tier one:
 * a save at stage 17 meets boss 22 next, and boss 3 only after another
 * thirty-odd stages. Ninjas and bosses interleave because the player advances
 * through both at once -- finishing every boss before starting on the roster
 * would leave the board falling behind its own art.
 */
export function deferredPortraits(_at: ResumePoint = FIRST_SESSION): readonly CatalogPortrait[] {
  return [];
}

export interface DeferredImage {
  readonly key: string;
  readonly path: string;
}

const themeAsset = (key: string): DeferredImage => ({
  key,
  path: `assets/${key.replace(/_/g, '-')}.webp`,
});

/**
 * Backdrops and floors for rooms past the opening one.
 *
 * These are the largest single files in the game -- the shrine backdrop alone
 * is 228 KB -- and the earliest of them belongs to stage 10, which the
 * simulation reaches at ~35 s. There is no version of a first frame that needs
 * them.
 */
export function deferredThemeArt(_at: ResumePoint = FIRST_SESSION): readonly DeferredImage[] {
  return [];
}

/**
 * Rooms the first frame does need: the one being resumed into, and the opening
 * one regardless -- `GameScene` paints `dojo_night_backdrop` behind the whole
 * screen at every stage, not just during act one.
 */
export function bootThemeArt(_at: ResumePoint = FIRST_SESSION): readonly DeferredImage[] {
  const rooms = ARENA_THEMES;
  const seen = new Set<string>();
  return rooms
    .flatMap((theme) => [themeAsset(theme.backdropKey), themeAsset(theme.floorTextureKey)])
    .filter((art) => (seen.has(art.key) ? false : (seen.add(art.key), true)));
}
