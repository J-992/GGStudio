import { describe, expect, it } from 'vitest';
import {
  generateBuildingRow,
  generateCornerBuilding,
  generateGapFacade,
  BUILDINGS_PER_SIDE,
  BUILDING_COLORS,
  GAP_FROM_DECK,
  HEIGHT_PATTERN,
  HEIGHT_JITTER,
} from '../src/levels/procedural/Buildings';
import { WINDOW_PATTERN_COUNT } from '../src/levels/procedural/BuildingWindows';
import { CHUNK_LENGTH, DECK_WIDTH } from '../src/levels/TrackConfig';

/**
 * The skyline flanking the track.
 *
 * The one invariant that actually matters for gameplay - a building can
 * never read as sitting on the deck - is geometric, not probabilistic: every
 * placement's *near face* sits at a fixed lateral offset regardless of its
 * own (varying) width, so it is checked directly rather than sampled. This
 * mirrors why the old scattered skyline broke (see `Buildings.ts`'s own doc
 * comment): that one measured against a route-wide radius that could drift
 * off the actual track on a turn, so it's exactly this property - closeness
 * to the deck edge, checked directly - that regresses if placement is ever
 * rewritten to go back through something like that.
 */

const SIDES = [1, -1] as const;
/** Wide enough to cover several full pattern cycles and both a bootstrap
 *  (negative) index and ordinary positive chunk indices. */
const CHUNK_INDICES = Array.from({ length: 40 }, (_, i) => i - 5);
/** Positive-only indices, for the turn-clearance tests below - a turn never
 *  happens on the bootstrap chunk, so there is no negative-index case to
 *  cover there. */
const POSITIVE_CHUNK_INDICES = Array.from({ length: 20 }, (_, i) => i + 1);

describe('generateBuildingRow', () => {
  it('never lets a building creep closer to the track than the deck edge plus the gap', () => {
    for (const chunkIndex of CHUNK_INDICES) {
      for (const side of SIDES) {
        for (const b of generateBuildingRow(chunkIndex, side)) {
          if (!b) continue;
          const nearFace = Math.abs(b.x) - b.width / 2;
          expect(nearFace).toBeGreaterThanOrEqual(DECK_WIDTH / 2 + GAP_FROM_DECK - 1e-9);
        }
      }
    }
  });

  it('places the row on the requested side of the centreline', () => {
    for (const chunkIndex of CHUNK_INDICES) {
      for (const side of SIDES) {
        for (const b of generateBuildingRow(chunkIndex, side)) {
          if (!b) continue;
          expect(Math.sign(b.x)).toBe(side);
        }
      }
    }
  });

  it('returns a fixed count - a pooled rig size, not a per-chunk choice', () => {
    for (const chunkIndex of CHUNK_INDICES) {
      expect(generateBuildingRow(chunkIndex, 1)).toHaveLength(BUILDINGS_PER_SIDE);
    }
  });

  it('keeps every building a real, positive-volume box', () => {
    for (const chunkIndex of CHUNK_INDICES) {
      for (const side of SIDES) {
        for (const b of generateBuildingRow(chunkIndex, side)) {
          if (!b) continue;
          expect(b.width).toBeGreaterThan(0);
          expect(b.height).toBeGreaterThan(0);
          expect(b.depth).toBeGreaterThan(0);
        }
      }
    }
  });

  it('only ever draws a building colour from the six Candy City building colours', () => {
    expect(BUILDING_COLORS).toHaveLength(6);
    for (const chunkIndex of CHUNK_INDICES) {
      for (const side of SIDES) {
        for (const b of generateBuildingRow(chunkIndex, side)) {
          if (!b) continue;
          expect(BUILDING_COLORS).toContain(b.color);
        }
      }
    }
  });

  it('only ever draws a window pattern index BuildingWindows actually has', () => {
    for (const chunkIndex of CHUNK_INDICES) {
      for (const side of SIDES) {
        for (const b of generateBuildingRow(chunkIndex, side)) {
          if (!b) continue;
          expect(b.pattern).toBeGreaterThanOrEqual(0);
          expect(b.pattern).toBeLessThan(WINDOW_PATTERN_COUNT);
        }
      }
    }
  });

  it('is deterministic - the same point on the route looks the same on every rebuild', () => {
    const a = generateBuildingRow(17, 1);
    const b = generateBuildingRow(17, 1);
    expect(a).toEqual(b);
  });

  it('does not repeat the same chunk-to-chunk (this is a skyline, not one stamped building)', () => {
    const a = generateBuildingRow(0, 1);
    const b = generateBuildingRow(1, 1);
    expect(a).not.toEqual(b);
  });

  it('follows the requested short/medium/tall cycle rather than picking a fresh random height every time', () => {
    // Each building's roof height is the pattern's own value for its global
    // slot, index-cycled, plus bounded jitter - so it must land within
    // HEIGHT_JITTER of that pattern value, never further.
    for (const chunkIndex of CHUNK_INDICES) {
      for (const side of SIDES) {
        const row = generateBuildingRow(chunkIndex, side);
        for (let slot = 0; slot < row.length; slot++) {
          const b = row[slot];
          if (!b) continue;
          const globalIndex = chunkIndex * BUILDINGS_PER_SIDE + slot;
          const step = ((globalIndex % HEIGHT_PATTERN.length) + HEIGHT_PATTERN.length) % HEIGHT_PATTERN.length;
          const expectedTop = HEIGHT_PATTERN[step];
          const actualTop = b.y + b.height / 2;
          expect(Math.abs(actualTop - expectedTop)).toBeLessThanOrEqual(HEIGHT_JITTER + 1e-9);
        }
      }
    }
  });

  it('lines a building\'s footprint up with its own allotted stretch of the chunk, not spilling far into a neighbour\'s', () => {
    const slotSpan = CHUNK_LENGTH / BUILDINGS_PER_SIDE;
    for (const chunkIndex of CHUNK_INDICES) {
      for (const side of SIDES) {
        const row = generateBuildingRow(chunkIndex, side);
        for (let slot = 0; slot < row.length; slot++) {
          const b = row[slot];
          if (!b) continue;
          const slotStart = slot * slotSpan;
          const slotEnd = slotStart + slotSpan;
          // A little tolerance for jitter overlapping into the neighbouring
          // slot's own gap - cosmetically harmless, and bounded.
          expect(b.z - b.depth / 2).toBeGreaterThan(slotStart - 2);
          expect(b.z + b.depth / 2).toBeLessThan(slotEnd + 2);
        }
      }
    }
  });
});

describe('generateBuildingRow turn clearance', () => {
  // Regression for "buildings placed around the inside of 90-degree turns
  // still overlap the playable track": a turn chunk's own frame reflects
  // its NEW heading, but the PREVIOUS chunk's deck was laid out in the OLD
  // one. Mapped through the turn's rotation, that previous deck's footprint
  // covers this chunk's local X in [-CHUNK_LENGTH, 0] and Z in
  // [-DECK_WIDTH/2, DECK_WIDTH/2] on the *inside* of the turn
  // (`-turn.dir`) - which is exactly where row slot 0 (nearest this
  // chunk's own start) would otherwise land.

  it('suppresses only the near-pivot slot, only on the inside of the turn', () => {
    for (const chunkIndex of POSITIVE_CHUNK_INDICES) {
      for (const dir of [1, -1] as const) {
        const insideSide = -dir as -1 | 1;
        const outsideSide = dir;

        const insideRow = generateBuildingRow(chunkIndex, insideSide, true);
        expect(insideRow[0]).toBeNull();
        expect(insideRow[1]).not.toBeNull();

        const outsideRow = generateBuildingRow(chunkIndex, outsideSide, false);
        expect(outsideRow[0]).not.toBeNull();
        expect(outsideRow[1]).not.toBeNull();
      }
    }
  });

  it('keeps the surviving inside-of-turn slot clear of the previous deck band too', () => {
    // Slot 0 is dropped outright; slot 1 was assumed to sit clear of the
    // previous chunk's deck band by itself, and its own jitter can pull its
    // near face down to 6.75 - just inside DECK_WIDTH / 2 (7). A full
    // ChunkBuilder walk does eventually find that sliver overlap, so the
    // near face is now pushed out to the same GAP_FROM_DECK clearance every
    // other building keeps from a deck edge.
    for (const chunkIndex of POSITIVE_CHUNK_INDICES) {
      for (const dir of [1, -1] as const) {
        const insideSide = -dir as -1 | 1;
        const row = generateBuildingRow(chunkIndex, insideSide, true);
        for (const b of row) {
          if (!b) continue;
          expect(b.z - b.depth / 2).toBeGreaterThanOrEqual(
            DECK_WIDTH / 2 + GAP_FROM_DECK - 1e-9,
          );
        }
      }
    }
  });

  it('leaves straight-section rows (no turn) completely untouched', () => {
    for (const chunkIndex of POSITIVE_CHUNK_INDICES) {
      for (const side of SIDES) {
        const row = generateBuildingRow(chunkIndex, side, false);
        expect(row[0]).not.toBeNull();
        expect(row[1]).not.toBeNull();
      }
    }
  });

  it('the suppressed slot really would have reached into the previous chunk\'s deck footprint', () => {
    // Proves the suppression is load-bearing, not just defensive: without
    // it, slot 0 on the inside sits close enough to the pivot (well within
    // CHUNK_LENGTH along the axis the previous deck reaches down) and low
    // enough in Z (inside the previous deck's own DECK_WIDTH band) to
    // plausibly land on top of it.
    for (const chunkIndex of POSITIVE_CHUNK_INDICES) {
      for (const dir of [1, -1] as const) {
        const insideSide = -dir as -1 | 1;
        const wouldBe = generateBuildingRow(chunkIndex, insideSide, false)[0];
        expect(wouldBe).not.toBeNull();
        if (!wouldBe) continue;

        const nearFaceDistanceFromPivotAxis = Math.abs(wouldBe.x) - wouldBe.width / 2;
        expect(nearFaceDistanceFromPivotAxis).toBeLessThan(CHUNK_LENGTH);
        expect(wouldBe.z - wouldBe.depth / 2).toBeLessThan(DECK_WIDTH / 2);
      }
    }
  });
});

describe('generateCornerBuilding', () => {
  it('sits on the outside-of-turn side, matching spec.turn.dir the same way ChunkBuilder\'s own cornerFill patch does', () => {
    for (const dir of [1, -1] as const) {
      const b = generateCornerBuilding(3, dir);
      expect(Math.sign(b.x)).toBe(dir);
    }
  });

  it('also stays clear of the deck edge plus the gap', () => {
    for (const chunkIndex of CHUNK_INDICES) {
      for (const dir of [1, -1] as const) {
        const b = generateCornerBuilding(chunkIndex, dir);
        const nearFace = Math.abs(b.x) - b.width / 2;
        expect(nearFace).toBeGreaterThanOrEqual(DECK_WIDTH / 2 + GAP_FROM_DECK - 1e-9);
      }
    }
  });

  it('reaches back across the chunk boundary, where the turn actually opens a gap', () => {
    // ChunkBuilder's own cornerFill sits at negative local Z (behind this
    // chunk's start) for the same reason - see that file's doc comment.
    const b = generateCornerBuilding(9, 1);
    expect(b.z).toBeLessThan(0);
  });

  it('draws a window pattern index BuildingWindows actually has', () => {
    for (const dir of [1, -1] as const) {
      const b = generateCornerBuilding(3, dir);
      expect(b.pattern).toBeGreaterThanOrEqual(0);
      expect(b.pattern).toBeLessThan(WINDOW_PATTERN_COUNT);
    }
  });
});

describe('generateGapFacade', () => {
  const KEYS = ['A', 'B', 'C', 'corner'] as const;

  it('is deterministic and stays within the real colour/pattern sets', () => {
    for (const chunkIndex of CHUNK_INDICES) {
      for (const key of KEYS) {
        const a = generateGapFacade(chunkIndex, key);
        const b = generateGapFacade(chunkIndex, key);
        expect(a).toEqual(b);
        expect(BUILDING_COLORS).toContain(a.color);
        expect(a.pattern).toBeGreaterThanOrEqual(0);
        expect(a.pattern).toBeLessThan(WINDOW_PATTERN_COUNT);
      }
    }
  });

  it('does not draw the same seed the skyline rows use, even at the same chunk index', () => {
    // Different `slot` numbers into the same jitterRng - a sanity check that
    // the two draws are not silently coupled.
    const facade = generateGapFacade(5, 'A');
    const row = generateBuildingRow(5, 1);
    expect([facade.color, facade.pattern]).not.toEqual([row[0]?.color, row[0]?.pattern]);
  });
});
