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

  await page.goto(BASE + "/?bot=1&poki=mock", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__TR__, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot("01-title.png");

  let s = await snap();
  check("loads without errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("title state", s.state === "Title", s.state);
  const initialPoki = await page.evaluate(() => window.__POKI_EVENTS__);
  check("Poki loading lifecycle", initialPoki.join(",") === "init,loadingStart,loadingFinished", initialPoki.join(","));
  check("local and online modes offered", await page.evaluate(() => {
    return !!document.getElementById("btn-local") && !!document.getElementById("btn-online");
  }), "");
  await page.click("#btn-online");
  check("online room UI opens", await page.isVisible("#online-panel"), "");
  await page.fill("#room-code", "bad!");
  await page.click("#btn-join");
  check("online room code is validated", await page.textContent("#online-status") === "ENTER A VALID ROOM CODE", "");
  await page.click("#btn-online-cancel");

  await page.keyboard.press("KeyW");
  await page.waitForTimeout(600);
  s = await snap();
  check("starts on keypress", s.state === "Playing", s.state);
  check("level is 1", s.level === 1, s.level);
  check("orientation floor", s.orientation === "Floor", s.orientation);
  const startedPoki = await page.evaluate(() => window.__POKI_EVENTS__);
  check("Poki gameplay starts on first input", startedPoki.filter((x) => x === "gameplayStart").length === 1, startedPoki.join(","));

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
  check("Poki gameplay stops on pause", await page.evaluate(() => window.__POKI_EVENTS__.at(-1) === "gameplayStop"), "");
  await shot("03-pause.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  s = await snap();
  check("esc resumes", s.state === "Playing", s.state);
  check("Poki ad break precedes resume", await page.evaluate(() => {
    const lifecycle = window.__POKI_EVENTS__.filter((x) => !x.startsWith("measure:"));
    return lifecycle.slice(-2).join(",") === "commercialBreak,gameplayStart";
  }), "");

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

  // Campaign shape. The acts alternate deliberately — walls in II and V, the new
  // ground mechanics on the floor in III and IV — so this asserts the spread
  // across the campaign rather than demanding wall work from every single level.
  const lvlStats = await page.evaluate(() => window.__TR__.levels());
  const offFloor = lvlStats.filter((l) => l.maxFloorRun >= 6).length;
  check("half the campaign leaves the floor behind", offFloor >= 10, `${offFloor}/20`);
  const wallHeavy = lvlStats.slice(4).filter((l) => l.wallHaz >= 2).length;
  check("wall work runs through the back three quarters", wallHeavy >= 6, `${wallHeavy}/16`);
  const lengths = lvlStats.map((l) => l.len);
  check(
    "levels get longer across the campaign",
    Math.min(...lengths.slice(15)) > Math.max(...lengths.slice(0, 4)),
    `first four <= ${Math.max(...lengths.slice(0, 4))}, last five >= ${Math.min(...lengths.slice(15))}`,
  );
  check("the finale is the longest level", lengths[19] === Math.max(...lengths), `${lengths[19]}`);

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
    const z = t.game.tunnel.crumbleZ();
    t.warp(0, 0, -4.52, z);
    t.warp(1, 0, -4.52, z + 1.5);
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

  // --- level mechanics -----------------------------------------------------
  // Each of these parks the pair on one feature and watches what it does to them.
  const featureRun = async (levelIdx) => {
    await page.evaluate((i) => window.__TR__.startRun(i), levelIdx);
    await page.waitForTimeout(450);
    await page.evaluate(() => {
      window.__TR__.setAutoRun(0, false);
      window.__TR__.setAutoRun(1, false);
    });
    return page.evaluate(() => window.__TR__.features());
  };
  const parkAt = (x, y, z) => page.evaluate(([x, y, z]) => {
    const t = window.__TR__;
    t.warp(0, x, y, z);
    t.warp(1, x, y, z - 1.4);
  }, [x, y, z]);
  const sampleP1 = () => page.evaluate(() => {
    const p = window.__TR__.game.players[0];
    const tr = p.body.translation();
    return { x: tr.x, y: tr.y, state: window.__TR__.game.state };
  });

  let feats = await featureRun(8);
  const pad = feats.pads[0];
  await parkAt(pad[0], pad[1] + 0.4, pad[2]);
  let peak = -99;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(45);
    peak = Math.max(peak, (await sampleP1()).y);
  }
  check("launch pad throws well past a jump", peak - pad[1] > 4, `rise ${(peak - pad[1]).toFixed(2)}`);

  feats = await featureRun(10);
  const belt = feats.belts.find((b) => b.dir > 0) ?? feats.belts[0];
  await parkAt(belt.pos[0], belt.pos[1] + 0.4, belt.pos[2]);
  const beltStart = (await sampleP1()).x;
  await page.waitForTimeout(700);
  const beltEnd = (await sampleP1()).x;
  check(
    "conveyor carries you along the face",
    Math.sign(beltEnd - beltStart) === Math.sign(belt.dir) && Math.abs(beltEnd - beltStart) > 1,
    `${beltStart.toFixed(2)} -> ${beltEnd.toFixed(2)} dir ${belt.dir}`,
  );

  feats = await featureRun(12);
  const ferry = feats.sliders[0];
  const ferryX = await page.evaluate((s) => {
    const t = window.__TR__;
    const sl = t.game.tunnel.sliderStates()[0];
    void s;
    return -5 + (sl.col + 0.5) * 2;
  }, 0);
  await parkAt(ferryX, -4.4, ferry.z);
  const rides = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(90);
    const s = await sampleP1();
    const col = await page.evaluate(() => window.__TR__.game.tunnel.sliderStates()[0].col);
    rides.push(Math.abs(s.x - (-5 + (col + 0.5) * 2)));
  }
  check(
    "ferry carries whoever is standing on it",
    Math.max(...rides) < 1.1,
    `max drift ${Math.max(...rides).toFixed(2)}`,
  );

  feats = await featureRun(14);
  const shut = feats.shutters[0];
  await parkAt(shut[0], shut[1] + 0.5, shut[2]);
  let died = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(90);
    if ((await sampleP1()).state !== 1) { died = true; break; }
  }
  check("shutter kills whoever stands in its lane", died, "");
  await page.evaluate(() => {
    window.__TR__.setAutoRun(0, true);
    window.__TR__.setAutoRun(1, true);
  });

  await page.evaluate(() => {
    window.__TR__.setTimeScale(1);
    window.__TR__.setPlayerCollision(false);
  });
  const beatable = new Array(20).fill(false);
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; i < 20; i++) {
      if (beatable[i]) continue;
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
  await mp.goto(BASE + "/?bot=1&poki=mock", { waitUntil: "load" });
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
  await pp.goto(BASE + "/?bot=1&poki=mock", { waitUntil: "load" });
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
