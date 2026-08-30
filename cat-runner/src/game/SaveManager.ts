/**
 * Progress persistence for Rooftop Rascal: Cat Escape.
 *
 * All reads/writes go through a small `StorageAdapter` seam rather than
 * calling `localStorage` directly, so a future platform build (e.g. a portal
 * SDK with its own cloud-save API) can swap the backing store without
 * touching any gameplay code that depends on `SaveManager`.
 */

import { CAT_SKINS } from '../entities/CatSkins';
import { TUTORIAL_LESSONS, isTutorialLesson, type TutorialLesson } from './Tutorial';

// ============================================================================
// Storage abstraction
// ============================================================================

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Default adapter, backed by `window.localStorage`.
 *
 * Private browsing modes, disabled cookies, and full storage quotas can all
 * make `localStorage` throw on *any* call (including just reading the
 * property). Rather than let that exception bubble up into gameplay code,
 * this adapter falls back to an in-memory `Map` the first time it happens -
 * progress won't survive a page reload in that session, but the game keeps
 * running instead of crashing.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private memoryFallback: Map<string, string> | null = null;

  private getStorage(): Storage | null {
    try {
      if (typeof window === 'undefined') return null;
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private useFallback(): Map<string, string> {
    if (!this.memoryFallback) this.memoryFallback = new Map();
    return this.memoryFallback;
  }

  get(key: string): string | null {
    if (this.memoryFallback) return this.memoryFallback.get(key) ?? null;
    try {
      const storage = this.getStorage();
      return storage ? storage.getItem(key) : this.useFallback().get(key) ?? null;
    } catch {
      return this.useFallback().get(key) ?? null;
    }
  }

  set(key: string, value: string): void {
    if (this.memoryFallback) {
      this.memoryFallback.set(key, value);
      return;
    }
    try {
      const storage = this.getStorage();
      if (storage) {
        storage.setItem(key, value);
      } else {
        this.useFallback().set(key, value);
      }
    } catch {
      this.useFallback().set(key, value);
    }
  }

  remove(key: string): void {
    if (this.memoryFallback) {
      this.memoryFallback.delete(key);
      return;
    }
    try {
      const storage = this.getStorage();
      if (storage) {
        storage.removeItem(key);
      } else {
        this.useFallback().delete(key);
      }
    } catch {
      this.useFallback().delete(key);
    }
  }
}

// ============================================================================
// Save data shape
// ============================================================================

/**
 * The six coats shipped with the character pack.
 *
 * `white` and `grey` are gone: they were ramp-generated recolours of the one
 * texture that used to exist, and the pack has no equivalent. `sanitize`
 * migrates a save naming either of them - see the v3 notes below.
 */
export type CatSkinId =
  | 'orange'
  | 'tabby'
  | 'calico'
  | 'siamese'
  | 'russianblue'
  | 'tuxedo'
  | 'black'
  | 'fluffy'
  | 'cheshire'
  | 'pinkie'
  | 'skeleton'
  | 'mummy'
  | 'cheetah'
  | 'tiger'
  | 'sailor'
  | 'sunset'
  | 'frankie'
  | 'rainbow';

export interface SaveData {
  version: number;
  selectedSkin: CatSkinId;
  /**
   * Coats bought with fish.
   *
   * Deliberately holds *purchases only*, not "everything the player can
   * wear": whether a coat is free is a property of the coat (`cost === 0` in
   * `CAT_SKINS`), so it is answered by `isSkinUnlocked` at read time rather
   * than baked into the file at creation time. That means a coat added later
   * at cost 0 is immediately wearable by existing saves, and a coat's price
   * can be changed without a migration - neither of which is true if the save
   * records the free set.
   */
  unlockedSkins: CatSkinId[];
  /**
   * Fish banked across every run so far, minus everything spent in the shop.
   *
   * This is a wallet, not a statistic: it goes down. "Fish collected this
   * run" lives on `Game` and is banked here once, when the run ends.
   */
  fish: number;
  /** Furthest single run, in metres. Drives the main menu's best-distance row. */
  bestDistance: number;
  /**
   * Lessons the player has already been shown - see `Tutorial.ts`.
   *
   * A list rather than a "hasSeenTutorial" flag because the two lessons are
   * taught independently, whenever the track first happens to deal each
   * hazard: a player can easily run four hundred metres over a clothesline
   * and never meet a trampoline, and the one they haven't met is still owed.
   */
  tutorialsLearned: TutorialLesson[];
}

const STORAGE_KEY = 'rooftop-rascal:save:v1';
/**
 * v2 swapped the free default skin from the orange tabby to the black tuxedo.
 *
 * v3 replaced the generated skins with the character pack's six authored coats
 * and stopped charging for them: every cat was selectable from the start. The
 * shape was unchanged across all three, so older saves migrate rather than
 * being discarded - see `sanitize`. Campaign-only fields (`levels`,
 * `highestLevelUnlocked`, `totalTokens`) that a pre-v4 save may still carry
 * are simply not read any more - endless run is the only mode now.
 *
 * v4 adds the shop: `fish` (a persistent wallet), `unlockedSkins` (what has
 * been bought with it), and `bestDistance` (the menu's high score). All three
 * are additive, so a v1-v3 save still migrates - it simply arrives with an
 * empty wallet and no purchases. The one thing migration must not do is take
 * a coat away: v3 charged nothing, so a returning player may be *wearing*
 * something that now has a price. `sanitize` grants exactly that coat rather
 * than resetting them to the default - see its note.
 *
 * v5 adds `tutorialsLearned`. Additive again, and deliberately arriving empty
 * for an existing save: a returning player being shown the duck prompt once
 * is a beat, being *never* shown it because their file predates the tutorial
 * is a player who never finds out the input exists.
 */
const CURRENT_VERSION = 5;
const OLDEST_MIGRATABLE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 250;

/**
 * Menu order, default first - derived from `CAT_SKINS` rather than repeated,
 * so adding a coat there is genuinely the only edit adding a coat needs.
 *
 * The import direction is safe despite looking circular: `CatSkins.ts` imports
 * `CatSkinId` from this module `import type`, which is erased entirely at
 * build time, so at runtime the dependency runs one way only.
 */
const ALL_SKINS: readonly CatSkinId[] = CAT_SKINS.map((s) => s.id);
const SKIN_ID_SET = new Set<string>(ALL_SKINS);

/** The coat a fresh save wears. Free by definition - asserted in the tests. */
const DEFAULT_SKIN: CatSkinId = 'orange';

/**
 * Retired skin id -> its nearest surviving coat.
 *
 * A v1/v2 save can name `grey` or `white`, neither of which has a texture any
 * more. Mapping them keeps a returning player's choice recognisable instead of
 * silently resetting them to the default.
 */
const RETIRED_SKINS: Record<string, CatSkinId> = {
  grey: 'russianblue',
  white: 'calico',
};

/** What a coat costs, or 0 for the ones that were never gated. */
function costOf(id: CatSkinId): number {
  return CAT_SKINS.find((s) => s.id === id)?.cost ?? 0;
}

/**
 * Wallet ceiling.
 *
 * Not a balance decision - no amount of play approaches it. It exists so a
 * hand-edited `fish: 1e308` cannot render as a number that breaks the shop's
 * layout, and so repeated banking can never drift into `Infinity`, which would
 * make every price look affordable and every subtraction a no-op.
 */
const MAX_FISH = 9_999_999;

function clampFish(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_FISH, Math.floor(value)));
}

function createDefaultSaveData(): SaveData {
  return {
    version: CURRENT_VERSION,
    selectedSkin: DEFAULT_SKIN,
    unlockedSkins: [],
    fish: 0,
    bestDistance: 0,
    tutorialsLearned: [],
  };
}

// ---------------------------------------------------------------------------
// Field-level validation helpers
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCatSkinId(value: unknown): value is CatSkinId {
  return typeof value === 'string' && SKIN_ID_SET.has(value);
}

// ============================================================================
// SaveManager
// ============================================================================

export class SaveManager {
  private readonly adapter: StorageAdapter;
  private _data: SaveData;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(adapter: StorageAdapter = new LocalStorageAdapter()) {
    this.adapter = adapter;
    this._data = createDefaultSaveData();
    this.load();
  }

  /** Exposed as a stable reference (mutated in place); reassigned wholesale only by load()/reset(). */
  get data(): SaveData {
    return this._data;
  }

  /**
   * Reloads from storage.
   *
   * Save files are effectively user-editable (raw localStorage, browser
   * devtools, or a hand-crafted string dropped in by a bug report) and can
   * arrive truncated, from a future/older version, or outright hostile. A
   * corrupt save must never crash the game - so JSON parsing is guarded, and
   * every field is independently re-validated by `sanitize()` regardless of
   * whether parsing "succeeded".
   */
  load(): void {
    const raw = this.adapter.get(STORAGE_KEY);
    if (raw === null) {
      this._data = createDefaultSaveData();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this._data = createDefaultSaveData();
      return;
    }

    this._data = this.sanitize(parsed);
  }

  /** Debounced write so rapid level restarts don't hammer storage. */
  save(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Immediate write, bypassing the debounce - use on page unload. */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.writeNow();
  }

  private writeNow(): void {
    try {
      this.adapter.set(STORAGE_KEY, JSON.stringify(this._data));
    } catch {
      // Best-effort persistence: a write failure (quota, etc) must not break gameplay.
    }
  }


  // -------------------------------------------------------------------------
  // Wallet
  // -------------------------------------------------------------------------

  /** Fish available to spend in the shop. */
  get fish(): number {
    return this._data.fish;
  }

  /** Furthest single run so far, in metres. */
  get bestDistance(): number {
    return this._data.bestDistance;
  }

  /**
   * Banks one finished run: its fish into the wallet, its distance against the
   * record.
   *
   * Called once, from `Game`'s failure handler, rather than continuously as
   * fish are picked up. That is what makes a run's fish *earned* - abandoning
   * a run to the menu mid-way banks nothing - and it also means the wallet
   * takes one write per run instead of one per pickup.
   *
   * Returns whether this run set a new record, so the caller can say so on the
   * results overlay without re-reading and comparing the value it just wrote.
   */
  recordRun(distance: number, fish: number): { bestDistance: number; isNewBest: boolean } {
    // Both inputs come from live gameplay counters, so they are guarded the
    // same way a loaded save's fields are: a NaN reaching the wallet would
    // poison it permanently, since NaN survives every later arithmetic op and
    // fails every comparison that might otherwise clear it.
    const earned = isFiniteNumber(fish) ? Math.max(0, Math.floor(fish)) : 0;
    const reached = isFiniteNumber(distance) ? Math.max(0, distance) : 0;

    this._data.fish = clampFish(this._data.fish + earned);
    const isNewBest = reached > this._data.bestDistance;
    if (isNewBest) this._data.bestDistance = reached;

    this.save();
    return { bestDistance: this._data.bestDistance, isNewBest };
  }

  // -------------------------------------------------------------------------
  // Coats
  // -------------------------------------------------------------------------

  /**
   * Whether a coat can be worn.
   *
   * Free coats are free for everyone, always, without the save file having to
   * say so - see `SaveData.unlockedSkins`. An id that names no shipped coat is
   * not "unlocked" in any sense, so it answers false rather than throwing.
   */
  isSkinUnlocked(id: CatSkinId): boolean {
    if (!SKIN_ID_SET.has(id)) return false;
    return costOf(id) <= 0 || this._data.unlockedSkins.includes(id);
  }

  /**
   * Buys a coat, if it is real, not already owned, and affordable.
   *
   * Returns false in all three of those cases without spending anything, so
   * the caller can treat a false as "nothing happened" and does not have to
   * pre-check affordability itself. Deliberately does *not* equip what it
   * buys - the shop calls `selectSkin` next, and keeping the two separate is
   * what lets `selectSkin` stay a pure "wear an owned coat".
   */
  unlockSkin(id: CatSkinId): boolean {
    if (!SKIN_ID_SET.has(id)) return false;
    if (this.isSkinUnlocked(id)) return false;

    const cost = costOf(id);
    if (cost > this._data.fish) return false;

    this._data.fish -= cost;
    this._data.unlockedSkins.push(id);
    this.save();
    return true;
  }

  /**
   * Equips a coat.
   *
   * Rejects anything the player does not own. A locked coat reaching here is
   * not necessarily a UI bug - the save file is user-editable, so `unlockedSkins`
   * is exactly as trustworthy as anything else in it - which is why the check
   * lives here rather than only on the shop card that renders the lock.
   */
  selectSkin(id: CatSkinId): void {
    if (!this.isSkinUnlocked(id)) return;
    this._data.selectedSkin = id;
    this.save();
  }

  /**
   * Banks the tutorial lessons the player has now been shown.
   *
   * Written through the same debounce as everything else - a lesson is
   * learned at most twice per install, so there is nothing to batch, but a
   * mid-run `localStorage` write on a phone is a frame either way.
   */
  setTutorialsLearned(lessons: readonly TutorialLesson[]): void {
    const next = TUTORIAL_LESSONS.filter((lesson) => lessons.includes(lesson));
    if (next.join() === this._data.tutorialsLearned.join()) return;
    this._data.tutorialsLearned = next;
    this.save();
  }

  /** Wipes all progress back to defaults - wallet, purchases, and record alike. */
  reset(): void {
    this._data = createDefaultSaveData();
    this.save();
  }

  /**
   * Re-derives a trustworthy `SaveData` from an arbitrary parsed JSON value.
   * Every field is checked for type and enum membership independently - a
   * save file failing in one field (e.g. a hand-edited `selectedSkin:
   * "rainbow"`) must not invalidate the rest of the player's progress.
   */
  private sanitize(raw: unknown): SaveData {
    const fallback = createDefaultSaveData();
    if (typeof raw !== 'object' || raw === null) return fallback;
    const obj = raw as Record<string, unknown>;

    // Versions 1..CURRENT share a shape, so they are read directly and fixed up
    // below. Anything outside that range is discarded rather than guessed at.
    const version = isFiniteNumber(obj.version) ? obj.version : -1;
    if (version < OLDEST_MIGRATABLE_VERSION || version > CURRENT_VERSION) return fallback;

    // A pre-v3 save can name a skin that no longer has a texture. Retired ids
    // are mapped to their nearest surviving coat rather than dropped, so
    // "I played as the grey one" still means something after the update.
    const stored = obj.selectedSkin;
    const remapped =
      typeof stored === 'string' && stored in RETIRED_SKINS ? RETIRED_SKINS[stored] : stored;

    const requestedSkin = isCatSkinId(remapped) ? remapped : DEFAULT_SKIN;

    // Purchases: filtered to shipped ids and de-duplicated, so neither a
    // retired coat nor a hand-edited duplicate can sit in the list. Free coats
    // are dropped here too - they are answered by cost, and storing them would
    // freeze today's prices into the file.
    const rawUnlocks = Array.isArray(obj.unlockedSkins) ? obj.unlockedSkins : [];
    const unlockedSkins = [...new Set(rawUnlocks.filter(isCatSkinId))].filter(
      (id) => costOf(id) > 0,
    );

    // v1-v3 charged nothing for coats, so a returning player can be wearing
    // one that now has a price. Taking it back would be the update punishing
    // them for having played earlier, so it is granted instead. Scoped to the
    // *equipped* coat only - the rest of the shop is still to be earned - and
    // conditioned on the save predating v4, so a v4 save hand-edited to equip
    // something unowned is still corrected below rather than rewarded.
    if (version < 4 && costOf(requestedSkin) > 0 && !unlockedSkins.includes(requestedSkin)) {
      unlockedSkins.push(requestedSkin);
    }

    const owned = costOf(requestedSkin) <= 0 || unlockedSkins.includes(requestedSkin);
    const selectedSkin = owned ? requestedSkin : DEFAULT_SKIN;

    return {
      version: CURRENT_VERSION,
      selectedSkin,
      unlockedSkins,
      fish: isFiniteNumber(obj.fish) ? clampFish(Math.floor(obj.fish)) : 0,
      bestDistance:
        isFiniteNumber(obj.bestDistance) && obj.bestDistance > 0 ? obj.bestDistance : 0,
      // Filtered against the shipped lesson ids and re-ordered to match them,
      // so a hand-edited file can neither invent a lesson nor suppress one by
      // listing it twice.
      tutorialsLearned: TUTORIAL_LESSONS.filter((lesson) =>
        (Array.isArray(obj.tutorialsLearned) ? obj.tutorialsLearned : [])
          .filter(isTutorialLesson)
          .includes(lesson),
      ),
    };
  }
}
