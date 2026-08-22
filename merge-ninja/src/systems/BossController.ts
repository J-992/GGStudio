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

  constructor(stage = 1, hp?: number) {
    this.boss = bossForStage(stage);
    this.hp = Math.min(this.boss.maxHealth, Math.max(0, hp ?? this.boss.maxHealth));
  }

  get stage(): number { return this.boss.stage; }
  get defeated(): boolean { return this.defeatTimer > 0; }

  forceNext(): void {
    this.boss = bossForStage(this.stage + 1);
    this.hp = this.boss.maxHealth;
    this.tickAccumulator = 0;
    this.defeatTimer = 0;
  }

  reset(): void {
    this.boss = bossForStage(1);
    this.hp = this.boss.maxHealth;
    this.tickAccumulator = 0;
    this.defeatTimer = 0;
    this.attackTimer = 0;
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
      remaining -= step;
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
      if (dps <= 0) continue;
      const damage = Math.min(this.hp, (dps * BALANCE.boss.fixedTickMs) / 1000);
      this.hp = Math.max(0, this.hp - damage);
      callbacks.damaged(damage, this.hp, this.boss.maxHealth, dps);
      if (this.hp <= 0) {
        callbacks.defeated(this.stage, this.boss.reward);
        this.defeatTimer = BALANCE.boss.defeatDelayMs;
      }
    }
  }

  private spawnNext(onSpawned: (boss: BossDef) => void): void {
    this.boss = bossForStage(this.stage + 1);
    this.hp = this.boss.maxHealth;
    this.tickAccumulator = 0;
    onSpawned(this.boss);
  }
}
