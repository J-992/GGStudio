import type { ClotheslineDef, LevelObject, Vec3 } from './LevelTypes';
import { PHYSICS } from '../physics/PhysicsConfig';
import { CHUNK_LENGTH, DECK_THICKNESS, DECK_WIDTH, TRACK_Y } from './TrackConfig';

/**
 * The one chunk the endless track is built out of, for now.
 *
 * Phase 3 replaces this with a mined pattern library and a director that deals
 * from it. Until then a single hand-written chunk repeated forever is the right
 * scaffold: the thing this phase has to prove is that chunks stream in and out
 * without leaking, and a deck that repeats makes a leak *more* visible, not
 * less, because every chunk is identical and any drift in the body count is
 * therefore unambiguous.
 *
 * Everything below is authored in **chunk-local** coordinates:
 *
 *   x - world lateral. Lanes are at `laneX(-1 | 0 | 1)`.
 *   y - relative to the walking surface, so 0 is standing height.
 *   z - 0 at the chunk's leading edge, running to {@link CHUNK_LENGTH}.
 *
 * `expandChunk()` turns that into world space, which on a straight +Z track is
 * a pure translation - no rotation, no spline, no handedness to get wrong.
 */

export type Lane = -1 | 0 | 1;

/**
 * World X of a lane centre.
 *
 * Negated because screen-right on a +Z heading is world −X: three.js cameras
 * look down their local −Z, so a trailing camera has `x_axis = up × (−dir)`,
 * which for `dir = +Z` is `(−1, 0, 0)`. Lane +1 is the runner's right, and the
 * runner's right is −X. This is the same fact `RunPath`'s `right` encodes; both
 * were inverted before Phase 0, which is why lane switching was mirrored.
 */
export function laneX(lane: Lane): number {
  return -lane * PHYSICS.laneSpacing;
}

export interface ChunkTemplate {
  readonly objects: readonly LevelObject[];
  readonly tokens: readonly Vec3[];
}

/**
 * A rhythm of four decisions across `CHUNK_LENGTH` units, none of which
 * closes more than one lane. The solvability audit that would enforce that
 * by construction is the live `ChunkDirector`/`ChunkGenerators` system this
 * template predates; this hand-authored chunk is unused by it (kept only for
 * its own test coverage in `tests/endless.test.ts`), and by the test that
 * asserts it. Z's below were rescaled proportionally when `CHUNK_LENGTH`
 * shrank from 80 to 30, then again from 30 to 15.
 */
export const DEFAULT_CHUNK: ChunkTemplate = {
  objects: [
    // The deck. Its centre sits half a slab below the surface, so the walking
    // height is exactly TRACK_Y and consecutive chunks butt together with no
    // lip for `maxStepUp` to have to rescue.
    {
      kind: 'platform',
      position: [0, -DECK_THICKNESS / 2, CHUNK_LENGTH / 2],
      size: [DECK_WIDTH, DECK_THICKNESS, CHUNK_LENGTH],
      style: 'terracotta',
      building: true,
    },

    // --- The four lane decisions ------------------------------------------
    { kind: 'acUnit', position: [laneX(-1), 0, 2.5], size: [2.2, 1.1, 1.8] },
    { kind: 'acUnit', position: [laneX(1), 0, 5.5], size: [2.2, 1.1, 1.8] },
    { kind: 'chimney', position: [laneX(0), 0, 8.5], size: [1.4, 3, 1.4] },
    { kind: 'crate', position: [laneX(1), 0, 11.5], size: [1.4, 1.4, 1.4] },

    // --- Dressing, all of it outside the lane span ------------------------
    // X's pulled in from +-10/11/12 when DECK_WIDTH shrank from 30 to 14 -
    // still clear of the lane span (laneX(+-1) = +-2.4) but inside the deck.
    { kind: 'prop', prop: 'satelliteDish', position: [5, 0, 1.5] },
    { kind: 'watertower', position: [-6, 0, 7], scale: 0.9 },
    { kind: 'prop', prop: 'sign', position: [6, 0, 10], rotation: [0, 25, 0] },
    { kind: 'chimney', position: [-5, 0, 13], size: [1.4, 3.2, 1.4] },
  ],

  // Fish sit on the line the obstacles push you off, so collecting them is a
  // reason to commit to a lane rather than drift down the middle.
  tokens: [
    [laneX(0), 1.6, 4],
    [laneX(1), 1.6, 10],
  ],
};

/** Lifts a chunk-local Y onto the deck. */
function worldY(localY: number): number {
  return TRACK_Y + localY;
}

function translated(position: Vec3, startZ: number): Vec3 {
  return [position[0], worldY(position[1]), startZ + position[2]];
}

/**
 * Places a chunk template at a world Z.
 *
 * Returns fresh objects every call - the factory reads these straight into
 * geometry and colliders, and handing it a shared object would make two chunks
 * alias one another's position.
 */
export function expandChunk(
  template: ChunkTemplate,
  startZ: number,
): { objects: LevelObject[]; tokens: Vec3[] } {
  const objects = template.objects.map((def) => {
    const placed = { ...def, position: translated(def.position, startZ) } as LevelObject;

    // `clothesline` is the one variant that carries a second world-space point.
    // Nothing in DEFAULT_CHUNK uses it yet, but a template that silently left
    // one end at the origin would be a nasty thing to debug later.
    if (placed.kind === 'clothesline') {
      (placed as ClotheslineDef).end = translated((def as ClotheslineDef).end, startZ);
    }

    return placed;
  });

  const tokens = template.tokens.map((token) => translated(token, startZ));

  return { objects, tokens };
}
