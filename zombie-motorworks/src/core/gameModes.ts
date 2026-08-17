/**
 * The four ways to start a run, and what each one changes about the rules.
 *
 * Everything downstream — the title screen's cards, the survival director, the
 * garage's wallet — reads its behaviour off one of these definitions rather
 * than testing a mode id, so adding a fifth mode is a matter of describing it
 * here and nothing else has to learn its name.
 */

export type GameModeId = 'campaign' | 'daily' | 'endless' | 'creative';

export interface GameModeDefinition {
  id: GameModeId;
  /** Menu label. Two words at most: it sits on a button. */
  name: string;
  /** One line under the name. Never longer than a phone card's width. */
  tagline: string;
  /**
   * Money is unlimited and the store never refuses a purchase. The wallet is
   * not actually set to a huge number — see `creativeWallet` — because a real
   * balance would be spent down and then persisted back to the profile.
   */
  infiniteMoney: boolean;
  /** Every catalog part is buyable from the first second. */
  allPartsUnlocked: boolean;
  /**
   * `player` keeps whatever rig the campaign profile is carrying; `beginner`
   * replaces it with the flat unarmed chassis from `builds.ts`, which is what
   * makes a Daily comparable and an Endless run a build test rather than a
   * continuation of somebody's campaign.
   */
  startingRig: 'player' | 'beginner';
  /**
   * Wallet the garage opens with. Ignored when `infiniteMoney` is set, and
   * overridden by the day's own roll in a Daily — see `dailyLoadout`.
   */
  startingMoney: number;
  /**
   * Every part sits in the inventory at a count that never goes down, so
   * placing one costs nothing and removes nothing. Pairs with `hideStore`:
   * together they replace "earn, then buy, then place" with just "place".
   */
  infiniteInventory: boolean;
  /**
   * A Garage button sits on the HUD during the fight. Leaving mid-wave forfeits
   * the wave in every mode, which is why it is buried in the settings panel
   * everywhere else; in a sandbox there is nothing to forfeit and the whole
   * loop is build, test, change something, so it belongs one press away.
   */
  midRunGarage: boolean;
  /**
   * The Store panel is not built at all. With an unlimited inventory there is
   * nothing left for it to do, and a shop full of prices nobody pays is just a
   * panel in the way of the build grid.
   */
  hideStore: boolean;
  /**
   * Waves never end on their own: the director keeps escalating and keeps
   * spawning, and the only way out is death or the garage door.
   */
  endlessWaves: boolean;
  /** The run's seed and arena come from the calendar, not from a dice roll. */
  fixedSeed: boolean;
  /** Results are worth recording — the leaderboard, the daily board, badges. */
  scored: boolean;
  /**
   * Whether a wasted run costs the player anything. Creative runs are practice,
   * so they never touch the profile's money, unlocks or saved run.
   */
  persistsProgress: boolean;
}

/**
 * The balance a creative run reports.
 *
 * Deliberately large but nowhere near `Number.MAX_SAFE_INTEGER`: the HUD adds
 * pending wave earnings on top of whatever the wallet says, and a balance
 * parked at the ceiling makes that sum overflow into a blank readout. A
 * trillion is unspendable by any real build and still leaves room to add to.
 */
export const CREATIVE_WALLET = 1_000_000_000_000;

export const GAME_MODES: Record<GameModeId, GameModeDefinition> = {
  campaign: {
    id: 'campaign',
    name: 'Campaign',
    tagline: 'Build between waves. Go as deep as you can.',
    infiniteMoney: false,
    allPartsUnlocked: false,
    startingRig: 'player',
    startingMoney: 0,
    infiniteInventory: false,
    hideStore: false,
    midRunGarage: false,
    endlessWaves: false,
    fixedSeed: false,
    scored: true,
    persistsProgress: true,
  },
  daily: {
    id: 'daily',
    name: 'Daily Run',
    tagline: 'Same arena, same kit, everyone. One attempt.',
    infiniteMoney: false,
    // The whole catalog, because a Daily is a puzzle about spending a fixed
    // budget well and an unlock ladder would make it a puzzle about whose
    // campaign is further along.
    allPartsUnlocked: true,
    startingRig: 'beginner',
    // Replaced every day by `dailyLoadout`; this is only the fallback.
    startingMoney: 1500,
    infiniteInventory: false,
    hideStore: false,
    midRunGarage: false,
    endlessWaves: false,
    fixedSeed: true,
    scored: true,
    // A daily run is its own sealed attempt: it must not overwrite the campaign
    // save the player has in flight, or yesterday's good run eats today's.
    persistsProgress: false,
  },
  endless: {
    id: 'endless',
    name: 'Endless',
    tagline: '$2,000, one build, then they never stop.',
    infiniteMoney: false,
    allPartsUnlocked: false,
    startingRig: 'beginner',
    // Always the same two thousand. Endless is a single build tested to
    // destruction, so the interesting variable is what you spend it on, and a
    // budget that moved would make two runs incomparable.
    startingMoney: 2000,
    infiniteInventory: false,
    hideStore: false,
    midRunGarage: false,
    endlessWaves: true,
    fixedSeed: false,
    scored: true,
    persistsProgress: false,
  },
  creative: {
    id: 'creative',
    name: 'Creative',
    tagline: 'Every part in hand. Build anything, fight forever.',
    infiniteMoney: true,
    allPartsUnlocked: true,
    startingRig: 'beginner',
    startingMoney: CREATIVE_WALLET,
    infiniteInventory: true,
    hideStore: true,
    midRunGarage: true,
    endlessWaves: true,
    fixedSeed: false,
    // Nothing here is earned, so nothing here is ranked. A creative run that
    // posted scores would make every board meaningless.
    scored: false,
    persistsProgress: false,
  },
};

export const DEFAULT_GAME_MODE_ID: GameModeId = 'campaign';

export function isGameModeId(value: unknown): value is GameModeId {
  return typeof value === 'string' && value in GAME_MODES;
}

/**
 * Falls back to Campaign for anything unrecognised, the way `getBiome` does.
 * Callers reach this with ids off persisted state and off partially-constructed
 * objects, and the safe answer for "no mode set" is the ordinary rules.
 */
export function getGameMode(id: GameModeId): GameModeDefinition {
  return GAME_MODES[id] ?? GAME_MODES[DEFAULT_GAME_MODE_ID];
}

