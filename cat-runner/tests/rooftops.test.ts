import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  ROOF_HUT_VARIANTS,
  buildRoofHut,
  buildTerracottaRoofSurface,
} from '../src/assets/ProceduralProps';

/**
 * Rooftop geometry that the runner has to live with.
 *
 * The walking surface itself is a plain cuboid collider and has always been
 * flat. What was wrong was the decoration sitting on top of it: the tile
 * ridges always ran along Z, so on a +X leg the runner crossed one every 0.5
 * units - 22 a second at `runSpeed`. Not catchable by an audit that only
 * looks at footprints, since tile ridges are not a footprint.
 */

/**
 * Slab thickness every roof is authored at.
 *
 * The platform collider is `cuboid(w/2, h/2, d/2)` centred on the platform's
 * position, so the walking surface - what the player and every obstacle stand
 * on - is exactly `h / 2` above the group origin.
 */
const SLAB_HEIGHT = 1;
const WALKING_SURFACE = SLAB_HEIGHT / 2;

describe('roof tiling', () => {
  /** World-space bounds of the instanced ridge field. */
  function ridges(width: number, depth: number) {
    const group = buildTerracottaRoofSurface(width, depth, SLAB_HEIGHT);
    group.updateMatrixWorld(true);

    const mesh = group.getObjectByProperty(
      'isInstancedMesh',
      true as never,
    ) as unknown as THREE.InstancedMesh;

    const box = new THREE.Box3();
    const instance = new THREE.Matrix4();
    const full = new THREE.Matrix4();
    const position = mesh.geometry.attributes.position;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, instance);
      // Composed with the field's own matrix, which carries the 90-degree
      // swing. Reading the instance matrices alone measures the unrotated form
      // and reports a 64x14 roof as 14 wide.
      full.multiplyMatrices(mesh.matrixWorld, instance);
      for (let p = 0; p < position.count; p++) {
        vertex.fromBufferAttribute(position, p).applyMatrix4(full);
        box.expandByPoint(vertex);
      }
    }

    return { box, size: box.getSize(new THREE.Vector3()), count: mesh.count };
  }

  /** Everything the tiled builder draws, slab included. */
  function wholeSurface(width: number, depth: number) {
    const group = buildTerracottaRoofSurface(width, depth, SLAB_HEIGHT);
    group.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(group);
  }

  it('draws its surface right up to the walking surface', () => {
    // THE regression. The collider's top is the ground the player and every
    // obstacle rest on, and the mesh has to reach it. It used to top out at
    // 0.22 against a walking surface of 0.5, so everything on a tiled roof
    // hovered 0.28-0.40 - a third of the cat's own height. Levels 1 and 2 are
    // built from terracotta and slate and showed it; level 3 is flat and metal,
    // which takes the plain-box branch, and did not.
    for (const [w, d] of [
      [14, 80],
      [64, 14],
      [28, 28],
    ] as const) {
      const top = wholeSurface(w, d).max.y;
      expect(top, `${w}x${d} roof surface tops out at ${top.toFixed(3)}`).toBeCloseTo(
        WALKING_SURFACE,
        1,
      );
      // ...and never through it, or the cat's feet are inside the roof.
      expect(top).toBeLessThanOrEqual(WALKING_SURFACE);
    }
  });

  it('fills the same slab the plain branch does', () => {
    // The tiled and plain styles have to agree on where the roof is, or which
    // texture a level happens to use changes how high things sit on it.
    const box = wholeSurface(14, 80);
    expect(box.min.y).toBeCloseTo(-WALKING_SURFACE, 3);
  });

  it('dips only slightly between ridges', () => {
    // The gap between crests is what anything standing here appears to hover
    // over, so it is the number that matters, not the crest height.
    const slabTop = wholeSurface(14, 80).max.y - ridgeRise(14, 80);
    expect(WALKING_SURFACE - slabTop).toBeLessThan(0.1);
  });

  /** How far the ridges crest above the slab beneath them. */
  function ridgeRise(width: number, depth: number): number {
    const field = ridges(width, depth).box;
    return (field.max.y - field.min.y) / 2;
  }

  /** Extent of a SINGLE ridge, which is what carries the direction. */
  function oneRidge(width: number, depth: number) {
    const group = buildTerracottaRoofSurface(width, depth, SLAB_HEIGHT);
    group.updateMatrixWorld(true);

    const mesh = group.getObjectByProperty(
      'isInstancedMesh',
      true as never,
    ) as unknown as THREE.InstancedMesh;

    const box = new THREE.Box3();
    const instance = new THREE.Matrix4();
    const full = new THREE.Matrix4();
    const position = mesh.geometry.attributes.position;
    const vertex = new THREE.Vector3();

    mesh.getMatrixAt(0, instance);
    full.multiplyMatrices(mesh.matrixWorld, instance);
    for (let p = 0; p < position.count; p++) {
      vertex.fromBufferAttribute(position, p).applyMatrix4(full);
      box.expandByPoint(vertex);
    }

    return box.getSize(new THREE.Vector3());
  }

  it('runs the ridges along the roof, not across it', () => {
    // The one that matters for readability. On a 64x14 leg the corrugation has
    // to run with the direction of travel.
    //
    // Measured on a single ridge, not on the whole field: a field of short
    // ridges spaced across a 64-unit axis has a 64-unit bounding box too, so
    // the aggregate extent cannot tell the two orientations apart. It passed
    // against deliberately broken code until this was narrowed.
    const wide = oneRidge(64, 14);
    expect(wide.x, 'ridges run across the 64-unit run').toBeGreaterThan(wide.z);

    const deep = oneRidge(14, 80);
    expect(deep.z, 'ridges run across the 80-unit run').toBeGreaterThan(deep.x);
  });

  it('counts ridges off the short axis either way', () => {
    // Falls out of the above, and is the cheap version of it: a 64x14 roof that
    // reverted to fixed-axis tiling would report 128 ridges rather than 28.
    expect(ridges(64, 14).count).toBe(ridges(14, 64).count);
  });
});

/**
 * Rooftop service structures - stairwell heads, sheds, access huts, HVAC.
 *
 * These are obstacles before they are scenery, and the property that makes them
 * fair is that the box the player reads is the box they hit. `buildBlock` gives
 * every one of them the same collider - `cuboid(size/2)` lifted to sit on the
 * roof - so anything the builder draws outside that box below its top is
 * geometry the cat passes through, and anything it draws short of it is a
 * hitbox the player cannot see.
 *
 * The roof cap and the vent hoods are the deliberate exception: they sit
 * entirely *above* the collider, where the only way to reach them is to already
 * be inside the hut.
 */
describe('rooftop huts', () => {
  const SIZE = new THREE.Vector3(1.8, 1.9, 1.6);

  /**
   * How far a mesh is allowed outside the collider footprint.
   *
   * Non-zero because the trim is authored proud of the wall rather than
   * recessed - a door 0.03 in front of the face is four fewer triangles than a
   * cavity and reads identically at speed. Small enough that no part of it is
   * a silhouette the player could try to run past.
   */
  const TRIM_TOLERANCE = 0.16;

  it.each(ROOF_HUT_VARIANTS)('%s stands on its own base, like every block', (variant) => {
    // `buildBlock` lifts the collider by half the height from the object's
    // origin, which is only correct if the model's feet are at zero.
    const hut = buildRoofHut({ variant, size: SIZE });
    hut.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(hut).min.y).toBeCloseTo(0, 2);
  });

  it.each(ROOF_HUT_VARIANTS)('%s keeps its silhouette inside its collider', (variant) => {
    const hut = buildRoofHut({ variant, size: SIZE });
    hut.updateMatrixWorld(true);

    const offenders: string[] = [];
    const box = new THREE.Box3();

    for (const child of hut.children) {
      box.setFromObject(child);
      // Anything wholly above the collider's top face is out of reach.
      if (box.min.y >= SIZE.y - 1e-3) continue;

      const overX = Math.max(box.max.x, -box.min.x) - SIZE.x / 2;
      const overZ = Math.max(box.max.z, -box.min.z) - SIZE.z / 2;
      if (overX > TRIM_TOLERANCE || overZ > TRIM_TOLERANCE) {
        offenders.push(
          `a part reaches ${overX.toFixed(2)} past the side and ` +
            `${overZ.toFixed(2)} past the face`,
        );
      }
    }

    expect(offenders, `${variant}:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it.each(ROOF_HUT_VARIANTS)('%s fills the collider it is given', (variant) => {
    // The other half. A hut drawn smaller than its box is an invisible wall
    // beside a visible obstacle, which is worse than either.
    const hut = buildRoofHut({ variant, size: SIZE });
    hut.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(hut);
    expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(SIZE.x - 1e-3);
    expect(box.max.z - box.min.z).toBeGreaterThanOrEqual(SIZE.z - 1e-3);
    // Reaches the top face; the cap then sits above it.
    expect(box.max.y).toBeGreaterThanOrEqual(SIZE.y);

    // ...and it is *one* solid mass over that height, not a base trim and a
    // body with daylight between them. The overall bounding box cannot tell
    // those apart - the skirt pins the bottom and the cap pins the top however
    // far the walls have drifted - so this looks for a single piece spanning
    // the whole collider.
    const part = new THREE.Box3();
    const solid = hut.children.some((child) => {
      part.setFromObject(child);
      return part.min.y <= 0.02 && part.max.y >= SIZE.y - 0.02;
    });
    expect(solid, 'no single piece spans the hut from the roof to its top').toBe(true);
  });

  it('draws all four variants from the shared caches', () => {
    // The whole justification for authoring these rather than downloading them.
    // A variant that built its own geometry or material would add a draw call
    // per hut and dodge `freezeStatic`, which merges by material.
    for (const variant of ROOF_HUT_VARIANTS) {
      const hut = buildRoofHut({ variant, size: SIZE });
      hut.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        expect(mesh.geometry.userData.shared, `${variant} owns its geometry`).toBe(true);
        expect(
          (mesh.material as THREE.Material).userData.shared,
          `${variant} owns its material`,
        ).toBe(true);
      });
    }
  });
});
