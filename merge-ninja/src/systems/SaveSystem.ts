import { BALANCE } from '../data/balance';
import { isArchetypeId } from '../data/bossArchetypes';
import { isDraftCardId } from '../data/draftCards';
import { BOSS_COUNT } from '../data/enemies';
import { cleanStickerIds, isDojoStyleId, type DojoStyleId } from '../data/dojoStyles';
import { normalizeBest } from './BestRun';
import type { BestRun } from './BestRun';
import type { SessionMetrics, StorageLike } from '../data/types';

export interface SaveState {
  version: number;
  coins: number;
  board: Array<{ id: number; tier: number } | null>;
  stage: number;
  bossHp: number;
  damageCoinRemainder: number;
  totalPurchases: number;
  highestTierEverOwned: number;
  /** Current durability of the dojo's ninja line. Version 2 saves omit it. */
  playerHp?: number;
  /** Tiers whose full-screen introduction has already been acknowledged. */
  revealedTiers?: number[];
  /** Boss identities the player has faced, for the almanac. */
  seenBosses?: number[];
  /** Epoch ms of the last write; drives offline progress crediting. Version 4 saves omit it. */
  lastSavedAt?: number;
  /**
   * Board slots earned so far this run. Saves before version 6 predate slot
   * locking, so they migrate to a fully unlocked board rather than having
   * space taken back off a player mid-run.
   */
  unlockedSlots?: number;
  /** Slots a boss swing has blocked, with the time each has left on it. */
  debris?: Array<{ slot: number; msLeft: number }>;
  /** Draft cards taken this run. Telemetry only; nothing reads it back into the sim. */
  draftPicks?: string[];
  /** Bosses still owing a card row off the cadence, from a `hotHand` card. */
  bonusDraftBosses?: number;
  metrics: SessionMetrics;
}

/**
 * Meta-progression that outlives every run reset, including Settings' Restart
 * and, crucially, losing.
 *
 * The run slot is deleted the moment the line falls, so anything a player is
 * meant to *keep* has to live here instead. That includes the almanac: until
 * discoveries moved into this slot, dying erased every ninja and boss the
 * player had ever met, which quietly undid hours of collecting.
 */
export interface MetaState {
  ascensions: number;
  /** Best values ever recorded, across every run. Absent until a run ends. */
  best?: BestRun;
  /** Ids of achievements already awarded. */
  achievements?: string[];
  /** Local day index of the most recent visit; drives the daily bonus. */
  lastVisitDay?: number;
  /** How many distinct local days this player has ever opened the game. */
  daysVisited?: number;
  /** Lifetime: ninja tiers whose full-screen introduction has been acknowledged. */
  revealedTiers?: number[];
  /** Lifetime almanac: boss identities ever faced. */
  seenBosses?: number[];
  /**
   * Lifetime almanac: every ninja tier ever owned.
   *
   * Kept apart from `revealedTiers` because the two answer different
   * questions. The introduction modal is only ever shown for tier 2 and up, so
   * a set built from acknowledgements can never contain tier 1 and the
   * collection counter would sit one short of complete forever.
   */
  discoveredTiers?: number[];
  /** True once the full-roster fanfare has fired. It must never fire twice. */
  collectionCelebrated?: boolean;
  /** True once the first-run buy, merge, and boss-tap coach has been completed. */
  tutorialCompleted?: boolean;
  /** True once the player caught the first naturally introduced powerup. */
  powerupCoachCompleted?: boolean;
  /** Board lessons already shown: locked slots, thrown debris. Lifetime. */
  boardLessonsSeen?: string[];
  /**
   * Boss archetypes whose one-time introduction banner has already played.
   *
   * Lifetime, alongside the other "has this been taught" flags rather than in
   * the run slot: dying is not a reason to re-explain a mechanic the player
   * already learned, and the banner is the only teaching this game does for
   * them.
   */
  archetypeSeen?: string[];
  /** Lifetime boss seals collected from authored milestone victories. */
  collectedStickerIds?: string[];
  /** Player-selected cosmetic; GameCore checks that it is actually unlocked. */
  equippedDojoStyle?: DojoStyleId;
}

/** Safely persists complete runs while treating browser storage as optional. */
export class SaveSystem {
  constructor(private readonly storage: StorageLike | null) {}

  load(): SaveState | null {
    try {
      const raw = this.storage?.getItem(BALANCE.save.key);
      if (raw === null || raw === undefined) return null;
      const state: unknown = JSON.parse(raw);
      return this.valid(state) ? this.migrateRoster(state) : null;
    } catch {
      return null;
    }
  }

  save(state: SaveState): void {
    try {
      this.storage?.setItem(BALANCE.save.key, JSON.stringify(state));
    } catch {
      // Storage may throw in Safari private browsing; gameplay must continue.
    }
  }

  /** Forget the run entirely, so the next load starts a first-ever session. */
  clear(): void {
    try {
      this.storage?.removeItem(BALANCE.save.key);
    } catch {
      // Same as `save`: storage is a convenience, never a requirement.
    }
  }

  private valid(value: unknown): value is SaveState {
    if (typeof value !== 'object' || value === null) return false;

    const state = value as Partial<SaveState>;
    return (
      (state.version === 2 || state.version === 3 || state.version === 4 || state.version === 5 ||
        state.version === BALANCE.save.version) &&
      typeof state.coins === 'number' &&
      Array.isArray(state.board) &&
      typeof state.stage === 'number' &&
      typeof state.bossHp === 'number' &&
      typeof state.damageCoinRemainder === 'number' &&
      typeof state.totalPurchases === 'number' &&
      typeof state.highestTierEverOwned === 'number' &&
      typeof state.metrics === 'object' &&
      state.metrics !== null &&
      (state.version === 2 || typeof state.playerHp === 'number')
    );
  }

  /**
   * Version 3 shipped a 50-step visual ladder. The curated roster now has 29
   * unique supplied ninja portraits, so loading a former run must not leave a
   * deleted tier on the board or let its old rank inflate health and DPS.
   *
   * We preserve progression proportion rather than blindly clamping: a former
   * tier 25 lands around the middle of the new ladder, while tier 50 becomes
   * the new final evolution. Version 2 predates the expanded 50-step ladder
   * and therefore uses its 12-tier scale. Version 5 only adds `lastSavedAt`.
   *
   * Version 6 adds slot locking, debris, and the draft. A pre-6 save is
   * granted the whole board: locked slots are a pacing device for a fresh
   * climb, and confiscating space from a run already in progress would read as
   * a bug rather than as a mechanic. This runs on current-version saves too,
   * so it is also where every version-6 field gets sanitised.
   */
  private migrateRoster(state: SaveState): SaveState {
    const previousTierCount = state.version === 2 ? 12 : state.version === 3 ? 50 : BALANCE.tiers.count;
    const migrateTier = (value: number): number => {
      const tier = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
      if (previousTierCount === BALANCE.tiers.count) return Math.min(BALANCE.tiers.count, tier);
      return Math.min(BALANCE.tiers.count, Math.max(1, Math.ceil(tier * BALANCE.tiers.count / previousTierCount)));
    };

    return {
      ...state,
      version: BALANCE.save.version,
      board: state.board.map((item) => item === null ? null : { ...item, tier: migrateTier(item.tier) }),
      highestTierEverOwned: migrateTier(state.highestTierEverOwned),
      revealedTiers: state.revealedTiers?.map(migrateTier).filter((tier, index, all) => all.indexOf(tier) === index),
      seenBosses: state.seenBosses?.filter((identity) => Number.isInteger(identity) && identity >= 0 && identity < BOSS_COUNT),
      unlockedSlots: state.version < 6 ? BALANCE.board.slots : this.cleanUnlockedSlots(state.unlockedSlots),
      debris: state.version < 6 ? [] : this.cleanDebris(state.debris),
      draftPicks: Array.isArray(state.draftPicks) ? state.draftPicks.filter(isDraftCardId) : [],
      bonusDraftBosses: this.cleanCount(state.bonusDraftBosses, BALANCE.draft.hotHandBosses * 4),
      metrics: { ...state.metrics, highestTier: migrateTier(state.metrics.highestTier) },
    };
  }

  /**
   * Never fewer than the starting grant, never more than the board holds.
   *
   * A missing field means the save was written before slot locking existed,
   * whatever its version says, so it is granted the whole board for the same
   * reason the version migration is: space is never taken back off a run in
   * progress. Only a build that actually owns the mechanic writes the field.
   */
  /** A small non-negative counter, clamped so a hand-edited save cannot inflate it. */
  private cleanCount(value: unknown, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(max, Math.floor(value)));
  }

  private cleanUnlockedSlots(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return BALANCE.board.slots;
    return Math.max(BALANCE.slots.initial, Math.min(BALANCE.board.slots, Math.floor(value)));
  }

  /**
   * Debris entries pointing at a real slot with time still on them.
   *
   * A duplicated slot would let two blockers share one cell and leave the
   * board permanently short when only one of them cleared, so the first entry
   * for a slot wins and the rest are dropped.
   */
  private cleanDebris(value: unknown): Array<{ slot: number; msLeft: number }> {
    if (!Array.isArray(value)) return [];
    const taken = new Set<number>();
    const out: Array<{ slot: number; msLeft: number }> = [];
    for (const entry of value) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { slot, msLeft } = entry as { slot?: unknown; msLeft?: unknown };
      if (typeof slot !== 'number' || !Number.isInteger(slot)) continue;
      if (slot < 0 || slot >= BALANCE.board.slots || taken.has(slot)) continue;
      if (typeof msLeft !== 'number' || !Number.isFinite(msLeft) || msLeft <= 0) continue;
      taken.add(slot);
      out.push({ slot, msLeft: Math.min(BALANCE.debris.holdMs, msLeft) });
      if (out.length >= BALANCE.debris.maxConcurrent) break;
    }
    return out;
  }

  /**
   * Loads the meta slot, or null when it is absent or corrupt.
   *
   * Every field added after the original `{ ascensions }` shape is optional and
   * individually sanitised, so a slot written by an older build loads intact
   * and a single corrupt field costs only itself rather than the whole record.
   */
  loadMeta(): MetaState | null {
    try {
      const raw = this.storage?.getItem(BALANCE.save.metaKey);
      if (raw === null || raw === undefined) return null;
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null) return null;
      const meta = value as Partial<MetaState>;
      if (typeof meta.ascensions !== 'number' || !Number.isInteger(meta.ascensions) || meta.ascensions < 0) return null;

      const state: MetaState = { ascensions: meta.ascensions };
      if (typeof meta.best === 'object' && meta.best !== null) state.best = normalizeBest(meta.best);
      if (Array.isArray(meta.achievements)) {
        state.achievements = meta.achievements.filter((id): id is string => typeof id === 'string');
      }
      if (typeof meta.lastVisitDay === 'number' && Number.isFinite(meta.lastVisitDay)) {
        state.lastVisitDay = Math.floor(meta.lastVisitDay);
      }
      if (typeof meta.daysVisited === 'number' && Number.isFinite(meta.daysVisited) && meta.daysVisited > 0) {
        state.daysVisited = Math.floor(meta.daysVisited);
      }
      state.revealedTiers = this.cleanIndexList(meta.revealedTiers, 1, BALANCE.tiers.count);
      state.seenBosses = this.cleanIndexList(meta.seenBosses, 0, BOSS_COUNT - 1);
      state.discoveredTiers = this.cleanIndexList(meta.discoveredTiers, 1, BALANCE.tiers.count);
      if (meta.collectionCelebrated === true) state.collectionCelebrated = true;
      if (typeof meta.tutorialCompleted === 'boolean') state.tutorialCompleted = meta.tutorialCompleted;
      if (typeof meta.powerupCoachCompleted === 'boolean') state.powerupCoachCompleted = meta.powerupCoachCompleted;
      if (Array.isArray(meta.boardLessonsSeen)) {
        state.boardLessonsSeen = [...new Set(
          meta.boardLessonsSeen.filter((id): id is string => id === 'lockedSlots' || id === 'debris'),
        )];
      }
      if (Array.isArray(meta.archetypeSeen)) {
        state.archetypeSeen = [...new Set(meta.archetypeSeen.filter(isArchetypeId))];
      }
      if (Array.isArray(meta.collectedStickerIds)) state.collectedStickerIds = cleanStickerIds(meta.collectedStickerIds);
      if (isDojoStyleId(meta.equippedDojoStyle)) state.equippedDojoStyle = meta.equippedDojoStyle;
      return state;
    } catch {
      return null;
    }
  }

  /** Whole numbers inside an inclusive range, deduplicated; anything else dropped. */
  private cleanIndexList(value: unknown, min: number, max: number): number[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<number>();
    for (const entry of value) {
      if (typeof entry !== 'number' || !Number.isInteger(entry)) continue;
      if (entry < min || entry > max) continue;
      seen.add(entry);
    }
    return [...seen];
  }

  saveMeta(meta: MetaState): void {
    try {
      this.storage?.setItem(BALANCE.save.metaKey, JSON.stringify(meta));
    } catch {
      // Same contract as the run slot: storage is a convenience.
    }
  }

  /** Forgets everything, ascensions included. The debug panel is the only caller. */
  clearAll(): void {
    this.clear();
    try {
      this.storage?.removeItem(BALANCE.save.metaKey);
    } catch {
      // Storage may be unavailable; gameplay never depends on it.
    }
  }
}
