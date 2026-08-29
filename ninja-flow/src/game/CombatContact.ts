import { CONTACT } from '../config';
import type { BoneKey } from './Rig';
import type { Move } from './MoveLibrary';
import type { ReactionKind } from './EnemyMoves';

export interface ContactProfile {
  /** Bone whose animated world position represents the striking body part. */
  effector: BoneKey;
  /** Enemy-local height at which this move should land. */
  targetHeight: number;
  /** Extra reach from bone origin to heel, knuckles, or blade sweet spot. */
  reach: number;
  /** Relative effective mass transferred by this technique. */
  mass: number;
  /** Horizontal and vertical response shaping after measured velocity. */
  push: number;
  lift: number;
  depth: number;
  spin: number;
  reaction: ReactionKind;
}

export interface ContactSample {
  point: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export interface ContactImpulse {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
  recoil: { x: number; y: number; z: number };
  energy: number;
}

const BLADE: ContactProfile = {
  effector: 'handR',
  targetHeight: 1.02,
  reach: 0.38,
  mass: 0.72,
  push: 0.86,
  lift: 0.28,
  depth: -0.12,
  spin: 0.8,
  reaction: 'launch',
};

const PROFILES: Readonly<Record<string, ContactProfile>> = {
  hiltBash: { ...BLADE, reach: 0.13, mass: 1, push: 0.72, lift: 0.12, spin: 0.25, reaction: 'stagger' },
  thrust: { ...BLADE, reach: 0.54, mass: 0.86, push: 1.08, lift: 0.18, spin: 0.25 },
  rising: { ...BLADE, targetHeight: 0.88, lift: 0.78, spin: 0.45, reaction: 'juggle' },
  cleave: { ...BLADE, targetHeight: 1.15, mass: 1.2, push: 0.62, lift: -0.45, spin: 1.15, reaction: 'slam' },
  spin: { ...BLADE, mass: 0.92, push: 1.05, depth: -0.35, spin: 1.65, reaction: 'spinOut' },
  lowSweep: {
    effector: 'footR', targetHeight: 0.42, reach: 0.1, mass: 1.05,
    push: 0.88, lift: 0.22, depth: -0.08, spin: 1.7, reaction: 'spinOut',
  },
  frontKick: {
    effector: 'footR', targetHeight: 0.9, reach: 0.12, mass: 1.08,
    push: 1.08, lift: 0.24, depth: 0, spin: 0.45, reaction: 'launch',
  },
  kneeStrike: {
    effector: 'legR', targetHeight: 0.82, reach: 0.08, mass: 1.18,
    push: 0.78, lift: 0.7, depth: -0.05, spin: 0.35, reaction: 'juggle',
  },
  sideKick: {
    effector: 'footR', targetHeight: 0.95, reach: 0.13, mass: 1.22,
    push: 1.16, lift: 0.26, depth: -0.08, spin: 0.7, reaction: 'launch',
  },
  roundhouse: {
    effector: 'footR', targetHeight: 1.14, reach: 0.13, mass: 1.12,
    push: 1.02, lift: 0.38, depth: -0.3, spin: 1.6, reaction: 'spinOut',
  },
  axeKick: {
    effector: 'footR', targetHeight: 1.12, reach: 0.13, mass: 1.3,
    push: 0.58, lift: -0.5, depth: 0, spin: 1.1, reaction: 'slam',
  },
  crescentKick: {
    effector: 'footR', targetHeight: 1.16, reach: 0.13, mass: 1.02,
    push: 0.9, lift: 0.42, depth: -0.22, spin: 1.5, reaction: 'spinOut',
  },
  spinningHookKick: {
    effector: 'footR', targetHeight: 1.18, reach: 0.14, mass: 1.24,
    push: 1.18, lift: 0.38, depth: -0.38, spin: 2.1, reaction: 'spinOut',
  },
  jumpSpinKick: {
    effector: 'footR', targetHeight: 1.16, reach: 0.14, mass: 1.3,
    push: 1.24, lift: 0.58, depth: -0.32, spin: 2.25, reaction: 'spinOut',
  },
};

export function contactProfileFor(move: Move): ContactProfile {
  return PROFILES[move.id] ?? BLADE;
}

/**
 * Resolves a stylised rigid-body impulse from the measured striking velocity.
 * Momentum direction comes from the attacker/target relationship, magnitude
 * comes from the animated effector, and torque comes from contact height.
 */
export function solveContactImpulse(
  profile: ContactProfile,
  sample: ContactSample,
  attackerX: number,
  targetX: number,
  power: number,
): ContactImpulse {
  const away = Math.sign(targetX - attackerX) || 1;
  const measured = Math.sqrt(
    sample.velocity.x * sample.velocity.x +
    sample.velocity.y * sample.velocity.y +
    sample.velocity.z * sample.velocity.z,
  );
  const speed = clamp(measured, CONTACT.minEffectorSpeed, CONTACT.maxEffectorSpeed);
  const energy = speed * profile.mass * Math.max(0.1, power);
  const horizontal = clamp((2.8 + energy * 0.48) * profile.push, 2.2, 13.5);
  const verticalVelocity = clamp(sample.velocity.y, -8, 8);
  const linear = {
    x: away * horizontal,
    y: clamp(profile.lift * 5.2 + Math.max(0, verticalVelocity) * 0.16 + energy * 0.045, -5.5, 9),
    z: clamp(profile.depth * 4 + sample.velocity.z * 0.1, -4.5, 4.5),
  };
  // In screen plane, r × J makes a high hit rotate the body away from the
  // point of impact. Profile spin preserves authored technique differences.
  const leverY = sample.point.y - 0.72;
  const torqueZ = clamp(-leverY * linear.x * 1.15 + away * profile.spin * 2.2, -18, 18);
  const angular = {
    x: clamp(linear.z * -0.75 + profile.spin * 0.45, -8, 8),
    y: clamp(away * profile.spin * 0.7, -6, 6),
    z: torqueZ,
  };
  const inversePlayerMass = 1 / CONTACT.playerMassRatio;
  return {
    linear,
    angular,
    recoil: {
      x: -linear.x * inversePlayerMass,
      y: -linear.y * inversePlayerMass,
      z: -linear.z * inversePlayerMass,
    },
    energy,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
