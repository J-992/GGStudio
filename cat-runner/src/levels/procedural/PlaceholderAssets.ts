import * as THREE from 'three';
import { PALETTE } from '../../assets/ProceduralProps';

/**
 * Deliberately crude, primitive-only geometry for the procedural track.
 *
 * The brief for this prototype is explicit: no existing obstacle assets, just
 * boxes/cylinders/planes standing in for art that hasn't been made yet. So
 * this file, unlike `ProceduralProps.ts`, does not build anything sculpted -
 * it hands out a handful of unit-sized shapes, shared and scaled per
 * instance via `mesh.scale`, and never disposed per-instance (the chunk
 * builder owns exactly one of each and frees them once, on teardown).
 */

export const PLACEHOLDER_COLOR = {
  // The deck IS the rooftop the player runs on - a warm coastal-roof tone,
  // not the old neutral grey.
  deck: PALETTE.roofSand,
  gapFiller: PALETTE.roofSand,
  // Hazard colours deliberately stay saturated/high-contrast rather than
  // drawing from the pastel coastal palette - "ensure obstacles remain
  // highly visible" reads as *not* blending into the building colours a
  // hazard might be sitting in front of. `beam` in particular used to be a
  // yellow-gold close enough to the new coastalYellow building colour
  // (#FFD54F) to risk camouflage; pulled toward orange-red instead.
  //
  // `beam` no longer clothes the slide hazard itself - that is a textured
  // clothesline now (`ClotheslineHazard.ts`), which carries this same
  // orange as the first of its fabric tones - but the colour stays here
  // because `RoofFeatures`' parapets still draw from it.
  obstacle: 0xd94f3a,
  beam: 0xff6b35,
  turnMarker: 0xff8c1a,
} as const;

/** One colour per power-up type - used for the sculpted models' glow and the
 *  HUD's floating icon (`Game.ts`'s `powerUpGlow`). */
export const POWERUP_COLOR = {
  fishMagnet: 0x35c9e8,
  catnipRush: 0x63e06a,
  nineLives: 0xff5f8f,
  shield: 0x6f8fff,
} as const;

function standard(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
}

/** Power-up pickups get a little emissive glow of their own colour - cheap
 *  (no light, just the material self-lighting) and it's the one thing that
 *  reads "pick this up" at a run's speed and distance. Exported so
 *  `PowerUpModels.ts`'s sculpted shield/heart/sneaker models can share the
 *  same glow treatment instead of duplicating it.
 *
 *  `userData.glowBase` records the resting intensity so `pulsePowerUpGlow()`
 *  (`PowerUpModels.ts`) has something to oscillate around without a second,
 *  separately-maintained "what was this before I started pulsing it" value. */
export function glowing(color: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.6,
    roughness: 0.4,
    metalness: 0.1,
  });
  material.userData.glowBase = material.emissiveIntensity;
  return material;
}

/** One unit cube, centred on the origin. Scale per instance for decks/obstacles. */
export const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

/** One unit cylinder (radius 0.5, height 1), for the slide beam. */
export const unitCylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);

/** One unit cone, for the turn-warning ground marker. */
export const unitConeGeometry = new THREE.ConeGeometry(0.5, 1, 4);

/** One unit octahedron - the HUD's floating power-up icon (`Game.ts`'s
 *  `powerUpGlow`), a "gem" silhouette that's the same eight triangles
 *  regardless of which type is active. Every world pickup now has its own
 *  sculpted model (`PowerUpModels.ts`) instead of this shape. */
export const unitOctahedronGeometry = new THREE.OctahedronGeometry(0.5, 0);

export const deckMaterial = standard(PLACEHOLDER_COLOR.deck);
export const obstacleMaterial = standard(PLACEHOLDER_COLOR.obstacle);
export const turnMarkerMaterial = standard(PLACEHOLDER_COLOR.turnMarker);

export const powerUpMaterials = {
  fishMagnet: glowing(POWERUP_COLOR.fishMagnet),
  catnipRush: glowing(POWERUP_COLOR.catnipRush),
  nineLives: glowing(POWERUP_COLOR.nineLives),
  shield: glowing(POWERUP_COLOR.shield),
} as const;

/** Every geometry/material this module owns, for one-time teardown. */
export function disposePlaceholderAssets(): void {
  unitBoxGeometry.dispose();
  unitCylinderGeometry.dispose();
  unitConeGeometry.dispose();
  unitOctahedronGeometry.dispose();
  deckMaterial.dispose();
  obstacleMaterial.dispose();
  turnMarkerMaterial.dispose();
  for (const material of Object.values(powerUpMaterials)) material.dispose();
}
