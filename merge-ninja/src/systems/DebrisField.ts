import { BALANCE } from '../data/balance';

export interface DebrisEntry {
  readonly slot: number;
  msLeft: number;
}

/**
 * Board slots a boss swing has taken away for a few seconds.
 *
 * This is the only thing in the game that lets the arena reach the board.
 * `player.maxHitShare` clamps incoming damage so hard that a swing became
 * invisible -- the line simply could not die -- so the swing now costs a slot
 * instead. Pressure is paid in space and time and never in progress: nothing
 * here can destroy a ninja, and every blocker clears itself even if the player
 * does nothing at all.
 *
 * Phaser-free and rng-injectable, like `PowerupSystem`, so a seeded run
 * reproduces exactly.
 */
export class DebrisField {
  private readonly entries: DebrisEntry[] = [];
  private graceMs = 0;
  private readonly rng: () => number;

  constructor(opts: { rng?: () => number } = {}) {
    this.rng = opts.rng ?? ((): number => Math.random());
  }

  get all(): readonly DebrisEntry[] { return this.entries; }
  get count(): number { return this.entries.length; }
  has(slot: number): boolean { return this.entries.some((entry) => entry.slot === slot); }

  /** Suppresses throwing for a while -- used by the tutorial and after an ascension. */
  startGrace(ms: number = BALANCE.debris.graceMs): void { this.graceMs = Math.max(this.graceMs, ms); }
  get inGrace(): boolean { return this.graceMs > 0; }

  /**
   * Share of swings that throw at this stage, ramped to a ceiling.
   *
   * Kept as a curve rather than a constant so the mechanic arrives quietly at
   * stage 12 and only becomes a real consideration by the time the funnel says
   * players are leaving.
   */
  chanceAt(stage: number): number {
    const { startStage, chanceBase, chancePerStage, chanceMax } = BALANCE.debris;
    if (stage < startStage) return 0;
    return Math.min(chanceMax, chanceBase + (stage - startStage) * chancePerStage);
  }

  /**
   * Decides whether this swing throws, and where.
   *
   * `freeSlots` is what the board can currently take. The throw is refused
   * whenever landing would leave fewer than `minFreeSlots` usable cells, so a
   * player can always buy and always merge -- debris delays, it never
   * deadlocks.
   */
  maybeThrow(stage: number, freeSlots: readonly number[]): number | null {
    const { maxConcurrent, minFreeSlots, holdMs } = BALANCE.debris;
    if (this.graceMs > 0) return null;
    if (stage < BALANCE.debris.startStage) return null;
    if (this.entries.length >= maxConcurrent) return null;
    if (freeSlots.length <= minFreeSlots) return null;
    if (this.rng() >= this.chanceAt(stage)) return null;

    const slot = freeSlots[Math.min(freeSlots.length - 1, Math.floor(this.rng() * freeSlots.length))];
    if (slot === undefined) return null;
    this.entries.push({ slot, msLeft: holdMs });
    return slot;
  }

  update(dtMs: number, onExpire: (slot: number) => void): void {
    const step = Math.max(0, dtMs);
    if (this.graceMs > 0) this.graceMs = Math.max(0, this.graceMs - step);
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i]!;
      entry.msLeft -= step;
      if (entry.msLeft > 0) continue;
      this.entries.splice(i, 1);
      onExpire(entry.slot);
    }
  }

  /**
   * Clears debris orthogonally adjacent to a merge.
   *
   * The merge has to reach it, rather than the debris expiring on the same
   * frame by chance -- that is the rule the shatter animation teaches, and it
   * is the reason clearing one yourself feels better than waiting.
   */
  clearNear(slots: readonly number[], onCleared: (slot: number) => void): number {
    let cleared = 0;
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i]!;
      if (!slots.includes(entry.slot)) continue;
      this.entries.splice(i, 1);
      cleared += 1;
      onCleared(entry.slot);
    }
    return cleared;
  }

  remove(slot: number): boolean {
    const index = this.entries.findIndex((entry) => entry.slot === slot);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  load(entries: ReadonlyArray<{ slot: number; msLeft: number }>): void {
    this.entries.length = 0;
    for (const entry of entries.slice(0, BALANCE.debris.maxConcurrent)) {
      this.entries.push({ slot: entry.slot, msLeft: entry.msLeft });
    }
  }

  serialize(): Array<{ slot: number; msLeft: number }> {
    return this.entries.map((entry) => ({ slot: entry.slot, msLeft: Math.round(entry.msLeft) }));
  }

  clear(): void {
    this.entries.length = 0;
    this.graceMs = 0;
  }
}
