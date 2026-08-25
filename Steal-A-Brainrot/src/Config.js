// All balance/tuning constants in one place. Gameplay code reads from here and
// never hardcodes numbers, so the whole game is tuned from this file.
const CFG = {
  W: 1280, H: 720,

  // ---- movement ----
  PLAYER_SPEED: 252,
  BOT_SPEED: 208,
  CARRY_SLOW: 0.70,        // speed multiplier while carrying stolen loot
  KNOCKBACK: 150,          // px of slap/catch knockback
  STUN_MS: 900,

  // ---- economy ----
  START_CASH: 15,
  BOT_START_CASH: 40,
  BOT_TRICKLE: 3,          // bots earn a little /s so they always come back to shop
  COIN_FLY_EVERY: 2000,    // ms between visible coin pops per player creature

  // ---- conveyor ----
  SPAWN_INTERVAL: 3800,    // ms between conveyor creatures
  CONVEYOR_SPEED: 46,      // px/s belt speed
  CONVEYOR_Y: 340,
  BELT_PUSH: 40,           // px/s push applied to anyone standing on the belt
  MAX_ON_BELT: 7,

  // rarity spawn weights (luck shifts weight from common toward the rare end)
  RARITY_WEIGHTS: { common: 55, uncommon: 22, rare: 12, epic: 6.5, legendary: 2.6, mythic: 1.1, secret: 0.35 },

  // ---- stealing ----
  STEAL_HOLD_MS: 600,      // hold interact this long to grab
  CATCH_RANGE: 36,         // owner touching thief = caught
  SLAP_RANGE: 74,
  SLAP_CD_MS: 2000,

  // ---- bases / locks ----
  PLAYER_SLOTS: 4,
  BOT_SLOTS: 6,
  MAX_SLOTS: 12,
  LOCK_DUR_MS: 20000,
  LOCK_CD_MS: 30000,
  BOT_LOCK_DUR_MS: 10000,

  // ---- events ----
  EVENT_FIRST_MS: 80000,
  EVENT_MIN_MS: 90000,
  EVENT_MAX_MS: 150000,

  // ---- rebirth ----
  REBIRTH_CASH: 50000,
  REBIRTH_RARITY: 'epic',      // must own one creature of at least this rarity
  REBIRTH_INCOME_BONUS: 0.25,  // permanent, per rebirth
  REBIRTH_LUCK: 0.30,          // conveyor luck factor per rebirth
  REBIRTH_SLOT_BONUS: 1,       // extra starting slot per rebirth

  // ---- upgrades (temporary, reset on rebirth) ----
  UPGRADES: [
    { id: 'slot',   name: '+1 SLOT',       desc: 'One more pedestal',   base: 600, mul: 2.1, max: 8 },
    { id: 'income', name: 'INCOME +25%',   desc: 'All creatures earn more', base: 400, mul: 2.2, max: 10 },
    { id: 'lock',   name: 'LOCK +5s',      desc: 'Longer base lock',    base: 350, mul: 2.0, max: 6 },
    { id: 'speed',  name: 'SPEED +8%',     desc: 'Run faster',          base: 300, mul: 2.0, max: 6 },
    { id: 'slap',   name: 'SLAP CD -15%',  desc: 'Slap more often',     base: 300, mul: 2.0, max: 5 },
  ],

  // ---- map layout (single 1280x720 screen, no scrolling) ----
  BASES: {
    player: { x: 640, y: 585, w: 380, h: 190, entrance: 'top' },
    bot0:   { x: 210, y: 125, w: 250, h: 155, entrance: 'bottom' },
    bot1:   { x: 640, y: 112, w: 250, h: 155, entrance: 'bottom' },
    bot2:   { x: 1070, y: 125, w: 250, h: 155, entrance: 'bottom' },
    bot3:   { x: 148, y: 475, w: 230, h: 150, entrance: 'right' },
    bot4:   { x: 1132, y: 475, w: 230, h: 150, entrance: 'left' },
  },
  ENTRANCE_GAP: 96,
  UPGRADE_STATION: { x: 330, y: 665 },
  REBIRTH_PORTAL: { x: 950, y: 645 },

  BOTS: [
    { id: 'bot0', name: 'Sneaky',    color: 0x7e57c2, agg: 0.9, greed: 0.4, def: 0.3, risk: 0.9 },
    { id: 'bot1', name: 'Rich Kid',  color: 0x29b6f6, agg: 0.2, greed: 1.0, def: 0.5, risk: 0.3 },
    { id: 'bot2', name: 'Guard Dog', color: 0xef5350, agg: 0.3, greed: 0.5, def: 1.0, risk: 0.2 },
    { id: 'bot3', name: 'Chaos Kid', color: 0xffa726, agg: 1.0, greed: 0.6, def: 0.2, risk: 1.0 },
    { id: 'bot4', name: 'Collector', color: 0x66bb6a, agg: 0.6, greed: 0.8, def: 0.5, risk: 0.6 },
  ],

  // ---- rewarded ad perk (optional, never required) ----
  FRENZY_MULT: 2,
  FRENZY_DUR_MS: 60000,
  FRENZY_CD_MS: 180000,

  // ---- art ----
  // On-screen size in world px. Rendered sprites (see tools/) come in at 2x or
  // 4x this for crispness and are scaled down to match; the procedural
  // fallbacks are authored at exactly these sizes.
  CREATURE_H: 88,
  CHARACTER_H: 72,
  ART_MANIFEST: 'assets/manifest.json',

  SAVE_KEY: 'steal-the-brainrot-v1',
  SAVE_EVERY_MS: 8000,
};
window.CFG = CFG;
