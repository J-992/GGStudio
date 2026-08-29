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

  await page.goto(BASE + "/?bot=1", { waitUntil: "load" });
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

  await warpBoth(-1.2, 4.0, -7);
  await holdKey("KeyD", 450);
  s = await snap();
  const xAfterD = s.p1.x;
  await warpBoth(4.0, -1.2, -7);
  await holdKey("KeyA", 450);
  s = await snap();
  await warpBoth(4.0, -1.2, -7);
  await holdKey("KeyA", 450);
  s = await snap();
  check("p1 lateral move", xAfterD > 1 && s.p1.x > 0.2 && s.p1.x < 3, `D->${xAfterD} A->${s.p1.x}`);

  await warpBoth(-4.0, -1.2, -7);
  await holdKey("ArrowRight", 450);
  s = await snap();
  const xP2a = s.p2.x;
  await warpBoth(4.0, -1.2, -7);
  await holdKey("ArrowLeft", 450);
  s = await snap();
  check("p2 lateral independent", xP2a > 1 && s.p2.x < -0.5, `R->${xP2a} L->${s.p2.x}`);

  await page.evaluate(() => {
    const t = window.__TR__;
    t.setAutoRun(0, false);
    t.setAutoRun(1, false);
    t.warp(0, -2, -4.52, -7);
    t.warp(1, 0, -4.52, -7);
  });
  await page.waitForTimeout(300);
  await holdKey("KeyD", 700);
  s = await snap();
  const gap = s.p2.x - s.p1.x;
  const collisionWorks = gap > 0.5 && gap < 1.05 && Math.abs(s.p2.x) < 3;
  check("players collide and block each other", collisionWorks, JSON.stringify({ p1: s.p1.x, p2: s.p2.x }));
  await page.evaluate(() => {
    const t = window.__TR__;
    t.setAutoRun(0, true);
    t.setAutoRun(1, true);
  });

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

  await warpBoth(-6, 6, -7);
  await page.keyboard.down("KeyA");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyA");
  await page.keyboard.up("ArrowRight");
  s = await snap();
  check("tether hard-caps separation length", s.tetherDist > 5.5 && s.tetherDist < 8.2, `dist=${s.tetherDist.toFixed(2)}`);
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(300);

  const rescuesBefore = (await snap()).rescues;
  await page.evaluate(() => {
    const t = window.__TR__;
    const z = t.snapshot().p1.z;
    t.setAutoRun(1, false);
    t.warp(1, -3, -4.52, z - 1);
    t.warp(0, -3, -12, z - 6);
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
    t.startRun(2);
  });
  await page.waitForTimeout(400);
  s = await snap();
  check("level 3 loads", s.level === 3 && s.state === "Playing", `lvl=${s.level} st=${s.state}`);
  await page.evaluate(() => {
    const t = window.__TR__;
    t.setAutoRun(0, false);
    t.warp(0, 0, -40, -10);
    t.warp(1, 4, -4.52, -10);
  });
  await waitFor(() => snap().then((x) => x.level === 1 && x.state === "Playing"), 4000);
  s = await snap();
  check("death resets run to level 1", s.level === 1 && s.deaths > 0, `lvl=${s.level} deaths=${s.deaths}`);
  await page.evaluate(() => {
    const t = window.__TR__;
    t.setAutoRun(0, true);
    t.setAutoRun(1, true);
  });

  check("arcade music playing", await page.evaluate(() => window.__TR__.musicPlaying()), "");

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

  const lvlStats = await page.evaluate(() => window.__TR__.levels());
  for (let i = 4; i < 20; i++) {
    check(
      `level ${i + 1} forces off-floor travel`,
      lvlStats[i].maxFloorRun >= 6,
      `maxFloorRun=${lvlStats[i].maxFloorRun}`,
    );
    const minHaz = i >= 6 ? 2 : 1;
    check(
      `level ${i + 1} carries hazards on walls/ceiling`,
      lvlStats[i].wallHaz >= minHaz,
      `wallHaz=${lvlStats[i].wallHaz}`,
    );
  }

  for (let i = 0; i < 20; i++) {
    await page.evaluate((idx) => {
      window.__TR__.startRun(idx);
    }, i);
    await page.waitForTimeout(300);
    const st = await snap();
    check(
      `level ${i + 1} loads`,
      st.level === i + 1 && st.state === "Playing",
      `lvl=${st.level} st=${st.state}`,
    );
    const fz = st.finishZ;
    await page.evaluate((z) => {
      const t = window.__TR__;
      t.warp(0, -1, -4.52, z + 0.5);
      t.warp(1, 1, -4.52, z + 0.5);
    }, fz);
    const advanced = await waitFor(
      () => snap().then((x) => x.level === i + 2 || x.state === "Finished"),
      3500,
    );
    if (i === 19) {
      const fin = await snap();
      check("final screen after level 20", fin.state === "Finished", fin.state);
      await shot("08-finish.png");
    } else {
      check(`portal completes level ${i + 1}`, advanced, "");
    }
  }
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(400);
  s = await snap();
  check("R restarts run from L1", s.state === "Playing" && s.level === 1 && s.deaths === 0, `lvl=${s.level} deaths=${s.deaths}`);

  await page.evaluate(() => {
    window.__TR__.startRun(1);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const t = window.__TR__;
    t.setAutoRun(0, false);
    t.setAutoRun(1, false);
    t.warp(0, 0, -4.52, -69);
    t.warp(1, 0, -4.52, -67.5);
  });
  await page.waitForTimeout(1400);
  check("crumble tiles break underfoot", await page.evaluate(() => window.__TR__.crumbleBroken()) > 0, "");
  await page.evaluate(() => {
    const t = window.__TR__;
    t.setAutoRun(0, true);
    t.setAutoRun(1, true);
  });
  await page.evaluate(() => window.__TR__.startRun(3));
  await page.waitForTimeout(400);
  const spA = (await snap()).spinners;
  await page.waitForTimeout(500);
  const spB = (await snap()).spinners;
  check("spinner exists and rotates", spA.length > 0 && Math.abs(spB[0].angle - spA[0].angle) > 0.5, "");

  await page.evaluate(() => {
    window.__TR__.setTimeScale(2);
    window.__TR__.setPlayerCollision(false);
  });
  const beatable = new Array(20).fill(false);
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; i < 20; i++) {
      if (beatable[i] && attempt === 0) continue;
      const res = await page.evaluate((idx) => window.__TR__.bot.run(idx), i);
      if (res.ok) beatable[i] = true;
      check(`level ${i + 1} BEATABLE (bot playthrough)`, res.ok, `attempt ${attempt + 1}: ${res.reason}`);
    }
    if (beatable.every(Boolean)) break;
  }
  const failedLevels = beatable.map((b, i) => (b ? null : i + 1)).filter(Boolean);
  if (failedLevels.length) console.log("BOT-UNVERIFIED LEVELS:", failedLevels.join(", "));
  await page.evaluate(() => {
    window.__TR__.setPlayerCollision(true);
    window.__TR__.setTimeScale(1);
  });

  await page.keyboard.press("KeyR");
  await page.waitForTimeout(500);
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
  check("resize survives", errors.length === 0 && (s.state === "Playing" || s.state === "Dying"), s.state);
  await shot("09-narrow.png");

  const mctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true,
  });
  const mp = await mctx.newPage();
  await mp.bringToFront();
  const merrors = [];
  mp.on("pageerror", (e) => merrors.push(String(e)));
  mp.on("console", (m) => { if (m.type() === "error") merrors.push(m.text()); });
  await mp.goto(BASE, { waitUntil: "load" });
  await mp.waitForFunction(() => !!window.__TR__, null, { timeout: 15000 });
  await mp.waitForTimeout(900);
  check(
    "mobile: touch controls visible",
    await mp.evaluate(() => getComputedStyle(document.getElementById("touch-ui")).display !== "none"),
    "",
  );
  await mp.touchscreen.tap(422, 195);
  await mp.waitForTimeout(700);
  const ms = await mp.evaluate(() => window.__TR__.snapshot());
  check("mobile: tap starts game", ms.state === "Playing", ms.state);
  const jumpBtn = mp.locator(".tc-left .tc-jump");
  await mp.evaluate(() => {
    const t = window.__TR__;
    t.warp(0, -1.2, -4.52, -5);
    t.warp(1, 1.2, -4.52, -5);
  });
  await mp.waitForTimeout(300);
  const maxVyP = mp.evaluate(() => new Promise((res) => {
    const p = window.__TR__.game.players[0];
    let max = 0;
    const orig = p.body.setLinvel.bind(p.body);
    p.body.setLinvel = (v, w) => {
      max = Math.max(max, Math.abs(v.y));
      return orig(v, w);
    };
    setTimeout(() => {
      p.body.setLinvel = orig;
      res(max);
    }, 1100);
  }));
  await jumpBtn.dispatchEvent("pointerdown");
  await mp.waitForTimeout(650);
  await jumpBtn.dispatchEvent("pointerup");
  const maxVy = await maxVyP;
  check("mobile: touch jump works", maxVy >= 7.5, `maxVy=${maxVy.toFixed(1)}`);
  check("mobile: no errors", merrors.length === 0, merrors.slice(0, 3).join(" | "));
  await mp.screenshot({ path: shotsDir + "10-mobile.png" });
  await mctx.close();

  const pctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  const pp = await pctx.newPage();
  await pp.bringToFront();
  await pp.goto(BASE, { waitUntil: "load" });
  await pp.waitForFunction(() => !!window.__TR__, null, { timeout: 15000 });
  await pp.waitForTimeout(600);
  check(
    "mobile: portrait shows rotate overlay",
    await pp.evaluate(() => getComputedStyle(document.getElementById("rotate-overlay")).display === "flex"),
    "",
  );
  await pctx.close();

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
