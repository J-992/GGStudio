import { ACHIEVEMENT_COUNT } from '../data/achievements';
import type { AchievementSnapshot } from '../data/achievements';
import { BALANCE, sellValueOf } from '../data/balance';
import type { OfflineConfig } from '../data/balance';
import { isArchetypeId, type ArchetypeId, type ArchetypeSpec } from '../data/bossArchetypes';
import { bossIdentityFor } from '../data/enemies';
import {
  CRIMSON_DOJO_PAGE,
  bossStickerForStage,
  dojoStyle,
  isDojoStyleUnlocked,
  legacyStickerIdsForReachedStage,
  stickerPageProgress,
  type DojoStyleDef,
  type DojoStyleId,
} from '../data/dojoStyles';
import { drawCards, isDraftCardId, type DraftCardId } from '../data/draftCards';
import { ninjaDef } from '../data/ninjas';
import { phaseClockAdvance, tempoFor } from '../data/pacing';
import { coinFrenzyCoinValue, POWERUPS, POWERUP_ORDER } from '../data/powerups';
import type { PowerupId } from '../data/powerups';
import type { DropResult, DropTarget, Ninja, SessionMetrics, StorageLike } from '../data/types';
import { AchievementSystem } from '../systems/AchievementSystem';
import { ascensionIncomeBonus, ascensionRank, ascensionUnlocked } from '../systems/AscensionSystem';
import type { AscensionRank } from '../systems/AscensionSystem';
import { improveBest, normalizeBest } from '../systems/BestRun';
import type { BestComparison, BestRun } from '../systems/BestRun';
import { currentDayIndex, dailyBonus } from '../systems/DailyBonus';
import { BossController } from '../systems/BossController';
import { DebrisField } from '../systems/DebrisField';
import { DraftSystem } from '../systems/DraftSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { MergeSystem } from '../systems/MergeSystem';
import { offlineReward } from '../systems/OfflineProgress';
import { PowerupSystem } from '../systems/PowerupSystem';
import { ProgressionSystem } from '../systems/ProgressionSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { EventBus } from './EventBus';

const freshMetrics = (): SessionMetrics => ({
  timePlayedMs: 0, purchases: 0, merges: 0, sells: 0, highestTier: 1,
  bossDefeats: 0, boardFullCount: 0, coinsEarned: 0,
});

/** Coordinates the board economy and the background boss spectacle. */
export class GameCore {
  readonly events = new EventBus();
  readonly economy: EconomySystem;
  readonly board = new MergeSystem();
  readonly boss: BossController;
  readonly progression: ProgressionSystem;
  /**
   * Session-luck pickups (frenzy, smoke, charm, ward, coin rain). Ephemeral by design:
   * never saved, cleared on game over and ascension. Spawn offers are gated
   * on the run being alive and unpaused so a modal can't burn one unseen.
   */
  readonly powerups = new PowerupSystem(POWERUP_ORDER.map((id) => POWERUPS[id]), {
    canSpawn: () => !this.over && this.speedMultiplier > 0,
  });
  /** Named goals and the ones already awarded. Lifetime, never reset by a run. */
  readonly achievements: AchievementSystem;
  readonly metrics: SessionMetrics;
  /** Tiers whose full-screen introduction has been acknowledged. */
  readonly revealedTiers: Set<number>;
  /**
   * Every ninja tier ever owned, across every run and ascension.
   *
   * This is what the almanac paints from. It deliberately does not live in the
   * run save: losing deletes that slot outright, and a collection that empties
   * itself every time the line falls is not a collection.
   */
  readonly discoveredTiers: Set<number>;
  /** Boss identities met so far. Feeds the almanac; never shrinks. */
  readonly seenBosses: Set<number>;
  /** Authored boss seals earned by milestone victories. Lifetime, unlike a run. */
  readonly collectedStickerIds: Set<string>;
  /** Archetypes whose one-time introduction banner has played. Lifetime. */
  readonly archetypeSeen: Set<ArchetypeId>;
  /** Board lessons already shown. Lifetime: dying is no reason to re-teach. */
  private readonly boardLessonsSeen: Set<string>;

  private readonly saves: SaveSystem;
  /** True when boot found an existing run save; false only on a first-ever session. */
  readonly loadedFromSave: boolean;
  private totalPurchases = 0;
  private speedMultiplier = 1;
  private dirty = false;
  /** A wiped core is a dead one: it must never write its run back out. */
  private wiped = false;
  /** Set the moment health hits zero; freezes the simulation for good. */
  private over = false;
  private saveTimer = 0;
  private boostRemainingMs = 0;
  private boostMultiplier = 1;
  private hintTimer = 0;
  private activeChampion = 0;
  private damageCoinRemainder = 0;
  /** Unclaimed click targets in the current Coin Frenzy rain. Never persisted. */
  private coinFrenzyRemaining = 0;
  /** Frozen at activation so one rain never changes value halfway through. */
  private coinFrenzyValue = 0;
  private playerHp: number = BALANCE.player.baseHealth;
  private activeTempoId = 'opening';
  private readonly now: () => number;
  /** Computed once at load; the scene consumes it to show the welcome back. */
  private offlineReward: { creditedMs: number; coins: number } | null = null;
  /** Same contract as the offline reward: computed at load, announced once. */
  private dailyReward: { coins: number; daysVisited: number } | null = null;
  private ascensions: number;
  /** Best values ever recorded. Survives losing, restarting and ascending. */
  private bestRun: BestRun;
  private lastVisitDay: number | null;
  private daysVisited: number;
  /** Throttle for the achievement sweep; the ladder is re-tested on a timer. */
  private achievementTimer = 0;
  /** True once the full-roster fanfare has fired, ever. Meta-scoped so it survives every future session. */
  private collectionCelebratedFlag: boolean;
  /** First-run coach completion is lifetime state, just like the almanac. */
  private tutorialCompletedFlag: boolean;
  /** The first naturally spawned powerup has been taught and caught. */
  private powerupCoachCompletedFlag: boolean;
  private equippedDojoStyleId: DojoStyleId;
  private tutorialShieldActive = false;
  /** One opt-in ad revive per run: valuable, but never an infinite stall. */
  private rewardedReviveUsed = false;
  private readonly draft: DraftSystem;
  /** Cards taken this run, oldest first. Telemetry only; never read back. */
  private draftPicks: DraftCardId[] = [];
  /** The reward the pending offer was drawn against; `purse` pays a multiple of it. */
  private pendingDraftReward = 0;
  /** Merges landing inside `combo.windowMs` of each other. */
  private comboCount = 0;
  private comboWindowMs = 0;
  /** Taps banked toward an earned powerup; the combat director owns the visuals. */
  private tapStreak = 0;
  private tapStreakWindowMs = 0;
  /** `focus` card: merges left that still land the heavier strike. */
  private focusMerges = 0;
  /** `edge` card: a flat board-DPS multiplier that burns down in real time. */
  private edgeRemainingMs = 0;
  private edgeMultiplier = 1;
  /** `stagger` card: while this is running the boss holds its swing. */
  private staggerRemainingMs = 0;
  /** `hotHand` card: bosses that deal a row even though the cadence says otherwise. */
  private bonusDraftBosses = 0;
  private readonly rng: () => number;
  private readonly debris: DebrisField;
  /** Board slots earned so far this run. Relocks on every reset, by design. */
  private unlockedSlots: number = BALANCE.board.slots;

  constructor(opts: { storage?: StorageLike | null; now?: () => number; rng?: () => number } = {}) {
    const storage = opts.storage === undefined ? this.defaultStorage() : opts.storage;
    this.saves = new SaveSystem(storage);
    this.now = opts.now ?? ((): number => Date.now());
    this.rng = opts.rng ?? ((): number => Math.random());
    this.draft = new DraftSystem({ resolved: (stage, card, auto) => this.applyDraftCard(stage, card, auto) });
    this.debris = new DebrisField({ rng: this.rng });
    const saved = this.saves.load();
    this.loadedFromSave = saved !== null;
    const meta = this.saves.loadMeta();
    this.ascensions = meta?.ascensions ?? 0;
    this.achievements = new AchievementSystem(meta?.achievements ?? []);
    this.bestRun = normalizeBest(meta?.best ?? null);
    this.lastVisitDay = meta?.lastVisitDay ?? null;
    this.daysVisited = meta?.daysVisited ?? 0;
    this.collectionCelebratedFlag = meta?.collectionCelebrated === true;
    // Existing players should never be dropped into a tutorial after updating.
    // A missing meta record is the one unambiguous first-ever session.
    this.tutorialCompletedFlag = meta?.tutorialCompleted ?? (meta !== null || saved !== null);
    this.powerupCoachCompletedFlag = meta?.powerupCoachCompleted ?? (meta !== null || saved !== null);
    const historicalReachedStage = Math.max(saved?.stage ?? 1, meta?.best?.stage ?? 1);
    this.collectedStickerIds = new Set(
      meta?.collectedStickerIds ?? legacyStickerIdsForReachedStage(historicalReachedStage),
    );
    this.archetypeSeen = new Set((meta?.archetypeSeen ?? []).filter(isArchetypeId));
    this.boardLessonsSeen = new Set(meta?.boardLessonsSeen ?? []);
    const requestedStyle = meta?.equippedDojoStyle ?? 'classic';
    this.equippedDojoStyleId = isDojoStyleUnlocked(requestedStyle, this.collectedStickerIds)
      ? requestedStyle
      : 'classic';
    this.economy = new EconomySystem(saved?.coins);
    this.progression = new ProgressionSystem(saved?.highestTierEverOwned);
    this.metrics = saved?.metrics ?? freshMetrics();
    // The safe runway begins with the first real purchase and ends when the
    // player applies the taught merge loop to the boss.
    this.tutorialShieldActive = !this.tutorialCompletedFlag && this.metrics.purchases > 0;
    // Discoveries are unioned across both slots so a player mid-upgrade keeps
    // everything: the meta slot is the new home, the run slot is where an
    // older build left them.
    this.revealedTiers = new Set([...(meta?.revealedTiers ?? []), ...(saved?.revealedTiers ?? [])]);
    this.seenBosses = new Set([...(meta?.seenBosses ?? []), ...(saved?.seenBosses ?? [])]);
    this.discoveredTiers = this.restoreDiscoveredTiers(meta?.discoveredTiers, saved?.highestTierEverOwned);
    this.totalPurchases = saved?.totalPurchases ?? 0;
    this.damageCoinRemainder = saved?.damageCoinRemainder ?? 0;
    this.draftPicks = (saved?.draftPicks ?? []).filter(isDraftCardId);
    this.bonusDraftBosses = saved?.bonusDraftBosses ?? 0;
    // A run in progress keeps whatever it had; only a fresh run starts small,
    // because relocking the board is the entire point of the mechanic and
    // taking slots off a live run would read as a bug.
    this.unlockedSlots = saved?.unlockedSlots ?? (saved === null ? BALANCE.slots.initial : BALANCE.board.slots);
    this.board.setUnlockedCount(this.unlockedSlots);
    this.debris.load(saved?.debris ?? []);
    for (const entry of this.debris.all) this.board.block(entry.slot);
    // A brand-new player meets the boss before they meet debris: the throw is
    // held off until the first-run coach is behind them.
    if (!this.tutorialCompletedFlag) this.debris.startGrace(Number.MAX_SAFE_INTEGER);
    if (saved !== null) this.board.load(saved.board);
    this.boss = new BossController(saved?.stage, saved?.bossHp);
    this.playerHp = this.clampPlayerHp(saved?.playerHp ?? this.playerMaxHealth);
    this.activeTempoId = this.tempo.id;
    this.syncChampion();
    this.emitBossSpawned();
    if (saved !== null) {
      this.creditOfflineProgress(saved.lastSavedAt);
      this.events.emit({ type: 'stateLoaded' });
    }
    this.creditDailyVisit();
    this.saveMeta();
  }

  /**
   * Seeds the lifetime collection on the first load of a build that has one.
   *
   * A returning player's discoveries were previously implied by two run-save
   * fields: the tiers they had been introduced to, and how high they had ever
   * climbed (every tier below that was necessarily owned). Both are folded in
   * so an existing almanac survives the move rather than starting empty.
   */
  private restoreDiscoveredTiers(stored: number[] | undefined, highestEverOwned: number | undefined): Set<number> {
    const tiers = new Set<number>(stored ?? []);
    for (const tier of this.revealedTiers) tiers.add(tier);
    const climbed = Math.max(0, Math.floor(highestEverOwned ?? 0));
    for (let tier = 1; tier <= Math.min(climbed, BALANCE.tiers.count); tier += 1) tiers.add(tier);
    return tiers;
  }

  update(dtMs: number): void {
    if (this.over) return;
    const real = Math.max(0, dtMs);
    // The clock pickup burns down in real time, so a reveal or the almanac
    // pausing the sim does not quietly eat the player's ten seconds.
    if (this.boostRemainingMs > 0 && this.speedMultiplier > 0) {
      this.boostRemainingMs = Math.max(0, this.boostRemainingMs - real);
      if (this.boostRemainingMs === 0) this.boostMultiplier = 1;
    }
    const dt = real * this.speedMultiplier * this.boostMultiplier;
    // The tempo clock runs on real time (boost capped), so a ten-second golden
    // clock cannot fast-forward the retention curve by a hundred seconds.
    // Everything downstream -- combat, income, hints, saves -- keeps the
    // full boosted dt.
    this.metrics.timePlayedMs += phaseClockAdvance(real, { boostMultiplier: this.boostMultiplier });
    const tempo = this.tempo;
    if (tempo.id !== this.activeTempoId) {
      this.activeTempoId = tempo.id;
      this.events.emit({ type: 'tempoChanged', id: tempo.id, label: tempo.label });
    }
    // Powerup durations are real-time like the boost itself, and freeze while
    // the sim is paused so a reveal modal never burns a frenzy unseen.
    // The card row and the `edge` buff burn down in real time, frozen while
    // the sim is paused, exactly like powerups and the golden clock: a reveal
    // modal must never eat an offer the player has not seen yet.
    const live = this.speedMultiplier > 0 ? real : 0;
    if (this.staggerRemainingMs > 0) {
      this.staggerRemainingMs = Math.max(0, this.staggerRemainingMs - live);
      if (this.staggerRemainingMs === 0) this.events.emit({ type: 'bossStaggered', msLeft: 0 });
    }
    if (this.edgeRemainingMs > 0) {
      this.edgeRemainingMs = Math.max(0, this.edgeRemainingMs - live);
      if (this.edgeRemainingMs === 0) this.edgeMultiplier = 1;
    }
    if (this.comboWindowMs > 0) {
      this.comboWindowMs = Math.max(0, this.comboWindowMs - live);
      if (this.comboWindowMs === 0 && this.comboCount > 0) {
        this.comboCount = 0;
        this.events.emit({ type: 'mergeComboChanged', count: 0, windowMs: 0 });
      }
    }
    if (this.tapStreakWindowMs > 0) {
      this.tapStreakWindowMs = Math.max(0, this.tapStreakWindowMs - live);
      if (this.tapStreakWindowMs === 0) this.tapStreak = 0;
    }
    this.draft.update(live);
    this.debris.update(live, (slot) => {
      this.board.unblock(slot);
      this.events.emit({ type: 'debrisCleared', slot, cause: 'expire' });
      this.markDirty();
    });
    this.powerups.update(live);
    const spawnedPowerup: PowerupId | null = this.powerups.maybeSpawn(this.metrics.timePlayedMs);
    if (spawnedPowerup !== null) {
      this.events.emit({ type: 'powerupSpawned', id: spawnedPowerup, travelMs: POWERUPS[spawnedPowerup].travelMs });
    }
    this.hintTimer += dt;
    this.boss.update(dt, this.effectiveDps, tempo, {
      damaged: (damage, hp, maxHp, dps) => this.handleBossDamage(damage, hp, maxHp, dps, 'ninja'),
      defeated: (stage, reward) => this.handleBossDefeated(stage, reward),
      spawned: () => { this.emitBossSpawned(); this.markDirty(); },
      attack: (damage) => this.receiveBossAttack(damage),
      canAttack: () => !this.powerups.bossAttacksPaused && this.staggerRemainingMs <= 0,
      enrageChanged: (enraged, regenPerSec) => {
        this.events.emit({ type: 'bossEnraged', enraged, regenPerSec: enraged ? regenPerSec : 0 });
      },
      bountyExpired: () => this.events.emit({ type: 'bossBountyResolved', won: false, bonus: 0 }),
      shieldDecayed: (charges, max) => {
        this.events.emit({ type: 'bossShieldChanged', charges, max, broken: charges === 0 });
      },
    });
    const pair = this.board.mergePair();
    if (this.hintTimer >= BALANCE.fx.hintIdleMs && pair !== null) {
      this.events.emit({ type: 'mergeHint', slots: pair });
      this.hintTimer = 0;
    }
    this.saveTimer += dt;
    if (this.dirty && this.saveTimer >= BALANCE.save.flushMs) this.save();
    // The ladder is seventeen cheap predicates, but there is no reason to run
    // it at frame rate; four times a second is far below noticing.
    this.achievementTimer += real;
    if (this.achievementTimer >= 250) {
      this.achievementTimer = 0;
      this.checkAchievements();
    }
  }

  /** The stage now being fought. */
  get currentStage(): number { return this.boss.stage; }
  /** The modifier the current boss carries, for the arena and the HUD. */
  get bossArchetype(): ArchetypeSpec { return this.boss.archetype; }
  get bossShieldCharges(): number { return this.boss.shieldCharges; }
  get bossBountyMsLeft(): number { return this.boss.bountyMsLeft; }
  get bossEnraged(): boolean { return this.boss.enraged; }
  get buyCost(): number { return this.economy.cost(this.totalPurchases, this.buyTier); }
  get tempo() { return tempoFor(this.metrics.timePlayedMs); }
  get buyTier(): number { return this.progression.buyTier(this.tempo.buyTierOffset); }
  get canBuy(): boolean { return this.economy.canAfford(this.buyCost) && this.board.firstEmpty() !== null; }
  get highestTier(): number { return this.board.highestTier(); }
  /** Compatibility seam for the current arena; foreground logic should use highestTier. */
  get championTier(): number { return this.highestTier; }
  get totalDps(): number { return this.board.slots.reduce((sum, ninja) => sum + (ninja ? ninjaDef(ninja.tier).dps : 0), 0); }
  /**
   * Board DPS after every temporary multiplier.
   *
   * `totalDps` stays the raw roster sum because the HUD, the almanac and the
   * merge-spike tests all want the honest board value; everything that
   * actually deals damage goes through here instead, so a buff can never be
   * applied twice or forgotten in one of the three strike paths.
   */
  get effectiveDps(): number { return this.totalDps * this.powerups.dpsMultiplier * this.edgeMultiplier; }
  /** Remaining `edge` buff, for the HUD chip. */
  /** Merges still carrying the `focus` bonus, for the HUD. */
  get focusMergesLeft(): number { return this.focusMerges; }
  get draftEdge(): { active: boolean; remainingMs: number; multiplier: number } {
    return { active: this.edgeRemainingMs > 0, remainingMs: this.edgeRemainingMs, multiplier: this.edgeMultiplier };
  }

  /** How long the boss still has to hold its swing, in ms. Zero when it may hit. */
  get staggerMsLeft(): number {
    return this.staggerRemainingMs;
  }
  get pendingDraft(): { stage: number; cards: readonly DraftCardId[]; msLeft: number; warning: boolean } | null {
    const offer = this.draft.pending;
    return offer === null ? null : { ...offer, msLeft: this.draft.msLeft, warning: this.draft.warning };
  }
  get bountyMsRemaining(): number { return this.draft.bountyMsRemaining; }
  /**
   * The live earn rate in coins per second: the exact rate damage coins accrue
   * during play. Offline crediting pays a reduced share of this.
   */
  get coinsPerSecond(): number {
    return this.totalDps * BALANCE.boss.coinsPerDamage * this.tempo.rewardMultiplier * this.incomeMultiplier
      * this.powerups.dpsMultiplier * this.powerups.coinMultiplier;
  }
  /** Permanent coin-income multiplier from stacked ascensions; 1 before the first. */
  get incomeMultiplier(): number { return 1 + ascensionIncomeBonus(this.ascensions); }
  get ascensionCount(): number { return this.ascensions; }
  /** The title carried between runs; index 0 until the first ascension. */
  get rank(): AscensionRank { return ascensionRank(this.ascensions); }
  /** The record board, for the end screen and the achievements page. */
  get best(): BestRun { return { ...this.bestRun }; }
  /** How many named goals are met, out of how many exist. */
  get achievementProgress(): { have: number; total: number } {
    return { have: this.achievements.unlockedCount, total: ACHIEVEMENT_COUNT };
  }
  /** Distinct local days this player has ever opened the game. */
  get daysPlayed(): number { return this.daysVisited; }
  get coinFrenzyState(): { remaining: number; coinValue: number } {
    return { remaining: this.coinFrenzyRemaining, coinValue: this.coinFrenzyValue };
  }
  /** True once the run has outlived its ladder and an ascension is on offer. */
  get canAscend(): boolean {
    return !this.over && ascensionUnlocked(this.boss.stage, this.progression.highestTierEverOwned);
  }
  get offlineConfig(): OfflineConfig { return BALANCE.offline; }
  get playerMaxHealth(): number {
    return BALANCE.player.baseHealth + (this.progression.highestTierEverOwned - 1) * BALANCE.player.healthPerTier;
  }
  get playerHealth(): number { return this.playerHp; }
  /** 0 when the line is gone, 1 at full strength. Drives the HUD and the warning. */
  get healthRatio(): number { return Math.max(0, Math.min(1, this.playerHp / Math.max(1, this.playerMaxHealth))); }
  /** True while the run is still alive but the line is nearly out. */
  get lowHealth(): boolean { return !this.over && this.healthRatio <= BALANCE.player.lowHealthRatio; }
  get isGameOver(): boolean { return this.over; }

  /**
   * Player-assisted boss strike. Every tap registers immediately, while each
   * each hit removes a clear one-percent health slice for playtesting. Returns
   * zero for an empty, paused or transitioning battle.
   */
  tapBoss(): number {
    if (this.over || this.speedMultiplier <= 0 || this.totalDps <= 0) return 0;
    // A barrier eats the tap instead of the boss. The player still spent an
    // action and still sees a segment shatter, so the tap is never wasted.
    if (this.boss.shielded) {
      this.boss.breakShield();
      this.notePlayerAction();
      this.events.emit({
        type: 'bossShieldChanged',
        charges: this.boss.shieldCharges,
        max: this.boss.archetype.shieldCharges,
        broken: this.boss.shieldCharges === 0,
      });
      this.markDirty();
      return 0;
    }
    const damage = Math.max(1, Math.round(this.boss.boss.maxHealth * BALANCE.boss.playerTapHealthShare));
    const dealt = this.boss.damage(damage, this.effectiveDps, {
      damaged: (hit, hp, maxHp, dps) => this.handleBossDamage(hit, hp, maxHp, dps, 'tap'),
      defeated: (stage, reward) => this.handleBossDefeated(stage, reward),
    });
    if (dealt > 0) {
      this.advanceTapStreak();
      this.notePlayerAction();
      if (this.tutorialShieldActive && this.metrics.merges > 0) this.completeTutorial();
    }
    return dealt;
  }

  /**
   * Give health back, from a potion pickup. Returns what actually landed, so
   * the pickup can show a real number rather than its nominal value.
   */
  healPlayer(amount: number): number {
    if (this.over) return 0;
    const before = this.playerHp;
    this.playerHp = this.clampPlayerHp(before + Math.max(0, Math.round(amount)));
    const healed = this.playerHp - before;
    if (healed > 0) {
      this.events.emit({ type: 'playerHealthChanged', hp: this.playerHp, maxHp: this.playerMaxHealth, delta: healed, reason: 'potion' });
      this.events.emit({ type: 'potionCollected', healed, hp: this.playerHp, maxHp: this.playerMaxHealth });
      this.markDirty();
    }
    return healed;
  }

  buy(): Ninja | null {
    if (this.over) return null;
    const empty = this.board.firstEmpty();
    if (!this.economy.canAfford(this.buyCost)) { this.events.emit({ type: 'purchaseRejected', reason: 'coins' }); return null; }
    if (empty === null) { this.metrics.boardFullCount += 1; this.events.emit({ type: 'boardFull' }); this.events.emit({ type: 'purchaseRejected', reason: 'boardFull' }); return null; }
    const tier = this.buyTier;
    const cost = this.buyCost;
    this.economy.spend(cost);
    const ninja = this.board.spawn(tier, empty);
    if (ninja === null) return null;
    this.totalPurchases += 1;
    this.metrics.purchases += 1;
    // Before the first buy there is no line to damage. From this moment until
    // the guided pickup is caught, a new player has room to learn safely.
    if (!this.tutorialCompletedFlag && this.metrics.purchases === 1) this.tutorialShieldActive = true;
    this.discoverTier(tier);
    this.metrics.highestTier = Math.max(this.metrics.highestTier, tier);
    this.events.emit({ type: 'coinsChanged', coins: this.economy.coins, delta: -cost });
    this.events.emit({ type: 'ninjaSpawned', ninja, cost });
    this.syncChampion(); this.markDirty(); return ninja;
  }

  drop(fromSlot: number, target: DropTarget): DropResult {
    if (this.over) return 'rejected';
    const source = this.board.at(fromSlot);
    if (source === null) return 'rejected';
    this.notePlayerAction();
    if (target.kind === 'trash') {
      const sold = this.board.remove(fromSlot); if (sold === null) return 'rejected';
      const refund = sellValueOf(sold.tier); this.metrics.sells += 1; this.changeCoins(refund);
      this.events.emit({ type: 'ninjaSold', id: sold.id, slot: fromSlot, refund }); this.syncChampion(); this.markDirty(); return 'sold';
    }
    if (target.slot < 0 || target.slot >= BALANCE.board.slots || target.slot === fromSlot) return 'rejected';
    const other = this.board.at(target.slot);
    if (other === null) {
      const moved = this.board.move(fromSlot, target.slot); if (moved === null) return 'rejected';
      this.events.emit({ type: 'ninjaMoved', id: moved.id, from: fromSlot, to: target.slot }); this.markDirty(); return 'moved';
    }
    if (other.tier !== source.tier) {
      const swapped = this.board.swap(fromSlot, target.slot); if (swapped === null) return 'rejected';
      this.events.emit({ type: 'ninjaSwapped', fromSlot, toSlot: target.slot, ids: [swapped[0].id, swapped[1].id], tiers: [swapped[0].tier, swapped[1].tier] }); this.markDirty(); return 'swapped';
    }
    // Same tier normally merges -- but a max-tier pair can never merge, so it
    // trades places like any different-tier pair instead of refusing silently.
    const merged = this.board.merge(fromSlot, target.slot);
    if (merged === null) {
      const swapped = this.board.swap(fromSlot, target.slot);
      if (swapped === null) return 'rejected';
      this.events.emit({ type: 'ninjaSwapped', fromSlot, toSlot: target.slot, ids: [swapped[0].id, swapped[1].id], tiers: [swapped[0].tier, swapped[1].tier] });
      this.markDirty();
      return 'swapped';
    }
    this.metrics.merges += 1; this.metrics.highestTier = Math.max(this.metrics.highestTier, merged.result.tier);
    if (!this.tutorialCompletedFlag) this.tutorialShieldActive = true;
    const discovered = this.discoverTier(merged.result.tier);
    this.events.emit({ type: 'ninjaMerged', fromSlot, toSlot: target.slot, consumedIds: merged.consumedIds, result: merged.result });
    if (discovered) this.events.emit({ type: 'newTierDiscovered', tier: merged.result.tier, name: ninjaDef(merged.result.tier).name });
    this.syncChampion();
    this.clearDebrisNear(target.slot);
    this.advanceMergeCombo();
    this.strikeBossFromMerge();
    this.markDirty(); return 'merged';
  }

  get mergeCombo(): { count: number; windowMs: number; target: number } {
    return { count: this.comboCount, windowMs: this.comboWindowMs, target: BALANCE.combo.rewardAt };
  }

  /**
   * Extends the merge chain, and pays out when it is long enough.
   *
   * The chain is the only reward in the game the player earns purely by
   * playing well rather than by waiting: the timed spawns in `powerups.ts` are
   * untouched and remain the floor, so nobody who never chains is starved.
   * A merge that clears debris counts like any other, so the two systems
   * compound in the player's favour instead of competing.
   */
  private advanceMergeCombo(): void {
    this.comboCount += 1;
    this.comboWindowMs = BALANCE.combo.windowMs;
    if (this.comboCount >= BALANCE.combo.rewardAt) {
      this.comboCount = 0;
      this.comboWindowMs = 0;
      this.events.emit({ type: 'mergeComboChanged', count: 0, windowMs: 0 });
      this.grantEarnedPowerup('merge', BALANCE.combo.rewardAt);
      return;
    }
    this.events.emit({ type: 'mergeComboChanged', count: this.comboCount, windowMs: this.comboWindowMs });
  }

  /**
   * Banks a tap toward the streak the combat director already counts.
   *
   * That counter has been drawing an escalating label trail since it shipped
   * and paying nothing at all; this is the payout it was always drawn for.
   */
  private advanceTapStreak(): void {
    this.tapStreak += 1;
    this.tapStreakWindowMs = BALANCE.combo.windowMs;
    if (this.tapStreak < BALANCE.combo.tapRewardAt) return;
    this.tapStreak = 0;
    this.tapStreakWindowMs = 0;
    this.grantEarnedPowerup('tap', BALANCE.combo.tapRewardAt);
  }

  /**
   * Hands over a powerup the player earned outright.
   *
   * Routed through the same `activate` path a caught token uses, so an earned
   * grant obeys the definition's own stack policy and per-powerup cap rather
   * than becoming a second way to hold five frenzies at once.
   *
   * The pool is deliberately combat only. Coin Frenzy is authored as a rare
   * surprise with its own eligibility window and handing it out on a chain
   * would quietly make it ordinary -- but Lucky Charm is excluded for a
   * harder reason: the pacing sim stalled the ten-minute run at 20.6s once
   * chains started paying it out. Doubling coins accelerates purchase-count
   * inflation (`costGrowth` compounds per purchase), the shop outruns income
   * a few minutes later, and the player is left staring at a board they
   * cannot act on. Skill pays in power here; money stays on its own curve.
   */
  private grantEarnedPowerup(source: 'merge' | 'tap', count: number): void {
    // A merge chain pays in safety, not in damage. The chain already hands the
    // player a stronger board and a merge strike; adding a DPS multiplier on
    // top raced the stage ladder ahead of the roster that has to kill it, and
    // the twenty-minute run stalled at 27s waiting for a boss it had outrun.
    // A tap streak still pays a frenzy -- twenty-five taps is rare enough that
    // it never compounds, and damage is the thing tapping is about.
    const eligible: PowerupId[] = source === 'tap'
      ? ['shurikenFrenzy', 'smokeBomb', 'protectiveWard']
      : ['smokeBomb', 'protectiveWard'];
    const preferred = eligible[Math.floor(this.rng() * eligible.length)];
    const order = [preferred ?? eligible[0]!, ...eligible];
    for (const id of order) {
      if (!this.powerups.activate(id)) continue;
      this.events.emit({ type: 'powerupCollected', id });
      this.events.emit({ type: 'mergeComboRewarded', id, count, source });
      this.markDirty();
      return;
    }
  }

  /** A merge shatters any debris orthogonally beside where it landed. */
  private clearDebrisNear(slot: number): number {
    return this.debris.clearNear(this.board.neighbours(slot), (cleared) => {
      this.board.unblock(cleared);
      this.events.emit({ type: 'debrisCleared', slot: cleared, cause: 'merge' });
    });
  }

  /** Slots the player has not earned yet, for the board renderer. */
  get lockedSlots(): readonly number[] { return this.board.lockedSlots; }
  get unlockedSlotCount(): number { return this.unlockedSlots; }
  /** The slot the next unlock will open, or null once the board is whole. */
  get nextUnlockSlot(): number | null {
    return this.unlockedSlots >= BALANCE.board.slots ? null : this.unlockedSlots;
  }
  /** The stage that opens the next slot, or null once the board is whole. */
  get nextUnlockStage(): number | null {
    const index = this.unlockedSlots - BALANCE.slots.initial;
    return BALANCE.slots.unlockStages[index] ?? null;
  }

  /** Slots a boss swing is currently holding, for the board renderer. */
  get debrisSlots(): ReadonlyArray<{ slot: number; msLeft: number }> { return this.debris.all; }

  /** Temporary speed-up granted by the golden clock pickup. */
  startTimeBoost(multiplier: number, durationMs: number): void {
    this.boostMultiplier = Math.max(1, multiplier);
    this.boostRemainingMs = Math.max(0, durationMs);
  }

  /**
   * Hands the welcome-back reward to the scene exactly once, so a banner can
   * be shown for it. The coins themselves were credited at load.
   */
  consumeOfflineReward(): { creditedMs: number; coins: number } | null {
    const reward = this.offlineReward;
    this.offlineReward = null;
    return reward;
  }

  /**
   * Hands the new-day gift to the scene exactly once. Same contract as the
   * offline reward: the coins were already credited at load, this is only the
   * permission to announce them.
   */
  consumeDailyBonus(): { coins: number; daysVisited: number } | null {
    const reward = this.dailyReward;
    this.dailyReward = null;
    return reward;
  }

  /**
   * The optional prestige reset. Wipes the run back to a first-ever session
   * (coins, board, stage, tier ladder, session metrics) but keeps everything
   * that makes the next run different from the last one: almanac discoveries,
   * and a permanent income bonus that grows with every ascension.
   */
  ascend(): void {
    if (!this.canAscend) return;
    // The run being left behind still counts toward personal bests, and is
    // banked before the reset wipes the numbers it is measured from.
    this.recordRunResult();
    this.ascensions += 1;
    const bonusPct = Math.round(ascensionIncomeBonus(this.ascensions) * 100);
    const rank = ascensionRank(this.ascensions);
    this.resetRun();
    this.saveMeta();
    this.events.emit({ type: 'ascended', ascensions: this.ascensions, bonusPct, rank: rank.name });
    this.checkAchievements();
  }

  /**
   * Debug-only full erasure: run save and meta slot together. This is the
   * only thing in the game that takes an earned ascension away.
   */
  wipeEverything(): void {
    this.ascensions = 0;
    this.achievements.clear();
    this.bestRun = normalizeBest(null);
    this.lastVisitDay = null;
    this.daysVisited = 0;
    this.revealedTiers.clear();
    this.discoveredTiers.clear();
    this.seenBosses.clear();
    this.collectedStickerIds.clear();
    this.equippedDojoStyleId = 'classic';
    this.wipeSave();
    this.saves.clearAll();
  }

  get timeBoost(): { active: boolean; remainingMs: number; multiplier: number } {
    return {
      active: this.boostRemainingMs > 0,
      remainingMs: this.boostRemainingMs,
      multiplier: this.boostMultiplier,
    };
  }

  setSpeed(mult: number): void { this.speedMultiplier = Math.max(0, mult); }
  get speed(): number { return this.speedMultiplier; }
  /** Marks a tier introduction as seen. Kept in the run save, not the UI. */
  revealTier(tier: number): boolean {
    if (this.revealedTiers.has(tier)) return false;
    this.revealedTiers.add(tier); this.markDirty(); this.save(); this.saveMeta(); return true;
  }
  grantCoins(n: number): void { this.changeCoins(n); }
  spawnTier(tier: number): Ninja | null {
    if (tier < 1 || tier > BALANCE.tiers.count) return null;
    const ninja = this.board.spawn(tier); if (ninja === null) return null;
    this.discoverTier(tier); this.metrics.highestTier = Math.max(this.metrics.highestTier, tier);
    this.events.emit({ type: 'ninjaSpawned', ninja, cost: 0 }); this.syncChampion(); this.markDirty(); return ninja;
  }
  clearBoard(): void { this.board.clear(); this.syncChampion(); this.markDirty(); }
  /** Debug-only stage advance, retained for the existing debug panel. */
  skipEnemy(): void { this.boss.forceNext(); this.emitBossSpawned(); this.markDirty(); }
  spawnBossNow(): void { this.emitBossSpawned(); }
  resetRun(): void {
    this.board.clear(); this.economy.coins = BALANCE.economy.startCoins; this.totalPurchases = 0;
    this.progression.highestTierEverOwned = 1; Object.assign(this.metrics, freshMetrics()); this.damageCoinRemainder = 0;
    this.powerups.clear();
    // Session luck does not survive a reset, and neither does a bet: carrying
    // a bounty or a live `edge` into a fresh stage-1 board would pay it out
    // against the easiest boss in the game.
    this.draft.reset(); this.draftPicks = []; this.pendingDraftReward = 0;
    this.comboCount = 0; this.comboWindowMs = 0; this.tapStreak = 0; this.tapStreakWindowMs = 0;
    // A fresh stage-1 board starts clean, and stays clean long enough for the
    // player to rebuild a line before the arena starts taking slots again.
    for (const entry of this.debris.all) this.board.unblock(entry.slot);
    this.debris.clear(); this.debris.startGrace();
    this.unlockedSlots = BALANCE.slots.initial; this.board.setUnlockedCount(this.unlockedSlots);
    this.bonusDraftBosses = 0; this.staggerRemainingMs = 0;
    this.edgeRemainingMs = 0; this.edgeMultiplier = 1; this.focusMerges = 0; this.staggerRemainingMs = 0;
    this.coinFrenzyRemaining = 0; this.coinFrenzyValue = 0;
    this.tutorialShieldActive = false;
    this.playerHp = this.playerMaxHealth; this.activeTempoId = this.tempo.id; this.over = false; this.rewardedReviveUsed = false;
    this.events.emit({ type: 'playerHealthChanged', hp: this.playerHp, maxHp: this.playerMaxHealth, delta: 0, reason: 'reset' });
    this.boss.reset(); this.syncChampion(); this.emitBossSpawned(); this.markDirty();
  }
  get canRewardedRevive(): boolean { return this.over && !this.rewardedReviveUsed; }
  /** Restores a defeated run only after the platform confirms an opted-in ad. */
  reviveFromRewardedAd(): boolean {
    if (!this.canRewardedRevive) return false;
    this.rewardedReviveUsed = true;
    this.over = false;
    this.wiped = false;
    this.playerHp = Math.max(1, Math.ceil(this.playerMaxHealth * 0.45));
    this.events.emit({ type: 'playerHealthChanged', hp: this.playerHp, maxHp: this.playerMaxHealth, delta: this.playerHp, reason: 'revive' });
    this.markDirty();
    this.save();
    return true;
  }
  /**
   * Throw the whole save away, discoveries included.
   *
   * `resetRun` rewinds the run but keeps what the player has already met,
   * which is what the debug panel wants. Settings' Restart means "be a new
   * player again", so it wipes the slot and lets the scene rebuild on nothing.
   * The pending-save flag is dropped first, or the next flush would write the
   * dead run straight back.
   */
  wipeSave(): void { this.dirty = false; this.saveTimer = 0; this.wiped = true; this.saves.clear(); }
  save(): void {
    if (this.wiped) return;
    this.saves.save({ version: BALANCE.save.version, coins: this.economy.coins, board: this.board.slots.map((ninja) => ninja === null ? null : { id: ninja.id, tier: ninja.tier }), stage: this.boss.stage, bossHp: this.boss.hp, damageCoinRemainder: this.damageCoinRemainder, draftPicks: [...this.draftPicks], debris: this.debris.serialize(), unlockedSlots: this.unlockedSlots, bonusDraftBosses: this.bonusDraftBosses, totalPurchases: this.totalPurchases, highestTierEverOwned: this.progression.highestTierEverOwned, playerHp: this.playerHp, revealedTiers: [...this.revealedTiers], seenBosses: [...this.seenBosses], lastSavedAt: Math.floor(this.now()), metrics: this.metrics });
    this.dirty = false; this.saveTimer = 0;
  }
  notePlayerAction(): void { this.hintTimer = 0; }
  /** Applies a collected powerup and announces it; false when refused. */
  collectPowerup(id: PowerupId): boolean {
    const applied = this.powerups.activate(id);
    if (applied) {
      const def = POWERUPS[id];
      if (def.effect === 'coinRain') {
        this.coinFrenzyRemaining = def.coinCount;
        this.coinFrenzyValue = coinFrenzyCoinValue(this.boss.stage);
      }
      this.events.emit({ type: 'powerupCollected', id });
    }
    return applied;
  }
  /** Credit exactly one visible rain coin. Returns zero for stale/double taps. */
  collectCoinFrenzyCoin(): number {
    if (this.coinFrenzyRemaining <= 0 || this.coinFrenzyValue <= 0) return 0;
    this.coinFrenzyRemaining -= 1;
    const value = this.coinFrenzyValue;
    this.changeCoins(value);
    this.finishCoinFrenzyIfEmpty();
    return value;
  }
  /** Remove a rain coin that reached the bottom; missed coins pay nothing. */
  missCoinFrenzyCoin(): boolean {
    if (this.coinFrenzyRemaining <= 0) return false;
    this.coinFrenzyRemaining -= 1;
    this.finishCoinFrenzyIfEmpty();
    return true;
  }
  private finishCoinFrenzyIfEmpty(): void {
    if (this.coinFrenzyRemaining !== 0) return;
    this.coinFrenzyValue = 0;
    this.events.emit({ type: 'coinFrenzyFinished' });
  }
  private syncChampion(): void { const current = this.highestTier; if (current !== this.activeChampion) { const prevTier = this.activeChampion; this.activeChampion = current; this.events.emit({ type: 'championChanged', tier: current, prevTier }); } }
  private strikeBossFromMerge(): number {
    // Any merge answers an enraged boss, whether or not it can reach past a
    // barrier -- the archetype asks for the verb, not for the damage.
    this.boss.noteMerge();
    if (this.boss.shielded) return 0;
    let share = BALANCE.progression.mergeStrikeHealthShare;
    if (this.focusMerges > 0) {
      this.focusMerges -= 1;
      share *= BALANCE.draft.focusStrikeMultiplier;
    }
    const damage = Math.max(1, Math.round(this.boss.boss.maxHealth * share));
    return this.boss.damage(damage, this.effectiveDps, {
      damaged: (hit, hp, maxHp, dps) => this.handleBossDamage(hit, hp, maxHp, dps, 'merge'),
      defeated: (stage, reward) => this.handleBossDefeated(stage, reward),
    });
  }
  private handleBossDamage(damage: number, hp: number, maxHp: number, dps: number, source: 'ninja' | 'tap' | 'merge'): void {
    this.events.emit({ type: 'bossDamaged', damage, hp, maxHp, dps, source });
    this.addDamageCoins(damage);
    this.markDirty();
  }
  private handleBossDefeated(stage: number, reward: number): void {
    this.metrics.bossDefeats += 1;
    const bounty = this.draft.consumeBounty();
    const bountyMultiplier = bounty === 'wager' ? BALANCE.draft.wagerMultiplier
      : bounty === 'bounty' ? BALANCE.draft.bountyMultiplier
      : 1;
    // A greedy boss pays its own multiple only if its window is still open;
    // the card's bounty stacks on top, because the player bet on this kill.
    const greed = this.boss.archetype.rewardMultiplier > 1 && this.boss.bountyMsLeft > 0
      ? this.boss.archetype.rewardMultiplier
      : 1;
    const multiplier = this.tempo.rewardMultiplier * this.incomeMultiplier * this.powerups.coinMultiplier
      * bountyMultiplier * greed;
    const pacedReward = Math.max(1, Math.round(reward * multiplier));
    this.changeCoins(pacedReward);
    this.restorePlayerHealth(Math.ceil(this.playerMaxHealth * BALANCE.player.bossVictoryHealRatio), 'victory');
    this.events.emit({ type: 'bossDefeated', stage, reward: pacedReward });
    if (bounty !== null || greed > 1) {
      const stacked = bountyMultiplier * greed;
      this.events.emit({ type: 'bossBountyResolved', won: true, bonus: pacedReward - Math.round(pacedReward / stacked) });
    }
    this.collectBossSticker(stage);
    this.unlockSlotsFor(stage);
    this.offerDraft(stage, pacedReward);
    this.markDirty();
  }

  /**
   * Puts three cards up for the kill that just happened.
   *
   * Suppressed for the whole of the first-run coach: the opening minutes are
   * already teaching buy, merge and tap, and the funnel showed the tutorial
   * chain is where players leave. The draft introduces itself later, on a
   * board the player already understands.
   */
  private offerDraft(stage: number, reward: number): void {
    if (this.tutorialShieldActive || !this.tutorialCompletedFlag) return;
    // Every fifth boss, not every boss. A choice that arrives constantly is
    // chrome to tap through; spaced out it is an event the player sees coming.
    // `hotHand` spends its charges here: the cadence still owns every fifth
    // boss, and the card buys the ones in between.
    const offCadence = stage % BALANCE.draft.everyStages !== 0;
    if (offCadence && this.bonusDraftBosses <= 0) return;
    if (offCadence) this.bonusDraftBosses -= 1;
    const cards = drawCards(
      {
        boardHasFreeSlot: this.board.firstEmpty() !== null,
        boardHasFighter: this.board.slots.some((ninja) => ninja !== null),
        healthRatio: this.healthRatio,
        boardHasDebris: this.debris.all.length > 0,
        boardHasLockedSlot: this.unlockedSlots < BALANCE.board.slots,
        bossHasTrick: this.boss.archetype.id !== 'bare',
      },
      this.rng,
    );
    if (cards.length === 0) return;
    this.pendingDraftReward = reward;
    this.draft.present(stage, cards);
    this.events.emit({ type: 'draftOffered', stage, cards });
  }

  /**
   * Promotes the board's weakest fighters one tier each.
   *
   * Deliberately the weakest rather than the strongest: promoting the top of
   * the board skips the ladder, while promoting the bottom hands the player a
   * merge they can see and hardly moves total DPS. Nothing is destroyed -- the
   * fighter keeps its slot and comes back one rank up.
   */
  private promoteWeakest(count: number): number {
    let promoted = 0;
    for (let step = 0; step < count; step += 1) {
      let best: { slot: number; tier: number } | null = null;
      this.board.slots.forEach((ninja, slot) => {
        if (ninja === null || ninja.tier >= BALANCE.tiers.count) return;
        if (best === null || ninja.tier < best.tier) best = { slot, tier: ninja.tier };
      });
      if (best === null) break;
      const target = best as { slot: number; tier: number };
      this.board.remove(target.slot);
      const grown = this.board.spawn(target.tier + 1, target.slot);
      if (grown === null) break;
      promoted += 1;
      this.discoverTier(grown.tier);
      this.metrics.highestTier = Math.max(this.metrics.highestTier, grown.tier);
      this.events.emit({ type: 'ninjaSpawned', ninja: grown, cost: 0 });
    }
    if (promoted > 0) { this.syncChampion(); this.markDirty(); }
    return promoted;
  }

  /**
   * Takes every blocked slot back at once.
   *
   * Debris clears itself on a timer anyway, so this card is not buying the
   * space -- it is buying the space *now*, in the minute the player is short
   * of it. Each slot is reported as a normal clear so the board animates it
   * the way it animates a merge clearing one.
   */
  private sweepDebris(): number {
    const blocked = this.debris.all.map((entry) => entry.slot);
    for (const slot of blocked) {
      this.debris.remove(slot);
      this.board.unblock(slot);
      this.events.emit({ type: 'debrisCleared', slot, cause: 'merge' });
    }
    if (blocked.length > 0) this.markDirty();
    return blocked.length;
  }

  /**
   * Pulls the next laddered slot unlock forward to now.
   *
   * Deliberately not an *extra* slot. Board space is the throttle the economy
   * is balanced against: every added slot raises the purchase count, and
   * `economy.costGrowth` compounds on that, so a run handed spare slots pays
   * for them minutes later in a shop it can no longer afford -- the twenty
   * minute pacing sim stalled at 20.8s against a 20.1s bound on exactly that.
   * Taking the slot early is worth plenty on its own: it arrives in the minute
   * the board is tight rather than at the stage the ladder chose.
   */
  private pullForwardSlotUnlock(): boolean {
    if (this.unlockedSlots >= BALANCE.board.slots) return false;
    const slot = this.unlockedSlots;
    this.unlockedSlots += 1;
    this.board.setUnlockedCount(this.unlockedSlots);
    this.events.emit({ type: 'slotUnlocked', slot, unlockedTotal: this.unlockedSlots });
    this.markDirty();
    return true;
  }

  /**
   * Copies the board's best fighter into a free slot.
   *
   * The merge-shaped reward: it does not hand over a tier the player has not
   * reached, it hands over the *second half of a pair*, which is one drag away
   * from being a promotion they earned. Capped below the top tier for the same
   * reason `drill` is -- there is nothing above it to merge into.
   */
  private echoStrongest(): number | null {
    let best: number | null = null;
    for (const ninja of this.board.slots) {
      if (ninja === null || ninja.tier >= BALANCE.tiers.count) continue;
      if (best === null || ninja.tier > best) best = ninja.tier;
    }
    if (best === null) return null;
    const spawned = this.spawnTier(best);
    return spawned === null ? null : best;
  }

  /** Immediate damage on the boss in front of the player, through the usual path. */
  private barrageBoss(): number {
    const damage = Math.max(1, Math.round(this.boss.boss.maxHealth * BALANCE.draft.barrageHealthShare));
    if (this.boss.shielded) return 0;
    return this.boss.damage(damage, this.effectiveDps, {
      damaged: (hit, hp, maxHp, dps) => this.handleBossDamage(hit, hp, maxHp, dps, 'merge'),
      defeated: (stage, reward) => this.handleBossDefeated(stage, reward),
    });
  }

  /** Takes the card the player tapped. Returns false for a card not on offer. */
  pickDraftCard(card: DraftCardId): boolean { return this.draft.pick(card); }

  private applyDraftCard(stage: number, card: DraftCardId, auto: boolean): void {
    const reward = this.pendingDraftReward;
    this.pendingDraftReward = 0;
    switch (card) {
      case 'purse':
        this.changeCoins(Math.max(1, Math.round(reward * BALANCE.draft.purseMultiplier)));
        break;
      case 'focus':
        this.focusMerges = BALANCE.draft.focusMerges;
        break;
      case 'recruit':
        this.spawnTier(Math.min(BALANCE.tiers.count, this.buyTier + BALANCE.draft.recruitTierBonus));
        break;
      case 'drill':
        this.promoteWeakest(BALANCE.draft.drillCount);
        break;
      case 'bounty':
        this.draft.armBounty('bounty');
        break;
      case 'wager':
        this.draft.armBounty('wager');
        break;
      case 'mend':
        this.restorePlayerHealth(Math.ceil(this.playerMaxHealth * BALANCE.draft.mendHealRatio), 'draft');
        break;
      case 'ward':
        if (this.powerups.activate('protectiveWard')) this.events.emit({ type: 'powerupCollected', id: 'protectiveWard' });
        break;
      case 'edge':
        this.edgeMultiplier = BALANCE.draft.edgeMultiplier;
        this.edgeRemainingMs = BALANCE.draft.edgeDurationMs;
        break;
      case 'barrage':
        this.barrageBoss();
        break;
      case 'sweep':
        this.sweepDebris();
        break;
      case 'openMat':
        this.pullForwardSlotUnlock();
        break;
      case 'echo':
        this.echoStrongest();
        break;
      case 'disarm':
        if (this.boss.disarm()) {
          this.events.emit({ type: 'bossShieldChanged', charges: 0, max: 0, broken: true });
          this.events.emit({ type: 'bossEnraged', enraged: false, regenPerSec: 0 });
          this.events.emit({ type: 'bossDisarmed', stage: this.boss.stage });
        }
        break;
      case 'stagger':
        this.staggerRemainingMs = BALANCE.draft.staggerMs;
        this.events.emit({ type: 'bossStaggered', msLeft: this.staggerRemainingMs });
        break;
      case 'hotHand':
        this.bonusDraftBosses += BALANCE.draft.hotHandBosses;
        break;
    }
    this.draftPicks.push(card);
    this.events.emit({ type: 'draftPicked', stage, card, auto });
    this.markDirty();
  }

  /**
   * Announces the modifier the new boss carries.
   *
   * The banner fires once per archetype per player, ever -- it is the only
   * teaching these mechanics get, and repeating it every eighth stage would
   * turn a lesson into chrome.
   */
  private emitArchetype(): void {
    const spec = this.boss.archetype;
    if (spec.id === 'bare') return;
    const firstSeen = !this.archetypeSeen.has(spec.id);
    if (firstSeen) {
      this.archetypeSeen.add(spec.id);
      this.saveMeta();
    }
    this.events.emit({ type: 'bossArchetype', stage: this.boss.stage, archetype: spec.id, firstSeen });
    if (spec.shieldCharges > 0) {
      this.events.emit({ type: 'bossShieldChanged', charges: spec.shieldCharges, max: spec.shieldCharges, broken: false });
    }
  }

  /**
   * A swing that could not meaningfully hurt the line takes a slot instead.
   *
   * Held off entirely while the first-run coach is running, and refused
   * whenever it would leave the board too tight to act on -- `DebrisField`
   * owns both rules so no caller can forget one.
   */
  private maybeThrowDebris(): void {
    // An enraged boss already asks for a merge on a clock. Taking a slot at
    // the same time, before the player has the board to absorb it, is the
    // arithmetic death the maxHitShare comment warns about -- so below the
    // rest-beat line the two never stack.
    if (this.boss.archetype.regenPerSec > 0 && this.boss.stage < BALANCE.archetypes.restBeatUntilStage) return;
    const slot = this.debris.maybeThrow(this.boss.stage, this.board.freeSlots);
    if (slot === null) return;
    this.board.block(slot);
    this.events.emit({ type: 'debrisLanded', slot, msLeft: BALANCE.debris.holdMs });
    this.markDirty();
  }

  /**
   * Opens every slot the player has now earned.
   *
   * Driven off the stage rather than a counter so a skipped or replayed stage
   * cannot desynchronise the board from the ladder, and so a save restored
   * mid-run lands on exactly the slots its stage says it should have.
   */
  private unlockSlotsFor(stage: number): void {
    const earned = BALANCE.slots.unlockStages.filter((at) => stage >= at).length;
    const target = Math.min(BALANCE.board.slots, BALANCE.slots.initial + earned);
    while (this.unlockedSlots < target) {
      const slot = this.unlockedSlots;
      this.unlockedSlots += 1;
      this.board.setUnlockedCount(this.unlockedSlots);
      this.events.emit({ type: 'slotUnlocked', slot, unlockedTotal: this.unlockedSlots });
    }
  }

  private collectBossSticker(stage: number): void {
    const sticker = bossStickerForStage(stage);
    if (sticker === null || this.collectedStickerIds.has(sticker.id)) return;
    this.collectedStickerIds.add(sticker.id);
    const progress = stickerPageProgress(CRIMSON_DOJO_PAGE, this.collectedStickerIds);
    this.saveMeta();
    this.events.emit({
      type: 'bossStickerCollected',
      id: sticker.id,
      pageId: sticker.pageId,
      stage: sticker.stage,
      slot: sticker.slot,
      progress: progress.have,
      total: progress.total,
      textureKey: sticker.textureKey,
      pageComplete: progress.complete,
    });
    if (!progress.complete) return;
    this.events.emit({ type: 'dojoStyleUnlocked', id: CRIMSON_DOJO_PAGE.rewardStyleId });
    this.equipDojoStyle(CRIMSON_DOJO_PAGE.rewardStyleId, 'unlock');
  }
  private addDamageCoins(damage: number): void {
    this.damageCoinRemainder += damage * BALANCE.boss.coinsPerDamage * this.tempo.rewardMultiplier
      * this.incomeMultiplier * this.powerups.coinMultiplier;
    const whole = Math.floor(this.damageCoinRemainder);
    if (whole > 0) { this.damageCoinRemainder -= whole; this.changeCoins(whole); }
  }
  private changeCoins(delta: number): void { if (delta <= 0) return; this.economy.add(delta); this.metrics.coinsEarned += delta; this.events.emit({ type: 'coinsChanged', coins: this.economy.coins, delta }); this.markDirty(); }
  /**
   * Pays out the time the tab was closed, at the reduced offline rate. The
   * reward is remembered for the scene to announce once it is listening —
   * events emitted in the constructor would find no audience.
   */
  private creditOfflineProgress(lastSavedAt: number | undefined): void {
    if (typeof lastSavedAt !== 'number' || !Number.isFinite(lastSavedAt)) return;
    const elapsedMs = Math.floor(this.now()) - Math.floor(lastSavedAt);
    const reward = offlineReward(elapsedMs, this.coinsPerSecond, BALANCE.offline);
    if (reward === null) return;
    this.offlineReward = reward;
    this.changeCoins(reward.coins);
  }
  /**
   * Notes that the player showed up, and pays the day's welcome-back gift.
   *
   * The very first time this ever runs for a given player the day is only
   * recorded, never paid: with no history to compare against, "welcome back"
   * on a first-ever session would be a lie, and paying an existing player for
   * merely upgrading builds would be an accident rather than a reward.
   */
  private creditDailyVisit(): void {
    const today = currentDayIndex(this.now());
    if (this.lastVisitDay === null) {
      this.lastVisitDay = today;
      this.daysVisited = Math.max(1, this.daysVisited);
      return;
    }
    const reward = dailyBonus(this.lastVisitDay, today, this.coinsPerSecond, this.daysVisited, BALANCE.daily);
    if (reward === null) return;
    this.lastVisitDay = reward.dayIndex;
    this.daysVisited = reward.daysVisited;
    this.dailyReward = { coins: reward.coins, daysVisited: reward.daysVisited };
    this.changeCoins(reward.coins);
  }

  /** Writes the whole cross-run record in one go; every field is meta-scoped. */
  private saveMeta(): void {
    this.saves.saveMeta({
      ascensions: this.ascensions,
      best: this.bestRun,
      achievements: this.achievements.unlockedIds,
      lastVisitDay: this.lastVisitDay ?? undefined,
      daysVisited: this.daysVisited,
      revealedTiers: [...this.revealedTiers],
      seenBosses: [...this.seenBosses],
      discoveredTiers: [...this.discoveredTiers],
      collectionCelebrated: this.collectionCelebratedFlag,
      tutorialCompleted: this.tutorialCompletedFlag,
      powerupCoachCompleted: this.powerupCoachCompletedFlag,
      collectedStickerIds: [...this.collectedStickerIds],
      archetypeSeen: [...this.archetypeSeen],
      boardLessonsSeen: [...this.boardLessonsSeen],
      equippedDojoStyle: this.equippedDojoStyleId,
    });
  }

  get equippedDojoStyle(): DojoStyleDef {
    return dojoStyle(this.equippedDojoStyleId);
  }

  get crimsonDojoProgress(): ReturnType<typeof stickerPageProgress> {
    return stickerPageProgress(CRIMSON_DOJO_PAGE, this.collectedStickerIds);
  }

  isDojoStyleUnlocked(id: DojoStyleId): boolean {
    return isDojoStyleUnlocked(id, this.collectedStickerIds);
  }

  equipDojoStyle(id: DojoStyleId, source: 'unlock' | 'player' = 'player'): boolean {
    if (!isDojoStyleUnlocked(id, this.collectedStickerIds)) return false;
    if (this.equippedDojoStyleId === id) return true;
    this.equippedDojoStyleId = id;
    this.saveMeta();
    this.events.emit({ type: 'dojoStyleEquipped', id, source });
    return true;
  }

  /** Whether the one-time full-roster fanfare has already fired, ever. */
  get collectionCelebrated(): boolean {
    return this.collectionCelebratedFlag;
  }

  /** Marks the full-roster fanfare as spent, for good. A no-op past the first call. */
  markCollectionCelebrated(): void {
    if (this.collectionCelebratedFlag) return;
    this.collectionCelebratedFlag = true;
    this.saveMeta();
  }

  /** The scene calls this after the player applies the opening lesson to the boss. */
  get tutorialCompleted(): boolean {
    return this.tutorialCompletedFlag;
  }

  get powerupCoachCompleted(): boolean {
    return this.powerupCoachCompletedFlag;
  }

  boardLessonSeen(id: string): boolean { return this.boardLessonsSeen.has(id); }

  /** Marks a board lesson taught, for good. */
  completeBoardLesson(id: string): void {
    if (this.boardLessonsSeen.has(id)) return;
    this.boardLessonsSeen.add(id);
    this.saveMeta();
  }

  completeTutorial(): void {
    if (this.tutorialCompletedFlag) return;
    this.tutorialCompletedFlag = true;
    this.tutorialShieldActive = false;
    // The indefinite hold set at boot becomes an ordinary grace: the lesson is
    // over, but the very next swing should still not take a slot.
    this.debris.clear();
    this.debris.startGrace();
    this.saveMeta();
    this.events.emit({ type: 'tutorialCompleted' });
  }

  completePowerupCoach(id: PowerupId): void {
    if (this.powerupCoachCompletedFlag) return;
    this.powerupCoachCompletedFlag = true;
    this.saveMeta();
    this.events.emit({ type: 'powerupCoachCompleted', id });
  }

  notePowerupExpired(id: PowerupId): void {
    this.events.emit({ type: 'powerupExpired', id });
  }

  /** Everything the award ladder is allowed to see, gathered in one place. */
  private achievementSnapshot(): AchievementSnapshot {
    return {
      stage: this.boss.stage,
      highestTier: this.progression.highestTierEverOwned,
      merges: this.metrics.merges,
      purchases: this.metrics.purchases,
      bossDefeats: this.metrics.bossDefeats,
      coinsEarned: this.metrics.coinsEarned,
      timePlayedMs: this.metrics.timePlayedMs,
      tiersDiscovered: this.discoveredTiers.size,
      bossesSeen: this.seenBosses.size,
      ascensions: this.ascensions,
      daysVisited: this.daysVisited,
    };
  }

  /**
   * Re-tests the award ladder and announces anything newly earned.
   *
   * Never called from the constructor: events emitted there would find no
   * listeners and the unlock would be spent in silence. The first `update`
   * tick catches up instead, which is also what gives a long-time player a
   * short parade of everything they had already done the first time they open
   * a build that has achievements in it.
   */
  private checkAchievements(): void {
    const earned = this.achievements.claim(this.achievementSnapshot());
    if (earned.length === 0) return;
    this.saveMeta();
    for (const entry of earned) {
      this.events.emit({
        type: 'achievementUnlocked',
        id: entry.id,
        name: entry.name,
        description: entry.description,
        kind: entry.kind,
        unlockedCount: this.achievements.unlockedCount,
        total: ACHIEVEMENT_COUNT,
      });
    }
  }

  /**
   * Folds a finished run into the record board and persists it.
   *
   * Called for both ways a run can end: losing it, and choosing to ascend out
   * of it. A voluntary reset is still a run that happened, and quietly losing
   * a personal best because the player pressed the prestige button would be a
   * punishment for engaging with the deepest system in the game.
   */
  private recordRunResult(): BestComparison {
    const comparison = improveBest(this.bestRun, {
      stage: this.boss.stage,
      tier: this.progression.highestTierEverOwned,
      coins: this.metrics.coinsEarned,
      timeMs: this.metrics.timePlayedMs,
    });
    this.bestRun = comparison.best;
    this.saveMeta();
    return comparison;
  }

  /**
   * Test seam for a lost run: `endRun` is only reachable through combat, and
   * the ascension persistence contract has to hold across a loss too.
   */
  endRunForTest(): void { this.endRun(); }
  /** Cards taken this run, oldest first. Telemetry and verification only. */
  get draftPicksThisRun(): readonly DraftCardId[] { return this.draftPicks; }

  /** Test seam: puts a chosen row on offer, so verification can press a named card. */
  offerDraftForTest(cards: readonly DraftCardId[]): void {
    if (cards.length === 0) return;
    this.pendingDraftReward = 0;
    this.draft.present(this.boss.stage, cards);
    this.events.emit({ type: 'draftOffered', stage: this.boss.stage, cards: [...cards] });
  }

  /**
   * Test seam: takes one card's effect without waiting for the pool to offer
   * that card. The draw is tested separately in `draft.test.ts`; this is for
   * asserting what a card actually does to the run.
   */
  takeDraftCardForTest(card: DraftCardId): void { this.applyDraftCard(this.boss.stage, card, false); }
  /** Kills the current boss outright, so a test can walk the ladder honestly. */
  defeatBossForTest(): void {
    this.boss.damage(this.boss.hp, Math.max(1, this.effectiveDps), {
      damaged: (hit, hp, maxHp, dps) => this.handleBossDamage(hit, hp, maxHp, dps, 'tap'),
      defeated: (stage, reward) => this.handleBossDefeated(stage, reward),
    });
  }
  private emitBossSpawned(): void {
    const boss = this.boss.boss;
    const identity = bossIdentityFor(boss.stage);
    // Only a genuinely new face is worth a write; the same boss reappears
    // every time the ladder wraps around.
    if (!this.seenBosses.has(identity)) {
      this.seenBosses.add(identity);
      this.saveMeta();
    }
    this.events.emit({ type: 'bossSpawned', stage: boss.stage, name: boss.name, maxHp: boss.maxHealth });
    this.emitArchetype();
  }
  private discoverTier(tier: number): boolean {
    const oldMax = this.playerMaxHealth;
    const discovered = this.progression.discover(tier);
    // The lifetime collection tracks ownership, which is not the same as the
    // run's ladder position: ascending resets the ladder but must not un-meet
    // a ninja the player has already fielded.
    if (!this.discoveredTiers.has(tier) && tier >= 1 && tier <= BALANCE.tiers.count) {
      this.discoveredTiers.add(tier);
      this.saveMeta();
    }
    if (discovered) {
      const newMax = this.playerMaxHealth;
      this.restorePlayerHealth(Math.max(1, Math.ceil((newMax - oldMax) * .7)), 'rankUp');
    }
    return discovered;
  }
  private receiveBossAttack(rawDamage: number): void {
    // A protective ward eats the strike outright -- before the clamp, before
    // health moves, before any event but the block announcement. Only spent on
    // hits that could actually hurt (the empty-board strike deals zero anyway).
    if (this.highestTier > 0 && this.powerups.consumeWardCharge()) {
      this.events.emit({ type: 'powerupWardBlocked', damage: Math.max(1, Math.round(rawDamage)) });
      return;
    }
    // A boss has a visual idle strike before recruits exist, but can only hurt
    // the line once there is an actual ninja to protect.
    const ceiling = Math.max(1, Math.ceil(this.playerMaxHealth * BALANCE.player.maxHitShare));
    // The first-ever player gets a forgiving runway until the tutorial pickup
    // is caught. Keep the boss animation/event alive, but do not drain health.
    const damage = this.highestTier > 0 && (this.tutorialCompletedFlag || !this.tutorialShieldActive) ? Math.max(1, Math.min(ceiling, Math.round(rawDamage))) : 0;
    const before = this.playerHp;
    let defeated = false;
    if (damage > 0 && !this.over) {
      const afterHit = before - damage;
      defeated = afterHit <= 0;
      this.playerHp = defeated ? 0 : afterHit;
      this.events.emit({ type: 'playerHealthChanged', hp: this.playerHp, maxHp: this.playerMaxHealth, delta: -damage, reason: defeated ? 'defeat' : 'bossStrike' });
      if (defeated) this.endRun();
      else this.markDirty();
    }
    this.events.emit({ type: 'bossAttack', damage, playerHp: this.playerHp, playerMaxHp: this.playerMaxHealth, defeated });
    if (!defeated && !this.over) this.maybeThrowDebris();
  }

  /**
   * The line is gone.
   *
   * The simulation stops dead -- a frozen board is what the game over screen
   * is drawn over -- and the save slot goes with it, so closing the tab on a
   * lost run and coming back lands on a fresh dojo rather than a corpse that
   * dies again on the first boss swing.
   */
  private endRun(): void {
    if (this.over) return;
    this.over = true;
    this.powerups.clear();
    this.coinFrenzyRemaining = 0; this.coinFrenzyValue = 0;
    // The record board is written before the run slot is deleted, so a defeat
    // that set a personal best still leaves the player with something.
    const comparison = this.recordRunResult();
    this.wipeSave();
    this.events.emit({
      type: 'gameOver',
      stage: this.boss.stage,
      highestTier: this.progression.highestTierEverOwned,
      coinsEarned: this.metrics.coinsEarned,
      timePlayedMs: this.metrics.timePlayedMs,
      records: comparison.records,
      best: comparison.best,
    });
  }
  private restorePlayerHealth(amount: number, reason: 'victory' | 'rankUp' | 'draft'): void {
    const before = this.playerHp;
    this.playerHp = this.clampPlayerHp(before + Math.max(0, amount));
    const delta = this.playerHp - before;
    if (delta > 0) this.events.emit({ type: 'playerHealthChanged', hp: this.playerHp, maxHp: this.playerMaxHealth, delta, reason });
  }
  private clampPlayerHp(value: number): number { return Math.max(1, Math.min(this.playerMaxHealth, Math.round(value))); }
  private markDirty(): void { this.dirty = true; }
  private defaultStorage(): StorageLike | null { try { return globalThis.localStorage; } catch { return null; } }
}
