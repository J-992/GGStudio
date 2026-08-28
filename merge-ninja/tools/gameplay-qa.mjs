/* eslint-disable no-undef -- Playwright callbacks intentionally execute in the browser realm. */
/** End-to-end interaction and persistence smoke test for the rendered game. */
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:5180';
const out = process.argv[3] ?? 'screenshots/gameplay-qa';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const quietMeta = () => {
  if (sessionStorage.getItem('mn-gameplay-qa-seeded') === 'yes') return;
  sessionStorage.setItem('mn-gameplay-qa-seeded', 'yes');
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
    revealedTiers: Array.from({ length: 29 }, (_, index) => index + 1),
    discoveredTiers: Array.from({ length: 29 }, (_, index) => index + 1),
    seenBosses: Array.from({ length: 17 }, (_, index) => index),
    achievements: [
      'first-merge', 'first-victory', 'merge-50', 'stage-10', 'tier-10',
      'survive-10min', 'merge-250', 'boss-25', 'stage-25',
    ],
  }));
};

const browser = await chromium.launch({
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
await context.addInitScript(quietMeta);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mn?.ready === true, null, { timeout: 20_000 });

await page.evaluate(() => {
  window.__mn.core.setSpeed(0);
  window.__mn.core.grantCoins(100_000);
});

const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(620);
};

// Buy through the real button hit target twice.
const buyPos = await page.evaluate(() => window.__mn.buyPos());
const beforeBuy = await page.evaluate(() => ({
  count: window.__mn.core.board.slots.filter(Boolean).length,
  coins: window.__mn.core.economy.coins,
}));
await page.mouse.click(buyPos.x, buyPos.y);
await page.waitForTimeout(520);
await page.mouse.click(buyPos.x, buyPos.y);
await page.waitForTimeout(620);
const afterBuy = await page.evaluate(() => ({
  count: window.__mn.core.board.slots.filter(Boolean).length,
  coins: window.__mn.core.economy.coins,
}));
assert.equal(afterBuy.count, beforeBuy.count + 2, 'buy button should add two ninjas');
assert.ok(afterBuy.coins < beforeBuy.coins, 'buy button should spend coins');

// Drag the purchased equal-tier pair together through Phaser input.
const pair = await page.evaluate(() => window.__mn.core.board.slots
  .map((ninja, slot) => ({ ninja, slot }))
  .filter((entry) => entry.ninja !== null)
  .slice(0, 2)
  .map((entry) => ({ slot: entry.slot, body: window.__mn.bodyPos(entry.slot) })));
const pairTarget = await page.evaluate((slot) => window.__mn.slotPos(slot), pair[1].slot);
await drag(pair[0].body, pairTarget);
const merged = await page.evaluate(() => ({
  count: window.__mn.core.board.slots.filter(Boolean).length,
  merges: window.__mn.core.metrics.merges,
  tiers: window.__mn.core.board.slots.filter(Boolean).map((ninja) => ninja.tier),
}));
assert.equal(merged.count, 1, 'merge should consume two ninjas and reveal one');
assert.equal(merged.merges, 1, 'merge metric should advance');
assert.deepEqual(merged.tiers, [2], 'equal tier-1 ninjas should merge into tier 2');

// Drag to an empty pedestal, then swap unlike tiers.
await page.evaluate(() => window.__mn.core.spawnTier(3));
await page.waitForTimeout(480);
const occupied = await page.evaluate(() => window.__mn.core.board.slots
  .map((ninja, slot) => ({ ninja, slot }))
  .filter((entry) => entry.ninja !== null));
const emptySlot = await page.evaluate(() => window.__mn.core.board.slots.findIndex((ninja, slot) => ninja === null && !window.__mn.core.lockedSlots.includes(slot)));
const moveFrom = occupied[0].slot;
await drag(
  await page.evaluate((slot) => window.__mn.bodyPos(slot), moveFrom),
  await page.evaluate((slot) => window.__mn.slotPos(slot), emptySlot),
);
assert.equal(await page.evaluate((slot) => window.__mn.core.board.at(slot)?.tier, emptySlot), occupied[0].ninja.tier, 'drag should move a ninja to an empty slot');

const tier3Slot = await page.evaluate(() => window.__mn.core.board.slots.findIndex((ninja) => ninja?.tier === 3));
const tier2Slot = await page.evaluate(() => window.__mn.core.board.slots.findIndex((ninja) => ninja?.tier === 2));
const swapResult = await page.evaluate(({ from, to }) => window.__mn.core.drop(from, { kind: 'slot', slot: to }), { from: tier2Slot, to: tier3Slot });
assert.equal(swapResult, 'swapped', 'unlike tiers should resolve through the swap path');
await page.waitForTimeout(260);
assert.equal(await page.evaluate((slot) => window.__mn.core.board.at(slot)?.tier, tier3Slot), 2, 'unlike tiers should swap');

// Sell via the real drag target and verify both board and economy outcomes.
const sellBefore = await page.evaluate(() => ({
  count: window.__mn.core.board.slots.filter(Boolean).length,
  coins: window.__mn.core.economy.coins,
}));
const sellSlot = await page.evaluate(() => window.__mn.core.board.slots.findIndex(Boolean));
await drag(
  await page.evaluate((slot) => window.__mn.bodyPos(slot), sellSlot),
  await page.evaluate(() => window.__mn.trashPos()),
);
const sellAfter = await page.evaluate(() => ({
  count: window.__mn.core.board.slots.filter(Boolean).length,
  coins: window.__mn.core.economy.coins,
}));
assert.equal(sellAfter.count, sellBefore.count - 1, 'trash drop should remove one ninja');
assert.ok(sellAfter.coins > sellBefore.coins, 'trash drop should pay a refund');

// Walk the real boss defeat/spawn path to the first earned slot unlock.
const combat = await page.evaluate(() => {
  const core = window.__mn.core;
  core.setSpeed(1);
  const hpBefore = core.boss.hp;
  core.tapBoss();
  const damagedHp = core.boss.hp;
  while (core.currentStage <= 10) {
    core.defeatBossForTest();
    core.update(500);
    if (core.pendingDraft !== null) core.pickDraftCard(core.pendingDraft.cards[0]);
  }
  core.setSpeed(0);
  return { hpBefore, damagedHp, stage: core.currentStage, unlocked: core.unlockedSlotCount };
});
assert.ok(combat.damagedHp < combat.hpBefore, 'manual combat should damage the boss');
assert.equal(combat.stage, 11, 'boss defeat/spawn path should advance stages');
assert.equal(combat.unlocked, 9, 'defeating stage 10 should unlock the ninth board slot');
await page.waitForTimeout(900);

// Save, reload, and compare the durable state.
const saved = await page.evaluate(() => {
  const core = window.__mn.core;
  core.save();
  return {
    stage: core.currentStage,
    coins: core.economy.coins,
    unlocked: core.unlockedSlotCount,
    board: core.board.slots.map((ninja) => ninja?.tier ?? null),
  };
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mn?.ready === true, null, { timeout: 20_000 });
const loaded = await page.evaluate(() => ({
  stage: window.__mn.core.currentStage,
  coins: window.__mn.core.economy.coins,
  unlocked: window.__mn.core.unlockedSlotCount,
  board: window.__mn.core.board.slots.map((ninja) => ninja?.tier ?? null),
}));
assert.deepEqual(loaded, saved, 'save/load should preserve stage, economy, unlocks, and board');

// Resize the same live game and assert browser-level containment.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const responsive = await page.evaluate(() => {
  const rect = document.querySelector('canvas').getBoundingClientRect();
  return {
    canvas: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    viewport: { width: innerWidth, height: innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
  };
});
assert.ok(responsive.canvas.left >= -1 && responsive.canvas.right <= responsive.viewport.width + 1, 'portrait canvas should stay within the viewport');
assert.ok(responsive.canvas.top >= -1 && responsive.canvas.bottom <= responsive.viewport.height + 1, 'portrait canvas should stay within the viewport');
assert.equal(responsive.scrollWidth, responsive.viewport.width, 'portrait should have no horizontal overflow');
await page.screenshot({ path: `${out}/portrait-after-save.png` });

// A real touch tap exercises the mobile pointer path in a mobile context.
const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
await mobileContext.addInitScript(quietMeta);
const mobile = await mobileContext.newPage();
mobile.on('pageerror', (error) => errors.push(error.message));
await mobile.goto(url, { waitUntil: 'domcontentloaded' });
await mobile.waitForFunction(() => window.__mn?.ready === true, null, { timeout: 20_000 });
await mobile.evaluate(() => {
  window.__mn.core.setSpeed(0);
  window.__mn.core.grantCoins(10_000);
});
const mobileBuy = await mobile.evaluate(() => window.__mn.buyPos());
const mobileCount = await mobile.evaluate(() => window.__mn.core.board.slots.filter(Boolean).length);
await mobile.touchscreen.tap(mobileBuy.x, mobileBuy.y);
await mobile.waitForTimeout(620);
assert.equal(await mobile.evaluate(() => window.__mn.core.board.slots.filter(Boolean).length), mobileCount + 1, 'touching Buy should work on mobile');
await mobile.screenshot({ path: `${out}/mobile-touch-buy.png` });

assert.deepEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
console.log(JSON.stringify({
  buy: afterBuy,
  merge: merged,
  sell: sellAfter,
  combat,
  saveLoad: 'preserved',
  responsive,
  mobileTouch: 'passed',
  browserErrors: errors,
}, null, 2));

await mobileContext.close();
await context.close();
await browser.close();
