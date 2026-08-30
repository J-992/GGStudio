import type { CatSkinId } from '../game/SaveManager';

/**
 * Cosmetic cat variants.
 *
 * These used to be *generated*: there was exactly one texture on disk - a
 * black-and-white tuxedo - and every other cat was produced at runtime by
 * pushing its pixels through a per-skin luminance ramp. That existed only
 * because there was nothing else to work with, and it showed: a ramp can move
 * the fur but it cannot invent markings, so all five cats wore the same tuxedo
 * pattern in different colours.
 *
 * The coats are authored 2048px maps, halved to 1024 on the way into
 * `public/assets/cat/skins/` (see `scripts/png-resize.mjs`). So the ramp is
 * gone and a skin is now just a map: `Cat.setSkin` swaps `material.map` and
 * nothing else changes. That also removes the canvas readback the old path
 * needed, which was the one piece of this file that could not run headless.
 *
 * All eighteen share one UV atlas, which is why the cat mesh could be swapped
 * for `cat_model.glb` without re-authoring any of them - and why the *rig*
 * decides which way up they load rather than this file: see
 * `AssetRegistry.catSkinFlipY`.
 *
 * Orange is the default cat.
 *
 * Physics is never touched by any of this; skins are purely visual.
 */

export interface CatSkinDef {
  id: CatSkinId;
  name: string;
  /**
   * The shop chip's CSS background.
   *
   * A plain colour for most coats, sampled off the actual map rather than
   * guessed - averaged over the texels the UV islands really cover, so a coat
   * is represented by its fur and not by whatever fills the unused corners of
   * the atlas.
   *
   * A gradient where no single colour can honestly stand in for the coat: a
   * two-tone cat sampled down to one colour lands on a muddy average that
   * matches nothing on the model, and three of these read as near-black
   * despite looking nothing alike. Interpolated into `style="background: ..."`
   * by the shop, which is safe because this table is a compile-time constant -
   * it is not a place to put anything a player can influence.
   */
  swatch: string;
  /**
   * Fish price. `0` means free forever, for everyone, with no save entry -
   * see `SaveData.unlockedSkins`.
   *
   * Prices sit here, on the coat itself, so that adding a cat is one entry in
   * `CAT_SKINS` and nothing else: `SaveManager` derives the full roster, the
   * free set, and every price from this array, and the shop grid renders
   * whatever it finds. There is no second list to keep in step.
   *
   * Three tiers, not a ladder: free, {@link STANDARD_COST} and
   * {@link PREMIUM_COST}. Coats deliberately share a price - the roster is a
   * wardrobe, not a ranking, and pricing the eleventh coat above the tenth
   * only communicates the order they happened to be added in. What a price
   * should say is "this one is special", which is why exactly two coats carry
   * the premium tier.
   *
   * Prices can be changed freely: the save file records purchases, never
   * prices, so re-pricing a coat needs no migration and never repossesses one
   * somebody already owns.
   */
  cost: number;
}

/**
 * The ordinary tier. Every coat that is not free and not special costs this.
 *
 * A run banks roughly its fish count, so at a few dozen fish per run this is
 * something like five to ten runs: far enough away that the first purchase is
 * a decision, near enough that a new player reaches one before the currency
 * stops meaning anything.
 */
export const STANDARD_COST = 250;

/**
 * The special tier - four times the standard one, which is a wide enough gap
 * to read as a different kind of thing rather than a slightly dearer coat.
 */
export const PREMIUM_COST = 1000;

/**
 * Every skin, in menu order, default first.
 *
 * The ids are also the filenames: `public/assets/cat/skins/<id>.png`.
 *
 * To add a coat: drop `<id>.png` into `public/assets/cat/skins/`, add the id
 * to `CatSkinId` in `SaveManager.ts`, and add a row here. Nothing else needs
 * touching - the shop, the save file, and the unlock rules all read this.
 *
 * Order is what the shop grid renders, so it runs free coat first, then the
 * standard tier roughly realistic-to-silly, then the two premium coats last.
 * Price never decreases down the list, so the grid still reads as going
 * somewhere even though most of it is one price.
 */
export const CAT_SKINS: readonly CatSkinDef[] = [
  { id: 'orange', name: 'Orange Tabby', swatch: '#E8A55A', cost: 0 },
  { id: 'tabby', name: 'Brown Tabby', swatch: '#9A7550', cost: STANDARD_COST },
  { id: 'calico', name: 'Calico', swatch: '#C4773C', cost: STANDARD_COST },
  // Cream coat, seal points: the two-tone is the whole cat, so the chip shows
  // both rather than averaging them into a beige nothing.
  {
    id: 'siamese',
    name: 'Siamese',
    swatch: 'linear-gradient(135deg, #E8D6C6 52%, #2C1D13 52%)',
    cost: STANDARD_COST,
  },
  { id: 'russianblue', name: 'Russian Blue', swatch: '#7C858C', cost: STANDARD_COST },
  { id: 'tuxedo', name: 'Tuxedo', swatch: '#2B2B30', cost: STANDARD_COST },
  { id: 'black', name: 'Black Cat', swatch: '#1D1D22', cost: STANDARD_COST },
  { id: 'fluffy', name: 'Fluffy', swatch: '#E6D8CB', cost: STANDARD_COST },
  { id: 'cheshire', name: 'Cheshire', swatch: '#A765CC', cost: STANDARD_COST },
  { id: 'pinkie', name: 'Pinkie', swatch: '#FD97A9', cost: STANDARD_COST },
  // Bone on black. Sampled flat it comes out near-black, which is already what
  // Tuxedo and Black Cat look like in a 48px circle.
  {
    id: 'skeleton',
    name: 'Skeleton',
    swatch: 'linear-gradient(135deg, #F2E3BC 50%, #06060F 50%)',
    cost: STANDARD_COST,
  },
  { id: 'mummy', name: 'Mummy', swatch: '#A79988', cost: STANDARD_COST },
  { id: 'cheetah', name: 'Cheetah', swatch: '#C68249', cost: STANDARD_COST },
  { id: 'tiger', name: 'Tiger', swatch: '#B17D41', cost: STANDARD_COST },
  { id: 'sailor', name: 'Sailor', swatch: '#ABA4A1', cost: STANDARD_COST },
  { id: 'sunset', name: 'Sunset', swatch: '#CE7474', cost: STANDARD_COST },
  { id: 'frankie', name: 'Frankie', swatch: '#92A989', cost: PREMIUM_COST },
  // The one coat a single colour cannot describe at all.
  {
    id: 'rainbow',
    name: 'Rainbow',
    swatch: 'linear-gradient(135deg, #E5484D, #F5A524, #F2E33C, #46A758, #3E86D6, #8E4EC6)',
    cost: PREMIUM_COST,
  },
];


/** The cat worn until the player picks otherwise. */
export const DEFAULT_CAT_SKIN: CatSkinId = 'orange';

export function getSkinDef(id: CatSkinId): CatSkinDef {
  return CAT_SKINS.find((s) => s.id === id) ?? CAT_SKINS[0];
}

/** Where a skin's colour map lives, relative to the asset root. */
export function skinTexturePath(id: CatSkinId): string {
  return `cat/skins/${getSkinDef(id).id}.webp`;
}
