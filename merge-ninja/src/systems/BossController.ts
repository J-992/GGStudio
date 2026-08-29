import { BARE_ARCHETYPE, archetypeForStage, type ArchetypeSpec } from '../data/bossArchetypes';
import { BALANCE } from '../data/balance';
import { bossForStage } from '../data/enemies';
import type { TempoPhase } from '../data/pacing';
import type { BossDef } from '../data/types';

/** Phaser-free stage boss state, advanced in deterministic fixed-size ticks. */
export class BossController {
  boss: BossDef;
  hp: number;
  private tickAccumulator = 0;
  private defeatTimer = 0;
  private attackTimer = 0;
  private spec: ArchetypeSpec;
  /** Charges still holding ninja DPS off. Only ever non-zero for a shielded boss. */
  private shield = 0;
  /** Counts up since the last merge; past the window an enraged boss heals. */
  private sinceMergeMs = 0;
  /** Counts down on a greedy boss; at zero the tripled reward is gone. */
  private bountyMs = 0;
  /** Edge-detects the enrage transition so the arena is told once, not per tick. */
  private wasEnraged = false;
  /** Time banked toward the barrier shedding its next charge unaided. */
  private shieldDecayMs = 0;

  constructor(stage = 1, hp?: number) {
    this.boss = bossForStage(stage);
    this.hp = Math.min(this.boss.maxHealth, Math.max(0, hp ?? this.boss.maxHealth));
    this.spec = archetypeForStage(this.stage);
    this.armArchetype();
  }

  get stage(): number { return this.boss.stage; }
  get defeated(): boolean { return this.defeatTimer > 0; }
  get archetype(): ArchetypeSpec { return this.spec; }
  get shieldCharges(): number { return this.shield; }
  get shielded(): boolean { return this.shield > 0; }
  get bountyMsLeft(): number { return this.bountyMs; }
  /** True while an enraged boss is actually healing, which is what the arena paints. */
  get enraged(): boolean {
    return this.spec.regenPerSec > 0 && this.sinceMergeMs >= this.spec.mergeWindowMs;
  }

  /**
   * Takes this boss's modifier away for the rest of its life.
   *
   * The whole spec is swapped for the bare one rather than edited field by
   * field, so the barrier, the healing and the greed window all go quiet
   * together and nothing is left half-armed. The next boss is unaffected:
   * `spawnNext` re-derives its archetype from the stage it arrives on.
   */
  disarm(): boolean {
    if (this.spec.id === 'bare') return false;
    this.spec = BARE_ARCHETYPE;
    this.shield = 0;
    this.shieldDecayMs = 0;
    this.bountyMs = 0;
    this.wasEnraged = false;
    this.sinceMergeMs = 0;
    return true;
  }

  /**
   * A merge landed, so an enraged boss stops healing.
   *
   * This is the whole coupling between the board and the arena: the sim has no
   * other way to know the player did something, and the archetype exists to
   * make that reach across.
   */
  noteMerge(): void { this.sinceMergeMs = 0; }

  /**
   * Spends one shield charge. Returns whether the barrier was still up, so the
   * caller knows the tap was absorbed rather than dealt.
   */
  breakShield(): boolean {
    if (this.shield <= 0) return false;
    this.shield -= 1;
    this.shieldDecayMs = 0;
    return true;
  }

  private armArchetype(): void {
    this.spec = archetypeForStage(this.stage);
    this.shield = this.spec.shieldCharges;
    this.sinceMergeMs = 0;
    this.bountyMs = this.spec.bountyWindowMs;
    this.wasEnraged = false;
    this.shieldDecayMs = 0;
  }

  forceNext(): void {
    this.boss = bossForStage(this.stage + 1);
    this.hp = this.boss.maxHealth;
    this.tickAccumulator = 0;
    this.defeatTimer = 0;
    this.armArchetype();
  }

  reset(): void {
    this.boss = bossForStage(1);
    this.hp = this.boss.maxHealth;
    this.tickAccumulator = 0;
    this.defeatTimer = 0;
    this.attackTimer = 0;
    this.armArchetype();
  }

  /**
   * Applies an immediate player-caused hit using the same defeat path as the
   * fixed DPS tick. This keeps a click from bypassing rewards or spawning a
   * second boss before the defeat presentation has had time to play.
   */
  damage(
    damage: number,
    dps: number,
    callbacks: Pick<Parameters<BossController['update']>[3], 'damaged' | 'defeated'>,
  ): number {
    if (this.defeatTimer > 0 || this.hp <= 0) return 0;
    const dealt = Math.min(this.hp, Math.max(0, damage));
    if (dealt <= 0) return 0;
    this.hp = Math.max(0, this.hp - dealt);
    callbacks.damaged(dealt, this.hp, this.boss.maxHealth, dps);
    if (this.hp <= 0) {
      callbacks.defeated(this.stage, this.boss.reward);
      this.defeatTimer = BALANCE.boss.defeatDelayMs;
    }
    return dealt;
  }

  update(
    dtMs: number,
    dps: number,
    tempo: TempoPhase,
    callbacks: {
      damaged: (damage: number, hp: number, maxHp: number, dps: number) => void;
      defeated: (stage: number, reward: number) => void;
      spawned: (boss: BossDef) => void;
      attack: (damage: number) => void;
      /** False while a smoke bomb has the boss stalled; damage ticks continue. */
      canAttack?: () => boolean;
      /** An enraged boss started, or stopped, healing itself. */
      enrageChanged?: (enraged: boolean, regenPerSec: number) => void;
      /** A greedy boss's window closed with the boss still standing. */
      bountyExpired?: () => void;
      /** The barrier shed a charge on its own, without a tap. */
      shieldDecayed?: (charges: number, max: number) => void;
    },
  ): void {
    let remaining = Math.max(0, dtMs);
    while (remaining > 0) {
      if (this.defeatTimer > 0) {
        const step = Math.min(remaining, this.defeatTimer);
        this.defeatTimer -= step;
        remaining -= step;
        if (this.defeatTimer <= 0) this.spawnNext(callbacks.spawned);
        continue;
      }
      const step = Math.min(remaining, BALANCE.boss.fixedTickMs - this.tickAccumulator);
      this.tickAccumulator += step;
      this.attackTimer += step;
      this.sinceMergeMs += step;
      remaining -= step;
      if (this.bountyMs > 0) {
        this.bountyMs = Math.max(0, this.bountyMs - step);
        if (this.bountyMs === 0) callbacks.bountyExpired?.();
      }
      if (this.shield > 0) {
        this.shieldDecayMs += step;
        const perCharge = BALANCE.archetypes.shield.decayMs / Math.max(1, this.spec.shieldCharges);
        while (this.shield > 0 && this.shieldDecayMs >= perCharge) {
          this.shieldDecayMs -= perCharge;
          this.shield -= 1;
          callbacks.shieldDecayed?.(this.shield, this.spec.shieldCharges);
        }
      }
      const enragedNow = this.enraged;
      if (enragedNow !== this.wasEnraged) {
        this.wasEnraged = enragedNow;
        callbacks.enrageChanged?.(enragedNow, this.spec.regenPerSec);
      }
      if (enragedNow && this.hp > 0) {
        // Heals against maximum health rather than current, so the pressure is
        // a constant the player can read instead of a curve that eases off
        // exactly when they are furthest behind.
        this.hp = Math.min(this.boss.maxHealth, this.hp + this.boss.maxHealth * this.spec.regenPerSec * step / 1000);
      }
      const attackInterval = Math.max(300, BALANCE.boss.attackIntervalMs * tempo.attackIntervalMultiplier);
      while (this.attackTimer >= attackInterval) {
        if (callbacks.canAttack !== undefined && !callbacks.canAttack()) {
          // Hold the meter at the firing line so the swing lands the instant
          // the smoke clears, instead of bursting out all queued strikes.
          this.attackTimer = attackInterval;
          break;
        }
        this.attackTimer -= attackInterval;
        callbacks.attack(Math.max(1, Math.round(this.boss.attackDamage * tempo.attackDamageMultiplier)));
      }
      if (this.tickAccumulator < BALANCE.boss.fixedTickMs) continue;
      this.tickAccumulator = 0;
      // A barrier holds the whole roster off. Only a tap can spend a charge,
      // which is the entire lesson: the absent flinch says "do something else".
      if (dps <= 0 || this.shield > 0) continue;
      this.damage((dps * BALANCE.boss.fixedTickMs) / 1000, dps, callbacks);
    }
  }

  private spawnNext(onSpawned: (boss: BossDef) => void): void {
    this.boss = bossForStage(this.stage + 1);
    this.hp = this.boss.maxHealth;
    this.tickAccumulator = 0;
    this.armArchetype();
    onSpawned(this.boss);
  }
}
