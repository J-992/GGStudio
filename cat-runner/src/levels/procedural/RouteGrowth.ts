import * as THREE from 'three';
import { RunPath } from '../RunPath';
import type { Vec3 } from '../LevelTypes';
import { CHUNK_LENGTH } from '../TrackConfig';
import type { ChunkSpec } from './ChunkTypes';

/**
 * Grows the endless track's route one chunk at a time.
 *
 * Every chunk consumes exactly `CHUNK_LENGTH` of arc length, whatever its
 * type - a jump chunk's gap is a hole in its *deck*, not in the route's
 * bookkeeping. A turn chunk rotates the heading before laying down its
 * point, so the bend sits exactly at the chunk's leading edge and the whole
 * chunk beyond it is a straight run in the new direction - which is what
 * lets a single `route.getPositionAt`/`getDirectionAt` sample at the chunk's
 * start double as the placement frame for everything inside it.
 *
 * Points are only ever appended, never rewritten, which is what makes
 * rebuilding a fresh `RunPath` on every extend cheap to reason about: the
 * merge/corner algorithm in `RunPath` scans strictly left to right, so every
 * segment/junction that existed before the new point is unchanged by adding
 * one after it. `PlayerController.extendPath()` relies on exactly this to
 * swap the path in without resetting the runner's segment, lane or lateral
 * offset - see `tests/procedural.test.ts` for the index-stability check that
 * justifies it.
 */
export class RouteGrowth {
  private readonly points: THREE.Vector3[];
  private cursor: THREE.Vector3;
  private heading: THREE.Vector3;

  path: RunPath | null = null;

  constructor(startPosition: THREE.Vector3, startHeading: THREE.Vector3 = new THREE.Vector3(0, 0, 1)) {
    this.cursor = startPosition.clone();
    this.heading = startHeading.clone().setY(0).normalize();
    this.points = [this.cursor.clone()];
  }

  /** Arc length dealt so far. 0 until the first `extend()`. */
  get frontierDistance(): number {
    return this.path?.totalLength ?? 0;
  }

  /** Heading a newly-extended chunk starts with (after any turn is applied). */
  get currentHeading(): THREE.Vector3 {
    return this.heading;
  }

  /**
   * Extends the route by one chunk and rebuilds the path.
   * @returns the chunk's start distance and the rebuilt path.
   */
  extend(spec: ChunkSpec): { startDist: number; path: RunPath } {
    const startDist = this.frontierDistance;

    if (spec.turn) {
      const cos = Math.cos(spec.turn.deltaYaw);
      const sin = Math.sin(spec.turn.deltaYaw);
      // Rotates the heading by deltaYaw in the same yaw convention RunPath
      // uses (yaw = atan2(x, z)): increasing yaw swings +Z toward +X.
      const x = this.heading.x * cos + this.heading.z * sin;
      const z = -this.heading.x * sin + this.heading.z * cos;
      this.heading.set(x, 0, z).normalize();
    }

    this.cursor = this.cursor.clone().addScaledVector(this.heading, CHUNK_LENGTH);
    this.points.push(this.cursor.clone());

    this.path = new RunPath(this.points.map((p): Vec3 => [p.x, p.y, p.z]));
    return { startDist, path: this.path };
  }
}
