// Private visual/authoring checks. Output stays in a temporary folder.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const output = mkdtempSync(join(tmpdir(), "run-campaign-art-"));
const server = await createServer({ server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "error" });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${address.port}/?bot=1&poki=mock`);
  await page.waitForFunction(() => !!window.__TR__);
  const campaign = await page.evaluate(async () => {
    const { LEVELS } = await import("/src/levels/index.ts");
    return LEVELS;
  });
  assert.equal(campaign.length, 20);
  assert.equal(new Set(campaign.map(level => level.environment)).size, 5);
  for (const level of campaign) {
    for (const slice of level.slices) for (const pattern of Object.values(slice)) {
      assert.match(pattern, /^[#.~^<>=+!?M]{5}$/, `${level.name}: invalid pattern`);
    }
    for (const hint of level.hints ?? []) assert(hint.atSlice >= 0 && hint.atSlice < level.slices.length, `${level.name}: hint outside level`);
    if (level.beats) {
      assert.equal(level.beats.length, 4, `${level.name}: four challenge phrases`);
      for (const beat of level.beats) {
        const approach = level.slices.slice(beat.atSlice, beat.atSlice + 6);
        assert(["f", "r", "c", "l"].some(face => approach.every(s => /^[#M]{5}$/.test(s[face] ?? "#####"))), `${level.name}: missing approach runway on a consistent face`);
      }
    }
  }
  assert(campaign[12].slices.some(s => s.f === "<<#>>"), "counterflow lesson present");
  assert(campaign[14].slices.some(s => s.f === ".=+++"), "opposite-phase ferry challenge present");
  assert(campaign[14].slices.some(s => s.f?.includes("=")), "moving support lesson present");
  for (const index of [9, 10, 11, 17, 19]) for (const face of ["r", "c", "l"]) {
    const faces = ["f", "r", "c", "l"];
    const exclusive = slice => faces.every(key => key === face
      ? (slice[key] ?? "#####") !== "....." : slice[key] === ".....");
    assert(campaign[index].slices.some((_, i, slices) => i + 3 <= slices.length && slices.slice(i, i + 3).every(exclusive)), `${campaign[index].name}: ${face} can be bypassed`);
  }
  console.log("PASS: 20 valid levels, five environments, phrase runways, hints, and mechanic variations");
  for (const index of [0, 4, 8, 12, 16]) {
    await page.evaluate(index => {
      const debug = window.__TR__;
      debug.startRun(index);
      debug.setAutoRun(0, false); debug.setAutoRun(1, false);
    }, index);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(output, `${index + 1}-${campaign[index].environment}.png`) });
    const stats = await page.evaluate(() => {
      const game = window.__TR__.game;
      return { calls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles, geometries: game.renderer.info.memory.geometries, textures: game.renderer.info.memory.textures };
    });
    console.log(`${campaign[index].environment}: ${JSON.stringify(stats)}`);
  }
  // Repeated loads should settle at the same resource count, not leak textures.
  for (const [index, slice] of [[9, 40], [19, 40]]) {
    await page.evaluate(([index, slice]) => {
      const debug = window.__TR__;
      debug.startRun(index);
      debug.setOrientation(1);
      debug.setAutoRun(0, false); debug.setAutoRun(1, false);
      debug.warp(0, 4.52, -1.2, -slice * 2);
      debug.warp(1, 4.52, 1.2, -slice * 2);
    }, [index, slice]);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(output, `${index + 1}-exterior.png`) });
  }
  async function reloadStats() {
    await page.evaluate(() => {
      window.__TR__.startRun(0);
      window.__TR__.setAutoRun(0, false); window.__TR__.setAutoRun(1, false);
    });
    await page.waitForTimeout(100);
    return page.evaluate(() => ({ ...window.__TR__.game.renderer.info.memory }));
  }
  const before = await reloadStats();
  for (let i = 0; i < 3; i++) await reloadStats();
  const after = await reloadStats();
  assert.deepEqual(after, before, "reloading disposes level resources");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, "mobile-landscape.png") });
  assert.deepEqual(errors, [], "no browser exceptions");
  console.log(`PASS: resource cleanup and mobile landscape. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
