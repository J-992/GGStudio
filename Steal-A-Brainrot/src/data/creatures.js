// Creature + rarity data. Adding a creature is adding one entry here; gameplay
// code reads everything it needs from the definition.
//
// `art` selects the PLACEHOLDER drawing routine in TextureFactory.BODIES, used
// only until a real sprite exists for `cr_<id>` (see art/README.md). Names come
// from the source image filenames in art/source/ — they are display text and
// nothing keys off them, so a rename is a one-line change here.
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
  // -------- common --------
  { id: 'boneca',      name: 'Boneca Ambalabu',        rarity: 'common', price: 12, income: 2,
    art: 'boneca',     color: 0x7cb342, accent: 0x263238 },
  { id: 'trippi',      name: 'Trippi Troppi',          rarity: 'common', price: 18, income: 3,
    art: 'trippi',     color: 0xff8a65, accent: 0xffab91 },
  { id: 'troppa',      name: 'Troppa Trippa',          rarity: 'common', price: 25, income: 4,
    art: 'trippi',     color: 0x9ccc65, accent: 0xffd54f },
  { id: 'octopussini', name: 'Blueberrinni Octopussini', rarity: 'common', price: 35, income: 5,
    art: 'graipuss',   color: 0x7e57c2, accent: 0xb39ddb },
  { id: 'burbaloni',   name: 'Burbaloni Luliloli',     rarity: 'common', price: 50, income: 6,
    art: 'burbaloni',  color: 0x8d6e63, accent: 0xd7ccc8 },

  // -------- uncommon --------
  { id: 'orangutini',  name: 'Orangutini Ananasini',   rarity: 'uncommon', price: 130, income: 9,
    art: 'chimpanzini', color: 0xffd54f, accent: 0xa1887f },
  { id: 'bobritto',    name: 'Bobrito Bandito',        rarity: 'uncommon', price: 190, income: 12,
    art: 'bobritto',   color: 0x6d4c41, accent: 0xfafafa },
  { id: 'trulimero',   name: 'Trulimero Trulicina',    rarity: 'uncommon', price: 260, income: 15,
    art: 'trippi',     color: 0xffa726, accent: 0xffcc80 },
  { id: 'cocofanto',   name: 'Cocofanto Elefanto',     rarity: 'uncommon', price: 340, income: 19,
    art: 'lirili',     color: 0xa1887f, accent: 0x8d6e63 },

  // -------- rare --------
  { id: 'patapim',     name: 'Brr Brr Patapim',        rarity: 'rare', price: 700,  income: 34,
    art: 'patapim',    color: 0x8d6e63, accent: 0x66bb6a },
  { id: 'assassino',   name: 'Cappuccino Assassino',   rarity: 'rare', price: 950,  income: 42,
    art: 'assassino',  color: 0xfafafa, accent: 0xd32f2f },
  { id: 'lirili',      name: 'Lirilì Larilà',          rarity: 'rare', price: 1300, income: 52,
    art: 'lirili',     color: 0x66bb6a, accent: 0x9e9e9e },
  { id: 'girafa',      name: 'Girafa Celestre',        rarity: 'rare', price: 1700, income: 66,
    art: 'glorbo',     color: 0x43a047, accent: 0xe53935 },

  // -------- epic --------
  { id: 'chimpanzini', name: 'Chimpanzini Bananini',   rarity: 'epic', price: 3800, income: 130,
    art: 'chimpanzini', color: 0xffe135, accent: 0x5d4037 },
  { id: 'ballerina',   name: 'Ballerina Cappuccina',   rarity: 'epic', price: 5600, income: 175,
    art: 'ballerina',  color: 0xfafafa, accent: 0xf06292 },
  { id: 'udin',        name: 'Udin Din Din Dun',       rarity: 'epic', price: 7800, income: 230,
    art: 'assassino',  color: 0xffb300, accent: 0x4e342e },

  // -------- legendary --------
  { id: 'tungtung',    name: 'Tung Tung Tung Sahur',   rarity: 'legendary', price: 16000, income: 420,
    art: 'tungtung',   color: 0xa1887f, accent: 0x5d4037 },
  { id: 'bombardiro',  name: 'Bombardiro Crocodilo',   rarity: 'legendary', price: 22000, income: 560,
    art: 'bombardiro', color: 0x558b2f, accent: 0x78909c },

  // -------- mythic --------
  { id: 'tralalero',   name: 'Tralalero Tralala',      rarity: 'mythic', price: 52000, income: 1300,
    art: 'tralalero',  color: 0x5c9ec7, accent: 0x1565c0 },

  // -------- secret --------
  { id: 'vacca',       name: 'La Vacca Saturno Saturnita', rarity: 'secret', price: 120000, income: 3200,
    art: 'vacca',      color: 0xfafafa, accent: 0xffb300 },
];

const CREATURES_BY_ID = {};
CREATURES.forEach((c) => { CREATURES_BY_ID[c.id] = c; });

window.RARITIES = RARITIES;
window.CREATURES = CREATURES;
window.CREATURES_BY_ID = CREATURES_BY_ID;
