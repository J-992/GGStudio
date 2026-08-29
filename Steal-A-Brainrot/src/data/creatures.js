// The defender roster. Adding a brainrot is adding one entry here; combat,
// cards, the shop and save code read everything from the definition.
//
// `role` picks the behaviour in CombatSystem:
//   producer - makes brainz (the Cocofanto sunflower)
//   shooter  - fires straight down its lane        (params: projectile, burst,
//              pierce, slow, knockback)
//   lobber   - arcs a splash shot; `anywhere` lobs at the densest pack on the
//              whole lawn instead of its own lane
//   melee    - swings at enemies just in front
//   ring     - pulses damage on everything within `radius` of itself
//   sniper   - bolts at the highest-hp enemy anywhere
//   wall     - just stands there, deliciously
//   mine     - arms over `armMs`, detonates on contact
//
// `cost` is brainz (in-level), `price` is coins (the shop; 0 = starter).
// `cooldownMs` is the card recharge. `attackSpeed` is attacks/second.
// Rarity still colours the cards and orders the shop.
//
// `art` selects the PLACEHOLDER drawing routine in TextureFactory.BODIES, used
// only until the real sprite for `cr_<id>` loads from assets/manifest.json.
// Names are display text only -- nothing keys off them.
const RARITIES = {
  common:    { name: 'COMMON',    color: 0xb0bec5, tier: 0 },
  uncommon:  { name: 'UNCOMMON',  color: 0x66bb6a, tier: 1 },
  rare:      { name: 'RARE',      color: 0x42a5f5, tier: 2 },
  epic:      { name: 'EPIC',      color: 0xab47bc, tier: 3 },
  legendary: { name: 'LEGENDARY', color: 0xffb300, tier: 4 },
  mythic:    { name: 'MYTHIC',    color: 0xff1744, tier: 5 },
  secret:    { name: 'SECRET',    color: 0x18ffff, tier: 6 },
};

const CREATURES = [
  // ---- starters (price 0): the level-1 default squad ----
  { id: 'cocofanto',   name: 'Cocofanto Elefanto',     rarity: 'uncommon', role: 'producer',
    cost: 50,  hp: 220, cooldownMs: 6000, price: 0,
    produceMs: 7000, produceAmount: 25,
    special: 'MAKES BRAINZ', blurb: 'Trumpets out 25 brainz every 7s. The economy.',
    art: 'lirili',     color: 0xa1887f, accent: 0x8d6e63 },
  { id: 'trippi',      name: 'Trippi Troppi',          rarity: 'common', role: 'shooter',
    cost: 100, hp: 300, cooldownMs: 5000, price: 0,
    damage: 14, attackSpeed: 0.9, projectile: 'pr_pea',
    special: 'FISH SPIT', blurb: 'Your basic lane pea-spitter. Reliable. Damp.',
    art: 'trippi',     color: 0xff8a65, accent: 0xffab91 },
  { id: 'troppa',      name: 'Troppa Trippa',          rarity: 'common', role: 'wall',
    cost: 75,  hp: 1600, cooldownMs: 16000, price: 0,
    special: 'ABSOLUTE UNIT', blurb: 'A wall of pure tripe. Enemies chew for days.',
    art: 'trippi',     color: 0x9ccc65, accent: 0xffd54f },

  // ---- shop: commons ----
  { id: 'burbaloni',   name: 'Burbaloni Luliloli',     rarity: 'common', role: 'mine',
    cost: 25,  hp: 140, cooldownMs: 18000, price: 150,
    damage: 600, radius: 95, armMs: 11000,
    special: 'BELLYFLOP TRAP', blurb: 'Naps, then bellyflops the first thing that steps close. One use.',
    art: 'burbaloni',  color: 0x8d6e63, accent: 0xd7ccc8 },
  { id: 'boneca',      name: 'Boneca Ambalabu',        rarity: 'common', role: 'shooter',
    cost: 125, hp: 300, cooldownMs: 6000, price: 250,
    damage: 12, attackSpeed: 0.8, projectile: 'pr_wave', knockback: 70,
    special: 'AMBALABU SHOVE', blurb: 'Every hit shoves the enemy back up the lane.',
    art: 'boneca',     color: 0x7cb342, accent: 0x263238 },
  { id: 'octopussini', name: 'Blueberrinni Octopussini', rarity: 'common', role: 'shooter',
    cost: 150, hp: 300, cooldownMs: 6000, price: 400,
    damage: 12, attackSpeed: 0.85, projectile: 'pr_goo', slow: true,
    special: 'BERRY GOO', blurb: 'Cold berry goo: hits also slow the chewing and the walking.',
    art: 'graipuss',   color: 0x7e57c2, accent: 0xb39ddb },

  // ---- shop: uncommons ----
  { id: 'trulimero',   name: 'Trulimero Trulicina',    rarity: 'uncommon', role: 'melee',
    cost: 150, hp: 380, cooldownMs: 7000, price: 500,
    damage: 34, attackSpeed: 1.1, reachCells: 1.6,
    special: 'TRULICINA TWIRL', blurb: 'Spin-slaps everything within arm\'s reach. No ammo needed.',
    art: 'trippi',     color: 0xffa726, accent: 0xffcc80 },
  { id: 'orangutini',  name: 'Orangutini Ananasini',   rarity: 'uncommon', role: 'shooter',
    cost: 200, hp: 300, cooldownMs: 6000, price: 650,
    damage: 14, attackSpeed: 0.9, projectile: 'pr_pea', burst: 2,
    special: 'DOUBLE ANANAS', blurb: 'Two pineapples per throw. Twice the lane control.',
    art: 'chimpanzini', color: 0xffd54f, accent: 0xa1887f },
  { id: 'bobritto',    name: 'Bobrito Bandito',        rarity: 'uncommon', role: 'shooter',
    cost: 225, hp: 300, cooldownMs: 7000, price: 800,
    damage: 8, attackSpeed: 2.6, projectile: 'pr_pea',
    special: 'BANDITO BLAST', blurb: 'A beaver with a gatling attitude. Shreds one lane.',
    art: 'bobritto',   color: 0x6d4c41, accent: 0xfafafa },

  // ---- shop: rares ----
  { id: 'patapim',     name: 'Brr Brr Patapim',        rarity: 'rare', role: 'shooter',
    cost: 250, hp: 320, cooldownMs: 8000, price: 1000,
    damage: 16, attackSpeed: 0.7, projectile: 'pr_wave', pierce: true,
    special: 'PATAPIM PULSE', blurb: 'One pulse hits EVERY enemy in the lane. Queue killer.',
    art: 'patapim',    color: 0x8d6e63, accent: 0x66bb6a },
  { id: 'assassino',   name: 'Cappuccino Assassino',   rarity: 'rare', role: 'sniper',
    cost: 275, hp: 280, cooldownMs: 8000, price: 1200,
    damage: 70, attackSpeed: 0.5,
    special: 'ESPRESSO EDGE', blurb: 'Blades the beefiest enemy on the lawn, any lane.',
    art: 'assassino',  color: 0xfafafa, accent: 0xd32f2f },
  { id: 'lirili',      name: 'Lirili Larila',          rarity: 'rare', role: 'lobber',
    cost: 250, hp: 300, cooldownMs: 8000, price: 1100,
    damage: 26, attackSpeed: 0.55, radius: 85, slow: true,
    special: 'SANDSTORM SPLASH', blurb: 'Lobs slowing sandstorms over walls. Crowd chiller.',
    art: 'lirili',     color: 0x66bb6a, accent: 0x9e9e9e },
  { id: 'girafa',      name: 'Girafa Celestre',        rarity: 'rare', role: 'lobber',
    cost: 300, hp: 300, cooldownMs: 8000, price: 1400,
    damage: 48, attackSpeed: 0.55, radius: 95,
    special: 'CELESTIAL DROP', blurb: 'Heavy celestial melons, big splash. The catapult.',
    art: 'glorbo',     color: 0x43a047, accent: 0xe53935 },

  // ---- shop: epics ----
  { id: 'ballerina',   name: 'Ballerina Cappuccina',   rarity: 'epic', role: 'ring',
    cost: 300, hp: 340, cooldownMs: 9000, price: 1800,
    damage: 22, attackSpeed: 1.2, radius: 150,
    special: 'CAPPUCCINA SPIN', blurb: 'A whirlwind that hurts everything around her, all lanes.',
    art: 'ballerina',  color: 0xfafafa, accent: 0xf06292 },
  { id: 'chimpanzini', name: 'Chimpanzini Bananini',   rarity: 'epic', role: 'shooter',
    cost: 325, hp: 300, cooldownMs: 9000, price: 2000,
    damage: 12, attackSpeed: 3.2, projectile: 'pr_banana',
    special: 'BANANA BARRAGE', blurb: 'The fastest trigger finger in the jungle.',
    art: 'chimpanzini', color: 0xffe135, accent: 0x5d4037 },
  { id: 'udin',        name: 'Udin Din Din Dun',       rarity: 'epic', role: 'ring',
    cost: 350, hp: 340, cooldownMs: 9000, price: 2200,
    damage: 26, attackSpeed: 0.9, radius: 175, knockback: 45,
    special: 'DIN DIN DUN', blurb: 'Drum shockwaves that knock whole crowds backwards.',
    art: 'assassino',  color: 0xffb300, accent: 0x4e342e },

  // ---- shop: legendaries ----
  { id: 'tungtung',    name: 'Tung Tung Tung Sahur',   rarity: 'legendary', role: 'melee',
    cost: 300, hp: 500, cooldownMs: 10000, price: 3000,
    damage: 130, attackSpeed: 0.65, reachCells: 2.2, aoeCells: 1.2,
    special: 'TUNG TUNG TUNG', blurb: 'The bat. Crunches whatever queues up in front of him.',
    art: 'tungtung',   color: 0xa1887f, accent: 0x5d4037 },
  { id: 'bombardiro',  name: 'Bombardiro Crocodilo',   rarity: 'legendary', role: 'lobber',
    cost: 400, hp: 300, cooldownMs: 11000, price: 3500,
    damage: 95, attackSpeed: 0.4, radius: 115, anywhere: true,
    special: 'BOMBARDIRO', blurb: 'Air support: bombs the biggest pack ANYWHERE on the lawn.',
    art: 'bombardiro', color: 0x558b2f, accent: 0x78909c },

  // ---- shop: mythic / secret ----
  { id: 'tralalero',   name: 'Tralalero Tralala',      rarity: 'mythic', role: 'shooter',
    cost: 450, hp: 360, cooldownMs: 12000, price: 5000,
    damage: 26, attackSpeed: 2.4, projectile: 'pr_blade',
    special: 'TRALALERO RUSH', blurb: 'Three Nikes, zero mercy. Deletes a lane by himself.',
    art: 'tralalero',  color: 0x5c9ec7, accent: 0x1565c0 },
  { id: 'vacca',       name: 'La Vacca Saturno Saturnita', rarity: 'secret', role: 'ring',
    cost: 500, hp: 420, cooldownMs: 13000, price: 8000,
    damage: 40, attackSpeed: 1.5, radius: 190, knockback: 25,
    special: 'SATURNO ORBIT', blurb: 'Her rings grind everything nearby into stardust.',
    art: 'vacca',      color: 0xfafafa, accent: 0xffb300 },
];

const CREATURES_BY_ID = {};
CREATURES.forEach((c) => { CREATURES_BY_ID[c.id] = c; });

// Rough single-target dps, used by check.mjs and the shop's stat line.
const Units = {
  dps(def) {
    if (def.role === 'producer' || def.role === 'wall') return 0;
    if (def.role === 'mine') return def.damage / 10;    // one big boom, amortised
    return def.damage * (def.attackSpeed || 1) * (def.burst || 1);
  },
};

window.RARITIES = RARITIES;
window.CREATURES = CREATURES;
window.CREATURES_BY_ID = CREATURES_BY_ID;
window.Units = Units;
