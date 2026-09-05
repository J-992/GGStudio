import { LEVELS } from "../levels";

export const ACT_SIZE = 4;
export const ACT_NAMES = ["FOOTING", "THE TURN", "THROWN", "MOVING GROUND", "TERMINUS"];

export const actOf = (levelIdx: number) => Math.floor(levelIdx / ACT_SIZE);
export const actStart = (act: number) => act * ACT_SIZE;
export const actCount = () => Math.ceil(LEVELS.length / ACT_SIZE);

interface Record_ {
  /** Furthest level reached in a full run, 1-based. */
  best: number;
  /** Acts opened for practice, count. Always at least 1. */
  acts: number;
  /** Fastest complete campaign, seconds. 0 when never cleared. */
  bestTime: number;
  /** Number of complete campaigns. */
  clears: number;
}

const KEY = "tether-run.record.v1";
const EMPTY: Record_ = { best: 0, acts: 1, bestTime: 0, clears: 0 };

/**
 * Remembers how far a pair has ever got. Every read and write is guarded: the
 * game has to stay fully playable with storage unavailable (private browsing,
 * blocked site data, a portal frame that denies it), it just forgets between
 * sessions.
 */
class Progress {
  private data: Record_ = { ...EMPTY };
  private available = true;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...EMPTY, ...JSON.parse(raw) };
    } catch {
      this.available = false;
    }
  }

  private save() {
    if (!this.available) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      this.available = false;
    }
  }

  get best() { return this.data.best; }
  get acts() { return Math.max(1, Math.min(actCount(), this.data.acts)); }
  get bestTime() { return this.data.bestTime; }
  get clears() { return this.data.clears; }

  /** Records reaching a level. Returns true if it beat the old record. */
  reached(level: number): boolean {
    const act = actOf(level - 1) + 1;
    if (act > this.data.acts) {
      this.data.acts = act;
      this.save();
    }
    if (level <= this.data.best) return false;
    this.data.best = level;
    this.save();
    return true;
  }

  /** Records a finished campaign. Returns true if it was the fastest yet. */
  cleared(seconds: number): boolean {
    this.data.clears++;
    this.data.acts = actCount();
    const isBest = this.data.bestTime === 0 || seconds < this.data.bestTime;
    if (isBest) this.data.bestTime = seconds;
    this.save();
    return isBest;
  }
}

export const progress = new Progress();

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
