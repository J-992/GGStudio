import { PHYSICS } from '../physics/PhysicsConfig';
import type { PowerUpType } from '../levels/procedural/ChunkTypes';
import { CATNIP_SPEED_MULTIPLIER, POWERUP_TUNING } from '../levels/procedural/PowerUpConfig';

/**
 * Timers and state for the four power-ups. Deliberately knows nothing about
 * `Game`, `ChunkBuilder` or `PlayerController` - it owns the *effect* for
 * types whose effect is entirely self-contained (Catnip Rush's
 * `PHYSICS.runSpeed` mutation - the same established pattern `startLevel()`
 * already uses for `PHYSICS.killPlaneY` per level), and exposes plain state
 * (`isActive`/`remainingFrac`/`consumeShield`) for the types whose effect
 * touches state this class doesn't own (lives, the fish pool's magnet flag)
 * - `Game.ts` reads that state once a frame and applies it against the
 * systems that actually hold it. This keeps the direction of dependency
 * one-way: `Game` knows about `PowerUpManager`, never the reverse.
 */

const TIMED_TYPES: readonly PowerUpType[] = ['fishMagnet', 'catnipRush', 'shield'];

const SPEED_MULTIPLIER: Partial<Record<PowerUpType, number>> = {
  catnipRush: CATNIP_SPEED_MULTIPLIER,
};

export class PowerUpManager {
  private readonly timers: Record<PowerUpType, number> = {
    fishMagnet: 0,
    catnipRush: 0,
    nineLives: 0,
    shield: 0,
  };
  /** CATNIP_SPEED_MULTIPLIER when currently applied to PHYSICS.runSpeed,
   *  or null if it isn't. */
  private appliedSpeedMultiplier: number | null = null;

  /** Starts (or refreshes) a power-up's effect. A fresh Shield pickup while
   *  one is already active refreshes its timer rather than stacking a
   *  second absorbable hit - same behaviour every other timed type already
   *  has. */
  activate(type: PowerUpType): void {
    if (type === 'nineLives') {
      // Instant, not timed - Game.ts grants the life itself. Nothing to
      // track here beyond the pickup already having happened.
      return;
    }

    this.timers[type] = POWERUP_TUNING[type].duration;

    const multiplier = SPEED_MULTIPLIER[type];
    if (multiplier !== undefined) this.applySpeedMultiplier(multiplier);
  }

  /** Applies a speed multiplier to `PHYSICS.runSpeed`, guarding against a
   *  refreshed pickup re-applying (and compounding) an already-active one. */
  private applySpeedMultiplier(multiplier: number): void {
    if (this.appliedSpeedMultiplier !== null) {
      if (multiplier <= this.appliedSpeedMultiplier) return;
      PHYSICS.runSpeed /= this.appliedSpeedMultiplier;
    }
    PHYSICS.runSpeed *= multiplier;
    this.appliedSpeedMultiplier = multiplier;
  }

  private revertSpeedMultiplier(): void {
    if (this.appliedSpeedMultiplier === null) return;
    PHYSICS.runSpeed /= this.appliedSpeedMultiplier;
    this.appliedSpeedMultiplier = null;
  }

  /** Ticks every timed effect; reverts a PHYSICS mutation on whichever
   *  type's timer expires while its multiplier is the one actually applied. */
  update(dt: number): void {
    for (const type of TIMED_TYPES) {
      if (this.timers[type] <= 0) continue;
      this.timers[type] = Math.max(0, this.timers[type] - dt);
      if (this.timers[type] > 0) continue;

      const multiplier = SPEED_MULTIPLIER[type];
      if (multiplier !== undefined && this.appliedSpeedMultiplier === multiplier) {
        this.revertSpeedMultiplier();
      }
    }
  }

  isActive(type: PowerUpType): boolean {
    return this.timers[type] > 0;
  }

  /** 0..1, how much of a timed effect's duration is left. 0 for Nine Lives
   *  (instant, never timed). */
  remainingFrac(type: PowerUpType): number {
    const duration = POWERUP_TUNING[type].duration;
    return duration > 0 ? this.timers[type] / duration : 0;
  }

  /** Every currently-active type, for the HUD's icon row. */
  activeTypes(): PowerUpType[] {
    const active: PowerUpType[] = [];
    for (const type of TIMED_TYPES) if (this.timers[type] > 0) active.push(type);
    return active;
  }

  /** Spends the active Shield, if there is one, absorbing a hit. Ends the
   *  effect immediately even if time was left on its ~30s window - the
   *  glowing sphere popping the instant it blocks a hit reads clearly as
   *  "protection used up," rather than silently continuing to protect
   *  against a second hit with no visible change. Returns whether a Shield
   *  was actually consumed. */
  consumeShield(): boolean {
    if (this.timers.shield <= 0) return false;
    this.timers.shield = 0;
    return true;
  }

  /** Resets all state - a fresh run should never inherit a stale speed
   *  mutation or a leftover timer from the last one. */
  reset(): void {
    this.revertSpeedMultiplier();
    for (const type of TIMED_TYPES) this.timers[type] = 0;
  }
}
