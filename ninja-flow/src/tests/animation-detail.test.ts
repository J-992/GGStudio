import { describe, expect, it } from 'vitest';
import { AnimationDetailLayer, combineMotionPoses } from '../game/AnimationDetailLayer';
import type { Pose } from '../game/Rig';

describe('AnimationDetailLayer', () => {
  it('turns limb motion into distal overlap and weighted twist', () => {
    const layer = new AnimationDetailLayer();
    layer.update({ armR: [0, 0, 0], forearmR: [0, 0, 0] }, 1 / 60);
    const pose = layer.update({ armR: [0, 0.45, 0.8], forearmR: [0.2, 0.35, 1] }, 1 / 60);

    expect(Math.abs(pose.shoulderR?.[2] ?? 0)).toBeGreaterThan(0.001);
    expect(Math.abs(pose.handR?.[2] ?? 0)).toBeGreaterThan(0.001);
    expect(Math.abs(pose.twistArmR?.[1] ?? 0)).toBeGreaterThan(0.001);
    expect(Math.abs(pose.twistForearmR?.[1] ?? 0)).toBeGreaterThan(0.001);
  });

  it('settles follow-through smoothly after the authored track ends', () => {
    const layer = new AnimationDetailLayer();
    layer.update({ legL: [0, 0, 0] }, 1 / 60);
    const active = layer.update({ legL: [1, 0, 0] }, 1 / 60);
    const activeFoot = Math.abs(active.footL?.[0] ?? 0);
    const firstSettle = Math.abs(layer.update(null, 1 / 60).footL?.[0] ?? 0);

    expect(activeFoot).toBeGreaterThan(0);
    expect(firstSettle).toBeLessThan(activeFoot);
    expect(firstSettle).toBeGreaterThan(0);
    for (let i = 0; i < 90; i++) layer.update(null, 1 / 60);
    expect(Math.abs(layer.pose.footL?.[0] ?? 0)).toBeLessThan(1e-5);
  });

  it('keeps extreme pose changes finite and inside animation-safe limits', () => {
    const layer = new AnimationDetailLayer();
    layer.update({ hips: [0, 0, 0], forearmL: [0, 0, 0] }, 1 / 60);
    const pose = layer.update({ hips: [100, -100, 100], forearmL: [-100, 100, -100] }, 0.5);

    for (const euler of Object.values(pose)) {
      for (const value of euler) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThanOrEqual(0.16);
      }
    }
  });

  it('produces comparable overlap at common gameplay frame rates', () => {
    const run = (fps: number): number => {
      const layer = new AnimationDetailLayer();
      const dt = 1 / fps;
      for (let frame = 0; frame <= fps / 2; frame++) {
        const t = frame * dt;
        layer.update({ forearmR: [0, t * 0.8, Math.sin(t * Math.PI) * 1.2] }, dt);
      }
      return layer.pose.handR?.[2] ?? 0;
    };

    expect(run(30)).toBeCloseTo(run(120), 2);
  });

  it('combines imported clip motion with procedural combat offsets', () => {
    const out: Pose = {};
    combineMotionPoses(
      { armR: [0.2, 0.3, 0.4], legL: [0.1, 0, 0] },
      { armR: [0.4, -0.2, 0.6] },
      0.5,
      out,
    );

    expect(out.armR?.[0]).toBeCloseTo(0.4);
    expect(out.armR?.[1]).toBeCloseTo(0.2);
    expect(out.armR?.[2]).toBeCloseTo(0.7);
    expect(out.legL?.[0]).toBeCloseTo(0.1);
  });

  it('does not spike when mixer Euler angles cross the PI seam', () => {
    const layer = new AnimationDetailLayer();
    layer.update({ forearmR: [0, 0, Math.PI - 0.01] }, 1 / 60);
    const pose = layer.update({ forearmR: [0, 0, -Math.PI + 0.01] }, 1 / 60);

    expect(Math.abs(pose.handR?.[2] ?? 0)).toBeLessThan(0.01);
  });
});
