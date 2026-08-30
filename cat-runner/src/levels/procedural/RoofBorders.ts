import * as THREE from 'three';
import { brickBorderMaterialForChunk } from './RoofBrickMaterials';
import { DECK_A_LENGTH, DECK_B_LENGTH, DECK_WIDTH, GAP_LENGTH } from './ChunkTypes';

/**
 * Low, non-obstacle rooftop-edge borders along both sides of the playable
 * deck - the thing that makes the rooftop read as a real roof with an edge,
 * rather than a platform with nothing marking where it stops.
 *
 * Visual only, no collider: kept well inside the deck's own edge and well
 * outside the lane span (the same margin convention `RoofFeatures`'s roof
 * props already use), so it can never obstruct an obstacle, a lane change,
 * or the camera. Presence mirrors deck-piece presence exactly - a pair
 * (left/right) for deck A, deck B, and (only when there's no gap) deck C,
 * all placed at that piece's own tier height, so a gap correctly has no
 * border spanning it and a mixed-height gap gets borders at each side's own
 * height. A turn additionally gets an outside-only corner border - see
 * `placeCorner()` below for why that one isn't a plain pair.
 *
 * Colour matches whichever brick colour `RoofBrickMaterials.ts` picked for
 * that chunk's building (`brickBorderMaterialForChunk`), so the border, the
 * roof surface, and the facade below all read as one coordinated building -
 * not a second, independent colour roll.
 *
 * The turn corner is NOT a `BorderPair` like A/B/C: those are straight
 * rectangular deck pieces, so a symmetric pair of parallel rails offset
 * either side of the centreline is the right shape. The corner-fill patch
 * (see `ChunkBuilder.placeChunk`'s own "missing square" comment) is instead
 * a `DECK_WIDTH/2` square sitting entirely to one side and behind the
 * chunk's own start - reusing the parallel-pair logic on it produced rails
 * along the wrong axis, clipping into the deck and each other (the bug this
 * module's corner handling exists to fix). The outside gets an L - two
 * single rails at a right angle, not a pair - built by `placeCorner()` below.
 *
 * The *inside* of the pivot has no missing square (the deck itself is
 * genuinely flush there - see `ChunkBuilder.placeBuildings`'s own doc
 * comment on why that's true for the deck but not for the building row
 * sitting on top of it), but the two straight `BorderPair`s either side of
 * the pivot - this chunk's own inside rail and the previous chunk's - are
 * each inset `BORDER_X` from the deck edge along their *own* frame's `left`,
 * and those two frames are 90 degrees apart. Insetting along two different
 * directions from the same shared corner point leaves their near ends short
 * of each other by roughly that inset - not a hole in the deck, but a real
 * gap/mismatch in the border tracing right at the corner, which is what
 * reads as the border "not following the turn" or dipping to the bare deck
 * momentarily. `placeCorner()`'s own L already handles exactly this shape of
 * problem for the outside; calling it a second time with the turn direction
 * negated - see `placeInnerCorner()` - places the same L mirrored onto the
 * inside, closing that gap with a rail in the same style rather than a new
 * shape.
 */

const BORDER_HEIGHT = 0.4;
const BORDER_WIDTH = 0.25;
/** How far in from the deck's own edge the border sits - never flush with
 *  it, so the rail reads as sitting *on* the roof rather than as the roof's
 *  own edge trim. */
const BORDER_INSET = 0.15;

/** Distance from the centreline to a border's own centre - well outside
 *  `PHYSICS.laneSpacing` (2.4) and well inside `DECK_WIDTH / 2` (7), the
 *  same "never has to be avoided" margin `RoofFeatures.PROP_X_OFFSET`
 *  already relies on. */
const BORDER_X = DECK_WIDTH / 2 - BORDER_WIDTH / 2 - BORDER_INSET;

const borderGeometry = new THREE.BoxGeometry(1, 1, 1);
const UP_AXIS = new THREE.Vector3(0, 1, 0);

export interface BorderPair {
  readonly left: THREE.Mesh;
  readonly right: THREE.Mesh;
}

/** The turn corner's own outside-only L, not a symmetric pair - see the
 *  module doc comment. `outer` runs along the chunk's forward axis (like
 *  every `BorderPair` rail); `back` runs along its *lateral* axis instead,
 *  the one rail in this module that isn't parallel to `frame.dir`. */
export interface CornerBorder {
  readonly outer: THREE.Mesh;
  readonly back: THREE.Mesh;
}

export interface RoofBorderRig {
  /**
   * The ten rails, drawn as one.
   *
   * A rail is a box, every rail in a chunk wears the same brick material
   * (`brickBorderMaterialForChunk`), and there are ten of them per live
   * streamer slot - which as individual meshes was ~80 draw calls a frame
   * across the streamed window, the largest line item left in the frame
   * after the skyline and the fish coins were batched. The `THREE.Mesh`
   * fields below survive as the *transform holders* they always were - every
   * `place*` method still writes position/quaternion/scale/visible onto
   * them, and callers and tests still read them - but they are no longer
   * parented to the scene. This is, and it copies their matrices in from
   * `onBeforeRender`, exactly as the fish-coin batch does (see
   * `Collectible.ts`, which carries the full reasoning).
   */
  readonly batch: THREE.InstancedMesh;
  readonly a: BorderPair;
  readonly b: BorderPair;
  readonly c: BorderPair;
  readonly corner: CornerBorder;
  /** The same L shape as `corner`, mirrored onto the *inside* of the pivot -
   *  see the module doc comment and `placeInnerCorner()`. */
  readonly innerCorner: CornerBorder;
}

function buildRail(): THREE.Mesh {
  const mesh = new THREE.Mesh(borderGeometry);
  mesh.visible = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildPair(): BorderPair {
  return { left: buildRail(), right: buildRail() };
}

function buildCorner(): CornerBorder {
  return { outer: buildRail(), back: buildRail() };
}

/** Every mesh in a rig, whatever role it belongs to - the one place that
 *  needs to know both shapes exist, so adding/hiding/disposing don't. */
function allRails(rig: RoofBorderRig): THREE.Mesh[] {
  return [
    rig.a.left,
    rig.a.right,
    rig.b.left,
    rig.b.right,
    rig.c.left,
    rig.c.right,
    rig.corner.outer,
    rig.corner.back,
    rig.innerCorner.outer,
    rig.innerCorner.back,
  ];
}

/** A rail that is not currently placed, collapsed to nothing. Parked at the
 *  rail's own last position rather than the origin so the batch's own bounds
 *  stay local to the chunk. */
const _hidden = new THREE.Matrix4();

/** Pushes the ten holder transforms into the batch's instance buffer. */
function syncRig(rig: RoofBorderRig): void {
  const rails = allRails(rig);
  for (let i = 0; i < rails.length; i++) {
    const rail = rails[i];
    if (rail.visible) {
      rail.updateMatrix();
      rig.batch.setMatrixAt(i, rail.matrix);
    } else {
      rig.batch.setMatrixAt(i, _hidden.makeScale(0, 0, 0).setPosition(rail.position));
    }
  }
  rig.batch.instanceMatrix.needsUpdate = true;
}

export class RoofBorderPool {
  private readonly rigs = new Map<number, RoofBorderRig>();
  /** Which rig a `place*` call's pair/corner belongs to, so those methods can
   *  keep taking just the role they place - as they and their tests always
   *  have - while still reaching the one batch that draws it. */
  private readonly ownerOf = new Map<BorderPair | CornerBorder, RoofBorderRig>();

  constructor(private readonly scene: THREE.Object3D) {}

  rigFor(slot: number): RoofBorderRig {
    const existing = this.rigs.get(slot);
    if (existing) return existing;

    const pairs = {
      a: buildPair(),
      b: buildPair(),
      c: buildPair(),
      corner: buildCorner(),
      innerCorner: buildCorner(),
    };
    const railCount = allRails(pairs as RoofBorderRig).length;
    const batch = new THREE.InstancedMesh(
      borderGeometry,
      brickBorderMaterialForChunk(0),
      railCount,
    );
    // The batch spans one chunk's worth of rails and is hidden outright
    // whenever that chunk isn't placed, so a per-frame bounds recompute would
    // buy nothing over just submitting ten small boxes.
    batch.frustumCulled = false;
    batch.visible = false;
    batch.castShadow = true;
    batch.receiveShadow = true;

    const rig: RoofBorderRig = { batch, ...pairs };
    batch.onBeforeRender = () => syncRig(rig);
    this.scene.add(batch);
    this.rigs.set(slot, rig);
    for (const role of [rig.a, rig.b, rig.c, rig.corner, rig.innerCorner]) {
      this.ownerOf.set(role, rig);
    }
    return rig;
  }

  /** Re-points a rig's single batch at whichever brick material this chunk
   *  rolled, and un-parks it. Every rail in a chunk shares one material, so
   *  this is set from the placement rather than reconciled per rail. */
  private activate(role: BorderPair | CornerBorder, material: THREE.Material): void {
    const rig = this.ownerOf.get(role);
    if (!rig) return;
    rig.batch.material = material;
    rig.batch.visible = true;
  }

  /**
   * `centre` is the deck piece's own centre at its own tier height (whatever
   * the caller's `at`/`atPrev` produced), `length` that piece's real depth -
   * mirrors `ChunkBuilder`'s deck placement exactly, just offset sideways
   * and up onto the rail's own footprint.
   */
  place(
    pair: BorderPair,
    centre: THREE.Vector3,
    quaternion: THREE.Quaternion,
    left: THREE.Vector3,
    length: number,
    chunkIndex: number,
  ): void {
    const material = brickBorderMaterialForChunk(chunkIndex);
    this.activate(pair, material);
    for (const [mesh, side] of [
      [pair.left, 1],
      [pair.right, -1],
    ] as const) {
      mesh.visible = true;
      mesh.material = material;
      mesh.scale.set(BORDER_WIDTH, BORDER_HEIGHT, length);
      mesh.position.copy(centre).addScaledVector(left, side * BORDER_X);
      mesh.position.y += BORDER_HEIGHT / 2;
      mesh.quaternion.copy(quaternion);
    }
  }

  hide(pair: BorderPair): void {
    pair.left.visible = false;
    pair.right.visible = false;
  }

  hideCorner(corner: CornerBorder): void {
    corner.outer.visible = false;
    corner.back.visible = false;
  }

  hideAll(slot: number): void {
    const rig = this.rigs.get(slot);
    if (!rig) return;
    // Recycled slot: park the whole batch rather than leaving ten zero-scale
    // instances to be submitted every frame.
    rig.batch.visible = false;
    this.hide(rig.a);
    this.hide(rig.b);
    this.hide(rig.c);
    this.hideCorner(rig.corner);
    this.hideCorner(rig.innerCorner);
  }

  /**
   * The turn's outer corner border - an L traced around the *outside* of the
   * missing square only (see the module doc comment for why the inside needs
   * nothing). `centre` is the chunk's own local origin at its roof height
   * (i.e. the pivot point, `at(0, 0, 0)` in `ChunkBuilder`'s terms) - both
   * rails are offset from it along `frame.left`/`frame.dir`, mirroring how
   * every other rail here is offset from its own deck piece's centre.
   *
   * `turnDir` is `spec.turn.dir` unchanged - its sign is the OUTSIDE of the
   * turn, the same convention `ChunkBuilder`'s `cornerFill` placement and
   * `generateCornerBuilding` already use, so this needs no re-derivation.
   */
  placeCorner(
    corner: CornerBorder,
    centre: THREE.Vector3,
    quaternion: THREE.Quaternion,
    dir: THREE.Vector3,
    left: THREE.Vector3,
    turnDir: -1 | 1,
    chunkIndex: number,
  ): void {
    const material = brickBorderMaterialForChunk(chunkIndex);
    this.activate(corner, material);
    const size = DECK_WIDTH / 2; // the corner-fill square's own side length
    const inset = size - BORDER_WIDTH / 2 - BORDER_INSET; // same margin BORDER_X uses, for this square's edge

    // Runs along the chunk's forward axis, at the outside X edge, from the
    // square's back (z = -size) up to the pivot (z = 0) - where deck A's own
    // outside rail picks up.
    corner.outer.visible = true;
    corner.outer.material = material;
    corner.outer.scale.set(BORDER_WIDTH, BORDER_HEIGHT, size);
    corner.outer.position.copy(centre).addScaledVector(left, turnDir * inset).addScaledVector(dir, -size / 2);
    corner.outer.position.y += BORDER_HEIGHT / 2;
    corner.outer.quaternion.copy(quaternion);

    // Runs along the chunk's LATERAL axis instead - the one rail here not
    // parallel to `dir` - at the square's back Z edge, from the centreline
    // out to the outside edge. An extra 90-degree spin (about world up)
    // re-aims the box's own long (local Z) axis at `left` rather than `dir`;
    // which direction the spin goes doesn't matter for a box symmetric about
    // its own length axis.
    const lateralSpin = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, Math.PI / 2);
    corner.back.visible = true;
    corner.back.material = material;
    corner.back.scale.set(BORDER_WIDTH, BORDER_HEIGHT, size);
    corner.back.position.copy(centre).addScaledVector(left, (turnDir * size) / 2).addScaledVector(dir, -inset);
    corner.back.position.y += BORDER_HEIGHT / 2;
    corner.back.quaternion.copy(quaternion).multiply(lateralSpin);

    // Deliberately overlapping by roughly BORDER_WIDTH at the shared corner
    // rather than mitring exactly - fine at this low-poly scale, and far
    // more robust than exact corner math.
  }

  /**
   * The same L as `placeCorner()`, mirrored onto the *inside* of the pivot -
   * see the module doc comment for the gap this closes. Literally
   * `placeCorner()` with the turn direction negated: the outer L already
   * handles both signs of `turnDir` symmetrically (see its own tests), so
   * tracing the inside is exactly that same shape pointed at `-turnDir`
   * rather than a second, separately-derived geometry.
   */
  placeInnerCorner(
    corner: CornerBorder,
    centre: THREE.Vector3,
    quaternion: THREE.Quaternion,
    dir: THREE.Vector3,
    left: THREE.Vector3,
    turnDir: -1 | 1,
    chunkIndex: number,
  ): void {
    this.placeCorner(corner, centre, quaternion, dir, left, (-turnDir) as -1 | 1, chunkIndex);
  }

  dispose(): void {
    for (const rig of this.rigs.values()) {
      // `borderGeometry` and the brick materials are both module/cache-owned;
      // the InstancedMesh's own instance buffer is not, and `dispose()` is
      // what frees it.
      rig.batch.removeFromParent();
      rig.batch.dispose();
      for (const mesh of allRails(rig)) mesh.removeFromParent();
    }
    this.rigs.clear();
    this.ownerOf.clear();
  }
}

/** Real-world lengths for each deck-piece role - re-exported here so
 *  `ChunkBuilder` doesn't need a second import just for these three. */
export const BORDER_LENGTH = { a: DECK_A_LENGTH, b: DECK_B_LENGTH, c: GAP_LENGTH, corner: DECK_WIDTH / 2 } as const;

export function disposeRoofBorderAssets(): void {
  borderGeometry.dispose();
}
