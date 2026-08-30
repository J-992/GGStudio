import * as THREE from 'three';
import type { CatBoneName } from './CatRig';

/**
 * Hand-authored animation for the biped kitty rig.
 *
 * The source model ships no clips at all (see CatRig), so every pose here is
 * written as joint angles rather than imported. Keeping them as code has one
 * concrete advantage over a binary: the gait is *parameterised*, so the left
 * and right legs - and the arms that counter-swing them - come from one curve
 * sampled at two phases instead of four hand-keyed limbs that drift out of
 * sync the moment any one of them is edited.
 *
 * Conventions, all of which follow from the rig's bind pose having no rotation
 * anywhere:
 *
 *   - A limb joint's local +X rotation swings the limb **backwards**, because
 *     every chain (arms and legs) hangs along -Y in the bind pose, and rotating
 *     about X carries -Y toward -Z.
 *   - `spine`/`chest` +X pitches the front of the body **up**; negative rounds
 *     it forward (the hunch of an absorbed landing).
 *   - `ear` +X tips the ear **forward**; running pins them back.
 *   - The `root` joint is pinned to the geometry origin, so a position track on
 *     it is a pure offset and can bob the whole cat without any clip needing to
 *     know the model's size.
 *
 * The tail is deliberately absent from every clip: `Cat.update()` writes the
 * tail chain directly after the mixer has run, so a tail track here would be
 * computed and then thrown away every frame.
 */

export const CAT_CLIP_NAMES = [
  'idle',
  'run',
  'jump',
  'fall',
  'land',
  'stumble',
  'slide',
  'eat',
] as const;
export type CatClipName = (typeof CAT_CLIP_NAMES)[number];

/** Euler angles in radians, XYZ order. */
type Angles = readonly [number, number, number];
/** One angle per sample time. */
type Curve = readonly Angles[];

// ---------------------------------------------------------------------------
// The run cycle
// ---------------------------------------------------------------------------

/**
 * Nine samples spanning one full stride, first and last identical so the cycle
 * closes. Unlike the quadruped's bound, a biped run is strictly alternating:
 * the right leg is the left leg's curve read exactly half a cycle later (see
 * `LEG_LEAD_OFFSET`), which is also true of real bipedal gaits and is why the
 * curves below are authored for one leg and mirrored rather than hand-keyed
 * twice.
 */
const STRIDE_CONTROLS = 9;

/**
 * How many keys the run cycle is actually baked to.
 *
 * The curves below are authored at {@link STRIDE_CONTROLS} control points and
 * then resampled up to this before they become tracks. That indirection exists
 * because three.js interpolates a `QuaternionKeyframeTrack` **linearly** and
 * offers no alternative - `setInterpolation(InterpolateSmooth)` is rejected for
 * quaternion tracks, which fall back to slerp with a warning. Nine linearly
 * blended keys are C0 but not C1: the pose's angular velocity jumps at every
 * key, and at a stride every third of a second that reads as vibration rather
 * than as running.
 *
 * Densifying is the only way to get a smooth curve past a linear interpolator,
 * so the spline is evaluated here and the mixer is handed something fine enough
 * that its own linear segments are invisible. 33 is four subdivisions per
 * authored control point, which puts the worst chord error below a
 * milliradian - far under what a 1-unit-tall cat can show.
 */
const STRIDE_SAMPLES = 33;
const stridePhase = Array.from({ length: STRIDE_SAMPLES }, (_, i) => i / (STRIDE_SAMPLES - 1));

/**
 * One leg's cycle: toe-off, swing through with the knee folded to clear the
 * ground, reach, plant, and drive back under the body.
 */
const THIGH = [0.75, 0.55, 0.15, -0.35, -0.7, -0.55, -0.15, 0.35, 0.75];
/** Knee fold - sharpest right after toe-off, nearly straight through stance. */
const SHIN = [0.3, 1.0, 0.6, 0.2, 0.0, 0.05, 0.1, 0.2, 0.3];
/**
 * Ankle.
 *
 * Rotations about X compose additively down the leg, so the sole's pitch in
 * world space is `THIGH + SHIN + FOOT`, and the sole is parallel to the roof
 * exactly when `FOOT = -(THIGH + SHIN)`. Keys 4-7 are the stance phase, where
 * that has to hold: the foot joint sits at the heel and the toe is 0.24 ahead
 * of it, so every 0.1 rad of error there drives the toe 0.024 into the roof.
 *
 * The raw `-(THIGH + SHIN)` runs to -1.55 rad at key 1, which no ankle does,
 * so the curve is that expression clamped to a plausible -0.6..0.7. The clamp
 * only ever bites during the swing (keys 0-3), where the knee is folded and
 * the foot is high enough that its pitch does not matter. Key 8 is toe-off,
 * where the leftover 0.45 of toes-down is wanted: the toe is the pivot there.
 *
 * Sign convention, which is easy to get backwards: +X is toes *down*. A toe
 * vertex sits at +Z relative to this joint, and rotating +Z about +X carries it
 * to -Y.
 */
const FOOT = [-0.6, -0.6, -0.6, 0.15, 0.7, 0.5, 0.05, -0.55, -0.6];

/** How far the right leg trails the left, in strides - an exact half-cycle. */
const LEG_LEAD_OFFSET = 0.5;

/**
 * Arms counter-swing the *opposite* leg (left arm tracks the right leg's
 * phase), which is what reads as a run rather than a shuffle. Reusing the leg
 * curves at a phase offset - rather than hand-keying the arms separately -
 * is what keeps the four limbs from ever drifting out of sync with each other.
 */
const ARM_LEAD_OFFSET = 0.5;
/** Arms swing through a shallower arc than legs; hands stay looser than feet. */
const UPPER_ARM_SCALE = 0.55;
const LOWER_ARM_SCALE = 0.4;
/** Elbow bend, folding as the arm swings back - shin's shape, gentled down. */
const LOWER_ARM_BASE = 0.3;

/** Spine/chest counter-rotation: the torso twists opposite the hips, once a stride. */
const HIP_TWIST = [0.0, 0.08, 0.14, 0.08, 0.0, -0.08, -0.14, -0.08, 0.0];
const CHEST_TWIST = HIP_TWIST.map((v) => -v * 0.7);
/** Forward lean and a touch of spinal counter-flex against the leg drive. */
const SPINE_FLEX = [0.1, 0.14, 0.1, 0.02, -0.04, 0.0, 0.06, 0.12, 0.1];
const HEAD_STEADY = [-0.02, 0.0, 0.02, 0.0, -0.02, 0.0, 0.02, 0.0, -0.02];
/**
 * Vertical offset of the whole body through the run cycle. Constant.
 *
 * Measured, not authored. The procedure: pose the real mesh at each stride
 * sample, take the lowest *vertex* (not the lowest joint - the foot mesh wraps
 * around its joint, so joint height cannot see the toe going through the roof),
 * subtract the root's own translation to get the body's height requirement
 * independent of this curve, and find what lift each sample needs to put that
 * lowest vertex on the bind-pose floor. A uniform +0.008 is included because
 * the mixer interpolates between keys and foot height is not linear in the
 * joint angles: sampling at 240 points found the worst in-between frame sitting
 * 0.008 below what the keys either side predicted.
 *
 * That produced a per-footfall curve - `0.012, 0.023, 0.014, 0.019, …` - which
 * is where the constant comes from: it is that curve's **maximum**. The curve
 * itself zigzagged, four peaks per stride, and once resampled onto 33 keys it
 * became a continuous ~13 Hz vertical oscillation of the entire cat. Smooth,
 * and still unmistakably a vibration.
 *
 * Holding the maximum is safe by construction rather than by measurement:
 * every sample gets at least the clearance it was measured to need, so no foot
 * can reach the floor. The cost is up to 0.011 of extra hover on the samples
 * that needed less, against the 0.06 budget the floor-contact regression in
 * tests/catrig.test.ts enforces.
 *
 * The values are small - a 0.011 spread on a 1.0-tall cat - because the ankle
 * holds the sole flat through stance (see FOOT). They were an order of
 * magnitude larger, and negative, while the heel was mis-weighted to the shin
 * and the foot was pivoting through the ground.
 */
const ROOT_RISE_HEIGHT = 0.023;

// ---------------------------------------------------------------------------
// Clip construction
// ---------------------------------------------------------------------------

/** Builds every clip the cat can play. */
export function buildCatClips(): THREE.AnimationClip[] {
  return [
    buildIdle(),
    buildRun(),
    buildJump(),
    buildFall(),
    buildLand(),
    buildStumble(),
    buildSlide(),
    buildEat(),
  ];
}

function buildRun(): THREE.AnimationClip {
  const duration = 0.4;
  const times = stridePhase.map((p) => p * duration);

  const curves: Partial<Record<CatBoneName, Curve>> = {
    hips: yawCurve(resample(HIP_TWIST)),
    spine: pitchCurve(resample(SPINE_FLEX)),
    chest: yawCurve(resample(CHEST_TWIST)),
    head: pitchCurve(resample(HEAD_STEADY)),
    // Pinned back and fluttering at twice stride rate - sells the speed more
    // than any amount of limb motion.
    earL: earCurve(-1),
    earR: earCurve(1),
  };

  for (const side of ['L', 'R'] as const) {
    const legPhase = side === 'R' ? LEG_LEAD_OFFSET : 0;
    // The arm on this side tracks the *other* leg's phase.
    const armPhase = side === 'R' ? 0 : ARM_LEAD_OFFSET;

    Object.assign(curves, {
      [`thigh${side}`]: strideCurve(THIGH, legPhase),
      [`shin${side}`]: strideCurve(SHIN, legPhase),
      [`foot${side}`]: strideCurve(FOOT, legPhase),
      // No extra sign flip needed: `armPhase` already samples THIGH at the
      // *opposite* leg's phase, which is itself already the negation of this
      // leg's own curve (see LEG_LEAD_OFFSET), so this already swings back
      // when the same-side leg swings forward.
      [`shoulder${side}`]: pitchCurve(
        shift(resample(THIGH), armPhase).map((v) => v * UPPER_ARM_SCALE),
      ),
      [`upperArm${side}`]: pitchCurve(
        shift(resample(THIGH), armPhase).map((v) => v * UPPER_ARM_SCALE),
      ),
      [`lowerArm${side}`]: pitchCurve(
        shift(resample(SHIN), armPhase).map((v) => LOWER_ARM_BASE + v * LOWER_ARM_SCALE),
      ),
    });
  }

  const tracks = rotationTracks(times, curves);
  tracks.push(riseTrack(times, times.map(() => ROOT_RISE_HEIGHT)));
  return new THREE.AnimationClip('run', duration, tracks);
}

function buildIdle(): THREE.AnimationClip {
  const duration = 2.6;
  const times = [0, 0.65, 1.3, 1.95, 2.6];

  // Breathing, plus one ear flick a cycle. Everything else holds still: an idle
  // that sways the limbs reads as a cat that cannot stand up straight.
  const breathe = [0, 0.022, 0.032, 0.022, 0];
  const curves: Partial<Record<CatBoneName, Curve>> = {
    spine: pitchCurve(breathe),
    chest: pitchCurve(breathe.map((v) => v * 0.7)),
    neck: pitchCurve(breathe.map((v) => -v * 1.2)),
    head: [
      [0.0, 0.0, 0.0],
      [0.02, 0.12, 0.0],
      [0.0, 0.05, 0.0],
      [-0.02, -0.14, 0.0],
      [0.0, 0.0, 0.0],
    ],
    earL: [
      [0.0, 0.0, 0.0],
      [0.0, 0.0, 0.0],
      [0.34, 0.0, -0.22],
      [0.0, 0.0, 0.0],
      [0.0, 0.0, 0.0],
    ],
    earR: [
      [0.0, 0.0, 0.0],
      [0.06, 0.0, 0.05],
      [0.0, 0.0, 0.0],
      [0.06, 0.0, 0.05],
      [0.0, 0.0, 0.0],
    ],
    // A relaxed idle sway for the arms - small, so it does not read as run leakage.
    upperArmL: pitchCurve(breathe.map((v) => v * 0.5)),
    upperArmR: pitchCurve(breathe.map((v) => v * 0.5)),
  };

  return new THREE.AnimationClip('idle', duration, rotationTracks(times, curves));
}

function buildJump(): THREE.AnimationClip {
  const duration = 0.4;
  const times = [0, 0.1, 0.4];

  // Legs drive hard off the ground, then everything tucks: the tuck is what
  // makes the apex read as deliberate rather than as a cat that got thrown.
  const curves: Partial<Record<CatBoneName, Curve>> = {
    hips: pitchCurve([0.0, 0.14, -0.05]),
    spine: pitchCurve([0.0, 0.2, 0.08]),
    chest: pitchCurve([0.0, 0.12, 0.05]),
    neck: pitchCurve([0.0, -0.14, -0.1]),
    head: pitchCurve([0.0, -0.08, -0.06]),
    earL: earPose(-1, [0.0, -0.24, -0.3]),
    earR: earPose(1, [0.0, -0.24, -0.3]),
  };
  for (const side of ['L', 'R'] as const) {
    Object.assign(curves, {
      // Full extension on the drive, then folded up under the body.
      [`thigh${side}`]: pitchCurve([0.0, -0.75, 0.55]),
      [`shin${side}`]: pitchCurve([0.0, 0.15, 1.1]),
      [`foot${side}`]: pitchCurve([0.0, -0.5, 0.15]),
      // Arms swing up and back for lift, reaching a beat behind the legs.
      [`shoulder${side}`]: pitchCurve([0.0, 0.5, -0.3]),
      [`upperArm${side}`]: pitchCurve([0.0, 0.5, -0.3]),
      [`lowerArm${side}`]: pitchCurve([0.0, -0.3, 0.5]),
    });
  }

  const tracks = rotationTracks(times, curves);
  tracks.push(riseTrack(times, [0.0, 0.03, 0.0]));
  return new THREE.AnimationClip('jump', duration, tracks);
}

function buildFall(): THREE.AnimationClip {
  const duration = 0.9;
  const times = [0, 0.45, 0.9];

  // Legs tucked, arms out for balance, back hollow, head up scanning the
  // landing - the "cat about to land on its feet" silhouette.
  const curves: Partial<Record<CatBoneName, Curve>> = {
    hips: pitchCurve([-0.06, -0.1, -0.06]),
    spine: pitchCurve([0.14, 0.18, 0.14]),
    chest: pitchCurve([0.08, 0.11, 0.08]),
    neck: pitchCurve([-0.18, -0.22, -0.18]),
    head: pitchCurve([-0.12, -0.16, -0.12]),
    earL: earPose(-1, [-0.1, -0.16, -0.1]),
    earR: earPose(1, [-0.1, -0.16, -0.1]),
  };
  for (const side of ['L', 'R'] as const) {
    const spread = side === 'L' ? -1 : 1;
    Object.assign(curves, {
      [`thigh${side}`]: pitchCurve([-0.35, -0.4, -0.35]),
      [`shin${side}`]: pitchCurve([0.55, 0.62, 0.55]),
      [`foot${side}`]: pitchCurve([0.15, 0.2, 0.15]),
      // Arms out to the sides, elbows bent - the classic "bracing to land" pose.
      [`shoulder${side}`]: [
        [0.1, 0, spread * 0.7],
        [0.14, 0, spread * 0.8],
        [0.1, 0, spread * 0.7],
      ] as Curve,
      [`upperArm${side}`]: [
        [0.1, 0, spread * 0.7],
        [0.14, 0, spread * 0.8],
        [0.1, 0, spread * 0.7],
      ] as Curve,
      [`lowerArm${side}`]: pitchCurve([0.4, 0.46, 0.4]),
    });
  }

  return new THREE.AnimationClip('fall', duration, rotationTracks(times, curves));
}

function buildLand(): THREE.AnimationClip {
  const duration = 0.32;
  const times = [0, 0.08, 0.32];

  // Absorb through bent knees, then recover to neutral so whatever plays next
  // has nothing to undo.
  const curves: Partial<Record<CatBoneName, Curve>> = {
    hips: pitchCurve([0.0, 0.14, 0.0]),
    spine: pitchCurve([0.0, -0.2, 0.0]),
    chest: pitchCurve([0.0, -0.12, 0.0]),
    neck: pitchCurve([0.0, 0.18, 0.0]),
    head: pitchCurve([0.0, 0.12, 0.0]),
    earL: earPose(-1, [0.0, -0.3, 0.0]),
    earR: earPose(1, [0.0, -0.3, 0.0]),
  };
  for (const side of ['L', 'R'] as const) {
    Object.assign(curves, {
      [`thigh${side}`]: pitchCurve([0.0, -0.4, 0.0]),
      [`shin${side}`]: pitchCurve([0.0, 0.75, 0.0]),
      [`foot${side}`]: pitchCurve([0.0, -0.35, 0.0]),
      [`shoulder${side}`]: pitchCurve([0.0, 0.3, 0.0]),
      [`upperArm${side}`]: pitchCurve([0.0, 0.3, 0.0]),
      [`lowerArm${side}`]: pitchCurve([0.0, 0.35, 0.0]),
    });
  }

  const tracks = rotationTracks(times, curves);
  // Drops onto the feet and pushes back up.
  tracks.push(riseTrack(times, [0.0, -0.05, 0.0]));
  return new THREE.AnimationClip('land', duration, tracks);
}

function buildStumble(): THREE.AnimationClip {
  const duration = 0.55;
  const times = [0, 0.14, 0.28, 0.42, 0.55];

  // Deliberately asymmetric: a symmetric wobble reads as a bounce, not a trip.
  const curves: Partial<Record<CatBoneName, Curve>> = {
    hips: [
      [0.0, 0.0, 0.0],
      [0.1, -0.12, 0.14],
      [0.04, 0.1, -0.1],
      [0.1, -0.08, 0.12],
      [0.0, 0.0, 0.0],
    ],
    spine: [
      [0.0, 0.0, 0.0],
      [-0.16, 0.14, -0.12],
      [-0.06, -0.12, 0.1],
      [-0.14, 0.1, -0.1],
      [0.0, 0.0, 0.0],
    ],
    chest: pitchCurve([0.0, -0.1, -0.04, -0.08, 0.0]),
    neck: [
      [0.0, 0.0, 0.0],
      [0.22, -0.2, 0.16],
      [0.1, 0.18, -0.14],
      [0.18, -0.14, 0.12],
      [0.0, 0.0, 0.0],
    ],
    head: pitchCurve([0.0, 0.16, -0.06, 0.12, 0.0]),
    earL: earPose(-1, [0.0, -0.34, -0.2, -0.3, 0.0]),
    earR: earPose(1, [0.0, -0.2, -0.34, -0.24, 0.0]),
    thighL: pitchCurve([0.0, -0.55, -0.15, -0.4, 0.0]),
    shinL: pitchCurve([0.0, 0.85, 0.3, 0.65, 0.0]),
    footL: pitchCurve([0.0, -0.4, -0.15, -0.3, 0.0]),
    thighR: pitchCurve([0.0, -0.2, -0.5, -0.15, 0.0]),
    shinR: pitchCurve([0.0, 0.35, 0.75, 0.3, 0.0]),
    footR: pitchCurve([0.0, -0.15, -0.35, -0.12, 0.0]),
    shoulderL: pitchCurve([0.0, 0.4, 0.1, 0.3, 0.0]),
    upperArmL: pitchCurve([0.0, 0.4, 0.1, 0.3, 0.0]),
    lowerArmL: pitchCurve([0.0, 0.5, 0.2, 0.4, 0.0]),
    shoulderR: pitchCurve([0.0, 0.15, 0.45, 0.1, 0.0]),
    upperArmR: pitchCurve([0.0, 0.15, 0.45, 0.1, 0.0]),
    lowerArmR: pitchCurve([0.0, 0.25, 0.55, 0.2, 0.0]),
  };

  const tracks = rotationTracks(times, curves);
  tracks.push(riseTrack(times, [0.0, -0.03, -0.012, -0.025, 0.0]));
  return new THREE.AnimationClip('stumble', duration, tracks);
}

/**
 * The duck-slide, for the fallback rig only.
 *
 * The shipping cat takes its slide straight from `Cat_Animation_slide_right`;
 * this exists so that the degraded rig - the one with no imported clips at all -
 * still has a complete clip set, because `Cat.buildActions` switches the whole
 * state machine off the moment one name is missing. Without it, losing the FBX
 * download would cost the cat its run cycle too.
 *
 * Reads as a tuck rather than a trip: the hips drop and hold, the spine rounds
 * hard forward, the legs fold under and the forelegs reach ahead, all of which
 * stay put through the middle of the clip. Holding the pose is the point - a
 * slide is a shape the cat is in for half a second, not a movement through one.
 */
function buildSlide(): THREE.AnimationClip {
  const duration = 0.6;
  const times = [0, 0.12, 0.45, 0.6];

  const curves: Partial<Record<CatBoneName, Curve>> = {
    hips: pitchCurve([0.0, 0.5, 0.52, 0.0]),
    spine: pitchCurve([0.0, -0.55, -0.58, 0.0]),
    chest: pitchCurve([0.0, -0.32, -0.34, 0.0]),
    // Chin stays up through the tuck so the face keeps reading at speed.
    neck: pitchCurve([0.0, 0.42, 0.44, 0.0]),
    head: pitchCurve([0.0, 0.3, 0.32, 0.0]),
    earL: earPose(-1, [0.0, -0.45, -0.48, 0.0]),
    earR: earPose(1, [0.0, -0.45, -0.48, 0.0]),
  };
  for (const side of ['L', 'R'] as const) {
    Object.assign(curves, {
      // Knees to chest, ankles tucked.
      [`thigh${side}`]: pitchCurve([0.0, -1.05, -1.1, 0.0]),
      [`shin${side}`]: pitchCurve([0.0, 1.35, 1.4, 0.0]),
      [`foot${side}`]: pitchCurve([0.0, -0.5, -0.52, 0.0]),
      // Forelegs stretched out along the roof, leading the slide.
      [`shoulder${side}`]: pitchCurve([0.0, -0.5, -0.52, 0.0]),
      [`upperArm${side}`]: pitchCurve([0.0, -0.62, -0.65, 0.0]),
      [`lowerArm${side}`]: pitchCurve([0.0, -0.2, -0.22, 0.0]),
    });
  }

  const tracks = rotationTracks(times, curves);
  // Drops the whole cat, which is what actually clears a low obstacle.
  tracks.push(riseTrack(times, [0.0, -0.16, -0.17, 0.0]));
  return new THREE.AnimationClip('slide', duration, tracks);
}

/**
 * Sitting back on the roof, working through the fish - the attract-screen loop
 * behind the title, and the only clip in this file no gameplay state selects.
 *
 * `Cat.showcaseClip` is what puts it on screen; the run's own state machine
 * never asks for it, exactly the way Subway Surfers' menu cat is doing
 * something no run ever does. See `Game.startAttract()`.
 *
 * The fish is already there. `Cat.attachFish()` parents it to the head joint,
 * crosswise in the mouth, for every cat the game ever draws - so this clip does
 * not need to place a prop, only to animate a cat around one it is already
 * holding. That is why the whole performance is head-led: dip the muzzle over
 * the catch, chew, lift, repeat. A dip drags the fish down with it because the
 * fish is on the head, which is the entire trick.
 *
 * Three chews rather than one long one. Bites read as bites only in the plural;
 * a single dip-and-lift reads as a cat sniffing something.
 *
 * Loops seamlessly: key 0 and the last key are the same pose, and the clip is
 * played on repeat with nothing to blend back out to.
 */
function buildEat(): THREE.AnimationClip {
  const duration = 3.0;
  //           settle  dip   chew  up    chew  up    chew  savour  loop
  const times = [0, 0.4, 0.8, 1.05, 1.3, 1.55, 1.8, 2.4, 3.0];

  // Down is positive on the head/neck here, the same sign convention the
  // slide's chin-up tuck uses in reverse. Neck and head stack, so the peaks
  // below put the muzzle a little over 50 degrees down into the fish - the
  // amplitude is what makes this read as biting rather than as nodding, and
  // it has to survive being watched from four metres away behind a menu.
  const chewNeck = [0.1, 0.32, 0.4, 0.24, 0.4, 0.24, 0.4, 0.04, 0.1];
  // Rounded forward over the catch - negative rounds the spine, per this
  // file's own sign conventions.
  const hunch = [-0.08, -0.22, -0.28, -0.2, -0.28, -0.2, -0.28, -0.04, -0.08];

  const curves: Partial<Record<CatBoneName, Curve>> = {
    hips: pitchCurve([0.0, 0.05, 0.07, 0.05, 0.07, 0.05, 0.07, 0.01, 0.0]),
    spine: pitchCurve(hunch),
    chest: pitchCurve(hunch.map((v) => v * 0.7)),
    neck: pitchCurve(chewNeck),
    // A little side-to-side with the chew, so the bites are not a piston.
    head: [
      [0.14, 0.0, 0.0],
      [0.4, 0.06, 0.0],
      [0.54, -0.07, 0.04],
      [0.32, 0.07, -0.04],
      [0.54, -0.07, 0.04],
      [0.32, 0.07, -0.04],
      [0.54, -0.06, 0.04],
      [0.04, 0.03, 0.0],
      [0.14, 0.0, 0.0],
    ],
    // Ears swivel forward over the food and flick once on the savour beat -
    // the same "one flick a cycle" idea the idle uses to stay alive.
    earL: earPose(-1, [0.12, 0.2, 0.24, 0.2, 0.24, 0.2, 0.24, -0.3, 0.12]),
    earR: earPose(1, [0.12, 0.2, 0.24, 0.2, 0.24, 0.2, 0.24, 0.16, 0.12]),
  };

  for (const side of ['L', 'R'] as const) {
    Object.assign(curves, {
      // Settled back on the haunches: knees folded, ankles under. Held flat
      // across the whole clip - the cat is not going anywhere, and legs that
      // move during a meal read as a cat that cannot sit still.
      [`thigh${side}`]: pitchCurve(times.map(() => -0.34)),
      [`shin${side}`]: pitchCurve(times.map(() => 0.6)),
      [`foot${side}`]: pitchCurve(times.map(() => -0.24)),
      // Forepaws up holding the fish steady, tracking the head so the paws
      // stay with the muzzle through every dip rather than being left behind
      // at chest height. Negative swings the limb forward (see the header).
      [`shoulder${side}`]: pitchCurve(chewNeck.map((v) => -0.35 - v * 0.5)),
      [`upperArm${side}`]: pitchCurve(chewNeck.map((v) => -0.85 - v * 0.6)),
      [`lowerArm${side}`]: pitchCurve(chewNeck.map((v) => 1.1 + v * 0.4)),
    });
  }

  const tracks = rotationTracks(times, curves);
  // Sat low, sinking a touch further into each bite.
  tracks.push(
    riseTrack(times, [-0.05, -0.08, -0.09, -0.08, -0.09, -0.08, -0.09, -0.04, -0.05]),
  );
  return new THREE.AnimationClip('eat', duration, tracks);
}

// ---------------------------------------------------------------------------
// Retargeting onto the imported rig
// ---------------------------------------------------------------------------

/**
 * Authored joint name -> joint name on the imported Meshy rig.
 *
 * NOTE THE SPINE. The imported chain runs `Hips -> Spine02 -> Spine01 -> Spine
 * -> {shoulders, neck}`, so `Spine02` is the *lowest* joint and `Spine` is the
 * chest - the opposite of what the numbering suggests. Mapping `spine -> Spine`
 * would bend the cat at the shoulders instead of the waist.
 *
 * `earL`/`earR` and `tailA`-`tailD` are deliberately absent: the imported rig
 * has neither, so those tracks are dropped rather than aimed at nothing.
 */
export const RETARGET: Partial<Record<CatBoneName, string>> = {
  hips: 'Hips',
  spine: 'Spine02',
  chest: 'Spine',
  neck: 'neck',
  head: 'Head',
  thighL: 'LeftUpLeg',
  shinL: 'LeftLeg',
  footL: 'LeftFoot',
  thighR: 'RightUpLeg',
  shinR: 'RightLeg',
  footR: 'RightFoot',
  shoulderL: 'LeftShoulder',
  upperArmL: 'LeftArm',
  lowerArmL: 'LeftForeArm',
  shoulderR: 'RightShoulder',
  upperArmR: 'RightArm',
  lowerArmR: 'RightForeArm',
};

/** Which imported clip stands in for each state the file actually covers. */
export const IMPORTED_CLIPS = {
  run: 'Running',
  jump: 'Jump_Over_Obstacle_2',
} as const;

/**
 * State -> the take that drives it, by filename stem in
 * `public/assets/cat/anim/` - each ships as a `.glb` (converted from the
 * source `.fbx` exports for size; same motion data, no per-file FBX
 * overhead), loaded via `AssetRegistry.loadCharacterCat()`.
 *
 * Every one of these is authored animation shipped with the character; nothing
 * here is generated. `jump` is the *running* jump rather than the standing
 * hurdle beside it, because the cat is never stationary when it leaves the roof
 * and the run-jump's takeoff pose already matches the stride it blends out of.
 *
 * `idle`, `fall`, `land` and `stumble` are deliberately absent - the pack has
 * no take for any of them, so those four keep the hand-authored versions,
 * retargeted onto this same skeleton by {@link retargetClip}. `eat` used to be
 * among them until the pack grew a real eating take for the attract screen's
 * cat to chew through instead.
 */
export const FBX_CLIP_FILES = {
  run: 'Cat_Animation_Running',
  jump: 'Cat_Animation_Jump_Run',
  slide: 'Cat_Animation_slide_right',
  eat: 'Cat_Animation_Eating',
} as const satisfies Partial<Record<CatClipName, string>>;

/**
 * Strips translation and scale, leaving rotation only.
 *
 * The cat's position comes from the physics capsule, so any root motion baked
 * into a clip is applied *on top* of movement the game has already done.
 * `Jump_Over_Obstacle_2` travels 159 units along Z, which would throw the model
 * clear of its own collider for the length of the jump and snap it back at the
 * end; the vertical component is just as wrong, because the jump arc is already
 * coming from gravity. Bone scale tracks go for the same reason - nothing here
 * wants a skinned mesh changing size mid-stride.
 */
function rotationOnly(clip: THREE.AnimationClip): THREE.AnimationClip {
  const out = clip.clone();
  out.tracks = out.tracks.filter((track) => track.name.endsWith('.quaternion'));
  return out;
}

/**
 * Blends a clip's tail toward its own first frame, so `THREE.LoopRepeat` has
 * nowhere left to pop back to.
 *
 * Not every take in the pack was cut to loop. `Cat_Animation_Eating` ends
 * mid-chew rather than back at the pose it opened on - several joints (both
 * shoulders, the head, the spine) sit 15-30 degrees off frame zero, which is
 * invisible on a one-shot but a visible snap on the attract screen's slow,
 * static, repeating shot. Rather than re-cutting the take, only the last
 * `blendSeconds` are eased toward frame zero - untouched at the start of the
 * window, identical to it at the very last key - so the seam disappears
 * without reshaping the performance.
 */
function loopify(clip: THREE.AnimationClip, blendSeconds: number): THREE.AnimationClip {
  const out = clip.clone();
  const start = new THREE.Quaternion();
  const sample = new THREE.Quaternion();

  for (const track of out.tracks) {
    if (!track.name.endsWith('.quaternion') || track.times.length === 0) continue;
    const { times, values } = track;
    start.set(values[0], values[1], values[2], values[3]);

    const blendStart = times[times.length - 1] - blendSeconds;
    for (let i = 0; i < times.length; i++) {
      if (times[i] < blendStart) continue;
      const t = THREE.MathUtils.clamp((times[i] - blendStart) / blendSeconds, 0, 1);
      const o = i * 4;
      sample.set(values[o], values[o + 1], values[o + 2], values[o + 3]).slerp(start, t);
      values.set([sample.x, sample.y, sample.z, sample.w], o);
    }
  }

  return out;
}

/**
 * Rotates a take's Hips track so the body reads as standing rather than lying
 * flat, carrying the rest of the skeleton upright with it.
 *
 * The takes bind to the same joint names as the rig (see {@link
 * FBX_CLIP_FILES}'s own comment on why that binding needs no retargeting), but
 * their Hips keys sit close to identity rotation, where this rig's own bind
 * pose carries roughly a 90-degree rotation about X. Since Hips is the root of
 * the whole FK chain, that single difference is enough to lay the entire cat
 * down: the head ends up level with the hips instead of far above them.
 *
 * The takes ship as GLB, converted from the character pack's original FBX
 * exports, and that conversion is where the difference comes from - glTF is
 * Y-up and normalises a take's root into it, dropping the pitch the FBX rig
 * expects. `Cat_Animation_Eating` was converted first and so needed this
 * before any of the others; when the rest followed, they needed it too.
 *
 * Nothing else in a take is wrong - the stride, the dip-and-chew motion, the
 * leg placement, all of it - so rather than re-author the performances, this
 * rotates only the Hips key by the fixed delta that realigns its first frame
 * with the rig's own bind orientation. Being a single rigid premultiply, it
 * carries everything above and below Hips upright without touching any joint's
 * angle relative to its parent, and without altering the motion *within* the
 * take: every frame moves by the same delta. A take that already matches the
 * bind orientation computes the identity here and passes through unchanged.
 */
function standUpright(clip: THREE.AnimationClip, model: THREE.Object3D): THREE.AnimationClip {
  const hipsBind = model.getObjectByName('Hips');
  const track = clip.tracks.find((t) => t.name === 'Hips.quaternion');
  if (!hipsBind || !track) return clip;

  const first = new THREE.Quaternion(track.values[0], track.values[1], track.values[2], track.values[3]);
  const correction = hipsBind.quaternion.clone().multiply(first.clone().invert());

  const out = clip.clone();
  const outTrack = out.tracks.find((t) => t.name === 'Hips.quaternion')!;
  const values = outTrack.values;
  const q = new THREE.Quaternion();
  for (let i = 0; i < outTrack.times.length; i++) {
    const o = i * 4;
    q.set(values[o], values[o + 1], values[o + 2], values[o + 3]).premultiply(correction);
    values.set([q.x, q.y, q.z, q.w], o);
  }
  return out;
}

/**
 * Rewrites a hand-authored clip to drive the imported skeleton.
 *
 * Two things have to change, and the second is the one that is easy to miss.
 * The track names are remapped through {@link RETARGET}, and every keyframe is
 * composed onto the target joint's **bind rotation** rather than written
 * absolutely: the authored angles were written against a rig whose joints all
 * had identity rest rotations, which the imported rig does not, so writing them
 * straight would snap every joint to the authored pose and discard the rest
 * pose the mesh was skinned in.
 *
 * Position tracks are dropped. The authored `root.position` rise is expressed
 * in world units, while the imported rig's joint translations are in its own
 * pre-scale units, so adding one to the other would be off by the model's
 * normalisation factor. It only ever carried a few centimetres of presentation
 * dip, and the pose that reads - the bent knees, the hunched back - is all in
 * the rotations.
 *
 * @param model a freshly loaded rig, before any mixer has posed it
 */
function retargetClip(clip: THREE.AnimationClip, model: THREE.Object3D): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const authored = new THREE.Quaternion();
  const composed = new THREE.Quaternion();

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = track.name.slice(0, dot) as CatBoneName;
    const property = track.name.slice(dot + 1);

    if (property !== 'quaternion') continue;

    const targetName = RETARGET[bone];
    if (!targetName) continue;

    const target = model.getObjectByName(targetName);
    if (!target) continue;

    const values = new Float32Array(track.values.length);
    for (let i = 0; i < track.values.length; i += 4) {
      authored.set(
        track.values[i],
        track.values[i + 1],
        track.values[i + 2],
        track.values[i + 3],
      );
      composed.copy(target.quaternion).multiply(authored);

      // Keep the sign continuous, or slerp takes the long way round between two
      // keys that are geometrically adjacent.
      if (i > 0) {
        const d =
          composed.x * values[i - 4] +
          composed.y * values[i - 3] +
          composed.z * values[i - 2] +
          composed.w * values[i - 1];
        if (d < 0) composed.set(-composed.x, -composed.y, -composed.z, -composed.w);
      }
      values.set([composed.x, composed.y, composed.z, composed.w], i);
    }

    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${targetName}.quaternion`,
        Array.from(track.times),
        values,
      ),
    );
  }

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Every clip the state machine (and the attract screen) can ask for, assembled
 * for the imported rig.
 *
 * `run` and `jump` come straight from the file. The rest have no equivalent in
 * it - there is no idle, no fall, no landing, no stumble and certainly no meal
 * among the seven exported animations - so the hand-authored versions are
 * retargeted onto the imported skeleton instead of being thrown away.
 *
 * Returns null if the file does not contain the clips it is supposed to, so the
 * caller can fall back to the fully procedural rig rather than shipping a cat
 * that is missing half its states.
 */
export function buildImportedClipSet(
  imported: readonly THREE.AnimationClip[],
  model: THREE.Object3D,
): THREE.AnimationClip[] | null {
  const out: THREE.AnimationClip[] = [];

  for (const [state, sourceName] of Object.entries(IMPORTED_CLIPS)) {
    const source = imported.find((clip) => clip.name === sourceName);
    if (!source) {
      console.warn(`[cat] imported rig has no "${sourceName}" clip for ${state}`);
      return null;
    }
    const clip = rotationOnly(source);
    clip.name = state;
    out.push(clip);
  }

  const covered = new Set<string>(Object.keys(IMPORTED_CLIPS));
  for (const authored of buildCatClips()) {
    if (covered.has(authored.name)) continue;
    out.push(retargetClip(authored, model));
  }

  return out;
}

/**
 * The clip set for the FBX character, assembled from its own animation takes.
 *
 * The pack ships the rig and each take as a separate file, all against the same
 * 24-joint skeleton, so a take's tracks already name the rig's joints and bind
 * by name with no retargeting - which is exactly why the animations can be used
 * as authored rather than approximated. Each file holds one take, whatever its
 * stack happens to be called, so the clip is taken positionally and renamed to
 * the state it drives.
 *
 * Everything is reduced to rotation by {@link rotationOnly}. The cat's position
 * comes from the physics capsule and the jump arc from gravity, so a take's
 * baked root travel would be applied *on top* of movement the game has already
 * done - the run-jump alone carries the model metres clear of its own collider.
 *
 * The states the pack has no take for are filled by the hand-authored clips,
 * retargeted onto this skeleton. Returns null if a required take is
 * missing, so the caller can fall back to a rig that is complete rather than
 * shipping a cat with no jump.
 *
 * @param takes one entry per state, in the order {@link FBX_CLIP_FILES} declares
 * @param model a freshly loaded rig, before any mixer has posed it
 */
export function buildFbxClipSet(
  takes: Partial<Record<CatClipName, readonly THREE.AnimationClip[]>>,
  model: THREE.Object3D,
): THREE.AnimationClip[] | null {
  const out: THREE.AnimationClip[] = [];

  for (const state of Object.keys(FBX_CLIP_FILES) as Array<keyof typeof FBX_CLIP_FILES>) {
    const source = takes[state]?.[0];
    if (!source || source.tracks.length === 0) {
      console.warn(`[cat] no usable "${state}" take in the character pack`);
      return null;
    }
    let clip = rotationOnly(source);
    clip.name = state;
    // Every take needs this, not just `eat` - see `standUpright`'s comment.
    // The takes ship as GLB now, and the conversion normalised each one's root
    // to glTF's Y-up convention, which drops the ~90-degree X rotation this
    // rig's bind pose carries on Hips. `eat` needed the correction back when it
    // was the odd one out; now all four do, and applying it to a take that is
    // already aligned is a no-op anyway - the correction it computes is the
    // identity.
    clip = standUpright(clip, model);
    // The only state here that loops on the attract screen rather than firing
    // once mid-run - see `loopify`'s own comment for why it needs the help.
    if (state === 'eat') {
      clip = loopify(clip, 1.5);
    }
    out.push(clip);
  }

  const covered = new Set<string>(Object.keys(FBX_CLIP_FILES));
  for (const authored of buildCatClips()) {
    if (covered.has(authored.name)) continue;
    out.push(retargetClip(authored, model));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

/** Lifts a list of X-axis angles into full Euler triples. */
function pitchCurve(values: readonly number[]): Curve {
  return values.map((x) => [x, 0, 0] as Angles);
}

/** Lifts a list of Y-axis angles (yaw/twist) into full Euler triples. */
function yawCurve(values: readonly number[]): Curve {
  return values.map((y) => [0, y, 0] as Angles);
}

/**
 * Ears flick outward as well as back, so they need the sideways roll that
 * `pitchCurve` cannot express.
 *
 * @param side -1 for the left ear, +1 for the right
 */
function earPose(side: -1 | 1, pitch: readonly number[]): Curve {
  return pitch.map((x) => [x, 0, side * Math.abs(x) * 0.4] as Angles);
}

/** The run cycle's ear flutter: pinned back, vibrating at twice stride rate. */
function earCurve(side: -1 | 1): Curve {
  return stridePhase.map((p) => {
    const flutter = Math.sin(p * Math.PI * 4) * 0.07;
    const pitch = -0.22 + flutter;
    return [pitch, 0, side * (0.12 + flutter * 0.5)] as Angles;
  });
}

/**
 * Densifies a closed loop of control values onto {@link STRIDE_SAMPLES} keys
 * with a periodic Catmull-Rom spline.
 *
 * Periodic rather than clamped: the stride wraps, so the tangent at key 0 has
 * to be computed from the *end* of the cycle. Treating it as an endpoint gives
 * that key a one-sided tangent and puts a visible hitch at the exact instant
 * the cycle repeats - once per stride, which is the most noticeable place a
 * glitch could possibly land.
 *
 * The result is clamped to the authored range. Catmull-Rom overshoots wherever
 * the control points turn sharply, and `FOOT` turns very sharply at toe-off
 * (-0.6 -> 0.15 -> 0.7 across three keys). Left unclamped that overshoot drives
 * the toe below the roof, which the floor-contact regression in
 * tests/catrig.test.ts would catch - but clamping is the right fix rather than
 * flattening the authored curve to suit the interpolator.
 */
function resample(values: readonly number[]): number[] {
  if (values.length !== STRIDE_CONTROLS) {
    throw new Error(`stride curve needs ${STRIDE_CONTROLS} controls, got ${values.length}`);
  }
  const period = values.length - 1;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const at = (i: number) => values[((i % period) + period) % period];

  return stridePhase.map((u) => {
    const x = u * period;
    const i = Math.floor(x);
    const f = x - i;

    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    const v =
      0.5 *
      (2 * p1 +
        (-p0 + p2) * f +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
        (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);

    return Math.min(hi, Math.max(lo, v));
  });
}

/**
 * One limb curve, densified and phase-shifted, ready to be a track.
 *
 * Densify first, then shift. The other order would phase-shift nine points and
 * spline the result, which lands the spline's control points at different
 * places on the two legs and leaves them subtly different shapes.
 */
function strideCurve(values: readonly number[], phase: number): Curve {
  return pitchCurve(shift(resample(values), phase));
}

/**
 * Resamples a closed loop of values at a phase offset.
 *
 * The last entry repeats the first, so the period is one sample shorter than
 * the array - getting that wrong shows up as a stride that jerks once per
 * cycle on one side only.
 */
function shift(values: readonly number[], phase: number): number[] {
  const period = values.length - 1;
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const at = (i / period + phase) * period;
    const lo = Math.floor(at) % period;
    const frac = at - Math.floor(at);
    out.push(values[lo] * (1 - frac) + values[(lo + 1) % period] * frac);
  }
  return out;
}

/** Converts per-bone Euler curves into quaternion tracks. */
function rotationTracks(
  times: readonly number[],
  curves: Partial<Record<CatBoneName, Curve>>,
): THREE.KeyframeTrack[] {
  const tracks: THREE.KeyframeTrack[] = [];
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();

  for (const [bone, curve] of Object.entries(curves) as [CatBoneName, Curve][]) {
    if (curve.length !== times.length) {
      throw new Error(`${bone}: ${curve.length} keys for ${times.length} times`);
    }

    const values = new Float32Array(times.length * 4);
    for (let i = 0; i < curve.length; i++) {
      euler.set(curve[i][0], curve[i][1], curve[i][2], 'XYZ');
      quat.setFromEuler(euler);
      // Keep the sign continuous, or slerp takes the long way round between two
      // keys that are geometrically adjacent.
      if (i > 0) {
        const dot =
          quat.x * values[(i - 1) * 4] +
          quat.y * values[(i - 1) * 4 + 1] +
          quat.z * values[(i - 1) * 4 + 2] +
          quat.w * values[(i - 1) * 4 + 3];
        if (dot < 0) quat.set(-quat.x, -quat.y, -quat.z, -quat.w);
      }
      values.set([quat.x, quat.y, quat.z, quat.w], i * 4);
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [...times], values));
  }

  return tracks;
}

/**
 * Vertical offset of the whole cat.
 *
 * Valid only because the root joint is pinned to the geometry origin, so its
 * bind position is zero and these values are offsets rather than absolutes.
 */
function riseTrack(times: readonly number[], rise: readonly number[]): THREE.KeyframeTrack {
  if (rise.length !== times.length) {
    throw new Error(`root rise: ${rise.length} keys for ${times.length} times`);
  }
  const values = new Float32Array(times.length * 3);
  for (let i = 0; i < rise.length; i++) values[i * 3 + 1] = rise[i];
  return new THREE.VectorKeyframeTrack('root.position', [...times], values);
}
