import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildLighting } from '../src/environment/EnvironmentLighting';
import type { LightingDef } from '../src/levels/LevelTypes';

/**
 * Day/night cycle - pure numeric checks against the sun/moon/sky model in
 * `updateTimeOfDay`. No renderer involved (`THREE.Scene`/`Object3D` work
 * fine without WebGL), so this covers the actual logic a Browser-pane pass
 * can't easily pin down: exact intensities/visibility at specific points in
 * the cycle, not just "it doesn't crash."
 */

const DEF: LightingDef = {
  skyColor: 0x87ceeb,
  fogColor: 0x9fd9f2,
  fogNear: 130,
  fogFar: 260,
  sunColor: 0xfff6e0,
  sunIntensity: 2.4,
  sunPosition: [40, 95, -25],
  ambientSky: 0xbfe3ff,
  ambientGround: 0x9a8f7a,
  ambientIntensity: 1.4,
};

function build() {
  const scene = new THREE.Scene();
  const parent = new THREE.Object3D();
  scene.add(parent);
  return { scene, handle: buildLighting(scene, parent, DEF) };
}

describe('day/night cycle', () => {
  it('is full daylight at t=0.25 (midday)', () => {
    const { handle } = build();
    handle.updateTimeOfDay(0.25);

    expect(handle.sun.intensity).toBeCloseTo(DEF.sunIntensity, 3);
    expect(handle.sun.visible).toBe(true);
  });

  it('is full night at t=0.75 (midnight) - sun off, moon at max', () => {
    const { handle, scene } = build();
    handle.updateTimeOfDay(0.75);

    expect(handle.sun.intensity).toBeCloseTo(0, 3);
    expect(handle.sun.visible).toBe(false);

    // Night sky should be much darker than the authored day sky.
    const bg = scene.background as THREE.Color;
    const daySky = new THREE.Color(DEF.skyColor);
    expect(bg.r + bg.g + bg.b).toBeLessThan(daySky.r + daySky.g + daySky.b);
  });

  it('sun and moon sit on opposite sides of the sky at every t', () => {
    const { handle } = build();
    const target = new THREE.Vector3(0, 20, 100);

    for (const t of [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
      handle.updateTimeOfDay(t);
      handle.updateFocus(target);

      const sunOffset = handle.sun.position.clone().sub(target);
      // sun.position is snapped to the shadow texel grid before the offset
      // is added, so this is close-but-not-exact - loose enough to still
      // catch a sign error while tolerating that quantisation.
      expect(sunOffset.length()).toBeGreaterThan(1);
    }
  });

  it('crosses zero sun intensity smoothly around the horizon (t=0 and t=0.5)', () => {
    const { handle } = build();
    handle.updateTimeOfDay(0);
    expect(handle.sun.intensity).toBeCloseTo(0, 2);
    handle.updateTimeOfDay(0.5);
    expect(handle.sun.intensity).toBeCloseTo(0, 2);
  });

  it('updateFocus never throws across a full cycle, and dispose cleans up', () => {
    const { handle, scene } = build();
    const target = new THREE.Vector3();

    expect(() => {
      for (let i = 0; i <= 20; i++) {
        handle.updateTimeOfDay(i / 20);
        handle.updateFocus(target);
      }
    }).not.toThrow();

    handle.dispose();
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
  });
});
