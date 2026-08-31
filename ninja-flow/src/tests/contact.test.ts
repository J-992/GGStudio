import { describe, expect, it } from 'vitest';
import { Bone, BoxGeometry, Euler, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { contactProfileFor, solveContactImpulse } from '../game/CombatContact';
import { moveById } from '../game/MoveLibrary';
import { Enemy, solveTwoHandGrip, strikeDistanceFor } from '../game/Enemy';
import { ENEMY } from '../config';
import { Rng } from '../core/Rng';

describe('combat contact physics', () => {
  it('drives a player-quality skinned silhouette with the enemy combat controller', () => {
    const model = new Group();
    const body = new Mesh(new BoxGeometry(0.7, 1.5, 0.35), new MeshStandardMaterial());
    body.position.y = 0.75;
    model.add(body);
    const hips = new Bone();
    hips.name = 'Hips';
    model.add(hips);
    for (const name of ['Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg']) {
      const bone = new Bone();
      bone.name = name;
      hips.add(bone);
    }

    const enemy = new Enemy();
    enemy.setDetailedModel(model);
    enemy.spawn({ side: 'L', impactAt: 2, spawnAt: 0, approach: 2, rare: false, rng: new Rng(2) });
    enemy.update(1 / 60, 1.6);

    expect(enemy.highDetail).toBe(true);
    expect(model.parent).not.toBeNull();
    expect(body.castShadow).toBe(true);
  });

  it('keeps forward pressure through the approach instead of crawling near the player', () => {
    const enemy = new Enemy();
    enemy.spawn({ side: 'R', impactAt: 2, spawnAt: 0, approach: 2, rare: false, rng: new Rng(9) });
    const start = Math.abs(enemy.group.position.x);
    enemy.update(1 / 60, 1);
    const halfway = Math.abs(enemy.group.position.x);
    enemy.update(1 / 60, 2);
    const finish = Math.abs(enemy.group.position.x);

    const firstHalf = start - halfway;
    const secondHalf = halfway - finish;
    expect(firstHalf / secondHalf).toBeLessThan(1.15);
    expect(firstHalf / secondHalf).toBeGreaterThan(0.85);
  });

  it('brings every weapon class into close combat before impact', () => {
    expect(strikeDistanceFor(1)).toBeCloseTo(ENEMY.strikeDistance);
    expect(strikeDistanceFor(0.72)).toBeGreaterThanOrEqual(ENEMY.strikeDistanceMin);
    expect(strikeDistanceFor(1.35)).toBeLessThanOrEqual(ENEMY.strikeDistanceMax);
    expect(strikeDistanceFor(1.35)).toBeLessThan(1.55);
  });

  it('solves a two-handed weapon shaft exactly through both fists', () => {
    const primary = new Vector3(-0.28, 0.78, 0.06);
    const secondary = new Vector3(0.24, 1.02, 0.03);
    const hold = new Quaternion().setFromEuler(new Euler(0.32, 0, 0.16));
    const mount = new Quaternion();

    expect(solveTwoHandGrip(primary, secondary, hold, mount)).toBe(true);
    const weaponAxis = new Vector3(0, 1, 0).applyQuaternion(hold).applyQuaternion(mount);
    const betweenHands = secondary.clone().sub(primary).normalize();
    expect(weaponAxis.angleTo(betweenHands)).toBeLessThan(1e-6);
  });

  it('assigns the physical striking limb for weapon, foot and knee attacks', () => {
    expect(contactProfileFor(moveById('slash')).effector).toBe('handR');
    expect(contactProfileFor(moveById('frontKick')).effector).toBe('footR');
    expect(contactProfileFor(moveById('kneeStrike')).effector).toBe('legR');
  });

  it('launches the enemy away and gives the player equal-opposite recoil', () => {
    const impulse = solveContactImpulse(
      contactProfileFor(moveById('sideKick')),
      { point: { x: 1.2, y: 0.95, z: 0 }, velocity: { x: 9, y: 1, z: 0 } },
      0,
      1.5,
      1,
    );
    expect(impulse.linear.x).toBeGreaterThan(0);
    expect(impulse.recoil.x).toBeLessThan(0);
    expect(Math.abs(impulse.linear.x / impulse.recoil.x)).toBeCloseTo(3.6, 5);
  });

  it('uses measured effector speed and contact height to shape response', () => {
    const profile = contactProfileFor(moveById('roundhouse'));
    const slow = solveContactImpulse(
      profile,
      { point: { x: 1.2, y: 0.6, z: 0 }, velocity: { x: 4.5, y: 0, z: 0 } },
      0,
      1.5,
      1,
    );
    const fastHigh = solveContactImpulse(
      profile,
      { point: { x: 1.2, y: 1.2, z: 0 }, velocity: { x: 12, y: 2, z: 0 } },
      0,
      1.5,
      1,
    );
    expect(fastHigh.linear.x).toBeGreaterThan(slow.linear.x);
    expect(Math.abs(fastHigh.angular.z - slow.angular.z)).toBeGreaterThan(1);
  });
});
