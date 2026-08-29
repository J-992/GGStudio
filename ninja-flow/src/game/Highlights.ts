import { HIGHLIGHTS } from '../config';
import type { Side } from './PatternDirector';

/**
 * The run's memorable-moment log and the selection logic for the death reel.
 *
 * The reel is a RE-ENACTMENT, not a recording: during play we log semantic
 * events (what the player did and how well), and on death the best few are
 * restaged with the live combat actors under a cinematic camera. That is the
 * lightweight point on the replay-technology spectrum — full input-replay
 * (Overwatch's kill cam) needs a deterministic engine and buys nothing extra
 * for a three-second vignette, while raw state snapshots cost memory every
 * frame of the run. An event log costs a few bytes per hit and stays exact
 * about the one thing the cinematic must honor: the player's own actions.
 */

export type MomentKind = 'perfect' | 'good' | 'rare' | 'finisher';

export interface Moment {
  kind: MomentKind;
  side: Side;
  /** Combo count at the moment of the hit — drives the caption. */
  combo: number;
  /** Run time, so the reel can play chronologically. */
  at: number;
}

/** Spectacle value used to choose which moments make the reel. */
function weight(m: Moment): number {
  switch (m.kind) {
    case 'finisher':
      return 1000 + m.combo;
    case 'rare':
      return 500 + m.combo;
    case 'perfect':
      return 10 + m.combo;
    case 'good':
      return 1 + m.combo * 0.5;
  }
}

export class MomentLog {
  private moments: Moment[] = [];

  add(moment: Moment): void {
    this.moments.push(moment);
    // A long expert run logs hundreds of hits; keep the log bounded by
    // dropping the weakest when it grows, so memory stays flat.
    if (this.moments.length > 64) {
      this.moments.sort((a, b) => weight(b) - weight(a));
      this.moments.length = 48;
    }
  }

  reset(): void {
    this.moments = [];
  }

  get count(): number {
    return this.moments.length;
  }

  /**
   * The reel: the run's best moments, chosen for variety first.
   *
   * Straight weight ordering picks three Flow finishers off a good run and
   * stages the same scene three times. So the strongest moment of each KIND
   * goes in first, and only then is the reel filled out by weight — a reel that
   * shows a wave, a golden target and a finisher tells more of the run's story
   * than three copies of its best hit. The result is re-sorted chronologically
   * so the scene order still follows the run.
   */
  pick(max = HIGHLIGHTS.maxVignettes): Moment[] {
    if (this.moments.length < HIGHLIGHTS.minMoments) return [];
    const byWeight = [...this.moments].sort((a, b) => weight(b) - weight(a));

    const chosen: Moment[] = [];
    const kinds = new Set<MomentKind>();
    for (const m of byWeight) {
      if (chosen.length >= max) break;
      if (kinds.has(m.kind)) continue;
      kinds.add(m.kind);
      chosen.push(m);
    }
    for (const m of byWeight) {
      if (chosen.length >= max) break;
      if (!chosen.includes(m)) chosen.push(m);
    }
    return chosen.sort((a, b) => a.at - b.at);
  }
}

/** Caption for a vignette, e.g. "PERFECT ×24". */
export function captionFor(m: Moment): string {
  switch (m.kind) {
    case 'finisher':
      return 'FLOW FINISHER';
    case 'rare':
      return 'GOLDEN TARGET';
    case 'perfect':
      return m.combo >= 3 ? `PERFECT ×${m.combo}` : 'PERFECT';
    case 'good':
      return m.combo >= 3 ? `COMBO ×${m.combo}` : 'CLEAN HIT';
  }
}
