import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural rooftop props.
 *
 * No source asset pack covers any of these - awnings, chimneys, laundry
 * lines, the lot - so they are hand-modelled here from primitive geometry
 * (boxes, cylinders, cones, spheres, planes, a lathe, a torus) in the game's
 * low-poly, flat-shaded style. Every prop pulls its colours from the shared
 * {@link PALETTE} and its materials from {@link getMaterial}, which caches
 * and shares them, and common unit geometries are cached too (see
 * `cachedGeometry` below) - so dropping a hundred crates and chimneys across
 * a level costs a hundred cheap Mesh instances, not a hundred unique
 * materials and geometries. Call {@link disposeProceduralCache} on full
 * teardown (e.g. leaving the game) to release the GPU resources.
 *
 * Convention: unless documented otherwise, every builder returns a
 * `THREE.Group` whose origin sits at the prop's base (y = 0) and which is
 * centred on x/z, so callers can just set `.position` to drop it onto a
 * rooftop. `buildLaundryLine` (world-space endpoints) and `buildBillboard`
 * (pivots at the top, since it swings) are the two exceptions, and say so in
 * their own doc comments.
 */

export const PALETTE = {
  cream: 0xf0e2c8,
  creamDark: 0xd9c5a3,
  // Weathered clay, not fresh terracotta. The saturated 0xb4552a this replaced
  // was chosen to separate the roof from an orange cat; with the default cat now
  // black that constraint is gone, and the saturation was the main reason every
  // rooftop in the game read as one flat sheet of orange under the sunset key
  // light. Kept warm, but pulled well down in chroma so the light does the
  // colouring rather than the albedo.
  terracotta: 0xc59180,
  terracottaDark: 0x9a6b5c,
  // A second tiled-roof colourway. Levels alternate the two so the player is not
  // looking at one unbroken sheet of clay for an entire run - a slate roof
  // between two terracotta ones is also the clearest signal that a new building
  // has started.
  slate: 0x7d8794,
  slateDark: 0x5a636e,
  wood: 0x9a6b43,
  woodDark: 0x6e4a2e,
  metal: 0x9aa3a8,
  metalDark: 0x6e767b,
  white: 0xf7f2e8,
  leaf: 0x6e8f4e,
  leafDark: 0x4f6b38,

  // Rope, canvas and laundry colours.
  rope: 0xc7b18c,
  fabricRed: 0xb33a3a,
  fabricCream: 0xf2e6ce,
  fabricTeal: 0x2e7d74,
  fabricGold: 0xd9a441,
  fabricNavy: 0x2b3a55,

  // Glass for distant-building windows.
  glass: 0x87a7b0,
  glassDark: 0x3e4a52,

  // Chef costume.
  chefSkin: 0xe8b48a,
  chefTrouser: 0x2b2b2e,
  chefDark: 0x1e1e22,

  // Neon accents for the night level's signage.
  neonPink: 0xff3e9a,
  neonBlue: 0x36d1ff,
  neonYellow: 0xffd93b,

  // Sky / sunset tints, for anything that needs to match the ambient light.
  sunsetOrange: 0xff8a3d,
  sunsetPink: 0xff5f7e,
  duskPurple: 0x4a3b6b,
  nightBlue: 0x1b2340,

  // Coastal-city re-skin: the five building colours and three rooftop colours
  // from the "colorful coastal city" art direction. Deliberately its own
  // small group rather than folded into the muted Mediterranean tones above -
  // those are still used by unrelated props (chimneys, laundry, signage) this
  // request never touched, so recolouring them in place would have re-skinned
  // things nobody asked to change. Only `Buildings.ts` (the skyline),
  // `BuildingFacade.ts`/`MegaKitPalette.ts` (the building under the player's
  // own rooftop) and the deck material (`PlaceholderAssets.ts`) draw from
  // these.
  coastalTeal: 0x5dd9c1,
  coastalPeach: 0xffbe98,
  coastalYellow: 0xffd54f,
  coastalBlue: 0xa7d8ff,
  coastalCream: 0xfff3d1,
  roofCream: 0xfff3d1,
  roofSand: 0xf5d7a1,
  roofTerracotta: 0xe8b07a,
  // Two more additions to the same rooftop set, for RoofBrickMaterials.ts's
  // six-colour brick palette - sitting between the existing rooftop tones
  // rather than introducing a new hue family, so a brick roof still reads
  // as part of the same coastal skyline.
  roofCoral: 0xf2937d,
  roofWarmGray: 0xc9beb2,
} as const;

// ---------------------------------------------------------------------------
// Material + geometry cache
// ---------------------------------------------------------------------------

const materialCache = new Map<string, THREE.MeshLambertMaterial>();
const geometryCache = new Map<string, THREE.BufferGeometry>();

/**
 * Materials are cached and SHARED across every prop instance - never mutate
 * a returned material in place. Recolouring a single instance means cloning
 * the material yourself first (see how `Cat.ts` handles per-cat skins).
 */
export function getMaterial(
  color: number,
  options?: {
    flatShading?: boolean;
    transparent?: boolean;
    opacity?: number;
    emissive?: number;
    side?: THREE.Side;
  },
): THREE.MeshLambertMaterial {
  const flatShading = options?.flatShading ?? true;
  const transparent = options?.transparent ?? false;
  const opacity = options?.opacity ?? 1;
  const emissive = options?.emissive ?? 0x000000;
  const side = options?.side ?? THREE.FrontSide;
  const key = `${color}|${flatShading}|${transparent}|${opacity}|${emissive}|${side}`;

  let mat = materialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({ color, flatShading, transparent, opacity, emissive, side });
    // Marks this as cache-owned so disposeObject() leaves it alone. Without it,
    // tearing down any object holding a cached material frees it out from under
    // every other object still using it, and the cache keeps handing out the
    // dead reference.
    mat.userData.shared = true;
    materialCache.set(key, mat);
  }
  return mat;
}

/** Releases every cached material and geometry. Call once, on full teardown. */
export function disposeProceduralCache(): void {
  for (const mat of materialCache.values()) mat.dispose();
  materialCache.clear();
  for (const geo of geometryCache.values()) geo.dispose();
  geometryCache.clear();
}

function cachedGeometry<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
  const existing = geometryCache.get(key) as T | undefined;
  if (existing) return existing;
  const geo = build();
  // Cache-owned; see the note in getMaterial(). disposeProceduralCache() is the
  // only thing allowed to free these.
  geo.userData.shared = true;
  geometryCache.set(key, geo);
  return geo;
}

// Unit primitives, centred at the origin. Every builder scales and positions
// these rather than constructing bespoke geometry per instance, which is what
// makes the shared cache actually pay off.
function boxGeo(): THREE.BoxGeometry {
  return cachedGeometry('box1', () => new THREE.BoxGeometry(1, 1, 1));
}
function cylGeo(segments = 8): THREE.CylinderGeometry {
  return cachedGeometry(`cyl${segments}`, () => new THREE.CylinderGeometry(1, 1, 1, segments));
}
function coneGeo(segments = 8): THREE.ConeGeometry {
  return cachedGeometry(`cone${segments}`, () => new THREE.ConeGeometry(1, 1, segments));
}
function sphereGeo(widthSeg = 8, heightSeg = 6): THREE.SphereGeometry {
  return cachedGeometry(`sph${widthSeg}x${heightSeg}`, () => new THREE.SphereGeometry(1, widthSeg, heightSeg));
}
function planeGeo(): THREE.PlaneGeometry {
  return cachedGeometry('plane1', () => new THREE.PlaneGeometry(1, 1));
}
/** Thin ring, radius 1, tube 0.08 - scale uniformly for a proportional hoop. */
function torusGeo(): THREE.TorusGeometry {
  return cachedGeometry('torus1', () => new THREE.TorusGeometry(1, 0.08, 6, 12));
}

// Scratch transform reused by every InstancedMesh builder below. These run at
// level-build time rather than per frame, but a level can construct dozens of
// buildings and roof surfaces, so it's still worth not allocating per tile.
const _dummy = new THREE.Object3D();

// ---------------------------------------------------------------------------
// Static merging
// ---------------------------------------------------------------------------

/**
 * Marks a subtree as animated, so {@link freezeStatic} leaves it alone.
 *
 * Merging bakes a mesh's transform into its vertices, which is exactly wrong
 * for anything that still has to move relative to its parent - a fan's blades,
 * a pigeon's wings. Those are opted out here rather than by name, because the
 * name is the caller's contract for *finding* the part and has nothing to do
 * with whether it can be merged.
 */
export function markAnimated<T extends THREE.Object3D>(object: T): T {
  object.userData.animated = true;
  return object;
}

const _inverseRoot = new THREE.Matrix4();
const _relative = new THREE.Matrix4();

/**
 * Collapses a group of static meshes into one mesh per material.
 *
 * The props in this file are built the way they are modelled - a chimney is a
 * stack plus three pots, a garden is two planters plus its shrubs - and each of
 * those pieces was its own `Mesh`, which means its own draw call, and its own
 * second draw call into the shadow map. That is a fine way to author geometry
 * and a terrible way to submit it: one measured rooftop garden reached 317
 * meshes and 297 shadow casters, so a single decorative planter cost more draw
 * calls than the rest of the level put together.
 *
 * Merging is safe here in a way it usually isn't, because these props never
 * move once placed and every one of them draws its colours from the shared
 * palette - so the meshes inside a prop overwhelmingly share a handful of
 * materials, and collapsing them by material is close to collapsing them
 * outright. What comes back is the same geometry in far fewer submissions.
 *
 * Three things are deliberately left untouched:
 *
 *  - subtrees marked by {@link markAnimated}, whose whole point is to keep
 *    moving relative to the parent this would bake them into.
 *  - `InstancedMesh` (the roof tile courses), which is already one draw call
 *    for hundreds of copies and would get *worse* if flattened.
 *  - buckets with a single member, which have nothing to merge with and would
 *    only trade a shared cached geometry for a private clone.
 *
 * Shadow flags are part of the bucket key, not something reconciled afterwards:
 * merging a caster with a non-caster means picking one answer for both, and
 * either choice is a visible bug - lost shadows or shadows from geometry that
 * should not cast any.
 *
 * Mutates and returns `root`.
 */
export function freezeStatic<T extends THREE.Object3D>(root: T): T {
  root.updateMatrixWorld(true);
  _inverseRoot.copy(root.matrixWorld).invert();

  /** Bucket key -> the meshes that can become one draw call. */
  const buckets = new Map<string, THREE.Mesh[]>();

  const visit = (object: THREE.Object3D): void => {
    if (object !== root && object.userData.animated) return;

    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
      const material = mesh.material;
      // A multi-material mesh needs geometry groups preserved across the merge,
      // which is a different (and here unused) problem.
      if (!Array.isArray(material) && mesh.geometry) {
        const key = `${material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(mesh);
        else buckets.set(key, [mesh]);
      }
    }

    // Copied, because the merge detaches children from the tree being walked.
    for (const child of [...object.children]) visit(child);
  };
  visit(root);

  for (const [key, meshes] of buckets) {
    if (meshes.length < 2) continue;

    const parts: THREE.BufferGeometry[] = [];
    for (const mesh of meshes) {
      const geometry = normaliseForMerge(mesh.geometry);
      if (!geometry) continue;
      // Relative to `root`, not world: the group is positioned by the caller
      // afterwards, and baking world coordinates in would place it twice.
      _relative.multiplyMatrices(_inverseRoot, mesh.matrixWorld);
      geometry.applyMatrix4(_relative);
      parts.push(geometry);
    }
    if (parts.length < 2) {
      for (const part of parts) part.dispose();
      continue;
    }

    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!merged) continue;

    for (const mesh of meshes) mesh.removeFromParent();

    const [, castShadow, receiveShadow] = key.split('|');
    // Not cache-owned, unlike every geometry that went into it - a caller
    // that tears the prop down has to free this one itself, and this is the
    // flag it looks for (see `RoofFeatures.RoofPropPool.dispose`).
    merged.userData.merged = true;

    const combined = new THREE.Mesh(merged, meshes[0].material);
    combined.castShadow = castShadow === 'true';
    combined.receiveShadow = receiveShadow === 'true';
    root.add(combined);
  }

  return root;
}

/**
 * Reduces a geometry to the attribute set every merge partner is guaranteed to
 * share: position, normal, and an index.
 *
 * `mergeGeometries` rejects any batch whose members disagree on their exact
 * attributes, and the primitives here do disagree - a `TubeGeometry` and a
 * `BoxGeometry` carry different UV layouts, and a merged batch that returns
 * null would silently drop a whole colour out of the prop. Nothing in this file
 * is textured; colour comes from the material, so UVs are dead weight anyway.
 */
function normaliseForMerge(source: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const position = source.getAttribute('position');
  if (!position) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', position.clone());

  const normal = source.getAttribute('normal');
  if (normal) geometry.setAttribute('normal', normal.clone());

  if (source.index) {
    geometry.setIndex(source.index.clone());
  } else {
    const index = new Uint32Array(position.count);
    for (let i = 0; i < position.count; i++) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }

  if (!normal) geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Rooftop utility structures
// ---------------------------------------------------------------------------

/** The four kinds of service structure a rooftop can carry. */
export type RoofHutVariant = 'stairwell' | 'shed' | 'access' | 'hvac';

export const ROOF_HUT_VARIANTS: readonly RoofHutVariant[] = [
  'stairwell',
  'shed',
  'access',
  'hvac',
];

/**
 * A rooftop service structure: stairwell head, maintenance shed, access hut or
 * HVAC housing.
 *
 * These are lane obstacles first and scenery second, and everything about the
 * shape follows from that. The silhouette is a plain box for the full height a
 * runner can collide with, so what the player reads at distance is exactly what
 * the collider is; every detail - the door, the flashing, the roof cap, the
 * ducting - sits either *on* that box or above its top face, where it changes
 * how the thing looks without changing what it is to run into. A shed with a
 * sloping roof would read as lower than it hits.
 *
 * Built rather than modelled because the pack has no structure like this and a
 * box with trim is not worth a download: every piece here is a unit primitive
 * from the shared geometry cache wearing a shared palette material, so a hut
 * adds no geometry and no material to the level, and `freezeStatic` collapses
 * the lot into two or three draw calls with the rest of the roof's clutter.
 *
 * Authored with its origin at the base, like every other block obstacle, so
 * `buildBlock`'s collider offset applies unchanged.
 */
export function buildRoofHut(
  options: { variant?: RoofHutVariant; size?: THREE.Vector3 } = {},
): THREE.Group {
  const variant = options.variant ?? 'access';
  const size = options.size ?? new THREE.Vector3(1.8, 1.9, 1.6);
  const group = new THREE.Group();

  const wallColor =
    variant === 'hvac'
      ? PALETTE.metal
      : variant === 'shed'
        ? PALETTE.wood
        : PALETTE.creamDark;
  const trimColor =
    variant === 'hvac'
      ? PALETTE.metalDark
      : variant === 'shed'
        ? PALETTE.woodDark
        : PALETTE.slateDark;

  const body = new THREE.Mesh(boxGeo(), getMaterial(wallColor));
  body.scale.copy(size);
  body.position.y = size.y / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // A cap slightly wider than the walls. Sits above the collider's top face, so
  // the overhang cannot be clipped without the runner already being inside the
  // hut - the one place geometry is allowed to exceed the box.
  const capHeight = 0.12;
  const cap = new THREE.Mesh(boxGeo(), getMaterial(trimColor));
  cap.scale.set(size.x * 1.12, capHeight, size.z * 1.12);
  cap.position.y = size.y + capHeight / 2;
  cap.castShadow = true;
  group.add(cap);

  // A pale band at the base on every variant. It is the readability feature:
  // a rooftop and a hut are both mid-tone at distance, and this is the line
  // that says where the obstacle starts.
  const skirt = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.white));
  skirt.scale.set(size.x * 1.04, 0.1, size.z * 1.04);
  skirt.position.y = 0.05;
  group.add(skirt);

  if (variant === 'stairwell' || variant === 'access') {
    // A door, on the face the runner meets. Proud of the wall rather than
    // recessed - a cavity would be four more faces for a detail that is two
    // pixels deep at speed.
    const door = new THREE.Mesh(boxGeo(), getMaterial(trimColor));
    door.scale.set(size.x * 0.44, size.y * 0.68, 0.06);
    door.position.set(0, size.y * 0.34, size.z / 2 + 0.03);
    group.add(door);

    const handle = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metal));
    handle.scale.set(0.07, 0.07, 0.07);
    handle.position.set(size.x * 0.14, size.y * 0.34, size.z / 2 + 0.08);
    group.add(handle);
  }

  if (variant === 'stairwell') {
    // The vent hood that marks a stair head rather than a store cupboard.
    const hood = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metalDark));
    hood.scale.set(size.x * 0.34, 0.22, size.z * 0.34);
    hood.position.y = size.y + capHeight + 0.11;
    hood.castShadow = true;
    group.add(hood);
  }

  if (variant === 'shed') {
    // Boarding, read as three vertical battens.
    for (const t of [-0.28, 0, 0.28]) {
      const batten = new THREE.Mesh(boxGeo(), getMaterial(trimColor));
      batten.scale.set(0.07, size.y * 0.9, 0.04);
      batten.position.set(t * size.x, size.y * 0.45, size.z / 2 + 0.02);
      group.add(batten);
    }
  }

  if (variant === 'hvac') {
    // Housing plus its ducting: two drums on the roof and a louvre panel on the
    // face, all above or against the box.
    for (const side of [-1, 1]) {
      const drum = new THREE.Mesh(cylGeo(10), getMaterial(PALETTE.metalDark));
      const radius = Math.min(size.x, size.z) * 0.22;
      drum.scale.set(radius, 0.3, radius);
      drum.position.set(side * size.x * 0.26, size.y + capHeight + 0.15, 0);
      drum.castShadow = true;
      group.add(drum);
    }

    const louvre = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metalDark));
    louvre.scale.set(size.x * 0.7, size.y * 0.5, 0.04);
    louvre.position.set(0, size.y * 0.5, size.z / 2 + 0.02);
    group.add(louvre);

    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metal));
      slat.scale.set(size.x * 0.66, 0.03, 0.03);
      slat.position.set(0, size.y * (0.32 + i * 0.12), size.z / 2 + 0.05);
      group.add(slat);
    }
  }

  return group;
}

// ---------------------------------------------------------------------------
// Roof clutter
// ---------------------------------------------------------------------------

/** Brick chimney stack with terracotta pots on top. */
export function buildChimney(options: { height?: number; width?: number; pots?: number } = {}): THREE.Group {
  const height = options.height ?? 1.4;
  const width = options.width ?? 0.5;
  const potCount = options.pots ?? 2;
  const group = new THREE.Group();

  const stack = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.terracottaDark));
  stack.scale.set(width, height, width);
  stack.position.y = height / 2;
  stack.castShadow = true;
  stack.receiveShadow = true;
  group.add(stack);

  const capHeight = width * 0.22;
  const cap = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.creamDark));
  cap.scale.set(width * 1.25, capHeight, width * 1.25);
  cap.position.y = height + capHeight / 2;
  cap.castShadow = true;
  group.add(cap);

  const potRadius = width * 0.32;
  const potHeight = width * 0.5;
  for (let i = 0; i < potCount; i++) {
    const t = potCount === 1 ? 0.5 : i / (potCount - 1);
    const x = (t - 0.5) * (width - potRadius * 2.2);
    const pot = new THREE.Mesh(cylGeo(), getMaterial(PALETTE.terracotta));
    pot.scale.set(potRadius, potHeight, potRadius);
    pot.position.set(x, height + capHeight + potHeight / 2, 0);
    pot.castShadow = true;
    group.add(pot);
  }

  return group;
}

/** Boxy metal condenser unit with a recessed fan grille and top vents. */
export function buildAcUnit(options: { size?: THREE.Vector3 } = {}): THREE.Group {
  const size = options.size ?? new THREE.Vector3(0.9, 0.6, 0.5);
  const group = new THREE.Group();

  const body = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metal));
  body.scale.copy(size);
  body.position.y = size.y / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // "Recessed" grille is a darker inset panel sitting just proud of the face -
  // reads as depth without an actual cavity, at zero extra triangle cost.
  const grille = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metalDark));
  grille.scale.set(size.x * 0.72, size.y * 0.6, 0.02);
  grille.position.set(0, size.y * 0.55, size.z / 2 + 0.001);
  group.add(grille);

  const slatCount = 5;
  for (let i = 0; i < slatCount; i++) {
    const t = (i + 0.5) / slatCount - 0.5;
    const slat = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metal));
    slat.scale.set(size.x * 0.68, 0.02, 0.03);
    slat.position.set(0, size.y * 0.55 + t * size.y * 0.55, size.z / 2 + 0.015);
    group.add(slat);
  }

  for (const side of [-1, 1]) {
    const vent = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metalDark));
    vent.scale.set(size.x * 0.18, 0.03, size.z * 0.5);
    vent.position.set(side * size.x * 0.3, size.y + 0.015, 0);
    group.add(vent);
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const foot = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metalDark));
      foot.scale.set(0.06, 0.06, 0.06);
      foot.position.set(sx * size.x * 0.42, 0.03, sz * size.z * 0.42);
      foot.castShadow = true;
      group.add(foot);
    }
  }

  return group;
}

function dishLatheGeo(): THREE.LatheGeometry {
  return cachedGeometry('dishLathe', () => {
    // Revolve profile from the centre outward with a gentle upward curve -
    // a cheap parabola stand-in that reads fine at prop scale.
    const points = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.18, 0.03),
      new THREE.Vector2(0.36, 0.09),
      new THREE.Vector2(0.5, 0.2),
      new THREE.Vector2(0.58, 0.34),
    ];
    return new THREE.LatheGeometry(points, 12);
  });
}

/** Satellite dish (parabola via LatheGeometry) with an arm, feed horn and mount post. */
export function buildSatelliteDish(options: { scale?: number; tilt?: number } = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const tilt = options.tilt ?? 0.6;
  const group = new THREE.Group();

  const post = new THREE.Mesh(cylGeo(6), getMaterial(PALETTE.metalDark));
  post.scale.set(0.04 * scale, 0.3 * scale, 0.04 * scale);
  post.position.y = 0.15 * scale;
  post.castShadow = true;
  group.add(post);

  const pivot = new THREE.Group();
  pivot.position.y = 0.3 * scale;
  group.add(pivot);

  // Dish, arm and feed horn all sit on one "aim" group so tilting the dish
  // automatically carries the arm and horn with it.
  const aim = new THREE.Group();
  aim.rotation.x = tilt;
  pivot.add(aim);

  const dish = new THREE.Mesh(dishLatheGeo(), getMaterial(PALETTE.white, { side: THREE.DoubleSide }));
  dish.scale.setScalar(scale);
  dish.castShadow = true;
  aim.add(dish);

  const arm = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metal));
  arm.scale.set(0.025 * scale, 0.5 * scale, 0.025 * scale);
  arm.position.set(0, 0.25 * scale, 0);
  aim.add(arm);

  const horn = new THREE.Mesh(coneGeo(6), getMaterial(PALETTE.metalDark));
  horn.scale.set(0.05 * scale, 0.1 * scale, 0.05 * scale);
  horn.position.set(0, 0.5 * scale, 0);
  horn.rotation.x = Math.PI;
  aim.add(horn);

  return group;
}

/** Spinning roof fan housing. The blades are a named child so callers can rotate them. */
export function buildRoofFan(options: { scale?: number } = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const group = new THREE.Group();

  const housing = new THREE.Mesh(cylGeo(10), getMaterial(PALETTE.metal));
  housing.scale.set(0.4 * scale, 0.12 * scale, 0.4 * scale);
  housing.position.y = 0.06 * scale;
  housing.castShadow = true;
  housing.receiveShadow = true;
  group.add(housing);

  const rim = new THREE.Mesh(torusGeo(), getMaterial(PALETTE.metalDark));
  rim.scale.setScalar(0.4 * scale);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.12 * scale;
  group.add(rim);

  // Named so the caller can spin this independently of the static housing -
  // and marked animated so freezeStatic() does not bake that independence away.
  const blades = markAnimated(new THREE.Group());
  blades.name = 'blades';
  blades.position.y = 0.1 * scale;
  group.add(blades);

  const bladeCount = 4;
  for (let i = 0; i < bladeCount; i++) {
    const bladePivot = new THREE.Group();
    bladePivot.rotation.y = (i / bladeCount) * Math.PI * 2;
    const blade = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metalDark));
    blade.scale.set(0.34 * scale, 0.015 * scale, 0.09 * scale);
    blade.position.x = 0.17 * scale;
    bladePivot.add(blade);
    blades.add(bladePivot);
  }

  const hub = new THREE.Mesh(cylGeo(8), getMaterial(PALETTE.metal));
  hub.scale.set(0.05 * scale, 0.03 * scale, 0.05 * scale);
  blades.add(hub);

  return group;
}

/** Wooden barrel water tank on a riveted steel leg frame, with an access ladder. */
export function buildWaterTank(options: { scale?: number } = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const group = new THREE.Group();

  const legHeight = 1.1 * scale;
  const legSpread = 0.55 * scale;
  const legMat = getMaterial(PALETTE.metalDark);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(cylGeo(6), legMat);
      leg.scale.set(0.035 * scale, legHeight, 0.035 * scale);
      leg.position.set(sx * legSpread, legHeight / 2, sz * legSpread);
      leg.castShadow = true;
      group.add(leg);
    }
  }

  const frameH = legHeight * 0.5;
  for (const sz of [-1, 1]) {
    const brace = new THREE.Mesh(boxGeo(), legMat);
    brace.scale.set(legSpread * 2, 0.03 * scale, 0.03 * scale);
    brace.position.set(0, frameH, sz * legSpread);
    group.add(brace);
  }
  for (const sx of [-1, 1]) {
    const brace = new THREE.Mesh(boxGeo(), legMat);
    brace.scale.set(0.03 * scale, 0.03 * scale, legSpread * 2);
    brace.position.set(sx * legSpread, frameH, 0);
    group.add(brace);
  }
  // Diagonal cross-brace on the -Z face for a "riveted steel tower" read.
  const diagLen = Math.hypot(legSpread * 2, frameH);
  for (const dir of [1, -1]) {
    const diag = new THREE.Mesh(boxGeo(), legMat);
    diag.scale.set(diagLen, 0.025 * scale, 0.02 * scale);
    diag.position.set(0, frameH * 0.5, -legSpread);
    diag.rotation.z = dir * Math.atan2(frameH, legSpread * 2);
    group.add(diag);
  }

  const tankRadius = 0.55 * scale;
  const tankHeight = 0.75 * scale;
  const tankY = legHeight + tankHeight / 2;

  const barrel = new THREE.Mesh(cylGeo(10), getMaterial(PALETTE.wood));
  barrel.scale.set(tankRadius, tankHeight, tankRadius);
  barrel.position.y = tankY;
  barrel.castShadow = true;
  barrel.receiveShadow = true;
  group.add(barrel);

  const hoopMat = getMaterial(PALETTE.metalDark);
  for (const t of [0.22, 0.5, 0.78]) {
    const hoop = new THREE.Mesh(torusGeo(), hoopMat);
    hoop.scale.setScalar(tankRadius);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = legHeight + tankHeight * t;
    group.add(hoop);
  }

  const capHeight = tankRadius * 0.5;
  const cap = new THREE.Mesh(coneGeo(10), getMaterial(PALETTE.metalDark));
  cap.scale.set(tankRadius * 1.05, capHeight, tankRadius * 1.05);
  cap.position.y = legHeight + tankHeight + capHeight / 2;
  cap.castShadow = true;
  group.add(cap);

  // Ladder up one side to the access hatch.
  const railMat = getMaterial(PALETTE.metal);
  const ladderX = legSpread + 0.04 * scale;
  const ladderHeight = legHeight + tankHeight * 0.4;
  for (const dz of [-0.08, 0.08]) {
    const rail = new THREE.Mesh(boxGeo(), railMat);
    rail.scale.set(0.02 * scale, ladderHeight, 0.02 * scale);
    rail.position.set(ladderX, ladderHeight / 2, dz * scale);
    group.add(rail);
  }
  const rungCount = 6;
  for (let i = 0; i < rungCount; i++) {
    const rung = new THREE.Mesh(boxGeo(), railMat);
    rung.scale.set(0.02 * scale, 0.02 * scale, 0.2 * scale);
    rung.position.set(ladderX, 0.15 * scale + i * 0.18 * scale, 0);
    group.add(rung);
  }

  return group;
}

/** Half-thickness of the awning's fabric panel, for colliders that must sit on it. */
export const AWNING_PANEL_HALF_THICKNESS = 0.01;

/**
 * The awning's tilt as a rotation about local X, from an angle in degrees.
 *
 * Negative, because the fabric extends along **-Z** from its pivot: a positive
 * rotation about X lifts a -Z point, which would tip the awning up into the air
 * instead of down away from the wall.
 *
 * Exported so the visual and its collider cannot drift apart - getting these two
 * out of step is exactly what made the level 1 awning unridable.
 */
export function awningTiltRadians(angleDegrees: number): number {
  return -THREE.MathUtils.degToRad(angleDegrees);
}

/**
 * Striped sloped fabric awning with a metal support frame. Stripes are real
 * geometry.
 *
 * `angle` is in **degrees**, matching the level-data convention documented in
 * LevelTypes. It used to be applied as raw radians while every level authored
 * degrees, so level 1's `angle: 16` tilted the fabric 916 degrees - the panel
 * ended up somewhere unrelated to its collider and the awning descent could not
 * be completed.
 */
export function buildAwning(
  options: { width?: number; depth?: number; angle?: number; color?: number } = {},
): THREE.Group {
  const width = options.width ?? 1.6;
  const depth = options.depth ?? 0.9;
  const angle = options.angle ?? 30;
  const stripeColor = options.color ?? PALETTE.fabricRed;
  const altColor = PALETTE.fabricCream;
  const thickness = AWNING_PANEL_HALF_THICKNESS * 2;

  const group = new THREE.Group();

  // Pivots at the wall attachment (group origin) and tips forward/down by
  // `angle`. The panel's own geometry runs from the pivot outward along -z,
  // so after rotation the whole thing slopes down and away from the wall.
  const slope = new THREE.Group();
  slope.rotation.x = awningTiltRadians(angle);
  group.add(slope);

  const panel = new THREE.Mesh(boxGeo(), getMaterial(stripeColor));
  panel.scale.set(width, thickness, depth);
  panel.position.set(0, 0, -depth / 2);
  panel.castShadow = true;
  panel.receiveShadow = true;
  slope.add(panel);

  // Painted stripes as thin overlay quads - real geometry, not a texture.
  const stripeCount = 6;
  const stripeWidth = width / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    if (i % 2 === 0) continue; // the base panel already provides colour A
    const stripe = new THREE.Mesh(boxGeo(), getMaterial(altColor));
    stripe.scale.set(stripeWidth * 0.94, thickness * 1.4, depth * 0.98);
    stripe.position.set(-width / 2 + stripeWidth * (i + 0.5), 0, -depth / 2);
    slope.add(stripe);
  }

  // Scalloped hem along the low front edge - the classic awning silhouette.
  const scallopCount = stripeCount * 2;
  const matA = getMaterial(stripeColor);
  const matB = getMaterial(altColor);
  for (let i = 0; i < scallopCount; i++) {
    const scallop = new THREE.Mesh(coneGeo(3), i % 2 === 0 ? matA : matB);
    scallop.scale.set(width / scallopCount, 0.14, thickness * 2);
    scallop.rotation.z = Math.PI;
    scallop.position.set(-width / 2 + (width / scallopCount) * (i + 0.5), -0.07, -depth);
    slope.add(scallop);
  }

  // Support arms brace the panel back to the wall.
  const frameMat = getMaterial(PALETTE.metalDark);
  const armLength = Math.hypot(depth, depth * Math.tan(angle));
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(boxGeo(), frameMat);
    arm.scale.set(0.025, armLength, 0.025);
    arm.rotation.x = angle - Math.PI / 2;
    arm.position.set(sx * (width / 2 - 0.06), -depth * 0.35, -depth * 0.35);
    group.add(arm);
  }

  return group;
}

/**
 * How high above the walking surface a *hazard* clothesline is strung.
 *
 * Set so the obstacle cannot be jumped, which is the whole design of it. The
 * cat's jump apex lifts the bottom of its capsule to `jumpImpulse^2 / (2 * g)`
 * = 7.9^2 / 36 = 1.73 units; a rope at 1.8 is above that by a margin no timing
 * can close, so the only answer is to go under. Anything lower would leave a
 * perfectly-timed jump as a second solution and the slide as optional.
 */
export const CLOTHESLINE_ROPE_HEIGHT = 1.8;

/**
 * How far the laundry hangs below the rope on a hazard line.
 *
 * Leaves the bottom edge at 0.55 above the roof - under a standing cat, whose
 * capsule is a full unit tall, and over a tucked one. That gap is the obstacle:
 * it is what makes the curtain a thing you fit under rather than a wall.
 */
export const CLOTHESLINE_CURTAIN_DROP = 1.25;

/**
 * Rope strung between two points, sagging like a loose catenary, with garments
 * hanging off it.
 *
 * Two very different props come out of here, and the difference is `hazard`:
 *
 *   - **scenery** (the default) is the small line strung high overhead between
 *     two buildings. Its garments are hand-sized and the cat runs under it
 *     without ever touching it.
 *   - **hazard** is the obstacle: full sheets hung shoulder to shoulder into a
 *     curtain the runner has to slide under, on posts at either end. It is
 *     drawn to be read at distance rather than admired up close - big flat
 *     blocks of colour, high contrast against the roof, and enough of them that
 *     the span reads as solid instead of as gaps with cloth between them.
 *
 * EXCEPTION to the base-origin convention: `start`/`end` are world-space
 * points, so this group is positioned at the scene origin and every child
 * carries an absolute position - there is no local origin to drop onto a
 * rooftop, the line itself spans two of them.
 */
export function buildLaundryLine(
  start: THREE.Vector3,
  end: THREE.Vector3,
  options: { garments?: number; sag?: number; hazard?: boolean } = {},
): THREE.Group {
  const hazard = options.hazard ?? false;
  const garments = options.garments ?? (hazard ? 7 : 4);
  const sag = options.sag ?? (hazard ? 0.12 : 0.35);
  const group = new THREE.Group();

  const segments = 12;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = new THREE.Vector3().lerpVectors(start, end, t);
    // Parabolic sag, deepest at the midpoint - a cheap stand-in for a true
    // catenary that looks right at these spans. A hazard line sags much less:
    // the bottom edge of the curtain is the gameplay surface and it has to be
    // the same height all the way across, or the middle lane is harder than the
    // outer two for reasons the player cannot see.
    p.y -= Math.sin(t * Math.PI) * sag;
    points.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const rope = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments, hazard ? 0.03 : 0.012, 5, false),
    getMaterial(PALETTE.rope),
  );
  rope.castShadow = true;
  group.add(rope);

  const garmentColors = [
    PALETTE.fabricRed,
    PALETTE.fabricCream,
    PALETTE.fabricTeal,
    PALETTE.fabricGold,
    PALETTE.fabricNavy,
  ];

  if (hazard) {
    const span = start.distanceTo(end);
    // Overlapping on purpose: a curtain with daylight between the sheets reads
    // as something to weave through, which is the wrong answer.
    const width = (span / garments) * 1.15;

    for (let i = 0; i < garments; i++) {
      const t = (i + 0.5) / garments;
      const anchor = curve.getPointAt(t);
      const height = CLOTHESLINE_CURTAIN_DROP - (i % 2) * 0.06;

      const garment = new THREE.Mesh(
        planeGeo(),
        getMaterial(garmentColors[i % garmentColors.length], { side: THREE.DoubleSide }),
      );
      garment.scale.set(width, height, 1);
      garment.position.set(anchor.x, anchor.y - height / 2, anchor.z);
      // Barely rotated, unlike the scenery version. A sheet turned edge-on to
      // the runner is a sheet they cannot see coming.
      garment.rotation.z = (((i * 53) % 10) / 10 - 0.5) * 0.05;
      garment.castShadow = true;
      // Named so `Clothesline` can find and sway them; see ANIMATED_KINDS.
      garment.name = `garment${i}`;
      group.add(garment);

      const peg = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.woodDark));
      peg.scale.set(0.05, 0.09, 0.05);
      peg.position.set(anchor.x, anchor.y + 0.03, anchor.z);
      group.add(peg);
    }

    // Posts at both ends, so the line reads as installed rather than floating.
    for (const anchor of [start, end]) {
      const post = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metalDark));
      post.scale.set(0.09, CLOTHESLINE_ROPE_HEIGHT, 0.09);
      post.position.set(anchor.x, anchor.y - CLOTHESLINE_ROPE_HEIGHT / 2, anchor.z);
      post.castShadow = true;
      group.add(post);
    }

    return group;
  }

  for (let i = 0; i < garments; i++) {
    const t = (i + 1) / (garments + 1);
    const anchor = curve.getPointAt(t);
    const w = 0.22 + (i % 3) * 0.03;
    const h = 0.3 + (i % 2) * 0.08;
    const garment = new THREE.Mesh(
      planeGeo(),
      getMaterial(garmentColors[i % garmentColors.length], { side: THREE.DoubleSide }),
    );
    garment.scale.set(w, h, 1);
    garment.position.set(anchor.x, anchor.y - h / 2, anchor.z);
    // Deterministic pseudo-random rotation per garment so the line doesn't
    // look like a row of identical cutouts.
    garment.rotation.y = ((i * 37) % 10) / 10 - 0.5;
    garment.rotation.z = (((i * 53) % 10) / 10 - 0.5) * 0.15;
    garment.castShadow = true;
    garment.name = `garment${i}`;
    group.add(garment);
  }

  return group;
}

/**
 * Weathered wooden plank with visible board seams and underside battens.
 *
 * Axis convention: **length runs along Z, width across X**, matching the plank
 * collider in ObstacleFactory and the +Z direction the levels' routes run. The
 * boards used to run along X while the collider ran along Z, which put the
 * visible board across the gap it was supposed to bridge and the invisible
 * collider along it - the "platform with no collision" the player falls through.
 */
export const PLANK_THICKNESS = 0.06;

export function buildPlank(length: number, width = 0.5): THREE.Group {
  const group = new THREE.Group();
  const thickness = PLANK_THICKNESS;
  const boardCount = Math.max(2, Math.round(width / 0.18));
  const boardWidth = width / boardCount;

  for (let i = 0; i < boardCount; i++) {
    const board = new THREE.Mesh(boxGeo(), getMaterial(i % 2 === 0 ? PALETTE.wood : PALETTE.woodDark));
    board.scale.set(boardWidth * 0.92, thickness, length);
    board.position.set(-width / 2 + boardWidth * (i + 0.5), thickness / 2, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    group.add(board);
  }

  // Cross battens on the underside - reads as "planks nailed to two rails".
  const battenMat = getMaterial(PALETTE.woodDark);
  for (const t of [0.15, 0.85]) {
    const batten = new THREE.Mesh(boxGeo(), battenMat);
    batten.scale.set(width * 0.96, 0.03, 0.08);
    batten.position.set(0, -0.015, -length / 2 + length * t);
    group.add(batten);
  }

  return group;
}

/** Wooden crate with corner and mid-height battens. */
export function buildCrate(options: { size?: number } = {}): THREE.Group {
  const size = options.size ?? 0.6;
  const group = new THREE.Group();

  const body = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.wood));
  body.scale.set(size, size, size);
  body.position.y = size / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const battenMat = getMaterial(PALETTE.woodDark);
  const battenThickness = size * 0.08;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const batten = new THREE.Mesh(boxGeo(), battenMat);
      batten.scale.set(battenThickness, size * 1.02, battenThickness);
      batten.position.set(sx * (size / 2 - battenThickness / 2), size / 2, sz * (size / 2 - battenThickness / 2));
      group.add(batten);
    }
  }
  for (const axis of ['x', 'z'] as const) {
    const band = new THREE.Mesh(boxGeo(), battenMat);
    if (axis === 'x') band.scale.set(size * 1.02, battenThickness, battenThickness);
    else band.scale.set(battenThickness, battenThickness, size * 1.02);
    band.position.y = size * 0.55;
    group.add(band);
  }

  return group;
}

/** Barrel with dark metal hoops. */
export function buildBarrel(options: { scale?: number } = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const group = new THREE.Group();
  const radius = 0.32 * scale;
  const height = 0.6 * scale;
  const woodMat = getMaterial(PALETTE.wood);

  // Two stacked cylinders of slightly different radius fake a bulged barrel
  // profile cheaply, without a lathe.
  const lower = new THREE.Mesh(cylGeo(10), woodMat);
  lower.scale.set(radius * 0.94, height * 0.5, radius * 0.94);
  lower.position.y = height * 0.25;
  lower.castShadow = true;
  lower.receiveShadow = true;
  group.add(lower);

  const upper = new THREE.Mesh(cylGeo(10), woodMat);
  upper.scale.set(radius, height * 0.5, radius);
  upper.position.y = height * 0.75;
  upper.castShadow = true;
  group.add(upper);

  const hoopMat = getMaterial(PALETTE.metalDark);
  for (const t of [0.12, 0.5, 0.88]) {
    const hoop = new THREE.Mesh(torusGeo(), hoopMat);
    hoop.scale.setScalar(t === 0.5 ? radius * 1.03 : radius * 0.97);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = height * t;
    group.add(hoop);
  }

  return group;
}

/** Terracotta pot with a small leafy plant. */
export function buildFlowerpot(options: { scale?: number } = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const group = new THREE.Group();

  const potHeight = 0.28 * scale;
  const pot = new THREE.Mesh(cylGeo(8), getMaterial(PALETTE.terracotta));
  pot.scale.set(0.18 * scale, potHeight, 0.18 * scale);
  pot.position.y = potHeight / 2;
  pot.castShadow = true;
  pot.receiveShadow = true;
  group.add(pot);

  const rim = new THREE.Mesh(torusGeo(), getMaterial(PALETTE.terracottaDark));
  rim.scale.setScalar(0.18 * scale);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = potHeight;
  group.add(rim);

  const leafCount = 6;
  for (let i = 0; i < leafCount; i++) {
    const a = (i / leafCount) * Math.PI * 2;
    const leaf = new THREE.Mesh(coneGeo(4), getMaterial(i % 2 === 0 ? PALETTE.leaf : PALETTE.leafDark));
    leaf.scale.set(0.06 * scale, 0.28 * scale, 0.06 * scale);
    leaf.position.set(Math.cos(a) * 0.06 * scale, potHeight + 0.14 * scale, Math.sin(a) * 0.06 * scale);
    leaf.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    leaf.castShadow = true;
    group.add(leaf);
  }

  const bud = new THREE.Mesh(sphereGeo(6, 5), getMaterial(PALETTE.leafDark));
  bud.scale.setScalar(0.08 * scale);
  bud.position.y = potHeight + 0.34 * scale;
  group.add(bud);

  return group;
}

/** Most shrubs one planter will ever hold, however long the planter is. */
const MAX_SHRUBS = 14;

/** Planters, shrubs and a small trellis. Decorative only, no collider. */
export function buildRooftopGarden(options: { width?: number; depth?: number } = {}): THREE.Group {
  const width = options.width ?? 2.4;
  const depth = options.depth ?? 1.4;
  const group = new THREE.Group();
  const planterHeight = 0.3;

  for (const sz of [-1, 1]) {
    const planter = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.woodDark));
    planter.scale.set(width * 0.92, planterHeight, 0.22);
    planter.position.set(0, planterHeight / 2, sz * (depth / 2 - 0.15));
    planter.castShadow = true;
    planter.receiveShadow = true;
    group.add(planter);

    // Density, then a ceiling. `width` is the whole rooftop the garden dresses,
    // not a planter-sized number: ObstacleFactory hands this the platform's full
    // footprint, so a 30-unit roof asked for 86 shrubs *per planter* and one
    // decorative strip became the heaviest object in the level. Past a dozen or
    // so the shrubs read as a continuous hedge anyway, so the cap costs nothing
    // visible and the spacing simply widens to keep covering the planter.
    const shrubCount = Math.min(MAX_SHRUBS, Math.round(width / 0.35));
    for (let i = 0; i < shrubCount; i++) {
      const x = -width * 0.45 + ((i + 0.5) * (width * 0.9)) / shrubCount;
      const shrub = new THREE.Mesh(sphereGeo(6, 5), getMaterial(i % 2 === 0 ? PALETTE.leaf : PALETTE.leafDark));
      shrub.scale.setScalar(0.13 + (i % 3) * 0.015);
      shrub.position.set(x, planterHeight + 0.1, sz * (depth / 2 - 0.15));
      shrub.castShadow = true;
      group.add(shrub);
    }
  }

  // Pots pushed out toward the planters rather than left on the centreline.
  // `width` here is the whole rooftop, so `z = 0` put them exactly on the lane
  // the runner occupies - on level 1's 49x14 garden roof that was two pots
  // standing in the middle lane. They carry no collider, so the cat ran through
  // them, which looks worse than being blocked by them.
  for (const [i, x] of [-width * 0.25, width * 0.25].entries()) {
    const pot = buildFlowerpot({ scale: 0.9 });
    pot.position.set(x, 0, (i === 0 ? -1 : 1) * depth * 0.32);
    group.add(pot);
  }

  // Simple trellis against the far edge - a lattice of thin battens.
  const trellis = new THREE.Group();
  trellis.position.set(0, 0, depth / 2 - 0.05);
  const trellisMat = getMaterial(PALETTE.wood);
  const trellisHeight = 1.1;
  const trellisWidth = width * 0.5;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(boxGeo(), trellisMat);
    post.scale.set(0.03, trellisHeight, 0.03);
    post.position.set((sx * trellisWidth) / 2, trellisHeight / 2, 0);
    post.castShadow = true;
    trellis.add(post);
  }
  const rungCount = 4;
  for (let i = 0; i < rungCount; i++) {
    const rung = new THREE.Mesh(boxGeo(), trellisMat);
    rung.scale.set(trellisWidth, 0.025, 0.025);
    rung.position.set(0, (trellisHeight / rungCount) * (i + 0.5), 0);
    trellis.add(rung);
  }
  const vine = new THREE.Mesh(sphereGeo(6, 5), getMaterial(PALETTE.leaf));
  vine.scale.set(trellisWidth * 0.5, 0.16, 0.12);
  vine.position.set(0, trellisHeight, 0);
  trellis.add(vine);
  group.add(trellis);

  return group;
}

/** Hanging restaurant sign board with a painted fish motif, or a generic lettered variant. */
export function buildRestaurantSign(
  text: 'fish' | 'generic' = 'fish',
  options: { width?: number; height?: number; neon?: boolean } = {},
): THREE.Group {
  const width = options.width ?? 1.0;
  const height = options.height ?? 0.6;
  const neon = options.neon ?? false;
  const group = new THREE.Group();

  const boardColor = neon ? PALETTE.duskPurple : PALETTE.creamDark;
  const board = new THREE.Mesh(boxGeo(), getMaterial(boardColor, neon ? { emissive: 0x1a0e2e } : undefined));
  board.scale.set(width, height, 0.04);
  board.position.y = height / 2;
  board.castShadow = true;
  group.add(board);

  const frameMat = getMaterial(PALETTE.woodDark);
  const frameThickness = 0.04;
  for (const horiz of [true, false]) {
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(boxGeo(), frameMat);
      if (horiz) {
        bar.scale.set(width + frameThickness, frameThickness, 0.05);
        bar.position.set(0, s === 1 ? height : 0, 0);
      } else {
        bar.scale.set(frameThickness, height, 0.05);
        bar.position.set(s * (width / 2), height / 2, 0);
      }
      group.add(bar);
    }
  }

  const accent = neon ? PALETTE.neonPink : PALETTE.terracotta;
  const accentMat = getMaterial(accent, neon ? { emissive: accent } : undefined);

  if (text === 'fish') {
    // Simple painted fish - body, tail, dorsal fin, eye - built from primitives.
    const fishGroup = new THREE.Group();
    fishGroup.position.set(0, height / 2, 0.03);

    const body = new THREE.Mesh(sphereGeo(8, 6), accentMat);
    body.scale.set(width * 0.28, height * 0.28, 0.02);
    fishGroup.add(body);

    const tail = new THREE.Mesh(coneGeo(3), accentMat);
    tail.scale.set(width * 0.16, width * 0.16, 0.02);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-width * 0.26, 0, 0);
    fishGroup.add(tail);

    const eye = new THREE.Mesh(sphereGeo(5, 4), getMaterial(PALETTE.duskPurple));
    eye.scale.setScalar(0.025);
    eye.position.set(width * 0.12, height * 0.05, 0.03);
    fishGroup.add(eye);

    group.add(fishGroup);
  } else {
    // Generic sign - a few painted bars stand in for lettering.
    for (const i of [-1, 0, 1]) {
      const bar = new THREE.Mesh(boxGeo(), accentMat);
      bar.scale.set(width * 0.55, height * 0.12, 0.02);
      bar.position.set(0, height / 2 + i * height * 0.22, 0.03);
      group.add(bar);
    }
  }

  // Mount stem so the caller can hang this from a bracket above.
  const arm = new THREE.Mesh(cylGeo(6), getMaterial(PALETTE.metalDark));
  arm.scale.set(0.02, 0.15, 0.02);
  arm.position.set(0, height + 0.075, 0);
  group.add(arm);

  return group;
}

/**
 * Large sign panel with a frame, painted accent stripes standing in for
 * artwork, and suspension rods.
 *
 * EXCEPTION to the base-origin convention: this prop swings from a pivot, so
 * the group origin is the TOP mounting point (y = 0) and the panel hangs
 * below it in -y.
 */
export function buildBillboard(options: { width?: number; height?: number } = {}): THREE.Group {
  const width = options.width ?? 2.2;
  const height = options.height ?? 1.4;
  const group = new THREE.Group();
  const frameMat = getMaterial(PALETTE.metalDark);

  const panel = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.cream));
  panel.scale.set(width, height, 0.05);
  panel.position.y = -height / 2;
  panel.castShadow = true;
  panel.receiveShadow = true;
  group.add(panel);

  for (const horiz of [true, false]) {
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(boxGeo(), frameMat);
      if (horiz) {
        bar.scale.set(width + 0.06, 0.06, 0.07);
        bar.position.set(0, s === 1 ? 0 : -height, 0);
      } else {
        bar.scale.set(0.06, height, 0.07);
        bar.position.set((s * width) / 2, -height / 2, 0);
      }
      group.add(bar);
    }
  }

  for (const i of [-1, 0, 1]) {
    const stripe = new THREE.Mesh(boxGeo(), getMaterial(i === 0 ? PALETTE.terracotta : PALETTE.fabricTeal));
    stripe.scale.set(width * 0.8, height * 0.15, 0.02);
    stripe.position.set(0, -height / 2 + i * height * 0.25, 0.03);
    group.add(stripe);
  }

  for (const sx of [-1, 1]) {
    const rod = new THREE.Mesh(cylGeo(4), frameMat);
    rod.scale.set(0.015, 0.1, 0.015);
    rod.position.set(sx * width * 0.4, -0.05, 0);
    group.add(rod);
  }

  return group;
}

/** Capped vent pipe on the roof. */
export function buildSteamPipe(options: { scale?: number } = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const group = new THREE.Group();
  const height = 0.5 * scale;
  const radius = 0.09 * scale;

  const pipe = new THREE.Mesh(cylGeo(8), getMaterial(PALETTE.metal));
  pipe.scale.set(radius, height, radius);
  pipe.position.y = height / 2;
  pipe.castShadow = true;
  pipe.receiveShadow = true;
  group.add(pipe);

  const collar = new THREE.Mesh(cylGeo(8), getMaterial(PALETTE.metalDark));
  collar.scale.set(radius * 1.2, height * 0.08, radius * 1.2);
  collar.position.y = height * 0.1;
  group.add(collar);

  // Rim gap under the cap so it reads as a vented cap, not a solid spike.
  const rim = new THREE.Mesh(cylGeo(8), getMaterial(PALETTE.metalDark));
  rim.scale.set(radius * 1.3, height * 0.03, radius * 1.3);
  rim.position.y = height;
  group.add(rim);

  const cap = new THREE.Mesh(coneGeo(8), getMaterial(PALETTE.metalDark));
  cap.scale.set(radius * 1.3, radius * 0.9, radius * 1.3);
  cap.position.y = height + (radius * 0.9) / 2;
  cap.castShadow = true;
  group.add(cap);

  return group;
}

/** Flat metal steam-vent grate. */
export function buildSteamVentGrate(options: { radius?: number } = {}): THREE.Group {
  const radius = options.radius ?? 0.35;
  const group = new THREE.Group();

  const base = new THREE.Mesh(cylGeo(10), getMaterial(PALETTE.metalDark));
  base.scale.set(radius, 0.02, radius);
  base.position.y = 0.01;
  base.receiveShadow = true;
  group.add(base);

  // Slats as real geometry gaps rather than a texture, so it still reads
  // correctly up close.
  const slatCount = 7;
  const slatMat = getMaterial(PALETTE.metal);
  for (let i = 0; i < slatCount; i++) {
    const t = (i + 0.5) / slatCount - 0.5;
    const chordHalf = Math.sqrt(Math.max(radius * radius - (t * radius * 2) ** 2, 0));
    const slat = new THREE.Mesh(boxGeo(), slatMat);
    slat.scale.set(chordHalf * 2 * 0.9, 0.015, radius * 0.14);
    slat.position.set(0, 0.025, t * radius * 2);
    group.add(slat);
  }

  const rim = new THREE.Mesh(torusGeo(), getMaterial(PALETTE.metal));
  rim.scale.setScalar(radius);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.02;
  group.add(rim);

  return group;
}

/** Tiny low-poly pigeon. Wings are named so a flap animation can drive them. */
export function buildPigeon(options: { scale?: number } = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const group = new THREE.Group();
  const bodyMat = getMaterial(PALETTE.metal); // dove-grey doubles as pigeon plumage
  const darkMat = getMaterial(PALETTE.metalDark);

  const body = new THREE.Mesh(sphereGeo(7, 6), bodyMat);
  body.scale.set(0.09 * scale, 0.08 * scale, 0.14 * scale);
  body.position.y = 0.09 * scale;
  group.add(body);

  const head = new THREE.Mesh(sphereGeo(6, 5), bodyMat);
  head.scale.setScalar(0.055 * scale);
  head.position.set(0, 0.14 * scale, 0.11 * scale);
  group.add(head);

  const beak = new THREE.Mesh(coneGeo(4), getMaterial(PALETTE.terracotta));
  beak.scale.set(0.018 * scale, 0.04 * scale, 0.018 * scale);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.135 * scale, 0.16 * scale);
  group.add(beak);

  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(sphereGeo(4, 4), darkMat);
    eye.scale.setScalar(0.012 * scale);
    eye.position.set(s * 0.045 * scale, 0.15 * scale, 0.14 * scale);
    group.add(eye);
  }

  const tail = new THREE.Mesh(coneGeo(3), darkMat);
  tail.scale.set(0.05 * scale, 0.12 * scale, 0.02 * scale);
  tail.rotation.x = -Math.PI / 2.3;
  tail.position.set(0, 0.09 * scale, -0.15 * scale);
  group.add(tail);

  // Both wings flap relative to the body, so neither may be merged into it.
  const wingL = markAnimated(new THREE.Mesh(coneGeo(3), darkMat));
  wingL.name = 'wingL';
  wingL.scale.set(0.16 * scale, 0.03 * scale, 0.07 * scale);
  wingL.rotation.z = Math.PI / 2;
  wingL.position.set(0.06 * scale, 0.1 * scale, -0.01 * scale);
  group.add(wingL);

  const wingR = wingL.clone();
  wingR.name = 'wingR';
  wingR.position.x = -0.06 * scale;
  wingR.rotation.z = -Math.PI / 2;
  group.add(wingR);

  // A pigeon is about 0.2 units across and the sun's shadow map covers a
  // hundred, so its shadow was never more than a flickering pixel - and there
  // are up to nine per flock, each of which was a second draw call into that
  // map. Two flocks alone cost 128 shadow draws to render nothing legible.
  group.traverse((child) => {
    child.castShadow = false;
  });

  // Per BIRD, deliberately - never on the flock. The flock moves each pigeon
  // independently, so merging at that level would fuse the whole flock into
  // one rigid lump. Inside a single bird only the wings move, and those are
  // marked animated, so the remaining seven pieces collapse to two draws.
  return freezeStatic(group);
}

/** Simple rooftop tower crane silhouette, for the construction-site level. */
export function buildConstructionCrane(options: { scale?: number } = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const group = new THREE.Group();
  const metalMat = getMaterial(PALETTE.metalDark);

  const towerHeight = 4.5 * scale;
  const tower = new THREE.Mesh(boxGeo(), metalMat);
  tower.scale.set(0.22 * scale, towerHeight, 0.22 * scale);
  tower.position.y = towerHeight / 2;
  tower.castShadow = true;
  group.add(tower);

  // A handful of Xs read fine as lattice bracing at silhouette distance.
  const braceCount = 6;
  for (let i = 0; i < braceCount; i++) {
    const y = (towerHeight / braceCount) * (i + 0.5);
    for (const dir of [1, -1]) {
      const brace = new THREE.Mesh(boxGeo(), metalMat);
      brace.scale.set(0.02 * scale, (towerHeight / braceCount) * 1.3, 0.02 * scale);
      brace.position.set(0, y, 0.11 * scale);
      brace.rotation.x = dir * 0.5;
      group.add(brace);
    }
  }

  const cabinY = towerHeight;
  const cabin = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.terracotta));
  cabin.scale.set(0.4 * scale, 0.3 * scale, 0.4 * scale);
  cabin.position.y = cabinY + 0.15 * scale;
  cabin.castShadow = true;
  group.add(cabin);

  const jibLength = 3.2 * scale;
  const jib = new THREE.Mesh(boxGeo(), metalMat);
  jib.scale.set(jibLength, 0.15 * scale, 0.15 * scale);
  jib.position.set(jibLength * 0.3, cabinY + 0.3 * scale, 0);
  jib.castShadow = true;
  group.add(jib);

  const counterJibLength = jibLength * 0.35;
  const counterJib = new THREE.Mesh(boxGeo(), metalMat);
  counterJib.scale.set(counterJibLength, 0.15 * scale, 0.15 * scale);
  counterJib.position.set(-counterJibLength * 0.6, cabinY + 0.3 * scale, 0);
  group.add(counterJib);

  const counterweight = new THREE.Mesh(boxGeo(), getMaterial(PALETTE.metal));
  counterweight.scale.set(0.35 * scale, 0.35 * scale, 0.3 * scale);
  counterweight.position.set(-counterJibLength * 1.05, cabinY + 0.15 * scale, 0);
  counterweight.castShadow = true;
  group.add(counterweight);

  const cableLength = 1.4 * scale;
  const cable = new THREE.Mesh(cylGeo(4), metalMat);
  cable.scale.set(0.008 * scale, cableLength, 0.008 * scale);
  cable.position.set(jibLength * 0.55, cabinY + 0.3 * scale - cableLength / 2, 0);
  group.add(cable);

  const hook = new THREE.Mesh(torusGeo(), metalMat);
  hook.scale.setScalar(0.06 * scale);
  hook.position.set(jibLength * 0.55, cabinY + 0.3 * scale - cableLength, 0);
  group.add(hook);

  return group;
}

/** Pipe scaffolding lattice. */
export function buildScaffold(
  options: { width?: number; height?: number; depth?: number } = {},
): THREE.Group {
  const width = options.width ?? 1.5;
  const height = options.height ?? 2.2;
  const depth = options.depth ?? 1.0;
  const group = new THREE.Group();
  const pipeMat = getMaterial(PALETTE.metal);

  const levels = Math.max(1, Math.round(height / 1.0));
  const levelHeight = height / levels;

  const corners: [number, number][] = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [-width / 2, depth / 2],
    [width / 2, depth / 2],
  ];
  for (const [x, z] of corners) {
    const post = new THREE.Mesh(cylGeo(6), pipeMat);
    post.scale.set(0.035, height, 0.035);
    post.position.set(x, height / 2, z);
    post.castShadow = true;
    group.add(post);
  }

  for (let level = 0; level <= levels; level++) {
    const y = level * levelHeight;
    for (const z of [-depth / 2, depth / 2]) {
      // Cylinder length runs along local Y; rotate it flat to align with X.
      const rail = new THREE.Mesh(cylGeo(6), pipeMat);
      rail.scale.set(0.03, width, 0.03);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, y, z);
      group.add(rail);
    }
    for (const x of [-width / 2, width / 2]) {
      // Same idea, rotated flat to align with Z instead.
      const rail = new THREE.Mesh(cylGeo(6), pipeMat);
      rail.scale.set(0.03, depth, 0.03);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(x, y, 0);
      group.add(rail);
    }

    if (level < levels) {
      // One diagonal brace per level, front face only - enough to read as
      // scaffolding without doubling the pipe count.
      const diagLength = Math.hypot(width, levelHeight);
      const diag = new THREE.Mesh(cylGeo(4), pipeMat);
      diag.scale.set(0.025, diagLength, 0.025);
      diag.rotation.z = Math.atan2(width, levelHeight);
      diag.position.set(0, y + levelHeight / 2, -depth / 2);
      group.add(diag);
    }
  }

  return group;
}

/**
 * Which edges of a rooftop may carry a rim, given its proportions.
 *
 * `'x'` means the two walls that run along X (at the +/-Z edges), `'z'` the two
 * that run along Z, `'none'` for a platform too square to call.
 *
 * A rooftop the lane track runs *through* is entered and left through its two
 * SHORT edges, so a wall there is a wall across the run - and parapet colliders
 * are `GROUP.OBSTACLE`, which costs the player a life on contact. Only the
 * edges parallel to the long axis are safe, and they are also the ones worth
 * having: they mark the sides the runner can actually fall off.
 *
 * A near-square platform is a corner junction, where the track uses all four
 * sides. Those get nothing.
 *
 * Exported because {@link buildParapet} and `ObstacleFactory.addParapetColliders`
 * must agree exactly - a visual rim with no collider is a wall you run through,
 * and a collider with no rim is an invisible wall.
 */
export type ParapetEdges = 'x' | 'z' | 'none';

/** Below this difference in proportion a platform counts as square. */
const PARAPET_SQUARE_RATIO = 0.2;

export function parapetEdgesFor(width: number, depth: number): ParapetEdges {
  const longest = Math.max(width, depth);
  if (longest <= 0) return 'none';
  if (Math.abs(width - depth) / longest < PARAPET_SQUARE_RATIO) return 'none';
  // Long axis X -> the rim runs along X, at the +/-Z edges.
  return width > depth ? 'x' : 'z';
}

/** Low parapet wall down the long sides of a rooftop slab. */
export function buildParapet(
  width: number,
  depth: number,
  options: { height?: number; color?: number } = {},
): THREE.Group {
  const height = options.height ?? 0.35;
  const color = options.color ?? PALETTE.creamDark;
  const thickness = 0.12;
  const group = new THREE.Group();
  const edges = parapetEdgesFor(width, depth);
  if (edges === 'none') return group;

  const mat = getMaterial(color);
  const capMat = getMaterial(PALETTE.cream);
  const capHeight = height * 0.18;

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(boxGeo(), mat);
    const cap = new THREE.Mesh(boxGeo(), capMat);

    if (edges === 'x') {
      wall.scale.set(width, height, thickness);
      wall.position.set(0, height / 2, side * (depth / 2 - thickness / 2));
      cap.scale.set(width + thickness * 0.4, capHeight, thickness * 1.2);
      cap.position.set(0, height + capHeight / 2, side * (depth / 2 - thickness / 2));
    } else {
      wall.scale.set(thickness, height, depth);
      wall.position.set(side * (width / 2 - thickness / 2), height / 2, 0);
      cap.scale.set(thickness * 1.2, capHeight, depth + thickness * 0.4);
      cap.position.set(side * (width / 2 - thickness / 2), height + capHeight / 2, 0);
    }

    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    group.add(cap);
  }

  return group;
}

/**
 * Flat slab topped with half-round terracotta tiling.
 *
 * Each instance is a **full-length ridge** spanning the roof's depth, not an
 * individual tile. Individual tiles do not survive contact with the numbers:
 * roof slabs here are up to 80 units deep, and at a believable tile pitch that
 * is tens of thousands of instances per roof. Ridges reduce that to one
 * instance per column - about sixty for a wide roof - and read better anyway,
 * because real roman tiling is perceived as continuous lines running down the
 * slope rather than as discrete tiles.
 *
 * (The previous implementation placed discrete tiles and clamped the instance
 * count, which filled row-by-row and therefore tiled a ~1-unit strip at one end
 * of the roof and left the other 79 units as bare slab.)
 *
 * THE HEIGHT ARGUMENT IS NOT OPTIONAL DRESSING. The slab has to fill the same
 * `height` as the platform's collider and be centred on the group origin the
 * same way, because the collider is `cuboid(w/2, h/2, d/2)` centred there and
 * its top is what the player stands on. This function used to draw a 0.1-thick
 * slab sitting *on* the origin, topping out at 0.1 with the ridges cresting at
 * 0.22 - while the walking surface was at 0.5. Everything on a tiled roof
 * therefore hovered 0.28 to 0.40 above it, which on a cat 1.0 tall is a third
 * of its own height. Levels 1 and 2 are built from `terracotta` and `slate` and
 * showed it; level 3 is `flat` and `metal`, which take the plain-box branch in
 * ObstacleFactory, and did not.
 */
export function buildTerracottaRoofSurface(
  width: number,
  depth: number,
  height: number,
  tileColor: number = PALETTE.terracotta,
  baseColor: number = PALETTE.terracottaDark,
): THREE.Group {
  const group = new THREE.Group();

  // How far a ridge crests above the slab beneath it. This also sets how far
  // the surface dips *between* ridges, which is the gap anything standing here
  // appears to hover over - so it stays small.
  const rise = 0.06;
  // A hair of clearance so the tiles never poke through the collider the cat's
  // feet rest on.
  const surfaceY = height / 2 - 0.01;
  const slabTop = surfaceY - rise;

  const slab = new THREE.Mesh(boxGeo(), getMaterial(baseColor));
  slab.scale.set(width, slabTop + height / 2, depth);
  slab.position.y = (slabTop - height / 2) / 2;
  slab.receiveShadow = true;
  group.add(slab);

  // Ridges run along the roof's LONG axis, spaced across its short one.
  //
  // They used to be fixed to "spaced along X, running along Z", which is right
  // for a 14x80 leg and wrong for the 64x14 legs the levels turn onto: there
  // the runner crossed a ridge every 0.5 units - 22 a second at runSpeed - and
  // the surface strobed. Deriving the axis from the proportions means the
  // corrugation always runs *with* the direction of travel, and the ridge count
  // always comes off the short side, so a 64x14 roof gets 28 long ridges rather
  // than 128 short ones.
  const alongX = width > depth;
  const across = alongX ? depth : width;
  const along = alongX ? width : depth;

  // Pitch widens on very large roofs so the count stays bounded while still
  // covering the full surface - the ridges get bigger, never fewer than needed.
  const maxRidges = 150;
  const pitch = Math.max(0.5, across / maxRidges);
  const count = Math.max(1, Math.floor(across / pitch));
  const radius = pitch * 0.5;

  // The half-round is squashed to hit `rise` rather than scaled uniformly: at
  // full round the ridges stood 0.375 proud on a cat 1.0 tall, so the ground
  // under it read as corrugated iron and competed with the obstacles for
  // attention.
  const flatten = rise / radius;

  const tileGeo = cachedGeometry('roofTileHalfCyl', () => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true, 0, Math.PI));
  const instanced = new THREE.InstancedMesh(tileGeo, getMaterial(tileColor), count);
  instanced.castShadow = true;
  instanced.receiveShadow = true;

  // Centre the run of ridges so the leftover fraction is split between edges.
  // They sit ON the slab top, so their crests land on `surfaceY` - which is the
  // walking surface less a hair, so the cat's feet meet the tiles.
  const span = count * pitch;
  for (let c = 0; c < count; c++) {
    _dummy.position.set(-span / 2 + pitch * (c + 0.5), slabTop, 0);
    // Convex side up, running the full length of the roof, so each ridge
    // catches the sun the way a course of half-round roman tiles does.
    _dummy.rotation.set(Math.PI / 2, 0, 0);
    _dummy.scale.set(radius, along, radius * flatten);
    _dummy.updateMatrix();
    instanced.setMatrixAt(c, _dummy.matrix);
  }
  instanced.instanceMatrix.needsUpdate = true;

  // Always built in one canonical orientation - spaced along X, running along
  // Z - and then turned as a whole if the roof is wider than it is deep.
  // Composing the swing into each instance's Euler instead does not do what it
  // reads as: three.js applies XYZ in a fixed order, so the second rotation
  // lands in the already-rotated frame and the ridges come out 0.24 wide and 78
  // long. One rotation on the container has no such ambiguity, and a Y rotation
  // cannot disturb the heights above.
  const field = new THREE.Group();
  field.add(instanced);
  if (alongX) field.rotation.y = Math.PI / 2;
  group.add(field);

  return group;
}
