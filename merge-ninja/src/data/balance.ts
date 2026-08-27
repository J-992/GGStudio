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
    /** Immediate boss-health slice carved out by the core merge action. */
    mergeStrikeHealthShare: 0.08,
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
  fx: { hintIdleMs: 2800, mergeDuration: 550 },
  /**
   * The one decision the loop was missing.
   *
   * Three cards on every boss kill, offered without pausing the simulation:
   * DPS keeps ticking and the next boss still spawns on `boss.defeatDelayMs`,
   * so an offer can never become a stall. `autoPickMs` deliberately outlives
   * that delay -- a player who ignores the cards entirely watches the fight
   * carry on underneath them and the leftmost card resolves itself.
   */
  draft: {
    cards: 3,
    /**
     * Cards are offered on every fifth boss, not every boss.
     *
     * A choice that arrives constantly stops being a choice: the row became
     * chrome to tap through rather than a decision to make, and it kept the
     * arena covered more often than not. Spaced out, the offer is an event the
     * player can see coming -- and it can afford to matter more when it lands.
     */
    everyStages: 5,
    autoPickMs: 4_000,
    /** The card about to be taken pulses for this long first, so it never feels stolen. */
    autoPickWarnMs: 500,
    /** `purse` pays this multiple of the boss reward just earned. */
    purseMultiplier: 1.6,
    /** `recruit` spawns this far above the current buy tier. */
    recruitTierBonus: 1,
    /** `bounty` multiplies the next boss reward, but only if it dies in time. */
    bountyWindowMs: 20_000,
    bountyMultiplier: 3,
    /** `mend` restores this share of the line's maximum health. */
    mendHealRatio: 0.35,
    /** `edge` multiplies board DPS for this long. */
    edgeMultiplier: 1.4,
    edgeDurationMs: 25_000,
    /**
     * `focus`: this many merges land a heavier strike on the boss.
     *
     * The safe shape carries exactly one money card, and this is why. Any coin
     * gift raises `totalPurchases`, `economy.costGrowth` compounds on that, and
     * the shop is permanently dearer for the rest of the run -- the drafting
     * pacing run stalled at 24.2s on a second money card worth four purchases,
     * and at 24.7s on one worth half a minute of income. `purse` survives
     * because it pays a multiple of the boss reward, which grows at 1.12 per
     * stage against a blended cost curve near 2.5 per tier, so it shrinks in
     * real terms exactly as fast as it would otherwise distort. A guaranteed
     * non-monetary reward gives the shape its second card without touching the
     * economy at all.
     */
    focusMerges: 3,
    focusStrikeMultiplier: 2.5,
    /** `wager` is the steeper bet: more pay, less time. */
    wagerWindowMs: 12_000,
    wagerMultiplier: 5,
    /** `barrage` takes this share off the boss on the spot. */
    barrageHealthShare: 0.25,
    /** `drill` promotes this many of the board's weakest fighters. */
    drillCount: 1,
    /**
     * `stagger`: the boss cannot swing for this long.
     *
     * Bought as breathing room, not as damage. The pacing sim has rejected
     * every free-DPS card put in front of it -- the ladder outruns the roster
     * that has to kill it -- so the counter shape pays in time instead.
     */
    staggerMs: 7_000,
    /**
     * `hotHand`: this many of the following bosses deal cards off the cadence.
     *
     * Two, not three: the row is authored as an event the player sees coming
     * every fifth boss, and a card that turns it into a stream would spend the
     * anticipation the cadence exists to build.
     */
    hotHandBosses: 2,
    /**
     * Below this health share `mend` is drawn this many times more often.
     *
     * A pool that ignores the player's state produces offers that read as
     * random; weighting the one card that answers the current problem makes
     * the same three slots feel authored.
     */
    mendUrgentRatio: 0.5,
    mendUrgentWeight: 3,
  },
  /**
   * What makes stage N different from stage N-1 beyond a larger number.
   *
   * Each modifier is introduced alone, at its easiest setting, on a stage the
   * player reaches with a comfortable board -- that first encounter is the
   * entire tutorial for it. Below `restBeatUntilStage` a modified boss is
   * always followed by a plain one, because back-to-back modifiers read as
   * difficulty rather than variety.
   */
  archetypes: {
    /** Everything below this is plain: the opening ladder teaches merging alone. */
    shieldedFromStage: 8,
    enragedFromStage: 14,
    greedyFromStage: 20,
    restBeatUntilStage: 25,
    shield: {
      /** charges = ceil(stage / stageDivisor), capped; the introduction is always 1. */
      stageDivisor: 6,
      maxCharges: 8,
      /**
       * How long the whole barrier takes to fall on its own, at any charge
       * count.
       *
       * Tapping is the fast way through and is what the archetype teaches, but
       * it can never be the *only* way: a player who does not tap would meet a
       * boss they cannot pass at all, which is a wall, not a lesson. The
       * pacing sim found exactly that -- a 566-second stall at stage 8 -- so
       * the barrier now sheds its charges evenly across this window whatever
       * the player does. Tapping still clears it in about a second.
       */
      decayMs: 9_000,
      /** Barrier segments drawn around the boss; the charge count is read from the shape. */
      segments: 6,
    },
    enrage: {
      /** Share of maximum health regained per second while no merge has landed. */
      regenPerSec: 0.02,
      windowMs: 8_000,
      /** The introduction instance gives nearly half again as long to answer. */
      firstWindowMs: 12_000,
    },
    greed: {
      windowMs: 20_000,
      firstWindowMs: 30_000,
      rewardMultiplier: 3,
    },
  },
  /**
   * The boss finally reaching the board.
   *
   * `player.maxHitShare` capped incoming damage so hard that a swing became
   * invisible; the same swing now costs the player a slot for a few seconds
   * instead. Pressure is paid in space and time, never in progress -- nothing
   * here can destroy a ninja the player bought.
   */
  debris: {
    startStage: 12,
    holdMs: 12_000,
    maxConcurrent: 2,
    /** Debris never takes the board below this many usable empty slots. */
    minFreeSlots: 2,
    /** Share of swings that throw, ramped by stage to a ceiling. */
    chanceBase: 0.25,
    chancePerStage: 0.01,
    chanceMax: 0.55,
    /** Nothing is thrown for this long after an ascension, or during the tutorial. */
    graceMs: 20_000,
  },
  /**
   * Rewards the player earns instead of waits for.
   *
   * Powerup spawn cadence in `powerups.ts` is unchanged; these grants sit on
   * top of it as a ceiling, so a player who never chains is never starved.
   */
  combo: {
    /** A merge inside this window of the previous one extends the chain. */
    windowMs: 3_000,
    /** Chain length that earns a powerup outright. */
    rewardAt: 4,
    /** Taps inside the combat director's own streak window that earn one. */
    tapRewardAt: 25,
  },
  /**
   * Board space as a reward rather than a given.
   *
   * Six slots is comfortably enough to reach the first unlock, and every
   * unlock lands inside the stage band where the funnel showed players
   * leaving. The locked cells keep their places in the 3x4 grid: the layout
   * never changes shape, and a visibly boarded-over slot advertises the next
   * reward in a way a smaller board cannot.
   */
  slots: {
    /**
     * Eight, not six.
     *
     * Six was the plan, and the pacing sim rejected it: the opening minute
     * stalled past the attention span in two runs out of three, because a
     * board that small fills before the player can merge their way out of it
     * and `canBuy` then has nowhere to put a purchase. Locking slots is meant
     * to make space feel earned, not to make the first minute a waiting game.
     * Eight keeps the opening exactly as it was and still leaves four unlocks
     * to spend across the stages where the funnel says players leave.
     */
    initial: 8,
    unlockStages: [10, 16, 22, 28],
  },
  save: { key: 'mergeninja.save.v1', metaKey: 'mergeninja.meta.v1', version: 6, flushMs: 1000 },
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

if (BALANCE.slots.initial + BALANCE.slots.unlockStages.length !== BALANCE.board.slots) {
  throw new Error('Starting slots plus unlocks must account for every board slot');
}

/** The sell value is exactly half of the tier's base shop price. */
export function sellValueOf(tier: number): number {
  return Math.round(
    Math.round(BALANCE.economy.baseCost * BALANCE.economy.tierCostMultiplier ** (tier - 1)) *
      BALANCE.economy.sellRefund,
  );
}
