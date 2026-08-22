import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const shotsDir = new URL("../shots/", import.meta.url).pathname;
mkdirSync(shotsDir, { recursive: true });

const results = [];
let page;
let browser;

function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail: String(detail) });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
}

async function snap() {
  return page.evaluate(() => window.__TR__.snapshot());
}

async function waitFor(fn, timeoutMs = 5000, interval = 60) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await page.waitForTimeout(interval);
  }
  return false;
}

async function shot(name) {
  await page.screenshot({ path: shotsDir + name });
}

async function holdKey(key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function main() {
  const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("vite timeout")), 20000);
    server.stdout.on("data", (d) => {
      if (d.toString().includes("Local:")) { clearTimeout(t); resolve(); }
    });
    server.stderr.on("data", (d) => process.stderr.write(d));
  });

  browser = await chromium.launch({ channel: "chrome", headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__TR__, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot("01-title.png");

  let s = await snap();
  check("loads without errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("title state", s.state === "Title", s.state);

  await page.keyboard.press("KeyW");
  await page.waitForTimeout(600);
  s = await snap();
  check("starts on keypress", s.state === "Playing", s.state);
  check("level is 1", s.level === 1, s.level);
  check("orientation floor", s.orientation === "Floor", s.orientation);

  const z0 = s.p1.z;
  await page.waitForTimeout(700);
  s = await snap();
  check("auto-run forward", s.p1.z < z0 - 4 && s.p2.z < z0 - 4, `${s.p1.z} vs ${z0}`);

  async function warpBoth(x1, x2, z) {
    await page.evaluate(([a, b, zz]) => {
      const t = window.__TR__;
      t.warp(0, a, -4.52, zz);
      t.warp(1, b, -4.52, zz);
    }, [x1, x2, z]);
    await page.waitForTimeout(150);
  }

  await warpBoth(-1.2, 1.2, -7);
  await holdKey("KeyD", 450);
  s = await snap();
  const xAfterD = s.p1.x;
  await warpBoth(-1.2, 1.2, -7);
  await holdKey("KeyA", 450);
  s = await snap();
  check("p1 lateral move", xAfterD > 1 && s.p1.x < -0.5, `D->${xAfterD} A->${s.p1.x}`);

  await warpBoth(-1.2, 1.2, -7);
  await holdKey("ArrowRight", 450);
  s = await snap();
  const xP2a = s.p2.x;
  await warpBoth(-1.2, 1.2, -7);
  await holdKey("ArrowLeft", 450);
  s = await snap();
  check("p2 lateral independent", xP2a > 1 && s.p2.x < -0.5, `R->${xP2a} L->${s.p2.x}`);

  await warpBoth(-1.2, 1.2, -7);
  await page.waitForTimeout(200);
  const yGround = (await snap()).p1.y;
  let maxY = -999;
  await page.keyboard.down("KeyW");
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(70);
    maxY = Math.max(maxY, (await snap()).p1.y);
  }
  await page.keyboard.up("KeyW");
  check("p1 jump rises", maxY - yGround > 1.4, `ground=${yGround} apex=${maxY.toFixed(2)}`);
  await page.waitForTimeout(1000);
  s = await snap();
  check("p1 lands after jump", s.p1.grounded, JSON.stringify(s.p1));

  await shot("02-gameplay-l1.png");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  s = await snap();
  check("esc pauses", s.state === "Paused", s.state);
  await shot("03-pause.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  s = await snap();
  check("esc resumes", s.state === "Playing", s.state);

  const deathsBefore = s.deaths;
  const g = await snap();
  await page.evaluate(() => {
    const t = window.__TR__;
    t.warp(0, 0, -40, t.snapshot().p1.z);
    t.warp(1, 0, -40, t.snapshot().p2.z);
  });
  await page.waitForTimeout(250);
  s = await snap();
  check("void fall kills", s.state === "Dying" || s.deaths > deathsBefore || s.state !== g.state, s.state);
  await page.waitForTimeout(900);
  s = await snap();
  check("auto-restart under 1s-ish", s.state === "Playing" && s.p1.y > -6 && s.p2.y > -6, JSON.stringify({ st: s.state, p1: s.p1 }));

  await page.keyboard.press("KeyR");
  await page.waitForTimeout(300);
  s = await snap();
  check("R restart keeps playing", s.state === "Playing" && s.p1.z > -8, JSON.stringify(s.p1));

  await page.evaluate(() => {
    const t = window.__TR__;
    t.warp(0, 4.45, -4.52, -7);
    t.warp(1, 1.0, -4.52, -7);
  });
  await page.waitForTimeout(250);
  await holdKey("KeyD", 700);
  await page.waitForTimeout(300);
  s = await snap();
  check("hold-into-wall rotates world", s.orientation === "RightWall" || s.orientation === "Ceiling", s.orientation);

  await page.evaluate(() => {
    const t = window.__TR__;
    t.setOrientation(1);
    t.warp(0, 4.5, -2.0, -7);
    t.warp(1, 4.5, -3.6, -10);
  });
  await page.waitForTimeout(450);
  const yOnWallBefore = (await snap()).p1.y;
  await holdKey("KeyD", 380);
  s = await snap();
  const yOnWallAfter = s.p1.y;
  check(
    "steering works on wall orientation (lateral is world-Y)",
    s.orientation === "RightWall" && yOnWallAfter - yOnWallBefore > 1,
    `y ${yOnWallBefore} -> ${yOnWallAfter}`,
  );

  await page.evaluate(() => {
    const t = window.__TR__;
    t.forceRotate(-1);
  });
  await page.waitForTimeout(600);
  s = await snap();
  check("rotate back to floor", s.orientation === "Floor", s.orientation);
  await shot("04-rightwall-floor.png");

  await warpBoth(-4.2, 4.2, -7);
  const distTrace = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(80);
    distTrace.push((await snap()).tetherDist.toFixed(1));
  }
  s = await snap();
  const distStretched = s.tetherDist;
  check("tether stretches when separated", s.tetherDist > 5.2 && s.tension > 0.15, `trace=${distTrace.join(",")} tension=${s.tension.toFixed(2)}`);
  await shot("05-tension.png");
  const dStart = s.tetherDist;
  await page.waitForTimeout(1300);
  s = await snap();
  check("tension pulls players together", s.tetherDist < dStart - 0.2 && s.tetherDist > 4, `${dStart} -> ${s.tetherDist}`);

  await page.keyboard.press("KeyR");
  await page.waitForTimeout(300);

  const rescuesBefore = (await snap()).rescues;
  await page.evaluate(() => {
    const t = window.__TR__;
    const z = t.snapshot().p1.z;
    t.setAutoRun(1, false);
    t.warp(1, -3, -4.52, z - 1);
    t.warp(0, -3, -15, z - 6);
  });
  await page.waitForTimeout(700);
  s = await snap();
  check("falling player not instantly dead", s.state === "Playing" && !s.p1.grounded, `${s.state} p1y=${s.p1.y}`);
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyD");
  const rescueTrace = [];
  const recovered = await waitFor(async () => {
    const x = await snap();
    rescueTrace.push(`${x.state.charAt(0)}y${x.p1.y.toFixed(1)}x${x.p1.x.toFixed(1)}g${x.p1.grounded ? 1 : 0}d${x.deaths}`);
    return x.p1.grounded && x.p1.y > -8 && x.state === "Playing";
  }, 6000);
  await page.keyboard.up("KeyW");
  await page.keyboard.up("KeyD");
  s = await snap();
  check("winch rescue recovers faller", recovered, JSON.stringify({ p1: s.p1, trace: rescueTrace.join(" ") }));
  check("rescue counted", s.rescues > rescuesBefore, `${rescuesBefore} -> ${s.rescues}`);
  if (recovered) await shot("06-rescue.png");

  await page.evaluate(() => {
    const t = window.__TR__;
    t.startRun(1);
  });
  await page.waitForTimeout(400);
  s = await snap();
  check("level 2 loads", s.level === 2, s.level);

  await page.evaluate(() => {
    const t = window.__TR__;
    t.setOrientation(2);
  });
  await page.waitForTimeout(500);
  await holdKey("KeyA", 300);
  s = await snap();
  check("ceiling orientation playable", s.orientation === "Ceiling", s.orientation);
  await page.evaluate(() => {
    const t = window.__TR__;
    t.setOrientation(3);
  });
  await page.waitForTimeout(500);
  s = await snap();
  check("left wall orientation set", s.orientation === "LeftWall", s.orientation);
  await shot("07-ceiling-roll.png");

  await page.evaluate(() => {
    const t = window.__TR__;
    t.startRun(4);
  });
  await page.waitForTimeout(400);
  s = await snap();
  check("level 5 loads", s.level === 5, s.level);
  const finZ = s.finishZ;
  await page.evaluate((fz) => {
    const t = window.__TR__;
    t.warp(0, -1, -4.52, fz + 0.5);
    t.warp(1, 1, -4.52, fz + 0.5);
  }, finZ);
  await page.waitForTimeout(400);
  s = await snap();
  check("portal triggers complete", s.state === "Complete" || s.state === "Finished", s.state);
  await shot("08-finish.png");
  await page.waitForTimeout(1400);
  s = await snap();
  check("final screen after level 5", s.state === "Finished", s.state);

  await page.keyboard.press("KeyR");
  await page.waitForTimeout(400);
  s = await snap();
  check("R restarts run from L1", s.state === "Playing" && s.level === 1 && s.deaths === 0, `lvl=${s.level} deaths=${s.deaths}`);

  const fps = await page.evaluate(() => new Promise((res) => {
    let frames = 0;
    const t0 = performance.now();
    function count() {
      frames++;
      if (performance.now() - t0 < 2000) requestAnimationFrame(count);
      else res(Math.round(frames / 2));
    }
    requestAnimationFrame(count);
  }));
  check("fps >= 50", fps >= 50, fps + " fps");

  await page.setViewportSize({ width: 900, height: 620 });
  await page.waitForTimeout(500);
  s = await snap();
  check("resize survives", errors.length === 0 && s.state === "Playing", s.state);
  await shot("09-narrow.png");

  check("no console/page errors overall", errors.length === 0, errors.slice(0, 5).join(" | "));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("FAILED:", failed.map((f) => f.name).join(", "));
  }

  await browser.close();
  server.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("QA crashed:", e);
  try { await shot("99-crash.png"); } catch {}
  try { await browser?.close(); } catch {}
  process.exit(2);
});
