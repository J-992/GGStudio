// Every tuning number in the game. Gameplay code never hardcodes a balance
// value -- it reads CFG. Screen geometry lives in LAYOUT (src/systems/Layout.js),
// not here, because it is re-derived on every resize.
const CFG = {
  // ---- merging / stars ----
  // dmgGrowth 2.4 keeps merge-ninja's contract: merging two identical units
  // (2x dps) into one at 2.4x dps makes the board ~20% stronger, so a merge
  // is always an upgrade but never doubles your power for free.
  STAR: { max: 5, dmgGrowth: 2.4, speedGrowth: 1.12, scaleGrowth: 1.17, sellGrowth: 2.2 },

  // ---- board ----
  BOARD: { fieldCols: 3, fieldRows: 3, benchSlots: 8 },

  // ---- economy ----
  ECON: { startCoins: 60, sellRatio: 0.6 },

  // ---- the Brainrot Machine (gacha) ----
  MACHINE: {
    baseCost: 25, costGrowth: 1.06,          // cost = base * growth^pulls (this run)
    rewards: { brainrot: 66, coins: 12, double: 9, rareCapsule: 8, jackpot: 5 },
    coinsPayout: 3.0,                        // 'coins' reward pays cost * this
    jackpotCoins: 12.0,                      // jackpot pays cost * this on top of an epic+
    dupeBias: 0.15,                          // odds mass steered toward a mergeable duplicate
    skipAfterViews: 4, sequenceMs: 2600,
  },
  RARITY_WEIGHTS: { common: 55, uncommon: 22, rare: 12, epic: 6.5, legendary: 2.6, mythic: 1.1, secret: 0.35 },
  TICKET_PULL_MIN_TIER: 2,                   // ticket pull = guaranteed rare or better

  // ---- stages / waves ----
  STAGE: {
    lives: 3, hpGrowth: 1.45, coinGrowth: 1.18,
    waveGapMs: 3500, prepMs: 6000,
    victoryCoins: 40, bossEveryN: 5,
  },

  // ---- combat feel ----
  COMBAT: {
    tickMs: 100, hitStopMs: 60, bossSlowMoMs: 900,
    projectileSpeed: 520,
  },

  // ---- ads ----
  ADS: { interstitialGapMs: 120000 },

  // ---- art ----
  ART: { creatureH: 88, handH: 132 },
  ART_MANIFEST: 'assets/manifest.json',

  // ---- persistence ----
  SAVE_KEY: 'brainrot-merge-clash-v1',
  SAVE_EVERY_MS: 8000,
};
window.CFG = CFG;
