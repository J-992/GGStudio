import { COMBO } from '../config';

/**
 * Combo count and its score multiplier.
 *
 * Kept separate from scoring so the multiplier curve can be retuned from config
 * without touching the scoring call sites.
 */
export class ComboSystem {
  private _count = 0;
  private _best = 0;
  /** Milestones already celebrated this run, so each fires exactly once. */
  private celebrated = new Set<number>();

  get count(): number {
    return this._count;
  }

  get best(): number {
    return this._best;
  }

  get multiplier(): number {
    for (const [min, mult] of COMBO.tiers) {
      if (this._count >= min) return mult;
    }
    return 1;
  }

  /** Returns the milestone crossed by this hit, or 0. */
  hit(): number {
    this._count += 1;
    if (this._count > this._best) this._best = this._count;
    for (const m of COMBO.milestones) {
      if (this._count === m && !this.celebrated.has(m)) {
        this.celebrated.add(m);
        return m;
      }
    }
    return 0;
  }

  break(): void {
    this._count = 0;
  }

  reset(): void {
    this._count = 0;
    this._best = 0;
    this.celebrated.clear();
  }
}
