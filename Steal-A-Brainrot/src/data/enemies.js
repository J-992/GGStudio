// Enemy + boss data. hp/coins are the STAGE 1 numbers -- StageDirector scales
// them by CFG.STAGE.hpGrowth/coinGrowth per stage. `speed` is px/sec against a
// ~620px lane (LAYOUT.combatScale corrects for the actual lane length).
// Textures are `en_<id>`, drawn procedurally by TextureFactory.enemy().
const ENEMIES = {
  pizza:     { name: 'Walking Pizza',  hp: 30,  speed: 42, coins: 6,  lives: 1, h: 72,  color: 0xffb74d },
  espresso:  { name: 'Angry Espresso', hp: 20,  speed: 70, coins: 5,  lives: 1, h: 60,  color: 0x6d4c41 },
  croissant: { name: 'Evil Croissant', hp: 55,  speed: 34, coins: 9,  lives: 1, h: 66,  color: 0xd7a86e },
  banana:    { name: 'Evil Banana',    hp: 26,  speed: 58, coins: 6,  lives: 1, h: 78,  color: 0xffe135 },
  pasta:     { name: 'Pasta Monster',  hp: 110, speed: 26, coins: 15, lives: 2, h: 92,  color: 0xfff176 },
};

const BOSSES = {
  megaEspresso: {
    name: 'MEGA ESPRESSO', hp: 900, speed: 13, coins: 120, lives: 3,
    tickets: 2, scale: 2.3, h: 150, color: 0x4e342e, boss: true,
  },
};

window.ENEMIES = ENEMIES;
window.BOSSES = BOSSES;
