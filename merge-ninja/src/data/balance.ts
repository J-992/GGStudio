export interface OfflineConfig {
  minMs: number;
  capMs: number;
  rate: number;
}

/**
 * The damage ladder, expressed as config instead of a literal baked into the
 * roster file.
 *
 * `dps(tier) = round(dpsBase * dpsGrowth ** (tier - 1))`.
 *
 * dpsBase is deliberately 3 rather than 1: with a base of 1 the first merge
 * maps 1+1 -> round(G), which quantizes to either "no gain" or "+50%", and no
 * tolerance band can absorb both. Starting at 3 keeps every tier value large
 * enough that rounding stays inside the merge-spike band from the very first
 * pair (asserted per pair in tests/combat.test.ts).
 *
 * A merge spends two tier-N ninjas on one tier-(N+1) ninja, so the board's
 * total DPS multiplies by roughly `dpsGrowth / 2` per merge. That ratio is
 * the felt "power spike" of the core verb, so it is named here directly:
 * 2.4 / 2 gives a +20% spike, comfortably inside the 15-45% design window,
 * while keeping tier 29 near 5.5e10 -- readable as "55B" through
 * compactNumber's K/M/B suffixes with no bare 13-digit integers anywhere.
 */
export const BALANCE = {
  board: { rows: 3, cols: 4, slots: 12 },
  progression: {
    dpsBase: 3,
    dpsGrowth: 2.4,
    /** Intended total-board-DPS multiple of one merge (two tier-N -> one tier-N+1). */
    mergeSpikeTarget: 1.2,
    /** How far any individual adjacent pair may sit from that target. */
    mergeSpikeTolerance: 0.05,
  },
  economy: {
    // Covers the first two buys so the opening merge needs no waiting.
    startCoins: 38,
    baseCost: 18,
    // Gentle per-purchase inflation. The sustainability contract sits between
    // the two multipliers below and progression.dpsGrowth: a climbing player's
    // earn rate multiplies by ~2.4 per champion tier, so the blended price of
    // a shop unit (tierCostMultiplier times costGrowth raised to the purchases
    // made per tier) has to hover just under that. Too far under and the run
    // sprints to tier 29 before the ten-minute checkpoint with nothing left to
    // chase; over it and purchases collapse from 30+/min to 1/min and the line
    // dies hungry -- both failure modes caught by tests/pacing.test.ts.
    // 2.1 * 1.03^(~6 buys per tier) ~= 2.5 throttles buying to a self-limiting
    // trickle that still feeds the merge ladder for the full session.
    costGrowth: 1.03,
    tierCostMultiplier: 2.1,
    sellRefund: 0.5,
  },
  buyTier: { offset: 4 },
  tiers: {
    // The approved roster is intentionally compact: every merge reveals a
    // visibly stronger supplied character instead of padding the climb with
    // near-duplicates.
    count: 29,
    healthBase: 20,
    healthGrowth: 1.23,
  },
  boss: {
    baseHp: 30,
    // 1.30^3 ~= 2.2, a shade under the ~2.4 per-tier DPS growth, so a climbing
    // player meets about three bosses per champion tier and time-to-kill eases
    // slightly downward instead of creeping up.
    hpGrowth: 1.3,
    defeatBonus: 18,
    defeatBonusGrowth: 1.12,
    coinsPerDamage: 0.42,
    fixedTickMs: 100,
    defeatDelayMs: 450,
    attackIntervalMs: 2050,
    attackDamage: 8,
    attackDamageGrowth: 1.055,
    /**
     * A player's manual tap always removes a visible slice of the current
     * boss, independent of late-game health scaling. This is intentionally a
     * generous playtest value so the click loop can be judged in context.
     */
    playerTapHealthShare: 0.01,
    scale: 1.5,
  },
  player: {
    baseHealth: 120,
    healthPerTier: 9,
    bossVictoryHealRatio: 0.3,
    /** At or below this share of health the screen edges pulse red. */
    lowHealthRatio: 0.1,
    /**
     * The most one boss swing may ever take off the line, as a share of its
     * maximum.
     *
     * Boss strike power compounds per stage while the line's health only grows
     * with the roster, so an uncapped swing eventually one-shots any player who
     * is even slightly behind -- a run ends because of arithmetic rather than
     * because of a decision. Capped, a full line takes minutes of completely
     * unanswered swings to fall, so death arrives the honest way: DPS that
     * stopped killing bosses fast enough to keep the victory heals coming.
     * The raw strike curve only shapes the first handful of stages; from there
     * every hit rides the cap, and the cap alone decides incoming damage. The
     * value has to sit low enough that a mid-slide run (victories spaced to
     * half a minute apart) still out-heals the chip damage between kills --
     * the pacing suite failed a 0.018 cap with a death at nineteen minutes on
     * exactly that arithmetic.
     */
    maxHitShare: 0.013,
  },
  fx: { hintIdleMs: 4500, mergeDuration: 550 },
  save: { key: 'mergeninja.save.v1', metaKey: 'mergeninja.meta.v1', version: 5, flushMs: 1000 },
  offline: {
    /** A quick refresh is not an absence; anything shorter earns nothing. */
    minMs: 60_000,
    /** The longest absence the dojo will pay for. */
    capMs: 45 * 60_000,
    /**
     * Offline time pays a reduced share of the active earn rate, so coming
     * back feels rewarded but playing stays strictly better.
     */
    rate: 0.5,
  },
  ascension: {
    /** Coin-income share granted by the first ascension. */
    incomeBonusFirst: 0.08,
    /** Each further ascension adds this share of what the previous one added. */
    incomeBonusDecay: 0.85,
    /** Ceiling on the total income bonus from stacked ascensions. */
    maxIncomeBonus: 0.8,
  },
  /**
   * The welcome-back gift for a new calendar day.
   *
   * Deliberately not a streak: nothing is ever lost by missing a day, there is
   * no counter to protect and no reminder to come back, so the bonus can only
   * ever be a nice surprise. It pays a few minutes of the player's own earn
   * rate so it stays meaningful late, with a floor that matters early, when
   * that rate is still near zero.
   */
  daily: {
    /** Seconds of the player's live earn rate paid on the first visit of a day. */
    secondsOfIncome: 240,
    /** Paid instead whenever the rate-based amount would be smaller. */
    minCoins: 120,
  },
} as const;

if (BALANCE.board.slots !== BALANCE.board.rows * BALANCE.board.cols) {
  throw new Error('Board slots must equal rows multiplied by columns');
}

/** The sell value is exactly half of the tier's base shop price. */
export function sellValueOf(tier: number): number {
  return Math.round(
    Math.round(BALANCE.economy.baseCost * BALANCE.economy.tierCostMultiplier ** (tier - 1)) *
      BALANCE.economy.sellRefund,
  );
}
