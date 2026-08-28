/**
 * The three cards offered on every fifth boss kill.
 *
 * Pure data: what exists, how it reads, and how often it is drawn. The draw
 * itself and the effects live in `systems/DraftSystem.ts` so this file stays
 * readable by the unit runner and by anyone balancing the pool.
 *
 * Every card is a different *shape* of answer -- money, tempo, a bet, a heal,
 * a hit, the board, the boss -- and a draw never offers two of one shape. That
 * is what keeps a three-card row a decision rather than three numbers.
 */

import { BALANCE } from './balance';
import { POWERUPS } from './powerups';
import { FX_FRAMES } from '../render/atlasConfig';

export type DraftCardId =
  | 'purse' | 'focus'
  | 'recruit' | 'breakthrough' | 'drill'
  | 'bounty' | 'wager' | 'hotHand'
  | 'mend' | 'ward'
  | 'edge' | 'barrage'
  | 'sweep' | 'openMat' | 'echo'
  | 'disarm' | 'stagger';

/**
 * `board` cards change the mat the player works on; `counter` cards answer the
 * boss standing in front of them. Both were added because the first ten cards
 * were all "a number goes up now", and the pacing sim has rejected every
 * further attempt to sell damage: free DPS races the stage ladder ahead of the
 * roster that has to kill it. Space and time are the two things this game can
 * hand over without distorting its own curve.
 */
export type DraftShape = 'safe' | 'tempo' | 'gamble' | 'defensive' | 'aggressive' | 'board' | 'counter';

/**
 * Which artwork the card face wears.
 *
 * `ninja` and `boss` resolve at draw time against the live run, so `recruit`
 * shows the fighter it will actually hand over and `bounty` shows the boss it
 * is betting on. Neither costs a new texture.
 */
export type DraftIcon =
  /** A frame in the shared atlas. */
  | { readonly kind: 'frame'; readonly frame: string }
  /** A standalone texture BootScene already loads for a pickup. */
  | { readonly kind: 'texture'; readonly key: string }
  | { readonly kind: 'ninja' }
  /** The exact unseen fighter `breakthrough` will grant. */
  | { readonly kind: 'breakthrough' }
  | { readonly kind: 'weakest' }
  | { readonly kind: 'strongest' }
  | { readonly kind: 'boss' };

export interface DraftCardDef {
  readonly id: DraftCardId;
  readonly shape: DraftShape;
  /** UPPERCASE-safe card title; renderers may lowercase but never widen it. */
  readonly label: string;
  /**
   * One short line under the title.
   *
   * UPPERCASE like every other string this game draws: the `pixel` bitmap font
   * carries no lowercase glyphs, so mixed case renders as gaps. Kept free of
   * numbers, which the balance owns and would go stale here.
   */
  readonly blurb: string;
  readonly icon: DraftIcon;
  /** Base draw weight before any state-driven adjustment. */
  readonly weight: number;
}

export const DRAFT_CARDS: Readonly<Record<DraftCardId, DraftCardDef>> = {
  purse: {
    id: 'purse', shape: 'safe', label: 'FULL PURSE',
    blurb: 'A BIGGER REWARD, NOW',
    icon: { kind: 'frame', frame: FX_FRAMES.coin }, weight: 10,
  },
  focus: {
    id: 'focus', shape: 'safe', label: 'FOCUS',
    blurb: 'YOUR NEXT MERGES HIT HARDER',
    icon: { kind: 'frame', frame: FX_FRAMES.star }, weight: 9,
  },
  recruit: {
    id: 'recruit', shape: 'tempo', label: 'RECRUIT',
    blurb: 'A FIGHTER JOINS YOU',
    icon: { kind: 'ninja' }, weight: 10,
  },
  breakthrough: {
    id: 'breakthrough', shape: 'tempo', label: 'SECRET ART',
    blurb: 'TWO TIERS ABOVE YOUR BEST',
    icon: { kind: 'breakthrough' }, weight: 2,
  },
  drill: {
    id: 'drill', shape: 'tempo', label: 'DRILL',
    blurb: 'PROMOTE YOUR WEAKEST',
    icon: { kind: 'weakest' }, weight: 9,
  },
  bounty: {
    id: 'bounty', shape: 'gamble', label: 'BOUNTY',
    blurb: 'TRIPLE PAY IF YOU ARE FAST',
    icon: { kind: 'boss' }, weight: 8,
  },
  wager: {
    id: 'wager', shape: 'gamble', label: 'WAGER',
    blurb: 'FIVE TIMES PAY, HALF THE TIME',
    icon: { kind: 'frame', frame: FX_FRAMES.ring }, weight: 7,
  },
  mend: {
    id: 'mend', shape: 'defensive', label: 'MEND',
    blurb: 'PATCH UP THE LINE',
    // The potion the player already catches in the arena, so the card and the
    // pickup that does the same thing wear the same face.
    icon: { kind: 'frame', frame: 'icon_potion' }, weight: 8,
  },
  ward: {
    id: 'ward', shape: 'defensive', label: 'WARD',
    blurb: 'BLOCK THE NEXT THREE HITS',
    icon: { kind: 'texture', key: POWERUPS.protectiveWard.iconTexture }, weight: 8,
  },
  edge: {
    id: 'edge', shape: 'aggressive', label: 'SHARP EDGE',
    blurb: 'THE DOJO HITS HARDER',
    icon: { kind: 'frame', frame: FX_FRAMES.slash }, weight: 9,
  },
  barrage: {
    id: 'barrage', shape: 'aggressive', label: 'BARRAGE',
    blurb: 'TEAR A CHUNK OFF THIS BOSS',
    icon: { kind: 'frame', frame: FX_FRAMES.spark }, weight: 9,
  },
  sweep: {
    id: 'sweep', shape: 'board', label: 'SWEEP',
    blurb: 'CLEAR THE MAT OF DEBRIS',
    // The bin the player already drags fighters into: the card and the thing
    // that removes clutter from the board wear the same face.
    icon: { kind: 'frame', frame: 'icon_trash' }, weight: 10,
  },
  openMat: {
    id: 'openMat', shape: 'board', label: 'OPEN MAT',
    blurb: 'A LOCKED SLOT OPENS NOW',
    // The board's own stone tile: an empty square of mat, which is exactly
    // what the card hands over.
    icon: { kind: 'frame', frame: 'tile_stone' }, weight: 9,
  },
  echo: {
    id: 'echo', shape: 'board', label: 'ECHO',
    blurb: 'COPY YOUR BEST FIGHTER',
    icon: { kind: 'strongest' }, weight: 8,
  },
  disarm: {
    id: 'disarm', shape: 'counter', label: 'DISARM',
    blurb: 'STRIP THIS BOSS OF ITS TRICK',
    // The smoke bomb the player already throws to shut a boss down.
    icon: { kind: 'texture', key: POWERUPS.smokeBomb.iconTexture }, weight: 9,
  },
  stagger: {
    id: 'stagger', shape: 'counter', label: 'STAGGER',
    blurb: 'THE BOSS CANNOT SWING BACK',
    icon: { kind: 'frame', frame: 'icon_clock' }, weight: 9,
  },
  hotHand: {
    id: 'hotHand', shape: 'gamble', label: 'HOT HAND',
    blurb: 'THE NEXT BOSSES DEAL CARDS TOO',
    icon: { kind: 'texture', key: POWERUPS.luckyCharm.iconTexture }, weight: 6,
  },
};

export const DRAFT_CARD_ORDER: readonly DraftCardId[] = [
  'purse', 'focus',
  'recruit', 'breakthrough', 'drill',
  'bounty', 'wager', 'hotHand',
  'mend', 'ward',
  'edge', 'barrage',
  'sweep', 'openMat', 'echo',
  'disarm', 'stagger',
];

/**
 * Draw order for shapes; the row always offers three different kinds of answer.
 *
 * Also the pip order printed in the card's corners, so a shape's cards always
 * wear the same number of marks and a player learns the families without any
 * of them being named.
 */
export const DRAFT_SHAPE_ORDER: readonly DraftShape[] = [
  'safe', 'tempo', 'gamble', 'defensive', 'aggressive', 'board', 'counter',
];

/**
 * How often each shape is drawn, before the health-driven adjustment.
 *
 * The first five shapes are the run's engine: money, tempo, a bet, a heal, a
 * hit. `board` and `counter` are situational answers, and at an even weight
 * they diluted that engine enough for the twenty-minute pacing sim to stall at
 * 20.9s against a 20.1s bound -- the drafting player was being handed clever
 * cards when what the run needed was the next purchase. Drawn less often they
 * add variety without taking the offer away from the cards that carry a run.
 */
export const DRAFT_SHAPE_WEIGHT: Readonly<Record<DraftShape, number>> = {
  safe: 1, tempo: 1, gamble: 1, defensive: 1, aggressive: 1,
  board: 0.55, counter: 0.55,
};

export function draftCard(id: DraftCardId): DraftCardDef {
  return DRAFT_CARDS[id];
}

export function isDraftCardId(value: unknown): value is DraftCardId {
  return typeof value === 'string' && value in DRAFT_CARDS;
}

/** What the draw needs to know about the run to make an offer feel authored. */
export interface DraftDrawState {
  /** False when every board slot is taken, locked, or blocked. */
  readonly boardHasFreeSlot: boolean;
  /** False when the board is empty, which is the only time `drill` has nothing to promote. */
  readonly boardHasFighter: boolean;
  /** 0..1. Below `draft.mendUrgentRatio` the defensive shape is drawn more often. */
  readonly healthRatio: number;
  /** False when no slot is blocked, which is the only time `sweep` has nothing to clear. */
  readonly boardHasDebris: boolean;
  /** False once the whole board is earned, which is the only time `openMat` is empty. */
  readonly boardHasLockedSlot: boolean;
  /** False against a bare boss, which is the only time `disarm` has no trick to take. */
  readonly bossHasTrick: boolean;
  /** False when fewer than two undiscovered roster tiers remain. */
  readonly canBreakthrough: boolean;
}

/** Cards that cannot do anything useful in the state the run is actually in. */
function eligible(id: DraftCardId, state: DraftDrawState): boolean {
  if (id === 'recruit') return state.boardHasFreeSlot;
  if (id === 'breakthrough') return state.boardHasFreeSlot && state.canBreakthrough;
  if (id === 'drill') return state.boardHasFighter;
  if (id === 'echo') return state.boardHasFreeSlot && state.boardHasFighter;
  if (id === 'sweep') return state.boardHasDebris;
  if (id === 'openMat') return state.boardHasLockedSlot;
  if (id === 'disarm') return state.bossHasTrick;
  return true;
}

/**
 * Picks the cards for one offer.
 *
 * Shapes are drawn first and a card is chosen inside each, rather than drawing
 * three cards out of one flat pool. With ten cards across five shapes a flat
 * draw would happily deal three different ways to make money, which is three
 * cards and one decision. Shape-first guarantees the row always asks the player
 * to choose between genuinely different kinds of answer, and it means the pool
 * can keep growing without the offer getting mushier.
 *
 * A card that cannot do anything -- `recruit` with nowhere to stand, `drill`
 * with nobody to promote -- is dropped before the draw, and its whole shape is
 * skipped if that empties it. An offer the player cannot take is worse than one
 * fewer choice.
 *
 * Pure and total: fewer eligible shapes than `draft.cards` returns everything
 * eligible rather than padding or repeating.
 */
export function drawCards(state: DraftDrawState, rng: () => number): DraftCardId[] {
  const roll = (): number => Math.min(Math.max(rng(), 0), 0.999_999_999);
  const pickWeighted = <T>(from: ReadonlyArray<{ value: T; weight: number }>): T | null => {
    const total = from.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return null;
    let target = roll() * total;
    for (let index = 0; index < from.length - 1; index += 1) {
      const entry = from[index]!;
      if (target < entry.weight) return entry.value;
      target -= entry.weight;
    }
    return from[from.length - 1]?.value ?? null;
  };

  const shapes = DRAFT_SHAPE_ORDER
    .map((shape) => ({
      value: shape,
      cards: DRAFT_CARD_ORDER.filter((id) => DRAFT_CARDS[id].shape === shape && eligible(id, state)),
    }))
    .filter((entry) => entry.cards.length > 0)
    .map((entry) => ({
      ...entry,
      // The one shape that answers the current problem is drawn more often, so
      // a fixed pool still reads as an offer that noticed how the run is going.
      weight: entry.value === 'defensive' && state.healthRatio < BALANCE.draft.mendUrgentRatio
        ? BALANCE.draft.mendUrgentWeight
        : DRAFT_SHAPE_WEIGHT[entry.value],
    }));

  const picked: DraftCardId[] = [];
  while (picked.length < BALANCE.draft.cards && shapes.length > 0) {
    const shape = pickWeighted(shapes);
    if (shape === null) break;
    const index = shapes.findIndex((entry) => entry.value === shape);
    const chosen = shapes[index]!;
    shapes.splice(index, 1);
    const card = pickWeighted(chosen.cards.map((id) => ({ value: id, weight: DRAFT_CARDS[id].weight })));
    if (card !== null) picked.push(card);
  }
  return picked;
}
