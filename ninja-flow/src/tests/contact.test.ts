import { describe, expect, it } from 'vitest';
import { contactProfileFor, solveContactImpulse } from '../game/CombatContact';
import { moveById } from '../game/MoveLibrary';

describe('combat contact physics', () => {
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
