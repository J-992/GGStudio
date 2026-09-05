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
  /** Set once a player has moved and jumped both robots. Retires the coach. */
  learned: boolean;
  /** Coins banked across every run. Never spent by dying. */
  coins: number;
  /** Skin ids bought so far. The starter skin is always owned. */
  owned: string[];
  /** Skin currently worn. */
  skin: string;
  /** Skin ids the player has already been told they can afford. */
  announced: string[];
  /** Trail ids bought so far. */
  trailsOwned: string[];
  /** Trail worn by each robot, indexed by player. */
  trails: [string, string];
}

const KEY = "tether-run.record.v1";
const EMPTY: Record_ = {
  best: 0, acts: 1, bestTime: 0, clears: 0, learned: false,
  coins: 0, owned: ["conduit"], skin: "conduit", announced: [],
  trailsOwned: ["none"], trails: ["none", "none"],
};

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
  get learned() { return this.data.learned; }
  get coins() { return this.data.coins; }
  get skin() { return this.data.skin; }

  owns(id: string) { return id === "conduit" || this.data.owned.includes(id); }

  ownsTrail(id: string) { return id === "none" || (this.data.trailsOwned ?? []).includes(id); }
  trailFor(player: number) { return (this.data.trails ?? ["none", "none"])[player] ?? "none"; }

  /** Buys a trail if needed, then fits it to one robot. */
  buyTrail(id: string, price: number, player: number): boolean {
    if (!this.ownsTrail(id)) {
      if (this.data.coins < price) return false;
      this.data.coins -= price;
      this.data.trailsOwned = [...new Set([...(this.data.trailsOwned ?? []), id])];
    }
    const t = [...(this.data.trails ?? ["none", "none"])] as [string, string];
    t[player] = id;
    this.data.trails = t;
    this.save();
    return true;
  }

  /** Coins survive death — that is the point of them. */
  addCoins(n: number) {
    if (n <= 0) return;
    this.data.coins += n;
    this.save();
  }

  /**
   * Skins the player can now afford but has not been told about. Each is only
   * ever announced once, so the toast cannot nag.
   */
  newlyAffordable(all: { id: string; price: number }[]): { id: string; price: number }[] {
    return all.filter(
      (s) => !this.owns(s.id) && s.price > 0 && this.data.coins >= s.price && !this.data.announced.includes(s.id),
    );
  }

  markAnnounced(ids: string[]) {
    if (!ids.length) return;
    this.data.announced = [...new Set([...this.data.announced, ...ids])];
    this.save();
  }

  /** Spends the coins and equips, or returns false if they cannot afford it. */
  buySkin(id: string, price: number): boolean {
    if (this.owns(id)) { this.equipSkin(id); return true; }
    if (this.data.coins < price) return false;
    this.data.coins -= price;
    this.data.owned = [...new Set([...this.data.owned, id])];
    this.data.skin = id;
    this.save();
    return true;
  }

  equipSkin(id: string) {
    if (!this.owns(id)) return;
    this.data.skin = id;
    this.save();
  }

  markLearned() {
    if (this.data.learned) return;
    this.data.learned = true;
    this.save();
  }

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
