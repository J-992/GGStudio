import { describe, expect, it, afterEach } from 'vitest';
import * as THREE from 'three';

import {
  PALETTE,
  buildChimney,
  buildRooftopGarden,
  buildPigeon,
  disposeProceduralCache,
  freezeStatic,
  getMaterial,
  markAnimated,
} from '../src/assets/ProceduralProps';

/**
 * `freezeStatic` merges a prop's meshes to cut draw calls, and it does that by
 * baking each mesh's transform into its vertices. That is a silent operation:
 * get the transform wrong and nothing throws, nothing warns, and the prop is
 * simply drawn somewhere other than where it belongs - or, if a whole bucket
 * fails to merge, not drawn at all. Exactly that shipped once, and the only
 * symptom was an empty-looking rooftop in a screenshot.
 *
 * So the contract is pinned by geometry, not by mesh counts: whatever the merge
 * does internally, the visible bounding box afterwards must be the bounding box
 * before, and every mesh that moves at runtime must still be its own object.
 */

/** World-space bounds of everything drawn under `root`. */
function bounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

function meshCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

function expectSameBox(actual: THREE.Box3, expected: THREE.Box3, tolerance = 1e-4): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(actual.min[axis]).toBeCloseTo(expected.min[axis], tolerance);
    expect(actual.max[axis]).toBeCloseTo(expected.max[axis], tolerance);
  }
}

describe('freezeStatic', () => {
  afterEach(() => {
    disposeProceduralCache();
  });

  it('leaves a prop occupying exactly the space it did before', () => {
    const before = bounds(buildChimney({ height: 2.6, width: 1.2 }));
    const after = bounds(freezeStatic(buildChimney({ height: 2.6, width: 1.2 })));
    expectSameBox(after, before);
  });

  it('preserves world placement when the group is already positioned', () => {
    // The factory positions a prop and parents it into the level, and only then
    // freezes it. Baking world coordinates instead of root-relative ones would
    // apply the placement twice and throw the prop off into the distance -
    // which is precisely the failure this guards.
    const place = (): THREE.Group => {
      const parent = new THREE.Group();
      parent.position.set(100, 20, -40);

      const prop = buildChimney({ height: 2.6 });
      prop.position.set(3, 0, 7);
      prop.rotation.y = 0.9;
      prop.scale.setScalar(1.4);
      parent.add(prop);
      return parent;
    };

    const before = bounds(place());

    const frozenParent = place();
    freezeStatic(frozenParent.children[0]);
    const after = bounds(frozenParent);

    expectSameBox(after, before);
  });

  it('actually reduces the number of draw calls', () => {
    const garden = buildRooftopGarden({ width: 30, depth: 6 });
    const before = meshCount(garden);
    const after = meshCount(freezeStatic(garden));

    expect(before).toBeGreaterThan(20);
    // One mesh per material used, and the garden uses a handful.
    expect(after).toBeLessThan(10);
  });

  it('never merges a subtree marked animated', () => {
    const material = getMaterial(PALETTE.metal);
    const root = new THREE.Group();

    for (let i = 0; i < 3; i++) {
      const still = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      still.position.x = i;
      root.add(still);
    }

    const moving = markAnimated(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    moving.name = 'moving';
    root.add(moving);

    freezeStatic(root);

    // The three static boxes share a material and collapse to one; the marked
    // one must survive as its own object, still findable and still movable.
    expect(root.getObjectByName('moving')).toBe(moving);
    expect(meshCount(root)).toBe(2);
  });

  it('keeps a pigeon flappable', () => {
    // buildPigeon freezes itself, and PigeonFlock drives the wings by name.
    const pigeon = buildPigeon();
    const wingL = pigeon.getObjectByName('wingL');
    const wingR = pigeon.getObjectByName('wingR');

    expect(wingL).toBeDefined();
    expect(wingR).toBeDefined();

    // A flap must move only the wing, not the bird.
    const bodyBefore = bounds(pigeon).clone();
    wingL!.rotation.x = 0.6;
    expect(bounds(pigeon).equals(bodyBefore)).toBe(false);
  });

  it('does not merge across differing shadow flags', () => {
    const material = getMaterial(PALETTE.wood);
    const root = new THREE.Group();

    for (const castShadow of [true, true, false, false]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.castShadow = castShadow;
      root.add(mesh);
    }

    freezeStatic(root);

    const casters = [] as THREE.Mesh[];
    const rest = [] as THREE.Mesh[];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      (mesh.castShadow ? casters : rest).push(mesh);
    });

    expect(casters).toHaveLength(1);
    expect(rest).toHaveLength(1);
  });
});
