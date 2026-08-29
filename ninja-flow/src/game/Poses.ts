import type { Pose } from './Rig';
import { cubicMotion } from './MotionSpline';

/**
 * Hand-authored procedural animation for NINJA FLOW's combat states.
 *
 * The supplied clips are 2-6 seconds long — beautiful, but far too slow for a
 * 300 ms strike; playing them at 8x reads as a blur and never lines up with
 * hit-stop. So the strike itself is authored here at exactly the length combat
 * needs, layered additively on top of the character's own idle clip, while the
 * long premium clips are saved for the Flow finisher where their length works.
 *
 * Every strike uses the whole body: anticipation into the back foot, hip drive,
 * torso rotation leading the arm, and a follow-through that overshoots before
 * settling. Poses are euler offsets in radians, in bone-local space.
 */

export interface Keyframe {
  /** Normalized time within the animation, 0..1. */
  t: number;
  pose: Pose;
}

/** Ease used for simple envelopes and non-skeletal transitions. */
export function ease(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * c * (c * (c * 6 - 15) + 10);
}

/**
 * SLASH — the core attack, authored against the three attack phases.
 * 0.00-0.23  anticipation: coil away from the target, weight to back foot
 * 0.23-0.42  strike: hips and chest whip through, arm arrives last
 * 0.42-0.70  follow-through: overshoot past the target
 * 0.70-1.00  recentre
 */
export const SLASH: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.23,
    pose: {
      hips: [0, 0.42, 0],
      spine: [-0.1, 0.3, 0],
      chest: [-0.08, 0.26, 0],
      upperChest: [0, 0.2, 0],
      head: [0.06, -0.34, 0],
      shoulderR: [0, 0, -0.3],
      armR: [-0.5, 0.2, -0.75],
      forearmR: [0, 0, -1.15],
      armL: [0.2, 0, 0.55],
      forearmL: [0, 0, 0.5],
      upLegR: [-0.22, 0, 0],
      upLegL: [0.16, 0, 0],
    },
  },
  {
    t: 0.42,
    pose: {
      hips: [0.06, -0.62, 0],
      spine: [0.16, -0.5, 0],
      chest: [0.14, -0.42, 0],
      upperChest: [0.08, -0.3, 0],
      head: [-0.14, 0.2, 0],
      shoulderR: [0, 0, 0.34],
      armR: [0.75, -0.55, 1.05],
      forearmR: [0, 0, -0.2],
      armL: [-0.35, 0, -0.6],
      forearmL: [0, 0, 0.25],
      upLegR: [0.3, 0, 0],
      upLegL: [-0.34, 0, 0],
      legL: [0.3, 0, 0],
    },
  },
  {
    t: 0.62,
    pose: {
      hips: [0.02, -0.78, 0],
      spine: [0.1, -0.6, 0],
      chest: [0.08, -0.5, 0],
      upperChest: [0.04, -0.34, 0],
      head: [-0.08, 0.3, 0],
      armR: [0.5, -0.7, 1.35],
      forearmR: [0, 0, -0.45],
      armL: [-0.28, 0, -0.45],
      upLegR: [0.2, 0, 0],
      upLegL: [-0.22, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** A whiffed swing: the same commitment, but off-balance and slower to reset. */
export const WHIFF: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.24,
    pose: {
      hips: [0, 0.34, 0],
      spine: [-0.12, 0.26, 0],
      armR: [-0.45, 0.15, -0.6],
      forearmR: [0, 0, -0.9],
      upLegR: [-0.18, 0, 0],
    },
  },
  {
    t: 0.5,
    pose: {
      hips: [0.18, -0.5, 0.14],
      spine: [0.26, -0.42, 0.12],
      chest: [0.2, -0.34, 0.1],
      head: [0.16, 0.16, 0],
      armR: [0.9, -0.4, 0.9],
      armL: [-0.4, 0, -0.7],
      upLegL: [-0.4, 0, 0],
      legL: [0.44, 0, 0],
    },
  },
  {
    t: 0.72,
    pose: {
      hips: [0.1, -0.22, 0.06],
      spine: [0.14, -0.18, 0.05],
      head: [0.1, 0.06, 0],
      armR: [0.4, -0.2, 0.5],
    },
  },
  { t: 1, pose: {} },
];

/** Recoil from taking a hit — head snaps, torso folds, back foot slides. */
export const HURT: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.16,
    pose: {
      hips: [-0.24, 0, 0],
      spine: [-0.34, 0, 0.1],
      chest: [-0.26, 0, 0.08],
      head: [-0.5, 0.1, 0.16],
      armL: [-0.5, 0, 0.8],
      armR: [-0.5, 0, -0.8],
      upLegL: [0.3, 0, 0],
      upLegR: [-0.2, 0, 0],
    },
  },
  {
    t: 0.45,
    pose: {
      hips: [-0.1, 0, 0],
      spine: [-0.14, 0, 0.04],
      head: [-0.2, 0.04, 0.06],
      armL: [-0.2, 0, 0.35],
      armR: [-0.2, 0, -0.35],
    },
  },
  { t: 1, pose: {} },
];

/** Knockout — a full collapse, held at the end rather than recentring. */
export const KO: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.3,
    pose: {
      hips: [-0.5, 0.2, 0],
      spine: [-0.6, 0.1, 0.2],
      chest: [-0.4, 0.1, 0.15],
      head: [-0.7, 0.2, 0.3],
      armL: [-0.9, 0, 1.1],
      armR: [-0.9, 0, -1.1],
      upLegL: [0.7, 0, 0.2],
      upLegR: [0.4, 0, -0.1],
      legL: [-0.8, 0, 0],
      legR: [-0.5, 0, 0],
    },
  },
  {
    t: 1,
    pose: {
      hips: [-1.15, 0.35, 0],
      spine: [-0.5, 0.15, 0.35],
      chest: [-0.3, 0.15, 0.25],
      head: [-0.4, 0.3, 0.45],
      armL: [-1.2, 0, 1.4],
      armR: [-1.2, 0, -1.4],
      upLegL: [1.2, 0, 0.35],
      upLegR: [0.9, 0, -0.2],
      legL: [-1.3, 0, 0],
      legR: [-1, 0, 0],
    },
  },
];

/** Flow dash strike — flatter, faster, more horizontal than a normal slash. */
export const FLOW_STRIKE: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.16,
    pose: {
      hips: [0.1, 0.55, 0],
      spine: [-0.2, 0.42, 0],
      chest: [-0.15, 0.34, 0],
      armR: [-0.8, 0.3, -1],
      forearmR: [0, 0, -1.4],
      armL: [0.3, 0, 0.7],
      upLegR: [-0.4, 0, 0],
      upLegL: [0.3, 0, 0],
    },
  },
  {
    t: 0.38,
    pose: {
      hips: [0.14, -0.85, 0],
      spine: [0.24, -0.68, 0],
      chest: [0.2, -0.58, 0],
      upperChest: [0.1, -0.4, 0],
      head: [-0.2, 0.3, 0],
      armR: [1.05, -0.75, 1.3],
      forearmR: [0, 0, -0.15],
      armL: [-0.5, 0, -0.85],
      upLegR: [0.45, 0, 0],
      upLegL: [-0.5, 0, 0],
      legL: [0.42, 0, 0],
    },
  },
  {
    t: 0.66,
    pose: {
      hips: [0.06, -0.5, 0],
      spine: [0.12, -0.4, 0],
      armR: [0.6, -0.5, 1],
      armL: [-0.3, 0, -0.5],
    },
  },
  { t: 1, pose: {} },
];


/**
 * RISING — a low-to-high diagonal cut. Drops into the back leg, then drives up
 * through the hips so the blade finishes above the shoulder.
 */
export const RISING: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.22,
    pose: {
      hips: [0.26, 0.3, 0],
      spine: [0.2, 0.24, 0],
      chest: [0.16, 0.2, 0],
      head: [0.24, -0.24, 0],
      shoulderR: [0, 0, -0.4],
      armR: [-1.15, 0.3, -0.5],
      forearmR: [0, 0, -0.9],
      armL: [0.25, 0, 0.5],
      upLegR: [0.42, 0, 0],
      legR: [-0.5, 0, 0],
      upLegL: [0.2, 0, 0],
    },
  },
  {
    t: 0.44,
    pose: {
      hips: [-0.24, -0.42, 0],
      spine: [-0.3, -0.36, 0],
      chest: [-0.24, -0.3, 0],
      upperChest: [-0.16, -0.22, 0],
      head: [-0.3, 0.18, 0],
      shoulderR: [0, 0, 0.45],
      armR: [1.5, -0.35, 0.6],
      forearmR: [0, 0, -0.3],
      armL: [-0.4, 0, -0.7],
      upLegR: [-0.3, 0, 0],
      upLegL: [-0.18, 0, 0],
    },
  },
  {
    t: 0.66,
    pose: {
      hips: [-0.14, -0.5, 0],
      spine: [-0.18, -0.4, 0],
      head: [-0.2, 0.22, 0],
      armR: [1.7, -0.5, 0.4],
      armL: [-0.28, 0, -0.5],
    },
  },
  { t: 1, pose: {} },
];

/**
 * SPIN — a full revolution into a wide horizontal cut. The hips carry a
 * complete turn, ending on 2π so the pose unwinds to identity instead of
 * counter-spinning back.
 */
export const SPIN: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.18,
    pose: {
      hips: [0, 0.75, 0],
      spine: [-0.12, 0.5, 0],
      chest: [-0.1, 0.4, 0],
      head: [0.05, -0.5, 0],
      armR: [-0.35, 0.3, -1.15],
      forearmR: [0, 0, -0.8],
      armL: [0.3, 0, 0.8],
      upLegR: [-0.26, 0, 0],
    },
  },
  {
    t: 0.4,
    pose: {
      hips: [0.05, -1.9, 0],
      spine: [0.16, -0.7, 0],
      chest: [0.14, -0.5, 0],
      upperChest: [0.06, -0.32, 0],
      head: [-0.1, 0.5, 0],
      shoulderR: [0, 0, 0.5],
      armR: [0.3, -0.3, 1.5],
      forearmR: [0, 0, -0.1],
      armL: [-0.2, 0, -1.1],
      upLegR: [0.22, 0, 0],
      upLegL: [-0.3, 0, 0],
    },
  },
  {
    t: 0.62,
    pose: {
      hips: [0, -4.5, 0],
      spine: [0.1, -0.4, 0],
      chest: [0.08, -0.3, 0],
      armR: [0.15, -0.2, 1.55],
      armL: [-0.15, 0, -0.9],
      upLegL: [0.24, 0, 0],
      upLegR: [-0.2, 0, 0],
    },
  },
  {
    t: 1,
    pose: {
      hips: [0, -6.2832, 0],
    },
  },
];

/**
 * CLEAVE — a two-handed overhead chop with a short hop into it. The heaviest
 * move in the set, and the one the reel saves for the last blow of a wave.
 */
export const CLEAVE: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.26,
    pose: {
      hips: [-0.2, 0.16, 0],
      spine: [-0.28, 0.14, 0],
      chest: [-0.22, 0.12, 0],
      head: [-0.3, -0.1, 0],
      shoulderR: [0, 0, -0.55],
      shoulderL: [0, 0, 0.55],
      armR: [-2.3, 0.15, -0.35],
      forearmR: [0, 0, -0.55],
      armL: [-2.2, -0.15, 0.35],
      forearmL: [0, 0, 0.55],
      upLegR: [0.24, 0, 0],
      upLegL: [0.24, 0, 0],
    },
  },
  {
    t: 0.46,
    pose: {
      hips: [0.5, -0.1, 0],
      spine: [0.5, -0.08, 0],
      chest: [0.4, -0.06, 0],
      upperChest: [0.26, 0, 0],
      head: [0.42, 0.06, 0],
      shoulderR: [0, 0, 0.2],
      armR: [0.85, 0.1, -0.15],
      forearmR: [0, 0, -0.2],
      armL: [0.8, -0.1, 0.15],
      forearmL: [0, 0, 0.2],
      upLegR: [-0.55, 0, 0],
      legR: [0.7, 0, 0],
      upLegL: [-0.3, 0, 0],
      legL: [0.5, 0, 0],
    },
  },
  {
    t: 0.68,
    pose: {
      hips: [0.34, -0.08, 0],
      spine: [0.34, -0.06, 0],
      head: [0.28, 0.04, 0],
      armR: [0.6, 0.08, -0.1],
      armL: [0.55, -0.08, 0.1],
      upLegR: [-0.34, 0, 0],
      upLegL: [-0.2, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** THRUST — a straight lunging stab. Tiny windup, enormous reach. */
export const THRUST: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.18,
    pose: {
      hips: [0, 0.5, 0],
      spine: [-0.08, 0.4, 0],
      chest: [-0.06, 0.34, 0],
      head: [0, -0.36, 0],
      armR: [-0.3, 0.5, -0.5],
      forearmR: [0, 0, -1.6],
      armL: [0.2, 0, 0.4],
      upLegR: [-0.3, 0, 0],
      legR: [0.35, 0, 0],
    },
  },
  {
    t: 0.38,
    pose: {
      hips: [0.14, -0.44, 0],
      spine: [0.2, -0.34, 0],
      chest: [0.18, -0.28, 0],
      upperChest: [0.12, -0.2, 0],
      head: [-0.06, 0.16, 0],
      shoulderR: [0, 0, 0.25],
      armR: [1.05, -0.15, 0.35],
      forearmR: [0, 0, -0.05],
      armL: [-0.5, 0, -0.9],
      upLegR: [0.5, 0, 0],
      upLegL: [-0.55, 0, 0],
      legL: [0.62, 0, 0],
    },
  },
  {
    t: 0.6,
    pose: {
      hips: [0.1, -0.34, 0],
      spine: [0.14, -0.26, 0],
      armR: [0.9, -0.12, 0.3],
      armL: [-0.35, 0, -0.6],
      upLegR: [0.34, 0, 0],
      upLegL: [-0.36, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** ROUNDHOUSE — a pivoting high kick, so the set is not all blade work. */
export const ROUNDHOUSE: Keyframe[] = [
  { t: 0, pose: {} },
  {
    t: 0.2,
    pose: {
      hips: [0, 0.55, 0],
      spine: [-0.14, 0.4, 0],
      chest: [-0.12, 0.32, 0],
      head: [0.06, -0.4, 0],
      armR: [-0.4, 0, -0.9],
      armL: [-0.3, 0, 0.9],
      upLegR: [-0.55, 0, -0.25],
      legR: [1.0, 0, 0],
      upLegL: [0.16, 0, 0],
    },
  },
  {
    t: 0.42,
    pose: {
      hips: [0.1, -0.8, 0.2],
      spine: [0.1, -0.6, -0.16],
      chest: [0.08, -0.5, -0.12],
      upperChest: [0.04, -0.34, 0],
      head: [-0.12, 0.42, 0],
      armR: [-0.9, 0, -1.5],
      armL: [0.6, 0, 1.3],
      upLegR: [-0.15, 0, -1.35],
      legR: [0.22, 0, 0],
      footR: [0.3, 0, 0],
      upLegL: [0.1, 0, 0.12],
    },
  },
  {
    t: 0.64,
    pose: {
      hips: [0.06, -1.05, 0.12],
      spine: [0.08, -0.7, -0.1],
      head: [-0.08, 0.4, 0],
      armR: [-0.6, 0, -1.1],
      armL: [0.4, 0, 0.9],
      upLegR: [-0.35, 0, -0.7],
      legR: [0.7, 0, 0],
    },
  },
  { t: 1, pose: {} },
];

/** Samples a keyframe track into `out`, returning it. */
export function sample(track: readonly Keyframe[], t: number, out: Pose): Pose {
  for (const key of Object.keys(out) as Array<keyof Pose>) delete out[key];

  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  let i = 0;
  while (i < track.length - 2 && track[i + 1].t < clamped) i++;

  const previous = track[i - 1];
  const a = track[i];
  const b = track[i + 1] ?? a;
  const next = track[i + 2];
  const span = b.t - a.t;
  const local = span > 1e-6 ? (clamped - a.t) / span : 0;

  const keys = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]) as Set<keyof Pose>;
  for (const key of keys) {
    const vp = previous?.pose[key] ?? ZERO;
    const va = a.pose[key] ?? ZERO;
    const vb = b.pose[key] ?? ZERO;
    const vn = next?.pose[key] ?? ZERO;
    out[key] = [
      cubicMotion(vp[0], va[0], vb[0], vn[0], previous?.t ?? a.t, a.t, b.t, next?.t ?? b.t, local, !!previous, !!next),
      cubicMotion(vp[1], va[1], vb[1], vn[1], previous?.t ?? a.t, a.t, b.t, next?.t ?? b.t, local, !!previous, !!next),
      cubicMotion(vp[2], va[2], vb[2], vn[2], previous?.t ?? a.t, a.t, b.t, next?.t ?? b.t, local, !!previous, !!next),
    ];
  }
  return out;
}

const ZERO = [0, 0, 0] as const;
