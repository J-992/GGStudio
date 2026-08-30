import * as THREE from 'three';
import { PALETTE } from '../../assets/ProceduralProps';
import { VENT_PIPE_LENGTH, VENT_PIPE_HEIGHT } from './ChunkTypes';

/**
 * The vent pipe's visual: a dedicated, hand-built low-poly model, not a
 * sourced/imported asset. A real Rapier collider drives the actual
 * collision (see `ObstaclePool.buildVentPipe()`), so this mirrors a crate's
 * own mesh-rides-along-the-body pattern rather than the clothesline's
 * manual-overlap one.
 *
 * Deliberately not `pipevent.glb` (the KayKit model an earlier pass here
 * wired in as an optional upgrade) - a rework asked for a purpose-built
 * shape instead, in this game's own metal palette
 * (`PALETTE.metal`/`metalDark`, the same tones every rooftop vent/duct prop
 * in `ProceduralProps.ts` already uses) with simple mounting brackets
 * reading as "installed on the roof" rather than floating over it.
 */

let pipeMaterial: THREE.MeshStandardMaterial | null = null;
let capMaterial: THREE.MeshStandardMaterial | null = null;
let bracketMaterial: THREE.MeshStandardMaterial | null = null;

// A unit-radius, unit-length cylinder, scaled per-instance to the real pipe
// size - the same shared-geometry convention every pooled hazard here uses.
const pipeGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const capGeometry = new THREE.CylinderGeometry(0.54, 0.54, 1, 12);
const bracketGeometry = new THREE.BoxGeometry(1, 1, 1);

function ensureMaterials(): void {
  if (pipeMaterial) return;
  pipeMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.metal,
    roughness: 0.55,
    metalness: 0.4,
  });
  capMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.metalDark,
    roughness: 0.6,
    metalness: 0.35,
  });
  bracketMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.metalDark,
    roughness: 0.7,
    metalness: 0.3,
  });
}

/**
 * Short vertical struts from the deck up to the underside of the pipe, one
 * near each end - purely visual (the existing box collider in
 * `ObstaclePool.buildVentPipe()` already matches the pipe's own silhouette
 * and needs no changes), sized to stay within the pipe's own X-span so they
 * never read as a wider hitbox than what's actually there.
 *
 * The group's own origin is the collider's centre (`VENT_PIPE_HEIGHT / 2`
 * above the deck - see `ObstaclePool.buildVentPipe()`'s placement), so
 * "deck level" in this group's *local* space is `-VENT_PIPE_HEIGHT / 2`.
 */
function addMountingBrackets(group: THREE.Group): void {
  const bracketWidth = VENT_PIPE_HEIGHT * 0.22;
  const bracketHeight = VENT_PIPE_HEIGHT / 2 + 0.05; // a hair into the deck, no visible gap
  const bracketX = VENT_PIPE_LENGTH / 2 - VENT_PIPE_HEIGHT * 0.6;

  for (const side of [-1, 1] as const) {
    const bracket = new THREE.Mesh(bracketGeometry, bracketMaterial!);
    bracket.scale.set(bracketWidth, bracketHeight, bracketWidth);
    bracket.position.set(side * bracketX, -VENT_PIPE_HEIGHT / 4, 0);
    bracket.castShadow = true;
    group.add(bracket);
  }
}

/** One pooled vent pipe visual, origin at the hazard's own centre - the same
 *  point `ObstaclePool.buildVentPipe()`'s collider is centred on. */
export function buildVentPipeVisual(): THREE.Object3D {
  ensureMaterials();
  const group = new THREE.Group();

  const pipe = new THREE.Mesh(pipeGeometry, pipeMaterial!);
  pipe.rotation.z = Math.PI / 2;
  pipe.scale.set(VENT_PIPE_HEIGHT, VENT_PIPE_LENGTH, VENT_PIPE_HEIGHT);
  pipe.castShadow = true;
  group.add(pipe);

  // End caps read as flanged pipe fittings and give the eye a clear edge to
  // judge the hazard's width by, rather than a cylinder that fades off into
  // the same colour at both ends.
  for (const side of [-1, 1] as const) {
    const cap = new THREE.Mesh(capGeometry, capMaterial!);
    cap.rotation.z = Math.PI / 2;
    cap.scale.set(VENT_PIPE_HEIGHT * 0.18, VENT_PIPE_HEIGHT, VENT_PIPE_HEIGHT);
    cap.position.x = side * (VENT_PIPE_LENGTH / 2 - VENT_PIPE_HEIGHT * 0.09);
    group.add(cap);
  }

  addMountingBrackets(group);

  return group;
}

/** Frees the shared geometry/materials. Paired with the other module-owned
 *  hazard caches - one-time, whole-module teardown. */
export function disposeVentPipeAssets(): void {
  pipeGeometry.dispose();
  capGeometry.dispose();
  bracketGeometry.dispose();
  pipeMaterial?.dispose();
  capMaterial?.dispose();
  bracketMaterial?.dispose();
  pipeMaterial = null;
  capMaterial = null;
  bracketMaterial = null;
}
