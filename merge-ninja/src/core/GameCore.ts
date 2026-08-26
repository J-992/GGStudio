import { ACHIEVEMENT_COUNT } from '../data/achievements';
import type { AchievementSnapshot } from '../data/achievements';
import { BALANCE, sellValueOf } from '../data/balance';
import type { OfflineConfig } from '../data/balance';
import { bossIdentityFor } from '../data/enemies';
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
  /** Deadline for the guaranteed first-run pickup, armed by the first merge. */
  private tutorialPowerupAtMs: number | null = null;
  /** The guided pickup was caught; the final first-run lesson is a boss tap. */
  /** The guided pickup has finished its interaction, including every rain coin. */
  private tutorialPowerupFinished = false;
  private tutorialShieldActive = false;
  /** One opt-in ad revive per run: valuable, but never an infinite stall. */
  private rewardedReviveUsed = false;

  constructor(opts: { storage?: StorageLike | null; now?: () => number } = {}) {
    const storage = opts.storage === undefined ? this.defaultStorage() : opts.storage;
    this.saves = new SaveSystem(storage);
    this.now = opts.now ?? ((): number => Date.now());
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
    this.economy = new EconomySystem(saved?.coins);
    this.progression = new ProgressionSystem(saved?.highestTierEverOwned);
    this.metrics = saved?.metrics ?? freshMetrics();
    // The safe runway begins with the first real purchase, not only after its merge.
    // A reload after that merge also needs the promised pickup re-armed -- the
    // offer itself is ephemeral, while the completed-tutorial flag is not.
    this.tutorialShieldActive = !this.tutorialCompletedFlag && this.metrics.purchases > 0;
    if (this.tutorialShieldActive && this.metrics.merges > 0) {
      this.tutorialPowerupAtMs = this.metrics.timePlayedMs + 1_000;
    }
    // Discoveries are unioned across both slots so a player mid-upgrade keeps
    // everything: the meta slot is the new home, the run slot is where an
    // older build left them.
    this.revealedTiers = new Set([...(meta?.revealedTiers ?? []), ...(saved?.revealedTiers ?? [])]);
    this.seenBosses = new Set([...(meta?.seenBosses ?? []), ...(saved?.seenBosses ?? [])]);
    this.discoveredTiers = this.restoreDiscoveredTiers(meta?.discoveredTiers, saved?.highestTierEverOwned);
    this.totalPurchases = saved?.totalPurchases ?? 0;
    this.damageCoinRemainder = saved?.damageCoinRemainder ?? 0;
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
    this.powerups.update(this.speedMultiplier > 0 ? real : 0);
    let spawnedPowerup: PowerupId | null = null;
    if (!this.tutorialCompletedFlag && this.tutorialPowerupAtMs !== null && this.metrics.timePlayedMs >= this.tutorialPowerupAtMs) {
      // Make the guided pickup a Coin Frenzy. It is the only powerup that
      // asks for a follow-up tap, so teaching it here ensures every new
      // player sees and learns the coin-rain interaction right away.
      spawnedPowerup = this.powerups.forceSpawn('coinFrenzy');
      // A modal can temporarily close the presentation gate. Keep the promise
      // armed until a real token enters the lane rather than losing it unseen.
      if (spawnedPowerup !== null) this.tutorialPowerupAtMs = null;
    }
    if (spawnedPowerup === null) spawnedPowerup = this.powerups.maybeSpawn(this.metrics.timePlayedMs);
    if (spawnedPowerup !== null) {
      this.events.emit({ type: 'powerupSpawned', id: spawnedPowerup, travelMs: POWERUPS[spawnedPowerup].travelMs });
    }
    this.hintTimer += dt;
    this.boss.update(dt, this.totalDps * this.powerups.dpsMultiplier, tempo, {
      damaged: (damage, hp, maxHp, dps) => this.handleBossDamage(damage, hp, maxHp, dps, 'ninja'),
      defeated: (stage, reward) => this.handleBossDefeated(stage, reward),
      spawned: () => { this.emitBossSpawned(); this.markDirty(); },
      attack: (damage) => this.receiveBossAttack(damage),
      canAttack: () => !this.powerups.bossAttacksPaused,
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

  get buyCost(): number { return this.economy.cost(this.totalPurchases, this.buyTier); }
  get tempo() { return tempoFor(this.metrics.timePlayedMs); }
  get buyTier(): number { return this.progression.buyTier(this.tempo.buyTierOffset); }
  get canBuy(): boolean { return this.economy.canAfford(this.buyCost) && this.board.firstEmpty() !== null; }
  get highestTier(): number { return this.board.highestTier(); }
  /** Compatibility seam for the current arena; foreground logic should use highestTier. */
  get championTier(): number { return this.highestTier; }
  get totalDps(): number { return this.board.slots.reduce((sum, ninja) => sum + (ninja ? ninjaDef(ninja.tier).dps : 0), 0); }
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
    const effectiveDps = this.totalDps * this.powerups.dpsMultiplier;
    const damage = Math.max(1, Math.round(this.boss.boss.maxHealth * BALANCE.boss.playerTapHealthShare));
    const dealt = this.boss.damage(damage, effectiveDps, {
      damaged: (hit, hp, maxHp, dps) => this.handleBossDamage(hit, hp, maxHp, dps, 'tap'),
      defeated: (stage, reward) => this.handleBossDefeated(stage, reward),
    });
    if (dealt > 0) {
      this.notePlayerAction();
      if (this.tutorialShieldActive && this.tutorialPowerupFinished && this.metrics.merges > 0) this.completeTutorial();
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
    if (!this.tutorialCompletedFlag && this.tutorialPowerupAtMs === null) {
      this.tutorialShieldActive = true;
      this.tutorialPowerupAtMs = this.metrics.timePlayedMs + 5_000;
    }
    const discovered = this.discoverTier(merged.result.tier);
    this.events.emit({ type: 'ninjaMerged', fromSlot, toSlot: target.slot, consumedIds: merged.consumedIds, result: merged.result });
    if (discovered) this.events.emit({ type: 'newTierDiscovered', tier: merged.result.tier, name: ninjaDef(merged.result.tier).name });
    this.syncChampion();
    this.strikeBossFromMerge();
    this.markDirty(); return 'merged';
  }

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
    this.coinFrenzyRemaining = 0; this.coinFrenzyValue = 0;
    this.tutorialPowerupAtMs = null;
    this.tutorialPowerupFinished = false;
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
    this.saves.save({ version: BALANCE.save.version, coins: this.economy.coins, board: this.board.slots.map((ninja) => ninja === null ? null : { id: ninja.id, tier: ninja.tier }), stage: this.boss.stage, bossHp: this.boss.hp, damageCoinRemainder: this.damageCoinRemainder, totalPurchases: this.totalPurchases, highestTierEverOwned: this.progression.highestTierEverOwned, playerHp: this.playerHp, revealedTiers: [...this.revealedTiers], seenBosses: [...this.seenBosses], lastSavedAt: Math.floor(this.now()), metrics: this.metrics });
    this.dirty = false; this.saveTimer = 0;
  }
  notePlayerAction(): void { this.hintTimer = 0; }
  /** Applies a collected powerup and announces it; false when refused. */
  collectPowerup(id: PowerupId): boolean {
    const applied = this.powerups.activate(id);
    if (applied) {
      const def = POWERUPS[id];
      if (def.effect === 'coinRain') {
        const guided = this.tutorialShieldActive && this.metrics.merges > 0 && !this.tutorialCompletedFlag;
        this.coinFrenzyRemaining = guided ? def.tutorialCoinCount : def.coinCount;
        this.coinFrenzyValue = coinFrenzyCoinValue(this.boss.stage);
      }
      this.events.emit({ type: 'powerupCollected', id });
      // A one-tap effect is finished immediately. Coin Frenzy remains the
      // player's active lesson until its last coin is caught or missed.
      if (this.tutorialShieldActive && this.metrics.merges > 0) {
        this.tutorialPowerupFinished = def.effect !== 'coinRain';
      }
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
    if (this.tutorialShieldActive && this.metrics.merges > 0) this.tutorialPowerupFinished = true;
    this.events.emit({ type: 'coinFrenzyFinished' });
  }
  private syncChampion(): void { const current = this.highestTier; if (current !== this.activeChampion) { const prevTier = this.activeChampion; this.activeChampion = current; this.events.emit({ type: 'championChanged', tier: current, prevTier }); } }
  private strikeBossFromMerge(): number {
    const effectiveDps = this.totalDps * this.powerups.dpsMultiplier;
    const damage = Math.max(1, Math.round(this.boss.boss.maxHealth * BALANCE.progression.mergeStrikeHealthShare));
    return this.boss.damage(damage, effectiveDps, {
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
    const pacedReward = Math.max(1, Math.round(reward * this.tempo.rewardMultiplier * this.incomeMultiplier * this.powerups.coinMultiplier));
    this.changeCoins(pacedReward);
    this.restorePlayerHealth(Math.ceil(this.playerMaxHealth * BALANCE.player.bossVictoryHealRatio), 'victory');
    this.events.emit({ type: 'bossDefeated', stage, reward: pacedReward });
    this.markDirty();
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
    });
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

  /** The scene calls this after the player catches their first powerup. */
  get tutorialCompleted(): boolean {
    return this.tutorialCompletedFlag;
  }

  completeTutorial(): void {
    if (this.tutorialCompletedFlag) return;
    this.tutorialCompletedFlag = true;
    this.tutorialShieldActive = false;
    this.tutorialPowerupAtMs = null;
    this.saveMeta();
    this.events.emit({ type: 'tutorialCompleted' });
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
  private restorePlayerHealth(amount: number, reason: 'victory' | 'rankUp'): void {
    const before = this.playerHp;
    this.playerHp = this.clampPlayerHp(before + Math.max(0, amount));
    const delta = this.playerHp - before;
    if (delta > 0) this.events.emit({ type: 'playerHealthChanged', hp: this.playerHp, maxHp: this.playerMaxHealth, delta, reason });
  }
  private clampPlayerHp(value: number): number { return Math.max(1, Math.min(this.playerMaxHealth, Math.round(value))); }
  private markDirty(): void { this.dirty = true; }
  private defaultStorage(): StorageLike | null { try { return globalThis.localStorage; } catch { return null; } }
}
