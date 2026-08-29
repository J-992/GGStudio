import { SaveSystem } from '../systems/SaveSystem';
import { FIRST_SESSION, type ResumePoint } from './loadPlan';

/**
 * Where this player is about to resume, read before anything is loaded.
 *
 * `BootScene` has to choose a load plan before `GameCore` exists, and the whole
 * point of the plan is that it matches where the player actually is. A returning
 * save can restore straight into act four; booting act one's art for them would
 * hand them a missing-texture arena and stream the room they are standing in.
 *
 * This peeks at the save slot directly rather than waiting for the core to be
 * built. It is deliberately forgiving -- a corrupt, absent, or unreadable save
 * simply means a first session, which is the safe assumption because the opening
 * room is always in the boot set anyway.
 */
export function readResumePoint(): ResumePoint {
  try {
    const storage = typeof localStorage === 'undefined' ? null : localStorage;
    const state = new SaveSystem(storage).load();
    if (state === null) return FIRST_SESSION;
    return {
      stage: state.stage,
      // The board can be mid-merge, so the highest tier ever owned is the
      // honest ceiling for what art this save can put on screen.
      highestTier: Math.max(state.highestTierEverOwned, 1),
      // Exactly what is sitting on the board, which is what the first frame
      // has to draw. Anything else about the roster can arrive afterwards.
      boardTiers: state.board.flatMap((slot) => (slot === null ? [] : [slot.tier])),
    };
  } catch {
    return FIRST_SESSION;
  }
}
