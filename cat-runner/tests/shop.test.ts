import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

import { SaveManager, type StorageAdapter, type CatSkinId } from '../src/game/SaveManager';
import {
  CAT_SKINS,
  DEFAULT_CAT_SKIN,
  PREMIUM_COST,
  STANDARD_COST,
  skinTexturePath,
} from '../src/entities/CatSkins';

/**
 * The fish economy: banking a run, spending the bank, and what a save file
 * from before any of this existed turns into.
 *
 * Kept apart from `smoke.test.ts`'s SaveManager block, which covers the file
 * format itself (corrupt payloads, retired ids, round-tripping). This is about
 * the *rules* layered on top of it - what a run is worth, what a coat costs,
 * and the several ways a hand-edited save can try to get one for free.
 */

class MemoryAdapter implements StorageAdapter {
  store = new Map<string, string>();
  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
}

const KEY = 'rooftop-rascal:save:v1';

/** A coat that costs something, whichever one that happens to be. */
const PAID = CAT_SKINS.find((s) => s.cost > 0)!;

describe('cat roster', () => {
  it('ships exactly one free coat, and it is the default', () => {
    // Not a style rule - the save file stores *purchases only* and derives the
    // free set from `cost`, so a fresh player can wear precisely the coats
    // priced at 0. If that set were empty they would boot with no cat at all;
    // if it grew silently, coats would stop being worth buying.
    const free = CAT_SKINS.filter((s) => s.cost <= 0);
    expect(free).toHaveLength(1);
    expect(free[0].id).toBe(DEFAULT_CAT_SKIN);
  });

  it('prices every other coat at one of exactly two tiers', () => {
    // The roster is a wardrobe, not a ladder. A per-coat price would say the
    // ninth coat is worth more than the eighth, which is not a claim anyone
    // means to make - it just reflects the order they were added.
    const paid = CAT_SKINS.filter((s) => s.cost > 0);
    expect(paid.length).toBeGreaterThan(0);
    expect(new Set(paid.map((s) => s.cost))).toEqual(new Set([STANDARD_COST, PREMIUM_COST]));
  });

  it('reserves the premium tier for two coats, and prices the rest the same', () => {
    // Two, specifically: a "special" tier that most of the roster is in says
    // nothing. The standard tier holding several coats at an identical price
    // is the point, not an oversight - hence asserting it rather than the
    // strictly-ascending order this used to check.
    const premium = CAT_SKINS.filter((s) => s.cost === PREMIUM_COST).map((s) => s.id);
    expect(premium).toEqual(['frankie', 'rainbow']);

    const standard = CAT_SKINS.filter((s) => s.cost === STANDARD_COST);
    expect(standard.length).toBeGreaterThan(1);
    expect(PREMIUM_COST).toBeGreaterThan(STANDARD_COST);
  });

  it('never lowers the price as the grid goes down', () => {
    // Ties are the norm now, but a coat cheaper than one above it would make
    // the grid read as unordered rather than as tiered.
    const costs = CAT_SKINS.map((s) => s.cost);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  it('has no duplicate ids', () => {
    // `costOf` and `isSkinUnlocked` both resolve a coat by `find`, so a
    // duplicate id would make a coat's price depend on array order.
    const ids = CAT_SKINS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships a texture for every coat on the roster', () => {
    // Adding a coat is meant to be "drop the PNG in, add a row here" - which
    // makes forgetting one half of that the obvious way to break the shop, and
    // an entirely silent one: `Cat.setSkin` swallows a failed texture load so
    // that a missing coat can never leave the player with no cat, so the only
    // symptom in-game is a card that quietly does nothing.
    for (const skin of CAT_SKINS) {
      const file = new URL(`../public/assets/${skinTexturePath(skin.id)}`, import.meta.url);
      expect(existsSync(file), `missing texture for "${skin.id}"`).toBe(true);
    }
  });

  it('gives every coat its own texture', () => {
    // Two coats pointing at one map is a copy-paste slip in the roster that
    // looks exactly like a working shop until someone buys the second one.
    const paths = CAT_SKINS.map((s) => skinTexturePath(s.id));
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('banking a run', () => {
  let save: SaveManager;
  beforeEach(() => {
    save = new SaveManager(new MemoryAdapter());
  });

  it('adds the run fish to the wallet and keeps the furthest distance', () => {
    expect(save.fish).toBe(0);
    expect(save.bestDistance).toBe(0);

    expect(save.recordRun(300, 40)).toEqual({ bestDistance: 300, isNewBest: true });
    expect(save.fish).toBe(40);

    // Shorter run: the fish still bank (they were collected either way), the
    // record does not move.
    expect(save.recordRun(120, 15)).toEqual({ bestDistance: 300, isNewBest: false });
    expect(save.fish).toBe(55);

    expect(save.recordRun(301, 0)).toEqual({ bestDistance: 301, isNewBest: true });
  });

  it('does not call an exact tie a new best', () => {
    // The overlay's "New Best!" banner reads as "you just beat it", so a run
    // that merely matches the record must not fire it.
    save.recordRun(500, 0);
    expect(save.recordRun(500, 0).isNewBest).toBe(false);
  });

  it('refuses to let a broken counter poison the wallet', () => {
    // NaN is the dangerous one: it survives every later addition and fails
    // every comparison, so one NaN reaching the wallet would leave it reading
    // NaN forever with no path back short of a progress reset.
    save.recordRun(100, 10);
    save.recordRun(Number.NaN, Number.NaN);
    save.recordRun(-50, -999);
    save.recordRun(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

    expect(Number.isFinite(save.fish)).toBe(true);
    expect(save.fish).toBe(10);
    expect(save.bestDistance).toBe(100);
  });

  it('banks whole fish only', () => {
    save.recordRun(0, 7.9);
    expect(save.fish).toBe(7);
  });
});

describe('buying a coat', () => {
  let save: SaveManager;
  beforeEach(() => {
    save = new SaveManager(new MemoryAdapter());
  });

  it('starts with only the free coat available', () => {
    expect(save.isSkinUnlocked(DEFAULT_CAT_SKIN)).toBe(true);
    for (const skin of CAT_SKINS) {
      if (skin.cost > 0) expect(save.isSkinUnlocked(skin.id)).toBe(false);
    }
  });

  it('refuses a purchase it cannot afford, and spends nothing trying', () => {
    save.recordRun(0, PAID.cost - 1);
    expect(save.unlockSkin(PAID.id)).toBe(false);
    // The exact failure mode worth pinning: a rejected purchase that had
    // already debited would leave the player poorer with nothing to show.
    expect(save.fish).toBe(PAID.cost - 1);
    expect(save.isSkinUnlocked(PAID.id)).toBe(false);
  });

  it('deducts exactly the price and unlocks the coat', () => {
    save.recordRun(0, PAID.cost + 25);
    expect(save.unlockSkin(PAID.id)).toBe(true);
    expect(save.fish).toBe(25);
    expect(save.isSkinUnlocked(PAID.id)).toBe(true);
  });

  it('affords a coat priced at exactly the balance', () => {
    // `cost > fish` rather than `>=` - being able to spend your last fish is
    // the difference between a price and an unreachable price.
    save.recordRun(0, PAID.cost);
    expect(save.unlockSkin(PAID.id)).toBe(true);
    expect(save.fish).toBe(0);
  });

  it('cannot be bought twice', () => {
    save.recordRun(0, PAID.cost * 3);
    expect(save.unlockSkin(PAID.id)).toBe(true);
    const after = save.fish;
    expect(save.unlockSkin(PAID.id)).toBe(false);
    expect(save.fish).toBe(after);
  });

  it('never charges for a free coat', () => {
    save.recordRun(0, 500);
    expect(save.unlockSkin(DEFAULT_CAT_SKIN)).toBe(false);
    expect(save.fish).toBe(500);
    expect(save.isSkinUnlocked(DEFAULT_CAT_SKIN)).toBe(true);
  });

  it('spends nothing on a coat that does not exist', () => {
    save.recordRun(0, 500);
    expect(save.unlockSkin('dragon' as CatSkinId)).toBe(false);
    expect(save.isSkinUnlocked('dragon' as CatSkinId)).toBe(false);
    expect(save.fish).toBe(500);
  });

  it('buying does not also equip', () => {
    // Two deliberate steps: the shop calls unlockSkin then selectSkin. Keeping
    // them apart is what lets selectSkin stay a pure "wear a coat you own".
    save.recordRun(0, PAID.cost);
    save.unlockSkin(PAID.id);
    expect(save.data.selectedSkin).toBe(DEFAULT_CAT_SKIN);
  });

  it('gives everything back on a progress reset', () => {
    save.recordRun(900, PAID.cost);
    save.unlockSkin(PAID.id);
    save.selectSkin(PAID.id);

    save.reset();

    expect(save.fish).toBe(0);
    expect(save.bestDistance).toBe(0);
    expect(save.isSkinUnlocked(PAID.id)).toBe(false);
    expect(save.data.selectedSkin).toBe(DEFAULT_CAT_SKIN);
  });
});

describe('migrating a pre-shop save', () => {
  let adapter: MemoryAdapter;
  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  it('lets a returning player keep the coat they were already wearing', () => {
    // v3 charged nothing, so someone may have been wearing this for months.
    // Repossessing it on update would be the shop punishing them for having
    // played before it existed.
    adapter.set(KEY, JSON.stringify({ version: 3, selectedSkin: PAID.id }));
    const save = new SaveManager(adapter);

    expect(save.data.selectedSkin).toBe(PAID.id);
    expect(save.isSkinUnlocked(PAID.id)).toBe(true);
    // Scoped to that one coat - the rest of the shop is still to be earned.
    const others = CAT_SKINS.filter((s) => s.cost > 0 && s.id !== PAID.id);
    for (const skin of others) expect(save.isSkinUnlocked(skin.id)).toBe(false);
  });

  it('arrives with an empty wallet and no record', () => {
    adapter.set(KEY, JSON.stringify({ version: 3, selectedSkin: DEFAULT_CAT_SKIN }));
    const save = new SaveManager(adapter);
    expect(save.fish).toBe(0);
    expect(save.bestDistance).toBe(0);
  });

  it('does not grant an unowned coat to a v4 save that claims to wear one', () => {
    // The migration grant is conditioned on the save predating v4 for exactly
    // this reason: without that, hand-editing `selectedSkin` would be a free
    // coat, and the grant meant to be generous to old players would be the
    // way everyone skipped the shop.
    adapter.set(KEY, JSON.stringify({ version: 4, selectedSkin: PAID.id, unlockedSkins: [] }));
    const save = new SaveManager(adapter);

    expect(save.isSkinUnlocked(PAID.id)).toBe(false);
    expect(save.data.selectedSkin).toBe(DEFAULT_CAT_SKIN);
  });

  it('discards junk in the purchase list without losing the valid entries', () => {
    adapter.set(
      KEY,
      JSON.stringify({
        version: 4,
        selectedSkin: DEFAULT_CAT_SKIN,
        // A number, a retired id, a coat that is free anyway, and the same
        // real purchase twice.
        unlockedSkins: [7, 'grey', DEFAULT_CAT_SKIN, PAID.id, PAID.id],
        fish: 12,
      }),
    );
    const save = new SaveManager(adapter);

    expect(save.data.unlockedSkins).toEqual([PAID.id]);
    expect(save.fish).toBe(12);
  });

  it('clamps a hand-edited wallet instead of trusting it', () => {
    adapter.set(
      KEY,
      JSON.stringify({ version: 4, selectedSkin: DEFAULT_CAT_SKIN, fish: 1e308 }),
    );
    const save = new SaveManager(adapter);

    expect(Number.isFinite(save.fish)).toBe(true);
    // Still generous enough to buy anything - the cap is about keeping the
    // number renderable and the arithmetic sane, not about catching cheats.
    expect(save.fish).toBeGreaterThan(CAT_SKINS[CAT_SKINS.length - 1].cost);
  });

  it('ignores a negative wallet or record', () => {
    adapter.set(
      KEY,
      JSON.stringify({ version: 4, selectedSkin: DEFAULT_CAT_SKIN, fish: -50, bestDistance: -1 }),
    );
    const save = new SaveManager(adapter);
    expect(save.fish).toBe(0);
    expect(save.bestDistance).toBe(0);
  });
});
