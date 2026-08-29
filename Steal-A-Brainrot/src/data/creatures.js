// Brainrot roster + rarity data. Adding a brainrot is adding one entry here;
// combat, gacha, braindex and save code read everything from the definition.
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

// One very obvious ability each. `archetype` picks the attack behaviour from
// ARCHETYPES below; baseDamage/attackSpeed are the *1-star* numbers -- stars
// multiply them (CFG.STAR). The dps ladder (damage x speed) must climb with
// rarity tier: tools/check.mjs enforces it.
const CREATURES = [
  // -------- common --------
  { id: 'boneca',      name: 'Boneca Ambalabu',        rarity: 'common', archetype: 'knockback',
    baseDamage: 8,  attackSpeed: 1.0, sellValue: 8,  special: 'AMBALABU SHOVE',
    art: 'boneca',     color: 0x7cb342, accent: 0x263238 },
  { id: 'trippi',      name: 'Trippi Troppi',          rarity: 'common', archetype: 'dash',
    baseDamage: 6,  attackSpeed: 1.5, sellValue: 8,  special: 'TRIPPI TRIP',
    art: 'trippi',     color: 0xff8a65, accent: 0xffab91 },
  { id: 'troppa',      name: 'Troppa Trippa',          rarity: 'common', archetype: 'knockback',
    baseDamage: 10, attackSpeed: 1.0, sellValue: 9,  special: 'TROPPA TOSS',
    art: 'trippi',     color: 0x9ccc65, accent: 0xffd54f },
  { id: 'octopussini', name: 'Blueberrinni Octopussini', rarity: 'common', archetype: 'rapid',
    baseDamage: 6,  attackSpeed: 1.9, sellValue: 9,  special: 'BERRY SPIT',
    art: 'graipuss',   color: 0x7e57c2, accent: 0xb39ddb },
  { id: 'burbaloni',   name: 'Burbaloni Luliloli',     rarity: 'common', archetype: 'slam',
    baseDamage: 16, attackSpeed: 0.8, sellValue: 10, special: 'LULILOLI BELLYFLOP',
    art: 'burbaloni',  color: 0x8d6e63, accent: 0xd7ccc8 },

  // -------- uncommon --------
  { id: 'orangutini',  name: 'Orangutini Ananasini',   rarity: 'uncommon', archetype: 'rapid',
    baseDamage: 9,  attackSpeed: 1.9, sellValue: 18, special: 'ANANAS VOLLEY',
    art: 'chimpanzini', color: 0xffd54f, accent: 0xa1887f },
  { id: 'bobritto',    name: 'Bobrito Bandito',        rarity: 'uncommon', archetype: 'rapid',
    baseDamage: 10, attackSpeed: 1.9, sellValue: 19, special: 'BANDITO BLAST',
    art: 'bobritto',   color: 0x6d4c41, accent: 0xfafafa },
  { id: 'trulimero',   name: 'Trulimero Trulicina',    rarity: 'uncommon', archetype: 'spin',
    baseDamage: 14, attackSpeed: 1.5, sellValue: 20, special: 'TRULICINA TWIRL',
    art: 'trippi',     color: 0xffa726, accent: 0xffcc80 },
  { id: 'cocofanto',   name: 'Cocofanto Elefanto',     rarity: 'uncommon', archetype: 'slam',
    baseDamage: 30, attackSpeed: 0.8, sellValue: 22, special: 'ELEFANTO STOMP',
    art: 'lirili',     color: 0xa1887f, accent: 0x8d6e63 },

  // -------- rare --------
  { id: 'patapim',     name: 'Brr Brr Patapim',        rarity: 'rare', archetype: 'knockback',
    baseDamage: 26, attackSpeed: 1.2, sellValue: 40, special: 'PATAPIM PULSE',
    art: 'patapim',    color: 0x8d6e63, accent: 0x66bb6a },
  { id: 'assassino',   name: 'Cappuccino Assassino',   rarity: 'rare', archetype: 'snipe',
    baseDamage: 40, attackSpeed: 0.9, sellValue: 42, special: 'ESPRESSO EDGE',
    art: 'assassino',  color: 0xfafafa, accent: 0xd32f2f },
  { id: 'lirili',      name: 'Lirili Larila',          rarity: 'rare', archetype: 'snipe',
    baseDamage: 30, attackSpeed: 1.3, sellValue: 44, special: 'LARILA LANCE',
    art: 'lirili',     color: 0x66bb6a, accent: 0x9e9e9e },
  { id: 'girafa',      name: 'Girafa Celestre',        rarity: 'rare', archetype: 'airstrike',
    baseDamage: 62, attackSpeed: 0.7, sellValue: 46, special: 'CELESTIAL DROP',
    art: 'glorbo',     color: 0x43a047, accent: 0xe53935 },

  // -------- epic --------
  { id: 'chimpanzini', name: 'Chimpanzini Bananini',   rarity: 'epic', archetype: 'rapid',
    baseDamage: 26, attackSpeed: 2.4, sellValue: 90, special: 'BANANA BARRAGE',
    art: 'chimpanzini', color: 0xffe135, accent: 0x5d4037 },
  { id: 'ballerina',   name: 'Ballerina Cappuccina',   rarity: 'epic', archetype: 'spin',
    baseDamage: 45, attackSpeed: 1.5, sellValue: 95, special: 'CAPPUCCINA SPIN',
    art: 'ballerina',  color: 0xfafafa, accent: 0xf06292 },
  { id: 'udin',        name: 'Udin Din Din Dun',       rarity: 'epic', archetype: 'spin',
    baseDamage: 50, attackSpeed: 1.5, sellValue: 100, special: 'DIN DIN DUN',
    art: 'assassino',  color: 0xffb300, accent: 0x4e342e },

  // -------- legendary --------
  { id: 'tungtung',    name: 'Tung Tung Tung Sahur',   rarity: 'legendary', archetype: 'slam',
    baseDamage: 160, attackSpeed: 0.7, sellValue: 200, special: 'TUNG TUNG TUNG',
    art: 'tungtung',   color: 0xa1887f, accent: 0x5d4037 },
  { id: 'bombardiro',  name: 'Bombardiro Crocodilo',   rarity: 'legendary', archetype: 'airstrike',
    baseDamage: 170, attackSpeed: 0.75, sellValue: 210, special: 'BOMBARDIRO',
    art: 'bombardiro', color: 0x558b2f, accent: 0x78909c },

  // -------- mythic --------
  { id: 'tralalero',   name: 'Tralalero Tralala',      rarity: 'mythic', archetype: 'dash',
    baseDamage: 110, attackSpeed: 1.8, sellValue: 450, special: 'TRALALERO RUSH',
    art: 'tralalero',  color: 0x5c9ec7, accent: 0x1565c0 },

  // -------- secret --------
  { id: 'vacca',       name: 'La Vacca Saturno Saturnita', rarity: 'secret', archetype: 'orbit',
    baseDamage: 80, attackSpeed: 4.0, sellValue: 999, special: 'SATURNO ORBIT',
    art: 'vacca',      color: 0xfafafa, accent: 0xffb300 },
];

// Attack behaviours. `targets`: 'lane' = nearest enemy in the unit's lane,
// 'ring' = every enemy within aoe of the unit, 'cluster' = the densest pack of
// enemies anywhere, 'strongest' = highest-hp enemy anywhere. `aoe` is a splash
// radius (false = single target). `projectile` names a texture; null = melee.
const ARCHETYPES = {
  dash:      { range: 260,  targets: 'lane',      aoe: false, projectile: null,        knockback: 0  },
  slam:      { range: 200,  targets: 'lane',      aoe: 100,   projectile: null,        knockback: 44 },
  spin:      { range: 170,  targets: 'ring',      aoe: 170,   projectile: null,        knockback: 12 },
  airstrike: { range: 9999, targets: 'cluster',   aoe: 90,    projectile: 'pr_bomb',   knockback: 22 },
  rapid:     { range: 460,  targets: 'lane',      aoe: false, projectile: 'pr_banana', knockback: 0  },
  snipe:     { range: 9999, targets: 'strongest', aoe: false, projectile: 'pr_blade',  knockback: 0  },
  knockback: { range: 340,  targets: 'lane',      aoe: false, projectile: 'pr_wave',   knockback: 95 },
  orbit:     { range: 210,  targets: 'ring',      aoe: 210,   projectile: null,        knockback: 28 },
};

const CREATURES_BY_ID = {};
CREATURES.forEach((c) => { CREATURES_BY_ID[c.id] = c; });

// Star-scaled stats, in one place so balance changes stay one-line.
const Units = {
  damage(def, star)      { return def.baseDamage * Math.pow(CFG.STAR.dmgGrowth, star - 1); },
  attackSpeed(def, star) { return def.attackSpeed * Math.pow(CFG.STAR.speedGrowth, star - 1); },
  dps(def, star)         { return this.damage(def, star) * this.attackSpeed(def, star); },
  sellPrice(def, star)   { return Math.max(1, Math.round(def.sellValue * Math.pow(CFG.STAR.sellGrowth, star - 1) * CFG.ECON.sellRatio)); },
  scale(star)            { return Math.pow(CFG.STAR.scaleGrowth, star - 1); },
};

window.RARITIES = RARITIES;
window.CREATURES = CREATURES;
window.CREATURES_BY_ID = CREATURES_BY_ID;
window.ARCHETYPES = ARCHETYPES;
window.Units = Units;
