// Every tuning number in the game. Gameplay code never hardcodes a balance
// value -- it reads CFG. Screen geometry lives in LAYOUT (src/systems/Layout.js),
// not here, because it is re-derived on every resize.
const CFG = {
  // ---- the lawn ----
  GRID: { lanes: 6, cols: 9 },

  // ---- brainz (the in-level currency, PvZ sun) ----
  ENERGY: {
    start: 50,               // levels can override (levels.js startEnergy)
    dropValue: 25,           // every brainz token is worth this
    skyDropMs: 8500,         // a free token falls from the sky this often
    dropLifeMs: 9000,        // uncollected tokens fade after this
  },

  // ---- combat feel ----
  COMBAT: {
    biteMs: 900,             // enemy chew period once it reaches a unit
    projectileSpeed: 560,    // straight shots, px/sec against a ~620px lane
    hitStopMs: 60,
    bossSlowMoMs: 900,
    slowFactor: 0.55,        // slowed enemies move/bite at this rate
    slowMs: 2600,
  },

  // ---- levels / waves ----
  LEVEL: {
    prepMs: 6000,            // planting time before the first wave
    waveTimeoutMs: 26000,    // next wave comes even if the last one is alive
    waveClearGapMs: 3000,    // ...or this long after the field is cleared
    hpGrowth: 1.07,          // per-level enemy hp compounding (on top of authored waves)
    endlessGrowth: 1.3,      // extra compounding once past the authored list
  },

  // ---- meta economy (coins, the between-level currency) ----
  ECON: { startCoins: 0 },

  // ---- squad ----
  TEAM: { size: 6 },

  // ---- ads ----
  ADS: { interstitialGapMs: 120000 },

  // ---- art ----
  ART: { creatureH: 88, handH: 132 },
  ART_MANIFEST: 'assets/manifest.json',

  // ---- persistence ----
  SAVE_KEY: 'brainrot-defense-v1',
};
window.CFG = CFG;
