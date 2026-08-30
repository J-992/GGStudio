import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  CatnipGroundTrail,
  MAX_AGE,
  MAX_SAMPLES,
  SAMPLE_MIN_DISTANCE,
} from '../src/effects/CatnipGroundTrail';

/**
 * The mesh-based Catnip Rush trail.
 *
 * Runs headless (no canvas), same as the rest of this suite - `mesh.visible`
 * and `geometry.drawRange` are what actually gate rendering, so they are
 * what these tests read rather than pixels.
 */
function drawnRungCount(trail: CatnipGroundTrail): number {
  return trail.mesh.geometry.drawRange.count / 6;
}

describe('CatnipGroundTrail', () => {
  it('starts invisible with nothing drawn', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    expect(trail.mesh.visible).toBe(false);
    expect(trail.mesh.geometry.drawRange.count).toBe(0);
    trail.dispose();
  });

  it('becomes visible once enough samples have been laid down while active and grounded', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const pos = new THREE.Vector3(0, 5, 0);

    // One sample alone never draws (a rung needs a neighbour).
    trail.update(1 / 60, true, pos, true);
    expect(trail.mesh.visible).toBe(false);

    // Move far enough to clear SAMPLE_MIN_DISTANCE for a second sample.
    pos.z += SAMPLE_MIN_DISTANCE + 0.1;
    trail.update(1 / 60, true, pos, true);
    expect(trail.mesh.visible).toBe(true);
    expect(drawnRungCount(trail)).toBeGreaterThan(0);
    trail.dispose();
  });

  it('does not add a new sample before the cat has moved SAMPLE_MIN_DISTANCE', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const pos = new THREE.Vector3(0, 5, 0);
    trail.update(1 / 60, true, pos, true);
    pos.z += SAMPLE_MIN_DISTANCE + 0.1;
    trail.update(1 / 60, true, pos, true);
    const rungsAfterTwo = drawnRungCount(trail);

    // Tiny moves whose *total* still stays under the threshold - should not
    // grow the visible trail at all.
    for (let i = 0; i < 20; i++) {
      pos.z += SAMPLE_MIN_DISTANCE * 0.02;
      trail.update(1 / 60, true, pos, true);
    }
    expect(drawnRungCount(trail)).toBe(rungsAfterTwo);
    trail.dispose();
  });

  it('never exceeds MAX_SAMPLES worth of geometry, however long it runs', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const pos = new THREE.Vector3(0, 5, 0);

    // Far more distance than MAX_SAMPLES * SAMPLE_MIN_DISTANCE would need.
    for (let i = 0; i < MAX_SAMPLES * 4; i++) {
      pos.z += SAMPLE_MIN_DISTANCE + 0.05;
      trail.update(1 / 60, true, pos, true);
    }
    expect(drawnRungCount(trail)).toBeLessThanOrEqual(MAX_SAMPLES - 1);
    trail.dispose();
  });

  it('keeps the trail just above the ground - the sampled Y rides through with a small anti-Z-fight lift, never the caller-passed jump height', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const groundY = 3;
    const pos = new THREE.Vector3(0, groundY, 0);
    trail.update(1 / 60, true, pos, true);
    pos.z += SAMPLE_MIN_DISTANCE + 0.1;
    // Caller is expected to hold Y at the ground anchor even while the cat
    // is mid-jump - simulate that by leaving pos.y untouched here, exactly
    // as Game.ts's `_catnipTrailPos.set(x, lastGroundY, z)` does.
    trail.update(1 / 60, true, pos, true);

    const positions = trail.mesh.geometry.attributes.position.array as Float32Array;
    // Every written vertex's Y must sit at the ground anchor plus the fixed,
    // small anti-Z-fight epsilon - never exactly coplanar with the deck
    // (that was the Z-fighting bug) and never the jump height.
    const rungs = drawnRungCount(trail) + 1;
    for (let i = 0; i < rungs * 2; i++) {
      const y = positions[i * 3 + 1];
      expect(y).toBeGreaterThan(groundY);
      expect(y).toBeLessThan(groundY + 0.2);
    }
    trail.dispose();
  });

  it('does not lay new samples while airborne (grounded=false), even if active and moving', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const pos = new THREE.Vector3(0, 5, 0);
    trail.update(1 / 60, true, pos, true);
    pos.z += SAMPLE_MIN_DISTANCE + 0.1;
    trail.update(1 / 60, true, pos, true);
    const rungsBeforeJump = drawnRungCount(trail);

    // Airborne: position keeps moving (as the cat's real X/Z does mid-jump)
    // but grounded is false throughout.
    for (let i = 0; i < 10; i++) {
      pos.z += SAMPLE_MIN_DISTANCE + 0.1;
      trail.update(1 / 60, true, pos, false);
    }
    expect(drawnRungCount(trail)).toBe(rungsBeforeJump);
    trail.dispose();
  });

  it('restarts the ribbon instead of bridging a roof-tier seam with a diagonal wall', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const pos = new THREE.Vector3(0, 20.5, 0);

    for (let i = 0; i < 5; i++) {
      pos.z += SAMPLE_MIN_DISTANCE + 0.1;
      trail.update(1 / 60, true, pos, true);
    }
    expect(drawnRungCount(trail)).toBeGreaterThan(0);

    // Land on a tier a full ROOF_TIER_HEIGHT step higher (e.g. LOW -> HIGH),
    // with the position otherwise having barely moved in X/Z - simulating a
    // short hop where the old samples haven't aged out yet.
    pos.y = 26.5;
    pos.z += SAMPLE_MIN_DISTANCE + 0.1;
    trail.update(1 / 60, true, pos, true);
    // A single post-reset sample alone never draws (a rung needs a
    // neighbour, same as the very first frame) - lay a second one so the
    // ribbon actually redraws, matching what a real landing looks like.
    pos.z += SAMPLE_MIN_DISTANCE + 0.1;
    trail.update(1 / 60, true, pos, true);

    expect(trail.mesh.visible).toBe(true);
    const positions = trail.mesh.geometry.attributes.position.array as Float32Array;
    const rungs = drawnRungCount(trail) + 1;
    // Every live vertex should sit near the NEW tier's height - the old,
    // lower-tier samples were dropped rather than kept as one end of a
    // giant vertical quad.
    for (let i = 0; i < rungs * 2; i++) {
      expect(positions[i * 3 + 1]).toBeGreaterThan(25);
    }
    trail.dispose();
  });

  it('keeps emitting and drawing while active, then fades away entirely once it stops - with no separate clear needed', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const pos = new THREE.Vector3(0, 5, 0);

    for (let i = 0; i < 5; i++) {
      pos.z += SAMPLE_MIN_DISTANCE + 0.1;
      trail.update(1 / 60, true, pos, true);
    }
    expect(trail.mesh.visible).toBe(true);

    // Catnip Rush ends: caller stops passing active=true, position stops
    // advancing (the cat isn't laying new trail down at its old spots).
    // Age the whole thing out one small step at a time, the way a real
    // per-frame dt would, rather than one big overshoot.
    const step = MAX_AGE / 20;
    for (let t = 0; t < MAX_AGE * 1.5; t += step) {
      trail.update(step, false, pos, true);
    }
    expect(trail.mesh.visible).toBe(false);
    expect(trail.mesh.geometry.drawRange.count).toBe(0);
    trail.dispose();
  });

  it('clear() removes everything immediately regardless of age', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const pos = new THREE.Vector3(0, 5, 0);
    for (let i = 0; i < 5; i++) {
      pos.z += SAMPLE_MIN_DISTANCE + 0.1;
      trail.update(1 / 60, true, pos, true);
    }
    expect(trail.mesh.visible).toBe(true);

    trail.clear();
    expect(trail.mesh.visible).toBe(false);
    expect(trail.mesh.geometry.drawRange.count).toBe(0);
    trail.dispose();
  });

  it('the low graphics-quality switch (enabled=false) suppresses the trail even while active', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const pos = new THREE.Vector3(0, 5, 0);
    trail.enabled = false;
    for (let i = 0; i < 5; i++) {
      pos.z += SAMPLE_MIN_DISTANCE + 0.1;
      trail.update(1 / 60, true, pos, true);
    }
    expect(trail.mesh.visible).toBe(false);
    trail.dispose();
  });

  it('uses a lightweight, reused, transparent unlit material - never recreated per update', () => {
    const scene = new THREE.Scene();
    const trail = new CatnipGroundTrail(scene);
    const material = trail.mesh.material as THREE.MeshBasicMaterial;
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(material.transparent).toBe(true);
    expect(material.vertexColors).toBe(true);

    const pos = new THREE.Vector3(0, 5, 0);
    for (let i = 0; i < 10; i++) {
      pos.z += SAMPLE_MIN_DISTANCE + 0.1;
      trail.update(1 / 60, true, pos, true);
    }
    // Same material and geometry instance throughout - only its attributes'
    // contents change, never the objects themselves.
    expect(trail.mesh.material).toBe(material);
    trail.dispose();
  });
});
