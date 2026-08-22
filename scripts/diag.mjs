import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const PORT = 5199;
const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "pipe",
});
await new Promise((resolve) => {
  server.stdout.on("data", (d) => { if (d.toString().includes("Local:")) resolve(); });
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
const mctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
const mp = await mctx.newPage();
mp.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await mp.goto(`http://localhost:${PORT}`, { waitUntil: "load" });
await mp.waitForFunction(() => !!window.__TR__, null, { timeout: 15000 });
await mp.waitForTimeout(800);
await mp.touchscreen.tap(422, 195);
await mp.waitForTimeout(900);

await mp.evaluate(() => {
  const t = window.__TR__;
  t.warp(0, -1.2, -4.52, -5);
  t.warp(1, 1.2, -4.52, -5);
});
await mp.waitForTimeout(400);

await mp.evaluate(() => {
  const g = window.__TR__.game;
  window.__log = [];
  const p = g.players[0];
  const origSet = p.body.setLinvel.bind(p.body);
  p.body.setLinvel = (v, w) => {
    if (window.__log.length < 600) {
      window.__log.push({
        t: performance.now().toFixed(0),
        vy: (+v.y).toFixed(1),
        jh: p.input?.jumpHeld ? 1 : 0,
        jp: p.input?.jumpPressed ? 1 : 0,
      });
    }
    origSet(v, w);
  };
});

await mp.locator(".tc-left .tc-jump").dispatchEvent("pointerdown");
await mp.waitForTimeout(700);

const out = await mp.evaluate(() => {
  const l = [...window.__log];
  delete window.__log;
  return l;
});
const maxVy = Math.max(...out.map((r) => +r.vy));
const sawPressed = out.some((r) => r.jp === 1);
console.log("maxVy:", maxVy, "sawPressed:", sawPressed, "calls:", out.length);
await browser.close();
server.kill();
process.exit(0);
