/* eslint-disable no-undef -- Playwright callbacks intentionally execute in the browser realm. */
/** Frame-by-frame combat, merge, and spawn evidence for visual timing review. */
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:5180';
const out = process.argv[3] ?? 'screenshots/motion-qa';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  localStorage.clear();
  const offsetMs = new Date().getTimezoneOffset() * 60_000;
  const today = Math.floor((Date.now() - offsetMs) / 86_400_000);
  localStorage.setItem('mergeninja.meta.v1', JSON.stringify({
    ascensions: 0,
    lastVisitDay: today,
    daysVisited: 1,
    tutorialCompleted: true,
    powerupCoachCompleted: true,
    boardLessonsSeen: ['lockedSlots', 'debris'],
    archetypeSeen: ['bare', 'shielded', 'enraged', 'greedy'],
    achievements: ['first-merge', 'first-victory', 'stage-10', 'tier-10'],
  }));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mn?.ready === true, null, { timeout: 20_000 });

await page.evaluate(() => {
  const core = window.__mn.core;
  core.setSpeed(0);
  core.economy.coins = 100_000;
  [1, 8, 12].forEach((tier) => core.spawnTier(tier));
});
await page.waitForTimeout(650);
for (let frame = 0; frame < 14; frame += 1) {
  await page.waitForTimeout(85);
  await page.screenshot({ path: `${out}/attack-${String(frame).padStart(2, '0')}.png` });
}

await page.evaluate(() => {
  const core = window.__mn.core;
  core.clearBoard();
  core.spawnTier(4);
  core.spawnTier(4);
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  const slots = window.__mn.core.board.slots;
  const pair = slots.map((ninja, slot) => ({ ninja, slot })).filter((entry) => entry.ninja?.tier === 4);
  window.__mn.core.drop(pair[0].slot, { kind: 'slot', slot: pair[1].slot });
});
for (let frame = 0; frame < 10; frame += 1) {
  await page.waitForTimeout(70);
  await page.screenshot({ path: `${out}/merge-${String(frame).padStart(2, '0')}.png` });
}

await page.evaluate(() => window.__mn.core.skipEnemy());
for (let frame = 0; frame < 10; frame += 1) {
  await page.waitForTimeout(75);
  await page.screenshot({ path: `${out}/spawn-${String(frame).padStart(2, '0')}.png` });
}

const fps = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const started = performance.now();
  const tick = () => {
    frames += 1;
    if (performance.now() - started < 1_500) requestAnimationFrame(tick);
    else resolve(Math.round(frames * 1_000 / (performance.now() - started)));
  };
  requestAnimationFrame(tick);
}));

console.log(JSON.stringify({ fps, errors }, null, 2));
await browser.close();
