import type { MomentKind } from './Highlights';
import type { ReactionKind } from './EnemyMoves';

/**
 * Fight choreography for the death reel.
 *
 * A vignette is not "play the strike animation N times". It is a short
 * authored exchange: which move the hero uses on each body, how that body
 * leaves the fight, and how long the camera holds before the next blow. Pairing
 * matters more than any single animation — a slide only reads as a slide
 * because the body it passes goes over the hero's head, and a slam only lands
 * because the body before it was left hanging in the air.
 *
 * Sequences rotate, so dying twice with the same combo never plays the same
 * scene twice.
 */

export interface ChoreoBeat {
  /** Hero move id from the move library. */
  move: string;
  /** How the body on the receiving end leaves. */
  reaction: ReactionKind;
  /** Seconds before the next blow lands. */
  gap: number;
  /** Enemy attack to stage on the body being cut down, when it matters. */
  enemyAttack?: string;
}

export interface Sequence {
  readonly id: string;
  readonly beats: readonly ChoreoBeat[];
}

/** One clean kill, shot like the last second of a duel. */
const SINGLE: readonly Sequence[] = [
  {
    id: 'iaido',
    beats: [{ move: 'dashThrough', reaction: 'spinOut', gap: 0.4, enemyAttack: 'chop' }],
  },
  {
    id: 'under',
    beats: [{ move: 'slideUnder', reaction: 'flipOver', gap: 0.4, enemyAttack: 'sideCut' }],
  },
  {
    id: 'counter',
    beats: [{ move: 'riposte', reaction: 'launch', gap: 0.4, enemyAttack: 'lunge' }],
  },
  {
    id: 'overhead',
    beats: [{ move: 'vaultOver', reaction: 'slam', gap: 0.4, enemyAttack: 'sweep' }],
  },
];

/** A combo staged as a whole wave going down in one pass. */
const WAVE: readonly Sequence[] = [
  {
    // Low line: under the first, up through the second, everything else follows.
    id: 'ground-assault',
    beats: [
      { move: 'slideUnder', reaction: 'flipOver', gap: 0.26, enemyAttack: 'sideCut' },
      { move: 'backhand', reaction: 'juggle', gap: 0.2 },
      { move: 'cleave', reaction: 'slam', gap: 0.24, enemyAttack: 'chop' },
      { move: 'dashThrough', reaction: 'spinOut', gap: 0.22 },
      { move: 'groundPound', reaction: 'blowAway', gap: 0.3 },
    ],
  },
  {
    // Air work: nothing in this one touches the floor for long.
    id: 'airborne',
    beats: [
      { move: 'vaultOver', reaction: 'slam', gap: 0.24, enemyAttack: 'leapStrike' },
      { move: 'roundhouse', reaction: 'juggle', gap: 0.2 },
      { move: 'aerialThrow', reaction: 'launch', gap: 0.3, enemyAttack: 'shuriken' },
      { move: 'backflipKick', reaction: 'juggle', gap: 0.22 },
      { move: 'divingSlash', reaction: 'blowAway', gap: 0.3 },
    ],
  },
  {
    // Blade work: steel first, and one of them thrown.
    id: 'steel',
    beats: [
      { move: 'dashThrough', reaction: 'spinOut', gap: 0.22, enemyAttack: 'doubleSlash' },
      { move: 'crossCut', reaction: 'stagger', gap: 0.18 },
      { move: 'tornado', reaction: 'spinOut', gap: 0.26, enemyAttack: 'spinCut' },
      { move: 'bladeThrow', reaction: 'launch', gap: 0.28 },
      { move: 'cleave', reaction: 'slam', gap: 0.3 },
    ],
  },
  {
    // Crowd control: sweep the legs, then work down the line.
    id: 'sweeper',
    beats: [
      { move: 'lowSweep', reaction: 'juggle', gap: 0.2, enemyAttack: 'lunge' },
      { move: 'axeKick', reaction: 'slam', gap: 0.24 },
      { move: 'slideUnder', reaction: 'flipOver', gap: 0.26, enemyAttack: 'sweep' },
      { move: 'spin', reaction: 'spinOut', gap: 0.2 },
      { move: 'divingSlash', reaction: 'blowAway', gap: 0.3 },
    ],
  },
];

/** The golden target: one showy kill, usually from distance. */
const RARE: readonly Sequence[] = [
  {
    id: 'thrown-steel',
    beats: [{ move: 'bladeThrow', reaction: 'blowAway', gap: 0.45, enemyAttack: 'chop' }],
  },
  {
    id: 'from-above',
    beats: [{ move: 'aerialThrow', reaction: 'blowAway', gap: 0.45, enemyAttack: 'shuriken' }],
  },
  {
    id: 'tornado',
    beats: [{ move: 'tornado', reaction: 'spinOut', gap: 0.45, enemyAttack: 'spinCut' }],
  },
];

/** The Flow finisher: three bodies, ending on the heaviest move in the set. */
const FINISHER: readonly Sequence[] = [
  {
    id: 'finish-ground',
    beats: [
      { move: 'dashThrough', reaction: 'spinOut', gap: 0.24, enemyAttack: 'chop' },
      { move: 'vaultOver', reaction: 'juggle', gap: 0.26, enemyAttack: 'sweep' },
      { move: 'groundPound', reaction: 'blowAway', gap: 0.34 },
    ],
  },
  {
    id: 'finish-air',
    beats: [
      { move: 'slideUnder', reaction: 'flipOver', gap: 0.24, enemyAttack: 'lunge' },
      { move: 'aerialThrow', reaction: 'slam', gap: 0.3, enemyAttack: 'leapStrike' },
      { move: 'divingSlash', reaction: 'blowAway', gap: 0.34 },
    ],
  },
];

const POOLS: Record<MomentKind, readonly Sequence[]> = {
  good: SINGLE,
  perfect: WAVE,
  rare: RARE,
  finisher: FINISHER,
};

const cursors: Record<MomentKind, number> = { good: 0, perfect: 0, rare: 0, finisher: 0 };

/**
 * Picks the scene for one moment and fits it to the number of bodies staged.
 * Sequences rotate rather than roll, so consecutive deaths look different and
 * nothing is drawn from the seeded gameplay stream.
 */
export function choreographyFor(kind: MomentKind, count: number): ChoreoBeat[] {
  const pool = POOLS[kind];
  const seq = pool[cursors[kind]++ % pool.length];
  const beats: ChoreoBeat[] = [];
  for (let i = 0; i < count; i++) {
    // Short waves keep the opening beats; a wave longer than the scene loops
    // back through its middle, never repeating the opener or the finish.
    const source =
      i < seq.beats.length
        ? seq.beats[i]
        : seq.beats[1 + ((i - 1) % Math.max(1, seq.beats.length - 1))];
    beats.push({ ...source });
  }
  // Whatever the length, the last body always takes the sequence's closer.
  beats[beats.length - 1] = { ...seq.beats[seq.beats.length - 1] };
  return beats;
}

/** Test hook: rewinds the rotations so sequence choice is reproducible. */
export function resetChoreography(): void {
  cursors.good = 0;
  cursors.perfect = 0;
  cursors.rare = 0;
  cursors.finisher = 0;
}

export const SEQUENCES = { SINGLE, WAVE, RARE, FINISHER } as const;
