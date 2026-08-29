import {
  CLEAVE,
  RISING,
  ROUNDHOUSE,
  SLASH,
  SPIN,
  THRUST,
  type Keyframe,
} from './Poses';
import { cubicMotion } from './MotionSpline';

/**
 * The hero's move library.
 *
 * A move is three layers that all run off one normalised phase:
 *   1. `track`  — additive bone poses (the body's shape).
 *   2. `root`   — root motion: forward travel, height, and root rotation, so a
 *                 move can slide under a body, vault over one, or backflip out.
 *   3. `events` — timed cues the game turns into effects: a thrown blade
 *                 leaving the hand, a landing shockwave, a dust puff.
 *
 * Root motion is authored in "forward" space — +x is toward whatever the hero
 * is facing — and mirrored per side at playback, so every move works on both
 * lanes from a single authoring pass.
 *
 * Moves are split by where they belong. GROUND moves are the combat set: they
 * keep the hero on his mark, land contact in the same window, and never move
 * him somewhere the next threat cannot be read from. CINEMATIC moves are the
 * fight-scene set — they travel, leave the floor, turn the hero around and
 * throw his blade, and are only ever staged by the death reel, where the
 * outcome is already known and the camera is authored to follow them.
 */

export type MoveTag = 'ground' | 'air' | 'travel' | 'throw' | 'spin' | 'heavy' | 'kick' | 'cinematic';

export interface RootKey {
  t: number;
  /** Forward travel in metres, mirrored to the hero's facing at playback. */
  x?: number;
  /** Height above the floor in metres. */
  y?: number;
  /** Root euler [pitch, yaw, roll]; yaw and roll mirror with facing. */
  rot?: readonly [number, number, number];
}

export type MoveEventKind = 'throw' | 'shockwave' | 'dust' | 'afterimage';

export interface MoveEvent {
  t: number;
  kind: MoveEventKind;
}

export interface Move {
  readonly id: string;
  readonly track: readonly Keyframe[];
  readonly root?: readonly RootKey[];
  readonly events?: readonly MoveEvent[];
  /** Normalised time the blow lands — always inside the readable window. */
  readonly contactAt: number;
  /** Lunge multiplier. Ignored when the move carries its own root motion. */
  readonly reach?: number;
  /** Duration multiplier against the fixed commitment window. */
  readonly speed?: number;
  readonly tags: readonly MoveTag[];
}

// --------------------------------------------------------------- new tracks

/** CROSS CUT — two diagonals in one pass, both arms working. */
export const CROSS_CUT: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.2,
    pose: {
      hips: [0, 0.38, 0],
      spine: [-0.14, 0.3, 0],
      chest: [-0.1, 0.24, 0],
      head: [0.08, -0.3, 0],
      armR: [-0.9, 0.25, -0.85],
      forearmR: [0, 0, -1.1],
      armL: [-0.7, -0.2, 0.9],
      forearmL: [0, 0, 1],
      upLegR: [-0.24, 0, 0],
    },
  },
  {
    t: 0.38,
    pose: {
      hips: [0.06, -0.5, 0],
      spine: [0.16, -0.4, 0],
      chest: [0.14, -0.34, 0],
      head: [-0.12, 0.2, 0],
      armR: [0.95, -0.5, 1.15],
      forearmR: [0, 0, -0.2],
      armL: [-0.55, 0, -0.5],
      upLegR: [0.24, 0, 0],
      upLegL: [-0.28, 0, 0],
    },
  },
  {
    t: 0.52,
    pose: {
      hips: [-0.04, -0.2, 0],
      spine: [-0.1, -0.14, 0],
      chest: [-0.08, -0.1, 0],
      head: [0.1, 0.06, 0],
      armR: [-0.5, -0.2, -0.4],
      armL: [0.9, 0.35, 1.2],
      forearmL: [0, 0, 0.2],
      upLegL: [-0.14, 0, 0],
    },
  },
  {
    t: 0.72,
    pose: {
      hips: [0.04, -0.42, 0],
      spine: [0.1, -0.32, 0],
      armR: [0.3, -0.3, 0.7],
      armL: [0.4, 0.2, 0.8],
    },
  },
  { t: 1, pose: {} },
];

/** LOW SWEEP — drops under the guard and takes the legs out. */
export const LOW_SWEEP: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.22,
    pose: {
      hips: [0.55, 0.34, 0],
      spine: [0.3, 0.26, 0],
      chest: [0.24, 0.2, 0],
      head: [-0.3, -0.24, 0],
      armR: [-0.3, 0.2, -0.6],
      forearmR: [0, 0, -0.8],
      armL: [0.5, 0, 0.9],
      upLegR: [0.9, 0, 0],
      legR: [-1.3, 0, 0],
      upLegL: [0.5, 0, 0.2],
      legL: [-0.7, 0, 0],
    },
  },
  {
    t: 0.42,
    pose: {
      hips: [0.62, -0.8, 0],
      spine: [0.3, -0.5, 0],
      chest: [0.24, -0.4, 0],
      head: [-0.34, 0.4, 0],
      armR: [-0.1, -0.4, 0.5],
      armL: [0.3, 0, -0.7],
      upLegR: [0.5, 0, -1.15],
      legR: [-0.25, 0, 0],
      footR: [0.3, 0, 0],
      upLegL: [1.0, 0, 0.15],
      legL: [-1.5, 0, 0],
    },
  },
  {
    t: 0.66,
    pose: {
      hips: [0.4, -1.0, 0],
      spine: [0.2, -0.6, 0],
      head: [-0.24, 0.44, 0],
      upLegR: [0.7, 0, -0.6],
      legR: [-0.7, 0, 0],
      upLegL: [0.7, 0, 0],
      legL: [-1, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** BACKHAND — the blade crosses the body and whips back out reverse-grip. */
export const BACKHAND: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.22,
    pose: {
      hips: [0, -0.4, 0],
      spine: [-0.06, -0.34, 0],
      chest: [-0.05, -0.28, 0],
      head: [0.04, 0.3, 0],
      shoulderR: [0, 0, 0.4],
      armR: [0.2, -0.9, 1.35],
      forearmR: [0, 0, -1.3],
      armL: [-0.3, 0, -0.5],
      upLegL: [-0.2, 0, 0],
    },
  },
  {
    t: 0.4,
    pose: {
      hips: [0.04, 0.62, 0],
      spine: [0.14, 0.5, 0],
      chest: [0.12, 0.42, 0],
      upperChest: [0.06, 0.3, 0],
      head: [-0.12, -0.34, 0],
      shoulderR: [0, 0, -0.35],
      armR: [0.6, 0.7, -1.15],
      forearmR: [0, 0, -0.25],
      armL: [-0.4, 0, 0.7],
      upLegR: [-0.34, 0, 0],
      upLegL: [0.3, 0, 0],
    },
  },
  {
    t: 0.64,
    pose: {
      hips: [0.02, 0.78, 0],
      spine: [0.1, 0.6, 0],
      head: [-0.06, -0.42, 0],
      armR: [0.4, 0.85, -1.4],
      armL: [-0.28, 0, 0.5],
    },
  },
  { t: 1, pose: {} },
];

/** DOUBLE STAB — two rapid thrusts, the second deeper than the first. */
export const DOUBLE_STAB: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.14,
    pose: {
      hips: [0, 0.36, 0],
      spine: [-0.06, 0.28, 0],
      armR: [-0.2, 0.4, -0.4],
      forearmR: [0, 0, -1.5],
      armL: [0.2, 0, 0.35],
      upLegR: [-0.24, 0, 0],
    },
  },
  {
    t: 0.3,
    pose: {
      hips: [0.1, -0.3, 0],
      spine: [0.14, -0.24, 0],
      chest: [0.12, -0.2, 0],
      armR: [0.9, -0.1, 0.25],
      forearmR: [0, 0, -0.1],
      armL: [-0.35, 0, -0.6],
      upLegR: [0.36, 0, 0],
      upLegL: [-0.4, 0, 0],
    },
  },
  {
    t: 0.4,
    pose: {
      hips: [0.02, 0.1, 0],
      spine: [0.02, 0.08, 0],
      armR: [0.2, 0.3, -0.35],
      forearmR: [0, 0, -1.2],
      armL: [-0.1, 0, -0.2],
      upLegR: [0.1, 0, 0],
    },
  },
  {
    t: 0.56,
    pose: {
      hips: [0.16, -0.46, 0],
      spine: [0.22, -0.36, 0],
      chest: [0.18, -0.3, 0],
      upperChest: [0.1, -0.2, 0],
      head: [-0.08, 0.2, 0],
      armR: [1.1, -0.2, 0.4],
      forearmR: [0, 0, -0.05],
      armL: [-0.5, 0, -0.85],
      upLegR: [0.5, 0, 0],
      upLegL: [-0.55, 0, 0],
      legL: [0.6, 0, 0],
    },
  },
  {
    t: 0.76,
    pose: {
      hips: [0.08, -0.3, 0],
      spine: [0.1, -0.22, 0],
      armR: [0.8, -0.15, 0.3],
      upLegR: [0.3, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** HILT BASH — a short pommel jab that turns the enemy before the cut. */
export const HILT_BASH: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.2,
    pose: {
      hips: [0, 0.3, 0],
      spine: [-0.16, 0.24, 0],
      chest: [-0.12, 0.2, 0],
      head: [0.1, -0.22, 0],
      armR: [-0.55, 0.5, -0.55],
      forearmR: [0, 0, -2.1],
      armL: [-0.4, 0, 0.6],
      forearmL: [0, 0, 1.2],
      upLegR: [-0.2, 0, 0],
    },
  },
  {
    t: 0.4,
    pose: {
      hips: [0.1, -0.44, 0],
      spine: [0.22, -0.36, 0],
      chest: [0.18, -0.3, 0],
      upperChest: [0.12, -0.22, 0],
      head: [-0.16, 0.24, 0],
      shoulderR: [0, 0, 0.3],
      armR: [1.35, -0.3, 0.15],
      forearmR: [0, 0, -1.5],
      armL: [-0.3, 0, -0.4],
      upLegR: [0.32, 0, 0],
      upLegL: [-0.34, 0, 0],
    },
  },
  {
    t: 0.62,
    pose: {
      hips: [0.04, -0.66, 0],
      spine: [0.12, -0.5, 0],
      head: [-0.08, 0.34, 0],
      armR: [0.7, -0.6, 1.1],
      forearmR: [0, 0, -0.3],
      armL: [-0.24, 0, -0.4],
    },
  },
  { t: 1, pose: {} },
];

/** AXE KICK — the heel goes over the head and comes straight down. */
export const AXE_KICK: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.22,
    pose: {
      hips: [-0.2, 0.2, 0],
      spine: [-0.24, 0.16, 0],
      chest: [-0.18, 0.12, 0],
      head: [-0.2, -0.14, 0],
      armR: [-0.8, 0, -1.1],
      armL: [-0.8, 0, 1.1],
      upLegR: [-1.9, 0, -0.15],
      legR: [0.5, 0, 0],
      upLegL: [0.16, 0, 0],
      legL: [-0.2, 0, 0],
    },
  },
  {
    t: 0.42,
    pose: {
      hips: [0.42, -0.1, 0],
      spine: [0.4, -0.08, 0],
      chest: [0.3, -0.06, 0],
      head: [0.4, 0.06, 0],
      armR: [-0.2, 0, -0.7],
      armL: [-0.2, 0, 0.7],
      upLegR: [0.55, 0, -0.1],
      legR: [-0.15, 0, 0],
      footR: [0.4, 0, 0],
      upLegL: [-0.3, 0, 0],
      legL: [0.4, 0, 0],
    },
  },
  {
    t: 0.66,
    pose: {
      hips: [0.24, -0.06, 0],
      spine: [0.24, 0, 0],
      head: [0.22, 0.04, 0],
      upLegR: [0.3, 0, 0],
      legR: [-0.4, 0, 0],
      upLegL: [-0.16, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** FRONT KICK — compact chamber, heel through the centre, quick recoil. */
export const FRONT_KICK: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.2,
    pose: {
      hips: [-0.08, 0.18, 0],
      spine: [-0.18, 0.12, 0],
      chest: [-0.12, 0.08, 0],
      head: [0.1, -0.1, 0],
      armR: [-0.55, 0, -0.8],
      forearmR: [0, 0, -1.15],
      armL: [-0.45, 0, 0.75],
      forearmL: [0, 0, 1.05],
      upLegR: [-0.78, 0, -0.08],
      legR: [1.38, 0, 0],
      footR: [-0.18, 0, 0],
      upLegL: [0.12, 0, 0],
      legL: [-0.16, 0, 0],
    },
  },
  {
    t: 0.4,
    pose: {
      hips: [-0.18, -0.08, 0],
      spine: [-0.28, -0.06, 0],
      chest: [-0.2, -0.04, 0],
      head: [0.18, 0.04, 0],
      armR: [-0.7, 0, -1.05],
      armL: [-0.6, 0, 1.0],
      upLegR: [-1.48, 0, -0.05],
      legR: [0.08, 0, 0],
      footR: [0.44, 0, 0],
      toeR: [-0.16, 0, 0],
      upLegL: [0.2, 0, 0],
      legL: [-0.28, 0, 0],
    },
  },
  {
    t: 0.6,
    pose: {
      hips: [-0.1, -0.05, 0],
      spine: [-0.14, -0.04, 0],
      armR: [-0.45, 0, -0.7],
      armL: [-0.4, 0, 0.68],
      upLegR: [-0.72, 0, 0],
      legR: [1.05, 0, 0],
      footR: [0.08, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** KNEE STRIKE — drives the hip through while the lower leg stays folded. */
export const KNEE_STRIKE: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.2,
    pose: {
      hips: [-0.04, 0.3, 0],
      spine: [-0.16, 0.24, 0],
      chest: [-0.12, 0.18, 0],
      head: [0.08, -0.2, 0],
      armR: [-0.7, 0.15, -0.75],
      forearmR: [0, 0, -1.35],
      armL: [-0.65, -0.1, 0.75],
      forearmL: [0, 0, 1.3],
      upLegR: [-0.48, 0, 0],
      legR: [0.9, 0, 0],
      upLegL: [0.16, 0, 0],
    },
  },
  {
    t: 0.42,
    pose: {
      hips: [0.16, -0.24, 0],
      spine: [0.22, -0.18, 0],
      chest: [0.17, -0.14, 0],
      upperChest: [0.1, -0.1, 0],
      head: [-0.12, 0.12, 0],
      armR: [-0.92, -0.1, -0.85],
      forearmR: [0, 0, -1.05],
      armL: [-0.86, 0.08, 0.84],
      forearmL: [0, 0, 1.0],
      upLegR: [-1.4, 0, -0.08],
      legR: [1.58, 0, 0],
      footR: [-0.34, 0, 0],
      upLegL: [0.28, 0, 0],
      legL: [-0.35, 0, 0],
    },
  },
  {
    t: 0.62,
    pose: {
      hips: [0.08, -0.16, 0],
      spine: [0.12, -0.1, 0],
      armR: [-0.55, 0, -0.6],
      armL: [-0.5, 0, 0.6],
      upLegR: [-0.68, 0, 0],
      legR: [1.0, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** SIDE KICK — turns the hips over and punches the heel through the target. */
export const SIDE_KICK: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.22,
    pose: {
      hips: [0, 0.48, 0.08],
      spine: [-0.12, 0.34, 0.08],
      chest: [-0.1, 0.26, 0.06],
      head: [0.04, -0.3, -0.04],
      armR: [-0.6, 0, -0.92],
      armL: [-0.5, 0, 0.92],
      upLegR: [-0.62, 0, -0.52],
      legR: [1.32, 0, 0],
      footR: [-0.18, 0.18, 0],
      upLegL: [0.18, 0, 0.08],
    },
  },
  {
    t: 0.42,
    pose: {
      hips: [0.06, -0.72, 0.18],
      spine: [-0.08, -0.52, -0.2],
      chest: [-0.06, -0.4, -0.15],
      upperChest: [0, -0.26, -0.08],
      head: [0.08, 0.36, 0.12],
      armR: [-0.8, 0, -1.28],
      armL: [-0.72, 0, 1.2],
      upLegR: [-0.24, 0.08, -1.48],
      legR: [0.12, 0, 0],
      footR: [0.12, 0.38, 0],
      toeR: [-0.12, 0, 0],
      upLegL: [0.16, 0, 0.18],
      legL: [-0.24, 0, 0],
    },
  },
  {
    t: 0.66,
    pose: {
      hips: [0.04, -0.6, 0.1],
      spine: [-0.04, -0.4, -0.1],
      head: [0.04, 0.28, 0.06],
      armR: [-0.5, 0, -0.82],
      armL: [-0.46, 0, 0.78],
      upLegR: [-0.45, 0, -0.7],
      legR: [0.78, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** CRESCENT KICK — the foot arcs inside-to-outside across the opponent's head. */
export const CRESCENT_KICK: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.18,
    pose: {
      hips: [-0.05, 0.42, 0],
      spine: [-0.16, 0.3, 0],
      chest: [-0.12, 0.24, 0],
      head: [0.08, -0.3, 0],
      armR: [-0.5, 0, -0.95],
      armL: [-0.4, 0, 0.9],
      upLegR: [-0.72, 0.3, 0.42],
      legR: [0.72, 0, 0],
      upLegL: [0.14, 0, 0],
    },
  },
  {
    t: 0.4,
    pose: {
      hips: [0.02, -0.46, -0.08],
      spine: [-0.08, -0.32, 0.12],
      chest: [-0.06, -0.24, 0.1],
      head: [0.08, 0.24, -0.08],
      armR: [-0.72, 0, -1.2],
      armL: [-0.64, 0, 1.12],
      upLegR: [-0.48, -0.15, -1.5],
      legR: [0.2, 0, 0],
      footR: [0.3, 0.26, 0],
      toeR: [-0.14, 0, 0],
      upLegL: [0.18, 0, 0.08],
    },
  },
  {
    t: 0.64,
    pose: {
      hips: [0.02, -0.7, -0.04],
      spine: [-0.04, -0.48, 0.06],
      head: [0.04, 0.32, -0.04],
      armR: [-0.45, 0, -0.78],
      armL: [-0.4, 0, 0.72],
      upLegR: [-0.55, -0.12, -0.62],
      legR: [0.76, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** SPINNING HOOK — spots the target, turns through, then whips the heel back. */
export const SPINNING_HOOK_KICK: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.18,
    pose: {
      hips: [0, 0.78, 0],
      spine: [-0.12, 0.54, 0],
      chest: [-0.1, 0.42, 0],
      head: [0.05, -0.58, 0],
      armR: [-0.55, 0, -1.0],
      armL: [-0.45, 0, 0.96],
      upLegR: [-0.55, 0, -0.3],
      legR: [1.0, 0, 0],
      upLegL: [0.16, 0, 0],
    },
  },
  {
    t: 0.42,
    pose: {
      hips: [0.08, -2.85, 0.16],
      spine: [0.08, -0.62, -0.14],
      chest: [0.06, -0.48, -0.1],
      head: [-0.08, 0.58, 0.08],
      armR: [-0.9, 0, -1.35],
      armL: [0.25, 0, 1.2],
      upLegR: [-0.18, 0, 1.46],
      legR: [0.16, 0, 0],
      footR: [0.24, -0.32, 0],
      toeR: [-0.12, 0, 0],
      upLegL: [0.12, 0, -0.12],
    },
  },
  {
    t: 0.68,
    pose: {
      hips: [0.04, -4.7, 0.08],
      spine: [0.05, -0.38, -0.08],
      head: [-0.04, 0.34, 0.04],
      armR: [-0.6, 0, -0.9],
      armL: [0.12, 0, 0.78],
      upLegR: [-0.4, 0, 0.68],
      legR: [0.72, 0, 0],
    },
  },
  { t: 1, pose: { hips: [0, -6.2832, 0] } },
];

/** JUMP SPIN KICK — a compact hop lets both hips and heel turn through. */
export const JUMP_SPIN_KICK: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.2,
    pose: {
      hips: [-0.16, 0.7, 0],
      spine: [-0.22, 0.48, 0],
      chest: [-0.16, 0.38, 0],
      head: [-0.12, -0.5, 0],
      armR: [-0.95, 0, -1.15],
      armL: [-0.9, 0, 1.1],
      upLegR: [0.58, 0, -0.14],
      legR: [-1.08, 0, 0],
      upLegL: [0.48, 0, 0.14],
      legL: [-0.9, 0, 0],
    },
  },
  {
    t: 0.44,
    pose: {
      hips: [0.06, -2.7, 0.12],
      spine: [0.1, -0.54, -0.1],
      chest: [0.08, -0.42, -0.08],
      head: [-0.1, 0.52, 0.06],
      armR: [-0.82, 0, -1.32],
      armL: [0.4, 0, 1.25],
      upLegR: [-0.16, 0, -1.42],
      legR: [0.12, 0, 0],
      footR: [0.3, 0.28, 0],
      toeR: [-0.15, 0, 0],
      upLegL: [0.72, 0, 0.16],
      legL: [-1.18, 0, 0],
    },
  },
  {
    t: 0.7,
    pose: {
      hips: [0.02, -4.85, 0.05],
      spine: [0.06, -0.32, -0.04],
      head: [-0.04, 0.3, 0.03],
      armR: [-0.5, 0, -0.8],
      armL: [0.18, 0, 0.7],
      upLegR: [0.45, 0, -0.5],
      legR: [-0.62, 0, 0],
      upLegL: [0.35, 0, 0],
      legL: [-0.58, 0, 0],
    },
  },
  { t: 1, pose: { hips: [0, -6.2832, 0] } },
];

/** SLIDE — goes in low under the swing, comes up cutting on the way through. */
export const SLIDE_CUT: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.16,
    pose: {
      hips: [0.9, 0.2, 0],
      spine: [0.5, 0.16, 0],
      chest: [0.4, 0.12, 0],
      head: [-0.6, -0.2, 0],
      armR: [-0.5, 0.3, -0.5],
      forearmR: [0, 0, -0.7],
      armL: [-0.9, 0, 1.2],
      upLegR: [1.35, 0, 0],
      legR: [-0.5, 0, 0],
      upLegL: [0.5, 0, 0.25],
      legL: [-1.5, 0, 0],
    },
  },
  {
    t: 0.44,
    pose: {
      hips: [1.1, -0.3, 0],
      spine: [0.55, -0.24, 0],
      chest: [0.45, -0.2, 0],
      head: [-0.75, 0.3, 0],
      shoulderR: [0, 0, 0.4],
      armR: [-1.6, -0.4, 0.9],
      forearmR: [0, 0, -0.4],
      armL: [-0.8, 0, 1],
      upLegR: [1.5, 0, 0],
      legR: [-0.35, 0, 0],
      upLegL: [0.6, 0, 0.3],
      legL: [-1.6, 0, 0],
    },
  },
  {
    t: 0.68,
    pose: {
      hips: [0.4, -0.5, 0],
      spine: [0.2, -0.4, 0],
      head: [-0.3, 0.4, 0],
      armR: [-0.6, -0.5, 1.2],
      armL: [-0.3, 0, 0.5],
      upLegR: [0.6, 0, 0],
      legR: [-0.8, 0, 0],
      upLegL: [0.2, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** VAULT — a hand on the shoulder, over the top, cutting down on the way past. */
export const VAULT_CUT: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.2,
    pose: {
      hips: [-0.3, 0.2, 0],
      spine: [-0.3, 0.16, 0],
      chest: [-0.24, 0.12, 0],
      head: [-0.3, -0.16, 0],
      armR: [-2.1, 0.2, -0.4],
      forearmR: [0, 0, -0.6],
      armL: [-2.4, -0.1, 0.3],
      upLegR: [0.7, 0, 0],
      legR: [-1.2, 0, 0],
      upLegL: [0.5, 0, 0],
      legL: [-1, 0, 0],
    },
  },
  {
    t: 0.44,
    pose: {
      hips: [0.3, -0.2, 0],
      spine: [0.3, -0.16, 0],
      chest: [0.24, -0.12, 0],
      head: [0.4, 0.16, 0],
      shoulderR: [0, 0, 0.3],
      armR: [1.5, -0.3, 0.5],
      forearmR: [0, 0, -0.35],
      armL: [-1.6, 0, 0.9],
      upLegR: [0.9, 0, 0],
      legR: [-1.5, 0, 0],
      upLegL: [-0.5, 0, 0],
      legL: [-0.3, 0, 0],
    },
  },
  {
    t: 0.7,
    pose: {
      hips: [0.1, -0.3, 0],
      spine: [0.1, -0.22, 0],
      head: [0.16, 0.24, 0],
      armR: [0.7, -0.4, 0.9],
      armL: [-0.6, 0, 0.6],
      upLegR: [0.3, 0, 0],
      upLegL: [-0.3, 0, 0],
      legL: [0.4, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** THROW — the blade leaves the hand overhand, the body follows through. */
export const THROW: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.26,
    pose: {
      hips: [0, 0.6, 0],
      spine: [-0.24, 0.46, 0],
      chest: [-0.2, 0.38, 0],
      upperChest: [-0.12, 0.28, 0],
      head: [0.1, -0.4, 0],
      shoulderR: [0, 0, -0.5],
      armR: [-2.2, 0.3, -0.7],
      forearmR: [0, 0, -1.5],
      armL: [-0.6, 0, 0.9],
      upLegR: [-0.3, 0, 0],
      upLegL: [0.24, 0, 0],
    },
  },
  {
    t: 0.44,
    pose: {
      hips: [0.16, -0.66, 0],
      spine: [0.3, -0.54, 0],
      chest: [0.26, -0.44, 0],
      upperChest: [0.16, -0.32, 0],
      head: [-0.16, 0.34, 0],
      shoulderR: [0, 0, 0.4],
      armR: [1.35, -0.5, 0.55],
      forearmR: [0, 0, -0.15],
      armL: [-0.5, 0, -0.9],
      upLegR: [0.4, 0, 0],
      upLegL: [-0.46, 0, 0],
      legL: [0.5, 0, 0],
    },
  },
  {
    t: 0.68,
    pose: {
      hips: [0.08, -0.5, 0],
      spine: [0.16, -0.4, 0],
      head: [-0.08, 0.28, 0],
      armR: [1.1, -0.4, 0.4],
      armL: [-0.34, 0, -0.6],
    },
  },
  { t: 1, pose: {} },
];

/** DIVE — a committed leap with the blade held out ahead of the body. */
export const DIVE_CUT: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.2,
    pose: {
      hips: [-0.34, 0.4, 0],
      spine: [-0.3, 0.32, 0],
      chest: [-0.24, 0.26, 0],
      head: [-0.2, -0.3, 0],
      armR: [-1.5, 0.4, -0.9],
      forearmR: [0, 0, -1.2],
      armL: [-0.5, 0, 0.9],
      upLegR: [0.8, 0, 0],
      legR: [-1.3, 0, 0],
      upLegL: [0.4, 0, 0],
    },
  },
  {
    t: 0.44,
    pose: {
      hips: [0.5, -0.5, 0],
      spine: [0.44, -0.4, 0],
      chest: [0.36, -0.34, 0],
      upperChest: [0.22, -0.24, 0],
      head: [0.3, 0.3, 0],
      shoulderR: [0, 0, 0.45],
      armR: [1.55, -0.5, 0.8],
      forearmR: [0, 0, -0.2],
      armL: [-0.7, 0, -1],
      upLegR: [-0.6, 0, 0],
      legR: [0.5, 0, 0],
      upLegL: [-0.2, 0, 0],
      legL: [0.8, 0, 0],
    },
  },
  {
    t: 0.7,
    pose: {
      hips: [0.3, -0.6, 0],
      spine: [0.28, -0.46, 0],
      head: [0.2, 0.34, 0],
      armR: [1.1, -0.55, 1],
      armL: [-0.4, 0, -0.6],
      upLegR: [0.3, 0, 0],
      legR: [-0.5, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** FLIP KICK — the boot goes up through the chin on the way over backwards. */
export const FLIP_KICK: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.18,
    pose: {
      hips: [0.3, 0, 0],
      spine: [0.26, 0, 0],
      chest: [0.2, 0, 0],
      head: [0.2, 0, 0],
      armR: [-0.5, 0, -0.6],
      armL: [-0.5, 0, 0.6],
      upLegR: [0.7, 0, 0],
      legR: [-1.1, 0, 0],
      upLegL: [0.5, 0, 0],
      legL: [-0.9, 0, 0],
    },
  },
  {
    t: 0.4,
    pose: {
      hips: [-0.3, 0, 0],
      spine: [-0.34, 0, 0],
      chest: [-0.26, 0, 0],
      head: [-0.34, 0, 0],
      armR: [-1.6, 0, -1],
      armL: [-1.6, 0, 1],
      upLegR: [-1.7, 0, -0.1],
      legR: [0.35, 0, 0],
      footR: [0.35, 0, 0],
      upLegL: [-0.5, 0, 0.1],
      legL: [0.8, 0, 0],
    },
  },
  {
    t: 0.72,
    pose: {
      hips: [0.2, 0, 0],
      spine: [0.16, 0, 0],
      armR: [-0.7, 0, -0.7],
      armL: [-0.7, 0, 0.7],
      upLegR: [0.5, 0, 0],
      legR: [-0.8, 0, 0],
      upLegL: [0.3, 0, 0],
      legL: [-0.6, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** IAIDO — drawn and sheathed in one pass; the cut happens mid-stride. */
export const DRAW_CUT: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.22,
    pose: {
      hips: [0, 0.5, 0],
      spine: [-0.1, 0.4, 0],
      chest: [-0.08, 0.34, 0],
      head: [0.04, -0.42, 0],
      shoulderR: [0, 0, -0.3],
      armR: [-0.15, 0.7, -1.3],
      forearmR: [0, 0, -1.8],
      armL: [0.2, 0, 0.6],
      upLegR: [-0.5, 0, 0],
      upLegL: [0.4, 0, 0],
    },
  },
  {
    t: 0.42,
    pose: {
      hips: [0.05, -0.7, 0],
      spine: [0.14, -0.56, 0],
      chest: [0.12, -0.46, 0],
      upperChest: [0.06, -0.34, 0],
      head: [-0.1, 0.42, 0],
      shoulderR: [0, 0, 0.5],
      armR: [0.5, -0.85, 1.5],
      forearmR: [0, 0, -0.1],
      armL: [-0.45, 0, -0.8],
      upLegR: [0.55, 0, 0],
      upLegL: [-0.6, 0, 0],
      legL: [0.55, 0, 0],
    },
  },
  {
    t: 0.66,
    pose: {
      hips: [0, -0.4, 0],
      spine: [0.06, -0.3, 0],
      head: [-0.04, 0.24, 0],
      armR: [0.1, -0.5, 0.9],
      forearmR: [0, 0, -0.9],
      armL: [-0.2, 0, -0.4],
    },
  },
  { t: 1, pose: {} },
];

/** TORNADO — two full revolutions with the blade held out wide. */
export const TORNADO: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.14,
    pose: {
      hips: [0, 0.8, 0],
      spine: [-0.1, 0.5, 0],
      chest: [-0.08, 0.4, 0],
      armR: [-0.2, 0.4, -1.35],
      forearmR: [0, 0, -0.5],
      armL: [0.2, 0, 1.2],
      upLegR: [-0.24, 0, 0],
    },
  },
  {
    t: 0.42,
    pose: {
      hips: [0.06, -3.2, 0],
      spine: [0.12, -0.5, 0],
      chest: [0.1, -0.4, 0],
      upperChest: [0.05, -0.28, 0],
      armR: [0.1, -0.2, 1.6],
      forearmR: [0, 0, -0.05],
      armL: [-0.1, 0, -1.5],
      upLegR: [0.2, 0, 0],
      upLegL: [-0.24, 0, 0],
    },
  },
  {
    t: 0.72,
    pose: {
      hips: [0.02, -8.5, 0],
      spine: [0.08, -0.3, 0],
      armR: [0.05, -0.15, 1.55],
      armL: [-0.05, 0, -1.3],
      upLegL: [0.2, 0, 0],
    },
  },
  { t: 1, pose: { hips: [0, -12.5664, 0] } },
];

/** SLAM — up, then straight down with everything behind it. */
export const SLAM: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.24,
    pose: {
      hips: [-0.34, 0.1, 0],
      spine: [-0.4, 0.08, 0],
      chest: [-0.3, 0.06, 0],
      head: [-0.4, -0.08, 0],
      shoulderR: [0, 0, -0.6],
      shoulderL: [0, 0, 0.6],
      armR: [-2.5, 0.1, -0.4],
      armL: [-2.5, -0.1, 0.4],
      upLegR: [0.9, 0, 0],
      legR: [-1.4, 0, 0],
      upLegL: [0.9, 0, 0],
      legL: [-1.4, 0, 0],
    },
  },
  {
    t: 0.46,
    pose: {
      hips: [0.62, 0, 0],
      spine: [0.55, 0, 0],
      chest: [0.42, 0, 0],
      head: [0.5, 0, 0],
      armR: [0.6, 0.2, -0.25],
      forearmR: [0, 0, -0.3],
      armL: [0.6, -0.2, 0.25],
      forearmL: [0, 0, 0.3],
      upLegR: [-0.7, 0, -0.2],
      legR: [1.0, 0, 0],
      upLegL: [-0.7, 0, 0.2],
      legL: [1.0, 0, 0],
    },
  },
  {
    t: 0.7,
    pose: {
      hips: [0.4, 0, 0],
      spine: [0.36, 0, 0],
      head: [0.32, 0, 0],
      armR: [0.4, 0.15, -0.2],
      armL: [0.4, -0.15, 0.2],
      upLegR: [-0.4, 0, -0.15],
      legR: [0.6, 0, 0],
      upLegL: [-0.4, 0, 0.15],
      legL: [0.6, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** RIPOSTE — a sidestep that lets the swing pass, then the answer. */
export const RIPOSTE: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.2,
    pose: {
      hips: [-0.1, 0.24, 0.3],
      spine: [-0.2, 0.2, 0.26],
      chest: [-0.16, 0.16, 0.2],
      head: [-0.1, -0.2, 0.3],
      armR: [-0.4, 0.3, -0.5],
      forearmR: [0, 0, -1.3],
      armL: [-0.5, 0, 0.9],
      upLegR: [-0.4, 0, 0.2],
      upLegL: [0.3, 0, 0.1],
    },
  },
  {
    t: 0.44,
    pose: {
      hips: [0.14, -0.55, 0],
      spine: [0.24, -0.44, 0],
      chest: [0.2, -0.36, 0],
      upperChest: [0.12, -0.26, 0],
      head: [-0.12, 0.28, 0],
      shoulderR: [0, 0, 0.36],
      armR: [1.15, -0.35, 0.6],
      forearmR: [0, 0, -0.12],
      armL: [-0.55, 0, -0.85],
      upLegR: [0.44, 0, 0],
      upLegL: [-0.5, 0, 0],
      legL: [0.55, 0, 0],
    },
  },
  {
    t: 0.68,
    pose: {
      hips: [0.06, -0.4, 0],
      spine: [0.12, -0.3, 0],
      armR: [0.85, -0.3, 0.5],
      armL: [-0.35, 0, -0.6],
      upLegR: [0.26, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

// ------------------------------------------------------------ the library

/** Root-motion paths, authored in forward space. */
const R = {
  slide: [
    { t: 0, x: 0, y: 0 },
    { t: 0.16, x: 0.5, y: 0, rot: [0.35, 0, 0] },
    { t: 0.5, x: 2.1, y: 0, rot: [0.5, 0, 0] },
    { t: 0.7, x: 2.6, y: 0, rot: [0.1, Math.PI, 0] },
    { t: 1, x: 2.5, y: 0, rot: [0, Math.PI, 0] },
  ],
  vault: [
    { t: 0, x: 0, y: 0 },
    { t: 0.2, x: 0.5, y: 0.5 },
    { t: 0.44, x: 1.7, y: 1.35, rot: [-0.5, 0, 0] },
    { t: 0.7, x: 2.6, y: 0.35, rot: [-0.2, Math.PI, 0] },
    { t: 1, x: 2.6, y: 0, rot: [0, Math.PI, 0] },
  ],
  hopBack: [
    { t: 0, x: 0, y: 0 },
    { t: 0.26, x: -0.7, y: 0.35 },
    { t: 0.5, x: -0.55, y: 0 },
    { t: 1, x: -0.3, y: 0 },
  ],
  leap: [
    { t: 0, x: 0, y: 0 },
    { t: 0.2, x: 0.2, y: 1.1 },
    { t: 0.45, x: 0.35, y: 2.0 },
    { t: 0.75, x: 0.3, y: 0.6 },
    { t: 1, x: 0.2, y: 0 },
  ],
  dive: [
    { t: 0, x: 0, y: 0 },
    { t: 0.2, x: 0.6, y: 0.85 },
    { t: 0.44, x: 1.5, y: 1.05 },
    { t: 0.72, x: 2.0, y: 0.1 },
    { t: 1, x: 2.0, y: 0 },
  ],
  backflip: [
    { t: 0, x: 0, y: 0 },
    { t: 0.22, x: -0.35, y: 0.9, rot: [-1.6, 0, 0] },
    { t: 0.5, x: -1.0, y: 1.5, rot: [-3.6, 0, 0] },
    { t: 0.78, x: -1.5, y: 0.5, rot: [-5.6, 0, 0] },
    { t: 1, x: -1.4, y: 0, rot: [-6.2832, 0, 0] },
  ],
  dash: [
    { t: 0, x: 0, y: 0 },
    { t: 0.24, x: 0.3, y: 0 },
    { t: 0.42, x: 2.2, y: 0 },
    { t: 0.6, x: 3.0, y: 0, rot: [0, Math.PI, 0] },
    { t: 1, x: 2.9, y: 0, rot: [0, Math.PI, 0] },
  ],
  slam: [
    { t: 0, x: 0, y: 0 },
    { t: 0.24, x: 0.4, y: 1.5 },
    { t: 0.42, x: 0.9, y: 1.7 },
    { t: 0.5, x: 1.0, y: 0 },
    { t: 1, x: 0.9, y: 0 },
  ],
  sidestep: [
    { t: 0, x: 0, y: 0 },
    { t: 0.22, x: -0.25, y: 0, rot: [0, 0, 0.25] },
    { t: 0.46, x: 1.1, y: 0 },
    { t: 1, x: 0.6, y: 0 },
  ],
  tornado: [
    { t: 0, x: 0, y: 0 },
    { t: 0.3, x: 0.7, y: 0.2 },
    { t: 0.6, x: 1.5, y: 0.25 },
    { t: 1, x: 1.7, y: 0 },
  ],
} as const satisfies Record<string, readonly RootKey[]>;

export const MOVES: readonly Move[] = [
  // --- the combat set: grounded, readable, land on the same beat ----------
  { id: 'slash', track: SLASH, contactAt: 0.42, tags: ['ground'] },
  { id: 'rising', track: RISING, contactAt: 0.44, reach: 0.92, speed: 0.98, tags: ['ground'] },
  { id: 'thrust', track: THRUST, contactAt: 0.38, reach: 1.5, speed: 0.9, tags: ['ground'] },
  { id: 'crossCut', track: CROSS_CUT, contactAt: 0.38, reach: 1.05, tags: ['ground'] },
  { id: 'backhand', track: BACKHAND, contactAt: 0.4, reach: 1.1, tags: ['ground'] },
  { id: 'doubleStab', track: DOUBLE_STAB, contactAt: 0.4, reach: 1.35, speed: 1.05, tags: ['ground'] },
  { id: 'hiltBash', track: HILT_BASH, contactAt: 0.4, reach: 0.95, speed: 0.92, tags: ['ground'] },
  { id: 'frontKick', track: FRONT_KICK, contactAt: 0.4, reach: 1.08, speed: 0.94, tags: ['ground', 'kick'] },
  { id: 'kneeStrike', track: KNEE_STRIKE, contactAt: 0.42, reach: 0.92, speed: 0.9, tags: ['ground', 'kick'] },
  { id: 'sideKick', track: SIDE_KICK, contactAt: 0.42, reach: 1.25, tags: ['ground', 'kick'] },
  {
    id: 'lowSweep',
    track: LOW_SWEEP,
    contactAt: 0.42,
    reach: 1.15,
    tags: ['ground', 'spin'],
    events: [{ t: 0.4, kind: 'dust' }],
  },
  { id: 'spin', track: SPIN, contactAt: 0.4, reach: 1.1, speed: 1.06, tags: ['ground', 'spin'] },
  {
    id: 'cleave',
    track: CLEAVE,
    contactAt: 0.46,
    reach: 1.2,
    speed: 1.04,
    root: [
      { t: 0, y: 0 },
      { t: 0.26, y: 0.42 },
      { t: 0.46, y: 0 },
      { t: 1, y: 0 },
    ],
    events: [{ t: 0.46, kind: 'dust' }],
    tags: ['ground', 'heavy'],
  },
  { id: 'roundhouse', track: ROUNDHOUSE, contactAt: 0.42, reach: 1.15, tags: ['ground', 'kick'] },
  {
    id: 'axeKick',
    track: AXE_KICK,
    contactAt: 0.42,
    reach: 1.05,
    root: [
      { t: 0, y: 0 },
      { t: 0.22, y: 0.3 },
      { t: 0.42, y: 0 },
      { t: 1, y: 0 },
    ],
    tags: ['ground', 'heavy', 'kick'],
  },
  { id: 'crescentKick', track: CRESCENT_KICK, contactAt: 0.4, reach: 1.16, tags: ['ground', 'kick'] },
  {
    id: 'spinningHookKick',
    track: SPINNING_HOOK_KICK,
    contactAt: 0.42,
    reach: 1.2,
    speed: 1.06,
    events: [{ t: 0.4, kind: 'dust' }],
    tags: ['ground', 'spin', 'kick'],
  },
  {
    id: 'jumpSpinKick',
    track: JUMP_SPIN_KICK,
    contactAt: 0.44,
    reach: 1.22,
    speed: 1.08,
    root: [
      { t: 0, y: 0 },
      { t: 0.2, y: 0.28 },
      { t: 0.44, y: 0.16 },
      { t: 0.72, y: 0 },
      { t: 1, y: 0 },
    ],
    events: [{ t: 0.7, kind: 'dust' }],
    tags: ['ground', 'spin', 'kick'],
  },

  // --- the fight-scene set: travel, air, and thrown steel -----------------
  {
    id: 'slideUnder',
    track: SLIDE_CUT,
    root: R.slide,
    contactAt: 0.44,
    speed: 1.35,
    events: [
      { t: 0.14, kind: 'dust' },
      { t: 0.3, kind: 'afterimage' },
    ],
    tags: ['cinematic', 'travel'],
  },
  {
    id: 'vaultOver',
    track: VAULT_CUT,
    root: R.vault,
    contactAt: 0.44,
    speed: 1.3,
    events: [{ t: 0.72, kind: 'dust' }],
    tags: ['cinematic', 'travel', 'air'],
  },
  {
    id: 'bladeThrow',
    track: THROW,
    root: R.hopBack,
    contactAt: 0.44,
    speed: 1.15,
    events: [{ t: 0.42, kind: 'throw' }],
    tags: ['cinematic', 'throw'],
  },
  {
    id: 'aerialThrow',
    track: THROW,
    root: R.leap,
    contactAt: 0.44,
    speed: 1.45,
    events: [
      { t: 0.44, kind: 'throw' },
      { t: 0.92, kind: 'dust' },
    ],
    tags: ['cinematic', 'throw', 'air'],
  },
  {
    id: 'divingSlash',
    track: DIVE_CUT,
    root: R.dive,
    contactAt: 0.44,
    speed: 1.3,
    events: [{ t: 0.74, kind: 'dust' }],
    tags: ['cinematic', 'travel', 'air'],
  },
  {
    id: 'backflipKick',
    track: FLIP_KICK,
    root: R.backflip,
    contactAt: 0.4,
    speed: 1.35,
    events: [{ t: 0.95, kind: 'dust' }],
    tags: ['cinematic', 'air'],
  },
  {
    id: 'dashThrough',
    track: DRAW_CUT,
    root: R.dash,
    contactAt: 0.42,
    speed: 1.25,
    events: [
      { t: 0.26, kind: 'afterimage' },
      { t: 0.42, kind: 'afterimage' },
    ],
    tags: ['cinematic', 'travel'],
  },
  {
    id: 'tornado',
    track: TORNADO,
    root: R.tornado,
    contactAt: 0.42,
    speed: 1.5,
    tags: ['cinematic', 'spin'],
  },
  {
    id: 'groundPound',
    track: SLAM,
    root: R.slam,
    contactAt: 0.46,
    speed: 1.3,
    events: [
      { t: 0.5, kind: 'shockwave' },
      { t: 0.5, kind: 'dust' },
    ],
    tags: ['cinematic', 'air', 'heavy'],
  },
  {
    id: 'riposte',
    track: RIPOSTE,
    root: R.sidestep,
    contactAt: 0.44,
    speed: 1.1,
    tags: ['cinematic', 'travel'],
  },
];

const BY_ID = new Map(MOVES.map((m) => [m.id, m]));

export function moveById(id: string): Move {
  return BY_ID.get(id) ?? MOVES[0];
}

export function movesTagged(tag: MoveTag): readonly Move[] {
  return MOVES.filter((m) => m.tags.includes(tag));
}

/** Grounded moves that read cleanly at speed — the ordinary-hit rotation. */
export const BASIC_IDS = [
  'slash',
  'frontKick',
  'rising',
  'kneeStrike',
  'thrust',
  'sideKick',
  'crossCut',
  'doubleStab',
  'hiltBash',
] as const;
/** The showy grounded half: earned by a Perfect. */
export const FLASHY_IDS = [
  'roundhouse',
  'spin',
  'axeKick',
  'cleave',
  'crescentKick',
  'backhand',
  'spinningHookKick',
  'lowSweep',
  'jumpSpinKick',
] as const;
/** Reel-only moves: they travel, leave the floor, or throw the blade. */
export const CINEMATIC_IDS = MOVES.filter((m) => m.tags.includes('cinematic')).map((m) => m.id);

export interface RootSample {
  x: number;
  y: number;
  rot: [number, number, number];
}

/** Samples a root-motion path, easing between keys exactly as poses do. */
export function sampleRoot(
  keys: readonly RootKey[] | undefined,
  t: number,
  out: RootSample,
): RootSample {
  out.x = 0;
  out.y = 0;
  out.rot[0] = 0;
  out.rot[1] = 0;
  out.rot[2] = 0;
  if (!keys || keys.length === 0) return out;

  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < clamped) i++;
  const previous = keys[i - 1];
  const a = keys[i];
  const b = keys[i + 1] ?? a;
  const next = keys[i + 2];
  const span = b.t - a.t;
  const local = span > 1e-6 ? (clamped - a.t) / span : 0;

  const pr = previous?.rot ?? ZERO3;
  const ar = a.rot ?? ZERO3;
  const br = b.rot ?? ZERO3;
  const nr = next?.rot ?? ZERO3;
  const pt = previous?.t ?? a.t;
  const nt = next?.t ?? b.t;
  const hasPrevious = previous !== undefined;
  const hasNext = next !== undefined;
  const curve = (p: number, av: number, bv: number, n: number) =>
    cubicMotion(p, av, bv, n, pt, a.t, b.t, nt, local, hasPrevious, hasNext);
  out.x = curve(previous?.x ?? 0, a.x ?? 0, b.x ?? 0, next?.x ?? 0);
  out.y = curve(previous?.y ?? 0, a.y ?? 0, b.y ?? 0, next?.y ?? 0);
  out.rot[0] = curve(pr[0], ar[0], br[0], nr[0]);
  out.rot[1] = curve(pr[1], ar[1], br[1], nr[1]);
  out.rot[2] = curve(pr[2], ar[2], br[2], nr[2]);
  return out;
}

const ZERO3 = [0, 0, 0] as const;
