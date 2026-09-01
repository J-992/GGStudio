import type { Lane } from '../input/InputManager';

export type PerfectCuePhase = 'watch' | 'ready' | 'tap';

function control(lane: Lane, touch: boolean): string {
  if (touch) return `TAP ${lane.toUpperCase()}`;
  return lane === 'left' ? 'PRESS ←' : 'PRESS →';
}

/** Explicit, reaction-compensated instruction for the first Perfect lesson. */
export function perfectInstruction(lane: Lane, touch: boolean, phase: PerfectCuePhase): string {
  if (phase === 'tap') return `${control(lane, touch)} NOW`;
  return control(lane, touch);
}

/** Flow is a direction chain: say the action, direction, and visual rule. */
export function flowInstruction(lane: Lane | null, touch: boolean): string {
  if (!lane) return 'TAP THE GLOWING SIDE';
  return control(lane, touch);
}
