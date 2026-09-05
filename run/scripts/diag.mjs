import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const levelIdx = parseInt(process.argv[2] ?? "14", 10);
const PORT = 5199 + levelIdx;
const useBot = process.argv[3] === "bot";
const timeScale = Number(process.argv[4] ?? 3);
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
await page.evaluate(([idx, scale]) => {
  window.__TR__.setTimeScale(scale);
  window.__TR__.setPlayerCollision(false);
  if (!window.__TR__.bot) window.__TR__.startRun(idx);
}, [levelIdx, timeScale]);
console.log("started, ticking 8s...");
if (useBot) {
  await page.evaluate((idx) => {
    window.__botResult = null;
    void window.__TR__.bot.run(idx).then((result) => { window.__botResult = result; });
  }, levelIdx);
}
for (let i = 0; i < Math.ceil(120 / timeScale); i++) {
  await page.waitForTimeout(500);
  const ok = await Promise.race([
    page.evaluate(() => {
      const s = window.__TR__.snapshot();
      return { z: s.p1.z.toFixed(1), x: s.p1.x, y: s.p1.y, o: s.orientation, st: s.state, result: window.__botResult };
    }),
    new Promise((res) => setTimeout(() => res("HUNG"), 2000)),
  ]);
  console.log(typeof ok === "string" ? ok : JSON.stringify(ok));
  if (typeof ok !== "string" && ok.result) break;
}
await browser.close();
server.kill();
process.exit(0);
