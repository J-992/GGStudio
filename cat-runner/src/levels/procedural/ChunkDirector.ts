import { CHUNK_DEBUG } from './debug';
import { CHUNK_TYPES, type ChunkType } from './ChunkTypes';
import { sectionAtDistance, type SectionType } from './SectionDirector';
import type { Rng } from './ChunkGenerators';

/**
 * Picks the next chunk type given how far into the run it is.
 *
 * Two independent dimensions, deliberately kept separate rather than folded
 * into one 15-entry (tier x section) table:
 *
 *  - **Section** (`SectionDirector`) sets the *shape* of what's happening -
 *    a fish-collection breather reads completely differently from an
 *    obstacle-challenge run, and that's a per-type weight table each
 *    (`SECTION_WEIGHTS`), because the relative mix of types is what defines
 *    a section, not a single number.
 *  - **Tier** (`tierAt`) sets *overall intensity* - late-tier running should
 *    feel denser than early-tier running even in the *same* section. Used
 *    to be one multiplier on the section table's own `straight` weight; that
 *    knob was retired when `straight` briefly went to zero everywhere, and
 *    is deliberately not being restored now that `straight` is back at a
 *    modest weight (see the table's own doc comment) - scaling a 6-15 point
 *    weight per tier is noise next to what the hazard mix itself does.
 *    Re-expressed as `TIER_HAZARD_SCALE`, a multiplier on
 *    `jump`/`vent` (the two biggest, least-dodgeable hazards) instead: late
 *    tier leans harder into gaps and the un-dodgeable pipe, not just "more
 *    of everything," which is closer to what "difficulty rises" should mean
 *    once every section is already dense.
 *
 * A previous pass at density packed 2-3 hazards into one 80-unit chunk
 * (`obstacleJump`/`slideObstacle`/`tripleObstacle`). When `CHUNK_LENGTH`
 * shrank to 30 those stopped fitting safely - there isn't room for two
 * `MIN_HAZARD_SPACING`-apart decisions plus lead-in/lead-out margin in 30
 * units without cutting reaction time below what's fair. "Combinations"
 * (obstacle-then-jump, slide-then-obstacle, back-to-back obstacles - the
 * asked-for patterns) come instead from **consecutive short chunks**: see
 * {@link COMBO_WEIGHT_BOOST} below. Each decision still gets a full chunk of
 * its own framing, which reads as more deliberate than one crowded chunk did.
 *
 * On top of both, structural constraints are enforced by *filtering the
 * candidate set before picking* rather than left to chance or fixed up after
 * the fact:
 *
 *  - `'slide'` never follows `'slide'`, and `'vent'` never follows `'vent'` -
 *    each is a single, visually distinctive full-width hazard, and back to
 *    back the repeat reads as a glitch rather than a deliberate pattern the
 *    way two different hazard types in a row does. Filtered the same way as
 *    the streak cap, not left to chance.
 *  - `'straight'` never follows `'straight'` either, for a different reason:
 *    it is back in the weighted pool at a modest weight (see
 *    `SECTION_WEIGHTS`), and one empty chunk of breathing room is the point
 *    while two in a row is the "long empty stretch" the whole density pass
 *    was about. Enforcing it as a no-repeat filter costs nothing beyond one
 *    more entry in {@link NO_REPEAT_TYPES} - the filter already runs on
 *    every pool pick. A forced turn lead-in or post-turn rest can still sit
 *    beside a pool-picked `'straight'` (those set the type directly and
 *    never consult the filter), which is the one legitimate exception; the
 *    *next* pool pick after such a chunk still correctly excludes
 *    `'straight'`, since every branch of `select()` updates `lastType`.
 *
 * `'straight'` can therefore be filtered out of the candidate set, but never
 * all of the candidates at once - the hazard types are never all excluded at
 * the same time, and `weightedPick()` falls back to `'straight'` if a caller
 * ever managed it, so the director can still never paint itself into a
 * corner with no legal next chunk.
 *
 * Two further contexts set `'straight'`/`'obstacle'` directly rather than
 * rolling for them: the forced turn lead-in / post-turn rest
 * (`TurnCycleState.leadIn`/`'postTurn'` below), and the guaranteed opening
 * sequence every real run gets (`forceStartSequence` - a full straight chunk
 * to get moving on, then a single-lane obstacle, so a run never opens on a
 * clothesline or a pipe with no room to read it).
 *
 * Turns are handled separately from the weighted pool entirely, by
 * {@link turnCycle} - see its own doc comment for why. `turnLeft`/
 * `turnRight` are excluded from every `weightedPick()` candidate set; they
 * are only ever dealt by that state machine.
 */

export type DifficultyTier = 'early' | 'mid' | 'late';

/**
 * Route distance where each tier begins, in world units. Early starts at 0.
 * At `PHYSICS.runSpeed` (11 u/s): early lasts ~36s, mid another ~55s (~91s
 * total to reach late) - comparable to a single campaign level's total
 * playtime, not the far longer ramp the very first pass at this used.
 */
export const MID_TIER_START = 400;
export const LATE_TIER_START = 1000;

/** ~AHEAD_DISTANCE (220) / CHUNK_LENGTH (15), rounded up - same real-world
 *  run-up distance before a turn the previous, 30-unit-chunk pass had (was 8
 *  at 30u; halving `CHUNK_LENGTH` without also rescaling this would have
 *  silently halved that real-world spacing too). Exported so tests assert
 *  against the real value instead of a second hardcoded copy. */
export const TURN_COOLDOWN_CHUNKS = 15;
/**
 * There used to be a hazard chunk-count budget in a row here
 * (`MAX_HAZARD_STREAK`), removed this pass: once it triggered, its only
 * legal move was falling back to `'straight'` - the sole type left in
 * `allowed` once every hazard type was filtered out - but `straight` is zero
 * in every `SECTION_WEIGHTS` row now (see that table's own doc comment) and
 * may *only* ever come from the turn-cooldown cycle. A real run confirmed
 * the cap could still trigger on an unlucky stretch where the turn roll kept
 * failing, manufacturing an illegal off-schedule `'straight'` right where the
 * spec says none may appear. With no legal fallback left to give it, the cap
 * has nothing correct left to do - a long, turn-free hazard run is exactly
 * what "avoid long periods of simply running forward" asks for anyway, so
 * there is no longer a reason to want a forced rest here at all.
 */
/** After a hazard chunk, the very next pick's hazard-type weights are
 *  multiplied by this before the usual filters run - what makes
 *  "combinations" (obstacle-then-jump, slide-then-obstacle, back-to-back
 *  obstacles) show up often as two clean chunks in a row instead of one
 *  crowded one. Doesn't bypass any safety filter - the turn cooldown and the
 *  no-repeat rule still apply to the boosted pick exactly as normal. */
const COMBO_WEIGHT_BOOST = 2;

const HAZARD_TYPES: ReadonlySet<ChunkType> = new Set(['obstacle', 'slide', 'jump', 'vent']);
const TURN_TYPES: ReadonlySet<ChunkType> = new Set(['turnLeft', 'turnRight']);
const TURN_TYPE_LIST: readonly ChunkType[] = ['turnLeft', 'turnRight'];
/** Types that may never immediately repeat - see the class doc comment. */
const NO_REPEAT_TYPES: ReadonlySet<ChunkType> = new Set(['slide', 'vent', 'straight']);

/** Whether this type counts as a hazard for {@link boostHazards}'s combo
 *  check - 1 if so, 0 otherwise. */
function hazardWeight(type: ChunkType): number {
  return HAZARD_TYPES.has(type) ? 1 : 0;
}

/** Scales every hazard type's weight by {@link COMBO_WEIGHT_BOOST}, leaving
 *  `straight`/turn weights untouched. */
function boostHazards(table: WeightTable): WeightTable {
  const boosted = { ...table };
  for (const type of HAZARD_TYPES) boosted[type] = table[type] * COMBO_WEIGHT_BOOST;
  return boosted;
}

type WeightTable = Readonly<Record<ChunkType, number>>;

/**
 * Per-section chunk-type mix. Reads as the rhythm's own description:
 * `easy` carries a lighter hazard mix than the challenge sections but is no
 * longer mostly empty; `reward` stays the one deliberately restful section
 * (the payoff, not another challenge) but even it isn't pure filler anymore;
 * `fishCollection` still favours `slide`/`obstacle` over gaps/turns so a fish
 * trail is rarely interrupted by a heading change; the two challenge
 * sections carry almost all of the hazard weight, `hard` denser than the
 * plain one - `COMBO_WEIGHT_BOOST` then stacks decisions across consecutive
 * chunks on top of these base tables.
 *
 * `straight` went 55/65/8/70/4, then 15/20/2/30/1, then 8/15/1/26/1, then to
 * **zero in every row** - and that last step overshot. At zero the only
 * chunks that could ever come out `'straight'` were the forced turn lead-in
 * and post-turn rest, which reads as relentless rather than dense: a run
 * with no plain chunk in it anywhere has no rhythm to push against. It went
 * back in the pool at a modest, deliberately non-dominant weight - 15 in the
 * three lighter sections, 6 in the two challenge ones - and stayed there
 * until a pacing pass found even that read as too much downtime: too much of
 * a run was spent on a chunk with no decision in it. Halved again from
 * there - **8/8/3/8/3** - on the same reasoning `NO_REPEAT_TYPES` already
 * relied on to keep the *previous* weight safe: a lower ambient weight isn't
 * the zero-weight failure mode repeating, because the two *forced* straight
 * mechanisms (the post-gap recovery chunk and the turn lead-in/post-turn
 * pair, both below) are untouched by this and keep straight chunks
 * concentrated in exactly the contexts they're meant for - recovery after a
 * gap, a turn's approach and exit - rather than turning it into "relentless"
 * a second time.
 *
 *   `easy`/`fishCollection`/`reward` get 8, the three lighter sections where
 *   a beat of breathing room still belongs, just less of it; the two
 *   challenge sections get 3, small enough that a challenge reads as fully
 *   sustained.
 *
 * The weight each row gives back is not redistributed onto `obstacle`/
 * `slide`/`jump` - `weightedPick()` normalises against whatever the
 * candidate set totals, so lowering `straight` alone already raises every
 * other type's *share* of the row proportionally, which is the whole point
 * (more of the run spent on obstacles/gaps/turns/height transitions).
 *
 * Two plain straights can still never land back to back out of this pool -
 * that is {@link NO_REPEAT_TYPES}' job, not the weights' - which is what
 * keeps "a modest straight weight" from re-creating the long empty stretches
 * the zero pass was reacting to. Adjustable for future balancing.
 */
const SECTION_WEIGHTS: Readonly<Record<SectionType, WeightTable>> = {
  // `vent` stays at 0 here, in `fishCollection` and in `reward`: those three
  // are the deliberately lighter sections in every tier's cycle (see the
  // class doc comment), and a jump-only, un-dodgeable hazard is exactly the
  // kind of thing that shouldn't show up in what's meant to read as a
  // breather. It only ever appears in the two challenge sections below -
  // see those two entries for how "gradually" is expressed as a difference
  // in weight between them, not a second tier system.
  easy: {
    straight: 8, // was 0, then 15 - see the table's own doc comment
    obstacle: 39, // 46 x ~0.85
    slide: 17, // 20 x ~0.85
    jump: 24, // 28 x ~0.85
    vent: 0,
    turnLeft: 3,
    turnRight: 3,
  },
  fishCollection: {
    straight: 8, // was 0, then 15
    obstacle: 21, // 25 x ~0.85
    slide: 36, // 42 x ~0.85 - still favours slide over gaps, shape unchanged
    jump: 23, // 27 x ~0.85
    vent: 0,
    turnLeft: 3,
    turnRight: 3,
  },
  // The first place `vent` can appear at all. One of the two sections the
  // extra gap push (item 4) lands heaviest in.
  obstacleChallenge: {
    straight: 3, // small (was 6) - this is a challenge section, not a breather
    obstacle: 13, // 14 x ~0.94
    slide: 23, // 25 x ~0.94
    jump: 37, // 39 x ~0.94
    vent: 10, // untouched: vent never pays for the straight weight
    turnLeft: 6,
    turnRight: 6,
  },
  reward: {
    straight: 8, // was 0, then 15 - stays the restful section, and the one
    // that most wants a plain chunk to actually rest on.
    obstacle: 29, // 34 x ~0.85
    slide: 27, // 32 x ~0.85
    jump: 26, // 30 x ~0.85
    vent: 0,
    turnLeft: 2,
    turnRight: 2,
  },
  // Denser than `obstacleChallenge` in both jump and vent, the same "hard
  // carries more of everything" relationship the section already had. The
  // other of the two sections the extra gap push lands heaviest in.
  hardObstacleChallenge: {
    straight: 3, // small (was 6), same reasoning as `obstacleChallenge` above
    obstacle: 5, // 5 x ~0.94, rounded - already the smallest weight in the row
    slide: 23, // 25 x ~0.94
    jump: 39, // 41 x ~0.94
    vent: 15, // untouched, same as `obstacleChallenge`
    turnLeft: 7,
    turnRight: 7,
  },
};

/**
 * Multiplies a section's own `jump`/`vent` weight - the intensity knob tier
 * turns, having moved off `straight` (the previous knob) when that briefly
 * went to zero everywhere and stayed here since. Late tier leans harder into gaps and the
 * un-dodgeable pipe specifically, rather than "more of everything" (which
 * would reshape a section's own character, the one thing tier still
 * shouldn't touch) - `vent` staying exactly 0 in the three lighter sections
 * is preserved by construction, since 0 times any scale is still 0.
 */
const TIER_HAZARD_SCALE: Readonly<Record<DifficultyTier, number>> = {
  early: 0.7,
  mid: 1.0,
  late: 1.5,
};

export function tierAt(distance: number): DifficultyTier {
  if (distance < MID_TIER_START) return 'early';
  if (distance < LATE_TIER_START) return 'mid';
  return 'late';
}

export interface ChunkSelection {
  readonly type: ChunkType;
  readonly tier: DifficultyTier;
  readonly section: SectionType;
  /**
   * Asks the generator for the gentlest form of this chunk type it has -
   * set on the forced second chunk of a run's opening sequence
   * (`forceStartSequence`), where it means "one blocked lane at the far,
   * loose Z" rather than the normal 1/2/3-lane roll. Layered on top of
   * `type` rather than encoded as a separate chunk type so nothing else in
   * the pipeline (the weight tables, the no-repeat filter, the roof
   * director) has to learn about a variant that only exists once per run.
   */
  readonly simple: boolean;
}

/**
 * Where a director sits in the turn sequence.
 *
 * Turns used to be dealt straight out of the weighted pool, gated to only
 * ever land the instant after a `'straight'` roll. That made real turn
 * frequency depend on how often `'straight'` itself got picked - and once
 * the density pass cut `SECTION_WEIGHTS.straight` down to 1-2 in exactly the
 * sections with the highest turn weight, the turn-eligible window all but
 * stopped opening where it mattered, crushing turns to a fraction of a
 * percent regardless of the 2-7 weight in the table. This state machine
 * schedules a turn explicitly instead of hoping the pool rolls into one:
 *
 *  - `'idle'`: normal pool, turns excluded (dealt only via the states below).
 *    Once {@link TURN_COOLDOWN_CHUNKS} has elapsed, each idle pick also
 *    rolls "is a turn due now" against the section's own
 *    `turnLeft + turnRight` weight versus everything else - the same
 *    per-section rarity the table already encodes, just decoupled from
 *    `straight`'s now-low probability.
 *  - `'leadIn'`: the roll above hit - force a guaranteed `'straight'` chunk
 *    (the clear run-up a corner needs) and move to `'turn'`.
 *  - `'turn'`: force the turn itself (left/right chosen from the section
 *    table) and move to `'postTurn'`.
 *  - `'postTurn'`: force the existing "chunk after a turn is straight"
 *    safety chunk and return to `'idle'`.
 */
type TurnCycleState = 'idle' | 'leadIn' | 'turn' | 'postTurn';

export class ChunkDirector {
  /** Starts "cooled down" so the very first chunk isn't artificially barred. */
  private chunksSinceTurn = TURN_COOLDOWN_CHUNKS;
  /** Null before the first chunk - which is exactly when a turn should be
   *  impossible anyway, so it doubles as that guard. */
  private lastType: ChunkType | null = null;
  /** See {@link TurnCycleState}. */
  private turnCycle: TurnCycleState = 'idle';
  private dealt = 0;
  /** Set the instant a `'jump'` (gap) chunk is dealt on early/easy difficulty
   *  - see `select()`'s own use of this for why: the *next* call forces a
   *  guaranteed `'straight'` recovery chunk instead of a normal weighted
   *  pick, so a player who just landed a gap always gets a breather before
   *  the next decision, rather than risking a hazard right on landing. Never
   *  set once difficulty rises past early/easy (mid/late tier, or any
   *  section other than `'easy'`), where combinations right after a gap are
   *  the intended, escalating challenge. */
  private pendingEasyGapRecovery = false;
  /**
   * Set from outside, by `ChunkBuilder.nextSpec()` calling {@link noteTrampoline}
   * right after resolving *this* chunk's own roof-tier roll - `ChunkDirector`
   * has no visibility into that roll itself, since it's decided afterward by
   * the separate `RoofDirector`. Consulted the same way
   * `pendingEasyGapRecovery` is (a forced `'straight'` on the very next
   * `select()` call), but unconditional on tier/section: a trampoline
   * landing is a height change, a bigger disorientation than a same-height
   * gap, and deserves a guaranteed recovery chunk everywhere, not just on
   * early/easy difficulty - see `select()`.
   */
  private pendingTrampolineRecovery = false;

  /**
   * @param cycleVariant Which `SectionDirector` cycle ordering this run
   *    picked - see `pickCycleVariant()`. Defaults to the original order.
   * @param openingType Forces the very first chunk to this type, ignoring the
   *    weights. Null (the default, and what every real run uses) leaves the
   *    opening chunk as random as any other. The attract screen passes
   *    `'straight'`: it poses a camera a few metres behind a stationary cat
   *    on that first chunk, and an obstacle or a clothesline dealt into the
   *    gap between the two fills the frame and hides the cat entirely.
   *    Nothing else about the run is pinned - chunk 1 onward is dealt
   *    normally, so the view past the cat is as varied as ever.
   * @param forceStartSequence Pins the first *two* chunks of a real run: a
   *    plain `'straight'` to get up to speed on, then a deliberately simple
   *    `'obstacle'` (one lane blocked, at the loose far Z - see
   *    `ChunkSelection.simple`). Guarantees a run never opens on a
   *    clothesline or a vent pipe, and that the first thing it does ask for
   *    is readable from a full chunk away. Checked *after* `openingType`, so
   *    the attract screen (which passes only `openingType: 'straight'` and
   *    is a background decoration rather than a run) is untouched.
   */
  constructor(
    private readonly cycleVariant = 0,
    private readonly openingType: ChunkType | null = null,
    private readonly forceStartSequence = false,
  ) {}

  select(startDist: number, rng: Rng): ChunkSelection {
    const tier = tierAt(startDist);
    const section = sectionAtDistance(startDist, this.cycleVariant);
    const baseTable = this.weightTableFor(tier, section);
    // Straight after a hazard chunk: bias this pick toward another hazard
    // type, so combinations (obstacle-then-jump, slide-then-obstacle, ...)
    // happen as two consecutive chunks more often than base weights alone
    // would produce - see the class doc comment.
    const comboActive = this.lastType !== null && hazardWeight(this.lastType) > 0;
    const table = comboActive ? boostHazards(baseTable) : baseTable;

    let type: ChunkType;
    let simple = false;
    if (this.dealt === 0 && this.openingType !== null) {
      type = this.openingType;
    } else if (this.dealt === 0 && this.forceStartSequence) {
      type = 'straight';
    } else if (this.dealt === 1 && this.forceStartSequence) {
      type = 'obstacle';
      simple = true;
    } else if (this.turnCycle === 'leadIn') {
      type = 'straight';
      this.turnCycle = 'turn';
    } else if (this.turnCycle === 'turn') {
      type = weightedPick(TURN_TYPE_LIST, table, rng);
      this.turnCycle = 'postTurn';
    } else if (this.turnCycle === 'postTurn') {
      type = 'straight';
      this.turnCycle = 'idle';
    } else if (this.pendingTrampolineRecovery) {
      // Trampoline landing -> straight recovery, every tier/section - see
      // `pendingTrampolineRecovery`'s own doc comment.
      type = 'straight';
      this.pendingTrampolineRecovery = false;
    } else if (this.pendingEasyGapRecovery) {
      // Gap -> straight recovery, early/easy difficulty only - see
      // `pendingEasyGapRecovery`'s own doc comment. Bypasses the weighted
      // pool (and so `boostHazards()`'s post-hazard combo bias) entirely for
      // this one pick, the same way the turn cycle's own forced chunks do.
      type = 'straight';
    } else {
      const allowed = CHUNK_TYPES.filter((candidate) => {
        if (TURN_TYPES.has(candidate)) return false;
        // No back-to-back repeat of either single, visually distinctive
        // full-width hazard - see the class doc comment.
        if (NO_REPEAT_TYPES.has(candidate) && candidate === this.lastType) return false;
        return true;
      });
      type = weightedPick(allowed, table, rng);

      // Off cooldown: roll for whether a turn is due, using the section's
      // own turn weight against everything that could have been picked
      // instead - see {@link TurnCycleState}. Rolled independently of
      // `type` above so it no longer depends on this particular pick
      // having landed on `'straight'`.
      if (this.chunksSinceTurn >= TURN_COOLDOWN_CHUNKS) {
        const turnWeight = table.turnLeft + table.turnRight;
        const otherWeight = allowed.reduce((sum, t) => sum + table[t], 0);
        if (turnWeight > 0 && rng() * (otherWeight + turnWeight) < turnWeight) {
          this.turnCycle = 'leadIn';
        }
      }
    }

    this.chunksSinceTurn = TURN_TYPES.has(type) ? 0 : this.chunksSinceTurn + 1;
    this.lastType = type;
    this.pendingEasyGapRecovery = type === 'jump' && tier === 'early' && section === 'easy';
    const index = this.dealt++;

    if (CHUNK_DEBUG) {
      console.debug('[chunk] select', {
        index,
        startDist: startDist.toFixed(1),
        tier,
        section,
        type,
        simple,
      });
    }

    return { type, tier, section, simple };
  }

  /**
   * Tells the director the chunk it just dealt turned out to carry a
   * trampoline (a roof-tier rise), so the *next* `select()` call is forced
   * to a plain `'straight'` recovery chunk regardless of tier/section - see
   * `pendingTrampolineRecovery`'s own doc comment. Called by
   * `ChunkBuilder.nextSpec()`, the only place that has both this director's
   * own type decision and the separate `RoofDirector`'s tier decision for
   * the same chunk.
   */
  noteTrampoline(): void {
    this.pendingTrampolineRecovery = true;
  }

  private weightTableFor(tier: DifficultyTier, section: SectionType): WeightTable {
    const base = SECTION_WEIGHTS[section];
    const scale = TIER_HAZARD_SCALE[tier];
    if (scale === 1) return base;
    return { ...base, jump: base.jump * scale, vent: base.vent * scale };
  }
}

function weightedPick(types: readonly ChunkType[], table: WeightTable, rng: Rng): ChunkType {
  const total = types.reduce((sum, t) => sum + table[t], 0);
  // Only reachable if every candidate were filtered out and 'straight' were
  // somehow excluded too - defensive, but it keeps "always a valid route" a
  // guarantee rather than an assumption.
  if (total <= 0) return 'straight';

  let roll = rng() * total;
  for (const type of types) {
    roll -= table[type];
    if (roll <= 0) return type;
  }
  return types[types.length - 1];
}
