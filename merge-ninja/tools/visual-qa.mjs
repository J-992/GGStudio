/* eslint-disable no-undef -- Playwright callbacks intentionally execute in the browser realm. */
/**
 * Deterministic multi-viewport screenshot pass for art-direction review.
 *
 * Usage: node tools/visual-qa.mjs [url] [output-directory]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:5180';
const outputDirectory = process.argv[3] ?? 'screenshots/visual-qa';
const viewports = [
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
  { name: 'desktop-1536x864', width: 1536, height: 864 },
  { name: 'desktop-1366x768', width: 1366, height: 768 },
  { name: 'portrait-390x844', width: 390, height: 844, mobile: true },
];

mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.mobile ? 2 : 1,
    hasTouch: viewport.mobile === true,
    isMobile: viewport.mobile === true,
  });
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
    }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn?.ready === true, null, { timeout: 20_000 });
  await page.evaluate(() => {
    const core = window.__mn.core;
    core.setSpeed(0);
    core.economy.coins = 36_100;
    [1, 2, 3, 4, 2, 3].forEach((tier) => core.spawnTier(tier));
  });
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: `${outputDirectory}/${viewport.name}.png` });
  console.log(`${viewport.name}: ${errors.length === 0 ? 'clean' : errors.join(' | ')}`);
  await context.close();
}

await browser.close();
