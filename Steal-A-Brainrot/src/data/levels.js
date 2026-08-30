// Authored levels. `lanes` lists the ACTIVE lanes (0..5): enemies only spawn
// there and units can only be planted there.
//
// THE RAMP. The lawn opens one lane at a time -- 2, 3, 4, 5, then 6 -- because
// the width of the lawn, not the enemy count, is what actually sets the
// difficulty: a new lane is a whole extra column of plants you have to fund
// before anything walks down it. Level 2 used to jump straight from 2 lanes to
// 4 while cutting the starting money from 125 to 75, which asked the player to
// cover twice the ground with 60% of the budget on the first level after the
// tutorial. That is the cliff; the ramp below is the fix.
//
// Enemy types arrive one per level too, each with a level of grunts-only
// company first: shovers at 3, runners at 3, buckets at 4, dancers at 5,
// brutes at 6, the giant at 7.
//
// Each wave is a list of spawn groups; groups run in parallel, `everyMs` apart
// within the group, lanes dealt round-robin over the active lanes unless a
// spawn pins one. The LAST wave is announced as the FINAL WAVE.
//
// `prepMs` and `waveGapMs` override CFG.LEVEL for this level only -- the early
// levels get a longer look at an empty lawn and a longer gap between waves,
// which is the cheapest difficulty dial there is and the one that does not
// make the game feel easier once you are good at it.
//
// `reward` is the flat coin bonus for clearing (kills pay coins on top).
// Past the last entry the game goes endless: the last recipe repeats with
// compounding hp (CFG.LEVEL.endlessGrowth).
const LEVELS = [
  { level: 1, name: 'THE FRONT LAWN', lanes: [2, 3], startEnergy: 125, reward: 150,
    prepMs: 15000, waveGapMs: 30000,
    waves: [
      { spawns: [{ enemy: 'grunt', n: 2, everyMs: 10000, lane: 2 }] },
      { spawns: [{ enemy: 'grunt', n: 3, everyMs: 8000, lane: 2 }] },
      // the lane-3 runner is the moped demo: nothing defends there, the
      // moped does -- the player learns the safety net by watching it fire
      { spawns: [{ enemy: 'grunt', n: 3, everyMs: 7000, lane: 2 }, { enemy: 'runner', n: 1, everyMs: 1000, lane: 3 }] },
  ] },
  // One new lane, the same money as level 1, and still nothing but grunts
  // until the last wave. This is the level that has to teach "a producer
  // first, every time" without punishing you for learning it.
  { level: 2, name: 'GARDEN GATE', lanes: [2, 3, 4], startEnergy: 125, reward: 180,
    prepMs: 14000, waveGapMs: 30000,
    waves: [
      { spawns: [{ enemy: 'grunt', n: 3, everyMs: 8000 }] },
      { spawns: [{ enemy: 'grunt', n: 4, everyMs: 6500 }] },
      { spawns: [{ enemy: 'grunt', n: 3, everyMs: 6000 }, { enemy: 'shover', n: 1, everyMs: 9000 }] },
  ] },
  { level: 3, name: 'SIDE STREET', lanes: [1, 2, 3, 4], startEnergy: 100, reward: 220,
    prepMs: 12000, waveGapMs: 28000,
    waves: [
      { spawns: [{ enemy: 'grunt', n: 4, everyMs: 6000 }] },
      { spawns: [{ enemy: 'grunt', n: 4, everyMs: 5000 }, { enemy: 'shover', n: 2, everyMs: 8000 }] },
      { spawns: [{ enemy: 'runner', n: 2, everyMs: 4000 }, { enemy: 'grunt', n: 4, everyMs: 5000 }] },
  ] },
  { level: 4, name: 'PIAZZA PANIC', lanes: [0, 1, 2, 3, 4], startEnergy: 100, reward: 280,
    prepMs: 10000, waveGapMs: 27000,
    waves: [
      { spawns: [{ enemy: 'grunt', n: 5, everyMs: 5500 }] },
      { spawns: [{ enemy: 'shover', n: 3, everyMs: 6000 }, { enemy: 'grunt', n: 4, everyMs: 5000 }] },
      { spawns: [{ enemy: 'runner', n: 3, everyMs: 3200 }, { enemy: 'grunt', n: 4, everyMs: 4500 }] },
      { spawns: [{ enemy: 'bucket', n: 1, everyMs: 9000 }, { enemy: 'grunt', n: 5, everyMs: 4000 }] },
  ] },
  { level: 5, name: 'GELATO ALLEY', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 100, reward: 340,
    prepMs: 10000,
    waves: [
      { spawns: [{ enemy: 'grunt', n: 5, everyMs: 5000 }] },
      { spawns: [{ enemy: 'shover', n: 3, everyMs: 5500 }, { enemy: 'dancer', n: 2, everyMs: 5000 }] },
      { spawns: [{ enemy: 'bucket', n: 2, everyMs: 8000 }, { enemy: 'runner', n: 3, everyMs: 3000 }] },
      { spawns: [{ enemy: 'grunt', n: 6, everyMs: 3600 }, { enemy: 'shover', n: 3, everyMs: 5000 }] },
  ] },
  { level: 6, name: 'CAPPUCCINO QUARTER', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 75, reward: 420,
    waves: [
      { spawns: [{ enemy: 'dancer', n: 4, everyMs: 3600 }, { enemy: 'grunt', n: 4, everyMs: 4200 }] },
      { spawns: [{ enemy: 'bucket', n: 3, everyMs: 6500 }, { enemy: 'shover', n: 4, everyMs: 4400 }] },
      { spawns: [{ enemy: 'runner', n: 5, everyMs: 2400 }] },
      { spawns: [{ enemy: 'brute', n: 1, everyMs: 9000 }, { enemy: 'grunt', n: 6, everyMs: 3000 }] },
  ] },
  { level: 7, name: 'TRATTORIA TERROR', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 75, reward: 500,
    waves: [
      { spawns: [{ enemy: 'brute', n: 2, everyMs: 8000 }, { enemy: 'dancer', n: 3, everyMs: 3600 }] },
      { spawns: [{ enemy: 'grunt', n: 8, everyMs: 2400 }] },
      { spawns: [{ enemy: 'bucket', n: 3, everyMs: 5200 }, { enemy: 'runner', n: 4, everyMs: 2600 }] },
      { spawns: [{ enemy: 'giant', n: 1, everyMs: 1000 }, { enemy: 'grunt', n: 5, everyMs: 3400 }] },
  ] },
  { level: 8, name: 'RUSH HOUR', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 75, reward: 580,
    waves: [
      { spawns: [{ enemy: 'runner', n: 6, everyMs: 2000 }, { enemy: 'dancer', n: 3, everyMs: 3200 }] },
      { spawns: [{ enemy: 'brute', n: 3, everyMs: 7000 }, { enemy: 'grunt', n: 6, everyMs: 2600 }] },
      { spawns: [{ enemy: 'giant', n: 1, everyMs: 1000 }, { enemy: 'bucket', n: 3, everyMs: 5200 }] },
      { spawns: [{ enemy: 'shover', n: 6, everyMs: 2800 }, { enemy: 'runner', n: 5, everyMs: 2000 }] },
  ] },
  { level: 9, name: 'THE LONG NIGHT', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 75, reward: 700,
    waves: [
      { spawns: [{ enemy: 'brute', n: 3, everyMs: 6000 }, { enemy: 'dancer', n: 4, everyMs: 2800 }] },
      { spawns: [{ enemy: 'giant', n: 1, everyMs: 1000 }, { enemy: 'grunt', n: 8, everyMs: 2000 }] },
      { spawns: [{ enemy: 'bucket', n: 5, everyMs: 4200 }, { enemy: 'runner', n: 5, everyMs: 2000 }] },
      { spawns: [{ enemy: 'giant', n: 2, everyMs: 12000 }, { enemy: 'shover', n: 6, everyMs: 2600 }] },
  ] },
  { level: 10, name: 'BOSS: THE SLIME KING', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 100, reward: 1200,
    boss: 'slimeKing',
    waves: [
      { spawns: [{ enemy: 'grunt', n: 6, everyMs: 2800 }, { enemy: 'dancer', n: 3, everyMs: 3400 }] },
      { spawns: [{ enemy: 'brute', n: 3, everyMs: 6000 }, { enemy: 'runner', n: 5, everyMs: 2200 }] },
      { spawns: [{ enemy: 'giant', n: 1, everyMs: 1000 }, { enemy: 'bucket', n: 4, everyMs: 4600 }] },
  ] },
];

window.LEVELS = LEVELS;
