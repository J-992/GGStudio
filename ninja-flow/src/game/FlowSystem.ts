import { FLOW } from '../config';
import type { HitQuality } from './TimingEvaluator';

/**
 * The Flow meter — the game's signature mechanic.
 *
 * Consecutive perfects ramp the gain so that a player who is reading the fight
 * well reaches Flow noticeably sooner. Reaching max never asks for a button;
 * Flow Mode arms itself and the caller drives the sequence.
 */
export class FlowSystem {
  private _value = 0;
  private perfectStreak = 0;
  private _chains = 0;

  get value(): number {
    return this._value;
  }

  get ratio(): number {
    return this._value / FLOW.max;
  }

  get chains(): number {
    return this._chains;
  }

  get isFull(): boolean {
    return this._value >= FLOW.max;
  }

  /** Applies the meter change for a hit. Returns the amount gained. */
  onHit(quality: HitQuality, comboMultiplier: number): number {
    let gain: number;
    if (quality === 'perfect') {
      const ramped = FLOW.gainPerfect + this.perfectStreak * FLOW.perfectRampStep;
      gain = Math.min(FLOW.gainPerfectMax, ramped);
      this.perfectStreak += 1;
    } else if (quality === 'good') {
      gain = FLOW.gainGood;
      this.perfectStreak = 0;
    } else {
      this.perfectStreak = 0;
      this.add(-FLOW.loseMiss);
      return -FLOW.loseMiss;
    }
    // Combo feeds Flow slightly, so a long clean streak compounds into Flow.
    const bonus = Math.min(FLOW.comboBonusMax, (comboMultiplier - 1) * 2);
    this.add(gain + bonus);
    return gain + bonus;
  }

  onDamage(): void {
    this.perfectStreak = 0;
    this.add(-FLOW.loseDamage);
  }

  /** Called when a Flow sequence ends; drains the meter and banks the chain. */
  consume(completed: boolean): void {
    this._value = 0;
    this.perfectStreak = 0;
    if (completed) this._chains += 1;
  }

  /** @param startAt initial meter value; see FLOW.firstRunHead. */
  reset(startAt = 0): void {
    this._value = Math.max(0, Math.min(FLOW.max, startAt));
    this.perfectStreak = 0;
    this._chains = 0;
  }

  /** Flow granted by something that is not a kill, e.g. breaking a guard. */
  boost(amount: number): void {
    this.add(amount);
  }

  private add(amount: number): void {
    this._value = Math.max(0, Math.min(FLOW.max, this._value + amount));
  }
}

/** Reaction budget for the nth target in a Flow chain (0-indexed). */
export function flowReactionWindow(index: number): number {
  const w = FLOW.reactionWindows;
  return w[Math.min(index, w.length - 1)];
}
