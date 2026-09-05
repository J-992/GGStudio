// Bot-verifies levels on a private vite server, so a run is not disturbed by
// edits to the tree. `node scripts/levels-qa.mjs [levels] [--speed N] [--retries N]`
//   levels: "all" (default), "13", or "13-16"
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
};
const target = argv.find((a) => !a.startsWith("--") && !/^\d+$/.test(a) === false || /^(all|\d+(-\d+)?)$/.test(a)) ?? "all";
const speed = flag("--speed", 3);
const retries = flag("--retries", 2);
const collide = argv.includes("--collide");

let list;
if (target === "all") list = Array.from({ length: 20 }, (_, i) => i);
else if (target.includes("-")) {
  const [a, b] = target.split("-").map(Number);
  list = Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i);
} else list = [Number(target) - 1];

const PORT = 5100 + Math.floor(Math.random() * 300);
const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "pipe",
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("vite timeout")), 30000);
  server.stdout.on("data", (d) => { if (d.toString().includes("Local:")) { clearTimeout(t); resolve(); } });
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto(`http://localhost:${PORT}/?bot=1&poki=mock`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__TR__ && !!window.__TR__.bot, null, { timeout: 30000 });
await page.evaluate(([s, c]) => {
  window.__TR__.setTimeScale(s);
  window.__TR__.setPlayerCollision(c);
}, [speed, collide]);

const names = await page.evaluate(() => window.__TR__.levels().map((l) => l.name));
const lens = await page.evaluate(() => window.__TR__.levels().map((l) => l.len));
const results = new Map();
for (let attempt = 0; attempt < retries; attempt++) {
  for (const idx of list) {
    if (results.get(idx)?.ok) continue;
    const res = await page.evaluate((i) => window.__TR__.bot.run(i), idx);
    results.set(idx, res);
  }
  if (list.every((i) => results.get(i)?.ok)) break;
}

let failed = 0;
for (const idx of list) {
  const r = results.get(idx);
  if (!r.ok) failed++;
  const secs = (lens[idx] * 2 / 9).toFixed(0);
  console.log(
    `L${String(idx + 1).padStart(2)}  ${r.ok ? "PASS" : "FAIL"}  ` +
    `${names[idx].padEnd(16)} ${String(lens[idx]).padStart(3)} slices / ${secs}s  ${r.ok ? "" : r.reason}`,
  );
  if (!r.ok && r.trace && argv.includes("--trace")) {
    for (const line of r.trace) console.log(`        ${line}`);
  }
}
console.log(`\n${list.length - failed}/${list.length} beatable  (speed x${speed}, collision ${collide ? "on" : "off"})`);
if (errs.length) console.log("PAGE ERRORS:", [...new Set(errs)].slice(0, 4).join(" | "));
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
