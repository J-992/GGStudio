import * as THREE from 'three';
import { getMaterial, PALETTE } from '../../assets/ProceduralProps';
import { unitBoxGeometry } from './PlaceholderAssets';
import { getWindowMaterial, WINDOW_PATTERN_COUNT } from './BuildingWindows';
import { CHUNK_LENGTH, DECK_WIDTH } from '../TrackConfig';

/**
 * The skyline flanking the track: two rows of simple boxes, one on each side
 * of the deck, running the whole length of every chunk.
 *
 * -------------------------------------------------------------------------
 * WHY THIS ISN'T THE OLD SKYLINE
 * -------------------------------------------------------------------------
 * `LevelTypes.ts`'s `BackgroundDef` doc comment (and `RunPath.lateralDistanceTo`'s)
 * describe an earlier scattered instanced skyline that was removed for two
 * reasons: it cost about half the frame's triangles sitting behind opaque
 * fog, and it was positioned by distance-from-route-centroid, which on a
 * turning route can sit a long way off the actual track and once dropped a
 * tower across all three lanes.
 *
 * This is a different shape of solution, not a revival of that one:
 *
 *  - Placement is chunk-local, exactly like every obstacle/fish/power-up
 *    already is (`ChunkBuilder.localToWorld`) - never a route-wide radius
 *    check. A building's lateral offset is a constant measured out from the
 *    deck edge (`NEAR_FACE_OFFSET`), so it is geometrically impossible for
 *    one to land on the deck regardless of where the route bends, the same
 *    way an obstacle's `laneX()` offset can never land off the deck.
 *  - Geometry is one shared unit box (`PlaceholderAssets.unitBoxGeometry`)
 *    scaled per instance, and colour comes from `ProceduralProps.getMaterial`'s
 *    cache - a handful of materials total, reused across every building on
 *    the track, not per-instance geometry.
 *  - A fixed, small count per chunk (`BUILDINGS_PER_SIDE`) pooled one rig per
 *    streamer slot, the same "built once, only ever repositioned" contract
 *    `ObstaclePool`/`PowerUpPool` already use - not an unbounded scatter.
 *
 * -------------------------------------------------------------------------
 * THE SKYLINE PATTERN
 * -------------------------------------------------------------------------
 * Height, footprint and colour all come from a pure function of a building's
 * *global* index along the route (`chunkIndex * BUILDINGS_PER_SIDE + slot`),
 * not from per-chunk randomness. That is what makes the pattern continuous
 * across a chunk boundary with no cross-chunk coordination: chunk N's last
 * building and chunk N+1's first building are consecutive global indices,
 * so the short/medium/tall cycle (`HEIGHT_PATTERN`) and the small jitter on
 * top of it line up automatically. Each side of the track runs its own
 * independent sequence.
 */

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Small, constant clearance between the deck edge and the nearest building
 *  face - buildings are decoration, and this is what keeps them reading as
 *  "lining the street" rather than "leaning over the track." Exported for
 *  the "never overlaps the deck" test - the safety-critical invariant this
 *  whole module exists to guarantee by construction. */
export const GAP_FROM_DECK = 4;
/** Lateral distance from the track centreline to a building's *near* face.
 *  Every building's centre is derived from this plus half its own width, so
 *  varying width never changes how close a building gets to the track. */
const NEAR_FACE_OFFSET = DECK_WIDTH / 2 + GAP_FROM_DECK;

/** How many buildings each side contributes per chunk. Fixed - this is a
 *  pooled rig size, not a per-chunk choice (see `ObstaclePool.ts`'s own
 *  doc comment for why every role is a constant count). */
export const BUILDINGS_PER_SIDE = 2;
/** Along-track footprint each building slot is allotted. */
const SLOT_SPAN = CHUNK_LENGTH / BUILDINGS_PER_SIDE;

/** Nominal building footprint, jittered per instance - see `jitter()`. */
const WIDTH_BASE = 10; // lateral thickness, into the skyline
const WIDTH_JITTER = 2;
const DEPTH_BASE = SLOT_SPAN - 3; // along-track footprint, leaving a gap to the next
const DEPTH_JITTER = 1.5;

/** How far a building's base sits below `TRACK_Y` - just needs to read as
 *  "grounded" from the camera's own vantage, not reach literal street level. */
const BUILDING_BELOW_TRACK = 45;

/**
 * Roof height above `TRACK_Y`, cycling short/medium/tall/medium/short/tall
 * per the requested pattern rather than picking a fresh random height every
 * time - a real skyline reads as a rhythm, not noise.
 *
 * Kept low on purpose: tall enough to still silhouette against the sky and
 * read as a skyline, short enough that nothing looms over the camera, which
 * sits well above the deck (see `FollowCamera.DEFAULT_CAMERA.height`).
 */
export const HEIGHT_PATTERN: readonly number[] = [2, 6, 10, 6, 2, 10];
export const HEIGHT_JITTER = 1.5;

/** Reused across every building - a handful of materials, not one per
 *  instance. The six Candy City building colours, randomly (well,
 *  index-cyclically - see `generateBuildingRow`) assigned per building per
 *  the request. */
export const BUILDING_COLORS: readonly number[] = [
  PALETTE.coastalTeal,
  PALETTE.coastalPeach,
  PALETTE.coastalYellow,
  PALETTE.coastalBlue,
  PALETTE.coastalCream,
  PALETTE.coastalLavender,
];

/**
 * Extra building bridging a 90-degree turn's outside corner - the same gap
 * `ChunkBuilder`'s own `cornerFill` deck patch exists for, one size class
 * further out.
 *
 * Matched to that patch's own reach (`DECK_WIDTH / 2`, centred at
 * `DECK_WIDTH / 4` back from the pivot - see `ChunkBuilder.placeChunk`'s
 * `cornerFill` placement) rather than picked freely: this building is placed
 * using the *current* (post-turn, new-heading) chunk's frame, which only
 * agrees with the previous chunk's actual (old-heading) deck geometry very
 * close to the shared pivot point - the two frames diverge with distance
 * from it. The old span (18, centred 9 back) reached far enough past that
 * safe zone to plausibly land the building on top of the previous chunk's
 * real, playable deck near a turn. Sized to the patch it bridges, the error
 * stays negligible by the same reasoning that makes the patch itself safe.
 */
const CORNER_HALF_SPAN = DECK_WIDTH / 2;
const CORNER_WIDTH = WIDTH_BASE + 4;

/** One building's local placement - `ChunkBuilder` converts this to a world
 *  position/quaternion via its own `localToWorld`, the same as every other
 *  chunk-local placement (obstacles, fish, power-ups). */
export interface BuildingPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly color: number;
  /** Which of `BuildingWindows`'s reusable window patterns this building's
   *  side faces wear. */
  readonly pattern: number;
}

/** Deterministic per-building PRNG - stable across rebuilds/recycles, unlike
 *  `Math.random`, so a given point on the route always looks the same. */
function jitterRng(chunkIndex: number, side: -1 | 1, slot: number): () => number {
  let state = ((chunkIndex * 4177 + slot * 977 + (side > 0 ? 131 : 271)) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function jitter(rng: () => number, amount: number): number {
  return (rng() * 2 - 1) * amount;
}

/** Always-positive modulo, so a negative (bootstrap) chunk index still lands
 *  a valid pattern step. */
function positiveMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * The `BUILDINGS_PER_SIDE` placements for one side of one chunk, or `null`
 * for a slot deliberately left empty - see `suppressNearPivotSlot` below.
 *
 * @param chunkIndex stable per-chunk index (`ChunkPlacement.index`) - the
 *   basis for both the global height-pattern step and the per-building seed.
 * @param side +1 or -1, the two lateral directions off the track centreline.
 * @param suppressNearPivotSlot true when this side is the *inside* of a turn
 *   this chunk makes - see `ChunkBuilder.placeBuildings`'s own doc comment
 *   for the geometry. Mapped into this chunk's rotated frame, the previous
 *   chunk's deck (and every chunk behind it) covers local Z in
 *   `[-DECK_WIDTH / 2, DECK_WIDTH / 2]` at negative local X - the whole band
 *   this side's row runs through. Slot 0 (nearest this chunk's own start, Z
 *   in `[0, SLOT_SPAN]`) sits squarely inside that band and is dropped
 *   outright.
 *
 *   Slot 1 was assumed to sit clear of it regardless. It very nearly does:
 *   its nominal near face is at Z 9, but its own jitter (up to 1.5 units of
 *   position plus up to 0.75 of half-depth) can pull that down to 6.75 -
 *   just inside `DECK_WIDTH / 2` (7), which is a real, if slivered, overlap
 *   with the deck's far corner, and one a full `ChunkBuilder` walk does
 *   eventually turn up. So instead of being suppressed too (which would
 *   leave a whole chunk of the inside of every corner conspicuously empty),
 *   it is pushed forward just far enough for its near face to clear that
 *   band by the same {@link GAP_FROM_DECK} every other building keeps from a
 *   deck edge - at most ~4 units, and usually none at all.
 *
 *   Both are handled here, at generation time, rather than by culling an
 *   overlap after the fact: that is what makes "never overlaps the track"
 *   true by construction instead of by a distance check that could miss a
 *   case.
 */
export function generateBuildingRow(
  chunkIndex: number,
  side: -1 | 1,
  suppressNearPivotSlot = false,
): readonly (BuildingPlacement | null)[] {
  const placements: (BuildingPlacement | null)[] = [];

  for (let slot = 0; slot < BUILDINGS_PER_SIDE; slot++) {
    if (slot === 0 && suppressNearPivotSlot) {
      placements.push(null);
      continue;
    }

    const rng = jitterRng(chunkIndex, side, slot);
    const globalIndex = chunkIndex * BUILDINGS_PER_SIDE + slot;

    const width = Math.max(4, WIDTH_BASE + jitter(rng, WIDTH_JITTER));
    const depth = Math.max(4, DEPTH_BASE + jitter(rng, DEPTH_JITTER));
    const topOffset =
      HEIGHT_PATTERN[positiveMod(globalIndex, HEIGHT_PATTERN.length)] + jitter(rng, HEIGHT_JITTER);
    const height = topOffset + BUILDING_BELOW_TRACK;
    // Randomly assigned per building (not cycled by index, unlike height) -
    // "randomly assign building colors from the palette" per the request.
    // Still fully deterministic for a given chunkIndex/side/slot, same as
    // every other jittered dimension here - `jitterRng` is reseeded per
    // building, so this doesn't disturb width/depth/height's own draws.
    const color = BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)];
    const pattern = Math.floor(rng() * WINDOW_PATTERN_COUNT);

    const slotCentreZ = slot * SLOT_SPAN + SLOT_SPAN / 2;
    let z = slotCentreZ + jitter(rng, (SLOT_SPAN - DEPTH_BASE) / 2);
    // Inside of a turn: keep the near face out of the band the previous
    // chunk's deck sweeps through in this frame - see the doc comment.
    // Applied after the jitter draw, never before, so the rng stream (and
    // so every other building on the route) is bit-identical either way.
    if (suppressNearPivotSlot) {
      z = Math.max(z, DECK_WIDTH / 2 + GAP_FROM_DECK + depth / 2);
    }

    placements.push({
      x: side * (NEAR_FACE_OFFSET + width / 2),
      y: topOffset - height / 2,
      z,
      width,
      height,
      depth,
      color,
      pattern,
    });
  }

  return placements;
}

/**
 * The corner-bridging building for a turn chunk, on the outside-of-turn
 * side - see `ChunkBuilder.placeChunk`'s own note on `spec.turn.dir`'s sign
 * convention, which this mirrors exactly (same side `cornerFill` patches).
 */
export function generateCornerBuilding(chunkIndex: number, turnDir: -1 | 1): BuildingPlacement {
  const rng = jitterRng(chunkIndex, turnDir, BUILDINGS_PER_SIDE);
  const topOffset =
    HEIGHT_PATTERN[positiveMod(chunkIndex * BUILDINGS_PER_SIDE, HEIGHT_PATTERN.length)] +
    jitter(rng, HEIGHT_JITTER);
  const height = topOffset + BUILDING_BELOW_TRACK;

  return {
    x: turnDir * (NEAR_FACE_OFFSET + CORNER_WIDTH / 2),
    y: topOffset - height / 2,
    // Straddles the chunk's own start (the pivot), reaching back into the
    // previous chunk's span where the wedge-shaped gap actually opens up.
    z: -CORNER_HALF_SPAN / 2,
    width: CORNER_WIDTH,
    height,
    depth: CORNER_HALF_SPAN,
    color: BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)],
    pattern: Math.floor(rng() * WINDOW_PATTERN_COUNT),
  };
}

// ---------------------------------------------------------------------------
// Pooling - one fixed-size rig per streamer slot, mirroring ObstaclePool.ts.
// ---------------------------------------------------------------------------

/**
 * A box's four side faces get the windowed material; the top and bottom
 * caps get a plain warm rooftop tone (`PALETTE.roofSand`) rather than the
 * wall colour - a roof cap wearing a window texture would read as a
 * mistake, and "warm sand/terracotta for rooftops" is its own part of the
 * established coastal palette, distinct from the five wall colours
 * (`BUILDING_COLORS`). The bottom cap is buried/never seen either way, but
 * shares the same material rather than adding a second one for no visible
 * gain.
 */
const ROOF_CAP_COLOR = PALETTE.roofSand;

/**
 * DRAW CALLS ARE WHAT THIS SECTION IS ABOUT - read this before changing the
 * geometry or the material arrays below.
 *
 * `WebGLRenderer` emits one draw call **per geometry group** whenever a mesh
 * carries an array of materials, and `THREE.BoxGeometry` always ships six
 * groups (one per face, ordered [+x, -x, +y, -y, +z, -z]). This module used
 * to hand every building a six-entry array - `[side, side, cap, cap, side,
 * side]` - on the plain `unitBoxGeometry`, so *every box on the skyline cost
 * six draw calls*, four of them re-binding the identical wall material.
 *
 * With ~20 live streamer slots each placing five skyline boxes and four
 * under-deck facades, that alone was ~1,100 draw calls a frame - the single
 * largest cost in the frame by a wide margin, and the reason the game ran at
 * roughly 22 fps on a median phone. Triangle count was never the problem
 * (the whole scene is ~13k); per-draw driver overhead was.
 *
 * Two changes fix it, and both are structural rather than cosmetic:
 *
 *  - {@link facadeBoxGeometry} re-orders the box's index buffer so the four
 *    *side* faces are contiguous and the two caps follow, then collapses the
 *    six groups into two. A skyline building is therefore two draw calls
 *    (walls, cap) instead of six, and looks pixel-for-pixel identical.
 *  - A gap facade's caps are never visible - its top face is covered by the
 *    deck slab sitting on it and its bottom is `BUILDING_BELOW_TRACK` below
 *    the roofline - so it takes a single, non-array material on the plain
 *    unit box and costs exactly one draw call.
 */
const SIDE_FACES: readonly number[] = [0, 1, 4, 5];
const CAP_FACES: readonly number[] = [2, 3];

/** Index of the `buildingMaterials()` entry the side faces use. */
const SIDE_MATERIAL_SLOT = 0;
const CAP_MATERIAL_SLOT = 1;

function buildFacadeBoxGeometry(): THREE.BufferGeometry {
  const source = new THREE.BoxGeometry(1, 1, 1);
  const index = source.getIndex();
  if (!index) return source;

  // Every BoxGeometry face is six consecutive indices, in the fixed face
  // order above - so re-ordering is a copy of six-index runs, not a remesh.
  const reordered = new (index.array.constructor as Uint16ArrayConstructor)(index.count);
  let write = 0;
  for (const face of [...SIDE_FACES, ...CAP_FACES]) {
    for (let i = 0; i < 6; i++) reordered[write++] = index.array[face * 6 + i] as number;
  }

  const geometry = source.clone();
  geometry.setIndex(new THREE.BufferAttribute(reordered, 1));
  geometry.clearGroups();
  geometry.addGroup(0, SIDE_FACES.length * 6, SIDE_MATERIAL_SLOT);
  geometry.addGroup(SIDE_FACES.length * 6, CAP_FACES.length * 6, CAP_MATERIAL_SLOT);
  source.dispose();
  return geometry;
}

/** Unit box with the six per-face groups collapsed to two - see above. */
export const facadeBoxGeometry = buildFacadeBoxGeometry();

/**
 * Frees the one GPU resource this module owns outright.
 *
 * Every material here is cache-owned by `ProceduralProps`/`BuildingWindows`
 * and released by their own dispose functions; `facadeBoxGeometry` is the
 * exception, built here and shared by every skyline box, so it is freed
 * alongside them on full teardown rather than by any individual pool.
 */
export function disposeBuildingAssets(): void {
  facadeBoxGeometry.dispose();
  materialPairCache.clear();
}

/**
 * `[walls, cap]`, memoised per `(color, pattern)`.
 *
 * The memo is not a micro-optimisation: `placeFacadeMesh` runs on every
 * chunk spawn, and a fresh array there both allocated per placement and
 * handed three.js a new material *array identity* each time, which is enough
 * to make it re-sort the render list. The materials themselves have always
 * been cache-owned (`getWindowMaterial`/`getMaterial`); only the array
 * wrapping them was being rebuilt.
 */
const materialPairCache = new Map<string, THREE.Material[]>();

function buildingMaterials(color: number, pattern: number): THREE.Material[] {
  const key = `${color}|${pattern}`;
  let pair = materialPairCache.get(key);
  if (!pair) {
    pair = [wallMaterial(color, pattern), getMaterial(ROOF_CAP_COLOR)];
    materialPairCache.set(key, pair);
  }
  return pair;
}

function wallMaterial(color: number, pattern: number): THREE.Material {
  return getWindowMaterial(color, pattern) ?? getMaterial(color);
}

/**
 * @param capped false for a box whose top/bottom faces can never be seen -
 *   see the draw-call note above. A capped box takes the two-group geometry
 *   and a two-entry material array (2 draw calls); an uncapped one takes the
 *   plain unit box and a single material (1 draw call).
 */
function buildFacadeMesh(scene: THREE.Object3D, capped: boolean): THREE.Mesh {
  const mesh = new THREE.Mesh(
    capped ? facadeBoxGeometry : unitBoxGeometry,
    capped ? buildingMaterials(BUILDING_COLORS[0], 0) : wallMaterial(BUILDING_COLORS[0], 0),
  );
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

/** Places one building/facade box - the world position/quaternion are
 *  already converted from the chunk's local frame by the caller, the same
 *  as every other chunk-local placement (see `ChunkBuilder.localToWorld`). */
function placeFacadeMesh(
  mesh: THREE.Mesh,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  width: number,
  height: number,
  depth: number,
  color: number,
  pattern: number,
): void {
  mesh.visible = true;
  mesh.position.copy(position);
  mesh.quaternion.copy(quaternion);
  mesh.scale.set(width, height, depth);
  // A capped box was built with an array material and keeps one; an uncapped
  // facade keeps its single material, so it stays at one draw call.
  mesh.material = Array.isArray(mesh.material)
    ? buildingMaterials(color, pattern)
    : wallMaterial(color, pattern);
}

export interface BuildingSlotRig {
  readonly left: readonly THREE.Mesh[];
  readonly right: readonly THREE.Mesh[];
  readonly corner: THREE.Mesh;
}

export class BuildingPool {
  private readonly rigs = new Map<number, BuildingSlotRig>();

  constructor(private readonly scene: THREE.Object3D) {}

  rigFor(slot: number): BuildingSlotRig {
    const existing = this.rigs.get(slot);
    if (existing) return existing;

    const rig: BuildingSlotRig = {
      left: Array.from({ length: BUILDINGS_PER_SIDE }, () => buildFacadeMesh(this.scene, true)),
      right: Array.from({ length: BUILDINGS_PER_SIDE }, () => buildFacadeMesh(this.scene, true)),
      corner: buildFacadeMesh(this.scene, true),
    };
    this.rigs.set(slot, rig);
    return rig;
  }

  placeOne(
    mesh: THREE.Mesh,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    width: number,
    height: number,
    depth: number,
    color: number,
    pattern: number,
  ): void {
    placeFacadeMesh(mesh, position, quaternion, width, height, depth, color, pattern);
  }

  hide(mesh: THREE.Mesh): void {
    mesh.visible = false;
  }

  hideAll(slot: number): void {
    const rig = this.rigs.get(slot);
    if (!rig) return;
    for (const mesh of [...rig.left, ...rig.right, rig.corner]) mesh.visible = false;
  }

  /** `unitBoxGeometry` and every material are cache-owned (see
   *  `ProceduralProps.getMaterial`) - nothing here is instance-owned, so
   *  teardown is just detaching meshes, the same as `ObstaclePool`'s own
   *  deck/obstacle meshes which share the identical geometry. */
  dispose(): void {
    for (const rig of this.rigs.values()) {
      for (const mesh of [...rig.left, ...rig.right, rig.corner]) mesh.removeFromParent();
    }
    this.rigs.clear();
  }
}

// ---------------------------------------------------------------------------
// Gap facades - the building each deck segment sits directly on top of.
// ---------------------------------------------------------------------------

/**
 * A deck slab used to be a 1-unit-thick box floating with nothing beneath
 * it (`DECK_THICKNESS`, `TrackConfig.ts`) - reading as a platform rather
 * than a rooftop, worst of all right where a gap opens and the player can
 * see straight down/across into empty air. This is the fix: one more box
 * per deck segment (A, B, C, and the turn corner patch), sat directly
 * beneath it with the *same* footprint, reaching `BUILDING_BELOW_TRACK`
 * down - same distance the skyline itself uses, so a facade never reads as
 * shallower than the buildings flanking it. `ChunkBuilder.placeChunk` parks
 * whichever facade its own deck segment is parked for (C on a gap chunk,
 * corner off a turn chunk) - there is never a facade floating under empty
 * air, only ever under real deck.
 *
 * This is purely visual, exactly like the skyline: the deck slab above it
 * still owns the only collider a player ever touches (`ObstaclePool`), so
 * none of this changes gap/collision behaviour, only what the gap looks
 * like from the inside.
 */
const FACADE_HEIGHT = BUILDING_BELOW_TRACK;

/** Deterministic colour/pattern for one chunk's gap facade, seeded
 *  separately from the skyline rows (`generateBuildingRow`'s own
 *  `jitterRng` calls use slot 0/1 - these use 100+ so the two draws never
 *  collide and each stays reproducible on its own). */
export function generateGapFacade(
  chunkIndex: number,
  key: 'A' | 'B' | 'C' | 'corner',
): { color: number; pattern: number } {
  const slot = { A: 100, B: 101, C: 102, corner: 103 }[key];
  const rng = jitterRng(chunkIndex, 1, slot);
  return {
    color: BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)],
    pattern: Math.floor(rng() * WINDOW_PATTERN_COUNT),
  };
}

export interface GapFacadeRig {
  readonly a: THREE.Mesh;
  readonly b: THREE.Mesh;
  readonly c: THREE.Mesh;
  readonly corner: THREE.Mesh;
}

export class GapFacadePool {
  private readonly rigs = new Map<number, GapFacadeRig>();

  constructor(private readonly scene: THREE.Object3D) {}

  rigFor(slot: number): GapFacadeRig {
    const existing = this.rigs.get(slot);
    if (existing) return existing;

    const rig: GapFacadeRig = {
      // Uncapped: a gap facade's top face is covered by the deck slab it
      // sits under and its bottom is 45 units below the roofline, so neither
      // cap can ever be seen - one draw call each instead of two.
      a: buildFacadeMesh(this.scene, false),
      b: buildFacadeMesh(this.scene, false),
      c: buildFacadeMesh(this.scene, false),
      corner: buildFacadeMesh(this.scene, false),
    };
    this.rigs.set(slot, rig);
    return rig;
  }

  /**
   * `topCentre` is the world position of the facade's *top* face centre -
   * the same point the deck slab sitting on it is placed at (that slab's
   * own bottom surface, `at(0, -DECK_THICKNESS, ...)` in
   * `ChunkBuilder.placeChunk`), not the box's geometric centre. Callers
   * therefore never need to know `FACADE_HEIGHT` themselves; this is the
   * one place that constant matters. Width/depth match whichever deck
   * segment this facade sits under.
   */
  place(
    mesh: THREE.Mesh,
    topCentre: THREE.Vector3,
    quaternion: THREE.Quaternion,
    width: number,
    depth: number,
    color: number,
    pattern: number,
  ): void {
    topCentre.y -= FACADE_HEIGHT / 2;
    placeFacadeMesh(mesh, topCentre, quaternion, width, FACADE_HEIGHT, depth, color, pattern);
  }

  hide(mesh: THREE.Mesh): void {
    mesh.visible = false;
  }

  hideAll(slot: number): void {
    const rig = this.rigs.get(slot);
    if (!rig) return;
    for (const mesh of [rig.a, rig.b, rig.c, rig.corner]) mesh.visible = false;
  }

  dispose(): void {
    for (const rig of this.rigs.values()) {
      for (const mesh of [rig.a, rig.b, rig.c, rig.corner]) mesh.removeFromParent();
    }
    this.rigs.clear();
  }
}
