import { ACHIEVEMENTS, achievementById } from '../data/achievements';
import type { AchievementDef, AchievementSnapshot } from '../data/achievements';

/**
 * Awards achievements and remembers which ones are already spent.
 *
 * Deliberately dumb: it holds a set of ids and re-tests the whole (tiny) list
 * whenever the game says something happened. There is no per-achievement
 * bookkeeping to drift out of sync with the run, and re-testing an unlocked
 * achievement is free because unlocked ids are skipped outright.
 *
 * Nothing here reads the clock or the DOM, so the entire award ladder is
 * unit-testable by handing it a snapshot.
 */
export class AchievementSystem {
  private readonly unlocked: Set<string>;

  constructor(unlocked: Iterable<string> = []) {
    // Ids from an older build that no longer exist are dropped rather than
    // kept as ghosts, so the "N of M" counter can never exceed its total.
    this.unlocked = new Set([...unlocked].filter((id) => achievementById(id) !== undefined));
  }

  /** Ids earned so far, in definition order, for saving. */
  get unlockedIds(): string[] {
    return ACHIEVEMENTS.filter((entry) => this.unlocked.has(entry.id)).map((entry) => entry.id);
  }

  get unlockedCount(): number {
    return this.unlocked.size;
  }

  has(id: string): boolean {
    return this.unlocked.has(id);
  }

  /** Debug-only full erasure, to make a wiped save behave like a new player. */
  clear(): void {
    this.unlocked.clear();
  }

  /**
   * Test every locked achievement against the snapshot and claim the ones that
   * now qualify. Returns them in definition order -- easiest first -- so a
   * burst of simultaneous unlocks presents as a sensible run of announcements
   * rather than an arbitrary shuffle.
   */
  claim(snapshot: AchievementSnapshot): AchievementDef[] {
    const earned: AchievementDef[] = [];
    for (const entry of ACHIEVEMENTS) {
      if (this.unlocked.has(entry.id)) continue;
      if (!entry.earned(snapshot)) continue;
      this.unlocked.add(entry.id);
      earned.push(entry);
    }
    return earned;
  }
}
