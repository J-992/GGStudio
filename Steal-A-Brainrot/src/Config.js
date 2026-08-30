// Every tuning number in the game. Gameplay code never hardcodes a balance
// value -- it reads CFG. Screen geometry lives in LAYOUT (src/systems/Layout.js),
// not here, because it is re-derived on every resize.
const CFG = {
  // ---- the lawn ----
  GRID: { lanes: 6, cols: 9 },

  // ---- doge coins (the in-level currency, PvZ sun) ----
  ENERGY: {
    start: 50,               // levels can override (levels.js startEnergy)
    dropValue: 25,           // every doge coin is worth this
    skyDropMs: 8500,         // a free coin drops from the sky this often
    dropLifeMs: 9000,        // uncollected coins fade after this
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
  // The two gap numbers are the game's real difficulty dial. waveClearGapMs is
  // the one that bites: it is the breather you get after wiping the lawn, and
  // at 3s there was no breather -- you never banked enough coins between waves
  // to add a plant, so every level was fought with whatever you had at wave 1.
  // Levels can override all three (levels.js prepMs / waveGapMs / clearGapMs).
  LEVEL: {
    prepMs: 6000,            // planting time before the first wave
    waveTimeoutMs: 34000,    // next wave comes even if the last one is alive
    waveClearGapMs: 8000,    // ...or this long after the field is cleared
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
  // Logical display heights. Every swappable texture is drawn through
  // TextureFactory.scaleFor(), so a 352px render and a 48px placeholder under
  // the same key occupy exactly the same space on screen.
  ART: {
    creatureH: 88, handH: 132,
    coinH: 46, coinHudH: 38, coinCardH: 17,   // doge coins (in-level)
    metaCoinH: 22,                            // the $ coin (shop money)
  },
  ART_MANIFEST: 'assets/manifest.json',

  // ---- persistence ----
  SAVE_KEY: 'brainrot-defense-v1',
};
window.CFG = CFG;
