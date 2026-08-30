import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  FollowCamera,
  DEFAULT_CAMERA,
  viewportFraming,
  narrowRigScale,
} from '../src/camera/FollowCamera';
import { PHYSICS } from '../src/physics/PhysicsConfig';

/**
 * Portrait framing.
 *
 * Poki requires a game to play in portrait as well as landscape, and its
 * audience is majority mobile. `THREE.PerspectiveCamera.fov` is *vertical*, so
 * a rig tuned at 16:9 keeps its vertical framing at 9:16 and loses two thirds
 * of its horizontal field. Three answers to that have been tried, and the
 * third is the one these pin:
 *
 *   - Widen the lens and pull the rig back (what `viewportFraming` does).
 *     Holds the lateral coverage, but an 88-degree *vertical* lens on a
 *     viewport twice as tall as it is wide spends the extra degrees on sky,
 *     and - because the cat's screen position is
 *     `-tan(angle below axis) / tan(fov / 2)` - slides the cat up out of the
 *     lower third into the middle of the frame. Not the desktop shot.
 *
 *   - Change nothing at all. Fixes the composition by giving up the
 *     compensation with it: a 47-degree horizontal field from a rig one unit
 *     behind the cat is a frustum barely wider than the cat, with both
 *     neighbouring lanes off-screen at its own depth. Correctly framed, and
 *     unplayably close.
 *
 *   - Pull the rig straight back and touch nothing else. A uniform scale of
 *     `distance`/`height` leaves `atan(height / distance)` and the FOV alone,
 *     so pitch, horizon, look-ahead and the cat's y in frame all survive it
 *     unchanged - the *only* thing that moves is how much world fits inside
 *     those same angles. With the FOV fixed the scale needed to hold the 16:9
 *     horizontal field is just `REFERENCE_ASPECT / aspect`, which is 3.16 at
 *     9:16 - capped at `MAX_RUN_PULLBACK`, which binds at every phone shape.
 *
 * So portrait is the same shot, composed the same way, seen from further
 * back: far enough that both neighbouring lanes are in frame level with the
 * cat, and no further, because past that the only thing the extra width buys
 * is parapet and the only thing it costs is the cat.
 *
 * `viewportFraming` is still live for the *attract* shot, which frames the
 * cat's width inside a band between the title lockup and the button column -
 * a genuinely horizontal problem, and one where nothing is being played.
 */

const PORTRAIT = 9 / 16;
const LANDSCAPE = 16 / 9;

/** Lane the player can be asked to move into, either side of centre. */
const LANE_OFFSET = PHYSICS.laneSpacing;

/**
 * Distance ahead of the cat at which a neighbouring lane first falls inside
 * the frustum, in world units.
 *
 * The camera sits `distance` behind and `height` above and looks down its own
 * pitch, so the horizontal half-width of the frustum at any point is measured
 * along that tilted axis, not along the track.
 *
 * Worth being precise about what this measures, because it is easy to read as
 * more than it is: the frustum is a *cone*, so this is where the adjacent
 * lane enters it and stays. Everything further down that lane is inside it
 * too. What a large number here costs is the strip of roof level with the
 * cat's own shoulders, not the ability to see an obstacle coming.
 */
function laneVisibleFrom(camera: FollowCamera): number {
  const cat = new THREE.Vector3(0, 0, 0);
  camera.snapTo(cat, 0);
  camera.camera.updateMatrixWorld(true);

  const half = THREE.MathUtils.degToRad(camera.camera.fov) / 2;
  const tanHalfH = Math.tan(half) * camera.camera.aspect;

  const forward = new THREE.Vector3();
  camera.camera.getWorldDirection(forward);

  // Depth along the view axis of a point `ahead` units in front of the cat.
  const toCat = cat.clone().sub(camera.camera.position);
  const depthAtCat = toCat.dot(forward);
  const depthPerUnitAhead = forward.z; // heading +Z

  // depth(ahead) * tanHalfH = LANE_OFFSET
  const neededDepth = LANE_OFFSET / tanHalfH;
  return (neededDepth - depthAtCat) / depthPerUnitAhead;
}

/** The same distance expressed as reaction time at full run speed. */
function reactionSeconds(camera: FollowCamera): number {
  return laneVisibleFrom(camera) / PHYSICS.runSpeed;
}

/** Where a world point lands in clip space, -1..1 on each axis. */
function project(camera: FollowCamera, point: THREE.Vector3): THREE.Vector3 {
  camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
  camera.camera.updateMatrixWorld(true);
  return point.clone().project(camera.camera);
}

describe('viewportFraming', () => {
  it('leaves 16:9 and wider completely alone', () => {
    for (const aspect of [LANDSCAPE, 2, 2.4, 21 / 9]) {
      const framing = viewportFraming(DEFAULT_CAMERA.baseFov, aspect);
      expect(framing.fov).toBe(DEFAULT_CAMERA.baseFov);
      expect(framing.rigScale).toBe(1);
    }
  });

  it('widens the FOV and pulls the rig back as the viewport narrows', () => {
    const wide = viewportFraming(DEFAULT_CAMERA.baseFov, LANDSCAPE);
    const square = viewportFraming(DEFAULT_CAMERA.baseFov, 1);
    const tall = viewportFraming(DEFAULT_CAMERA.baseFov, PORTRAIT);

    expect(square.fov).toBeGreaterThan(wide.fov);
    expect(tall.fov).toBeGreaterThanOrEqual(square.fov);

    expect(square.rigScale).toBeGreaterThan(wide.rigScale);
    expect(tall.rigScale).toBeGreaterThan(square.rigScale);
  });

  it('never asks for a fisheye or a rig so far back the cat stops reading', () => {
    // Both caps exist because holding the full 16:9 horizontal field on a
    // 9:16 phone would otherwise need ~143 degrees vertically.
    for (const aspect of [PORTRAIT, 0.4, 0.3, 0.1]) {
      const framing = viewportFraming(DEFAULT_CAMERA.baseFov, aspect);
      expect(framing.fov).toBeLessThanOrEqual(88);
      expect(framing.rigScale).toBeLessThanOrEqual(2.6);
    }
  });

  it('degrades gracefully rather than producing a NaN camera', () => {
    for (const aspect of [NaN, Infinity]) {
      const framing = viewportFraming(DEFAULT_CAMERA.baseFov, aspect);
      expect(Number.isFinite(framing.fov)).toBe(true);
      expect(Number.isFinite(framing.rigScale)).toBe(true);
    }
  });
});

describe('the run camera is the same camera at every viewport shape', () => {
  it('uses the authored FOV in portrait, not a widened one', () => {
    for (const aspect of [PORTRAIT, 0.4, 1, LANDSCAPE, 2.4]) {
      const camera = new FollowCamera(aspect);
      camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
      expect(camera.camera.fov).toBeCloseTo(DEFAULT_CAMERA.baseFov, 6);
    }
  });

  it('leaves the rig exactly where it was at 16:9 and wider', () => {
    for (const aspect of [LANDSCAPE, 2, 2.4, 21 / 9]) {
      expect(narrowRigScale(aspect)).toBe(1);

      const camera = new FollowCamera(aspect);
      camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
      expect(camera.camera.position.length()).toBeCloseTo(
        Math.hypot(DEFAULT_CAMERA.distance, DEFAULT_CAMERA.height),
        6,
      );
    }
  });

  /**
   * The move itself: straight back along the line it was already on, by the
   * ratio of the aspects and nothing else. Anything that rotated the rig -
   * scaling `height` without `distance`, say - would change the pitch, and
   * the pitch is the composition.
   */
  it('pulls the rig straight back as the viewport narrows, along the same line', () => {
    const landscape = new FollowCamera(LANDSCAPE);
    landscape.snapTo(new THREE.Vector3(0, 0, 0), 0);
    const portrait = new FollowCamera(PORTRAIT);
    portrait.snapTo(new THREE.Vector3(0, 0, 0), 0);

    const scale = narrowRigScale(PORTRAIT);
    expect(scale).toBeGreaterThan(1);
    // Uncapped this would be REFERENCE / aspect = 3.16; the cap is what a
    // phone actually gets, and it is the lane-coverage number, not parity.
    expect(scale).toBeLessThan(LANDSCAPE / PORTRAIT);

    expect(portrait.camera.position.length()).toBeCloseTo(
      landscape.camera.position.length() * scale,
      5,
    );
    // Same direction from the cat, so only the distance changed.
    expect(
      portrait.camera.position
        .clone()
        .normalize()
        .distanceTo(landscape.camera.position.clone().normalize()),
    ).toBeCloseTo(0, 6);
  });

  it('never pulls back so far the cat stops reading as a cat', () => {
    for (const aspect of [PORTRAIT, 0.4, 0.3, 0.1, 0, NaN, Infinity]) {
      const scale = narrowRigScale(aspect);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThanOrEqual(1);
      expect(scale).toBeLessThanOrEqual(1.75);
    }
  });

  it('keeps the camera tilted by exactly the configured pitch', () => {
    const camera = new FollowCamera(PORTRAIT);
    camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
    camera.camera.updateMatrixWorld(true);

    const forward = new THREE.Vector3();
    camera.camera.getWorldDirection(forward);

    const pitchDown = THREE.MathUtils.radToDeg(Math.asin(-forward.y));
    expect(pitchDown).toBeCloseTo(DEFAULT_CAMERA.pitchDegrees, 4);
  });

  /**
   * The one that actually says "matches PC". Vertical FOV and rig placement
   * are both viewport-independent now, so the cat lands on the same scanline
   * fraction whatever shape the screen is - which is what a player comparing
   * the two builds side by side is looking at.
   */
  it('lands the cat at the same height in frame as a desktop window', () => {
    const cat = new THREE.Vector3(0, 0, 0);
    const portrait = project(new FollowCamera(PORTRAIT), cat).y;
    const landscape = project(new FollowCamera(LANDSCAPE), cat).y;

    expect(portrait).toBeCloseTo(landscape, 6);
    // And still where `tests/camera.test.ts` says it belongs: on screen, and
    // below centre so the track ahead has the frame.
    expect(portrait).toBeGreaterThan(-0.85);
    expect(portrait).toBeLessThan(-0.1);
  });

  it('keeps the cat big enough to read at Poki\'s smallest reference size', () => {
    // 640x360 is Poki's smallest listed reference resolution; portrait is the
    // same panel turned. Measured in device pixels rather than as a fraction
    // of the frame, because a portrait viewport is tall - the cat occupies a
    // much smaller *share* of it while staying a similar size to the eye.
    const catHeight = (aspect: number, screenPx: number) => {
      const camera = new FollowCamera(aspect);
      camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
      const distance = camera.camera.position.length();
      const frameHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.camera.fov) / 2) * distance;
      return (1 / frameHeight) * screenPx; // the cat stands ~1 world unit tall
    };

    expect(catHeight(360 / 640, 640)).toBeGreaterThan(45);
  });
});

describe('what portrait costs, and what it must not', () => {
  /**
   * The thing the report was about, stated as a number so a future edit has
   * to argue with it.
   *
   * Without the pull-back, a 47-degree horizontal field from a rig one unit
   * behind the cat put the adjacent lane off-screen until several units
   * ahead - the player could not see the lane they were about to move into
   * until they were most of the way there. Holding the 16:9 horizontal field
   * puts it back inside the frustum *before* the cat reaches it, which is
   * where landscape has always had it.
   */
  it('shows the lane beside the cat, as landscape does', () => {
    const ahead = laneVisibleFrom(new FollowCamera(PORTRAIT));
    expect(ahead, `an adjacent lane only appears ${ahead.toFixed(2)}u ahead`).toBeLessThan(0);
    expect(reactionSeconds(new FollowCamera(PORTRAIT))).toBeLessThan(0);
  });

  /**
   * The price of the pull-back, bounded. Everything is 3.16x further away in
   * portrait, so the guard that matters is the one on apparent size - this is
   * what stops "hold the horizontal field" turning into a rig so far back the
   * cat is a smudge.
   */
  it('keeps the cat readable at the aspect that pulls back hardest', () => {
    const camera = new FollowCamera(PORTRAIT);
    camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
    expect(camera.camera.position.length()).toBeLessThan(8);
  });

  /**
   * And the property that survived all three attempts: the frustum is a cone,
   * so an obstacle far enough away to still be dodgeable is on screen in
   * portrait exactly as it is in landscape.
   */
  it('still shows an adjacent-lane obstacle at every distance worth dodging at', () => {
    const camera = new FollowCamera(PORTRAIT);
    for (const distanceAhead of [8, 12, 20, 40, 80]) {
      for (const side of [-LANE_OFFSET, LANE_OFFSET]) {
        const at = new THREE.Vector3(side, 0.5, distanceAhead);
        const clip = project(camera, at);
        expect(
          Math.abs(clip.x),
          `a crate ${distanceAhead}u ahead in the ${side < 0 ? 'left' : 'right'} lane is off-screen`,
        ).toBeLessThan(1);
        expect(Math.abs(clip.y)).toBeLessThan(1);
      }
    }
  });

  it('leaves landscape exactly where it was', () => {
    // The adjacent lane is inside the frustum before the cat even reaches it,
    // which is what "authored at 16:9" buys and what must not regress.
    expect(laneVisibleFrom(new FollowCamera(LANDSCAPE))).toBeLessThan(0);
  });
});
