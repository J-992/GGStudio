import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { DRAFT_CARDS, DRAFT_CARD_ORDER, drawCards, type DraftCardId } from '../src/data/draftCards';
import { DraftSystem } from '../src/systems/DraftSystem';

/** Deterministic rolls, consumed in order and then repeated. */
const rolls = (...values: number[]): (() => number) => {
  let index = 0;
  return (): number => values[index++ % values.length]!;
};

/** A run where every card in the pool can do something, so the draw is unconstrained. */
const healthy = {
  boardHasFreeSlot: true, boardHasFighter: true, healthRatio: 1,
  boardHasDebris: true, boardHasLockedSlot: true, bossHasTrick: true, canBreakthrough: true,
};

describe('draft draw', () => {
  it('offers three distinct cards, and therefore three distinct shapes', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const cards = drawCards(healthy, rolls(seed / 40, (seed * 7 % 40) / 40, (seed * 13 % 40) / 40));
      expect(cards).toHaveLength(BALANCE.draft.cards);
      expect(new Set(cards).size).toBe(BALANCE.draft.cards);
      expect(new Set(cards.map((id) => DRAFT_CARDS[id].shape)).size).toBe(BALANCE.draft.cards);
    }
  });

  it('reaches every card in the pool across many offers', () => {
    const seen = new Set<DraftCardId>();
    for (let seed = 0; seed < 400; seed += 1) {
      const r = rolls((seed % 97) / 97, ((seed * 31) % 89) / 89, ((seed * 17) % 83) / 83, ((seed * 7) % 71) / 71);
      drawCards(healthy, r).forEach((id) => seen.add(id));
    }
    expect([...seen].sort()).toEqual([...DRAFT_CARD_ORDER].sort());
  });

  it('never offers a drill with nobody on the board to promote', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const cards = drawCards(
        { ...healthy, boardHasFreeSlot: true, boardHasFighter: false, healthRatio: 1 },
        rolls(seed / 40, (seed * 7 % 40) / 40, (seed * 13 % 40) / 40),
      );
      expect(cards).not.toContain('drill');
      expect(cards).toHaveLength(BALANCE.draft.cards);
    }
  });

  it('still fills the row when a whole shape is unavailable', () => {
    // Nothing on the board and nowhere to put anything: tempo empties out
    // entirely, and the offer has to come from the four shapes that are left.
    const cards = drawCards(
      { ...healthy, boardHasFreeSlot: false, boardHasFighter: false, healthRatio: 1 },
      rolls(0.1, 0.4, 0.8, 0.2),
    );
    expect(cards).toHaveLength(BALANCE.draft.cards);
    cards.forEach((id) => expect(DRAFT_CARDS[id].shape).not.toBe('tempo'));
  });

  it('never offers a recruit the board has nowhere to put', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const cards = drawCards(
        { ...healthy, boardHasFreeSlot: false, boardHasFighter: true, healthRatio: 1 },
        rolls(seed / 40, (seed * 7 % 40) / 40, (seed * 13 % 40) / 40),
      );
      expect(cards).not.toContain('recruit');
      expect(cards).toHaveLength(BALANCE.draft.cards);
    }
  });

  it('draws the defensive shape more often while the line is hurt', () => {
    const sample = (healthRatio: number): number => {
      let seen = 0;
      for (let i = 0; i < 300; i += 1) {
        const r = rolls((i % 97) / 97, ((i * 31) % 89) / 89, ((i * 17) % 83) / 83);
        const cards = drawCards({ ...healthy, healthRatio }, r);
        if (cards.some((id) => DRAFT_CARDS[id].shape === 'defensive')) seen += 1;
      }
      return seen;
    };

    expect(sample(0.2)).toBeGreaterThan(sample(1));
  });

  it('holds back the cards that would do nothing in the state the run is in', () => {
    const cases: Array<[Partial<typeof healthy>, string]> = [
      [{ boardHasDebris: false }, 'sweep'],
      [{ boardHasLockedSlot: false }, 'openMat'],
      [{ bossHasTrick: false }, 'disarm'],
      [{ boardHasFreeSlot: false }, 'echo'],
      [{ boardHasFighter: false }, 'echo'],
      [{ canBreakthrough: false }, 'breakthrough'],
    ];
    for (const [state, forbidden] of cases) {
      for (let seed = 0; seed < 60; seed += 1) {
        const cards = drawCards(
          { ...healthy, ...state },
          rolls(seed / 60, (seed * 7 % 60) / 60, (seed * 13 % 60) / 60),
        );
        expect(cards).not.toContain(forbidden);
        // A shape emptied by ineligibility is skipped, never padded or repeated.
        expect(new Set(cards).size).toBe(cards.length);
      }
    }
  });

  it('is deterministic for a given sequence of rolls', () => {
    const seed = (): (() => number) => rolls(0.31, 0.72, 0.09);
    expect(drawCards(healthy, seed())).toEqual(drawCards(healthy, seed()));
  });

  it('returns every eligible card rather than repeating when the pool is short', () => {
    const cards = drawCards(healthy, rolls(0.999_999_999));
    expect(new Set(cards).size).toBe(cards.length);
    cards.forEach((id) => expect(DRAFT_CARD_ORDER).toContain(id));
  });
});

describe('draft system', () => {
  const build = (): { draft: DraftSystem; taken: Array<{ card: DraftCardId; auto: boolean }> } => {
    const taken: Array<{ card: DraftCardId; auto: boolean }> = [];
    const draft = new DraftSystem({ resolved: (_stage, card, auto) => taken.push({ card, auto }) });
    return { draft, taken };
  };

  it('takes the leftmost card when the offer runs out of time', () => {
    const { draft, taken } = build();
    draft.present(4, ['edge', 'purse', 'mend']);

    draft.update(BALANCE.draft.autoPickMs - 1);
    expect(taken).toHaveLength(0);
    expect(draft.warning).toBe(true);

    draft.update(1);
    expect(taken).toEqual([{ card: 'edge', auto: true }]);
    expect(draft.pending).toBeNull();
  });

  it('resolves a player pick and stops the clock', () => {
    const { draft, taken } = build();
    draft.present(4, ['edge', 'purse', 'mend']);

    expect(draft.pick('mend')).toBe(true);
    expect(taken).toEqual([{ card: 'mend', auto: false }]);

    draft.update(BALANCE.draft.autoPickMs * 2);
    expect(taken).toHaveLength(1);
  });

  it('ignores a tap on a card that is not on offer', () => {
    const { draft, taken } = build();
    draft.present(4, ['edge', 'purse']);

    expect(draft.pick('bounty')).toBe(false);
    expect(taken).toHaveLength(0);
    expect(draft.pending).not.toBeNull();
  });

  it('resolves a standing offer before replacing it, so no reward is dropped', () => {
    const { draft, taken } = build();
    draft.present(4, ['edge', 'purse', 'mend']);
    draft.present(5, ['bounty', 'recruit', 'purse']);

    expect(taken).toEqual([{ card: 'edge', auto: true }]);
    expect(draft.pending?.stage).toBe(5);
  });

  it('runs the bounty down in real time and pays at most once', () => {
    const { draft } = build();
    draft.armBounty();
    expect(draft.bountyActive).toBe(true);

    draft.update(BALANCE.draft.bountyWindowMs - 1);
    expect(draft.consumeBounty()).toBe('bounty');
    expect(draft.consumeBounty()).toBeNull();

    draft.armBounty();
    draft.update(BALANCE.draft.bountyWindowMs);
    expect(draft.bountyActive).toBe(false);
    expect(draft.consumeBounty()).toBeNull();
  });

  it('runs the steeper wager on its own shorter window', () => {
    const { draft } = build();
    draft.armBounty('wager');
    expect(draft.bountyWindowMs).toBe(BALANCE.draft.wagerWindowMs);
    expect(BALANCE.draft.wagerWindowMs).toBeLessThan(BALANCE.draft.bountyWindowMs);
    expect(BALANCE.draft.wagerMultiplier).toBeGreaterThan(BALANCE.draft.bountyMultiplier);

    draft.update(BALANCE.draft.wagerWindowMs - 1);
    expect(draft.consumeBounty()).toBe('wager');
  });

  it('drops the offer and any standing bet on a reset', () => {
    const { draft, taken } = build();
    draft.present(4, ['edge', 'purse']);
    draft.armBounty();
    draft.reset();

    expect(draft.pending).toBeNull();
    expect(draft.bountyActive).toBe(false);
    draft.update(BALANCE.draft.autoPickMs * 2);
    expect(taken).toHaveLength(0);
  });
});
