import type { Lane } from '../input/InputManager';

export type PerfectCuePhase = 'watch' | 'ready' | 'tap';

function control(lane: Lane, touch: boolean): string {
  if (touch) return `TAP ${lane.toUpperCase()}`;
  return lane === 'left' ? 'PRESS ←' : 'PRESS →';
}

/** Explicit, reaction-compensated instruction for the first Perfect lesson. */
export function perfectInstruction(lane: Lane, touch: boolean, phase: PerfectCuePhase): string {
  if (phase === 'tap') return `${control(lane, touch)} NOW FOR PERFECT`;
  if (phase === 'ready') return `GET READY — WAIT FOR “NOW”`;
  return `WATCH THE ${lane.toUpperCase()} ENEMY — WAIT FOR “NOW”`;
}

/** Flow is a direction chain: say the action, direction, and visual rule. */
export function flowInstruction(lane: Lane | null, touch: boolean): string {
  if (!lane) return 'FLOW MODE — WATCH FOR THE NEXT GLOWING ENEMY';
  return `FLOW MODE — ${control(lane, touch)} NOW: HIT THE GLOWING ENEMY`;
}
