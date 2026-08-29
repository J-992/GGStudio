// Transparent-background cutouts of the runners and the cord, for compositing
// a thumbnail. The page's game is torn down and rebuilt with transparent:true,
// the course/sky/HUD are hidden, and playwright shoots with omitBackground.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = process.env.LOCALAPPDATA.split(String.fromCharCode(92)).join('/') + '/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const OUT = process.env.OUT || 'docs/cutouts';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8123/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.game && window.game.scene && window.game.scene.getScene && window.game.scene.getScene('Menu'), null, { timeout: 20000 });
await page.waitForTimeout(1200);

// rebuild the game on a transparent canvas
await page.evaluate(() => {
  window.game.destroy(true, false);
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  window.game = new Phaser.Game({
    type: Phaser.WEBGL, parent: 'game', width: CFG.GAME_W, height: CFG.GAME_H,
    transparent: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true },
    scene: [BootScene, MenuScene, LevelSelectScene, GameScene]
  });
});
await page.waitForFunction(() => window.game.scene.getScene('Menu') && window.game.scene.isActive('Menu'), null, { timeout: 20000 });
await page.waitForTimeout(800);

const POSES = [
  { tag: 'pair-leap',   pose: 'leap',   keep: 'both' },
  { tag: 'pair-launch', pose: 'launch', keep: 'both' },
  { tag: 'pair-chase',  pose: 'chase',  keep: 'both' },
  { tag: 'pair-run',    pose: 'run',    keep: 'both' },
  { tag: 'runner-a',    pose: 'leap',   keep: 'A' },
  { tag: 'runner-b',    pose: 'leap',   keep: 'B' },
  { tag: 'runner-a-run', pose: 'run',   keep: 'A' },
  { tag: 'runner-b-run', pose: 'run',   keep: 'B' }
];

for (const p of POSES) {
  await page.evaluate(() => {
    Save.setMode('coop');
    const g = window.game;
    for (const k of ['Menu', 'LevelSelect', 'Game']) if (g.scene.isActive(k)) g.scene.stop(k);
    g.scene.start('Game', { levelId: 9 });
    CFG.CAM_BACK = 6.0; CFG.CAM_HEIGHT = 3.2;
    Object.assign(CFG.tether, { slackLength: 1.0, warningLength: 2.4, maxLength: 5.0 });
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.game.scene.getScene('Game').im.getFor = () => null; });
  await page.waitForTimeout(700);

  const box = await page.evaluate(({ pose, keep }) => {
    const s = window.game.scene.getScene('Game');
    const A = s.playerA, B = s.playerB;
    A.stun = 0; B.stun = 0; A.state = 'run'; B.state = 'run';
    if (pose === 'leap') {
      A.x = -1.5; B.x = 1.55; A.y = 1.3; B.y = 1.5; A.vy = 1.0; B.vy = 0.5; A.vx = -2; B.vx = 2;
      A.grounded = false; B.grounded = false; B.z = A.z + 0.1;
    } else if (pose === 'launch') {
      A.x = -1.2; B.x = 1.35; A.y = 2.4; B.y = 1.8; A.vy = 3.0; B.vy = 4.0; A.vx = -1.5; B.vx = 1.5;
      A.grounded = false; B.grounded = false; B.z = A.z + 0.1;
    } else if (pose === 'chase') {
      A.x = -1.5; B.x = 1.4; A.y = 0; B.y = 1.1; A.vy = 0; B.vy = 1.2; A.vx = -1; B.vx = 2.5;
      A.grounded = true; B.grounded = false; B.z = A.z + 1.6;
    } else {
      A.x = -1.1; B.x = 1.2; A.y = 0; B.y = 0; A.vy = 0; B.vy = 0; A.vx = 0; B.vx = 0;
      A.grounded = true; B.grounded = true; B.z = A.z + 0.1;
    }
    return null;
  }, p);

  await page.waitForTimeout(40);
  const clip = await page.evaluate((keep) => {
    const s = window.game.scene.getScene('Game');
    window.game.scene.pause('Game');
    const keepers = new Set([s.tetherGfx]);
    if (keep !== 'B') keepers.add(s.sprA);
    if (keep !== 'A') keepers.add(s.sprB);
    if (keep === 'both') { /* cord stays */ } else { keepers.delete(s.tetherGfx); }
    for (const o of s.children.list) o.setVisible(keepers.has(o));
    const bs = [];
    for (const o of keepers) if (o.getBounds) bs.push(o.getBounds());
    const pad = 24;
    const x0 = Math.max(0, Math.min(...bs.map((b) => b.x)) - pad);
    const y0 = Math.max(0, Math.min(...bs.map((b) => b.y)) - pad);
    const x1 = Math.min(960, Math.max(...bs.map((b) => b.right)) + pad);
    const y1 = Math.min(540, Math.max(...bs.map((b) => b.bottom)) + pad);
    return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  }, p.keep);
  await page.waitForTimeout(120);

  await page.screenshot({ path: `${OUT}/${p.tag}.png`, clip, omitBackground: true });
  console.log(`  ${p.tag}  ${clip.width}x${clip.height} css @3x`);
}

await browser.close();
