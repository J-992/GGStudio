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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${PORT}`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__TR__, null, { timeout: 15000 });
await page.waitForTimeout(800);
await page.keyboard.press("KeyW");
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(250);
  const s = await page.evaluate(() => {
    const g = window.__TR__.game;
    const out = [];
    for (const p of g.players) {
      const v = p.position(new (Object.getPrototypeOf(g.scene.position).constructor)());
      v.project(g.coopCam.camera);
      out.push({ ndcY: +v.y.toFixed(3), ndcX: +v.x.toFixed(3), st: g.state, grounded: p.grounded ? 1 : 0 });
    }
    return out;
  });
  console.log(JSON.stringify(s));
}
await browser.close();
server.kill();
process.exit(0);
