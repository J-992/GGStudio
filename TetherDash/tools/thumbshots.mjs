// Square gameplay plates for the store thumbnail, shot out of the running game.
//
// An endless runner has no levels to photograph, so each plate stages the piece
// it wants instead of waiting for it: the track is rebuilt by hand as
// straight -> the piece -> straight, the runner is dropped onto a chosen face
// part-way through it, the game is stepped a few frames so the camera roll and
// the run cycle settle, then frozen and cropped square around the runner.
//
// Staging beats waiting because the interesting plates are the ones where the
// floor is missing -- a played run reaches those maybe once a minute, and only
// if it survives.
//
// Two things are staged rather than played: the camera is pulled in tighter
// than play (CFG.CAM_BACK/CAM_HEIGHT), and a pose is written straight onto the
// runner. Both are per-shot state and touch no game file.
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

const CAM = [7.4, 2.9];

//  face: 0 floor, 1 right wall, 2 ceiling, 3 left wall
//  at:   z into the piece body, past its coupler ring
const SHOTS = [
  { tag: 'wall-run',    piece: 'wallRun',    face: 1, at: 13, u: -1.4, pose: 'run' },
  { tag: 'the-drop',    piece: 'wallRun',    face: 0, at: 3.4, u: 2.6, pose: 'leap' },
  { tag: 'ceiling-run', piece: 'ceilingRun', face: 2, at: 22, u: 0, pose: 'run' },
  { tag: 'spiral',      piece: 'spiral',     face: 1, at: 16, u: 0.6, pose: 'run' },
  { tag: 'cross-flip',  piece: 'crossFlip',  face: 2, at: 20, u: -1.2, pose: 'run' },
  { tag: 'one-wall',    piece: 'oneWall',    face: 1, at: 12, u: 0, pose: 'run' },
  { tag: 'zig-wall',    piece: 'zigWall',    face: 3, at: 14, u: 0.4, pose: 'run' },
  { tag: 'gear-alley',  piece: 'gearAlley',  face: 0, at: 6.5, u: -0.4, pose: 'leap' },
  { tag: 'step-gaps',   piece: 'stepGaps',   face: 0, at: 5.6, u: 0, pose: 'leap' },
  { tag: 'pad-launch',  piece: 'padJump',    face: 0, at: 11, u: 0, pose: 'launch' },
  { tag: 'pillars',     piece: 'pillars',    face: 0, at: 6, u: 1.4, pose: 'run' },
  { tag: 'checker',     piece: 'checker',    face: 0, at: 9, u: 1.2, pose: 'run' },
  { tag: 'narrow',      piece: 'narrow',     face: 0, at: 9, u: 0, pose: 'run' },
  { tag: 'bolt-run',    piece: 'straight',   face: 0, at: 8, u: 0, pose: 'run' }
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

// ---- menu screen first, before anything gets tweaked ----
if (!ONLY) {
  await page.screenshot({ path: `${UI}/menu.png` });
  console.log('  menu');
}

for (const shot of SHOTS) {
  if (ONLY && !ONLY.includes(shot.tag)) continue;

  const staged = await page.evaluate(({ piece, face, at, u, pose, cam }) => {
    const g = window.game;
    for (const k of ['Menu', 'Game']) if (g.scene.isActive(k)) g.scene.stop(k);
    g.scene.start('Game');
    return { piece, face, at, u, pose, cam };
  }, { ...shot, cam: shot.cam || CAM });

  await page.waitForFunction(() => {
    const s = window.game.scene.getScene('Game');
    return s && s.player && s.sys.settings.status === 5;
  }, null, { timeout: 20000 });

  const ok = await page.evaluate(({ piece, face, at, u, pose, cam }) => {
    const s = window.game.scene.getScene('Game');
    const def = PIECES.find((d) => d.id === piece);
    if (!def) return null;

    CFG.CAM_BACK = cam[0]; CFG.CAM_HEIGHT = cam[1];

    //  straight -> the piece -> straight, welded from scratch
    for (const c of Track.chunks) Track._recycle(c);
    Track.chunks.length = 0; Track.headZ = 0; Track.distance = 0; Track.lastDef = null;
    Track._spawn(PIECES[0]);
    const target = Track._spawn(def);
    Track._spawn(PIECES[0]);

    const p = s.player;
    p.reset(target.z0 + CFG.RING_LEN + at);
    p.f = face;
    p.u = u;
    p.roll = -Math.PI / 2 * face;
    if (pose === 'leap') { p.h = 1.35; p.vh = 1.2; p.grounded = false; }
    else if (pose === 'launch') { p.h = 2.6; p.vh = 3.4; p.grounded = false; }
    else { p.h = 0; p.vh = 0; p.grounded = true; }
    s.cam.snapTo(p);
    s.hintSide = 0;
    return { z: Math.round(p.z) };
  }, { ...shot, cam: shot.cam || CAM });

  if (!ok) { console.log(`  ${shot.tag}: no piece "${shot.piece}"`); continue; }

  //  A handful of frames so the run cycle, the cord and the shadow settle,
  //  with the runner pinned in place rather than running out of the shot.
  await page.evaluate((pose) => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    const held = { f: p.f, u: p.u, h: p.h, z: p.z, roll: p.roll };
    for (let i = 0; i < 6; i++) {
      s.cam.update(1 / 60, p);
      s.render(1 / 60);
      Object.assign(p, held);
    }
  }, shot.pose);
  await page.waitForTimeout(120);

  const st = await page.evaluate(() => {
    const s = window.game.scene.getScene('Game');
    window.game.scene.pause('Game');
    return { cx: Math.round(s.spr.x), feet: Math.round(s.spr.y), face: s.player.f };
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
  console.log(`  ${shot.tag}: ${shot.piece} on face ${st.face} at z=${ok.z}`);
  await page.evaluate(() => window.game.scene.resume('Game'));
}

await browser.close();
