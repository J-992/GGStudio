import { BALANCE } from '../data/balance';
import { BOSS_COUNT } from '../data/enemies';
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
  /** True once the first-run buy, merge, and powerup coach has been completed. */
  tutorialCompleted?: boolean;
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
      (state.version === 2 || state.version === 3 || state.version === 4 || state.version === BALANCE.save.version) &&
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
      metrics: { ...state.metrics, highestTier: migrateTier(state.metrics.highestTier) },
    };
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
      if (meta.tutorialCompleted === true) state.tutorialCompleted = true;
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
