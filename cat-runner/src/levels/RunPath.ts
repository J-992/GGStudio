import * as THREE from 'three';
import type { Vec3 } from './LevelTypes';
import type { RouteLike } from './RouteLike';
import { PHYSICS } from '../physics/PhysicsConfig';

/**
 * The runner's track: the level route reduced to straight segments joined by
 * classified corners.
 *
 * The chase route is a smooth Catmull-Rom spline, which is right for pursuers
 * that just advance a scalar and read a position. It is wrong for a lane runner,
 * because a runner does not follow a curve - it runs dead straight until the
 * player turns it, and running straight off the roof when they don't is the
 * whole point of a corner.
 *
 * So the polyline is simplified into straight runs, and each junction between
 * two runs is classified:
 *
 *   - `turn`  - a real corner. The player must double-tap into it or they carry
 *               straight on, off the edge.
 *   - `soft`  - a bend gentle enough to walk through. The heading eases into the
 *               new segment on its own with no input.
 *
 * The threshold between the two is what keeps all three levels playable
 * unchanged. Levels 1 and 3 each have exactly one 90-degree corner; level 2 has
 * no corner at all, just a 29-degree diagonal dogleg, and demanding a double-tap
 * for that would be unreadable.
 */

/** Consecutive route legs closer than this in heading merge into one run. */
const MERGE_TOLERANCE = THREE.MathUtils.degToRad(10);
/**
 * How far a junction must turn you before it counts as a corner.
 *
 * Set near a right angle deliberately. The brief is a double-tap for 90-degree
 * turns, and anything looser starts catching the sweeping diagonals that levels
 * 2 and 3 are built out of - bends the camera never presents as a decision, so
 * demanding an input for them just drops the player off a roof unfairly.
 */
const TURN_THRESHOLD = THREE.MathUtils.degToRad(70);
/** A run shorter than this may be absorbed into an adjacent corner. */
const MIN_RUN_LENGTH = 25;
/** How much path a corner is allowed to occupy before it is a curve, not a corner. */
const CORNER_SPAN = 60;
/** Below this the two centrelines are too parallel to intersect meaningfully. */
const MIN_INTERSECT_ANGLE = THREE.MathUtils.degToRad(20);

const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export type JunctionKind = 'soft' | 'turn';

export interface PathSegment {
  /** Distance along the whole path where this run begins. */
  startDist: number;
  length: number;
  /** Centreline start and end. */
  start: THREE.Vector3;
  end: THREE.Vector3;
  /** Horizontal unit heading. */
  dir: THREE.Vector3;
  /** Unit vector pointing to the runner's right. */
  right: THREE.Vector3;
  /** `atan2(dir.x, dir.z)`, matching the body yaw convention. */
  yaw: number;
}

export interface PathJunction {
  /** Index of the segment this junction leaves. */
  fromSegment: number;
  /** Distance along the path at the corner. */
  atDist: number;
  kind: JunctionKind;
  /** -1 for a left corner, +1 for a right one. */
  turnDir: -1 | 1;
  /** Signed heading change in radians. */
  deltaYaw: number;
  corner: THREE.Vector3;
}

/** Shortest signed angle from `a` to `b`. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function yawOf(dir: THREE.Vector3): number {
  return Math.atan2(dir.x, dir.z);
}

/**
 * Where two horizontal lines cross, or null if they are too close to parallel
 * for the answer to mean anything.
 */
function intersect(
  a: THREE.Vector3,
  u: THREE.Vector3,
  b: THREE.Vector3,
  v: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 | null {
  const denominator = u.x * v.z - u.z * v.x;
  if (Math.abs(denominator) < 1e-4) return null;

  const t = ((b.x - a.x) * v.z - (b.z - a.z) * v.x) / denominator;
  return out.set(a.x + u.x * t, a.y, a.z + u.z * t);
}

export class RunPath implements RouteLike {
  readonly segments: PathSegment[] = [];
  readonly junctions: PathJunction[] = [];
  readonly totalLength: number;

  constructor(routePoints: readonly Vec3[]) {
    if (routePoints.length < 2) {
      throw new Error('RunPath needs at least two route points');
    }

    const points = routePoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));

    // --- 1. Merge the route legs into straight runs -------------------------
    // Each run is compared against its own first leg, so a run bends by at most
    // MERGE_TOLERANCE from the direction it committed to.
    const breaks: number[] = [0];
    let runYaw: number | null = null;

    for (let i = 0; i < points.length - 1; i++) {
      _d.subVectors(points[i + 1], points[i]);
      _d.y = 0;
      if (_d.lengthSq() < 1e-8) continue;
      const legYaw = yawOf(_d.normalize());

      if (runYaw === null) {
        runYaw = legYaw;
      } else if (Math.abs(wrapAngle(legYaw - runYaw)) > MERGE_TOLERANCE) {
        breaks.push(i);
        runYaw = legYaw;
      }
    }
    breaks.push(points.length - 1);

    // --- 2. Provisional runs, from chord directions -------------------------
    interface Chord {
      from: THREE.Vector3;
      to: THREE.Vector3;
      dir: THREE.Vector3;
      length: number;
    }

    const provisional: Chord[] = [];
    for (let i = 0; i < breaks.length - 1; i++) {
      const from = points[breaks[i]];
      const to = points[breaks[i + 1]];
      const dir = new THREE.Vector3().subVectors(to, from);
      dir.y = 0;
      const length = dir.length();
      if (length < 1e-6) continue;
      provisional.push({ from, to, dir: dir.divideScalar(length), length });
    }

    // --- 3. Collapse the stubs inside corners -------------------------------
    // A corner is authored as two or three control points easing round the bend,
    // which simplifies into a cluster of stubby runs turning 30-50 degrees each.
    // Left alone the corner dissolves into a series of soft bends. Dropping the
    // cluster puts the corner back - but only when the cluster really is one, so
    // the test is how far it turns you, not how long it is. Level 3's sign
    // district looks identical by length and is a 67-degree sweep; chording
    // straight through it would leave the track 36 units off its own rooftops.
    const chords: Chord[] = [];
    let index = 0;

    while (index < provisional.length) {
      const chord = provisional[index];
      const isEndpoint = index === 0 || index === provisional.length - 1;

      if (isEndpoint || chord.length >= MIN_RUN_LENGTH) {
        chords.push(chord);
        index++;
        continue;
      }

      // The maximal cluster of stubs starting here, never eating the last run.
      let end = index;
      let span = 0;
      while (end < provisional.length - 1 && provisional[end].length < MIN_RUN_LENGTH) {
        span += provisional[end].length;
        end++;
      }

      const previous = chords[chords.length - 1];
      const next = provisional[end];
      const swing =
        previous && next
          ? Math.abs(wrapAngle(yawOf(next.dir) - yawOf(previous.dir)))
          : 0;

      if (previous && next && swing >= TURN_THRESHOLD && span <= CORNER_SPAN) {
        index = end;
      } else {
        for (let i = index; i < end; i++) chords.push(provisional[i]);
        index = end;
      }
    }

    // --- 4. Corners ---------------------------------------------------------
    // A real corner sits where the two centrelines actually cross - that is the
    // point the runner has to reach to make the turn, and it is generally not
    // any authored route point. Near-parallel runs get the midpoint of the span
    // instead, because intersecting them would put the "corner" hundreds of
    // units away.
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < chords.length - 1; i++) {
      const delta = wrapAngle(yawOf(chords[i + 1].dir) - yawOf(chords[i].dir));

      const crossing =
        Math.abs(delta) >= MIN_INTERSECT_ANGLE
          ? intersect(
              chords[i].from,
              chords[i].dir,
              chords[i + 1].from,
              chords[i + 1].dir,
              new THREE.Vector3(),
            )
          : null;

      corners.push(
        crossing ??
          new THREE.Vector3().addVectors(chords[i].to, chords[i + 1].from).multiplyScalar(0.5),
      );
    }

    // --- 5. Re-anchor the runs through those corners ------------------------
    const nodes: THREE.Vector3[] = [chords[0].from.clone(), ...corners];
    nodes.push(chords[chords.length - 1].to.clone());

    let cumulative = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      const start = nodes[i];
      const end = nodes[i + 1];

      const dir = new THREE.Vector3().subVectors(end, start);
      dir.y = 0;
      const length = dir.length();
      if (length < 1e-6) continue;
      dir.divideScalar(length);

      const yaw = yawOf(dir);
      this.segments.push({
        startDist: cumulative,
        length,
        start: start.clone(),
        end: end.clone(),
        dir,
        // The runner's right is SCREEN right, which is `dir x up`, not `up x dir`.
        // three.js cameras look down their local -Z, so a trailing camera framing
        // a runner heading `dir` has z_axis = -dir and x_axis = up x z_axis. For
        // dir = +Z that is (-1,0,0): screen-right is -X, NOT +X.
        //
        // This was inverted, and because every input source funnels through the
        // same lane offset, it inverted lane switching on keyboard, gamepad and
        // touch at once.
        right: new THREE.Vector3(-dir.z, 0, dir.x),
        yaw,
      });
      cumulative += length;
    }

    this.totalLength = cumulative;

    // --- 6. Classify the junctions -----------------------------------------
    for (let i = 0; i < this.segments.length - 1; i++) {
      const deltaYaw = wrapAngle(this.segments[i + 1].yaw - this.segments[i].yaw);
      this.junctions.push({
        fromSegment: i,
        atDist: this.segments[i + 1].startDist,
        kind: Math.abs(deltaYaw) >= TURN_THRESHOLD ? 'turn' : 'soft',
        // yaw = atan2(dir.x, dir.z), so increasing yaw swings the heading from
        // +Z toward +X - and +X is the runner's LEFT (see `right` above). Same
        // handedness error as the lane offset, so it inverted corner double-taps
        // in lockstep with lane switching.
        turnDir: deltaYaw >= 0 ? -1 : 1,
        deltaYaw,
        corner: this.segments[i].end.clone(),
      });
    }
  }

  /**
   * A single dead-straight run along +Z. The endless track's lane geometry.
   *
   * Two control points collapse to one segment and therefore zero junctions,
   * which switches the whole corner machinery off without deleting any of it:
   * `junctionAfter(0)` returns null, so `PlayerController.trackProgress()`
   * breaks out of its walk on the first iteration and clears `inTurnZone` /
   * `pendingTurn`, and `applyTurnInput()` early-returns. Turn chunks can be
   * added later by appending route points; nothing has to be rebuilt.
   *
   * The constant heading is also what makes chunk expansion a pure
   * translation - `right` is `(-1, 0, 0)` everywhere on this path, so a lane
   * offset is just `x = -lane * laneSpacing` with no yaw or spline maths, and
   * with it goes a whole family of sign bugs.
   */
  static straight(length: number, y = 0, startZ = 0): RunPath {
    return new RunPath([
      [0, y, startZ],
      [0, y, startZ + length],
    ]);
  }

  /** The junction leaving a segment, or null at the end of the path. */
  junctionAfter(segmentIndex: number): PathJunction | null {
    return this.junctions[segmentIndex] ?? null;
  }

  /** How far along a segment a world position sits, measured from its start. */
  alongOf(segmentIndex: number, position: THREE.Vector3): number {
    const segment = this.segments[segmentIndex];
    if (!segment) return 0;
    _u.subVectors(position, segment.start);
    return _u.x * segment.dir.x + _u.z * segment.dir.z;
  }

  /** Signed offset from a segment's centreline, positive to the right. */
  lateralOf(segmentIndex: number, position: THREE.Vector3): number {
    const segment = this.segments[segmentIndex];
    if (!segment) return 0;
    _u.subVectors(position, segment.start);
    return _u.x * segment.right.x + _u.z * segment.right.z;
  }

  /** Centreline point a given distance along a segment. */
  centreAt(segmentIndex: number, along: number, out: THREE.Vector3): THREE.Vector3 {
    const segment = this.segments[segmentIndex];
    if (!segment) return out.set(0, 0, 0);
    return out.copy(segment.start).addScaledVector(segment.dir, along);
  }

  /**
   * The segment a world position is closest to.
   *
   * Only used when placing the runner - respawns, spawns, and the initial
   * segment lock. The running controller advances its own index instead, so
   * that a missed corner keeps it on the old segment and carries it off the
   * roof rather than silently snapping it round the bend.
   */
  nearestSegment(position: THREE.Vector3): number {
    let best = 0;
    let bestSq = Infinity;

    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i];
      const along = THREE.MathUtils.clamp(this.alongOf(i, position), 0, segment.length);
      _v.copy(segment.start).addScaledVector(segment.dir, along);
      const sq = (_v.x - position.x) ** 2 + (_v.z - position.z) ** 2;
      if (sq < bestSq) {
        bestSq = sq;
        best = i;
      }
    }

    return best;
  }

  /**
   * Horizontal distance from a world position to the nearest point ON the track,
   * with the track treated as a set of finite segments rather than infinite
   * lines.
   *
   * Measuring against the route's bounding centroid instead is what once put a
   * background tower across all three lanes at the start of level 1: on any
   * route that is not a straight line the centroid can sit a long way off the
   * track, so a ring drawn around it passes straight through the play area.
   * That skyline is gone, but the distinction is the kind anything placing
   * geometry near the track has to get right, so the measurement stays.
   */
  lateralDistanceTo(position: THREE.Vector3): number {
    let bestSq = Infinity;

    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i];
      const along = THREE.MathUtils.clamp(this.alongOf(i, position), 0, segment.length);
      _v.copy(segment.start).addScaledVector(segment.dir, along);
      const sq = (_v.x - position.x) ** 2 + (_v.z - position.z) ** 2;
      if (sq < bestSq) bestSq = sq;
    }

    return bestSq === Infinity ? Infinity : Math.sqrt(bestSq);
  }

  // -------------------------------------------------------------------------
  // RouteLike
  //
  // The pursuers and the progress measurement run on this rather than on the
  // ChaseRoute spline. That used to be a distinction without a difference -
  // roofs were wide enough that both curves sat comfortably on them - but the
  // deck is three lanes now, and the spline cuts level 1's corner by six units.
  // Against a 7.2-wide deck that is a chase visibly running through open air.
  //
  // One track, everything on it. The player is *prescribed* onto these
  // segments, so this is also the only curve that answers "how far along is
  // the cat" in a way the cat agrees with.
  // -------------------------------------------------------------------------

  /**
   * World position at an arc length.
   *
   * Extrapolated past both ends along the end segment's own direction rather
   * than clamped - pursuers start at a negative distance, and clamping would
   * stack all of them on the first point of the track.
   */
  getPositionAt(distance: number, out: THREE.Vector3): THREE.Vector3 {
    const index = this.segmentAt(distance);
    const segment = this.segments[index];
    if (!segment) return out.set(0, 0, 0);
    return out
      .copy(segment.start)
      .addScaledVector(segment.dir, distance - segment.startDist);
  }

  getDirectionAt(distance: number, out: THREE.Vector3): THREE.Vector3 {
    const segment = this.segments[this.segmentAt(distance)];
    return segment ? out.copy(segment.dir) : out.set(0, 0, 1);
  }

  /** Projects a world position onto the track and returns its arc length. */
  projectDistance(position: THREE.Vector3): number {
    const index = this.nearestSegment(position);
    const segment = this.segments[index];
    if (!segment) return 0;
    return segment.startDist + this.alongOf(index, position);
  }

  progressAt(position: THREE.Vector3): number {
    if (this.totalLength <= 0) return 0;
    return THREE.MathUtils.clamp(this.projectDistance(position) / this.totalLength, 0, 1);
  }

  /** How far a position sits from the track. Detects off-route play. */
  distanceFromRoute(position: THREE.Vector3): number {
    return this.lateralDistanceTo(position);
  }

  /** Which segment an arc length falls in, clamped to the ends for extrapolation. */
  private segmentAt(distance: number): number {
    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i];
      if (distance < segment.startDist + segment.length) return i;
    }
    return this.segments.length - 1;
  }

  /** Debug visualisation of the track and its lanes. Caller owns disposal. */
  createDebugLine(color = 0xffcc33): THREE.Line {
    const laneSpacing = PHYSICS.laneSpacing;
    const points: THREE.Vector3[] = [];
    for (const lane of [-1, 0, 1]) {
      for (const segment of this.segments) {
        points.push(
          segment.start.clone().addScaledVector(segment.right, lane * laneSpacing),
          segment.end.clone().addScaledVector(segment.right, lane * laneSpacing),
        );
      }
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, depthTest: false });
    const line = new THREE.LineSegments(geometry, material) as unknown as THREE.Line;
    line.renderOrder = 999;
    return line;
  }
}
