// Transparent-background cutouts of the runner and his tether, for compositing
// a thumbnail. The page's game is torn down and rebuilt with transparent:true,
// the tunnel and HUD are hidden, and playwright shoots with omitBackground.
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
    scene: [BootScene, MenuScene, GameScene]
  });
});
await page.waitForFunction(() => window.game.scene.getScene('Menu') && window.game.scene.isActive('Menu'), null, { timeout: 20000 });
await page.waitForTimeout(800);

//  cord: keep the tether beam in the cutout as well as the runner
const POSES = [
  { tag: 'runner-run',   pose: 'run',    cord: false },
  { tag: 'runner-leap',  pose: 'leap',   cord: false },
  { tag: 'runner-launch', pose: 'launch', cord: false },
  { tag: 'runner-tether', pose: 'leap',  cord: true },
  { tag: 'runner-fall',  pose: 'fall',   cord: false }
];

for (const p of POSES) {
  await page.evaluate(() => {
    const g = window.game;
    for (const k of ['Menu', 'Game']) if (g.scene.isActive(k)) g.scene.stop(k);
    g.scene.start('Game');
  });
  await page.waitForFunction(() => {
    const s = window.game.scene.getScene('Game');
    return s && s.player && s.sys.settings.status === 5;
  }, null, { timeout: 20000 });

  await page.evaluate(({ pose }) => {
    const s = window.game.scene.getScene('Game');
    CFG.CAM_BACK = 5.6; CFG.CAM_HEIGHT = 2.6;
    const r = s.player;
    r.reset(12);
    r.u = 0;
    if (pose === 'leap') { r.h = 1.4; r.vh = 1.1; r.vu = 1.6; r.grounded = false; }
    else if (pose === 'launch') { r.h = 2.7; r.vh = 3.6; r.grounded = false; }
    else if (pose === 'fall') { r.h = -0.9; r.vh = -6; r.vu = -2.2; r.grounded = false; }
    else { r.h = 0; r.vh = 0; r.grounded = true; }
    s.cam.snapTo(r);
    const held = { f: r.f, u: r.u, h: r.h, z: r.z, roll: r.roll };
    for (let i = 0; i < 6; i++) { s.cam.update(1 / 60, r); s.render(1 / 60); Object.assign(r, held); }
  }, p);
  await page.waitForTimeout(120);

  const clip = await page.evaluate(({ cord }) => {
    const s = window.game.scene.getScene('Game');
    window.game.scene.pause('Game');
    const keepers = new Set([s.spr]);
    if (cord) keepers.add(s.cordGfx);
    for (const o of s.children.list) o.setVisible(keepers.has(o));
    const bs = [];
    for (const o of keepers) if (o.getBounds) bs.push(o.getBounds());
    const pad = 24;
    const x0 = Math.max(0, Math.min(...bs.map((b) => b.x)) - pad);
    const y0 = Math.max(0, Math.min(...bs.map((b) => b.y)) - pad);
    const x1 = Math.min(960, Math.max(...bs.map((b) => b.right)) + pad);
    const y1 = Math.min(540, Math.max(...bs.map((b) => b.bottom)) + pad);
    return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  }, p);
  await page.waitForTimeout(120);

  await page.screenshot({ path: `${OUT}/${p.tag}.png`, clip, omitBackground: true });
  console.log(`  ${p.tag}  ${clip.width}x${clip.height} css @3x`);
  await page.evaluate(() => window.game.scene.resume('Game'));
}

await browser.close();
