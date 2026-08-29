import { cubicMotion } from './MotionSpline';

/**
 * The enemy's move library.
 *
 * Enemies are procedural chibi bodies rather than skinned rigs, so their
 * animation is authored against the handful of parts they actually have. Two
 * sets live here:
 *
 *   ATTACKS   — played across the telegraph window, authored so t=0 is the
 *               first frame of the windup and t=1 is the instant the blow
 *               lands. Whatever move a body happens to be playing, the read is
 *               identical: the strike peaks exactly on its impact time.
 *   REACTIONS — how a body leaves the fight when it is hit. The reel picks
 *               these to match the hero's move, so a slide gets an enemy
 *               flipped overhead and a slam drives one into the floor.
 */

export interface EnemyPose {
  /** Root rotation [pitch, yaw, roll]; yaw and roll mirror with the side. */
  root?: readonly [number, number, number];
  /** Root offset [forward, up, lateral] in metres; forward mirrors. */
  offset?: readonly [number, number, number];
  head?: readonly [number, number, number];
  /** Weapon arm. */
  armR?: readonly [number, number, number];
  armL?: readonly [number, number, number];
  legR?: readonly [number, number, number];
  legL?: readonly [number, number, number];
  scarf?: readonly [number, number, number];
  tail?: readonly [number, number, number];
}

export interface EnemyKey {
  t: number;
  pose: EnemyPose;
}

export interface EnemyAttack {
  readonly id: string;
  readonly track: readonly EnemyKey[];
  /** Normalised telegraph time the weapon leaves the hand, if it is thrown. */
  readonly throwAt?: number;
}

/** OVERHEAD — the blade goes up over the head and comes down. */
const CHOP: EnemyKey[] = [
  { t: 0, pose: { armR: [-0.35, 0, 0] } },
  { t: 0.55, pose: { armR: [-1.6, 0, -0.35], root: [-0.16, 0, 0], head: [0.16, 0, 0] } },
  { t: 1, pose: { armR: [-2.55, 0, -0.5], root: [-0.24, 0, 0], head: [0.24, 0, 0], scarf: [-0.7, 0, 0] } },
];

/** SIDE CUT — coiled across the body, then whipped through flat. */
const SIDE_CUT: EnemyKey[] = [
  { t: 0, pose: { armR: [-0.35, 0, 0] } },
  {
    t: 0.6,
    pose: {
      armR: [-0.9, 0, -1.1],
      armL: [0.5, 0, 0],
      root: [0, 0.42, 0.1],
      head: [0, 0, -0.16],
    },
  },
  {
    t: 1,
    pose: {
      armR: [-1.2, 0, -2.0],
      armL: [0.8, 0, 0],
      root: [0, 0.62, 0.2],
      head: [0, 0, -0.28],
      scarf: [-0.5, 0, 0],
    },
  },
];

/** LUNGE — weight pulled back, then the whole body behind a thrust. */
const LUNGE: EnemyKey[] = [
  { t: 0, pose: { armR: [-0.35, 0, 0] } },
  {
    t: 0.6,
    pose: {
      armR: [-0.2, 0, 0.2],
      offset: [-0.18, 0, 0],
      root: [0.2, 0, 0],
      legR: [0.4, 0, 0],
      head: [-0.12, 0, 0],
    },
  },
  {
    t: 1,
    pose: {
      armR: [-1.9, 0, 0.15],
      offset: [0.34, -0.06, 0],
      root: [0.34, 0, 0],
      legR: [-0.5, 0, 0],
      legL: [0.7, 0, 0],
      head: [-0.2, 0, 0],
      scarf: [-0.8, 0, 0],
    },
  },
];

/** LEAP — a hop into a falling strike. */
const LEAP_STRIKE: EnemyKey[] = [
  { t: 0, pose: { armR: [-0.35, 0, 0] } },
  {
    t: 0.42,
    pose: {
      armR: [-1.3, 0, -0.2],
      offset: [0, 0.12, 0],
      legR: [0.9, 0, 0],
      legL: [0.9, 0, 0],
      root: [0.24, 0, 0],
    },
  },
  {
    t: 0.72,
    pose: {
      armR: [-2.3, 0, -0.3],
      offset: [0.1, 0.62, 0],
      legR: [0.5, 0, 0],
      legL: [0.7, 0, 0],
      root: [-0.2, 0, 0],
      scarf: [-1.1, 0, 0],
    },
  },
  {
    t: 1,
    pose: {
      armR: [-2.7, 0, -0.4],
      offset: [0.2, 0, 0],
      legR: [-0.4, 0, 0],
      legL: [-0.2, 0, 0],
      root: [-0.3, 0, 0],
      scarf: [-0.5, 0, 0],
    },
  },
];

/** SPIN — a full turn carrying the blade around. */
const SPIN_CUT: EnemyKey[] = [
  { t: 0, pose: { armR: [-0.35, 0, 0] } },
  { t: 0.5, pose: { armR: [-0.8, 0, -1.4], root: [0, -2.2, 0], tail: [0, 0.5, 0] } },
  {
    t: 1,
    pose: {
      armR: [-1.0, 0, -1.9],
      root: [0, -6.2832, 0],
      head: [0, 0, -0.2],
      scarf: [-0.6, 0, 0],
    },
  },
];

/** SHURIKEN — the arm cocks back and the star leaves the hand. */
const SHURIKEN: EnemyKey[] = [
  { t: 0, pose: { armR: [-0.35, 0, 0] } },
  {
    t: 0.62,
    pose: {
      armR: [-2.1, 0, 0.5],
      root: [0, 0.5, 0],
      head: [0, 0.16, 0],
      offset: [-0.1, 0, 0],
    },
  },
  {
    t: 0.82,
    pose: {
      armR: [-0.5, 0, -0.4],
      root: [0, -0.3, 0],
      offset: [0.08, 0, 0],
      scarf: [-0.9, 0, 0],
    },
  },
  { t: 1, pose: { armR: [-0.3, 0, -0.2], root: [0, -0.2, 0] } },
];

/** SWEEP — drops low and takes the ankles. */
const SWEEP: EnemyKey[] = [
  { t: 0, pose: { armR: [-0.35, 0, 0] } },
  {
    t: 0.6,
    pose: {
      armR: [-0.6, 0, -0.5],
      offset: [0, -0.14, 0],
      root: [0.3, 0.2, 0],
      legR: [0.8, 0, 0],
      legL: [0.4, 0, 0],
    },
  },
  {
    t: 1,
    pose: {
      armR: [-0.9, 0, -1.6],
      offset: [0.16, -0.2, 0],
      root: [0.42, 0.5, 0],
      legR: [0.2, 0, 0],
      legL: [1.1, 0, 0],
      head: [-0.2, 0, 0],
    },
  },
];

/** DOUBLE — a fast one-two, the second arriving on the beat. */
const DOUBLE_SLASH: EnemyKey[] = [
  { t: 0, pose: { armR: [-0.35, 0, 0] } },
  { t: 0.34, pose: { armR: [-1.5, 0, -0.6], root: [0, 0.3, 0] } },
  { t: 0.52, pose: { armR: [-0.6, 0, -1.4], root: [0, -0.2, 0], scarf: [-0.6, 0, 0] } },
  { t: 0.76, pose: { armR: [-1.8, 0, 0.3], root: [0, 0.36, 0] } },
  {
    t: 1,
    pose: {
      armR: [-0.8, 0, -1.9],
      root: [0, -0.34, 0],
      head: [0, 0, -0.2],
      scarf: [-0.8, 0, 0],
    },
  },
];

export const ENEMY_ATTACKS: readonly EnemyAttack[] = [
  { id: 'chop', track: CHOP },
  { id: 'sideCut', track: SIDE_CUT },
  { id: 'lunge', track: LUNGE },
  { id: 'leapStrike', track: LEAP_STRIKE },
  { id: 'spinCut', track: SPIN_CUT },
  { id: 'sweep', track: SWEEP },
  { id: 'doubleSlash', track: DOUBLE_SLASH },
  { id: 'shuriken', track: SHURIKEN, throwAt: 0.72 },
];

/** Attacks that read cleanly in live combat — no thrown steel, no leaps. */
export const COMBAT_ATTACK_IDS = ['chop', 'sideCut', 'lunge', 'spinCut', 'sweep', 'doubleSlash'];

// ------------------------------------------------------------- reactions

export type ReactionKind =
  | 'launch'
  | 'juggle'
  | 'slam'
  | 'spinOut'
  | 'stagger'
  | 'flipOver'
  | 'blowAway'
  | 'kneel';

export interface Reaction {
  /** Velocity away from the hero, in metres per second. */
  out: number;
  up: number;
  /** Depth velocity — positive pushes into the background. */
  depth: number;
  spin: number;
  /** Multiplies the despawn time, so a juggle hangs and a slam is over fast. */
  linger: number;
  /** Set when the body is thrown back OVER the hero rather than away. */
  overhead?: boolean;
  /** Gravity multiplier — a slam is driven down harder than it was thrown up. */
  gravity?: number;
}

export const REACTIONS: Record<ReactionKind, Reaction> = {
  // The workhorse: clean knockback away from the blade.
  launch: { out: 1, up: 0.62, depth: -0.18, spin: 1, linger: 1 },
  // Popped straight up and left hanging for the next blow to catch.
  juggle: { out: 0.25, up: 1.15, depth: -0.05, spin: 0.5, linger: 1.35, gravity: 0.55 },
  // Driven into the floor — short, heavy, over immediately.
  slam: { out: 0.4, up: -0.9, depth: 0, spin: 1.6, linger: 0.55, gravity: 2.4 },
  // Spun off sideways into the wings.
  spinOut: { out: 1.25, up: 0.35, depth: -0.75, spin: 2.8, linger: 1.1 },
  // A glancing hit: rocked back, barely lifted.
  stagger: { out: 0.5, up: 0.18, depth: 0, spin: 0.25, linger: 0.8 },
  // Thrown back over the hero's head — the slide-under payoff.
  flipOver: { out: 1.15, up: 1.25, depth: 0.1, spin: 3.4, linger: 1.25, overhead: true },
  // The finisher: sent out of frame.
  blowAway: { out: 2.1, up: 0.95, depth: -0.5, spin: 2.2, linger: 1.4 },
  // Folds where it stands.
  kneel: { out: 0.15, up: 0.05, depth: 0, spin: 0.2, linger: 0.9, gravity: 1.6 },
};

/** Samples an enemy track into `out`, easing between keys as poses do. */
export function sampleEnemy(track: readonly EnemyKey[], t: number, out: EnemyPose): EnemyPose {
  for (const key of Object.keys(out) as Array<keyof EnemyPose>) delete out[key];

  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  let i = 0;
  while (i < track.length - 2 && track[i + 1].t < clamped) i++;
  const previous = track[i - 1];
  const a = track[i];
  const b = track[i + 1] ?? a;
  const next = track[i + 2];
  const span = b.t - a.t;
  const local = span > 1e-6 ? (clamped - a.t) / span : 0;

  const keys = new Set([
    ...Object.keys(a.pose),
    ...Object.keys(b.pose),
  ]) as Set<keyof EnemyPose>;
  for (const key of keys) {
    const vp = previous?.pose[key] ?? ZERO;
    const va = a.pose[key] ?? ZERO;
    const vb = b.pose[key] ?? ZERO;
    const vn = next?.pose[key] ?? ZERO;
    out[key] = [
      cubicMotion(vp[0], va[0], vb[0], vn[0], previous?.t ?? a.t, a.t, b.t, next?.t ?? b.t, local, !!previous, !!next, 'moving'),
      cubicMotion(vp[1], va[1], vb[1], vn[1], previous?.t ?? a.t, a.t, b.t, next?.t ?? b.t, local, !!previous, !!next, 'moving'),
      cubicMotion(vp[2], va[2], vb[2], vn[2], previous?.t ?? a.t, a.t, b.t, next?.t ?? b.t, local, !!previous, !!next, 'moving'),
    ];
  }
  return out;
}

const ZERO = [0, 0, 0] as const;
