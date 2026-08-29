// Authored levels. `lanes` lists the ACTIVE lanes (0..5): enemies only spawn
// there and units can only be planted there -- level 1 is a two-lane teaching
// lawn, exactly like the single-row first level of the game this is honouring.
//
// Each wave is a list of spawn groups; groups run in parallel, `everyMs` apart
// within the group, lanes dealt round-robin over the active lanes unless a
// spawn pins one. The LAST wave is announced as the FINAL WAVE.
//
// `reward` is the flat coin bonus for clearing (kills pay coins on top).
// Past the last entry the game goes endless: the last recipe repeats with
// compounding hp (CFG.LEVEL.endlessGrowth).
const LEVELS = [
  { level: 1, name: 'THE FRONT LAWN', lanes: [2, 3], startEnergy: 125, reward: 150,
    waves: [
      { spawns: [{ enemy: 'grunt', n: 2, everyMs: 9000, lane: 2 }] },
      { spawns: [{ enemy: 'grunt', n: 3, everyMs: 6500, lane: 2 }] },
      // the lane-3 runner is the moped demo: nothing defends there, the
      // moped does -- the player learns the safety net by watching it fire
      { spawns: [{ enemy: 'grunt', n: 3, everyMs: 5200, lane: 2 }, { enemy: 'runner', n: 1, everyMs: 1000, lane: 3 }] },
  ] },
  { level: 2, name: 'SIDE STREET', lanes: [1, 2, 3, 4], startEnergy: 75, reward: 200,
    waves: [
      { spawns: [{ enemy: 'grunt', n: 4, everyMs: 6000 }] },
      { spawns: [{ enemy: 'grunt', n: 4, everyMs: 4500 }, { enemy: 'shover', n: 2, everyMs: 8000 }] },
      { spawns: [{ enemy: 'runner', n: 3, everyMs: 3000 }, { enemy: 'grunt', n: 3, everyMs: 5000 }] },
  ] },
  { level: 3, name: 'PIAZZA PANIC', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 75, reward: 250,
    waves: [
      { spawns: [{ enemy: 'grunt', n: 5, everyMs: 5000 }] },
      { spawns: [{ enemy: 'shover', n: 3, everyMs: 6000 }, { enemy: 'grunt', n: 4, everyMs: 4500 }] },
      { spawns: [{ enemy: 'runner', n: 4, everyMs: 2600 }, { enemy: 'grunt', n: 4, everyMs: 4000 }] },
      { spawns: [{ enemy: 'bucket', n: 2, everyMs: 9000 }, { enemy: 'grunt', n: 5, everyMs: 3400 }] },
  ] },
  { level: 4, name: 'GELATO ALLEY', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 75, reward: 300,
    waves: [
      { spawns: [{ enemy: 'shover', n: 4, everyMs: 5000 }] },
      { spawns: [{ enemy: 'dancer', n: 3, everyMs: 3800 }, { enemy: 'grunt', n: 4, everyMs: 4200 }] },
      { spawns: [{ enemy: 'bucket', n: 3, everyMs: 7000 }, { enemy: 'runner', n: 3, everyMs: 2800 }] },
      { spawns: [{ enemy: 'grunt', n: 6, everyMs: 2600 }, { enemy: 'shover', n: 3, everyMs: 5200 }] },
  ] },
  { level: 5, name: 'EVIL TUNG TUNG COMES', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 100, reward: 450,
    waves: [
      { spawns: [{ enemy: 'grunt', n: 5, everyMs: 4200 }, { enemy: 'dancer', n: 2, everyMs: 5000 }] },
      { spawns: [{ enemy: 'bucket', n: 3, everyMs: 6500 }, { enemy: 'runner', n: 4, everyMs: 2600 }] },
      { spawns: [{ enemy: 'giant', n: 1, everyMs: 1000, lane: 2 }, { enemy: 'grunt', n: 5, everyMs: 3200 }] },
  ] },
  { level: 6, name: 'CAPPUCCINO QUARTER', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 75, reward: 500,
    waves: [
      { spawns: [{ enemy: 'dancer', n: 4, everyMs: 3200 }, { enemy: 'grunt', n: 4, everyMs: 4000 }] },
      { spawns: [{ enemy: 'brute', n: 2, everyMs: 9000 }, { enemy: 'shover', n: 4, everyMs: 4200 }] },
      { spawns: [{ enemy: 'runner', n: 6, everyMs: 2000 }] },
      { spawns: [{ enemy: 'bucket', n: 4, everyMs: 5200 }, { enemy: 'grunt', n: 6, everyMs: 2600 }] },
  ] },
  { level: 7, name: 'TRATTORIA TERROR', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 75, reward: 550,
    waves: [
      { spawns: [{ enemy: 'brute', n: 2, everyMs: 8000 }, { enemy: 'dancer', n: 3, everyMs: 3400 }] },
      { spawns: [{ enemy: 'grunt', n: 8, everyMs: 2200 }] },
      { spawns: [{ enemy: 'giant', n: 1, everyMs: 1000 }, { enemy: 'runner', n: 4, everyMs: 2400 }] },
      { spawns: [{ enemy: 'bucket', n: 4, everyMs: 4800 }, { enemy: 'shover', n: 4, everyMs: 3800 }] },
  ] },
  { level: 8, name: 'RUSH HOUR', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 75, reward: 600,
    waves: [
      { spawns: [{ enemy: 'runner', n: 6, everyMs: 1800 }, { enemy: 'dancer', n: 3, everyMs: 3000 }] },
      { spawns: [{ enemy: 'brute', n: 3, everyMs: 7000 }, { enemy: 'grunt', n: 6, everyMs: 2400 }] },
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
  { level: 10, name: 'BOSS: MEGA BOMBARDIRO', lanes: [0, 1, 2, 3, 4, 5], startEnergy: 100, reward: 1200,
    boss: 'megaBombardiro',
    waves: [
      { spawns: [{ enemy: 'grunt', n: 6, everyMs: 2800 }, { enemy: 'dancer', n: 3, everyMs: 3400 }] },
      { spawns: [{ enemy: 'brute', n: 3, everyMs: 6000 }, { enemy: 'runner', n: 5, everyMs: 2200 }] },
      { spawns: [{ enemy: 'giant', n: 1, everyMs: 1000 }, { enemy: 'bucket', n: 4, everyMs: 4600 }] },
  ] },
];

window.LEVELS = LEVELS;
