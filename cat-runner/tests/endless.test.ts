import { describe, expect, it } from 'vitest';

import { ChunkStreamer, type ChunkPlacement } from '../src/levels/ChunkStreamer';
import { DEFAULT_CHUNK, expandChunk, laneX, type Lane } from '../src/levels/chunkTemplate';
import {
  AHEAD_DISTANCE,
  BEHIND_DISTANCE,
  CHUNK_LENGTH,
  DECK_WIDTH,
  TRACK_Y,
} from '../src/levels/TrackConfig';
import { RunPath } from '../src/levels/RunPath';
import { PHYSICS } from '../src/physics/PhysicsConfig';
import type { LevelObject } from '../src/levels/LevelTypes';

/**
 * Endless track audit.
 *
 * The failure this file exists to catch is not a wrong pixel, it is a slow
 * leak: chunks spawned faster than they are retired until the tab dies twenty
 * minutes into a run. That is unobservable in a short play session and trivial
 * here, because `ChunkStreamer` is deliberately free of three.js and Rapier and
 * can therefore be run for hours of simulated running in milliseconds.
 *
 * The second failure is a hole in the deck. Retiring a chunk the player is
 * still standing on drops them through the world, and it only happens at a
 * boundary crossing under an unlucky frame time, so it is exactly the kind of
 * bug that survives manual testing and ships.
 */

/** A streamer wired to the real shipping constants. */
function makeStreamer(overrides: Partial<ConstructorParameters<typeof ChunkStreamer>[0]> = {}) {
  return new ChunkStreamer({
    chunkLength: CHUNK_LENGTH,
    aheadDistance: AHEAD_DISTANCE,
    behindDistance: BEHIND_DISTANCE,
    ...overrides,
  });
}

/**
 * Mirrors the streamer's callbacks into a plain map, so the test can assert on
 * what the *consumer* was told rather than on the streamer's own counters.
 * A streamer whose internal bookkeeping agrees with itself but not with its
 * callbacks would leak in exactly the way that matters.
 */
function tracker() {
  const occupied = new Map<number, ChunkPlacement>();
  let spawns = 0;
  let recycles = 0;

  return {
    occupied,
    get spawns() {
      return spawns;
    },
    get recycles() {
      return recycles;
    },
    callbacks: {
      spawn(placement: ChunkPlacement, slot: number) {
        // Spawning into an occupied slot would silently orphan whatever was
        // there - in the real track, a Rapier body with no owner left to
        // dispose it.
        expect(occupied.has(slot)).toBe(false);
        occupied.set(slot, placement);
        spawns++;
      },
      recycle(placement: ChunkPlacement, slot: number) {
        expect(occupied.get(slot)).toBe(placement);
        occupied.delete(slot);
        recycles++;
      },
    },
  };
}

/** Sorted indices the consumer currently believes are live. */
function liveIndices(occupied: Map<number, ChunkPlacement>): number[] {
  return [...occupied.values()].map((p) => p.index).sort((a, b) => a - b);
}

describe('ChunkStreamer', () => {
  it('opens with a deck that already reaches as far as the player can see', () => {
    const streamer = makeStreamer();
    const t = tracker();
    streamer.reset(0, t.callbacks);

    const indices = liveIndices(t.occupied);
    expect(indices.length).toBeGreaterThan(0);

    // The opening deal ignores the per-frame spawn cap on purpose: the player
    // is dropped onto this track immediately and must not see its far edge.
    const last = indices[indices.length - 1];
    expect((last + 1) * CHUNK_LENGTH).toBeGreaterThanOrEqual(AHEAD_DISTANCE);
    expect(indices[0] * CHUNK_LENGTH).toBeLessThanOrEqual(-BEHIND_DISTANCE);
  });

  it('never fragments: the live set is always a contiguous run of indices', () => {
    const streamer = makeStreamer();
    const t = tracker();
    streamer.reset(0, t.callbacks);

    for (let z = 0; z < 4000; z += 7) {
      streamer.update(z, t.callbacks);
      const indices = liveIndices(t.occupied);
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBe(indices[i - 1] + 1);
      }
    }
  });

  it('keeps deck under the player at every step of a long run', () => {
    const streamer = makeStreamer();
    const t = tracker();
    streamer.reset(0, t.callbacks);

    // A deliberately awkward step: not a divisor of the chunk length, so
    // boundaries are crossed at every phase rather than the same one each time.
    for (let z = 0; z < 40_000; z += 3.7) {
      streamer.update(z, t.callbacks);

      const covering = [...t.occupied.values()].find(
        (p) => p.startZ <= z && z < p.startZ + CHUNK_LENGTH,
      );
      expect(covering, `no chunk under player at z=${z}`).toBeDefined();
    }
  });

  it('does not leak over five hours of simulated running', () => {
    const streamer = makeStreamer();
    const t = tracker();
    streamer.reset(0, t.callbacks);

    // 200k units at runSpeed 11 is the full designed track length. The high
    // water mark is accumulated with plain arithmetic rather than an assertion
    // per iteration - a million `expect` calls cost a minute and prove nothing
    // the single check below does not.
    let maxLive = 0;
    for (let z = 0; z < 200_000; z += PHYSICS.runSpeed / 60) {
      streamer.update(z, t.callbacks);
      if (t.occupied.size > maxLive) maxLive = t.occupied.size;
    }
    expect(maxLive).toBeLessThanOrEqual(streamer.slotCount);

    // The canary: everything ever built is either still live or was handed
    // back. A discrepancy of even one is a body that outlived its chunk.
    expect(t.spawns - t.recycles).toBe(t.occupied.size);
    expect(streamer.spawnCount - streamer.recycleCount).toBe(streamer.liveCount);
    expect(streamer.liveCount).toBe(t.occupied.size);
  });

  it('retires only chunks that are wholly behind the player', () => {
    const streamer = makeStreamer();
    const t = tracker();
    streamer.reset(0, t.callbacks);

    for (let z = 0; z < 5000; z += 11) {
      streamer.update(z, t.callbacks);
      for (const placement of t.occupied.values()) {
        // Nothing still live may extend past the retirement cutoff...
        expect(placement.startZ + CHUNK_LENGTH).toBeGreaterThanOrEqual(z - BEHIND_DISTANCE);
      }
    }
  });

  it('honours the one-spawn-per-frame cap once running', () => {
    const streamer = makeStreamer();
    const t = tracker();
    streamer.reset(0, t.callbacks);

    // Building a chunk touches Rapier and uploads geometry; several in the
    // frame the player crosses a boundary is the hitch this cap prevents.
    for (let z = 0; z < 5000; z += 11) {
      const before = t.spawns;
      streamer.update(z, t.callbacks);
      expect(t.spawns - before).toBeLessThanOrEqual(streamer.maxSpawnsPerUpdate);
    }
  });

  it('survives the backward setback of a fall recovery without tearing', () => {
    const streamer = makeStreamer();
    const t = tracker();
    streamer.reset(0, t.callbacks);

    let z = 0;
    for (let i = 0; i < 2000; i++) {
      z += 11;
      // Every so often, the six-unit setback a recovery applies.
      if (i % 37 === 0) z -= 6;
      streamer.update(z, t.callbacks);

      const covering = [...t.occupied.values()].find(
        (p) => p.startZ <= z && z < p.startZ + CHUNK_LENGTH,
      );
      expect(covering, `no chunk under player at z=${z}`).toBeDefined();
    }
  });

  it('does not build the chunks a forward teleport skipped over', () => {
    const streamer = makeStreamer();
    const t = tracker();
    streamer.reset(0, t.callbacks);
    const before = t.spawns;

    // A long stall, or a jump straight to a checkpoint. The chunks in between
    // are already behind the window; building them would be wasted work.
    const far = 50_000;
    streamer.update(far, t.callbacks);

    expect(t.spawns - before).toBeLessThanOrEqual(streamer.maxSpawnsPerUpdate);

    // And the window repairs itself rather than staying broken.
    for (let z = far; z < far + 2000; z += 11) streamer.update(z, t.callbacks);
    const covering = [...t.occupied.values()].find(
      (p) => p.startZ <= far + 1990 && far + 1990 < p.startZ + CHUNK_LENGTH,
    );
    expect(covering).toBeDefined();
  });

  it('hands every slot back on reset, so a restart cannot leak', () => {
    const streamer = makeStreamer();
    const t = tracker();

    streamer.reset(0, t.callbacks);
    for (let z = 0; z < 3000; z += 11) streamer.update(z, t.callbacks);

    const liveBefore = t.occupied.size;
    expect(liveBefore).toBeGreaterThan(0);

    streamer.reset(0, t.callbacks);

    // Every chunk from the old run was released, and the new deal is a fresh
    // opening window rather than an accumulation on top of the old one.
    expect(t.recycles).toBeGreaterThanOrEqual(liveBefore);
    expect(t.spawns - t.recycles).toBe(t.occupied.size);
    expect(t.occupied.size).toBeLessThanOrEqual(streamer.slotCount);
  });

  it('reset re-deals correctly after a long run, not just from the spawn', () => {
    const streamer = makeStreamer();
    const t = tracker();
    streamer.reset(0, t.callbacks);
    for (let z = 0; z < 10_000; z += 11) streamer.update(z, t.callbacks);

    // A teleport backwards past a whole chunk must come through reset(), which
    // is the case update() explicitly does not repair.
    streamer.reset(0, t.callbacks);
    const covering = [...t.occupied.values()].find((p) => p.startZ <= 0 && 0 < p.startZ + CHUNK_LENGTH);
    expect(covering).toBeDefined();
    expect(t.spawns - t.recycles).toBe(t.occupied.size);
  });

  it('rejects a non-positive chunk length rather than looping forever', () => {
    expect(() => makeStreamer({ chunkLength: 0 })).toThrow();
  });
});

describe('chunk template', () => {
  const LANES: Lane[] = [-1, 0, 1];

  /** Lane-blocking kinds. Dressing is everything else. */
  const BLOCKING = new Set(['acUnit', 'chimney', 'crate', 'block', 'watertower']);

  /** Half-depth of an object along Z, for the overlap test. */
  function halfDepth(def: LevelObject): number {
    const size = (def as { size?: [number, number, number] }).size;
    return size ? size[2] / 2 : 1;
  }

  it('puts lane +1 on the runner s right, which is world -X', () => {
    // The same handedness fact `RunPath.right` encodes. Both were inverted
    // before Phase 0, which is why lane switching came out mirrored.
    expect(laneX(1)).toBe(-PHYSICS.laneSpacing);
    expect(laneX(-1)).toBe(PHYSICS.laneSpacing);
    // toBeCloseTo, not toBe: the negation makes the centre lane -0, and
    // Object.is separates that from +0 for no reason a runner will ever feel.
    expect(laneX(0)).toBeCloseTo(0);

    const path = RunPath.straight(1000, TRACK_Y, 0);
    const right = path.segments[0].right;
    expect(right.x).toBeCloseTo(-1);
    expect(right.z).toBeCloseTo(0);
  });

  it('is a straight run with no junctions, so the corner machinery stays off', () => {
    const path = RunPath.straight(1000, TRACK_Y, -400);
    expect(path.segments).toHaveLength(1);
    expect(path.junctions).toHaveLength(0);
    expect(path.junctionAfter(0)).toBeNull();
  });

  it('never closes more than one lane at the same point on the track', () => {
    // The solvability invariant. Phase 3 enforces it by construction; until
    // then it is held by hand, and this is the thing holding it.
    const blockers = DEFAULT_CHUNK.objects.filter(
      (def) => BLOCKING.has(def.kind) && LANES.some((l) => Math.abs(def.position[0] - laneX(l)) < 0.6),
    );
    expect(blockers.length).toBeGreaterThan(0);

    for (let i = 0; i < blockers.length; i++) {
      for (let j = i + 1; j < blockers.length; j++) {
        const a = blockers[i];
        const b = blockers[j];
        if (Math.abs(a.position[0] - b.position[0]) < 0.6) continue; // same lane, fine

        const gap = Math.abs(a.position[2] - b.position[2]) - halfDepth(a) - halfDepth(b);
        // Two obstacles in different lanes must not overlap along Z, or the
        // player is asked to be in two places at once.
        expect(gap, `${a.kind}@${a.position[2]} overlaps ${b.kind}@${b.position[2]}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps its dressing clear of the lane span', () => {
    const laneHalfSpan = PHYSICS.laneSpacing + 1.5;
    const dressing = DEFAULT_CHUNK.objects.filter(
      (def) => def.kind !== 'platform' && !LANES.some((l) => Math.abs(def.position[0] - laneX(l)) < 0.6),
    );
    expect(dressing.length).toBeGreaterThan(0);

    for (const def of dressing) {
      expect(Math.abs(def.position[0]), `${def.kind} sits in the lanes`).toBeGreaterThan(laneHalfSpan);
    }
  });

  it('keeps everything it places on the deck', () => {
    for (const def of DEFAULT_CHUNK.objects) {
      if (def.kind === 'platform') continue;
      expect(Math.abs(def.position[0])).toBeLessThan(DECK_WIDTH / 2);
      expect(def.position[2]).toBeGreaterThanOrEqual(0);
      expect(def.position[2]).toBeLessThanOrEqual(CHUNK_LENGTH);
    }
    for (const token of DEFAULT_CHUNK.tokens) {
      expect(Math.abs(token[0])).toBeLessThan(DECK_WIDTH / 2);
      expect(token[2]).toBeGreaterThanOrEqual(0);
      expect(token[2]).toBeLessThanOrEqual(CHUNK_LENGTH);
    }
  });

  it('butts consecutive decks together with no lip to step over', () => {
    const a = expandChunk(DEFAULT_CHUNK, 0);
    const b = expandChunk(DEFAULT_CHUNK, CHUNK_LENGTH);

    const deckA = a.objects.find((o) => o.kind === 'platform')!;
    const deckB = b.objects.find((o) => o.kind === 'platform')!;
    const sizeA = (deckA as { size: [number, number, number] }).size;

    // Trailing edge of A is the leading edge of B, exactly.
    expect(deckA.position[2] + sizeA[2] / 2).toBeCloseTo(deckB.position[2] - sizeA[2] / 2);

    // Same walking height, so `maxStepUp` never has to rescue a seam.
    expect(deckA.position[1]).toBe(deckB.position[1]);
  });

  it('places a chunk by pure translation along Z', () => {
    const at0 = expandChunk(DEFAULT_CHUNK, 0);
    const at800 = expandChunk(DEFAULT_CHUNK, 800);

    for (let i = 0; i < at0.objects.length; i++) {
      expect(at800.objects[i].position[0]).toBe(at0.objects[i].position[0]);
      expect(at800.objects[i].position[1]).toBe(at0.objects[i].position[1]);
      expect(at800.objects[i].position[2]).toBe(at0.objects[i].position[2] + 800);
    }
    for (let i = 0; i < at0.tokens.length; i++) {
      expect(at800.tokens[i][2]).toBe(at0.tokens[i][2] + 800);
    }
  });

  it('lifts chunk-local Y onto the deck', () => {
    const { objects, tokens } = expandChunk(DEFAULT_CHUNK, 0);
    const ac = objects.find((o) => o.kind === 'acUnit')!;
    // Local Y 0 is standing height on the deck.
    expect(ac.position[1]).toBe(TRACK_Y);
    for (const token of tokens) expect(token[1]).toBeGreaterThan(TRACK_Y);
  });

  it('returns fresh objects, so two chunks cannot alias one another', () => {
    const a = expandChunk(DEFAULT_CHUNK, 0);
    const b = expandChunk(DEFAULT_CHUNK, 800);

    // The factory reads these straight into geometry and colliders; a shared
    // object would make moving one chunk move the other.
    for (let i = 0; i < a.objects.length; i++) {
      expect(a.objects[i]).not.toBe(b.objects[i]);
      expect(a.objects[i].position).not.toBe(b.objects[i].position);
      expect(a.objects[i]).not.toBe(DEFAULT_CHUNK.objects[i]);
      expect(a.objects[i].position).not.toBe(DEFAULT_CHUNK.objects[i].position);
    }

    // And the template itself was not mutated by expanding it twice.
    expect(DEFAULT_CHUNK.objects[1].position[1]).toBe(0);
  });
});
