import { Mesh, Object3D } from 'three';

/**
 * The streamed half of the wardrobe.
 *
 * Most cosmetics are built out of boxes and cones in Cosmetics.ts; a handful are
 * real models, normalised by tools/build-accessories.mjs and streamed in behind
 * the first frame the way the weapons are. This module is the seam between the
 * two: the catalogue asks for a piece by id and either gets a clone of a landed
 * model or nothing at all, and "nothing at all" is a supported answer — a player
 * who opens the character screen two seconds after boot sees the rest of their
 * loadout, not a broken one.
 *
 * Clones share their prototype's geometry AND materials, which is why the
 * wardrobe never disposes a model-backed piece: dropping a hat would take the
 * texture out from under every other copy of it.
 */

const prototypes = new Map<string, Object3D>();

export function registerCosmeticModel(id: string, object: Object3D): void {
  object.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = false;
  });
  prototypes.set(id, object);
}

/** A fresh instance, or null while the model is still in flight. */
export function cosmeticModel(id: string): Object3D | null {
  const template = prototypes.get(id);
  return template ? template.clone(true) : null;
}

export function cosmeticModelReady(id: string): boolean {
  return prototypes.has(id);
}

/** Test seam: drops every loaded prototype. */
export function clearCosmeticModels(): void {
  prototypes.clear();
}
