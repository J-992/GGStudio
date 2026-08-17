/**
 * Automatic wheel orientation. A wheel only mounts one way round, so the editor
 * works that way out from the face it was dropped against and from the wheels
 * already on the rig rather than making the player find it with R.
 *
 * The bar these tests hold: every orientation the rules hand back has to be one
 * `canPlacePart` accepts, on the real catalog parts.
 */

import { describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import { canPlacePart } from '../src/core/placement.ts';
import {
  WHEEL_ORIENTATIONS,
  mirroredWheelOrientation,
  wheelMountOrientation,
  wheelOrientationCandidates,
  wheelOrientationFromRig,
} from '../src/core/wheelMount.ts';
import { BLUEPRINT_SCHEMA_VERSION } from '../src/core/types.ts';
import type { PlacedPart, VehicleBlueprint, Vec3i } from '../src/core/types.ts';

function bp(parts: PlacedPart[]): VehicleBlueprint {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id: 'test-rig',
    name: 'Test Rig',
    parts,
  };
}

function part(
  id: string,
  defId: string,
  pos: Vec3i,
  orient = 0,
): PlacedPart {
  return { id, defId, pos, orient, config: {} };
}

/** A single frame block on the ground, the thing a first wheel bolts to. */
const CORE = part('root', 'chassis-core', { x: 0, y: 1, z: 0 });

const WHEEL = getPartDef('wheel-standard');

describe('wheelMountOrientation', () => {
  it('faces a socket at the block the wheel hangs off', () => {
    for (const hostDir of [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ]) {
      const orient = wheelMountOrientation(WHEEL, hostDir);
      expect(orient).not.toBeNull();
      // A wheel one cell out from the core, mounted toward it, must place.
      const pos = {
        x: CORE.pos.x - hostDir.x,
        y: CORE.pos.y - hostDir.y,
        z: CORE.pos.z - hostDir.z,
      };
      const result = canPlacePart(
        bp([CORE]),
        getPartDef,
        'wheel-standard',
        pos,
        orient as number,
        {},
      );
      expect(result.ok, `hostDir ${JSON.stringify(hostDir)}`).toBe(true);
    }
  });

  it('keeps the axle across the rig on a flank mount', () => {
    // Side-mounted wheels must turn about X, not about Z: the level turn that
    // points a fore/aft socket sideways would lay the wheel down like a castor.
    for (const hostDir of [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
    ]) {
      const orient = wheelMountOrientation(WHEEL, hostDir) as number;
      expect([WHEEL_ORIENTATIONS[0], WHEEL_ORIENTATIONS[1]]).toContain(orient);
    }
  });

  it('refuses a vertical mount, which no wheel has a socket for', () => {
    expect(wheelMountOrientation(WHEEL, { x: 0, y: 1, z: 0 })).toBeNull();
    expect(wheelMountOrientation(WHEEL, { x: 0, y: -1, z: 0 })).toBeNull();
  });
});

describe('wheelOrientationFromRig', () => {
  const left = part('wl', 'wheel-standard', { x: -1, y: 1, z: 0 }, 0);
  const rightOrient = mirroredWheelOrientation(0);

  it('copies a wheel on the same flank', () => {
    const rig = bp([CORE, left]);
    expect(wheelOrientationFromRig(rig, getPartDef, { x: -1, y: 1, z: 2 })).toBe(0);
  });

  it('mirrors a wheel going on the other flank', () => {
    const rig = bp([CORE, left]);
    expect(wheelOrientationFromRig(rig, getPartDef, { x: 1, y: 1, z: 0 })).toBe(
      rightOrient,
    );
  });

  it('has nothing to say about a rig with no wheels', () => {
    expect(wheelOrientationFromRig(bp([CORE]), getPartDef, { x: 1, y: 1, z: 0 })).toBeNull();
  });
});

describe('wheelOrientationCandidates', () => {
  it('leads with the dropped-on face and always offers every level turn', () => {
    const rig = bp([CORE]);
    const hostDir = { x: 1, y: 0, z: 0 };
    const candidates = wheelOrientationCandidates(
      rig,
      getPartDef,
      WHEEL,
      { x: -1, y: 1, z: 0 },
      hostDir,
    );
    expect(candidates[0]).toBe(wheelMountOrientation(WHEEL, hostDir));
    expect(new Set(candidates).size).toBe(candidates.length);
    for (const orient of WHEEL_ORIENTATIONS) expect(candidates).toContain(orient);
  });

  it('falls back to the rig when the wheel was dropped on a top face', () => {
    // Nothing on a block's top face can hold a wheel, so the rig's own wheels
    // are what decides — here the mirror of the wheel across the deck.
    const rig = bp([CORE, part('wl', 'wheel-standard', { x: -1, y: 1, z: 0 }, 0)]);
    const candidates = wheelOrientationCandidates(
      rig,
      getPartDef,
      WHEEL,
      { x: 1, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
    );
    expect(candidates[0]).toBe(mirroredWheelOrientation(0));
  });

  it('picks a placeable orientation for every face of a bare core', () => {
    // What the editor actually does with the list: take the first that places.
    const rig = bp([CORE]);
    for (const hostDir of [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ]) {
      const pos = {
        x: CORE.pos.x - hostDir.x,
        y: CORE.pos.y - hostDir.y,
        z: CORE.pos.z - hostDir.z,
      };
      const candidates = wheelOrientationCandidates(
        rig,
        getPartDef,
        WHEEL,
        pos,
        hostDir,
      );
      const placeable = candidates.filter(
        (orient) =>
          canPlacePart(rig, getPartDef, 'wheel-standard', pos, orient, {}).ok,
      );
      expect(placeable.length, `hostDir ${JSON.stringify(hostDir)}`).toBeGreaterThan(0);
      expect(candidates[0]).toBe(placeable[0]);
    }
  });
});
