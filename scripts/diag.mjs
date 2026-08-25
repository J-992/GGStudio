import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const PORT = 5199;
const levelIdx = parseInt(process.argv[2] ?? "14", 10);
const useBot = process.argv[3] === "bot";
const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "pipe",
});
await new Promise((resolve) => {
  server.stdout.on("data", (d) => { if (d.toString().includes("Local:")) resolve(); });
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await page.goto(`http://localhost:${PORT}/?bot=1`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__TR__, null, { timeout: 15000 });
await page.waitForTimeout(600);
console.log("booted");
await page.evaluate((idx) => {
  window.__TR__.setTimeScale(3);
  window.__TR__.setPlayerCollision(false);
  window.__TR__.startRun(idx);
}, levelIdx);
console.log("started, ticking 8s...");
if (useBot) {
  await page.evaluate(() => {
    const g = window.__TR__.game;
    g.botInput.active = true;
    const origTick = g.bot.tick.bind(g.bot);
    g.bot.tick = (dt) => {
      const t0 = performance.now();
      origTick(dt);
      const dt2 = performance.now() - t0;
      if (dt2 > 30) console.log("SLOW TICK", dt2.toFixed(0));
    };
    window.__tickGuard = setInterval(() => { window.__alive = Date.now(); }, 100);
  });
}
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(500);
  const ok = await Promise.race([
    page.evaluate(() => ({ z: window.__TR__.snapshot().p1.z.toFixed(1), st: window.__TR__.snapshot().state })),
    new Promise((res) => setTimeout(() => res("HUNG"), 2000)),
  ]);
  console.log(typeof ok === "string" ? ok : JSON.stringify(ok));
}
await browser.close();
server.kill();
process.exit(0);
