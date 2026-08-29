// Authored stage recipes. Each wave is a list of spawn groups; groups run in
// parallel, `everyMs` apart within the group. Lanes are dealt round-robin with
// jitter by CombatSystem unless a spawn pins one. Stage scaling (hp, coins)
// comes from CFG.STAGE so tuning lives in one place. Every 5th stage is a boss
// (CFG.STAGE.bossEveryN -- check.mjs enforces the pattern).
//
// Past the last entry the game goes endless: STAGES[last] repeats with
// compounding hp growth (StageDirector.recipeFor).
const STAGES = [
  // Stage 1 stays in the middle lane, where the tutorial deploys the first
  // unit -- the first stage teaches killing, stage 2 teaches lanes.
  { stage: 1, name: 'ITALIAN STREET', waves: [
      { spawns: [{ enemy: 'pizza', n: 3, everyMs: 1800, lane: 1 }] },
      { spawns: [{ enemy: 'pizza', n: 5, everyMs: 1400, lane: 1 }] },
      { spawns: [{ enemy: 'pizza', n: 4, everyMs: 1300, lane: 1 }, { enemy: 'espresso', n: 1, everyMs: 1000, lane: 0 }] },
  ] },
  { stage: 2, name: 'ITALIAN STREET', waves: [
      { spawns: [{ enemy: 'espresso', n: 4, everyMs: 1500 }] },
      { spawns: [{ enemy: 'pizza', n: 4, everyMs: 1200 }, { enemy: 'espresso', n: 3, everyMs: 1800 }] },
      { spawns: [{ enemy: 'croissant', n: 2, everyMs: 2200 }, { enemy: 'pizza', n: 4, everyMs: 1300 }] },
  ] },
  { stage: 3, name: 'BRAINROT BEACH', waves: [
      { spawns: [{ enemy: 'banana', n: 5, everyMs: 1300 }] },
      { spawns: [{ enemy: 'croissant', n: 3, everyMs: 1900 }, { enemy: 'banana', n: 3, everyMs: 1600 }] },
      { spawns: [{ enemy: 'pizza', n: 5, everyMs: 1100 }, { enemy: 'espresso', n: 3, everyMs: 1700 }] },
      { spawns: [{ enemy: 'pasta', n: 1, everyMs: 1000 }, { enemy: 'banana', n: 4, everyMs: 1400 }] },
  ] },
  { stage: 4, name: 'BRAINROT BEACH', waves: [
      { spawns: [{ enemy: 'croissant', n: 4, everyMs: 1600 }] },
      { spawns: [{ enemy: 'pasta', n: 2, everyMs: 2600 }, { enemy: 'espresso', n: 4, everyMs: 1400 }] },
      { spawns: [{ enemy: 'banana', n: 6, everyMs: 1000 }] },
      { spawns: [{ enemy: 'pasta', n: 2, everyMs: 2400 }, { enemy: 'croissant', n: 3, everyMs: 1700 }] },
  ] },
  { stage: 5, name: 'BOSS: MEGA ESPRESSO', boss: 'megaEspresso', waves: [
      { spawns: [{ enemy: 'espresso', n: 5, everyMs: 1300 }] },
      { spawns: [{ enemy: 'espresso', n: 4, everyMs: 1200 }, { enemy: 'croissant', n: 2, everyMs: 2200 }] },
  ] },
  { stage: 6, name: 'BANANA JUNGLE', waves: [
      { spawns: [{ enemy: 'banana', n: 6, everyMs: 1100 }] },
      { spawns: [{ enemy: 'banana', n: 5, everyMs: 1000 }, { enemy: 'pasta', n: 2, everyMs: 2600 }] },
      { spawns: [{ enemy: 'croissant', n: 4, everyMs: 1500 }, { enemy: 'espresso', n: 4, everyMs: 1300 }] },
  ] },
  { stage: 7, name: 'BANANA JUNGLE', waves: [
      { spawns: [{ enemy: 'pasta', n: 3, everyMs: 2200 }] },
      { spawns: [{ enemy: 'banana', n: 7, everyMs: 900 }] },
      { spawns: [{ enemy: 'pasta', n: 2, everyMs: 2400 }, { enemy: 'croissant', n: 4, everyMs: 1400 }] },
      { spawns: [{ enemy: 'espresso', n: 8, everyMs: 800 }] },
  ] },
  { stage: 8, name: 'CAPPUCCINO CITY', waves: [
      { spawns: [{ enemy: 'espresso', n: 6, everyMs: 1000 }, { enemy: 'pizza', n: 4, everyMs: 1400 }] },
      { spawns: [{ enemy: 'croissant', n: 5, everyMs: 1300 }] },
      { spawns: [{ enemy: 'pasta', n: 3, everyMs: 2000 }, { enemy: 'banana', n: 5, everyMs: 1100 }] },
      { spawns: [{ enemy: 'espresso', n: 6, everyMs: 900 }, { enemy: 'croissant', n: 3, everyMs: 1600 }] },
  ] },
  { stage: 9, name: 'CAPPUCCINO CITY', waves: [
      { spawns: [{ enemy: 'pasta', n: 4, everyMs: 1900 }] },
      { spawns: [{ enemy: 'croissant', n: 6, everyMs: 1100 }, { enemy: 'espresso', n: 5, everyMs: 1000 }] },
      { spawns: [{ enemy: 'banana', n: 8, everyMs: 800 }] },
      { spawns: [{ enemy: 'pasta', n: 3, everyMs: 1800 }, { enemy: 'pizza', n: 6, everyMs: 900 }] },
  ] },
  { stage: 10, name: 'BOSS: MEGA MEGA ESPRESSO', boss: 'megaEspresso', bossMult: 3.2, waves: [
      { spawns: [{ enemy: 'espresso', n: 6, everyMs: 1000 }] },
      { spawns: [{ enemy: 'pasta', n: 3, everyMs: 2000 }, { enemy: 'croissant', n: 4, everyMs: 1400 }] },
  ] },
];

window.STAGES = STAGES;
