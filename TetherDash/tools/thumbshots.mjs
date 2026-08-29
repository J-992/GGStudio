// Square gameplay plates for the store thumbnail, shot out of the running game.
//
// Both runners get null input, so GameScene falls through to CompanionAI and
// the game plays itself; the script waits until the feature it wants sits 6-12
// units ahead, sets a pose for one frame, freezes, and crops a square around
// the pair. It also grabs the two menu screens. Output lands in docs/ -- see
// docs/README.md.
//
// Two things are staged rather than played: the camera is pulled in tighter
// than play (CFG.CAM_BACK/CAM_HEIGHT) and the cord thresholds are squeezed so a
// photogenic separation reads as the orange high-tension cord. At the real
// thresholds that separation draws the yellow cord, which is invisible against
// a yellow factory floor. Both are per-shot state and touch no game file.
//
//   npm run dev                  # any static server on :8123
//   node tools/thumbshots.mjs
//
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = process.env.LOCALAPPDATA.split(String.fromCharCode(92)).join('/') + '/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const OUT = process.env.OUT || 'docs/thumbnail/raw';
const UI = process.env.UI_OUT || 'docs/screens';
const SIDE = 480;                                 // 480 css at dsf 3 -> 1440 px
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;   // reshoot one plate
mkdirSync(OUT, { recursive: true });
mkdirSync(UI, { recursive: true });

const CAM = [6.4, 3.5];
const SHOTS = [
  { tag: 'launch-party',  level: 13, want: 'pads',  minZ: 30, pose: 'launch', cam: [6.2, 3.3] },
  { tag: 'gear-alley',    level: 9,  want: 'gears', minZ: 40, pose: 'leap' },
  { tag: 'tangle',        level: 14, want: 'gears', minZ: 55, pose: 'leap' },
  { tag: 'conveyor',      level: 6,  want: 'bolts', minZ: 45, pose: 'chase' },
  { tag: 'gauntlet',      level: 15, want: 'gears', minZ: 45, pose: 'chase', cam: [6.6, 3.7] },
  { tag: 'bolt-rush',     level: 3,  want: 'bolts', minZ: 60, pose: 'leap' },
  { tag: 'moving-day',    level: 5,  want: 'bolts', minZ: 45, pose: 'leap' },
  { tag: 'first-steps',   level: 1,  want: 'bolts', minZ: 55, pose: 'leap' },
  { tag: 'narrow',        level: 2,  want: 'bolts', minZ: 45, pose: 'leap' },
  { tag: 'wide-gate',     level: 4,  want: 'bolts', minZ: 25, pose: 'chase' },
  { tag: 'split-ends',    level: 7,  want: 'bolts', minZ: 45, pose: 'leap' },
  { tag: 'speed-run',     level: 10, want: 'bolts', minZ: 50, pose: 'leap' },
  { tag: 'divided',       level: 11, want: 'bolts', minZ: 25, pose: 'chase' },
  { tag: 'slalom',        level: 12, want: 'bolts', minZ: 30, pose: 'leap' },
  { tag: 'cord-critical', level: 9,  want: 'gears', minZ: 40, pose: 'wide', cord: 'crit' }
];

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8123/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.game && window.game.scene && window.game.scene.getScene && window.game.scene.getScene('Menu'), null, { timeout: 20000 });
await page.waitForTimeout(1500);

// ---- menu screens first, before anything gets tweaked ----
if (!ONLY) {
await page.screenshot({ path: `${UI}/menu.png` });
await page.evaluate(() => {
  const g = window.game;
  g.scene.stop('Menu'); g.scene.start('LevelSelect');
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${UI}/level-select.png` });
console.log('  menu, level-select');
}

for (const shot of SHOTS) {
  if (ONLY && !ONLY.includes(shot.tag)) continue;
  await page.evaluate(({ level, cord, cam }) => {
    Save.setMode('coop');
    const g = window.game;
    for (const k of ['Menu', 'LevelSelect', 'Game']) if (g.scene.isActive(k)) g.scene.stop(k);
    g.scene.start('Game', { levelId: level });
    CFG.CAM_BACK = cam[0]; CFG.CAM_HEIGHT = cam[1];
    Object.assign(CFG.tether, cord === 'crit'
      ? { slackLength: 0.8, warningLength: 1.6, maxLength: 3.4 }
      : { slackLength: 1.0, warningLength: 2.4, maxLength: 5.0 });
  }, { ...shot, cam: shot.cam || CAM });
  await page.waitForTimeout(450);
  await page.evaluate(() => { window.game.scene.getScene('Game').im.getFor = () => null; });

  const ok = await page.waitForFunction(({ want, minZ }) => {
    const s = window.game.scene.getScene('Game');
    if (!s || !s.playerA || s.respawning) return false;
    const z = (s.playerA.z + s.playerB.z) / 2;
    return (s.course[want] || []).some((o) => o.z > minZ && o.z - z > 6 && o.z - z < 12) &&
           s.playerA.grounded && s.playerB.grounded;
  }, shot, { timeout: 60000 }).catch(() => null);
  if (!ok) { console.log(`  ${shot.tag}: never lined up`); continue; }

  await page.evaluate((pose) => {
    const s = window.game.scene.getScene('Game');
    const A = s.playerA, B = s.playerB;
    A.stun = 0; B.stun = 0; A.state = 'run'; B.state = 'run';
    if (pose === 'leap') {
      A.x = -1.5; B.x = 1.55; A.y = 1.3; B.y = 1.5; A.vy = 1.0; B.vy = 0.5; A.vx = -2; B.vx = 2;
      A.grounded = false; B.grounded = false; B.z = A.z + 0.1;
    } else if (pose === 'wide') {
      A.x = -2.0; B.x = 2.1; A.y = 0.9; B.y = 1.4; A.vy = 0.6; B.vy = 1.0; A.vx = -3; B.vx = 3;
      A.grounded = false; B.grounded = false; B.z = A.z + 0.1;
    } else {
      A.x = -1.5; B.x = 1.4; A.y = 0; B.y = 1.1; A.vy = 0; B.vy = 1.2; A.vx = -1; B.vx = 2.5;
      A.grounded = true; B.grounded = false; B.z = A.z + 1.6;
    }
  }, shot.pose);

  await page.waitForTimeout(40);
  const st = await page.evaluate(() => {
    const s = window.game.scene.getScene('Game');
    window.game.scene.pause('Game');
    return { cord: s.tether.state, tension: +s.tether.tension01.toFixed(2),
             cx: Math.round((s.sprA.x + s.sprB.x) / 2),
             feet: Math.round(Math.max(s.sprA.y, s.sprB.y)), z: Math.round(s.playerA.z) };
  });
  await page.waitForTimeout(90);

  const x = Math.max(0, Math.min(960 - SIDE, Math.round(st.cx - SIDE / 2)));
  const y = Math.max(0, Math.min(540 - SIDE, Math.round(st.feet - 0.72 * SIDE)));
  const clip = { x, y, width: SIDE, height: SIDE };
  await page.screenshot({ path: `${OUT}/${shot.tag}-hud.png`, clip });
  await page.evaluate(() => {
    const s = window.game.scene.getScene('Game');
    for (const o of s.children.list) if (o.depth >= 100) o.setVisible(false);
  });
  await page.waitForTimeout(90);
  await page.screenshot({ path: `${OUT}/${shot.tag}.png`, clip });
  await page.screenshot({ path: `${OUT}/${shot.tag}-wide.png` });
  console.log(`  ${shot.tag}: z=${st.z} cordState=${st.cord} tension=${st.tension}`);
}

await browser.close();
