import {
  BOSS_CATALOG_PORTRAITS,
  type CatalogPortrait,
  NINJA_CATALOG_PORTRAITS,
} from './atlasConfig';
import { ARENA_THEMES, themeForStage } from '../data/arenaThemes';

/**
 * Which art the game waits for, and which art it starts without.
 *
 * Everything used to be one list, loaded before the first frame: 108 files and
 * 4.4 MB, of which the opening thirty seconds of play touches maybe a tenth.
 * Measured on a local server -- the best case that exists -- the bundle was
 * ready at 185 ms and the art at 5022 ms, so essentially the whole wait was art
 * for bosses the player had not met and rooms they had not reached.
 *
 * So the manifest is split. The boot set is what the first frame genuinely
 * cannot be drawn without, plus a few tiers and bosses of headroom. The rest is
 * streamed in the background once the game is up, ordered by when the player
 * will actually reach it, which for this game is simply ascending: tier 5 comes
 * before tier 6, and stage 10's room before stage 19's.
 *
 * The lead times below come from `tests/pacing.test.ts`, which simulates a real
 * session. They are comfortable, but comfort is not a guarantee on a bad
 * connection, so nothing here is load-bearing on its own -- `portraitTexture.ts`
 * substitutes already-loaded art for anything asked for early, and the ordering
 * exists to make that substitution rare rather than to make it impossible.
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
export const BOOT_NINJA_TIERS = 3;

/**
 * Boss appearances loaded before the first frame.
 *
 * Bosses arrive strictly in order, one per stage, and stage 4 lands at ~16 s.
 * Counted the way `CatalogPortrait.tier` counts bosses -- from 1, matching
 * `BossDef.appearanceIndex` rather than the 0-based identity index that
 * `bossIdentityFor` returns.
 */
export const BOOT_BOSS_APPEARANCES = 4;

/** The room the game opens in; every other theme is stage-gated behind it. */
const OPENING_THEME = ARENA_THEMES[0]!;


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

const BOSS_COUNT = BOSS_CATALOG_PORTRAITS.length;

/** Which boss appearance a stage puts in the arena, 1-based like the catalog. */
const appearanceForStage = (stage: number): number =>
  ((Math.max(1, Math.floor(stage)) - 1) % BOSS_COUNT) + 1;

/** The next `count` boss appearances from `stage`, wrapping like the ladder does. */
function upcomingAppearances(stage: number, count: number): Set<number> {
  const first = appearanceForStage(stage);
  const out = new Set<number>();
  for (let i = 0; i < count; i += 1) out.add(((first - 1 + i) % BOSS_COUNT) + 1);
  return out;
}

/**
 * Roster tiers that can be on screen before the stream has caught up: whatever
 * the save has on the board, the low tiers the buy button hands out, and a
 * couple above the player's best in case they merge straight past it.
 */
function immediateTiers(at: ResumePoint): Set<number> {
  const tiers = new Set<number>(at.boardTiers);
  for (let tier = 1; tier <= BOOT_NINJA_TIERS; tier += 1) tiers.add(tier);
  const best = Math.max(1, Math.floor(at.highestTier));
  for (let tier = best; tier <= best + 2; tier += 1) tiers.add(tier);
  return tiers;
}

/** Catalog art the first frame waits for, given where the player is resuming. */
export function bootPortraits(at: ResumePoint = FIRST_SESSION): readonly CatalogPortrait[] {
  const tiers = immediateTiers(at);
  const appearances = upcomingAppearances(at.stage, BOOT_BOSS_APPEARANCES);
  return [
    ...NINJA_CATALOG_PORTRAITS.filter((p) => tiers.has(p.tier)),
    ...BOSS_CATALOG_PORTRAITS.filter((p) => appearances.has(p.tier)),
  ];
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
export function deferredPortraits(at: ResumePoint = FIRST_SESSION): readonly CatalogPortrait[] {
  const booted = new Set(bootPortraits(at).map((p) => p.textureKey));

  const from = appearanceForStage(at.stage);
  const bosses = BOSS_CATALOG_PORTRAITS
    .filter((p) => !booted.has(p.textureKey))
    .sort((a, b) => ((a.tier - from + BOSS_COUNT) % BOSS_COUNT)
      - ((b.tier - from + BOSS_COUNT) % BOSS_COUNT));

  const best = Math.max(1, Math.floor(at.highestTier));
  const ninjas = NINJA_CATALOG_PORTRAITS
    .filter((p) => !booted.has(p.textureKey))
    .sort((a, b) => Math.abs(a.tier - best) - Math.abs(b.tier - best));

  const out: CatalogPortrait[] = [];
  for (let i = 0; i < Math.max(ninjas.length, bosses.length); i += 1) {
    const boss = bosses[i];
    const ninja = ninjas[i];
    if (boss !== undefined) out.push(boss);
    if (ninja !== undefined) out.push(ninja);
  }
  return out;
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
export function deferredThemeArt(at: ResumePoint = FIRST_SESSION): readonly DeferredImage[] {
  const booted = new Set(bootThemeArt(at).map((art) => art.key));
  return ARENA_THEMES
    .flatMap((theme) => [themeAsset(theme.backdropKey), themeAsset(theme.floorTextureKey)])
    .filter((art) => !booted.has(art.key));
}

/**
 * Rooms the first frame does need: the one being resumed into, and the opening
 * one regardless -- `GameScene` paints `dojo_night_backdrop` behind the whole
 * screen at every stage, not just during act one.
 */
export function bootThemeArt(at: ResumePoint = FIRST_SESSION): readonly DeferredImage[] {
  const rooms = [OPENING_THEME, themeForStage(at.stage)];
  const seen = new Set<string>();
  return rooms
    .flatMap((theme) => [themeAsset(theme.backdropKey), themeAsset(theme.floorTextureKey)])
    .filter((art) => (seen.has(art.key) ? false : (seen.add(art.key), true)));
}
