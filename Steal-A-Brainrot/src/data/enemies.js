// The EVIL brainrots. Each one is a dark-tinted version of a roster sprite
// (`base` names the creature whose cr_ texture it wears), so real character
// art carries the enemy side with zero extra assets.
//
// hp/coins are LEVEL 1 numbers -- WaveDirector scales hp by CFG.LEVEL.hpGrowth
// per level. `speed` is px/sec against a ~620px lawn (LAYOUT.combatScale
// corrects for the actual walk). `bite` is damage per chew (CFG.COMBAT.biteMs).
const ENEMIES = {
  grunt:  { base: 'trippi',    name: 'Evil Trippi',     hp: 100,  speed: 30, bite: 25,  coins: 8,
            tint: 0x8f7bb8, scale: 1.0 },
  shover: { base: 'boneca',    name: 'Evil Boneca',     hp: 170,  speed: 26, bite: 30,  coins: 11,
            tint: 0x7a9e7e, scale: 1.05 },
  runner: { base: 'assassino', name: 'Evil Assassino',  hp: 80,   speed: 62, bite: 20,  coins: 10,
            tint: 0xb87b7b, scale: 0.95 },
  bucket: { base: 'burbaloni', name: 'Evil Burbaloni',  hp: 420,  speed: 21, bite: 35,  coins: 18,
            tint: 0x8a8aa8, scale: 1.12 },
  dancer: { base: 'ballerina', name: 'Evil Ballerina',  hp: 150,  speed: 44, bite: 25,  coins: 14,
            tint: 0xa87ba8, scale: 1.0 },
  brute:  { base: 'patapim',   name: 'Evil Patapim',    hp: 650,  speed: 17, bite: 45,  coins: 26,
            tint: 0x77778f, scale: 1.2 },
  giant:  { base: 'tungtung',  name: 'EVIL TUNG TUNG',  hp: 1600, speed: 12, bite: 160, coins: 70,
            tint: 0x6f5f8f, scale: 1.6, mini: true },
};

const BOSSES = {
  megaBombardiro: {
    base: 'bombardiro', name: 'MEGA BOMBARDIRO', hp: 4200, speed: 9, bite: 260, coins: 250,
    tint: 0x5f6f8f, scale: 2.2, boss: true,
  },
};

window.ENEMIES = ENEMIES;
window.BOSSES = BOSSES;
