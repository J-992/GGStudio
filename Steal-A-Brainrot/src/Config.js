// All balance/tuning constants in one place. Gameplay code reads from here and
// never hardcodes numbers, so the whole game is tuned from this file.
const CFG = {
  W: 1280, H: 720,

  // ---- movement ----
  PLAYER_SPEED: 252,
  BOT_SPEED: 178,
  // Carrying has to stay faster than a chasing owner or the escape is a
  // formality: 252*0.82 = 207 out-runs a bot's chase speed of ~174-196.
  CARRY_SLOW: 0.82,        // speed multiplier while carrying stolen loot
  BOT_CHASE_MULT: 1.06,    // owners speed up when chasing, but not past you
  KNOCKBACK: 150,          // px of slap/catch knockback
  STUN_MS: 3000,          // a slap takes you out of the game for 3 full seconds

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
  STEAL_HOLD_MS: 420,      // hold interact this long to grab
  STEAL_RANGE: 82,         // how close to a pedestal the steal/sell prompt appears
  BUY_RANGE: 58,           // ... and the same for a creature on the belt
  CATCH_RANGE: 36,         // owner touching thief = caught
  CATCH_GRACE_MS: 700,     // an owner standing on its own pedestal can't insta-recatch
  SLAP_RANGE: 74,
  SLAP_CD_MS: 2000,

  // ---- merging ----
  // Two of the same creature fuse into the next one up the catalogue. The
  // catalogue is ordered by rarity then price, so "next" is always a straight
  // upgrade, and a merge frees a pedestal as a side effect.
  MERGE_ENABLED: true,
  MERGE_DELAY_MS: 260,     // let the new arrival land before it fuses

  // ---- selling ----
  // The way out of a full base. Below 1.0 so buy/sell is never a cash loop.
  SELL_RATIO: 0.6,
  SELL_HOLD_MS: 500,

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

  // ---- upgrades (permanent for the run) ----
  // `desc` is the row's second line in the panel -- it is the only place the
  // game says what an upgrade actually does, so every entry needs one.
  //
  // The entry prices are deliberately within reach of a player who has just
  // finished the tutorial (they end it holding roughly $100-200). An upgrade
  // nobody can afford for five minutes is an upgrade nobody learns exists;
  // the x2.0-2.2 growth still makes the later levels the long game.
  UPGRADES: [
    { id: 'slot',   name: '+1 SLOT',       desc: 'One more pedestal to fill',    base: 420, mul: 2.1, max: 8 },
    { id: 'income', name: 'INCOME +25%',   desc: 'Every creature you own earns more', base: 260, mul: 2.2, max: 10 },
    { id: 'lock',   name: 'LOCK +5s',      desc: 'Your base lock lasts longer',  base: 240, mul: 2.0, max: 6 },
    { id: 'speed',  name: 'SPEED +8%',     desc: 'Run faster, escape cleaner',   base: 180, mul: 2.0, max: 6 },
    { id: 'slap',   name: 'SLAP CD -15%',  desc: 'Stun rivals more often',       base: 200, mul: 2.0, max: 5 },
  ],

  // ---- map layout (single 1280x720 screen, no scrolling) ----
  // `entrance` no longer walls anything off -- bases are open on all four
  // sides. It only marks the side the player spawns on and the side pedestals
  // keep clear of.
  BASES: {
    player: { x: 640, y: 585, w: 380, h: 190, entrance: 'top' },
    bot0:   { x: 210, y: 125, w: 250, h: 155, entrance: 'bottom' },
    bot1:   { x: 640, y: 112, w: 250, h: 155, entrance: 'bottom' },
    bot2:   { x: 1070, y: 125, w: 250, h: 155, entrance: 'bottom' },
    bot3:   { x: 148, y: 475, w: 230, h: 150, entrance: 'right' },
    bot4:   { x: 1132, y: 475, w: 230, h: 150, entrance: 'left' },
  },
  UPGRADE_STATION: { x: 330, y: 665 },

  // ---- purchasable lock ----
  // Bought from the upgrade station, applies instantly and ignores the free
  // lock button's cooldown -- that is what the money is buying.
  LOCK_BUY_MS: 30000,
  LOCK_BUY_COST: 250,
  LOCK_BUY_GROWTH: 1.35,   // each purchase costs a bit more within a run

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
  // You are bigger than the rivals, wear a green ground ring and carry a
  // marker; they are smaller and duller. At a glance you should never have to
  // work out which one you are driving.
  PLAYER_SCALE: 1.22,
  BOT_SCALE: 0.92,
  PLAYER_TINT: 0x69f0ae,
  // The tutorial hand is deliberately oversized -- at the old size it read as
  // one more small sprite in a busy scene instead of an instruction.
  HAND_H: 132,
  ART_MANIFEST: 'assets/manifest.json',

  SAVE_KEY: 'steal-the-brainrot-v1',
  SAVE_EVERY_MS: 8000,
};
window.CFG = CFG;
