/**
 * Which way round a wheel goes on.
 *
 * A wheel only mounts one way: its axle socket has to face the block it hangs
 * off, and its suspension has to point at the ground. Every other orientation
 * of the 24 is either an invalid placement or a wheel lying on its side. That
 * left the player rotating a wheel with R until it stopped being red, which is
 * a puzzle with one answer — so the editor solves it instead, and these are the
 * rules it solves it with.
 *
 * Two of them, in order:
 * 1. The face the wheel was dropped against. The wheel needs a socket pointing
 *    back at that block; the first level turn that provides one wins, and level
 *    turns are tried across-the-rig axle first, so a wheel dropped on a flank
 *    mounts like a car wheel rather than a shopping-trolley castor.
 * 2. The wheels already on the rig. Wheels come in pairs and the player almost
 *    never wants the odd one out, so a wheel with nothing to hug copies its
 *    nearest neighbour — mirrored when it is going on the other flank.
 *
 * Both are advisory: the editor scans the orientations these return and takes
 * the first that actually places, so a rule that cannot know about some odd
 * corner of a build costs a fallback rather than a bad placement.
 */

import type { OrientationIndex, PartDefinition, PlacedPart, Vec3i, VehicleBlueprint } from './types.ts';
import {
  FACE_VECTORS,
  composeOrientations,
  orientationFromSteps,
  rotateFace,
  vecEquals,
} from './grid.ts';

/**
 * The four level turns, in preference order: the two that put the axle across
 * the rig (0°, 180°) before the two that put it fore-and-aft (90°, 270°).
 *
 * Only these four keep a wheel's suspension pointing down, so no other
 * orientation is ever worth offering.
 */
export const WHEEL_ORIENTATIONS: readonly OrientationIndex[] = [0, 2, 1, 3].map(
  (quarter) => orientationFromSteps(0, quarter, 0),
);

/** Half a turn — the same wheel, mounted on the other flank. */
const YAW_180 = orientationFromSteps(0, 2, 0);

/** The mirror of a mount: what this wheel looks like on the opposite flank. */
export function mirroredWheelOrientation(
  orient: OrientationIndex,
): OrientationIndex {
  return composeOrientations(YAW_180, orient);
}

/**
 * The orientation that points one of `def`'s sockets at `hostDir` — the
 * direction from the wheel's own cell to the block it is mounting on.
 *
 * Returns null when no level turn can face that way, which is every vertical
 * mount: a wheel has no socket on its top or bottom face, because a wheel bolted
 * to the underside of a block would have to stand its axle up to reach it.
 */
export function wheelMountOrientation(
  def: PartDefinition,
  hostDir: Vec3i,
): OrientationIndex | null {
  if (hostDir.y !== 0) return null;
  for (const orient of WHEEL_ORIENTATIONS) {
    for (const socket of def.sockets) {
      if (vecEquals(FACE_VECTORS[rotateFace(orient, socket.face)], hostDir)) {
        return orient;
      }
    }
  }
  return null;
}

/** Which flank of the rig a cell is on: -1 left, +1 right, 0 on the centreline. */
function flank(x: number, midX: number): number {
  const delta = x - midX;
  return Math.abs(delta) < 0.5 ? 0 : Math.sign(delta);
}

/**
 * The orientation the rig's existing wheels imply for a new wheel at `target`:
 * the nearest wheel's own orientation, mirrored if the new one is going on the
 * opposite flank. Null when the rig has no wheels yet to copy.
 */
export function wheelOrientationFromRig(
  bp: VehicleBlueprint,
  getDef: (defId: string) => PartDefinition,
  target: Vec3i,
): OrientationIndex | null {
  const wheels: PlacedPart[] = bp.parts.filter(
    (part) => getDef(part.defId).wheel !== undefined,
  );
  if (wheels.length === 0) return null;

  const xs = bp.parts.map((part) => part.pos.x);
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const targetFlank = flank(target.x, midX);

  // Nearest wheel, with one on the same flank always beating one across the
  // rig: a rear wheel two cells back on this side is a better guide than the
  // wheel directly opposite.
  let best: PlacedPart | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const wheel of wheels) {
    const dx = wheel.pos.x - target.x;
    const dy = wheel.pos.y - target.y;
    const dz = wheel.pos.z - target.z;
    const sameFlank = flank(wheel.pos.x, midX) === targetFlank;
    const score = dx * dx + dy * dy + dz * dz + (sameFlank ? 0 : 1000);
    if (score < bestScore) {
      bestScore = score;
      best = wheel;
    }
  }
  if (best === undefined) return null;

  // A wheel on the centreline (a motorcycle fork) is not a flank convention, so
  // nothing is mirrored into or out of it.
  const bestFlank = flank(best.pos.x, midX);
  const mirror =
    targetFlank !== 0 && bestFlank !== 0 && bestFlank !== targetFlank;
  return mirror ? mirroredWheelOrientation(best.orient) : best.orient;
}

/**
 * Every orientation worth trying for a wheel going in at `target`, best first:
 * the face it was dropped against, then what the rig's other wheels do, then
 * the remaining level turns as a backstop.
 *
 * `hostDir` is the direction from `target` to the block the wheel was dropped
 * against, or null when it was dropped in open space.
 */
export function wheelOrientationCandidates(
  bp: VehicleBlueprint,
  getDef: (defId: string) => PartDefinition,
  def: PartDefinition,
  target: Vec3i,
  hostDir: Vec3i | null,
): OrientationIndex[] {
  const ordered: (OrientationIndex | null)[] = [
    hostDir === null ? null : wheelMountOrientation(def, hostDir),
    wheelOrientationFromRig(bp, getDef, target),
    ...WHEEL_ORIENTATIONS,
  ];
  const candidates: OrientationIndex[] = [];
  for (const orient of ordered) {
    if (orient !== null && !candidates.includes(orient)) candidates.push(orient);
  }
  return candidates;
}
