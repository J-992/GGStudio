// Rips every texture the game builds at boot out of the Phaser texture manager
// and writes it as a transparent PNG, plus each runner animation frame on its
// own, plus a contact sheet. Most of these textures exist only at runtime --
// TextureFactory draws them into canvases -- so this is the only way to look at
// them as files.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const EXE = process.env.LOCALAPPDATA.split(String.fromCharCode(92)).join('/') + '/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const OUT = process.env.OUT || 'docs/assets';
mkdirSync(`${OUT}/textures`, { recursive: true });
mkdirSync(`${OUT}/runner-frames`, { recursive: true });

const save = (path, dataUrl) =>
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
});
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8123/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.game && window.game.scene && window.game.scene.getScene && window.game.scene.getScene('Menu'), null, { timeout: 20000 });
await page.waitForTimeout(1500);

// ---- every texture, at native size and at 4x for the tiny ones ----
const textures = await page.evaluate(() => {
  const out = [];
  const draw = (src, sx, sy, sw, sh, scale) => {
    const c = document.createElement('canvas');
    c.width = sw * scale; c.height = sh * scale;
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  };
  for (const key of window.game.textures.getTextureKeys()) {
    if (key.startsWith('__')) continue;
    const tex = window.game.textures.get(key);
    const src = tex.getSourceImage();
    const w = src.width, h = src.height;
    const scale = w < 200 ? 4 : 1;
    out.push({ key, w, h, scale, png: draw(src, 0, 0, w, h, 1),
               big: scale > 1 ? draw(src, 0, 0, w, h, scale) : null,
               frames: tex.getFrameNames().length });
  }
  return out;
});
for (const t of textures) {
  save(`${OUT}/textures/${t.key}.png`, t.png);
  if (t.big) save(`${OUT}/textures/${t.key}@4x.png`, t.big);
  console.log(`  ${t.key.padEnd(10)} ${t.w}x${t.h}${t.frames ? `  ${t.frames} frames` : ''}`);
}

// ---- runner sheets, frame by frame ----
const frames = await page.evaluate(() => {
  const out = [];
  for (const key of ['runnerA', 'runnerB']) {
    const tex = window.game.textures.get(key);
    const src = tex.getSourceImage();
    for (const name of tex.getFrameNames()) {
      const f = tex.frames[name];
      const c = document.createElement('canvas');
      c.width = f.cutWidth; c.height = f.cutHeight;
      c.getContext('2d').drawImage(src, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
      out.push({ key, name, png: c.toDataURL('image/png') });
    }
  }
  return out;
});
for (const f of frames) save(`${OUT}/runner-frames/${f.key}-${String(f.name).padStart(2, '0')}.png`, f.png);
console.log(`  ${frames.length} runner frames`);

// ---- contact sheet: everything on one dark card ----
const sheet = await page.evaluate(() => {
  const S = 1440, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, '#1c2a4a'); grd.addColorStop(1, '#0f1830');
  x.fillStyle = grd; x.fillRect(0, 0, S, S);
  x.fillStyle = '#ffd35c';
  x.font = 'bold 46px Nunito, "Trebuchet MS", sans-serif';
  x.fillText('TETHER DASH', 56, 84);
  x.fillStyle = '#8fa6c8';
  x.font = '24px Nunito, "Trebuchet MS", sans-serif';
  x.fillText('runtime textures + runner frames', 56, 122);

  const cell = (cx, cy, w, h, label, src, sx, sy, sw, sh) => {
    x.fillStyle = 'rgba(255,255,255,0.05)';
    x.strokeStyle = 'rgba(255,255,255,0.12)';
    x.beginPath(); x.roundRect(cx, cy, w, h, 14); x.fill(); x.stroke();
    const pad = 22, availW = w - pad * 2, availH = h - pad * 2 - 26;
    const k = Math.min(availW / sw, availH / sh, 4);
    x.drawImage(src, sx, sy, sw, sh, cx + (w - sw * k) / 2, cy + pad + (availH - sh * k) / 2, sw * k, sh * k);
    x.fillStyle = '#cfe0ff';
    x.font = '20px Nunito, "Trebuchet MS", sans-serif';
    x.textAlign = 'center';
    x.fillText(label, cx + w / 2, cy + h - 16);
    x.textAlign = 'left';
  };

  // runner frames along the top two rows
  let y = 160;
  for (const key of ['runnerA', 'runnerB']) {
    const tex = window.game.textures.get(key);
    const src = tex.getSourceImage();
    const names = tex.getFrameNames();
    const w = (S - 112) / names.length;
    names.forEach((n, i) => {
      const f = tex.frames[n];
      cell(56 + i * w, y, w - 8, 250, `${key === 'runnerA' ? 'A' : 'B'}·${n}`, src, f.cutX, f.cutY, f.cutWidth, f.cutHeight);
    });
    y += 262;
  }

  // the procedural props below
  const props = ['bolt', 'gearHaz', 'padGlyph', 'shadow', 'cloud0', 'cloud1', 'cloud2', 'spark', 'puff', 'confetti', 'touchBtn', 'glyphJump', 'glyphLeft', 'glyphRight']
    .filter((k) => window.game.textures.exists(k));
  const cols = 5, cw = (S - 112) / cols;
  props.forEach((k, i) => {
    const src = window.game.textures.get(k).getSourceImage();
    cell(56 + (i % cols) * cw, y + Math.floor(i / cols) * 190, cw - 8, 180, k, src, 0, 0, src.width, src.height);
  });
  return c.toDataURL('image/png');
});
save(`${OUT}/asset-sheet.png`, sheet);
console.log('  asset-sheet.png');

await browser.close();
