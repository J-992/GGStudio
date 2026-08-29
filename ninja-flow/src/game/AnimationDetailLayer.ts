import type { BoneKey, Pose } from './Rig';

type Vec3 = [number, number, number];

export const MOTION_SOURCE_KEYS = [
  'hips',
  'chest',
  'armL',
  'forearmL',
  'armR',
  'forearmR',
  'upLegL',
  'legL',
  'upLegR',
  'legR',
] as const satisfies readonly BoneKey[];

const DETAIL_KEYS = [
  'shoulderL',
  'shoulderR',
  'handL',
  'handR',
  'upperChest',
  'neck',
  'head',
  'footL',
  'footR',
  'toeL',
  'toeR',
  'twistArmL',
  'twistForearmL',
  'twistArmR',
  'twistForearmR',
  'twistUpLegL',
  'twistLegL',
  'twistUpLegR',
  'twistLegR',
  'twistChest',
  'twistUpperChest',
] as const satisfies readonly BoneKey[];

type DetailKey = (typeof DETAIL_KEYS)[number];

/**
 * Converts pose angular velocity into restrained overlap and follow-through.
 *
 * The authored tracks still own the silhouette and exact contact frame. This
 * layer only makes the joints farther down a chain arrive a fraction later:
 * shoulders absorb an arm swing, wrists trail the forearms, the head resists a
 * torso turn and planted feet settle through the toe. Twist helpers receive a
 * small velocity-driven rotation as well, spreading deformation across the
 * extra weighted joints instead of rotating every limb as one rigid tube.
 */
export class AnimationDetailLayer {
  private readonly previous = makeVectors(MOTION_SOURCE_KEYS);
  private readonly velocity = makeVectors(MOTION_SOURCE_KEYS);
  private readonly values = makeVectors(DETAIL_KEYS);
  private readonly targets = makeVectors(DETAIL_KEYS);
  private initialized = false;

  /** Stable object reused every frame to avoid animation-loop allocations. */
  readonly pose: Pose = Object.fromEntries(
    DETAIL_KEYS.map((key) => [key, this.values[key]]),
  ) as Pose;

  reset(): void {
    this.initialized = false;
    zeroVectors(this.previous);
    zeroVectors(this.velocity);
    zeroVectors(this.values);
    zeroVectors(this.targets);
  }

  update(source: Pose | null, dt: number, intensity = 1): Pose {
    const safeDt = clamp(dt, 1 / 240, 1 / 20);
    const velocityBlend = 1 - Math.exp(-18 * safeDt);
    const active = source !== null && intensity > 0;

    for (const key of MOTION_SOURCE_KEYS) {
      const current = active ? source[key] ?? ZERO : ZERO;
      const previous = this.previous[key];
      const velocity = this.velocity[key];
      for (let axis = 0; axis < 3; axis++) {
        // Use the shortest angular distance so an imported quaternion crossing
        // the Euler ±PI seam does not create a one-frame velocity explosion.
        const raw = active && this.initialized
          ? shortestAngle(current[axis] - previous[axis]) / safeDt
          : 0;
        velocity[axis] += (raw - velocity[axis]) * velocityBlend;
        previous[axis] = current[axis];
      }
    }
    if (active) this.initialized = true;

    zeroVectors(this.targets);
    if (active) this.writeTargets(clamp(intensity, 0, 1.25));

    // A fast response keeps contact silhouettes crisp; the slower inactive
    // response lets momentum dissipate instead of popping off with the track.
    const settleBlend = 1 - Math.exp(-(active ? 24 : 11) * safeDt);
    for (const key of DETAIL_KEYS) {
      const value = this.values[key];
      const target = this.targets[key];
      for (let axis = 0; axis < 3; axis++) value[axis] += (target[axis] - value[axis]) * settleBlend;
    }
    return this.pose;
  }

  private writeTargets(intensity: number): void {
    const armL = this.velocity.armL;
    const armR = this.velocity.armR;
    const forearmL = this.velocity.forearmL;
    const forearmR = this.velocity.forearmR;
    const upLegL = this.velocity.upLegL;
    const upLegR = this.velocity.upLegR;
    const legL = this.velocity.legL;
    const legR = this.velocity.legR;
    const hips = this.velocity.hips;
    const chest = this.velocity.chest;

    // Proximal joints absorb some of the arm's momentum while the wrists trail
    // more visibly. The weapon hand is deliberately tighter than the free hand.
    this.set('shoulderL', 0, -armL[1] * 0.0035, -armL[2] * 0.0045, 0.1, intensity);
    this.set('shoulderR', 0, -armR[1] * 0.0035, -armR[2] * 0.0045, 0.1, intensity);
    this.set('handL', -forearmL[0] * 0.004, -forearmL[1] * 0.006, -forearmL[2] * 0.008, 0.16, intensity);
    this.set('handR', -forearmR[0] * 0.003, -forearmR[1] * 0.0045, -forearmR[2] * 0.006, 0.13, intensity);

    // The rib cage and gaze resist a sudden hip turn, then catch up. This
    // prevents spins and diagonal cuts from rotating as a single rigid block.
    const torsoYaw = hips[1] * 0.7 + chest[1] * 0.3;
    this.set('upperChest', 0, -torsoYaw * 0.0025, -hips[2] * 0.0018, 0.085, intensity);
    this.set('neck', 0, -torsoYaw * 0.0017, 0, 0.055, intensity);
    this.set('head', 0, -torsoYaw * 0.0022, -chest[2] * 0.0012, 0.07, intensity);

    // The ankle absorbs shin speed and the toes finish the roll. Opposite signs
    // are intentional: the foot catches the leg while the toe continues it.
    this.set('footL', -legL[0] * 0.0042, 0, -legL[2] * 0.002, 0.12, intensity);
    this.set('footR', -legR[0] * 0.0042, 0, -legR[2] * 0.002, 0.12, intensity);
    this.set('toeL', legL[0] * 0.0028, 0, 0, 0.09, intensity);
    this.set('toeR', legR[0] * 0.0028, 0, 0, 0.09, intensity);

    // Longitudinal helper rotations distribute fast twisting through the new
    // weighted deformation joints. These are secondary to RigAdapter's static
    // twist assist and only appear while a joint is accelerating through space.
    this.set('twistArmL', 0, -armL[1] * 0.0032, 0, 0.08, intensity);
    this.set('twistArmR', 0, -armR[1] * 0.0032, 0, 0.08, intensity);
    this.set('twistForearmL', 0, -forearmL[1] * 0.0042, 0, 0.1, intensity);
    this.set('twistForearmR', 0, -forearmR[1] * 0.0042, 0, 0.1, intensity);
    this.set('twistUpLegL', 0, -upLegL[1] * 0.0027, 0, 0.065, intensity);
    this.set('twistUpLegR', 0, -upLegR[1] * 0.0027, 0, 0.065, intensity);
    this.set('twistLegL', 0, -legL[1] * 0.0032, 0, 0.07, intensity);
    this.set('twistLegR', 0, -legR[1] * 0.0032, 0, 0.07, intensity);
    this.set('twistChest', 0, -hips[1] * 0.002, 0, 0.055, intensity);
    this.set('twistUpperChest', 0, -chest[1] * 0.0024, 0, 0.06, intensity);
  }

  private set(
    key: DetailKey,
    x: number,
    y: number,
    z: number,
    limit: number,
    intensity: number,
  ): void {
    const target = this.targets[key];
    target[0] = clamp(x * intensity, -limit, limit);
    target[1] = clamp(y * intensity, -limit, limit);
    target[2] = clamp(z * intensity, -limit, limit);
  }
}

/** Combines mixer-authored motion with the weighted procedural combat layer. */
export function combineMotionPoses(
  mixer: Pose,
  procedural: Pose | null,
  proceduralWeight: number,
  out: Pose,
): Pose {
  for (const key of MOTION_SOURCE_KEYS) {
    const base = mixer[key] ?? ZERO;
    const additive = procedural?.[key] ?? ZERO;
    writeVector(
      out,
      key,
      base[0] + additive[0] * proceduralWeight,
      base[1] + additive[1] * proceduralWeight,
      base[2] + additive[2] * proceduralWeight,
    );
  }
  return out;
}

function makeVectors<K extends string>(keys: readonly K[]): Record<K, Vec3> {
  return Object.fromEntries(keys.map((key) => [key, [0, 0, 0]])) as Record<K, Vec3>;
}

function zeroVectors<K extends string>(vectors: Record<K, Vec3>): void {
  for (const vector of Object.values(vectors) as Vec3[]) vector[0] = vector[1] = vector[2] = 0;
}

function writeVector(pose: Pose, key: BoneKey, x: number, y: number, z: number): void {
  const vector = pose[key] as Vec3 | undefined;
  if (vector) {
    vector[0] = x;
    vector[1] = y;
    vector[2] = z;
  } else {
    pose[key] = [x, y, z];
  }
}

function shortestAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

const ZERO = [0, 0, 0] as const;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
