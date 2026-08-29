import { Bone, Euler, Group, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import { RigAdapter, type Pose } from '../game/Rig';

describe('RigAdapter', () => {
  it('restores the mixer pose before applying the next procedural layer', () => {
    const root = new Group();
    const hips = new Bone();
    hips.name = 'Hips';
    root.add(hips);
    const rig = new RigAdapter(root, 1.72);

    hips.quaternion.setFromEuler(new Euler(0, 0.3, 0));
    rig.captureBasePose();
    rig.applyPose({ hips: [0, Math.PI, 0] }, 0.5);

    const expectedOffset = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
    const expectedPose = new Quaternion().setFromEuler(new Euler(0, 0.3, 0)).multiply(expectedOffset);
    expect(hips.quaternion.angleTo(expectedPose)).toBeLessThan(1e-6);

    rig.restoreBasePose();
    const basePose = new Quaternion().setFromEuler(new Euler(0, 0.3, 0));
    expect(hips.quaternion.angleTo(basePose)).toBeLessThan(1e-6);
  });

  it('drives weighted twist helpers without changing the source aliases', () => {
    const root = new Group();
    const arm = new Bone();
    arm.name = 'LeftArm';
    const helper = new Bone();
    helper.name = 'LeftArmTwist';
    arm.add(helper);
    root.add(arm);
    const rig = new RigAdapter(root, 1.72);

    rig.applyPose({ armL: [0, 0.5, 0] }, 1);
    const expectedHelper = new Quaternion().setFromEuler(new Euler(0, -0.08, 0));
    expect(helper.quaternion.angleTo(expectedHelper)).toBeLessThan(1e-6);
    expect(rig.get('armL')).toBe(arm);
    expect(rig.get('twistArmL')).toBe(helper);
  });

  it('reads mixer motion from the bind pose and assists it without doubling the source', () => {
    const root = new Group();
    const arm = new Bone();
    arm.name = 'LeftArm';
    const helper = new Bone();
    helper.name = 'LeftArmTwist';
    arm.add(helper);
    root.add(arm);
    const rig = new RigAdapter(root, 1.72);

    arm.quaternion.setFromEuler(new Euler(0, 0.5, 0));
    rig.captureBasePose();
    const mixerPose: Pose = {};
    rig.readAnimationPose(['armL'], mixerPose);
    rig.applyTwistAssist(mixerPose, 1);

    const expectedArm = new Quaternion().setFromEuler(new Euler(0, 0.5, 0));
    const expectedHelper = new Quaternion().setFromEuler(new Euler(0, -0.08, 0));
    expect(arm.quaternion.angleTo(expectedArm)).toBeLessThan(1e-6);
    expect(helper.quaternion.angleTo(expectedHelper)).toBeLessThan(1e-6);
    expect(mixerPose.armL?.[1]).toBeCloseTo(0.5, 6);
  });
});
