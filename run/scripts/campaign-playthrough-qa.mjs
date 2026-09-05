// Collision-enabled campaign check with progress and per-slice failure context.
import { createServer } from "vite";
import { chromium } from "playwright-core";

const selected = process.argv[2] ?? "all";
const speed = Number(process.argv[3] ?? 3);
const retries = Number(process.argv[4] ?? 2);
const indices = selected === "all" ? Array.from({ length: 20 }, (_, i) => i) : selected.split(",").map(n => Number(n) - 1);
if (!indices.every(n => Number.isInteger(n) && n >= 0 && n < 20) || !Number.isFinite(speed) || speed <= 0 || !Number.isInteger(retries) || retries < 1) throw new Error("Usage: node scripts/campaign-playthrough-qa.mjs [all|10,14,20] [speed] [retries]");
const server = await createServer({ server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "error" });
let browser;
let failures = 0;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/?bot=1&poki=mock`);
  await page.waitForFunction(() => !!window.__TR__?.bot);
  await page.evaluate(speed => {
    window.__TR__.setTimeScale(speed);
    window.__TR__.setPlayerCollision(true);
  }, speed);
  for (const index of indices) {
    let result;
    for (let attempt = 0; attempt < retries; attempt++) {
      result = await page.evaluate(async index => {
        const debug = window.__TR__;
        const trail = [];
        const faces = new Set();
        let lastSlice = -1;
        const timer = setInterval(() => {
          const state = debug.snapshot();
          if (state.level !== index + 1 || state.state !== "Playing") return;
          faces.add(state.orientation);
          const slice = Math.floor(-state.p1.z / 2);
          if (slice === lastSlice) return;
          lastSlice = slice;
          trail.push({ slice, face: state.orientation, p1: state.p1, p2: state.p2 });
          if (trail.length > 22) trail.shift();
        }, 30);
        try { return { ...await debug.bot.run(index), trail, faces: [...faces] }; }
        finally { clearInterval(timer); }
      }, index);
      if (result.ok && [9, 10, 11, 17, 19].includes(index) && result.faces.length !== 4) {
        result.ok = false; result.reason = `four-face route bypassed: ${result.faces.join(", ")}`;
      }
      console.log(`L${index + 1} attempt ${attempt + 1}: ${result.ok ? "PASS" : "FAIL"} ${result.reason} (${result.faces.join(" → ")})`);
      if (result.ok) break;
    }
    if (!result.ok) {
      failures++;
      console.log(JSON.stringify(result.trail));
      console.log(result.trace?.join("\n") ?? "");
    }
  }
  console.log(`${indices.length - failures}/${indices.length} passed; collisions on, speed ${speed}, attempts <= ${retries}`);
  if (errors.length) { failures++; console.error(errors); }
} finally {
  await browser?.close();
  await server.close();
}
process.exitCode = failures ? 1 : 0;
