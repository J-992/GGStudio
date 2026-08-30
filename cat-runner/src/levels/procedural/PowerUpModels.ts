import * as THREE from 'three';
import { glowing, POWERUP_COLOR } from './PlaceholderAssets';

/**
 * Sculpted low-poly models for the power-up pickups the player asked to no
 * longer read as "a colored gem" - Shield, Nine Lives, Fish Magnet, Catnip
 * Rush.
 *
 * Shield/Nine Lives/Fish Magnet each prefer a real provided model, loaded by
 * `AssetRegistry.loadItemModels()` and installed here via `setShieldModel()`
 * etc. once `Game.loadAssets()` resolves (see that call site). The `build*`
 * functions below clone that prototype when it's present and fall back to
 * these hand-built primitives otherwise - the same non-fatal-load-failure
 * contract every external asset in this game already has.
 *
 * Catnip Rush is split across three functions on purpose:
 * `buildSneakerModel()` stays purely procedural (it's shared with the prop
 * equipped on the cat's own feet - see `Cat.attachSneakers()` - which was
 * never asked to change size or look); `buildCatnipPickupModel()` prefers the
 * provided "Jordan" model and is what the cat's own equipped shoes go
 * through; and `buildEnergyDrinkModel()` is what the *world pickup* uses,
 * preferring the provided `energydrink.glb` via `setEnergyDrinkModel()`.
 *
 * That third function exists precisely so the swap could happen: the world
 * pickup and the cat's shoes used to share `buildCatnipPickupModel()`
 * outright, so pointing that one prototype at the new model would silently
 * have re-shod the cat too. `buildCatnipPickupModel()` and everything it
 * touches is deliberately left exactly as it was.
 *
 * Each factory builds fresh geometries/materials per call, the same
 * per-call-allocation pattern `Cat.ts`'s `buildFish()` uses rather than
 * `PlaceholderAssets.ts`'s shared-cache pattern - acceptable here since
 * these are only built once per streamer slot (`PowerUps.ts`) and once per
 * `Cat` instance (the equipped sneaker/magnet props), never per-frame.
 */

let shieldPrototype: THREE.Object3D | null = null;
let heartPrototype: THREE.Object3D | null = null;
let magnetPrototype: THREE.Object3D | null = null;
let catnipPickupPrototype: THREE.Object3D | null = null;
let energyDrinkPrototype: THREE.Object3D | null = null;

/** Called once, after the item models load - see `Game.loadAssets()`. */
export function setShieldModel(model: THREE.Object3D): void {
  shieldPrototype = model;
}
export function setHeartModel(model: THREE.Object3D): void {
  heartPrototype = model;
}
export function setMagnetModel(model: THREE.Object3D): void {
  magnetPrototype = model;
}
export function setCatnipPickupModel(model: THREE.Object3D): void {
  catnipPickupPrototype = model;
}
/** The Catnip Rush *world pickup* only - never the cat's equipped shoes.
 *  See {@link buildEnergyDrinkModel}. */
export function setEnergyDrinkModel(model: THREE.Object3D): void {
  energyDrinkPrototype = model;
}

/**
 * Frees geometry/materials under a built pickup/prop, EXCEPT anything marked
 * `userData.shared` - `AssetRegistry.loadItemModel()` marks its cached
 * prototype's geometry/material this way because every `build*Model()` clone
 * above shares those by reference (three's default, cheap clone). Disposing
 * a pool's own clone unconditionally would free the resource every other
 * clone - and the cached prototype itself - still needs. The old procedural
 * fallback geometries are never marked, so they're still freed as normal.
 */
export function disposeIfOwned(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry?.userData?.shared) mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material && !material.userData?.shared) material.dispose();
    }
  });
}

/**
 * Applies a shared pulse factor to every glowing material under a power-up's
 * visible model - the "subtle pulsing" half of the pickup-visibility fix,
 * the emissive-glow half being `glowing()`'s own `userData.glowBase` (and
 * the matching stamp `AssetRegistry.loadItemModel` puts on a provided
 * shield/heart/magnet model).
 *
 * Deliberately driven by one shared phase in the caller (`ChunkBuilder.
 * updatePowerUps`) rather than a per-pickup phase or a per-material timer:
 * every visible pickup pulses in lockstep, which costs exactly one sine per
 * frame no matter how many pickups are in view, and reads as "these glow"
 * rather than a distracting flicker. `glowBase` is only ever read, never
 * written, so this is safe to call every frame without the pulse drifting.
 */
export function pulsePowerUpGlow(root: THREE.Object3D, factor: number): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const base = material?.userData?.glowBase;
      if (typeof base !== 'number') continue;
      (material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial).emissiveIntensity =
        base * factor;
    }
  });
}

/** The provided shield model if loaded, else a small flattened pentagonal
 *  disc reading as a heraldic shield. */
export function buildShieldModel(): THREE.Group {
  if (shieldPrototype) return shieldPrototype.clone(true) as THREE.Group;

  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.1, 5),
    glowing(POWERUP_COLOR.shield),
  );
  body.rotation.x = Math.PI / 2;
  body.rotation.z = Math.PI / 5; // point one vertex "down" like a shield's tip
  group.add(body);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.03, 6, 5),
    glowing(POWERUP_COLOR.shield),
  );
  rim.rotation.z = Math.PI / 5;
  group.add(rim);

  group.traverse((c) => (c.castShadow = true));
  return group;
}

/** The provided heart model if loaded, else two spheres and a wedge, reading
 *  as a simple heart silhouette. */
export function buildHeartModel(): THREE.Group {
  if (heartPrototype) return heartPrototype.clone(true) as THREE.Group;

  const group = new THREE.Group();
  const mat = glowing(POWERUP_COLOR.nineLives);

  const lobeGeo = new THREE.SphereGeometry(0.22, 10, 8);
  for (const side of [-1, 1]) {
    const lobe = new THREE.Mesh(lobeGeo, mat);
    lobe.position.set(side * 0.16, 0.1, 0);
    lobe.scale.set(1, 1.1, 0.85);
    group.add(lobe);
  }

  const point = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.4, 4), mat);
  point.rotation.x = Math.PI;
  point.rotation.y = Math.PI / 4;
  point.position.set(0, -0.14, 0);
  group.add(point);

  group.traverse((c) => (c.castShadow = true));
  return group;
}

/** The provided magnet model if loaded, else a small low-poly horseshoe
 *  magnet: a curved body with a lighter "pole" cap at each open end. Shared
 *  by the Fish Magnet pickup (`PowerUps.ts`) and the prop that floats above
 *  the cat's head while it's active (`Cat.ts`). */
export function buildMagnetModel(): THREE.Group {
  if (magnetPrototype) return magnetPrototype.clone(true) as THREE.Group;

  const group = new THREE.Group();
  const bodyMat = glowing(POWERUP_COLOR.fishMagnet);
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0xe8e8f0,
    roughness: 0.4,
    emissive: POWERUP_COLOR.fishMagnet,
    emissiveIntensity: 0.2,
  });
  poleMat.userData.glowBase = poleMat.emissiveIntensity;

  // Half a torus, opening upward - a horseshoe read from any angle.
  const body = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.09, 8, 12, Math.PI), bodyMat);
  body.rotation.z = Math.PI;
  group.add(body);

  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 8), poleMat);
    pole.position.set(side * 0.22, 0.18, 0);
    group.add(pole);
  }

  group.traverse((c) => (c.castShadow = true));
  return group;
}

/** A little low-poly sneaker: sole + upper + toe accent. Shared by the
 *  Catnip Rush pickup (`PowerUps.ts`) and the prop equipped on the cat's
 *  feet while Catnip Rush is active (`Cat.ts`). */
export function buildSneakerModel(): THREE.Group {
  const group = new THREE.Group();
  const soleMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9 });
  const upperMat = glowing(POWERUP_COLOR.catnipRush);
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    emissive: POWERUP_COLOR.catnipRush,
    emissiveIntensity: 0.25,
  });
  accentMat.userData.glowBase = accentMat.emissiveIntensity;

  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.42), soleMat);
  sole.position.set(0, -0.06, 0);
  group.add(sole);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.3), upperMat);
  upper.position.set(0, 0.03, -0.02);
  upper.scale.set(1, 1, 0.9);
  group.add(upper);

  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.14), accentMat);
  toe.position.set(0, -0.01, 0.18);
  group.add(toe);

  group.traverse((c) => (c.castShadow = true));
  return group;
}

/**
 * The provided "Jordan" model if loaded, else the procedural sneaker above.
 * Used both for the Catnip Rush world pickup (`PowerUps.ts`) and the prop
 * equipped on the cat's own feet (`Cat.attachSneakers()`).
 *
 * `userData.isProvidedModel` marks which one came back: the two builders
 * use different authoring conventions (the provided OBJ's own local axes
 * don't match the procedural sneaker's - see `Cat.attachSneakers()`'s own
 * doc comment for the derivation), so a caller that needs to orient the
 * result correctly has to know which shape it actually got, not just
 * assume the provided model loaded.
 */
export function buildCatnipPickupModel(): THREE.Group {
  if (catnipPickupPrototype) {
    const clone = catnipPickupPrototype.clone(true) as THREE.Group;
    clone.userData.isProvidedModel = true;
    return clone;
  }
  return buildSneakerModel();
}

/**
 * The Catnip Rush **world pickup**: the provided energy-drink GLB if loaded
 * (see `AssetRegistry.loadEnergyDrinkModel()`), else the procedural sneaker.
 *
 * The fallback is the sneaker rather than something can-shaped for the same
 * reason `buildCatnipPickupModel()` falls back to it: there is no sensible
 * procedural primitive for a drinks can, and an invisible pickup is far
 * worse than a differently-shaped one - a failed fetch must never leave a
 * collectable the player cannot see. It also keeps the glow/pulse working
 * either way, since `buildSneakerModel()` stamps `glowBase` itself.
 *
 * Deliberately separate from `buildCatnipPickupModel()`, which
 * `Cat.attachSneakers()` still calls unchanged - the cat's own equipped
 * shoes are provably untouched by this.
 */
export function buildEnergyDrinkModel(): THREE.Group {
  if (energyDrinkPrototype) {
    const clone = energyDrinkPrototype.clone(true) as THREE.Group;
    clone.userData.isProvidedModel = true;
    return clone;
  }
  return buildSneakerModel();
}
