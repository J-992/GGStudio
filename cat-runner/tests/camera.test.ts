import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { FollowCamera, DEFAULT_CAMERA, lookAheadFor } from '../src/camera/FollowCamera';
import { GROUP } from '../src/physics/PhysicsWorld';
import type { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { PHYSICS } from '../src/physics/PhysicsConfig';

/**
 * Camera framing.
 *
 * The camera aims along its own pitch rather than at the cat, so "is the player
 * character actually on screen" is not something the numbers say out loud - it
 * falls out of the difference between the angle down to the cat and the camera's
 * tilt, measured against the vertical FOV. Get it wrong and the game renders
 * perfectly with the cat just below the bottom edge.
 *
 * These read the real camera after a `snapTo`, rather than re-deriving the
 * geometry, so they check what is on screen rather than what was intended.
 */

/** Where the cat sits vertically in frame: 0 = centre, +-1 = top/bottom edge. */
function catFrameOffset(): number {
  const camera = new FollowCamera(16 / 9);
  const cat = new THREE.Vector3(0, 0, 0);

  // Heading +Z, which is what every level's opening leg runs along.
  camera.snapTo(cat, 0);
  camera.camera.updateMatrixWorld(true);

  const projected = cat.clone().project(camera.camera);
  return projected.y;
}

describe('camera placement', () => {
  it('sits the authored distance behind and above the cat', () => {
    const camera = new FollowCamera(16 / 9);
    camera.snapTo(new THREE.Vector3(0, 0, 0), 0);

    const at = camera.camera.position;
    // Heading +Z means "behind" is -Z.
    expect(at.z).toBeCloseTo(-DEFAULT_CAMERA.distance, 5);
    expect(at.y).toBeCloseTo(DEFAULT_CAMERA.height, 5);
    expect(at.x).toBeCloseTo(0, 5);
  });

  it('tilts down by exactly the configured pitch', () => {
    const camera = new FollowCamera(16 / 9);
    camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
    camera.camera.updateMatrixWorld(true);

    const forward = new THREE.Vector3();
    camera.camera.getWorldDirection(forward);

    const pitchDown = THREE.MathUtils.radToDeg(Math.asin(-forward.y));
    expect(pitchDown).toBeCloseTo(DEFAULT_CAMERA.pitchDegrees, 4);
  });

  it('derives the look-ahead from the pitch rather than the other way round', () => {
    // Editing height or distance has to move the look point to keep the tilt.
    const steeper = { ...DEFAULT_CAMERA, pitchDegrees: 40 };
    expect(lookAheadFor(steeper)).toBeLessThan(lookAheadFor(DEFAULT_CAMERA));

    const higher = { ...DEFAULT_CAMERA, height: DEFAULT_CAMERA.height * 2 };
    expect(lookAheadFor(higher)).toBeGreaterThan(lookAheadFor(DEFAULT_CAMERA));
  });

  it('keeps the cat on screen', () => {
    // The one that matters. Projected Y runs -1 (bottom) to +1 (top); the cat
    // sits below centre because the camera looks past it down the track.
    const y = catFrameOffset();
    expect(y, `the cat projects to y=${y.toFixed(3)}, outside the frame`).toBeGreaterThan(-1);
    expect(y).toBeLessThan(1);
  });

  it('leaves the cat clear of the very bottom edge', () => {
    // On screen is not enough - a cat touching the bottom edge is a cat whose
    // legs and shadow are cut off, and its landing shadow is the main cue for
    // where a jump is going to put it.
    expect(catFrameOffset()).toBeGreaterThan(-0.85);
  });

  it('keeps the cat below centre so the track ahead has the frame', () => {
    // The failure this guards is the opposite one: a camera aimed at the cat
    // puts the horizon above centre and the next gap off-screen.
    expect(catFrameOffset()).toBeLessThan(-0.1);
  });

  /**
   * The whole cat, at the top of a jump - the case the paws-only checks above
   * cannot see.
   *
   * `Game.cameraTarget()` anchors the camera's height to the cat's *ground* Y
   * so a jump reads flat, which means the rig does not rise with the cat and
   * the apex is entirely spent moving the cat up the frame. At distance 1 /
   * height 2 that was 1.73 units of rise against a lens 2 up and 1 back, and
   * the cat's head left the top of the frame for the whole apex - reported,
   * reproduced, and the reason the rig sits at 1.8/3.6 now.
   *
   * Deliberately measured at `baseFov` rather than the speed-expanded FOV
   * (75 against 89, see `PHYSICS.fovExpansionAmount`): the narrow lens is the
   * tighter case, and a jump can happen at any speed.
   */
  const STANDING_APEX = PHYSICS.jumpImpulse ** 2 / (2 * Math.abs(PHYSICS.gravity));
  const CAT_HEIGHT = 1.0; // AssetRegistry normalises the rig to ~1 unit tall

  function headAtApex(aspect: number): number {
    const camera = new FollowCamera(aspect);
    // The camera target stays on the ground the cat left - it does not follow
    // the arc up. See `Game.cameraTarget()`.
    camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
    camera.camera.updateMatrixWorld(true);
    return new THREE.Vector3(0, STANDING_APEX + CAT_HEIGHT, 0)
      .project(camera.camera).y;
  }

  it('keeps the cat’s head in frame at the top of a standing jump', () => {
    const y = headAtApex(16 / 9);
    expect(
      y,
      `at jump apex the cat's head projects to y=${y.toFixed(3)} (>1 is off the top)`,
    ).toBeLessThan(1);
    // Not merely inside - clear of the edge, since the camera also lags its
    // height target and shake moves the frame.
    expect(y).toBeLessThan(0.8);
  });

  it('keeps it in frame in portrait too, where the rig sits further out', () => {
    expect(headAtApex(9 / 16)).toBeLessThan(0.8);
  });

  it('has enough vertical FOV for the placement it was given', () => {
    // Restates the on-screen check as the arithmetic, so a failure says which
    // number to change rather than just "the cat vanished".
    const angleToCat = THREE.MathUtils.radToDeg(
      Math.atan2(DEFAULT_CAMERA.height, DEFAULT_CAMERA.distance),
    );
    const belowAxis = angleToCat - DEFAULT_CAMERA.pitchDegrees;

    expect(
      belowAxis,
      `the cat is ${belowAxis.toFixed(1)} deg below the camera axis, against a ` +
        `half-FOV of ${(DEFAULT_CAMERA.baseFov / 2).toFixed(1)} deg`,
    ).toBeLessThan(DEFAULT_CAMERA.baseFov / 2);
  });
});

/**
 * Occlusion release smoothing.
 *
 * Root cause of the "camera jumps backward and upward during gap jumps"
 * report: an occluder (a parapet/chimney just behind the running lane) pulls
 * the camera in, and gap jumps are exactly the moment that occluder tends to
 * leave the raycast - so the old code, which wrote the fully-resolved
 * distance straight into `_desired` with no smoothing of its own, snapped
 * the camera back out to full distance in a single frame. Pulling in must
 * stay instant (it is what stops the near plane clipping through geometry);
 * only the release back out is now damped.
 */
function fakePhysics(hitDistance: number | null): PhysicsWorld {
  return {
    raycast: () =>
      hitDistance === null
        ? null
        : { distance: hitDistance, normal: new THREE.Vector3(0, 1, 0), collider: {} },
  } as unknown as PhysicsWorld;
}

/**
 * Note: the camera's rendered *position* always lags its target through
 * `positionDamping`/`heightDamping`, in both directions, regardless of this
 * fix - so none of this can be tested by reading `camera.camera.position`
 * after a single `update()` call. What this fix actually changes is the
 * *target* `resolveOcclusion` hands to that damping: instant when pulling
 * in, damped at {@link OCCLUSION_RELEASE_RATE} when releasing. That shows up
 * as a difference in how many frames it takes the rendered position to cross
 * the midpoint each way - which is what these tests measure.
 */
function framesToCross(
  camera: FollowCamera,
  cat: THREE.Vector3,
  threshold: number,
  goingBelow: boolean,
  maxFrames: number,
): number {
  for (let i = 1; i <= maxFrames; i++) {
    camera.update(cat, 0, new THREE.Vector3(0, 0, 0), 1 / 60);
    const d = camera.camera.position.distanceTo(cat);
    if (goingBelow ? d <= threshold : d >= threshold) return i;
  }
  return maxFrames;
}

describe('camera occlusion release (gap-jump pop fix)', () => {
  const fullDistance = Math.sqrt(DEFAULT_CAMERA.distance ** 2 + DEFAULT_CAMERA.height ** 2);
  // Scaled off `fullDistance` rather than a flat literal: the occluder only
  // means anything as "closer than the camera's full extension", and a fixed
  // hit distance stopped being that the moment `distance`/`height` shrank
  // enough to bring `fullDistance` itself below the old literal (3).
  const occluderHit = fullDistance * 0.75;
  const safeDistance = Math.max(DEFAULT_CAMERA.minOcclusionDistance, occluderHit - 0.35);
  const midpoint = (fullDistance + safeDistance) / 2;

  it('converges to the occluder-safe distance while occluded', () => {
    const camera = new FollowCamera(16 / 9, fakePhysics(occluderHit));
    const cat = new THREE.Vector3(0, 0, 0);
    camera.snapTo(cat, 0);
    for (let i = 0; i < 180; i++) camera.update(cat, 0, new THREE.Vector3(0, 0, 0), 1 / 60);

    expect(camera.camera.position.distanceTo(cat)).toBeLessThan(safeDistance + 1.5);
  });

  it('releases all the way back out once the occluder clears', () => {
    const camera = new FollowCamera(16 / 9, fakePhysics(occluderHit));
    const cat = new THREE.Vector3(0, 0, 0);
    camera.snapTo(cat, 0);
    for (let i = 0; i < 180; i++) camera.update(cat, 0, new THREE.Vector3(0, 0, 0), 1 / 60);

    camera.setPhysics(fakePhysics(null));
    for (let i = 0; i < 240; i++) camera.update(cat, 0, new THREE.Vector3(0, 0, 0), 1 / 60);

    expect(camera.camera.position.distanceTo(cat)).toBeGreaterThan(fullDistance * 0.95);
  });

  it('pulls in noticeably faster than it releases - the asymmetry that fixes the gap-jump pop', () => {
    const pullIn = new FollowCamera(16 / 9, fakePhysics(occluderHit));
    const catA = new THREE.Vector3(0, 0, 0);
    pullIn.snapTo(catA, 0);
    const framesToPullIn = framesToCross(pullIn, catA, midpoint, true, 600);

    const release = new FollowCamera(16 / 9, fakePhysics(occluderHit));
    const catB = new THREE.Vector3(0, 0, 0);
    release.snapTo(catB, 0);
    for (let i = 0; i < 180; i++) release.update(catB, 0, new THREE.Vector3(0, 0, 0), 1 / 60);
    release.setPhysics(fakePhysics(null));
    const framesToRelease = framesToCross(release, catB, midpoint, false, 600);

    expect(framesToRelease).toBeGreaterThan(framesToPullIn * 1.5);
  });

  it('never checks GROUP.GROUND - regression for the roof-tier deck steps false-triggering occlusion', () => {
    // Root cause of the "camera isn't respecting the tuned height/distance"
    // report: a roof-tier transition leaves the previous, taller chunk's
    // deck sitting in the camera's own sightline for the whole length of
    // the chunk after it, and the occlusion raycast used to check
    // GROUP.GROUND - so every such transition pulled the camera in to
    // minOcclusionDistance, masking whatever distance/height was configured.
    // GROUP.GROUND never represented a real "wall" occluder (buildings/props
    // are visual-only, no collider), so it was dropped from the filter -
    // this pins that it stays dropped.
    let requestedFilter: number | null = null;
    const spyPhysics = {
      raycast: (
        _origin: THREE.Vector3,
        _dir: THREE.Vector3,
        _maxDistance: number,
        _exclude: unknown,
        filterGroups: number,
      ) => {
        requestedFilter = filterGroups;
        return null;
      },
    } as unknown as PhysicsWorld;

    const camera = new FollowCamera(16 / 9, spyPhysics);
    const cat = new THREE.Vector3(0, 0, 0);
    camera.snapTo(cat, 0);
    camera.update(cat, 0, new THREE.Vector3(0, 0, 0), 1 / 60);

    expect(requestedFilter).not.toBeNull();
    // collisionGroups(membership, filter) packs as `(membership << 16) |
    // filter`, so the low 16 bits are what the ray is actually allowed to
    // hit - the thing this test cares about.
    const allowedToHit = requestedFilter! & 0xffff;
    expect(allowedToHit & GROUP.GROUND).toBe(0);
    expect(allowedToHit & GROUP.OBSTACLE).toBe(GROUP.OBSTACLE);
  });
});
