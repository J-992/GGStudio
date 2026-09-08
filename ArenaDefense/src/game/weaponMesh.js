// Procedural first-person weapon viewmodels, built from three.js primitives
// instead of an authored mesh.
//
// Why this exists: every one of the six weapons in `config.player.weapons`
// used to be `Gun_02` or `Gun_03` (see `Player.js#_buildViewmodel`, pre-this-
// module), told apart only by a tint and a uniform scale — so an AK-47 and a
// sniper rifle were, geometrically, the same object. `ASSET_LICENSES.md`
// separately records both of those meshes as UNKNOWN provenance (the whole
// `Shared/voxel/env/Buildings` FBX pack) and names its own accepted fallback
// as "procedural gun/turret-base geometry behind one config flag" — this
// module IS that fallback for the player's weapon, at zero download bytes
// against the project's asset budget. `Turrets.js` already ships the same
// idea for turret heads (see its `_buildHead`); this file follows the same
// technique (add children at local origin, push every allocation into the
// caller's ownership arrays, `MeshLambertMaterial`, bake axis fixes into
// geometry rather than mesh transforms) applied to six distinct silhouettes
// instead of one.
//
// Kept free of `src/core/` and the DOM on purpose, same as `Turrets.js`'s
// procedural-head code: this module only ever touches three.js objects
// handed to it, or arrays/values the caller passes in.
import * as THREE from 'three';

/** Bare-metal accent shared by every weapon's furniture-colour body. */
const STEEL = 0x2c2f33;
/** Darker steel for shrouds/collars, so a barrel doesn't read as one flat tube. */
const DARK_STEEL = 0x1a1c1f;
/** Lens/optic glow tint (frosty blue-white) used sparingly on the M82's scope. */
const LENS_GLOW = 0x8fe3ff;

/**
 * Shift a hex colour towards black (`factor` < 1) or white (`factor` > 1).
 * Ported from `zombie-motorworks/src/editor/parts/shared.ts#shade` — the
 * cheapest way to turn one `def.color` into a family of related tones (wood
 * furniture, gunmetal, a darker grip) without allocating extra config.
 * @param {number} hex
 * @param {number} factor
 * @returns {number}
 */
function shade(hex, factor) {
  const c = new THREE.Color(hex);
  if (factor >= 1) c.lerp(new THREE.Color(0xffffff), Math.min(factor - 1, 1));
  else c.multiplyScalar(factor);
  return c.getHex();
}

/**
 * A `MeshLambertMaterial` for `hex`, pushed into `ownedMaterials` so the
 * caller's disposal loop frees it. Callers should still share one material
 * across every part of one colour rather than calling this per-mesh.
 * @param {number} hex
 * @param {THREE.Material[]} ownedMaterials
 * @returns {THREE.MeshLambertMaterial}
 */
function lambert(hex, ownedMaterials) {
  const mat = new THREE.MeshLambertMaterial({ color: hex });
  ownedMaterials.push(mat);
  return mat;
}

/**
 * A self-lit `MeshLambertMaterial` (optic lenses, glow strips).
 * @param {number} hex
 * @param {number} intensity
 * @param {THREE.Material[]} ownedMaterials
 * @returns {THREE.MeshLambertMaterial}
 */
function glowLambert(hex, intensity, ownedMaterials) {
  const mat = new THREE.MeshLambertMaterial({ color: hex, emissive: hex, emissiveIntensity: intensity });
  ownedMaterials.push(mat);
  return mat;
}

/**
 * A box mesh plus a dark `EdgesGeometry` outline riding along with it, so a
 * flat-shaded primitive reads as machined hardware rather than a toy block.
 * Ported from `zombie-motorworks/src/editor/parts/shared.ts#boxWithEdges`
 * (the "highest-value trick" the brief calls out) — original code in this
 * monorepo, free to reuse. Returns a `Group` so the caller can position/
 * rotate box + outline together as one unit; both geometries are pushed into
 * `ownedGeometries` and the box's material into `ownedMaterials` (the edge
 * line material is intentionally NOT shared, so it is pushed too).
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {THREE.Material} material Shared box material (not allocated here).
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @param {THREE.Material[]} ownedMaterials
 * @returns {THREE.Group}
 */
function boxWithEdges(w, h, d, material, ownedGeometries, ownedMaterials) {
  const group = new THREE.Group();
  const boxGeom = new THREE.BoxGeometry(w, h, d);
  ownedGeometries.push(boxGeom);
  group.add(new THREE.Mesh(boxGeom, material));

  const edgeGeom = new THREE.EdgesGeometry(boxGeom);
  ownedGeometries.push(edgeGeom);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x0a0b0d, transparent: true, opacity: 0.55 });
  ownedMaterials.push(edgeMat);
  group.add(new THREE.LineSegments(edgeGeom, edgeMat));

  return group;
}

/**
 * A cylinder running along local -Z (muzzle direction), matching this
 * module's orientation convention: `CylinderGeometry` defaults to +Y, so the
 * axis fix is baked into the geometry with `rotateX(-Math.PI / 2)` (same
 * pattern as `Turrets.js#_buildHead`'s cannon barrel, but rotated the other
 * way since a viewmodel's forward is -Z rather than +Z). `z` is the mesh's
 * position along that axis — pass a negative value to push it toward the
 * muzzle.
 * @param {number} radiusFront Radius at the -Z (forward/muzzle) end.
 * @param {number} radiusBack Radius at the +Z (rearward/grip) end.
 * @param {number} length
 * @param {number} z Local Z position of the segment's centre.
 * @param {THREE.Material} material
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @param {number} [segments] Radial segments — kept low (8-12) for a phone viewmodel.
 * @returns {THREE.Mesh}
 */
function pipe(radiusFront, radiusBack, length, z, material, ownedGeometries, segments = 10) {
  // CylinderGeometry tapers from `radiusTop` (+Y) to `radiusBottom` (-Y)
  // before the rotate; rotating -90deg about X maps +Y -> -Z, so radiusTop
  // (front/narrow end, typically) lands at -Z as intended by `radiusFront`.
  const geom = new THREE.CylinderGeometry(radiusFront, radiusBack, length, segments);
  geom.rotateX(-Math.PI / 2);
  ownedGeometries.push(geom);
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.z = z;
  return mesh;
}

/**
 * A box mesh (no edge outline) for small greebles where the edge-line cost
 * isn't worth it (magazine, bipod legs, sight posts).
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {THREE.Material} material
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @returns {THREE.Mesh}
 */
function box(w, h, d, material, ownedGeometries) {
  const geom = new THREE.BoxGeometry(w, h, d);
  ownedGeometries.push(geom);
  return new THREE.Mesh(geom, material);
}

/**
 * Vented muzzle brake: a short collar plus four box baffle plates blown out
 * either side, ported from `zombie-motorworks`'s `muzzleBrake()`. Sits
 * around `z` (its centre), extending further toward -Z (the muzzle tip).
 * @param {number} radius
 * @param {number} z Local Z of the brake's centre (should be near the barrel's muzzle end, i.e. a large negative number).
 * @param {THREE.Material} material
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @returns {THREE.Group}
 */
function muzzleBrake(radius, z, material, ownedGeometries) {
  const brake = new THREE.Group();
  brake.add(pipe(radius, radius, radius * 1.6, z, material, ownedGeometries, 10));
  const baffleGeom = new THREE.BoxGeometry(radius * 1.8, radius * 1.7, radius * 0.5);
  ownedGeometries.push(baffleGeom);
  for (const side of [-1, 1]) {
    for (const offset of [-0.4, 0.4]) {
      const baffle = new THREE.Mesh(baffleGeom, material);
      baffle.position.set(side * radius * 0.95, 0, z + offset * radius);
      brake.add(baffle);
    }
  }
  return brake;
}

/**
 * A simple two-leg folding bipod braced forward-down from `z`.
 * @param {number} legLength
 * @param {number} z Local Z where the legs pivot from.
 * @param {number} y Local Y where the legs pivot from (barrel underside).
 * @param {THREE.Material} material
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @returns {THREE.Group}
 */
function bipod(legLength, z, y, material, ownedGeometries) {
  const group = new THREE.Group();
  const legGeom = new THREE.BoxGeometry(legLength * 0.09, legLength, legLength * 0.09);
  ownedGeometries.push(legGeom);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeom, material);
    leg.position.set(side * legLength * 0.22, y - legLength * 0.42, z);
    leg.rotation.set(0, 0, side * 0.3);
    group.add(leg);
  }
  return group;
}

/**
 * M9-style pistol: short slide over a grip, no stock. The smallest of the
 * six — everything scales off `def.scale`, but off a smaller base than the
 * long guns since a pistol reads small even before that multiplier.
 * @param {THREE.Group} group
 * @param {object} def
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @param {THREE.Material[]} ownedMaterials
 */
function buildPistol(group, def, ownedGeometries, ownedMaterials) {
  const s = def.scale ?? 1;
  const metal = lambert(shade(def.color, 0.75), ownedMaterials);
  const dark = lambert(DARK_STEEL, ownedMaterials);

  const frame = boxWithEdges(0.045 * s, 0.09 * s, 0.14 * s, metal, ownedGeometries, ownedMaterials);
  frame.position.set(0, -0.02 * s, 0.02 * s);
  group.add(frame);

  const slide = boxWithEdges(0.04 * s, 0.045 * s, 0.19 * s, dark, ownedGeometries, ownedMaterials);
  slide.position.set(0, 0.03 * s, -0.03 * s);
  group.add(slide);

  const barrel = pipe(0.012 * s, 0.014 * s, 0.06 * s, -0.16 * s, dark, ownedGeometries, 8);
  barrel.position.y = 0.03 * s;
  group.add(barrel);

  const grip = box(0.04 * s, 0.11 * s, 0.045 * s, metal, ownedGeometries);
  grip.position.set(0, -0.07 * s, 0.08 * s);
  grip.rotation.x = -0.15;
  group.add(grip);

  const trigger = box(0.012 * s, 0.02 * s, 0.012 * s, dark, ownedGeometries);
  trigger.position.set(0, -0.015 * s, 0.03 * s);
  group.add(trigger);

  const sight = box(0.012 * s, 0.012 * s, 0.02 * s, dark, ownedGeometries);
  sight.position.set(0, 0.056 * s, -0.1 * s);
  group.add(sight);
}

/**
 * AK-47: long receiver, curved banana magazine (a rotated box), a gas tube
 * riding above the barrel, warm wood-toned furniture via `shade(def.color)`.
 * @param {THREE.Group} group
 * @param {object} def
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @param {THREE.Material[]} ownedMaterials
 */
function buildAk47(group, def, ownedGeometries, ownedMaterials) {
  const s = def.scale ?? 1;
  const wood = lambert(shade(def.color, 0.9), ownedMaterials);
  const metal = lambert(STEEL, ownedMaterials);
  const dark = lambert(DARK_STEEL, ownedMaterials);

  const receiver = boxWithEdges(0.045 * s, 0.075 * s, 0.34 * s, metal, ownedGeometries, ownedMaterials);
  receiver.position.set(0, 0, 0.05 * s);
  group.add(receiver);

  const barrel = pipe(0.014 * s, 0.017 * s, 0.42 * s, -0.32 * s, dark, ownedGeometries, 8);
  barrel.position.y = 0.01 * s;
  group.add(barrel);

  // Gas tube: a shorter, wider pipe riding above the barrel — the AK's most
  // recognisable silhouette cue.
  const gasTube = pipe(0.018 * s, 0.018 * s, 0.24 * s, -0.22 * s, dark, ownedGeometries, 8);
  gasTube.position.y = 0.045 * s;
  group.add(gasTube);

  // Banana magazine: a rotated box is enough, per the brief.
  const mag = box(0.045 * s, 0.28 * s, 0.05 * s, dark, ownedGeometries);
  mag.position.set(0, -0.19 * s, -0.02 * s);
  mag.rotation.x = 0.35;
  group.add(mag);

  const stock = box(0.04 * s, 0.06 * s, 0.24 * s, wood, ownedGeometries);
  stock.position.set(0, -0.01 * s, 0.34 * s);
  group.add(stock);

  const handguard = box(0.05 * s, 0.05 * s, 0.16 * s, wood, ownedGeometries);
  handguard.position.set(0, -0.005 * s, -0.14 * s);
  group.add(handguard);

  const pistolGrip = box(0.035 * s, 0.09 * s, 0.045 * s, wood, ownedGeometries);
  pistolGrip.position.set(0, -0.075 * s, 0.14 * s);
  pistolGrip.rotation.x = -0.25;
  group.add(pistolGrip);

  const frontSight = box(0.01 * s, 0.03 * s, 0.01 * s, metal, ownedGeometries);
  frontSight.position.set(0, 0.03 * s, -0.51 * s);
  group.add(frontSight);
}

/**
 * M4A1: carry handle on top, collapsible tube stock, straight box magazine.
 * Leaner overall than the AK — narrower receiver, thinner barrel.
 * @param {THREE.Group} group
 * @param {object} def
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @param {THREE.Material[]} ownedMaterials
 */
function buildM4a1(group, def, ownedGeometries, ownedMaterials) {
  const s = def.scale ?? 1;
  const metal = lambert(shade(def.color, 0.9), ownedMaterials);
  const dark = lambert(DARK_STEEL, ownedMaterials);

  const receiver = boxWithEdges(0.038 * s, 0.06 * s, 0.32 * s, metal, ownedGeometries, ownedMaterials);
  receiver.position.set(0, 0, 0.02 * s);
  group.add(receiver);

  const barrel = pipe(0.011 * s, 0.013 * s, 0.36 * s, -0.32 * s, dark, ownedGeometries, 8);
  barrel.position.y = 0.005 * s;
  group.add(barrel);

  // Carry handle: a raised box bridge over the receiver.
  const handle = box(0.014 * s, 0.045 * s, 0.16 * s, dark, ownedGeometries);
  handle.position.set(0, 0.055 * s, -0.02 * s);
  group.add(handle);
  const handleBridgeFront = box(0.03 * s, 0.014 * s, 0.014 * s, dark, ownedGeometries);
  handleBridgeFront.position.set(0, 0.032 * s, -0.09 * s);
  group.add(handleBridgeFront);
  const handleBridgeBack = box(0.03 * s, 0.014 * s, 0.014 * s, dark, ownedGeometries);
  handleBridgeBack.position.set(0, 0.032 * s, 0.05 * s);
  group.add(handleBridgeBack);

  // Collapsible tube stock: a thin pipe with a small buttplate box.
  const stockTube = pipe(0.014 * s, 0.014 * s, 0.16 * s, 0.24 * s, dark, ownedGeometries, 8);
  group.add(stockTube);
  const buttplate = box(0.035 * s, 0.05 * s, 0.02 * s, dark, ownedGeometries);
  buttplate.position.set(0, -0.005 * s, 0.325 * s);
  group.add(buttplate);

  // Straight box magazine (not curved, unlike the AK).
  const mag = box(0.035 * s, 0.22 * s, 0.04 * s, dark, ownedGeometries);
  mag.position.set(0, -0.15 * s, 0.03 * s);
  group.add(mag);

  const handguard = box(0.045 * s, 0.04 * s, 0.16 * s, metal, ownedGeometries);
  handguard.position.set(0, -0.005 * s, -0.13 * s);
  group.add(handguard);

  const pistolGrip = box(0.03 * s, 0.08 * s, 0.04 * s, dark, ownedGeometries);
  pistolGrip.position.set(0, -0.065 * s, 0.1 * s);
  pistolGrip.rotation.x = -0.25;
  group.add(pistolGrip);
}

/**
 * SPAS-12: fat, short barrel with a second (magazine) tube slung below it,
 * folding stock. Reads stubby next to the rifles.
 * @param {THREE.Group} group
 * @param {object} def
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @param {THREE.Material[]} ownedMaterials
 */
function buildSpas12(group, def, ownedGeometries, ownedMaterials) {
  const s = def.scale ?? 1;
  const metal = lambert(shade(def.color, 0.85), ownedMaterials);
  const dark = lambert(DARK_STEEL, ownedMaterials);

  const receiver = boxWithEdges(0.06 * s, 0.075 * s, 0.2 * s, metal, ownedGeometries, ownedMaterials);
  receiver.position.set(0, 0, 0.08 * s);
  group.add(receiver);

  const barrel = pipe(0.02 * s, 0.022 * s, 0.24 * s, -0.14 * s, dark, ownedGeometries, 10);
  barrel.position.y = 0.02 * s;
  group.add(barrel);

  // Magazine tube below the barrel — the SPAS-12's tell.
  const magTube = pipe(0.016 * s, 0.016 * s, 0.22 * s, -0.13 * s, dark, ownedGeometries, 10);
  magTube.position.y = -0.03 * s;
  group.add(magTube);

  const foreend = box(0.05 * s, 0.05 * s, 0.14 * s, metal, ownedGeometries);
  foreend.position.set(0, -0.015 * s, -0.1 * s);
  group.add(foreend);

  // Folding wire stock: a thin frame instead of a solid buttstock.
  const stockRail = box(0.012 * s, 0.012 * s, 0.22 * s, dark, ownedGeometries);
  stockRail.position.set(0, 0.02 * s, 0.28 * s);
  group.add(stockRail);
  const stockPlate = box(0.05 * s, 0.09 * s, 0.014 * s, dark, ownedGeometries);
  stockPlate.position.set(0, 0.02 * s, 0.38 * s);
  group.add(stockPlate);

  const pistolGrip = box(0.035 * s, 0.09 * s, 0.045 * s, dark, ownedGeometries);
  pistolGrip.position.set(0, -0.075 * s, 0.16 * s);
  pistolGrip.rotation.x = -0.3;
  group.add(pistolGrip);

  const shellHolder = box(0.055 * s, 0.03 * s, 0.1 * s, metal, ownedGeometries);
  shellHolder.position.set(0, 0.045 * s, 0.14 * s);
  group.add(shellHolder);
}

/**
 * M82: the big one. Long fluted tube, a full scope (tube, objective bell,
 * lens, two ring mounts), a large muzzle brake, folding bipod. Should read
 * as a sniper at a glance.
 * @param {THREE.Group} group
 * @param {object} def
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @param {THREE.Material[]} ownedMaterials
 */
function buildM82(group, def, ownedGeometries, ownedMaterials) {
  const s = def.scale ?? 1;
  const metal = lambert(shade(def.color, 0.85), ownedMaterials);
  const dark = lambert(DARK_STEEL, ownedMaterials);
  const scopeMat = lambert(DARK_STEEL, ownedMaterials);
  const lens = glowLambert(LENS_GLOW, 0.5, ownedMaterials);

  const receiver = boxWithEdges(0.055 * s, 0.07 * s, 0.42 * s, metal, ownedGeometries, ownedMaterials);
  receiver.position.set(0, -0.01 * s, 0.08 * s);
  group.add(receiver);

  const barrel = pipe(0.016 * s, 0.022 * s, 0.62 * s, -0.42 * s, dark, ownedGeometries, 10);
  barrel.position.y = 0.005 * s;
  group.add(barrel);

  // Fluting rings down the tube.
  for (const z of [-0.2, -0.35, -0.5]) {
    const ring = pipe(0.026 * s, 0.026 * s, 0.018 * s, z * s, scopeMat, ownedGeometries, 10);
    ring.position.y = 0.005 * s;
    group.add(ring);
  }

  const brake = muzzleBrake(0.03 * s, -0.71 * s, dark, ownedGeometries);
  brake.position.y = 0.005 * s;
  group.add(brake);

  // Scope: tube, objective bell, lens, two ring mounts.
  const scopeTube = pipe(0.022 * s, 0.022 * s, 0.24 * s, -0.08 * s, scopeMat, ownedGeometries, 10);
  scopeTube.position.y = 0.075 * s;
  group.add(scopeTube);
  const objective = pipe(0.03 * s, 0.024 * s, 0.05 * s, -0.19 * s, scopeMat, ownedGeometries, 10);
  objective.position.y = 0.075 * s;
  group.add(objective);
  const lensMesh = pipe(0.026 * s, 0.026 * s, 0.006 * s, -0.215 * s, lens, ownedGeometries, 10);
  lensMesh.position.y = 0.075 * s;
  group.add(lensMesh);
  for (const z of [0.01, 0.16]) {
    const mount = box(0.03 * s, 0.045 * s, 0.02 * s, scopeMat, ownedGeometries);
    mount.position.set(0, 0.06 * s, z * s);
    group.add(mount);
  }

  // Folding bipod under the fore-barrel.
  group.add(bipod(0.16 * s, -0.38 * s, 0.005 * s, dark, ownedGeometries));

  const stock = box(0.04 * s, 0.07 * s, 0.2 * s, metal, ownedGeometries);
  stock.position.set(0, -0.01 * s, 0.4 * s);
  group.add(stock);

  const pistolGrip = box(0.035 * s, 0.09 * s, 0.045 * s, dark, ownedGeometries);
  pistolGrip.position.set(0, -0.075 * s, 0.24 * s);
  pistolGrip.rotation.x = -0.25;
  group.add(pistolGrip);
}

/**
 * RPG-7: slim tube, a wide flared cone forward of the grip (a `CylinderGeometry`
 * with a large front radius), plus a pistol grip. Unmistakable silhouette.
 * @param {THREE.Group} group
 * @param {object} def
 * @param {THREE.BufferGeometry[]} ownedGeometries
 * @param {THREE.Material[]} ownedMaterials
 */
function buildRpg7(group, def, ownedGeometries, ownedMaterials) {
  const s = def.scale ?? 1;
  const metal = lambert(shade(def.color, 0.85), ownedMaterials);
  const wood = lambert(shade(def.color, 0.9), ownedMaterials);
  const dark = lambert(DARK_STEEL, ownedMaterials);

  // Slim main tube.
  const tube = pipe(0.022 * s, 0.024 * s, 0.66 * s, -0.02 * s, metal, ownedGeometries, 10);
  group.add(tube);

  // Wide flared cone (the warhead) forward of the grip — the tell.
  const cone = pipe(0.09 * s, 0.026 * s, 0.26 * s, -0.46 * s, dark, ownedGeometries, 12);
  group.add(cone);

  // Rear venturi (the tube's blast-back end) flares slightly too.
  const venturi = pipe(0.024 * s, 0.032 * s, 0.1 * s, 0.36 * s, dark, ownedGeometries, 10);
  group.add(venturi);

  const sightPost = box(0.012 * s, 0.05 * s, 0.012 * s, dark, ownedGeometries);
  sightPost.position.set(0, 0.045 * s, -0.1 * s);
  group.add(sightPost);

  // Wooden-style handguard under the tube, ahead of the trigger group.
  const handguard = box(0.05 * s, 0.05 * s, 0.16 * s, wood, ownedGeometries);
  handguard.position.set(0, -0.05 * s, 0.02 * s);
  group.add(handguard);

  const triggerHousing = box(0.04 * s, 0.06 * s, 0.08 * s, dark, ownedGeometries);
  triggerHousing.position.set(0, -0.075 * s, 0.14 * s);
  group.add(triggerHousing);

  const pistolGrip = box(0.035 * s, 0.1 * s, 0.045 * s, dark, ownedGeometries);
  pistolGrip.position.set(0, -0.15 * s, 0.18 * s);
  pistolGrip.rotation.x = -0.2;
  group.add(pistolGrip);

  const shoulderRest = box(0.03 * s, 0.03 * s, 0.03 * s, metal, ownedGeometries);
  shoulderRest.position.set(0, 0.01 * s, 0.32 * s);
  group.add(shoulderRest);
}

/** @type {Record<string, (group: THREE.Group, def: object, ownedGeometries: THREE.BufferGeometry[], ownedMaterials: THREE.Material[]) => void>} */
const BUILDERS = {
  pistol: buildPistol,
  ak47: buildAk47,
  m4a1: buildM4a1,
  spas12: buildSpas12,
  m82: buildM82,
  rpg7: buildRpg7,
};

/**
 * Builds one weapon's first-person viewmodel entirely from three.js
 * primitives — no authored mesh, no `assets.js` import. The returned group's
 * origin is the grip (where the caller attaches it to the camera, roughly
 * `(0.32, -0.28, -0.55)`), and its muzzle points down local -Z, matching the
 * camera's own forward axis so the gun aims dead ahead with no extra
 * rotation at the attach site.
 *
 * Every `BufferGeometry`/`Material` this function (and the id-specific
 * builder it dispatches to) allocates is pushed into `ownedGeometries` /
 * `ownedMaterials` rather than disposed here — disposal is the caller's job,
 * done once per weapon swap (see `Player.js#_buildViewmodel`). Materials are
 * shared across a weapon's own parts wherever they'd otherwise be identical
 * (one steel material, one dark-steel material, etc.), so a 6-12 primitive
 * gun costs 2-4 materials, not one per box.
 *
 * @param {string} weaponId A key of `config.player.weapons.types` (`'pistol'`, `'ak47'`, `'m4a1'`, `'spas12'`, `'m82'`, `'rpg7'`).
 * @param {{color: number, scale?: number}} def That weapon's def — only `color` and `scale` are read; every other field (`dmg`, `rate`, ...) is gameplay tuning this module doesn't need.
 * @param {THREE.BufferGeometry[]} ownedGeometries Every geometry allocated here is pushed onto this array.
 * @param {THREE.Material[]} ownedMaterials Every material allocated here is pushed onto this array.
 * @returns {THREE.Group} Origin at the grip; muzzle points down local -Z.
 */
export function buildWeaponMesh(weaponId, def, ownedGeometries, ownedMaterials) {
  const build = BUILDERS[weaponId];
  if (!build) throw new Error(`weaponMesh.buildWeaponMesh: unknown weapon id "${weaponId}"`);
  const group = new THREE.Group();
  build(group, def, ownedGeometries, ownedMaterials);
  return group;
}
