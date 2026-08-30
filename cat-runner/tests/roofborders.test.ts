import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RoofBorderPool, BORDER_LENGTH } from '../src/levels/procedural/RoofBorders';
import { DECK_WIDTH } from '../src/levels/procedural/ChunkTypes';
import { PHYSICS } from '../src/physics/PhysicsConfig';

/**
 * Rooftop side borders - visual-only rails that must never sit inside the
 * playable lane span, and must be parked (not just invisible) wherever the
 * deck piece they belong to isn't shown, mirroring `GapFacadePool`'s own
 * "never floats under empty air" invariant for the deck itself.
 */
describe('RoofBorderPool', () => {
  it('places both rails well outside the lane span and inside the deck edge', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rig = pool.rigFor(0);
    const frame = { left: new THREE.Vector3(1, 0, 0) };
    const centre = new THREE.Vector3(0, 5, 10);

    pool.place(rig.a, centre, new THREE.Quaternion(), frame.left, BORDER_LENGTH.a, 0);

    for (const mesh of [rig.a.left, rig.a.right]) {
      expect(mesh.visible).toBe(true);
      expect(Math.abs(mesh.position.x)).toBeGreaterThan(PHYSICS.laneSpacing);
      expect(Math.abs(mesh.position.x)).toBeLessThan(DECK_WIDTH / 2);
    }
    // The two rails sit on opposite sides.
    expect(rig.a.left.position.x).toBeCloseTo(-rig.a.right.position.x, 5);
  });

  it('sits above the deck surface, not buried in or floating far above it', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rig = pool.rigFor(0);
    const deckSurfaceY = 5;
    const centre = new THREE.Vector3(0, deckSurfaceY, 10);
    pool.place(rig.a, centre, new THREE.Quaternion(), new THREE.Vector3(1, 0, 0), BORDER_LENGTH.a, 0);

    expect(rig.a.left.position.y).toBeGreaterThan(deckSurfaceY);
    // Low rail, not a wall the size of the slide beam or a crate.
    expect(rig.a.left.position.y - deckSurfaceY).toBeLessThan(1);
  });

  it('hide() parks a pair so neither rail is left visible', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rig = pool.rigFor(0);
    pool.place(rig.c, new THREE.Vector3(0, 5, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0, 0), BORDER_LENGTH.c, 0);
    pool.hide(rig.c);
    expect(rig.c.left.visible).toBe(false);
    expect(rig.c.right.visible).toBe(false);
  });

  it('reuses one shared geometry across every rail, in every slot', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rigA = pool.rigFor(0);
    const rigB = pool.rigFor(1);
    const geoms = new Set([
      rigA.a.left.geometry,
      rigA.b.right.geometry,
      rigB.corner.outer.geometry,
      rigB.corner.back.geometry,
      rigB.c.right.geometry,
    ]);
    expect(geoms.size).toBe(1);
  });
});

/**
 * The turn corner - an outside-only L (`outer`/`back`), not a symmetric pair
 * like A/B/C - see `RoofBorders.ts`'s module doc comment for why the
 * corner-fill patch needs different-shaped tracing. These pin the geometry
 * that fixes the reported clipping/self-intersection bug: both rails stay
 * inset from the true `DECK_WIDTH/2` edge (never flush with, let alone past,
 * the deck's own boundary), sit entirely on the *outside* of the turn (the
 * `turnDir` side), and mirror correctly for the opposite turn direction.
 */
describe('RoofBorderPool.placeCorner (turn corner)', () => {
  const dir = new THREE.Vector3(0, 0, 1);
  const left = new THREE.Vector3(1, 0, 0);
  const centre = new THREE.Vector3(0, 5, 10);

  it('places an outside-only L, both rails visible and inset from the true edge', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rig = pool.rigFor(0);
    pool.placeCorner(rig.corner, centre, new THREE.Quaternion(), dir, left, 1, 0);

    expect(rig.corner.outer.visible).toBe(true);
    expect(rig.corner.back.visible).toBe(true);

    // `outer` runs along `dir`, offset sideways (along `left`) toward the
    // outside (turnDir = 1 -> positive), inset from the true edge, and sits
    // behind the chunk's own start (negative along `dir`) - the "missing
    // square" is always behind the pivot, per `ChunkBuilder`'s own comment.
    const outerSideOffset = rig.corner.outer.position.x - centre.x;
    expect(outerSideOffset).toBeGreaterThan(0);
    expect(outerSideOffset).toBeLessThan(DECK_WIDTH / 2);
    expect(rig.corner.outer.position.z - centre.z).toBeLessThan(0);

    // `back` runs along `left`, offset back (along `dir`) toward the square's
    // rear edge, inset from it, and stays on the outside (positive `left`
    // offset for turnDir = 1) rather than straddling the centreline.
    const backRearOffset = rig.corner.back.position.z - centre.z;
    expect(backRearOffset).toBeLessThan(0);
    expect(Math.abs(backRearOffset)).toBeLessThan(DECK_WIDTH / 2);
    expect(rig.corner.back.position.x - centre.x).toBeGreaterThan(0);
  });

  it('mirrors to the other side for the opposite turn direction', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rig = pool.rigFor(0);
    pool.placeCorner(rig.corner, centre, new THREE.Quaternion(), dir, left, -1, 0);

    expect(rig.corner.outer.position.x - centre.x).toBeLessThan(0);
    expect(rig.corner.back.position.x - centre.x).toBeLessThan(0);
  });

  it('hideCorner parks both rails so neither is left visible', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rig = pool.rigFor(0);
    pool.placeCorner(rig.corner, centre, new THREE.Quaternion(), dir, left, 1, 0);
    pool.hideCorner(rig.corner);
    expect(rig.corner.outer.visible).toBe(false);
    expect(rig.corner.back.visible).toBe(false);
  });
});

/**
 * The inner pivot corner - the same L shape as the outer corner, mirrored
 * onto the *inside* of the turn to close the border gap `placeRoofSurface`
 * left there (see `RoofBorders.ts`'s module doc comment). `placeInnerCorner`
 * is literally `placeCorner` with `turnDir` negated, so it should land on
 * the opposite side from the outer corner for the same `turnDir`.
 */
describe('RoofBorderPool.placeInnerCorner (turn corner, inside)', () => {
  const dir = new THREE.Vector3(0, 0, 1);
  const left = new THREE.Vector3(1, 0, 0);
  const centre = new THREE.Vector3(0, 5, 10);

  it('places an L on the opposite side from the outer corner, for the same turnDir', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rig = pool.rigFor(0);
    pool.placeCorner(rig.corner, centre, new THREE.Quaternion(), dir, left, 1, 0);
    pool.placeInnerCorner(rig.innerCorner, centre, new THREE.Quaternion(), dir, left, 1, 0);

    expect(rig.innerCorner.outer.visible).toBe(true);
    expect(rig.innerCorner.back.visible).toBe(true);

    // Outer corner (turnDir=1) sits at positive X; the inner corner mirrors
    // it, so it must sit at negative X - never overlapping the outer L.
    expect(rig.corner.outer.position.x - centre.x).toBeGreaterThan(0);
    expect(rig.innerCorner.outer.position.x - centre.x).toBeLessThan(0);
    expect(rig.corner.back.position.x - centre.x).toBeGreaterThan(0);
    expect(rig.innerCorner.back.position.x - centre.x).toBeLessThan(0);

    // Same inset-from-edge and above-deck-surface conventions as the outer
    // corner - never flush with, let alone past, the true deck edge, and
    // never buried below the deck surface (both would read as clipping).
    const insideOffset = Math.abs(rig.innerCorner.outer.position.x - centre.x);
    expect(insideOffset).toBeGreaterThan(0);
    expect(insideOffset).toBeLessThan(DECK_WIDTH / 2);
    expect(rig.innerCorner.outer.position.y).toBeGreaterThan(centre.y);
  });

  it('mirrors to the other side for the opposite turn direction', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rig = pool.rigFor(0);
    pool.placeInnerCorner(rig.innerCorner, centre, new THREE.Quaternion(), dir, left, -1, 0);

    expect(rig.innerCorner.outer.position.x - centre.x).toBeGreaterThan(0);
    expect(rig.innerCorner.back.position.x - centre.x).toBeGreaterThan(0);
  });

  it('hideCorner parks the inner corner too', () => {
    const scene = new THREE.Scene();
    const pool = new RoofBorderPool(scene);
    const rig = pool.rigFor(0);
    pool.placeInnerCorner(rig.innerCorner, centre, new THREE.Quaternion(), dir, left, 1, 0);
    pool.hideCorner(rig.innerCorner);
    expect(rig.innerCorner.outer.visible).toBe(false);
    expect(rig.innerCorner.back.visible).toBe(false);
  });
});
