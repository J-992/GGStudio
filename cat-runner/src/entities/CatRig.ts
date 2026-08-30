import * as THREE from 'three';

/**
 * Builds a skeleton for the kitty model and skins the mesh to it.
 *
 * `cat_model.glb` is a Meshy export: one 1129-vertex mesh, one node, no skin
 * and no animations. Nothing in it can be posed. Rather than round-trip
 * the asset through Blender - which would leave the rig as an opaque binary
 * nobody can review or re-derive - the skeleton is built here, at load time,
 * from the mesh's own bounding box.
 *
 * That choice is what makes the rig *readable*: every joint below is a position
 * in normalised model space (see {@link BoneSpec.at}), so "the hip is a third of
 * the way up and just off centre" is a line of code rather than a property in a
 * binary. It also survives the model being re-exported at a different scale,
 * since nothing here is in world units.
 *
 * Skinning is inverse-distance with finite support: a vertex is influenced by
 * every joint within that joint's `reach`, weighted so influence falls smoothly
 * to zero at the boundary. Two corrections stop that from producing the usual
 * procedural-rig artefacts:
 *
 *   - Limb and ear joints are masked to their own side of the body, so the left
 *     hand cannot drag vertices off the right one.
 *   - Weights are Laplacian-smoothed across the surface, over *welded* vertices.
 *     Welding matters: the exporter splits vertices along UV seams, and
 *     smoothing the split copies independently tears the mesh open at every
 *     seam once the rig moves.
 *
 * None of that machinery is specific to any one body plan - it operates on a
 * {@link SkeletonDef}, a plain data table of joints, so a different creature
 * only needs a different table. {@link BIPED_SKELETON} is the one table this
 * game currently ships; a quadruped table (V1's `kitty_model.glb`) shipped the
 * same way until the V2 biped replaced it as the player character. There is no
 * quadruped table left in this file - see AssetRegistry for why.
 */

// ---------------------------------------------------------------------------
// Skeleton definition
// ---------------------------------------------------------------------------

export type CatBoneName =
  | 'root'
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'earL'
  | 'earR'
  | 'tailA'
  | 'tailB'
  | 'tailC'
  | 'tailD'
  | 'shoulderL'
  | 'upperArmL'
  | 'lowerArmL'
  | 'handL'
  | 'shoulderR'
  | 'upperArmR'
  | 'lowerArmR'
  | 'handR'
  | 'thighL'
  | 'shinL'
  | 'footL'
  | 'thighR'
  | 'shinR'
  | 'footR';

interface BoneSpec {
  name: CatBoneName;
  parent: CatBoneName | null;
  /**
   * Joint position in normalised model space:
   *   - `x` spans -1..1 across the width, 0 being the mirror plane (see
   *     {@link SkeletonDef.mirrorOffset}, NOT the bounding-box centre);
   *   - `y` spans 0..1 from the soles to the ear tips;
   *   - `z` spans 0..1 from the tail to the nose.
   */
  at: readonly [number, number, number];
  /**
   * Skinning falloff radius, as a fraction of {@link SkeletonDef.reachAxis}'s
   * bounding-box extent. Zero means the joint carries no vertices of its own -
   * only `root`, which exists so the whole rig can be offset as a unit.
   */
  reach: number;
  /** Restricts influence to one side of the mirror plane. */
  side?: -1 | 1;
  /**
   * Pins the joint to the geometry origin, ignoring {@link at}.
   *
   * Only the root uses this, and the reason is CatAnimations: a bone's position
   * track holds *absolute* local positions, so a clip that bobs the cat would
   * otherwise have to know the model's bounding box to write anything but a
   * teleport. Pinning the root at zero makes `root.position` a pure offset.
   */
  atOrigin?: boolean;
}

/**
 * Everything the rigging machinery needs to build and skin a particular body
 * plan. The joint table is the only thing that changes between creatures; the
 * functions below never see the difference.
 */
export interface SkeletonDef {
  bones: readonly BoneSpec[];
  boneNames: readonly CatBoneName[];
  /**
   * Where the true left/right mirror plane sits, as a fraction of the mesh's
   * width added to the bounding box's X centre.
   *
   * Measured directly on cat_model.glb: candidate planes were scored by how
   * well reflecting the mesh across them lines up vertices, and X=0.024 won
   * with a symmetry score of 0.92 against 0.03 (Y) and 0.07 (Z). The
   * bounding-box centre in X is 0.000 - so on this mesh the mirror plane is
   * off-centre by the full offset, and a rig that silently assumed "centre =
   * bbox centre" would misclassify every vertex between the two when deciding
   * which side of the body it is on. That is not hypothetical: scored at a
   * tight 8mm match tolerance the bbox centre lines up 0.09 of the mesh
   * against the measured plane's 0.90.
   *
   * 0.0310 = 0.024 / 0.7734 (the measured offset as a fraction of the mesh's
   * width), so this reproduces 0.024 against this exact mesh and scales sanely
   * if the model is ever re-exported at a different size. The value the
   * previous mesh measured, 0.0343, is within a quarter of a centimetre of
   * this one - the two Meshy exports of this character are near enough the
   * same body that the rest of the table below carried over untouched.
   */
  mirrorOffset: number;
  /**
   * Which bounding-box axis a joint's `reach` is a fraction of.
   *
   * The quadruped V1 rig measured reach against nose-to-tail length (Z), the
   * model's long axis. This biped stands upright, so its long axis - and the
   * axis every limb actually spans - is height (Y); a reach measured against Z
   * (0.516, the model's *depth*) would starve the leg joints of enough radius
   * to reach the knee to the foot.
   */
  reachAxis: 'x' | 'y' | 'z';
}

/** One side's limb chain, mirrored into left and right by {@link mirrorChain}. */
interface ChainSpec {
  /** Chain joint names, root-most first. */
  names: readonly CatBoneName[];
  parent: CatBoneName;
  /** Sideways offset of each joint, in normalised units, root-most first. */
  x: readonly number[];
  /** Heights, root-most first. */
  y: readonly number[];
  /** Depths, root-most first. */
  z: readonly number[];
  reach: readonly number[];
}

/**
 * Expands a chain spec into 2N joint specs - mirrored into a left and right
 * copy, each with its own `side` mask.
 */
function mirrorChain(chain: ChainSpec): BoneSpec[] {
  const out: BoneSpec[] = [];
  for (const side of [-1, 1] as const) {
    const suffix = side < 0 ? 'L' : 'R';
    for (let i = 0; i < chain.names.length; i++) {
      const name = chain.names[i].replace(/L$/, suffix) as CatBoneName;
      const parentName =
        i === 0 ? chain.parent : (chain.names[i - 1].replace(/L$/, suffix) as CatBoneName);
      out.push({
        name,
        parent: parentName,
        at: [chain.x[i] * side, chain.y[i], chain.z[i]],
        reach: chain.reach[i],
        side,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The biped skeleton
//
// Every number below was read off the Meshy cat mesh with a throwaway geodesic
// analysis script (weld vertices, build triangle adjacency, greedy
// farthest-point sampling to locate protruding extremities, then centroid the
// vertex clusters near each one) rather than guessed. Two things that analysis
// found and that shaped the table:
//
//   - The mesh is two disconnected triangle islands: a 730-vertex main body
//     (torso, head, tail, both arms, the right leg) and a 64-vertex island that
//     is the *left* leg, floating unstitched from the hip socket. This does not
//     affect skinning - it is per-vertex distance to a joint, not mesh
//     topology - but it does mean the Laplacian smoothing pass (which walks
//     triangle edges) never blends the left leg's weights with the body's.
//     That is harmless here: a low-poly leg needs little smoothing internally,
//     and the two were never a continuous surface to begin with.
//   - The tail is a stub, not a sweep: only 3 main-component vertices sit past
//     Z=-0.15, clustered around Y=0.15-0.25. V1's tail swept a long arc because
//     its source mesh had one; this one does not, so `reach` on the tail chain
//     stays small rather than claiming a share of the torso it does not need.
//
// Those counts are `cat_model.glb`'s. The mesh it replaced, kitty_modelV2.glb,
// measured 1490 + 67 and the same 3-vertex tail stub: the same body at roughly
// double the density, which is why swapping the model needed nothing here but
// a re-measured `mirrorOffset`.
// ---------------------------------------------------------------------------

const ARMS: ChainSpec = {
  names: ['shoulderL', 'upperArmL', 'lowerArmL', 'handL'],
  parent: 'chest',
  // Interpolated between the measured shoulder-band centroid (x=0.18) and the
  // measured hand-cluster centroid (x=0.331), both as an offset from the
  // mirror plane rather than from the bbox centre.
  x: [0.475, 0.607, 0.739, 0.873],
  y: [0.552, 0.487, 0.422, 0.354],
  z: [0.535, 0.547, 0.556, 0.568],
  reach: [0.12, 0.11, 0.11, 0.12],
};

const LEGS: ChainSpec = {
  names: ['thighL', 'shinL', 'footL'],
  parent: 'hips',
  // Both legs sit close to the mirror plane through the thigh and knee -
  // measured offsets there were 0.007-0.068, an almost-touching stance - and
  // only flare out at the foot, which is why the reach widens sharply on the
  // last joint rather than the offset itself growing much.
  x: [0.119, 0.132, 0.211],
  // The foot joint sits at Y=0 (the sole, matching where V1 pinned its paw
  // joints) rather than at an anatomical ankle height, so `reach` alone has to
  // cover the whole foot mass up to where the shin's reach picks up.
  y: [0.261, 0.161, 0.0],
  // The foot joint sits over the *heel*, not the middle of the sole. The foot
  // mesh runs Z=-0.26 (heel) to Z=+0.16 (toe) and this character faces +Z, so
  // an ankle placed forward of Z=0 leaves the heel nearer the knee than its
  // own joint - which is exactly what happened at 0.612: the heel bound to
  // `shin` at 0.95, swung down about the knee rather than staying flat with
  // the foot, and put the lowest vertex 0.10 through the roof every stride.
  // Sitting the joint back at Z=-0.08 keeps the whole foot on the foot.
  z: [0.535, 0.496, 0.341],
  // thigh was originally 0.10 (absolute 0.0996) against a measured
  // nearest-vertex distance of 0.104 - the reach fell *short* of the single
  // closest vertex, so the joint carried no direct weight at all and every
  // vertex "bound" to it (see the diagnostic in the task notes) got there
  // secondhand, through Laplacian smoothing from wherever the raw weight
  // actually landed. 0.22 clears that nearest-vertex distance with genuine
  // margin instead of by accident.
  //
  // The foot needs the widest reach of the three: from the heel joint the toe
  // is 0.24 away and the sole spans 0.42 end to end, so anything under ~0.26
  // leaves part of the foot to be claimed by the shin.
  reach: [0.22, 0.13, 0.3],
};

export const BIPED_SKELETON: readonly BoneSpec[] = [
  { name: 'root', parent: null, at: [0, 0, 0], reach: 0, atOrigin: true },
  // 0.24: the original 0.12 (absolute 0.12) fell short of the nearest real
  // vertex (measured at 0.121) - same failure as thigh above. This clears it
  // with roughly 2x headroom rather than by luck.
  // Reaches further than the pelvis strictly needs, to claim the mesh's
  // second triangle island - a low rear mass spanning x -0.375..0.065,
  // y -0.486..-0.214, disconnected from the body and so never reached by the
  // smoothing pass. At 0.24 it fell 0.02 short of that island's centroid and
  // the fallback handed 14 of its vertices to `handL`, the nearest same-side
  // joint by raw distance - anatomically absurd for something sitting behind
  // and below the hips. The pelvis is the right owner for it.
  { name: 'hips', parent: 'root', at: [0, 0.291, 0.554], reach: 0.32 },
  { name: 'spine', parent: 'hips', at: [0, 0.462, 0.554], reach: 0.2 },
  { name: 'chest', parent: 'spine', at: [0, 0.582, 0.554], reach: 0.2 },
  // 0.16: the original 0.08 (absolute 0.0797) fell short of the nearest real
  // vertex (measured at 0.087) by a hair, so neck carried literally zero
  // weight - not just zero *dominant* weight - for any vertex. It existed
  // only as a hierarchy pivot moving head's whole subtree.
  { name: 'neck', parent: 'chest', at: [0, 0.643, 0.593], reach: 0.16 },
  // A big reach: the geodesic analysis found this character's face sits far
  // lower on the skull than the ears (nose centroid Y=0.18 against ear tips at
  // Y=0.44-0.50), so the head joint has to cover both the muzzle bulging
  // forward at mid-height and the crown well above it.
  { name: 'head', parent: 'neck', at: [0, 0.803, 0.669], reach: 0.32 },
  { name: 'earL', parent: 'head', at: [-0.44, 0.964, 0.531], reach: 0.12, side: -1 },
  { name: 'earR', parent: 'head', at: [0.44, 0.964, 0.531], reach: 0.12, side: 1 },
  // Short chain reflecting the short stub found in the mesh - see the header
  // comment. Still hooks up and back, matching what little tail geometry exists.
  { name: 'tailA', parent: 'chest', at: [0, 0.622, 0.324], reach: 0.09 },
  { name: 'tailB', parent: 'tailA', at: [0, 0.663, 0.244], reach: 0.11 },
  { name: 'tailC', parent: 'tailB', at: [0, 0.703, 0.186], reach: 0.08 },
  { name: 'tailD', parent: 'tailC', at: [0, 0.743, 0.147], reach: 0.09 },
  ...mirrorChain(ARMS),
  ...mirrorChain(LEGS),
];

export const BIPED_BONE_NAMES: readonly CatBoneName[] = BIPED_SKELETON.map((b) => b.name);

/** The skeleton this game rigs its player character with. */
export const CAT_SKELETON_DEF: SkeletonDef = {
  bones: BIPED_SKELETON,
  boneNames: BIPED_BONE_NAMES,
  mirrorOffset: 0.0310,
  reachAxis: 'y',
};

/** Kept for callers and tests that only need the joint list, not the whole def. */
export const CAT_SKELETON = BIPED_SKELETON;
export const CAT_BONE_NAMES = BIPED_BONE_NAMES;

/** Three.js skins against at most four joints per vertex. */
const MAX_INFLUENCES = 4;

/**
 * How sharply a joint's influence falls off with distance.
 *
 * 1.0 is plain inverse distance; higher values bind more tightly to the
 * nearest joint at the cost of blending across bends. See the weighting loop
 * in {@link computeSkinWeights} for why this is not 2.
 */
const FALLOFF_EXPONENT = 1;

/** Laplacian smoothing passes applied to the raw weights. */
const SMOOTH_PASSES = 3;
/** How far each pass moves a vertex's weights toward its neighbours' average. */
const SMOOTH_LAMBDA = 0.5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CatRig {
  /** Add this to the scene. Carries the source mesh's own transform. */
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  bones: Map<CatBoneName, THREE.Bone>;
}

/**
 * Rigs the first mesh found under `source` in place.
 *
 * Returns `null` if there is nothing to rig - the caller is expected to fall
 * back to an already-rigged model rather than crash.
 */
export function rigCat(source: THREE.Object3D, def: SkeletonDef = CAT_SKELETON_DEF): CatRig | null {
  const mesh = findFirstMesh(source);
  if (!mesh) return null;

  const geometry = mesh.geometry;
  if (!geometry.getAttribute('position')) return null;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  const { bones, byName } = buildCatSkeleton(box, def);
  computeSkinWeights(geometry, box, def);

  const skinned = new THREE.SkinnedMesh(geometry, mesh.material as THREE.Material);
  skinned.name = mesh.name || 'kitty';
  // Skinned bounds are computed at bind pose and go stale the moment the rig
  // moves, so a posed cat at the screen edge would pop out of existence.
  skinned.frustumCulled = false;
  skinned.castShadow = true;
  skinned.receiveShadow = false;

  // The bones were laid out in *geometry* space, so they have to sit under the
  // same transform the mesh did rather than alongside it.
  const root = new THREE.Group();
  root.name = 'kittyRig';
  root.position.copy(mesh.position);
  root.quaternion.copy(mesh.quaternion);
  root.scale.copy(mesh.scale);

  root.add(byName.get('root')!);
  root.add(skinned);
  root.updateMatrixWorld(true);

  // Skeleton() snapshots each bone's world matrix as the bind pose, so the
  // hierarchy above has to be up to date before this line, not after.
  const skeleton = new THREE.Skeleton(bones);
  skinned.bind(skeleton);

  return { root, mesh: skinned, skeleton, bones: byName };
}

/**
 * Instantiates a {@link SkeletonDef} against a concrete bounding box.
 *
 * Exported so tests can assert the layout without needing a mesh.
 */
export function buildCatSkeleton(
  box: THREE.Box3,
  def: SkeletonDef = CAT_SKELETON_DEF,
): {
  bones: THREE.Bone[];
  byName: Map<CatBoneName, THREE.Bone>;
} {
  const size = box.getSize(new THREE.Vector3());
  const mirrorX = mirrorPlaneX(box, size, def);

  const bones: THREE.Bone[] = [];
  const byName = new Map<CatBoneName, THREE.Bone>();
  /** Bind-pose position of each joint, in geometry space. */
  const worldAt = new Map<CatBoneName, THREE.Vector3>();

  for (const spec of def.bones) {
    const at = jointPosition(spec, box, size, mirrorX);
    worldAt.set(spec.name, at);

    const bone = new THREE.Bone();
    bone.name = spec.name;

    // Bind pose has no rotation anywhere, so a joint's local offset is simply
    // the gap between it and its parent.
    const parentAt = spec.parent ? worldAt.get(spec.parent)! : new THREE.Vector3();
    bone.position.copy(at).sub(parentAt);

    if (spec.parent) byName.get(spec.parent)!.add(bone);

    bones.push(bone);
    byName.set(spec.name, bone);
  }

  return { bones, byName };
}

/**
 * Writes `skinIndex` and `skinWeight` attributes onto `geometry`.
 *
 * Exported for tests; {@link rigCat} calls it for you.
 */
export function computeSkinWeights(
  geometry: THREE.BufferGeometry,
  box: THREE.Box3,
  def: SkeletonDef = CAT_SKELETON_DEF,
): void {
  const position = geometry.getAttribute('position');
  const count = position.count;

  const size = box.getSize(new THREE.Vector3());
  const mirrorX = mirrorPlaneX(box, size, def);
  const length = Math.max(size[def.reachAxis], 1e-6);
  // Vertices this close to the mirror plane belong to the body, not to either
  // side, so a sided joint is allowed to reach across it.
  const sideTolerance = size.x * 0.02;

  const boneIndex = new Map<CatBoneName, number>();
  def.boneNames.forEach((name, i) => boneIndex.set(name, i));

  // Joint positions in geometry space, from the same helper buildCatSkeleton()
  // uses so the two cannot drift apart.
  const joints = def.bones
    .map((spec) => ({
      spec,
      at: jointPosition(spec, box, size, mirrorX),
      reach: spec.reach * length,
      index: boneIndex.get(spec.name)!,
    }))
    .filter((j) => j.reach > 0);

  // Dense per-vertex weights, one row per vertex. Sparse rows would be smaller
  // but the smoothing pass below wants random access to neighbours.
  const boneCount = def.boneNames.length;
  let weights: Float32Array = new Float32Array(count * boneCount);

  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(position, i);
    const offCentre = v.x - mirrorX;

    let total = 0;
    let nearest = -1;
    let nearestDist = Infinity;

    for (const joint of joints) {
      const d = v.distanceTo(joint.at);
      const wrongSide = joint.spec.side !== undefined && offCentre * joint.spec.side < -sideTolerance;
      // The "outside every reach" fallback below must never land on a sided
      // joint from the wrong side - a vertex that is genuinely closer, in raw
      // distance, to the opposite hand than to anything on its own side (this
      // happens for cat_model.glb's disconnected left-leg island, whose
      // vertices sit well outside the near-centreline stance every reach
      // value below is sized for) would otherwise get bound whole to a joint
      // that can never be on the correct side of the body for it. Tracking
      // "nearest" only among same-side-or-unsided joints means the fallback
      // can still be geometrically wrong, but never anatomically impossible.
      if (!wrongSide && d < nearestDist) {
        nearestDist = d;
        nearest = joint.index;
      }
      if (wrongSide) continue;
      if (d >= joint.reach) continue;

      // Inverse distance with finite support: peaked at the joint and exactly
      // zero at `reach`, so no vertex picks up a seam where a joint's
      // influence is cut off mid-surface.
      //
      // Raised to FALLOFF_EXPONENT rather than squared. Squaring makes this
      // behave like 1/d^2 near a joint, which on this biped left the nearest
      // joint with ~97% of a vertex that was only twice as far from the next
      // one - a third of the mesh ended up bound to a single bone and creased
      // at every bend. The quadruped tolerated the square because its joints
      // sat much closer together relative to the mesh; a body plan with limbs
      // sticking out does not.
      const w = 1 / Math.max(d, 1e-5) - 1 / joint.reach;
      const weight = Math.pow(w, FALLOFF_EXPONENT);
      weights[i * boneCount + joint.index] = weight;
      total += weight;
    }

    // A vertex outside every joint's reach still has to be attached to
    // something, or it stays frozen in the bind pose while the rest moves.
    if (total <= 0 && nearest >= 0) weights[i * boneCount + nearest] = 1;
  }

  normaliseRows(weights, count, boneCount);
  weights = smoothWeights(geometry, weights, count, boneCount);
  // Smoothing averages across whatever shares an edge, and the inner thighs and
  // belly put the two sides of the cat within one edge of each other - so the
  // mask has to be re-applied afterwards or a little of the left side ends up
  // driving the right one.
  applySideMask(weights, position, count, boneCount, mirrorX, sideTolerance, def);
  normaliseRows(weights, count, boneCount);

  writeSkinAttributes(geometry, weights, count, boneCount);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The true left/right mirror plane in geometry space.
 *
 * Deliberately *not* `(box.min.x + box.max.x) / 2`: see
 * {@link SkeletonDef.mirrorOffset} for why the two differ on this mesh.
 */
function mirrorPlaneX(box: THREE.Box3, size: THREE.Vector3, def: SkeletonDef): number {
  return (box.min.x + box.max.x) / 2 + def.mirrorOffset * size.x;
}

/** Resolves a joint's normalised position against a concrete bounding box. */
function jointPosition(
  spec: BoneSpec,
  box: THREE.Box3,
  size: THREE.Vector3,
  mirrorX: number,
): THREE.Vector3 {
  if (spec.atOrigin) return new THREE.Vector3(0, 0, 0);
  return new THREE.Vector3(
    mirrorX + spec.at[0] * size.x * 0.5,
    box.min.y + spec.at[1] * size.y,
    box.min.z + spec.at[2] * size.z,
  );
}

function findFirstMesh(source: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  source.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!found && mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) found = mesh;
  });
  return found;
}

/** Zeroes any weight binding a vertex to a joint on the other side of the body. */
function applySideMask(
  weights: Float32Array,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  count: number,
  boneCount: number,
  mirrorX: number,
  tolerance: number,
  def: SkeletonDef,
): void {
  const sides = def.bones.map((spec) => spec.side ?? 0);
  for (let i = 0; i < count; i++) {
    const offCentre = position.getX(i) - mirrorX;
    if (Math.abs(offCentre) <= tolerance) continue;
    const wrong = offCentre > 0 ? -1 : 1;
    const base = i * boneCount;
    for (let b = 0; b < boneCount; b++) {
      if (sides[b] === wrong) weights[base + b] = 0;
    }
  }
}

function normaliseRows(weights: Float32Array, count: number, boneCount: number): void {
  for (let i = 0; i < count; i++) {
    const base = i * boneCount;
    let total = 0;
    for (let b = 0; b < boneCount; b++) total += weights[base + b];
    if (total <= 0) continue;
    for (let b = 0; b < boneCount; b++) weights[base + b] /= total;
  }
}

/**
 * Averages each vertex's weights with its neighbours'.
 *
 * Raw inverse-distance weights change abruptly wherever one joint overtakes
 * another - most visibly straight across the shoulder and hip - and that shows
 * up as a crease in the shaded surface. A few smoothing passes turn those into
 * gradients.
 *
 * Adjacency is built over *welded* positions. The exporter duplicates vertices
 * along UV seams, and those copies share no triangle edge, so smoothing them
 * separately would let the two halves of a seam drift apart and split the mesh.
 */
function smoothWeights(
  geometry: THREE.BufferGeometry,
  weights: Float32Array,
  count: number,
  boneCount: number,
): Float32Array {
  const index = geometry.getIndex();
  if (!index) return weights;

  const { weld, groups } = weldVertices(geometry, count);

  // Neighbour sets over welded ids.
  const neighbours: Set<number>[] = Array.from({ length: groups.length }, () => new Set<number>());
  for (let t = 0; t < index.count; t += 3) {
    const a = weld[index.getX(t)];
    const b = weld[index.getX(t + 1)];
    const c = weld[index.getX(t + 2)];
    neighbours[a].add(b).add(c);
    neighbours[b].add(a).add(c);
    neighbours[c].add(a).add(b);
  }

  // Collapse the per-vertex rows onto welded ids by averaging the copies.
  let current = new Float32Array(groups.length * boneCount);
  for (let i = 0; i < count; i++) {
    const from = i * boneCount;
    const to = weld[i] * boneCount;
    for (let b = 0; b < boneCount; b++) current[to + b] += weights[from + b];
  }
  normaliseRows(current, groups.length, boneCount);

  let next = new Float32Array(current.length);
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    for (let i = 0; i < groups.length; i++) {
      const base = i * boneCount;
      const near = neighbours[i];
      if (near.size === 0) {
        next.set(current.subarray(base, base + boneCount), base);
        continue;
      }
      for (let b = 0; b < boneCount; b++) {
        let sum = 0;
        for (const n of near) sum += current[n * boneCount + b];
        const average = sum / near.size;
        next[base + b] = current[base + b] * (1 - SMOOTH_LAMBDA) + average * SMOOTH_LAMBDA;
      }
    }
    const swap = current;
    current = next;
    next = swap;
  }
  normaliseRows(current, groups.length, boneCount);

  // Scatter back: every copy of a welded position gets the same weights, which
  // is exactly what keeps the seam closed.
  const out = new Float32Array(count * boneCount);
  for (let i = 0; i < count; i++) {
    out.set(current.subarray(weld[i] * boneCount, weld[i] * boneCount + boneCount), i * boneCount);
  }
  return out;
}

/** Maps each vertex to an id shared by every vertex at the same position. */
function weldVertices(
  geometry: THREE.BufferGeometry,
  count: number,
): { weld: Int32Array; groups: number[] } {
  const position = geometry.getAttribute('position');
  const weld = new Int32Array(count);
  const groups: number[] = [];
  const lookup = new Map<string, number>();

  // 1e-5 of a model that is ~1 unit long: tight enough that two genuinely
  // distinct vertices never merge, loose enough to catch float round-trips.
  const quantise = (n: number) => Math.round(n * 1e5);

  for (let i = 0; i < count; i++) {
    const key = `${quantise(position.getX(i))},${quantise(position.getY(i))},${quantise(position.getZ(i))}`;
    let id = lookup.get(key);
    if (id === undefined) {
      id = groups.length;
      lookup.set(key, id);
      groups.push(i);
    }
    weld[i] = id;
  }

  return { weld, groups };
}

/** Keeps the four strongest influences per vertex and writes them out. */
function writeSkinAttributes(
  geometry: THREE.BufferGeometry,
  weights: Float32Array,
  count: number,
  boneCount: number,
): void {
  const skinIndices = new Uint16Array(count * MAX_INFLUENCES);
  const skinWeights = new Float32Array(count * MAX_INFLUENCES);

  const picks: { index: number; weight: number }[] = [];
  for (let i = 0; i < count; i++) {
    const base = i * boneCount;
    picks.length = 0;
    for (let b = 0; b < boneCount; b++) {
      const w = weights[base + b];
      if (w > 0) picks.push({ index: b, weight: w });
    }
    picks.sort((a, b) => b.weight - a.weight);

    let total = 0;
    for (let k = 0; k < MAX_INFLUENCES && k < picks.length; k++) total += picks[k].weight;

    const out = i * MAX_INFLUENCES;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      if (k < picks.length && total > 0) {
        skinIndices[out + k] = picks[k].index;
        skinWeights[out + k] = picks[k].weight / total;
      } else {
        skinIndices[out + k] = 0;
        skinWeights[out + k] = 0;
      }
    }
    // A vertex that somehow reached here with nothing at all would render at
    // the origin, which is far more obviously broken than leaving it rigid.
    if (total <= 0) skinWeights[out] = 1;
  }

  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, MAX_INFLUENCES));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, MAX_INFLUENCES));
}
