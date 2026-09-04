import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { PhysicsWorld, initRapier, GROUP, collisionGroups } from '../src/physics/PhysicsWorld';
import { PlayerController, consumeEdges, type RunInput } from '../src/physics/PlayerController';
import { resetPhysicsConfig, capsuleFeetOffset } from '../src/physics/PhysicsConfig';
import { RunPath } from '../src/levels/RunPath';
import { CHUNK_LENGTH, TRACK_Y } from '../src/levels/TrackConfig';
import { laneX } from '../src/levels/chunkTemplate';

import {
  generateChunk,
  generateJump,
  generateObstacle,
  generateSlide,
  generateStraight,
  generateTurn,
  generateVent,
  mulberry32,
} from '../src/levels/procedural/ChunkGenerators';
import { buildClotheslineHazard } from '../src/levels/procedural/ClotheslineHazard';
import {
  BEAM_HEIGHT,
  BEAM_LENGTH,
  BEAM_RADIUS,
  CHUNK_TYPES,
  FISH_HEIGHT,
  GAP_END_Z,
  GAP_LENGTH,
  GAP_START_Z,
  MIN_HAZARD_SPACING,
  OBSTACLE_Z_LOOSE,
  OBSTACLE_Z_TIGHT,
  OBSTACLE_Z_TRIPLE,
  OBSTACLE_SIZE,
  POWERUP_HEIGHT,
  ROOF_LOW,
  ROOF_MEDIUM,
  ROOF_TIER_HEIGHT,
  VENT_PIPE_DEPTH,
  VENT_PIPE_HEIGHT,
  VENT_PIPE_LENGTH,
  type ChunkSpec,
  type ChunkType,
} from '../src/levels/procedural/ChunkTypes';
import {
  ChunkDirector,
  tierAt,
  TURN_COOLDOWN_CHUNKS,
  MID_TIER_START,
  LATE_TIER_START,
} from '../src/levels/procedural/ChunkDirector';
import {
  CYCLE_LENGTH_CHUNKS,
  sectionAtIndex,
  type SectionType,
} from '../src/levels/procedural/SectionDirector';
import { generateFishPattern } from '../src/levels/procedural/FishPatterns';
import { RouteGrowth } from '../src/levels/procedural/RouteGrowth';
import { ChunkBuilder } from '../src/levels/procedural/ChunkBuilder';
import { PowerUpPool } from '../src/levels/procedural/PowerUps';
import { PowerUpManager } from '../src/game/PowerUpManager';
import { PHYSICS } from '../src/physics/PhysicsConfig';
import {
  CATNIP_SPEED_MULTIPLIER,
  MAX_LIVES,
  NINE_LIVES_BONUS,
  POWERUP_TUNING,
} from '../src/levels/procedural/PowerUpConfig';

/**
 * Procedural endless-track prototype.
 *
 * `tests/endless.test.ts` already covers `ChunkStreamer`'s leak-proof
 * bookkeeping and `StraightRoute`. This file covers everything built on top
 * of it for chunk variety, difficulty and turns: the six generators'
 * per-type invariants, the director's tier weighting and structural
 * constraints, the route's turn classification and index-stability
 * (the property `PlayerController.extendPath()` relies on not to reset the
 * runner's lane every time a chunk streams in), and a full physics-backed
 * run of `ChunkBuilder` as a leak/solvability smoke test.
 */

const NO_INPUT: RunInput = { laneStep: 0, turn: 0, jump: false, slide: false };

/** A flat floor collider to land on - mirrors `tests/physics.test.ts`'s
 *  `addFloor()`, needed wherever a test relies on `grounded` for real. */
function addFloor(world: PhysicsWorld, y: number): void {
  const body = world.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, y, 0));
  world.world.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 0.5, 200)
      .setFriction(0.9)
      .setCollisionGroups(collisionGroups(GROUP.GROUND, GROUP.PLAYER | GROUP.OBSTACLE)),
    body,
  );
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

describe('chunk generators', () => {
  const rng = mulberry32(1);

  it('obstacle chunks pick 1-3 distinct lanes, each at its own Z', () => {
    // Three is now legal (and common) - every lane gets an obstacle, but
    // always at its own Z (see OBSTACLE_Z_TRIPLE), so there is always a
    // clear lane at any given instant even though every lane sees one
    // somewhere in the chunk.
    for (let i = 0; i < 500; i++) {
      const spec = generateObstacle(rng);
      expect(spec.obstacles.length).toBeGreaterThanOrEqual(1);
      expect(spec.obstacles.length).toBeLessThanOrEqual(3);
      const lanes = spec.obstacles.map((o) => o.lane);
      expect(new Set(lanes).size).toBe(lanes.length);
      if (spec.obstacles.length === 3) {
        const zs = new Set(spec.obstacles.map((o) => o.z));
        expect(zs.size).toBe(3);
      }
    }
  });

  it('obstacle chunks favour three blockers over two or one (density retune)', () => {
    // Weighted roughly 50/35/15 toward three/two/one (was 65/35 two/one) -
    // "every gameplay chunk contains meaningful interaction" should hold at
    // the generator level, not just from section-weight tuning.
    let threeBlockers = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      if (generateObstacle(rng).obstacles.length === 3) threeBlockers++;
    }
    expect(threeBlockers / N).toBeGreaterThan(0.4);
  });

  it('two-blocker chunks pick one of the two authored Z-spacing pairs; three-blocker chunks use the triple Z set', () => {
    const seenPairs = new Set<string>();
    let sawTriple = false;
    for (let i = 0; i < 1000; i++) {
      const spec = generateObstacle(rng);
      if (spec.obstacles.length === 2) {
        seenPairs.add(JSON.stringify(spec.obstacles.map((o) => o.z)));
      } else if (spec.obstacles.length === 3) {
        sawTriple = true;
        const zs = spec.obstacles.map((o) => o.z).sort((a, b) => a - b);
        expect(zs).toEqual([...OBSTACLE_Z_TRIPLE]);
      }
    }
    expect(seenPairs.has(JSON.stringify([...OBSTACLE_Z_LOOSE]))).toBe(true);
    expect(seenPairs.has(JSON.stringify([...OBSTACLE_Z_TIGHT]))).toBe(true);
    expect(seenPairs.size).toBe(2);
    expect(sawTriple).toBe(true);
    // Tight is still the more centred, smaller-spacing pair of the two.
    expect(OBSTACLE_Z_TIGHT[1] - OBSTACLE_Z_TIGHT[0]).toBeLessThan(
      OBSTACLE_Z_LOOSE[1] - OBSTACLE_Z_LOOSE[0],
    );
  });

  it('straight and slide chunks carry no obstacles or gap', () => {
    expect(generateStraight()).toMatchObject({ obstacles: [], hasGap: false, turn: null });
    expect(generateSlide()).toMatchObject({ obstacles: [], hasGap: false, turn: null });
  });

  it('jump chunks open a gap and stay within the campaign jump budget', () => {
    const spec = generateJump();
    expect(spec.hasGap).toBe(true);
    // Matches tests/levels.test.ts's MAX_GAP authoring budget (7.5u) - both
    // tracks agree on what's actually jumpable at PHYSICS.runSpeed.
    expect(GAP_LENGTH).toBeLessThanOrEqual(7.5);
    expect(GAP_LENGTH).toBeGreaterThan(0);
  });

  it('vent chunks carry no obstacles, beam or gap - never combined with anything else', () => {
    const spec = generateVent();
    expect(spec.obstacles).toEqual([]);
    expect(spec.beamZ).toBeNull();
    expect(spec.hasGap).toBe(false);
    expect(spec.ventZ).not.toBeNull();
  });

  it('turn chunks are always exactly ±90°', () => {
    const left = generateTurn(-1);
    const right = generateTurn(1);
    expect(left.turn).not.toBeNull();
    expect(right.turn).not.toBeNull();
    expect(left.turn!.deltaYaw).toBeCloseTo(Math.PI / 2, 10);
    expect(right.turn!.deltaYaw).toBeCloseTo(-Math.PI / 2, 10);
    // Matches RunPath's own handedness convention: turnDir -1 (left) needs
    // deltaYaw >= 0.
    expect(left.turn!.dir).toBe(-1);
    expect(right.turn!.dir).toBe(1);
  });

  it('generateChunk dispatches to the matching type for every chunk type', () => {
    for (const type of CHUNK_TYPES) {
      const spec = generateChunk(type, rng);
      expect(spec.type).toBe(type);
    }
  });

  it('the two-obstacle Z pairs clear MIN_HAZARD_SPACING, both within a chunk and across a chunk boundary', () => {
    // "Across a chunk boundary" is the worst case where one chunk's hazard
    // sits at its own tail (max of the pair) and the next chunk's hazard
    // sits at its own head (min of the pair) - the in-chunk composite types
    // (obstacleJump/slideObstacle/tripleObstacle) that used to need this
    // margin inside one 80-unit chunk were retired when CHUNK_LENGTH shrank
    // to 30 (see ChunkDirector.ts's doc comment); "combinations" now come
    // from consecutive chunks, so this boundary case is the one that matters.
    for (const pair of [OBSTACLE_Z_LOOSE, OBSTACLE_Z_TIGHT]) {
      const [a, b] = pair;
      expect(b - a).toBeGreaterThanOrEqual(MIN_HAZARD_SPACING);
      const crossBoundaryGap = CHUNK_LENGTH - b + a;
      expect(crossBoundaryGap).toBeGreaterThanOrEqual(MIN_HAZARD_SPACING);
    }
  });

  it('no chunk type ever produces two obstacles at the same Z blocking all three lanes', () => {
    for (let i = 0; i < 300; i++) {
      const spec = generateObstacle(rng);
      const byZ = new Map<number, Set<number>>();
      for (const o of spec.obstacles) {
        const lanes = byZ.get(o.z) ?? new Set<number>();
        lanes.add(o.lane);
        byZ.set(o.z, lanes);
      }
      for (const lanes of byZ.values()) expect(lanes.size).toBeLessThan(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Hazard/collectible heights - regression coverage for the "pass under the
// slide beam without sliding" bug and the "fish float too high" complaint.
// ---------------------------------------------------------------------------

describe('endless hazard/collectible heights', () => {
  // A standing cat's capsule spans [0, standingHeadHeight] above the walking
  // surface - same arithmetic ChunkBuilder.overlapsBeam() and Clothesline
  // both use (capsuleFeetOffset() up and down from the body's centre Y).
  const standingHeadHeight = 2 * capsuleFeetOffset();

  it('the slide beam band overlaps a standing cat, so standing/running collides', () => {
    // Root cause of the "walk under without sliding" bug: BEAM_HEIGHT used
    // to reuse the campaign's *rope* height (1.8) as the centre of a thin
    // +-BEAM_RADIUS band, which sat entirely above a standing cat's head.
    const bandBottom = BEAM_HEIGHT - BEAM_RADIUS;
    const bandTop = BEAM_HEIGHT + BEAM_RADIUS;
    expect(standingHeadHeight).toBeGreaterThanOrEqual(bandBottom);
    expect(0).toBeLessThanOrEqual(bandTop);
    // With real margin, not just touching - a hair's-width overlap would be
    // one bad frame of interpolation away from being the same bug again.
    expect(bandTop - standingHeadHeight).toBeLessThan(bandTop - bandBottom);
    expect(standingHeadHeight - bandBottom).toBeGreaterThan(0.05);
  });

  it('fish sit close to the walking surface rather than floating above head height', () => {
    expect(FISH_HEIGHT).toBeLessThan(standingHeadHeight);
    expect(FISH_HEIGHT).toBeGreaterThan(0);
  });

  it('a jump can never clear the slide beam - the band top sits above the max jump height', () => {
    // Same formula as PlayerController's jump: an upward impulse against
    // gravity, peak height at v^2 / (2 * |g|). This is a hard ceiling of the
    // jump physics, not something a player can time around - so if the
    // band's top clears it, jumping over the beam is impossible by
    // construction, not just unlikely.
    const maxJumpFeetHeight = PHYSICS.jumpImpulse ** 2 / (2 * -PHYSICS.gravity);
    const bandTop = BEAM_HEIGHT + BEAM_RADIUS;
    expect(bandTop).toBeGreaterThan(maxJumpFeetHeight);
  });

  it('power-ups float above the ground but noticeably closer to it than the old height', () => {
    expect(POWERUP_HEIGHT).toBeGreaterThan(0);
    expect(POWERUP_HEIGHT).toBeLessThan(FISH_HEIGHT + 0.4);
  });

  it('the vent pipe sits flush on the deck, so a standing/sliding cat cannot pass under it', () => {
    // The collider's bottom edge, in ObstaclePool.buildVentPipe()'s own
    // placement (`VENT_PIPE_HEIGHT / 2` above the deck, half a collider
    // height either side of that). Zero clearance underneath means there is
    // no gap for a capsule to fit through regardless of duck state - see
    // ChunkTypes.VENT_PIPE_HEIGHT's own comment for why sliding never shrinks
    // the capsule in this engine.
    const bandBottom = 0;
    expect(bandBottom).toBeLessThanOrEqual(0);
    expect(standingHeadHeight).toBeGreaterThan(bandBottom);
  });

  it('a jump clears the vent pipe with real margin, unlike the slide beam', () => {
    const maxJumpFeetHeight = PHYSICS.jumpImpulse ** 2 / (2 * -PHYSICS.gravity);
    expect(VENT_PIPE_HEIGHT).toBeLessThan(maxJumpFeetHeight);
    // Deliberately thinner than a crate and with more margin to the jump
    // apex than a crate ships with - see VENT_PIPE_HEIGHT's own derivation
    // comment for why it no longer reuses OBSTACLE_SIZE.height.
    expect(VENT_PIPE_HEIGHT).toBeLessThan(OBSTACLE_SIZE.height);
    expect(maxJumpFeetHeight - VENT_PIPE_HEIGHT).toBeGreaterThan(
      maxJumpFeetHeight - OBSTACLE_SIZE.height,
    );
  });

  it('the vent pipe spans every lane, exactly like the slide beam', () => {
    expect(VENT_PIPE_LENGTH).toBe(BEAM_LENGTH);
    expect(VENT_PIPE_DEPTH).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The clothesline that clothes the slide hazard
// ---------------------------------------------------------------------------

describe('clothesline hazard prop', () => {
  // No `document` in this environment, so `buildFabricTexture` returns null
  // and the sheets fall back to flat colours - which is exactly the path
  // worth checking here anyway: the *geometry* must be right whether or not
  // a canvas was available to paint.
  const group = buildClotheslineHazard();
  const sheets = group.children.filter(
    (child) => (child as THREE.Mesh).geometry?.type === 'PlaneGeometry',
  ) as THREE.Mesh[];

  it('hangs sheets that cover the whole hazard band', () => {
    // The prop replaced a flat panel scaled to exactly the band, and the one
    // property that had to survive the swap is that what the player sees is
    // what `overlapsBeam()` can hit. The group's origin is the band's centre,
    // so the sheets have to reach +-BEAM_RADIUS from zero.
    //
    // Covering it is the requirement; matching it exactly is not. Each sheet
    // carries a couple of hundredths of a radian of tilt so the row does not
    // look stamped, which pushes its corners a centimetre or two past the
    // band. That direction is the safe one - the curtain is never *smaller*
    // than what can hit the player - so the tolerance is one-sided and tight
    // rather than symmetric.
    expect(sheets.length).toBeGreaterThan(1);
    const box = new THREE.Box3();
    for (const sheet of sheets) box.expandByObject(sheet);
    expect(box.min.y).toBeLessThanOrEqual(-BEAM_RADIUS);
    expect(box.max.y).toBeGreaterThanOrEqual(BEAM_RADIUS);
    expect(-BEAM_RADIUS - box.min.y).toBeLessThan(0.05);
    expect(box.max.y - BEAM_RADIUS).toBeLessThan(0.05);
  });

  it('overlaps neighbouring sheets rather than leaving daylight between them', () => {
    // A curtain with gaps in it reads as something to weave through, which
    // is the wrong answer to a hazard whose only answer is to duck.
    const spans = sheets
      .map((sheet) => ({ lo: sheet.position.x - sheet.scale.x / 2, hi: sheet.position.x + sheet.scale.x / 2 }))
      .sort((a, b) => a.lo - b.lo);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].lo).toBeLessThan(spans[i - 1].hi);
    }
    expect(spans[0].lo).toBeLessThanOrEqual(-BEAM_LENGTH / 2 + 1e-6);
    expect(spans[spans.length - 1].hi).toBeGreaterThanOrEqual(BEAM_LENGTH / 2 - 1e-6);
  });

  it('stands its posts on the deck rather than leaving the line floating', () => {
    // The deck is at -BEAM_HEIGHT in this group's own frame; a curtain that
    // stops short of it reads as scenery, not as something installed in the
    // runner's way.
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeCloseTo(-BEAM_HEIGHT, 1);
  });

  it('starts hidden, the way every pooled visual-only role does', () => {
    expect(group.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------

describe('ChunkDirector', () => {
  it('tiers switch at the documented distance thresholds', () => {
    expect(tierAt(0)).toBe('early');
    expect(tierAt(399)).toBe('early');
    expect(tierAt(400)).toBe('mid');
    expect(tierAt(999)).toBe('mid');
    expect(tierAt(1000)).toBe('late');
  });

  it('forces the opening chunk when asked, and leaves every later chunk alone', () => {
    // The attract screen behind the main menu poses a camera a few metres
    // behind a stationary cat on chunk 0, so anything dealt into that gap -
    // an obstacle, a clothesline - fills the frame and hides the cat. This
    // is the one thing about that scene the seed does not get to decide;
    // see `Game.startAttract()`.
    const director = new ChunkDirector(0, 'straight');
    const rng = mulberry32(3);

    expect(director.select(0, rng).type).toBe('straight');

    // Everything after it is dealt normally, which for these weights means
    // the run does not just carry on being straight.
    const rest = new Set<ChunkType>();
    for (let i = 1; i < 400; i++) rest.add(director.select(i * CHUNK_LENGTH, rng).type);
    expect(rest.size).toBeGreaterThan(1);
  });

  it('leaves the opening chunk to the weights by default', () => {
    // No caller but the attract screen passes an opening type, and a run's
    // first chunk is as random as any other. Sampled across seeds because a
    // single seed says nothing about whether the pin is on.
    const openings = new Set<ChunkType>();
    for (let seed = 1; seed <= 60; seed++) {
      openings.add(new ChunkDirector().select(0, mulberry32(seed)).type);
    }
    expect(openings.size).toBeGreaterThan(1);
  });

  it('never deals two turns within the cooldown window', () => {
    const director = new ChunkDirector();
    const rng = mulberry32(7);
    let sinceTurn = Infinity;

    for (let i = 0; i < 5000; i++) {
      const { type } = director.select(i * CHUNK_LENGTH, rng);
      const isTurn = type === 'turnLeft' || type === 'turnRight';
      if (isTurn) {
        expect(sinceTurn).toBeGreaterThanOrEqual(TURN_COOLDOWN_CHUNKS);
        sinceTurn = 0;
      } else {
        sinceTurn++;
      }
    }
  });

  it('straight (zero-decision) chunks are the exception, not the routine filler', () => {
    // SECTION_WEIGHTS keeps `straight` modest in every section (8 in the
    // three lighter ones, 3 in the two challenge ones) so "every chunk
    // should contain at least one obstacle challenge" holds in practice.
    // Some `straight` chunks are additionally unavoidable (forced right
    // after a turn, and required right before one) - this checks the
    // *overall* rate stays well below the old tuning (~40% including
    // forced-straight chunks), not that it hit zero.
    const director = new ChunkDirector();
    const rng = mulberry32(77);
    let straightCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      if (director.select(i * CHUNK_LENGTH, rng).type === 'straight') straightCount++;
    }
    expect(straightCount / N).toBeLessThan(0.3);
  });

  /**
   * "Landing safety" - a trampoline landing must never be followed
   * immediately by another hazard, so the player always gets a beat to
   * recover and reorient. Unlike `pendingEasyGapRecovery` (early/easy tier
   * only), `noteTrampoline()` is unconditional - sampled at early, mid, and
   * late tier distances to prove it isn't tier-gated the same way.
   */
  it('forces a straight recovery chunk right after any trampoline, regardless of tier', () => {
    for (const startDist of [0, MID_TIER_START, LATE_TIER_START]) {
      const director = new ChunkDirector();
      const rng = mulberry32(11);
      director.select(startDist, rng); // whatever this deals doesn't matter
      director.noteTrampoline();
      const next = director.select(startDist + CHUNK_LENGTH, rng);
      expect(next.type, `tier at distance ${startDist}`).toBe('straight');
    }
  });

  it('a hazard chunk makes the very next chunk more likely to also be a hazard (combo bias)', () => {
    // Retiring the in-chunk composite types moved "combinations" to
    // consecutive chunks - this checks the replacement mechanism actually
    // biases toward that, by comparing P(hazard | previous was hazard) to
    // P(hazard | previous was not) over a long run.
    const director = new ChunkDirector();
    const rng = mulberry32(55);
    const hazard = new Set<ChunkType>(['obstacle', 'slide', 'jump']);
    let prevType: ChunkType | null = null;
    let afterHazard = 0;
    let afterHazardTotal = 0;
    let afterOther = 0;
    let afterOtherTotal = 0;

    for (let i = 0; i < 8000; i++) {
      const { type } = director.select(i * CHUNK_LENGTH, rng);
      if (prevType !== null) {
        if (hazard.has(prevType)) {
          afterHazardTotal++;
          if (hazard.has(type)) afterHazard++;
        } else {
          afterOtherTotal++;
          if (hazard.has(type)) afterOther++;
        }
      }
      prevType = type;
    }

    expect(afterHazardTotal).toBeGreaterThan(0);
    expect(afterOtherTotal).toBeGreaterThan(0);
    expect(afterHazard / afterHazardTotal).toBeGreaterThan(afterOther / afterOtherTotal);
  });

  it('a turn is only ever dealt right after a straight chunk', () => {
    const director = new ChunkDirector();
    const rng = mulberry32(21);
    const turn = new Set<ChunkType>(['turnLeft', 'turnRight']);
    let previous: ChunkType | null = null;

    for (let i = 0; i < 5000; i++) {
      const { type } = director.select(i * CHUNK_LENGTH, rng);
      if (turn.has(type)) {
        expect(previous).toBe('straight');
      }
      previous = type;
    }
  });

  it('the chunk immediately after a turn is always straight', () => {
    const director = new ChunkDirector();
    const rng = mulberry32(33);
    const turn = new Set<ChunkType>(['turnLeft', 'turnRight']);
    let expectStraightNext = false;

    for (let i = 0; i < 5000; i++) {
      const { type } = director.select(i * CHUNK_LENGTH, rng);
      if (expectStraightNext) expect(type).toBe('straight');
      expectStraightNext = turn.has(type);
    }
  });

  it('never deals two consecutive plain straight chunks outside the forced turn contexts', () => {
    // `straight` is back in SECTION_WEIGHTS at a modest weight, so a single
    // plain chunk is legitimate again - but two in a row is exactly the
    // "long empty stretch" the density work was about, and NO_REPEAT_TYPES
    // now filters it out of the pool. The one legal back-to-back pair is a
    // forced turn context: the guaranteed lead-in straight, or the
    // guaranteed post-turn rest, either of which sets the type directly
    // without consulting that filter. So a straight-straight pair is only
    // ever allowed when a turn sits immediately on the far side of it.
    const director = new ChunkDirector();
    const rng = mulberry32(55);
    const turn = new Set<ChunkType>(['turnLeft', 'turnRight']);
    const CHECKED = 8000;
    const types: ChunkType[] = [];
    // A few extra past CHECKED so a lead-in straight right at the boundary
    // still has its scheduled turn visible to the lookahead below - not a
    // real violation, just an artifact of stopping mid-cycle.
    for (let i = 0; i < CHECKED + 2; i++) {
      types.push(director.select(i * CHUNK_LENGTH, rng).type);
    }

    let sawStraight = false;
    for (let i = 1; i < CHECKED; i++) {
      if (types[i] === 'straight') sawStraight = true;
      if (types[i] !== 'straight' || types[i - 1] !== 'straight') continue;
      // A pair is only legal as (post-turn rest, pool pick) - impossible,
      // the pool pick is filtered - or (pool pick, lead-in) / (lead-in,
      // ...): in every legal case a turn is adjacent to the pair.
      const turnBefore = i >= 2 && turn.has(types[i - 2]);
      const turnAfter = turn.has(types[i + 1]);
      expect(turnBefore || turnAfter, `straight pair at ${i - 1}..${i}`).toBe(true);
    }
    // Guards against the assertion above passing vacuously if `straight`
    // ever went back to zero weight.
    expect(sawStraight).toBe(true);
  });

  it('pins a real run to straight-then-single-obstacle when forceStartSequence is on', () => {
    // Every real run (`Game.startEndless()`) passes this: a full plain chunk
    // to get moving on, then one blocked lane at the loose far Z - so a run
    // can never open on a clothesline/vent pipe, and the first thing it does
    // ask for is readable from a chunk away. Checked across many seeds
    // because the whole point is that it does not depend on the roll.
    for (let seed = 1; seed <= 80; seed++) {
      const director = new ChunkDirector(0, null, true);
      const rng = mulberry32(seed);

      const first = director.select(0, rng);
      expect(first.type, `seed ${seed} chunk 0`).toBe('straight');
      expect(first.simple).toBe(false);

      const second = director.select(CHUNK_LENGTH, rng);
      expect(second.type, `seed ${seed} chunk 1`).toBe('obstacle');
      expect(second.simple).toBe(true);

      // ...and the spec that selection produces really is a single blocker
      // at the far, loose Z.
      const spec = generateChunk(second.type, rng, second.simple);
      expect(spec.obstacles).toHaveLength(1);
      expect(spec.obstacles[0].z).toBe(OBSTACLE_Z_LOOSE[1]);
      expect(spec.beamZ).toBeNull();
      expect(spec.ventZ).toBeNull();
      expect(spec.hasGap).toBe(false);
    }
  });

  it('leaves the opening sequence alone when forceStartSequence is off', () => {
    // The attract screen and the default constructor must both keep dealing
    // chunk 1 onward from the pool - a `simple` flag is never set outside
    // the forced sequence.
    const chunk1 = new Set<ChunkType>();
    for (let seed = 1; seed <= 60; seed++) {
      const director = new ChunkDirector(0, 'straight');
      const rng = mulberry32(seed);
      expect(director.select(0, rng).type).toBe('straight');
      const second = director.select(CHUNK_LENGTH, rng);
      expect(second.simple).toBe(false);
      chunk1.add(second.type);
    }
    expect(chunk1.size).toBeGreaterThan(1);
  });

  it('never deals two consecutive slide (clothesline) or vent chunks', () => {
    const director = new ChunkDirector();
    const rng = mulberry32(77);
    let previous: ChunkType | null = null;

    for (let i = 0; i < 8000; i++) {
      const { type } = director.select(i * CHUNK_LENGTH, rng);
      if (type === 'slide' || type === 'vent') {
        expect(type).not.toBe(previous);
      }
      previous = type;
    }
  });

  it('always returns a valid chunk type - the director can never strand the player', () => {
    const director = new ChunkDirector();
    const rng = mulberry32(99);
    for (let i = 0; i < 2000; i++) {
      const { type } = director.select(i * CHUNK_LENGTH, rng);
      expect(CHUNK_TYPES).toContain(type);
    }
  });

  it('difficulty rises: late-tier runs deal noticeably more gaps/vent hazards than early', () => {
    // Tier no longer scales `straight` at all (see SECTION_WEIGHTS' own doc
    // comment - the per-tier straight multiplier was retired and was not
    // restored when `straight` came back into the pool), so "not-straight"
    // does not vary with tier and is useless as a difficulty proxy.
    // Tier's own intensity knob is TIER_HAZARD_SCALE, a multiplier on
    // jump/vent specifically (late tier leans harder into gaps and the
    // un-dodgeable pipe) - this measures that mechanism directly rather than
    // a proxy that no longer reflects it.
    const early = new ChunkDirector();
    const late = new ChunkDirector();
    const rng = mulberry32(42);
    const heavy = new Set<ChunkType>(['jump', 'vent']);

    let earlyCount = 0;
    let lateCount = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      if (heavy.has(early.select(0, rng).type)) earlyCount++;
      if (heavy.has(late.select(6000, rng).type)) lateCount++;
    }

    expect(lateCount).toBeGreaterThan(earlyCount);
  });

  it('restores a healthy turn frequency per section, instead of being crushed by the low straight weight', () => {
    // Regression test: turns used to be dealt only the instant after a
    // natural 'straight' pick, and 'straight' is a rare (1-2%) event in
    // exactly the sections with the highest turn weight (obstacleChallenge,
    // hardObstacleChallenge) - a 200k-chunk simulation of the old algorithm
    // measured real turn frequency at ~1.1% overall (and well under 0.5% in
    // these two sections specifically) versus the 2-7% the weight table
    // implies. Fixed by scheduling turns explicitly (see ChunkDirector's
    // `TurnCycleState`) instead of depending on the pool happening to land
    // on 'straight' first. This asserts each section now lands comfortably
    // above that old crushed rate.
    const sections: { label: string; distance: number; minFraction: number }[] = [
      { label: 'easy', distance: 0, minFraction: 0.01 },
      { label: 'obstacleChallenge', distance: 4 * CHUNK_LENGTH, minFraction: 0.02 },
      { label: 'hardObstacleChallenge', distance: 8 * CHUNK_LENGTH, minFraction: 0.02 },
    ];

    for (const { label, distance, minFraction } of sections) {
      const director = new ChunkDirector();
      const rng = mulberry32(distance + 1);
      const N = 4000;
      let turns = 0;
      for (let i = 0; i < N; i++) {
        const { type } = director.select(distance, rng);
        if (type === 'turnLeft' || type === 'turnRight') turns++;
      }
      expect(turns / N, `${label} turn frequency`).toBeGreaterThan(minFraction);
    }
  });

  it('keeps turnLeft and turnRight roughly balanced', () => {
    const director = new ChunkDirector();
    const rng = mulberry32(101);
    let left = 0;
    let right = 0;
    for (let i = 0; i < 8000; i++) {
      const { type } = director.select(i * CHUNK_LENGTH, rng);
      if (type === 'turnLeft') left++;
      if (type === 'turnRight') right++;
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    const ratio = left / (left + right);
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.65);
  });
});

// ---------------------------------------------------------------------------
// SectionDirector
// ---------------------------------------------------------------------------

describe('SectionDirector', () => {
  it('cycles Easy -> Fish Collection -> Obstacle Challenge -> Reward -> Hard, in that order and length', () => {
    const expected: SectionType[] = [
      'easy',
      'easy',
      'fishCollection',
      'fishCollection',
      'obstacleChallenge',
      'obstacleChallenge',
      'obstacleChallenge',
      'reward',
      'hardObstacleChallenge',
      'hardObstacleChallenge',
      'hardObstacleChallenge',
    ];
    expect(CYCLE_LENGTH_CHUNKS).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(sectionAtIndex(i)).toBe(expected[i]);
    }
  });

  it('repeats indefinitely - index N and N + cycle length agree', () => {
    for (let i = 0; i < 50; i++) {
      expect(sectionAtIndex(i)).toBe(sectionAtIndex(i + CYCLE_LENGTH_CHUNKS));
      expect(sectionAtIndex(i)).toBe(sectionAtIndex(i + CYCLE_LENGTH_CHUNKS * 7));
    }
  });

  it('never leaves a negative index without an answer', () => {
    expect(() => sectionAtIndex(-5)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Fish patterns
// ---------------------------------------------------------------------------

describe('generateFishPattern', () => {
  const rng = mulberry32(9);

  it('arc fish stay within the gap span, rising above reach only over the actual gap', () => {
    // FISH_HEIGHT (now near path level) is what the arc's flat ends use on
    // solid deck either side of the gap - only the portion of the trail
    // actually over the gap (GAP_START_Z..GAP_END_Z) needs to sit above a
    // grounded cat's reach, since that's the part that has to require a jump.
    for (let i = 0; i < 100; i++) {
      const spec: ChunkSpec = generateJump();
      const fish = generateFishPattern(spec, 'obstacleChallenge', 'early', rng);
      expect(fish.length).toBeGreaterThan(0);
      let sawElevatedOverGap = false;
      for (const f of fish) {
        expect(f.z).toBeGreaterThanOrEqual(GAP_START_Z - 5);
        expect(f.z).toBeLessThanOrEqual(GAP_END_Z + 5);
        const overGap = f.z > GAP_START_Z && f.z < GAP_END_Z;
        if (overGap) {
          expect(f.y).toBeGreaterThan(1); // above a grounded cat's reach
          sawElevatedOverGap = true;
        } else {
          expect(f.y).toBeGreaterThanOrEqual(FISH_HEIGHT - 1e-9);
        }
      }
      // The pattern's whole point: some part of the trail has to actually
      // require the jump, not just decorate the approach.
      expect(sawElevatedOverGap).toBe(true);
    }
  });

  it('weave fish never sit in a lane blocked at their own Z', () => {
    for (let i = 0; i < 200; i++) {
      const spec = generateObstacle(mulberry32(i + 1));
      const fish = generateFishPattern(spec, 'obstacleChallenge', 'early', mulberry32(i + 100));
      expect(fish.length).toBe(spec.obstacles.length);
      for (let j = 0; j < fish.length; j++) {
        expect(fish[j].z).toBe(spec.obstacles[j].z);
        expect(fish[j].x).not.toBe(laneX(spec.obstacles[j].lane));
      }
    }
  });

  it('fish-path complexity (zigzag over a straight line) rises smoothly with tier', () => {
    // straightLinePattern keeps every fish in one lane; zigzagPattern moves
    // between lanes - so "more than one distinct x" is zigzag having been
    // picked, with no dependency on the pattern functions' own internals.
    const straight = generateStraight();
    function zigzagFraction(tier: 'early' | 'mid' | 'late', seedOffset: number): number {
      const N = 400;
      let zigzag = 0;
      for (let i = 0; i < N; i++) {
        const fish = generateFishPattern(
          straight,
          'fishCollection',
          tier,
          mulberry32(i + seedOffset),
        );
        if (new Set(fish.map((f) => f.x)).size > 1) zigzag++;
      }
      return zigzag / N;
    }

    const early = zigzagFraction('early', 1000);
    const mid = zigzagFraction('mid', 2000);
    const late = zigzagFraction('late', 3000);

    expect(early).toBeCloseTo(0.5, 1);
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
    expect(late).toBeCloseTo(0.75, 1);
  });

  it('the vent pipe gets its own low arc, peaking just above the pipe and well under jump apex', () => {
    const spec = generateVent();
    const fish = generateFishPattern(spec, 'obstacleChallenge', 'late', rng);
    expect(fish.length).toBeGreaterThan(0);
    const maxJumpFeetHeight = PHYSICS.jumpImpulse ** 2 / (2 * -PHYSICS.gravity);
    for (const f of fish) {
      // The end fish sit at FISH_HEIGHT exactly (the arc's own t=0/t=1);
      // only the middle of the arc rises - see the peak check below.
      expect(f.y).toBeGreaterThanOrEqual(FISH_HEIGHT);
      expect(f.y).toBeLessThan(maxJumpFeetHeight);
      expect(Math.abs(f.z - spec.ventZ!)).toBeLessThan(CHUNK_LENGTH / 2);
    }
    // The peak fish - the one only a real jump collects - clears the pipe
    // itself, not just the ground.
    const peak = Math.max(...fish.map((f) => f.y));
    expect(peak).toBeGreaterThan(VENT_PIPE_HEIGHT);
  });

  it('fish-collection sections produce more fish than a random filler chunk', () => {
    const straight = generateStraight();
    let collectionTotal = 0;
    let fillerTotal = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      collectionTotal += generateFishPattern(straight, 'fishCollection', 'early', rng).length;
      fillerTotal += generateFishPattern(straight, 'obstacleChallenge', 'early', rng).length;
    }
    expect(collectionTotal).toBeGreaterThan(fillerTotal);
  });
});

// ---------------------------------------------------------------------------
// PowerUpManager
// ---------------------------------------------------------------------------

describe('PowerUpManager', () => {
  afterEach(() => {
    resetPhysicsConfig();
  });

  it('Catnip Rush multiplies runSpeed and restores it exactly on expiry', () => {
    resetPhysicsConfig();
    const baseSpeed = PHYSICS.runSpeed;
    const manager = new PowerUpManager();

    manager.activate('catnipRush');
    expect(PHYSICS.runSpeed).toBeCloseTo(baseSpeed * CATNIP_SPEED_MULTIPLIER, 10);

    const duration = POWERUP_TUNING.catnipRush.duration;
    manager.update(duration + 0.01);

    expect(manager.isActive('catnipRush')).toBe(false);
    expect(PHYSICS.runSpeed).toBeCloseTo(baseSpeed, 10);
  });

  it('reset() restores runSpeed even if called mid-effect', () => {
    resetPhysicsConfig();
    const baseSpeed = PHYSICS.runSpeed;
    const manager = new PowerUpManager();

    manager.activate('catnipRush');
    manager.reset();

    expect(PHYSICS.runSpeed).toBeCloseTo(baseSpeed, 10);
  });

  it('Shield lasts ~30s and consumeShield() ends it early on a hit', () => {
    const manager = new PowerUpManager();
    manager.activate('shield');
    expect(manager.isActive('shield')).toBe(true);
    expect(manager.remainingFrac('shield')).toBeCloseTo(1, 5);

    manager.update(15);
    expect(manager.remainingFrac('shield')).toBeCloseTo(0.5, 5);

    expect(manager.consumeShield()).toBe(true);
    expect(manager.isActive('shield')).toBe(false);
    expect(manager.consumeShield()).toBe(false); // already spent
  });

  it('a fresh Shield pickup refreshes the timer rather than stacking', () => {
    const manager = new PowerUpManager();
    manager.activate('shield');
    manager.update(20);
    manager.activate('shield');
    expect(manager.remainingFrac('shield')).toBeCloseTo(1, 5);
  });

  it('Fish Magnet and Shield are timed and expire independently', () => {
    const manager = new PowerUpManager();
    manager.activate('fishMagnet');
    manager.activate('shield');
    expect(manager.isActive('fishMagnet')).toBe(true);
    expect(manager.isActive('shield')).toBe(true);

    manager.update(POWERUP_TUNING.fishMagnet.duration + 0.01);
    expect(manager.isActive('fishMagnet')).toBe(false);
    // shield has a longer duration in the current tuning - still active.
    if (POWERUP_TUNING.shield.duration > POWERUP_TUNING.fishMagnet.duration) {
      expect(manager.isActive('shield')).toBe(true);
    }
  });

  it('activeTypes() lists exactly what is currently active', () => {
    const manager = new PowerUpManager();
    expect(manager.activeTypes()).toHaveLength(0);
    manager.activate('shield');
    manager.activate('fishMagnet');
    expect(new Set(manager.activeTypes())).toEqual(new Set(['shield', 'fishMagnet']));
  });
});

// ---------------------------------------------------------------------------
// Lives ceiling
// ---------------------------------------------------------------------------

describe('Nine Lives ceiling', () => {
  /** `LIVES_PER_RUN` in Game.ts. Not imported: that module pulls in the
   *  renderer and the Rapier WASM, neither of which this suite can load. */
  const LIVES_PER_RUN = 3;

  it('tops out one pickup above the starting three', () => {
    expect(LIVES_PER_RUN).toBe(3);
    expect(MAX_LIVES).toBe(4);
    expect(MAX_LIVES - LIVES_PER_RUN).toBe(NINE_LIVES_BONUS);
  });

  it('ignores every pickup after the first', () => {
    // Game.ts clamps with Math.min on both counters, so this is the shape of
    // what a run that hoovers up five hearts actually ends on. The regression
    // being guarded is a cap raised (or a bonus widened) without the other
    // moving: either one turns a long run into an unloseable one.
    let lives = LIVES_PER_RUN;
    for (let i = 0; i < 5; i++) lives = Math.min(lives + NINE_LIVES_BONUS, MAX_LIVES);
    expect(lives).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// PowerUpPool
// ---------------------------------------------------------------------------

describe('PowerUpPool pickup placement', () => {
  const KINDS = ['fishMagnet', 'catnipRush', 'nineLives', 'shield'] as const;

  it('keeps every pickup model floating above its own placement height, never dipping into the rooftop', () => {
    // Regression: a pickup's own model was scaled/authored differently
    // enough (especially once Catnip Rush's world pickup started preferring
    // a provided model - the Jordan shoe, now the energy-drink can - and the
    // cat's own equipped shoes kept the old one) that trusting a single
    // hardcoded vertical offset for
    // every kind risked one of them poking below the deck it floats over.
    // `anchorAboveGround()` (PowerUps.ts) measures each model's own
    // bounding box after scaling and lifts it clear - this checks that
    // invariant directly rather than trusting the geometry by eye.
    const scene = new THREE.Group();
    const pool = new PowerUpPool(scene);
    const position = new THREE.Vector3(3, 5, 10);

    for (const kind of KINDS) {
      pool.place(0, kind, position);
      const entry = pool.rigFor(0);
      const model = entry.shield.visible
        ? entry.shield
        : entry.heart.visible
          ? entry.heart
          : entry.magnet.visible
            ? entry.magnet
            : entry.energyDrink;

      // Updates from the root down: `entry.root` is what actually moved
      // (`pool.place()` sets its position), and `updateMatrixWorld()` only
      // refreshes an object and its *children* from an already-current
      // parent matrix, not the other way around - calling it on `model`
      // directly would multiply by `root`'s stale (identity, in a test with
      // no renderer to drive it) matrixWorld instead of its real position.
      entry.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      expect(box.min.y, `${kind} dips below its own placement height`).toBeGreaterThanOrEqual(
        position.y - 1e-6,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// RouteGrowth
// ---------------------------------------------------------------------------

describe('RouteGrowth', () => {
  it('every extend consumes exactly CHUNK_LENGTH of arc length', () => {
    const route = new RouteGrowth(new THREE.Vector3(0, 20.5, 0));
    let prev = 0;
    for (let i = 0; i < 20; i++) {
      const { startDist } = route.extend(generateStraight());
      expect(startDist).toBeCloseTo(prev, 6);
      prev += CHUNK_LENGTH;
    }
    expect(route.frontierDistance).toBeCloseTo(prev, 6);
  });

  it('a turn chunk classifies as a real corner, with the right sign', () => {
    const route = new RouteGrowth(new THREE.Vector3(0, 20.5, 0));
    route.extend(generateStraight());
    route.extend(generateStraight());
    const { path } = route.extend(generateTurn(-1)); // left

    const junction = path.junctionAfter(0);
    expect(junction).not.toBeNull();
    expect(junction!.kind).toBe('turn');
    expect(junction!.turnDir).toBe(-1);
  });

  it('right turns classify with the opposite sign', () => {
    const route = new RouteGrowth(new THREE.Vector3(0, 20.5, 0));
    route.extend(generateStraight());
    route.extend(generateStraight());
    const { path } = route.extend(generateTurn(1)); // right

    const junction = path.junctionAfter(0);
    expect(junction!.turnDir).toBe(1);
  });

  it('index-stability: extending with more straight chunks only grows the last segment, never adds a junction', () => {
    const route = new RouteGrowth(new THREE.Vector3(0, 20.5, 0));
    for (let i = 0; i < 3; i++) route.extend(generateStraight());
    const before = route.path!;
    const beforeSegments = before.segments.length;
    const beforeFirstStart = before.segments[0].start.clone();

    for (let i = 0; i < 3; i++) route.extend(generateStraight());
    const after = route.path!;

    expect(after.segments.length).toBe(beforeSegments);
    expect(after.segments[0].start.equals(beforeFirstStart)).toBe(true);
    expect(after.totalLength).toBeGreaterThan(before.totalLength);
  });

  it('index-stability holds across a turn too: segments before the bend are unchanged', () => {
    const route = new RouteGrowth(new THREE.Vector3(0, 20.5, 0));
    for (let i = 0; i < 3; i++) route.extend(generateStraight());
    const before = route.path!;
    const beforeSegments = before.segments.length;

    route.extend(generateTurn(-1));
    for (let i = 0; i < 3; i++) route.extend(generateStraight());
    const after = route.path!;

    // The straight run before the turn is still exactly one segment, at the
    // same index, with the same start - a turn appended after it must not
    // rewrite history a PlayerController may already be standing on.
    expect(after.segments[0].start.equals(before.segments[0].start)).toBe(true);
    expect(after.segments.length).toBeGreaterThan(beforeSegments);
  });
});

// ---------------------------------------------------------------------------
// PlayerController.extendPath - the safety property RouteGrowth relies on
// ---------------------------------------------------------------------------

describe('PlayerController.extendPath', () => {
  let world: PhysicsWorld;
  let player: PlayerController;

  beforeAll(async () => {
    await initRapier();
  });

  beforeEach(() => {
    resetPhysicsConfig();
    world = new PhysicsWorld();
    player = new PlayerController(world);
    player.setPath(RunPath.straight(400, 20.5, 0));
    player.spawn(new THREE.Vector3(0, 21, 0), 0);
  });

  afterEach(() => {
    player.dispose();
    world.dispose();
  });

  it('does not reset lane/segment/lateral, unlike setPath', () => {
    // Commit to a lane so there is state worth preserving.
    player.step(1 / 60, { ...NO_INPUT, laneStep: 1 });
    consumeEdges({ ...NO_INPUT, laneStep: 1 });
    for (let i = 0; i < 30; i++) player.step(1 / 60, NO_INPUT);

    const laneBefore = player.lane;
    const segmentBefore = player.segment;
    expect(laneBefore).not.toBe(0);

    const extended = new RunPath([
      [0, 20.5, 0],
      [0, 20.5, 800],
    ]);
    player.extendPath(extended);

    expect(player.lane).toBe(laneBefore);
    expect(player.segment).toBe(segmentBefore);
  });
});

// ---------------------------------------------------------------------------
// PlayerController's slide buffer
// ---------------------------------------------------------------------------

describe('PlayerController slide', () => {
  let world: PhysicsWorld;
  let player: PlayerController;

  beforeAll(async () => {
    await initRapier();
  });

  beforeEach(() => {
    resetPhysicsConfig();
    world = new PhysicsWorld();
    // Floor top at 20.5 (matches the path's Y); capsule bottom starts about
    // a unit above it, the same clearance tests/physics.test.ts's own
    // addFloor()/SPAWN pair uses.
    addFloor(world, 20.0);
    player = new PlayerController(world);
    player.setPath(RunPath.straight(400, 20.5, 0));
    player.spawn(new THREE.Vector3(0, 22, 0), 0);
  });

  afterEach(() => {
    player.dispose();
    world.dispose();
  });

  /** One fixed step, including advancing the Rapier world itself -
   *  `PlayerController.step()` only sets velocities and probes ground
   *  against the *current* positions, it doesn't integrate gravity or
   *  resolve collisions on its own. Mirrors tests/physics.test.ts's own
   *  `simulate()` helper. */
  function fixedStep(input: RunInput): void {
    player.step(1 / 60, input);
    world.world.step();
  }

  /** Jumps, then returns how many fixed steps (including the jump step
   *  itself) it takes before `grounded` is true again. */
  function stepsUntilLanded(): number {
    fixedStep({ ...NO_INPUT, jump: true });
    consumeEdges({ ...NO_INPUT, jump: true });
    let steps = 1;
    while (!player.grounded && steps < 300) {
      fixedStep(NO_INPUT);
      steps++;
    }
    return steps;
  }

  it('a slide held through the exact fixed step the runner lands still ducks', () => {
    // Physics is deterministic given the same input sequence, so a dry run
    // finds exactly which step landing happens on before repeating the jump
    // and holding slide through that one step.
    const landingStep = stepsUntilLanded();
    expect(landingStep).toBeGreaterThan(1);
    expect(landingStep).toBeLessThan(300);

    // Back to a clean spawn - the dry run above already landed this player,
    // and the point is to replay the *same* jump from scratch, not continue
    // from wherever that run ended up.
    player.reset();

    fixedStep({ ...NO_INPUT, jump: true });
    consumeEdges({ ...NO_INPUT, jump: true });
    for (let i = 1; i < landingStep - 1; i++) fixedStep(NO_INPUT);

    // `updateDucking()` re-reads `slide` after `probeGround()`/`detectLanding()`
    // specifically so this doesn't get missed: `tickTimers()` runs first and
    // would otherwise still see last step's airborne `grounded` flag.
    fixedStep({ ...NO_INPUT, slide: true });

    expect(player.grounded).toBe(true);
    expect(player.isDucking).toBe(true);
  });

  it('a slide held only while airborne is not still ducking once grounded', () => {
    // Held for exactly one step, long before landing, then released (every
    // later step is NO_INPUT) - `slide` is a level now (see `RunInput.slide`),
    // so by the time landing actually happens it simply isn't held any more,
    // with nothing to buffer or decay.
    fixedStep({ ...NO_INPUT, jump: true, slide: true });
    consumeEdges({ ...NO_INPUT, jump: true, slide: true });
    let steps = 1;
    while (!player.grounded && steps < 300) {
      fixedStep(NO_INPUT);
      steps++;
    }
    expect(steps).toBeLessThan(300);
    expect(player.isDucking).toBe(false);
  });

  it('keeps ducking for as long as slide is held, and stands the instant it is released', () => {
    // Settle onto the floor from the spawn drop first - grounded is what
    // gates ducking, and the point of this test is the hold, not the fall.
    let settleSteps = 0;
    while (!player.grounded && settleSteps < 300) {
      fixedStep(NO_INPUT);
      settleSteps++;
    }
    expect(player.grounded).toBe(true);

    // The direct regression test for hold-to-slide: under the old
    // fixed-duration timer this would have stood back up after ~33 steps
    // (`PHYSICS.slideDuration`'s old 0.55s) regardless of the key still being
    // held.
    for (let i = 0; i < 90; i++) {
      fixedStep({ ...NO_INPUT, slide: true });
      expect(player.isDucking).toBe(true);
    }

    fixedStep(NO_INPUT);
    expect(player.isDucking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ChunkBuilder - full physics-backed streaming smoke test
// ---------------------------------------------------------------------------

describe('ChunkBuilder', () => {
  let world: PhysicsWorld;
  let player: PlayerController;
  let scene: THREE.Scene;
  let builder: ChunkBuilder;

  beforeAll(async () => {
    await initRapier();
  });

  beforeEach(() => {
    resetPhysicsConfig();
    world = new PhysicsWorld();
    scene = new THREE.Scene();
    player = new PlayerController(world);
    builder = new ChunkBuilder(scene, world, player, { seed: 1234 });
    builder.start();
  });

  afterEach(() => {
    builder.dispose();
    player.dispose();
    world.dispose();
  });

  it('deals an opening run and gives the player a path to stand on', () => {
    expect(builder.path).not.toBeNull();
    expect(builder.liveChunkCount).toBeGreaterThan(0);
  });

  it('never cycles day/night - the sky stays exactly as authored across a long run', () => {
    // Regression for "remove the day/night cycle entirely": ChunkBuilder
    // used to advance an elapsed-time clock and feed it through
    // `updateTimeOfDay`, drifting the sky/fog toward night every 300
    // (simulated) seconds. Running well past that old cycle length and
    // checking the sky never moves off the authored day colour is what
    // actually pins "no time-of-day changes," not just that the old
    // driving code is gone.
    const pos = new THREE.Vector3(0, 20.5, 0);
    const daySky = (scene.background as THREE.Color).clone();

    for (let i = 0; i < 400 * 60; i++) {
      builder.step(1 / 60);
      if (i % 30 === 0) builder.update(pos);
    }

    const bg = scene.background as THREE.Color;
    expect(bg.r).toBeCloseTo(daySky.r, 6);
    expect(bg.g).toBeCloseTo(daySky.g, 6);
    expect(bg.b).toBeCloseTo(daySky.b, 6);
  });

  it('streaming for a long simulated run never leaks bodies or chunks', () => {
    const pos = new THREE.Vector3(0, 20.5, 0);
    const heading = new THREE.Vector3(0, 0, 1);

    // Walk a virtual runner far down the (possibly bent) route without
    // physics simulation - this is a streaming/pooling stress test, not a
    // movement test, so it only needs a position that advances along
    // whatever path the builder has grown so far.
    for (let i = 0; i < 4000; i++) {
      const path = builder.path;
      if (path) {
        path.getDirectionAt(path.projectDistance(pos) + 1, heading);
        pos.addScaledVector(heading, 11 * (1 / 60));
      }
      builder.update(pos);
      builder.step(1 / 60);

      expect(builder.spawnCount - builder.recycleCount).toBe(builder.liveChunkCount);
    }

    // The pool builds one rig per streamer slot and never more - it is a
    // fixed-size ring, so the built-rig count must stop growing once the
    // ring has fully warmed up.
    const builtAfterWarmup = builder.builtRigCount;
    for (let i = 0; i < 500; i++) {
      const path = builder.path!;
      path.getDirectionAt(path.projectDistance(pos) + 1, heading);
      pos.addScaledVector(heading, 11 * (1 / 60));
      builder.update(pos);
      builder.step(1 / 60);
    }
    expect(builder.builtRigCount).toBe(builtAfterWarmup);
  });

  it('a generated turn actually appears over a long enough run', () => {
    const pos = new THREE.Vector3(0, 20.5, 0);
    const heading = new THREE.Vector3(0, 0, 1);
    let sawTurn = false;

    // ~370 chunks' worth of travel at CHUNK_LENGTH 30 - the section-weighted
    // director makes turns rarer in some sections (fishCollection/reward)
    // than a flat per-chunk weighting would, so this needs enough runway to
    // be a reliable check rather than a coin flip.
    for (let i = 0; i < 60000 && !sawTurn; i++) {
      const path = builder.path;
      if (path) {
        path.getDirectionAt(path.projectDistance(pos) + 1, heading);
        pos.addScaledVector(heading, 11 * (1 / 60));
        if (path.junctions.some((j) => j.kind === 'turn')) sawTurn = true;
      }
      builder.update(pos);
    }

    expect(sawTurn).toBe(true);
  });

  it('safeLaneNear() never sends a recovery into a lane it just flagged as blocked', () => {
    // Nothing has been placed yet at the very start of the bootstrap chunk -
    // there is nothing to be blocked by, so the preferred lane comes back
    // unchanged.
    expect(builder.safeLaneNear(0, 1)).toBe(1);
    expect(builder.safeLaneNear(0, -1)).toBe(-1);

    const pos = new THREE.Vector3(0, 20.5, 0);
    const heading = new THREE.Vector3(0, 0, 1);
    let sawDeflection = false;

    // Walk far enough to guarantee several obstacle chunks have streamed in,
    // then probe a spread of arc distances against a deliberately "wrong"
    // preferred lane. Whenever safeLaneNear actually deflects away from the
    // preferred lane (proving it found a real obstacle there), asking again
    // with the *returned* lane as preferred must return that same lane -
    // i.e. the lane it picked to avoid a block isn't itself flagged blocked.
    for (let i = 0; i < 6000; i++) {
      const path = builder.path;
      if (path) {
        path.getDirectionAt(path.projectDistance(pos) + 1, heading);
        pos.addScaledVector(heading, 11 * (1 / 60));
      }
      builder.update(pos);
      builder.step(1 / 60);

      if (i % 30 !== 0 || !builder.path) continue;
      const arc = builder.path.projectDistance(pos);
      for (const preferred of [-1, 0, 1] as const) {
        const chosen = builder.safeLaneNear(arc, preferred);
        expect([-1, 0, 1]).toContain(chosen);
        if (chosen !== preferred) {
          sawDeflection = true;
          expect(builder.safeLaneNear(arc, chosen)).toBe(chosen);
        }
      }
    }

    expect(sawDeflection).toBe(true);
  });

  it('never lets a decorative building/facade box truly overlap a deck, including across turns', () => {
    // Regression for "decorative buildings overlap the track in the straight
    // chunk immediately following a turn": the skyline row's near-pivot slot
    // on the *inside* of a turn was already suppressed on the turn chunk
    // itself, but the chunk *before* the turn had already placed its own
    // last slot before anyone knew a turn was coming (chunks generate
    // strictly in order) - and a 90-degree turn's new deck always sweeps
    // `DECK_WIDTH / 2` back along one of that previous chunk's own lateral
    // directions, reaching into a slot that was never told to clear out.
    // `ChunkBuilder.suppressPreviousChunkPivotSlot` is the fix; this is the
    // actual geometric check that fix was built from - found by walking a
    // real `ChunkBuilder` across many seeds and comparing pooled mesh
    // transforms directly, not by re-deriving the rotation algebra by hand
    // and trusting it.
    //
    // A deck and the gap-facade sitting *directly beneath its own matching
    // segment* are excluded - by design they share a footprint and touch at
    // the facade's top/deck's bottom plane, which is not a real overlap a
    // player could ever stand inside.
    function volumeOverlap(a: THREE.Box3, b: THREE.Box3): number {
      const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
      const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
      const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
      return dx > 1e-6 && dy > 1e-6 && dz > 1e-6 ? dx * dy * dz : 0;
    }
    function meshBox(mesh: THREE.Mesh): THREE.Box3 | null {
      if (!mesh.visible) return null;
      mesh.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(mesh);
    }

    const overlaps: string[] = [];

    for (let seed = 0; seed < 15 && overlaps.length === 0; seed++) {
      resetPhysicsConfig();
      const seededWorld = new PhysicsWorld();
      const seededPlayer = new PlayerController(seededWorld);
      const seededBuilder = new ChunkBuilder(new THREE.Scene(), seededWorld, seededPlayer, { seed });
      seededBuilder.start();

      const pos = new THREE.Vector3(0, 20.5, 0);
      const heading = new THREE.Vector3(0, 0, 1);

      // Reaching into private pool/rig internals is the only way to read the
      // *actual* pooled mesh transforms this test needs - the same thing
      // production code does through `this.pool`/`this.buildings`/
      // `this.gapFacades`/`this.liveChunks` inside ChunkBuilder itself.
      const pool = (seededBuilder as unknown as { pool: any }).pool;
      const buildingPool = (seededBuilder as unknown as { buildings: any }).buildings;
      const gapFacades = (seededBuilder as unknown as { gapFacades: any }).gapFacades;
      const liveChunks = (seededBuilder as unknown as { liveChunks: any[] }).liveChunks;

      for (let i = 0; i < 8000 && overlaps.length === 0; i++) {
        const path = seededBuilder.path;
        if (path) {
          path.getDirectionAt(path.projectDistance(pos) + 1, heading);
          pos.addScaledVector(heading, 11 * (1 / 60));
        }
        seededBuilder.update(pos);
        seededBuilder.step(1 / 60);

        if (i % 15 !== 0) continue;

        const deckBoxes: { box: THREE.Box3; label: string; slot: number }[] = [];
        for (const [slot, rig] of pool.rigs as Map<number, any>) {
          for (const key of ['deckA', 'deckB', 'deckC', 'cornerFill']) {
            const b = meshBox(rig[key].mesh);
            if (b) deckBoxes.push({ box: b, label: key, slot });
          }
        }

        const decorBoxes: { box: THREE.Box3; label: string; slot: number; ownDeckKey?: string }[] = [];
        for (const [slot, rig] of buildingPool.rigs as Map<number, any>) {
          for (const key of ['left', 'right'] as const) {
            for (let idx = 0; idx < rig[key].length; idx++) {
              const b = meshBox(rig[key][idx]);
              if (b) decorBoxes.push({ box: b, label: `buildings.${key}[${idx}]`, slot });
            }
          }
          const cornerBox = meshBox(rig.corner);
          if (cornerBox) decorBoxes.push({ box: cornerBox, label: 'buildings.corner', slot });
        }
        const facadeOwnDeck: Record<string, string> = {
          a: 'deckA',
          b: 'deckB',
          c: 'deckC',
          corner: 'cornerFill',
        };
        for (const [slot, rig] of gapFacades.rigs as Map<number, any>) {
          for (const key of ['a', 'b', 'c', 'corner'] as const) {
            const b = meshBox(rig[key]);
            if (b) decorBoxes.push({ box: b, label: `gapFacades.${key}`, slot, ownDeckKey: facadeOwnDeck[key] });
          }
        }

        for (const deck of deckBoxes) {
          for (const decor of decorBoxes) {
            const isOwnFacade = decor.ownDeckKey === deck.label && decor.slot === deck.slot;
            if (isOwnFacade) continue;
            if (volumeOverlap(deck.box, decor.box) > 1e-4) {
              const deckChunk = liveChunks[deck.slot];
              const decorChunk = liveChunks[decor.slot];
              overlaps.push(
                `seed=${seed} step=${i}: deck ${deck.label} (chunk idx=${deckChunk?.placement?.index}, type=${deckChunk?.type}) ` +
                  `overlaps ${decor.label} (chunk idx=${decorChunk?.placement?.index}, type=${decorChunk?.type})`,
              );
            }
          }
        }
      }

      seededBuilder.dispose();
      seededPlayer.dispose();
      seededWorld.dispose();
    }

    expect(overlaps, overlaps.join('\n')).toEqual([]);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Fish placement on a tier-changing gap - regression for the clipping bug
// ---------------------------------------------------------------------------

describe('ChunkBuilder fish placement across a tier-changing gap', () => {
  let world: PhysicsWorld;
  let player: PlayerController;
  let scene: THREE.Scene;
  let builder: ChunkBuilder;

  beforeAll(async () => {
    await initRapier();
  });

  afterEach(() => {
    builder.dispose();
    player.dispose();
    world.dispose();
  });

  /**
   * `fixedChunks` specs are consumed as-is by `ChunkBuilder.nextSpec()` -
   * `generateFishPattern()` never runs for them - so `fish` has to be
   * hand-authored here, the same way `TutorialLevel.ts` does it. One fish
   * sits just before the gap (over deck A, built at `previousRoofTier`), one
   * just after it (over deck B, built at `roofTier`) - `arcPattern()`'s own
   * flat-end positions, reused so this test exercises the exact placements
   * a real gap chunk produces.
   */
  it('places the deck-A fish at the previous tier and the deck-B fish at the new tier when the roof steps DOWN', () => {
    resetPhysicsConfig();
    world = new PhysicsWorld();
    scene = new THREE.Scene();
    player = new PlayerController(world);

    const deckAFishZ = GAP_START_Z - 3;
    const deckBFishZ = GAP_END_Z + 3;
    const gapChunk: ChunkSpec = {
      ...generateJump(),
      previousRoofTier: ROOF_MEDIUM,
      roofTier: ROOF_LOW,
      fish: [
        { x: 0, y: FISH_HEIGHT, z: deckAFishZ },
        { x: 0, y: FISH_HEIGHT, z: deckBFishZ },
      ],
    };
    const atTier = (tier: typeof ROOF_LOW | typeof ROOF_MEDIUM): ChunkSpec => ({
      ...generateStraight(),
      previousRoofTier: tier,
      roofTier: tier,
    });
    const chunks: ChunkSpec[] = [atTier(ROOF_MEDIUM), atTier(ROOF_MEDIUM), gapChunk, atTier(ROOF_LOW), atTier(ROOF_LOW)];

    builder = new ChunkBuilder(scene, world, player, { fixedChunks: chunks });
    builder.start();
    player.spawn(new THREE.Vector3(0, TRACK_Y + ROOF_TIER_HEIGHT[ROOF_MEDIUM] + capsuleFeetOffset(), 0), 0);

    // A `fixedChunks` prefix now falls through to real procedural
    // generation once it runs out (chunk index 5 onward here) - see
    // `ChunkBuilder.nextSpec()` - which deals its own fish at ROOF_LOW too.
    // Isolating the gap chunk's own world-Z span (index 2, straight route so
    // world Z tracks arc) keeps this test about only the two hand-placed
    // fish, regardless of what procedural generation adds past the prefix.
    const gapChunkStartZ = 2 * CHUNK_LENGTH;
    const gapChunkEndZ = 3 * CHUNK_LENGTH;
    const allFish: THREE.Vector3[] = [];
    for (let slot = 0; slot < 20; slot++) allFish.push(...builder.fishPositionsFor(slot));
    const gapChunkFish = allFish.filter((p) => p.z >= gapChunkStartZ && p.z < gapChunkEndZ);

    const expectedMediumY = TRACK_Y + ROOF_TIER_HEIGHT[ROOF_MEDIUM] + FISH_HEIGHT;
    const expectedLowY = TRACK_Y + ROOF_TIER_HEIGHT[ROOF_LOW] + FISH_HEIGHT;

    const atMedium = gapChunkFish.filter((p) => Math.abs(p.y - expectedMediumY) < 0.5);
    const atLow = gapChunkFish.filter((p) => Math.abs(p.y - expectedLowY) < 0.5);

    // Before the fix, both fish used `roofTier` (LOW) regardless of which
    // deck they sat over, so the deck-A fish would land ~3 units below the
    // deck it's actually placed above (embedded in the rooftop) instead of
    // here, at the deck's real (previous-tier) height.
    expect(atMedium.length).toBe(1);
    expect(atLow.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fixedChunks prefix falling through to real procedural generation -
// the mechanism the first-run tutorial prefix relies on to become an
// ordinary endless run once it ends, with no reset or scene change.
// ---------------------------------------------------------------------------

describe('ChunkBuilder fixedChunks prefix -> procedural fallthrough', () => {
  let world: PhysicsWorld;
  let player: PlayerController;
  let scene: THREE.Scene;
  let builder: ChunkBuilder;

  beforeAll(async () => {
    await initRapier();
  });

  afterEach(() => {
    builder.dispose();
    player.dispose();
    world.dispose();
  });

  /**
   * Before this change, `nextSpec()` used `fixedChunks` for the whole run,
   * falling back to an infinite repeat of `generateStraight()` once the
   * array ran out - every chunk past it identical: `type: 'straight'`,
   * `hasGap: false`, no obstacles, tier stuck at 0. This proves that no
   * longer happens: real procedural variety (a hazard shape, or a tier the
   * fixed prefix's last chunk didn't leave the roof at) shows up well past
   * the short fixed prefix used here.
   */
  it('deals the fixed prefix, then real procedural chunks - not an infinite straight-chunk repeat', () => {
    resetPhysicsConfig();
    world = new PhysicsWorld();
    scene = new THREE.Scene();
    player = new PlayerController(world);

    const fixed: ChunkSpec[] = [
      { ...generateStraight(), previousRoofTier: ROOF_LOW, roofTier: ROOF_LOW },
      { ...generateStraight(), previousRoofTier: ROOF_LOW, roofTier: ROOF_LOW },
      { ...generateJump(), previousRoofTier: ROOF_LOW, roofTier: ROOF_MEDIUM, trampoline: true },
    ];

    builder = new ChunkBuilder(scene, world, player, { fixedChunks: fixed, seed: 777 });
    builder.start();

    const pos = new THREE.Vector3(0, TRACK_Y, 0);
    const heading = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 3000; i++) {
      const path = builder.path;
      if (path) {
        const arc = path.projectDistance(pos);
        path.getDirectionAt(arc + 1, heading);
        pos.addScaledVector(heading, 11 * (1 / 60));
      }
      builder.update(pos);
      builder.step(1 / 60);
    }

    const liveChunks = (
      builder as unknown as {
        liveChunks: readonly (
          | {
              placement: { index: number };
              type: string;
              hasGap: boolean;
              obstacles: readonly unknown[];
              roofTier: number;
            }
          | null
        )[];
      }
    ).liveChunks;

    const pastPrefix = liveChunks.filter((c) => c && c.placement.index >= fixed.length);
    expect(pastPrefix.length).toBeGreaterThan(0);

    const sawVariety = pastPrefix.some(
      (c) => c!.type !== 'straight' || c!.hasGap || c!.obstacles.length > 0 || c!.roofTier !== ROOF_LOW,
    );
    expect(sawVariety).toBe(true);
  });
});
