import { UNLOCKS, type CharacterId } from '../config';
import { loadSave, saveSave } from '../core/Storage';

export interface RunStats {
  kills: number;
  perfects: number;
  flows: number;
  score: number;
}

/**
 * Total Mastery — the single number behind the "NEXT NINJA" bar.
 *
 * Kills, perfects, Flow chains and score all feed one accumulator. The player
 * is never shown the formula, only the bar, which is why the weights can be
 * retuned freely.
 */
export function masteryFor(stats: RunStats): number {
  const m = UNLOCKS.mastery;
  return Math.round(
    stats.kills * m.perKill +
      stats.perfects * m.perPerfect +
      stats.flows * m.perFlow +
      stats.score * m.perScore,
  );
}

export interface UnlockState {
  unlocked: CharacterId[];
  /** The next locked ninja, or null when everything is unlocked. */
  next: CharacterId | null;
  /** 0..1 progress toward `next`. */
  progress: number;
  mastery: number;
}

export function unlockState(mastery: number): UnlockState {
  const unlocked: CharacterId[] = [];
  for (let i = 0; i < UNLOCKS.order.length; i++) {
    if (mastery >= UNLOCKS.thresholds[i]) unlocked.push(UNLOCKS.order[i]);
  }
  const nextIndex = unlocked.length;
  if (nextIndex >= UNLOCKS.order.length) {
    return { unlocked, next: null, progress: 1, mastery };
  }
  const from = UNLOCKS.thresholds[nextIndex - 1] ?? 0;
  const to = UNLOCKS.thresholds[nextIndex];
  const progress = Math.max(0, Math.min(1, (mastery - from) / (to - from)));
  return { unlocked, next: UNLOCKS.order[nextIndex], progress, mastery };
}

/** Commits a finished run and reports which ninjas were newly unlocked. */
export function commitRun(stats: RunStats): { state: UnlockState; newlyUnlocked: CharacterId[] } {
  const save = loadSave();
  const before = unlockState(save.mastery);
  const mastery = save.mastery + masteryFor(stats);
  const after = unlockState(mastery);
  const newlyUnlocked = after.unlocked.filter((id) => !before.unlocked.includes(id));

  saveSave({
    mastery,
    unlocked: after.unlocked,
    best: Math.max(save.best, stats.score),
    runs: save.runs + 1,
    lastPlayed: Date.now(),
  });

  return { state: after, newlyUnlocked };
}
