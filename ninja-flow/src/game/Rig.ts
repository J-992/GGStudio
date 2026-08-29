import { Bone, Box3, Euler, Object3D, Quaternion, Vector3 } from 'three';

/**
 * Skeleton abstraction over the supplied ninja rigs.
 *
 * All four Meshy exports retain an identical 24-joint animation skeleton and
 * add 10 identically-named weighted deformation helpers. That common contract
 * lets one clip pool and one procedural set drive every character. Aliases keep
 * a future differently-named rig isolated from combat code.
 */

export type BoneKey =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'shoulderL'
  | 'armL'
  | 'forearmL'
  | 'handL'
  | 'shoulderR'
  | 'armR'
  | 'forearmR'
  | 'handR'
  | 'upLegL'
  | 'legL'
  | 'footL'
  | 'toeL'
  | 'upLegR'
  | 'legR'
  | 'footR'
  | 'toeR'
  | 'twistArmL'
  | 'twistForearmL'
  | 'twistArmR'
  | 'twistForearmR'
  | 'twistUpLegL'
  | 'twistLegL'
  | 'twistUpLegR'
  | 'twistLegR'
  | 'twistChest'
  | 'twistUpperChest';

const ALIASES: Record<BoneKey, readonly string[]> = {
  hips: ['Hips', 'mixamorigHips', 'pelvis'],
  spine: ['Spine', 'mixamorigSpine'],
  chest: ['Spine01', 'mixamorigSpine1', 'chest'],
  upperChest: ['Spine02', 'mixamorigSpine2', 'upperchest'],
  neck: ['neck', 'Neck', 'mixamorigNeck'],
  head: ['Head', 'mixamorigHead'],
  shoulderL: ['LeftShoulder', 'mixamorigLeftShoulder'],
  armL: ['LeftArm', 'mixamorigLeftArm'],
  forearmL: ['LeftForeArm', 'mixamorigLeftForeArm'],
  handL: ['LeftHand', 'mixamorigLeftHand'],
  shoulderR: ['RightShoulder', 'mixamorigRightShoulder'],
  armR: ['RightArm', 'mixamorigRightArm'],
  forearmR: ['RightForeArm', 'mixamorigRightForeArm'],
  handR: ['RightHand', 'mixamorigRightHand'],
  upLegL: ['LeftUpLeg', 'mixamorigLeftUpLeg'],
  legL: ['LeftLeg', 'mixamorigLeftLeg'],
  footL: ['LeftFoot', 'mixamorigLeftFoot'],
  toeL: ['LeftToeBase', 'mixamorigLeftToeBase'],
  upLegR: ['RightUpLeg', 'mixamorigRightUpLeg'],
  legR: ['RightLeg', 'mixamorigRightLeg'],
  footR: ['RightFoot', 'mixamorigRightFoot'],
  toeR: ['RightToeBase', 'mixamorigRightToeBase'],
  twistArmL: ['LeftArmTwist'],
  twistForearmL: ['LeftForeArmTwist'],
  twistArmR: ['RightArmTwist'],
  twistForearmR: ['RightForeArmTwist'],
  twistUpLegL: ['LeftUpLegTwist'],
  twistLegL: ['LeftLegTwist'],
  twistUpLegR: ['RightUpLegTwist'],
  twistLegR: ['RightLegTwist'],
  twistChest: ['Spine01Twist'],
  twistUpperChest: ['Spine02Twist'],
};

type RotationLimit = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
];

/** Limits apply to additive offsets, protecting joints from spline overshoot. */
const LIMITS: Partial<Record<BoneKey, RotationLimit>> = {
  spine: [[-1.15, -1.35, -0.9], [1.15, 1.35, 0.9]],
  chest: [[-1.1, -1.3, -0.9], [1.1, 1.3, 0.9]],
  upperChest: [[-1, -1.2, -0.85], [1, 1.2, 0.85]],
  neck: [[-0.65, -0.85, -0.55], [0.65, 0.85, 0.55]],
  head: [[-0.9, -1.05, -0.75], [0.9, 1.05, 0.75]],
  armL: [[-2.9, -1.7, -2.4], [2.9, 1.7, 2.4]],
  armR: [[-2.9, -1.7, -2.4], [2.9, 1.7, 2.4]],
  forearmL: [[-0.7, -0.8, -2.45], [0.7, 0.8, 2.45]],
  forearmR: [[-0.7, -0.8, -2.45], [0.7, 0.8, 2.45]],
  legL: [[-2.55, -0.7, -0.65], [1.35, 0.7, 0.65]],
  legR: [[-2.55, -0.7, -0.65], [1.35, 0.7, 0.65]],
  footL: [[-0.85, -0.55, -0.55], [0.85, 0.55, 0.55]],
  footR: [[-0.85, -0.55, -0.55], [0.85, 0.55, 0.55]],
  toeL: [[-0.65, -0.25, -0.25], [0.65, 0.25, 0.25]],
  toeR: [[-0.65, -0.25, -0.25], [0.65, 0.25, 0.25]],
};

const TWIST_ASSIST: Partial<Record<BoneKey, readonly [BoneKey, number]>> = {
  armL: ['twistArmL', 0.16],
  forearmL: ['twistForearmL', 0.2],
  armR: ['twistArmR', 0.16],
  forearmR: ['twistForearmR', 0.2],
  upLegL: ['twistUpLegL', 0.12],
  legL: ['twistLegL', 0.12],
  upLegR: ['twistUpLegR', 0.12],
  legR: ['twistLegR', 0.12],
  chest: ['twistChest', 0.1],
  upperChest: ['twistUpperChest', 0.1],
};

/** Euler offsets in radians, applied on top of whatever the mixer produced. */
export type Pose = Partial<Record<BoneKey, readonly [number, number, number]>>;

export class RigAdapter {
  private readonly bones = new Map<BoneKey, Object3D>();
  /** Immutable local bind rotations used to measure authored clip motion. */
  private readonly restRotations = new Map<BoneKey, Quaternion>();
  /**
   * The mixer writes the base pose and the procedural layer is applied after
   * it. Keeping that base pose lets us restore it on the next frame before
   * sampling again. Without this, a skeleton with no idle clip would multiply
   * the same offset into itself every frame and slowly twist out of shape.
   */
  private readonly baseRotations = new Map<BoneKey, Quaternion>();
  private readonly scratchEuler = new Euler();
  private readonly scratchQuat = new Quaternion();
  private readonly weightedOffset = new Quaternion();
  readonly height: number;

  constructor(root: Object3D, height: number) {
    this.height = height;
    const byName = new Map<string, Object3D>();
    root.traverse((o) => {
      if (o instanceof Bone || o.type === 'Bone') byName.set(o.name.toLowerCase(), o);
    });
    for (const key of Object.keys(ALIASES) as BoneKey[]) {
      for (const alias of ALIASES[key]) {
        const found = byName.get(alias.toLowerCase());
        if (found) {
          this.bones.set(key, found);
          this.baseRotations.set(key, found.quaternion.clone());
          this.restRotations.set(key, found.quaternion.clone());
          break;
        }
      }
    }
  }

  get(key: BoneKey): Object3D | null {
    return this.bones.get(key) ?? null;
  }

  get resolvedCount(): number {
    return this.bones.size;
  }

  /** Restores the pose captured after the last mixer evaluation. */
  restoreBasePose(): void {
    for (const [key, bone] of this.bones) {
      const base = this.baseRotations.get(key);
      if (base) bone.quaternion.copy(base);
    }
  }

  /** Captures the mixer result before the procedural additive layer is added. */
  captureBasePose(): void {
    for (const [key, bone] of this.bones) {
      const base = this.baseRotations.get(key);
      if (base) base.copy(bone.quaternion);
    }
  }

  /**
   * Reads the mixer's current local rotations as offsets from the bind pose.
   * This lets runtime secondary motion react to imported idle/run/finisher
   * clips without rewriting or baking those clips for the augmented skeleton.
   */
  readAnimationPose(keys: readonly BoneKey[], out: Pose): Pose {
    for (const key of keys) {
      const base = this.baseRotations.get(key);
      const rest = this.restRotations.get(key);
      if (!base || !rest) {
        delete out[key];
        continue;
      }
      this.scratchQuat.copy(rest).invert().multiply(base);
      this.scratchEuler.setFromQuaternion(this.scratchQuat, 'XYZ');
      writePoseVector(out, key, this.scratchEuler.x, this.scratchEuler.y, this.scratchEuler.z);
    }
    return out;
  }

  /**
   * Applies a pose additively, in bone-local space.
   *
   * Additive rather than absolute is what keeps the idle clip alive underneath
   * an attack: breathing and weight shift continue while the strike plays, so
   * the character never snaps into a rigid keyframed puppet.
   */
  applyPose(pose: Pose, weight: number): void {
    if (weight <= 0) return;
    for (const key of Object.keys(pose) as BoneKey[]) {
      const bone = this.bones.get(key);
      const offset = pose[key];
      if (!bone || !offset) continue;
      const limit = LIMITS[key];
      const x = limit ? clamp(offset[0], limit[0][0], limit[1][0]) : offset[0];
      const y = limit ? clamp(offset[1], limit[0][1], limit[1][1]) : offset[1];
      const z = limit ? clamp(offset[2], limit[0][2], limit[1][2]) : offset[2];
      this.scratchEuler.set(x, y, z);
      this.scratchQuat.setFromEuler(this.scratchEuler);
      // Interpolating the delta as a quaternion avoids the axis skew caused by
      // scaling an Euler triplet, especially in the strong diagonal cuts.
      this.weightedOffset.identity().slerp(this.scratchQuat, weight);
      bone.quaternion.multiply(this.weightedOffset);
    }
    this.applyTwistAssist(pose, weight);
  }

  /**
   * Distributes axial rotation across the weighted helper joints only.
   * Kept separate so mixer-authored motion can receive the same deformation
   * correction without applying its source rotations a second time.
   */
  applyTwistAssist(pose: Pose, weight: number): void {
    if (weight <= 0) return;
    for (const key of Object.keys(pose) as BoneKey[]) {
      const offset = pose[key];
      const assist = TWIST_ASSIST[key];
      const helper = assist ? this.bones.get(assist[0]) : null;
      if (!offset || !assist || !helper) continue;
      const limit = LIMITS[key];
      const y = limit ? clamp(offset[1], limit[0][1], limit[1][1]) : offset[1];
      if (Math.abs(y) <= 1e-5) continue;
      this.scratchEuler.set(0, -y * assist[1] * weight, 0);
      this.scratchQuat.setFromEuler(this.scratchEuler);
      helper.quaternion.multiply(this.scratchQuat);
    }
  }
}

/** Blends two poses, used to interpolate procedural keyframes. */
export function blendPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  const keys = new Set<BoneKey>([...(Object.keys(a) as BoneKey[]), ...(Object.keys(b) as BoneKey[])]);
  for (const key of keys) {
    const va = a[key] ?? ZERO;
    const vb = b[key] ?? ZERO;
    out[key] = [
      va[0] + (vb[0] - va[0]) * t,
      va[1] + (vb[1] - va[1]) * t,
      va[2] + (vb[2] - va[2]) * t,
    ];
  }
  return out;
}

const ZERO = [0, 0, 0] as const;

function writePoseVector(pose: Pose, key: BoneKey, x: number, y: number, z: number): void {
  const current = pose[key] as [number, number, number] | undefined;
  if (current) {
    current[0] = x;
    current[1] = y;
    current[2] = z;
  } else {
    pose[key] = [x, y, z];
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Scales a model so its bounding height matches the arena's hero scale. */
export function normalizeHeight(root: Object3D, targetHeight: number): number {
  // The Meshy armatures ship at 0.01 scale (centimetre authoring), and each
  // character has slightly different proportions, so height is measured rather
  // than assumed. Gameplay distances then hold for any future model.
  const bounds = new Box3().setFromObject(root);
  const size = bounds.getSize(new Vector3());
  const scale = size.y > 1e-6 ? targetHeight / size.y : 1;
  root.scale.multiplyScalar(scale);
  return scale;
}
