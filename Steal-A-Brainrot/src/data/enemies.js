// The horde. These are MONSTERS -- their own species, their own sprites --
// not dark recolours of the player's own roster. The brainrots are the heroes;
// making the villains evil twins of them muddied every read on the lawn (which
// green blob is mine?) and wasted the one thing a lane defender needs most:
// an enemy you can identify from the far end of the lane while panicking.
//
// `art` is the texture key: a render in assets/sprites/en_<id>.png, with a
// procedural fallback of the same name in TextureFactory.MONSTERS, so the game
// still runs with the art folder empty.
//
// hp/coins are LEVEL 1 numbers -- WaveDirector scales hp by CFG.LEVEL.hpGrowth
// per level. `speed` is px/sec against a ~620px lawn (LAYOUT.combatScale
// corrects for the actual walk). `bite` is damage per chew (CFG.COMBAT.biteMs),
// and it is the number that decides whether a lane collapses: a 300hp shooter
// survives 300/bite chews, so early bites are deliberately soft.
const ENEMIES = {
  grunt:  { art: 'en_gloopo',    name: 'Gloopo',      hp: 100,  speed: 30, bite: 20,  coins: 8,
            scale: 1.0 },
  shover: { art: 'en_sporeling', name: 'Sporeling',   hp: 150,  speed: 26, bite: 24,  coins: 11,
            scale: 1.05 },
  runner: { art: 'en_zippet',    name: 'Zippet',      hp: 80,   speed: 54, bite: 16,  coins: 10,
            scale: 0.95 },
  bucket: { art: 'en_crustacle', name: 'Crustacle',   hp: 420,  speed: 21, bite: 35,  coins: 18,
            scale: 1.12 },
  dancer: { art: 'en_wispa',     name: 'Wispa',       hp: 150,  speed: 40, bite: 25,  coins: 14,
            scale: 1.0 },
  brute:  { art: 'en_grumblor',  name: 'Grumblor',    hp: 650,  speed: 17, bite: 45,  coins: 26,
            scale: 1.2 },
  giant:  { art: 'en_cyclomunch', name: 'CYCLOMUNCH', hp: 1600, speed: 12, bite: 160, coins: 70,
            scale: 1.6, mini: true },
};

const BOSSES = {
  slimeKing: {
    art: 'en_slimeking', name: 'THE SLIME KING', hp: 4200, speed: 9, bite: 260, coins: 250,
    scale: 2.2, boss: true,
  },
};

window.ENEMIES = ENEMIES;
window.BOSSES = BOSSES;
