import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { RunPath, wrapAngle } from '../src/levels/RunPath';

/**
 * `RunPath`'s screen-handedness invariants.
 *
 * Built from synthetic routes rather than authored level data: these are
 * statements about the handedness of the frame, not about any one route, and
 * they have to keep holding regardless of what generates the points.
 */

describe('RunPath', () => {
  it('classifies a +Z to +X corner as a left turn', () => {
    // The camera trails the runner, so screen-right when heading +Z is world -X
    // (three.js cameras look down local -Z). Swinging the heading from +Z onto
    // +X therefore sweeps LEFT across the screen.
    const path = new RunPath([
      [0, 0, 0],
      [0, 0, 100],
      [100, 0, 100],
    ]);
    const turn = path.junctions.find((j) => j.kind === 'turn');

    expect(turn).toBeDefined();
    expect(turn!.deltaYaw).toBeCloseTo(Math.PI / 2, 6);
    expect(turn!.turnDir).toBe(-1);

    // ...and the mirror image is a right turn.
    const mirrored = new RunPath([
      [0, 0, 0],
      [0, 0, 100],
      [-100, 0, 100],
    ]);
    const right = mirrored.junctions.find((j) => j.kind === 'turn');
    expect(right).toBeDefined();
    expect(right!.turnDir).toBe(1);
  });

  it('measures lateral offset to the right of the heading', () => {
    // Straight up +Z. The runner's right is SCREEN right, which is -X, because
    // the camera trails the cat and three.js cameras look down their local -Z.
    // A point at x = +3 is therefore 3 units to the runner's LEFT.
    //
    // This assertion had the opposite sign, which is exactly the bug it warns
    // about: lane switching was inverted on keyboard, gamepad and touch at once.
    const path = new RunPath([
      [0, 0, 0],
      [0, 0, 100],
    ]);

    const point = new THREE.Vector3(3, 0, 40);
    expect(path.lateralOf(0, point)).toBeCloseTo(-3, 6);
    expect(path.alongOf(0, point)).toBeCloseTo(40, 6);

    const centre = new THREE.Vector3();
    path.centreAt(0, 40, centre);
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.z).toBeCloseTo(40, 6);
  });

  it('builds a continuous track from raw points', () => {
    const path = new RunPath([
      [0, 0, 0],
      [0, 0, 40],
      [30, 0, 40],
      [30, 0, 90],
    ]);

    let expected = 0;
    for (let i = 0; i < path.segments.length; i++) {
      const segment = path.segments[i];
      expect(segment.startDist).toBeCloseTo(expected, 6);
      expected += segment.length;

      if (i > 0) {
        expect(segment.start.distanceTo(path.segments[i - 1].end)).toBeLessThan(1e-6);
      }
      expect(segment.dir.length()).toBeCloseTo(1, 6);
      expect(segment.right.length()).toBeCloseTo(1, 6);
      expect(segment.dir.dot(segment.right)).toBeCloseTo(0, 6);
      expect(Math.abs(wrapAngle(Math.atan2(segment.dir.x, segment.dir.z) - segment.yaw)))
        .toBeLessThan(1e-6);
    }

    expect(path.totalLength).toBeCloseTo(expected, 6);
  });
});
