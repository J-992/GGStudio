import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const server = await createServer({ server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "error" });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?bot=1&poki=mock`);
  await page.waitForFunction(() => !!window.__TR__?.bot);
  const setup = async () => page.evaluate(() => {
    const d = window.__TR__, g = d.game;
    d.startRun(2); d.setTimeScale(0);
    g.botInput.active = g.botInput2.active = false;
    g.setAutopilot(0, false); g.setAutopilot(1, false);
    d.setAutoRun(0, false); d.setAutoRun(1, false);
    d.warp(0, -2, -4.52, -24); d.warp(1, 1.8, -4.52, -24);
    for (let i = 0; i < 90; i++) g.fixedUpdate(1 / 120);
  });
  await setup();
  await page.keyboard.down("s");
  const grip = await page.evaluate(() => {
    const g = window.__TR__.game;
    for (let i = 0; i < 10; i++) g.fixedUpdate(1 / 120);
    return window.__TR__.snapshot();
  });
  assert(grip.p1.gripping && !grip.p2.gripping, `keyboard grip: ${JSON.stringify(grip)}`);
  console.log("PASS keyboard S attaches only the robot on a magnetic rail");
  const spring = await page.evaluate(() => {
    const g = window.__TR__.game, [anchor, flyer] = g.players;
    // A stretched airborne fixture isolates spring behavior from steering.
    flyer.warp(3.8, -6.2, -24); flyer.grounded = false;
    const start = anchor.body.translation();
    const frame = g.tunnel.drum.surface(g.orientation);
    g.tunnel.preparePlayers(g.players);
    g.tetherPhysics.compute(anchor, flyer, frame, frame, 1 / 120);
    const before = { rest: g.tetherPhysics.restEff, winch: g.tetherPhysics.winchActive, pull: flyer.tensionPull.x, anchorPull: anchor.tensionPull.length() };
    for (let i = 0; i < 40; i++) g.fixedUpdate(1 / 120);
    return { before, anchorDrift: Math.hypot(anchor.body.translation().x - start.x, anchor.body.translation().y - start.y), vx: flyer.body.linvel().x, state: g.state };
  });
  assert.equal(spring.before.winch, false);
  assert.equal(spring.before.rest, 4);
  assert.equal(spring.before.anchorPull, 0);
  assert(spring.before.pull < -20 && spring.anchorDrift < 0.08 && spring.vx < -1, JSON.stringify(spring));
  console.log("PASS spring accelerates the flyer without hauling or dislodging the anchor", spring);
  await page.keyboard.up("s");
  const released = await page.evaluate(() => {
    const g = window.__TR__.game;
    g.fixedUpdate(1 / 120);
    return window.__TR__.snapshot();
  });
  assert(!released.p1.gripping && released.p1.elasticFlight > 0);
  assert(released.tetherDist > 0);
  console.log("PASS release detaches boots, preserves flight state and keeps the tether");
  await setup();
  await page.keyboard.down("ArrowDown");
  const p2 = await page.evaluate(() => {
    const d = window.__TR__, g = d.game;
    d.warp(1, 2, -4.52, -24);
    for (let i = 0; i < 10; i++) g.fixedUpdate(1 / 120);
    return d.snapshot().p2;
  });
  assert(p2.gripping);
  await page.keyboard.up("ArrowDown");
  console.log("PASS second player's independent grip control");

  await setup();
  const touch = await page.evaluate(() => {
    const g = window.__TR__.game;
    const el = document.querySelector('[data-p="0"][data-k="g"]');
    el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, bubbles: true }));
    for (let i = 0; i < 3; i++) g.fixedUpdate(1 / 120);
    const attached = g.players[0].gripping;
    el.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 7, bubbles: true }));
    g.fixedUpdate(1 / 120);
    return { attached, released: !g.players[0].gripping, cleared: !window.__TR__.touch().p1g };
  });
  assert(touch.attached && touch.released && touch.cleared);
  console.log("PASS touch grip and pointer-cancel cleanup");
  const pad = await page.evaluate(() => {
    const g = window.__TR__.game;
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [{ axes: [0], buttons: Array.from({ length: 6 }, (_, i) => ({ pressed: i === 4 })) }] });
    g.fixedUpdate(1 / 120);
    const attached = g.players[0].gripping;
    delete navigator.getGamepads;
    g.fixedUpdate(1 / 120);
    return { attached, released: !g.players[0].gripping };
  });
  assert(pad.attached && pad.released);
  console.log("PASS gamepad LB grip and release");
  await page.keyboard.down("s");
  const rail = await page.evaluate(() => {
    const d = window.__TR__, g = d.game;
    d.setAutoRun(0, true); d.setAutoRun(1, true);
    const start = g.players[0].body.translation();
    for (let i = 0; i < 120; i++) g.fixedUpdate(1 / 120);
    const riding = g.players[0].gripping;
    const forward = start.z - g.players[0].body.translation().z;
    for (let i = 0; i < 100; i++) g.fixedUpdate(1 / 120);
    return { riding, forward, releasedAtEnd: !g.players[0].gripping };
  });
  assert(rail.riding && rail.forward > 8 && rail.releasedAtEnd, JSON.stringify(rail));
  await page.keyboard.up("s");
  console.log("PASS powered rail advances the anchor and releases at its visible end");
  await setup();
  await page.keyboard.down("s");
  const recovery = await page.evaluate(() => {
    const g = window.__TR__.game, d = window.__TR__;
    g.fixedUpdate(1 / 120);
    d.warp(1, 2, -8, -24);
    g.players[1].grounded = false; g.players[1].airTime = 1;
    g.fixedUpdate(1 / 120);
    return g.tetherPhysics.winchActive;
  });
  assert.equal(recovery, false, "no automatic winch during an intentional swing");
  await page.keyboard.down("ArrowUp");
  const explicitReel = await page.evaluate(() => {
    const g = window.__TR__.game;
    for (let i = 0; i < 10; i++) g.fixedUpdate(1 / 120);
    return { active: g.tetherPhysics.winchActive, rest: g.tetherPhysics.restEff, reeling: g.players[1].reeling };
  });
  assert(explicitReel.active && explicitReel.reeling && explicitReel.rest < 4, JSON.stringify(explicitReel));
  await page.keyboard.up("ArrowUp"); await page.keyboard.up("s");
  console.log("PASS a fresh airborne jump press explicitly requests recovery");

  await setup();
  const assist = await page.evaluate(() => {
    const d = window.__TR__, g = d.game;
    d.warp(1, 2, -7, -24); g.players[1].grounded = false;
    g.setAutopilot(0, true);
    for (let i = 0; i < 20; i++) g.fixedUpdate(1 / 120);
    return g.players[0].gripping && g.autopilotOn(0);
  });
  assert(assist, "solo assist should anchor for an airborne human partner");
  await page.keyboard.down("a");
  const handback = await page.evaluate(() => {
    const g = window.__TR__.game;
    g.fixedUpdate(1 / 120);
    return !g.autopilotOn(0);
  });
  await page.keyboard.up("a");
  assert(handback);
  console.log("PASS solo assist anchors for a human and hands control back on input");
  const preserveRescue = await page.evaluate(async () => {
    const { Autopilot } = await import("/src/game/Autopilot.ts");
    const g = window.__TR__.game;
    g.players[0].gripAvailable = true; g.players[0].gripping = false;
    g.players[1].grounded = false; g.players[1].winchActive = true; g.players[1].airTime = 0.8;
    return new Autopilot().plan(g.botRead(), 0, null).grip;
  });
  assert.equal(preserveRescue, false);
  console.log("PASS assist never pays out an active rescue winch");

  await setup();
  const classicArc = await page.evaluate(() => {
    const p = window.__TR__.game.players[1];
    p.grounded = false; p.airTime = 1; p.elasticFlight = 0;
    p.preStep({ lateral: 0, jumpHeld: true, jumpPressed: true, gripHeld: false });
    return p.reeling;
  });
  assert.equal(classicArc, false, "ordinary airborne jumps must not opt into elastic recovery");
  console.log("PASS ordinary launch/jump arcs do not request the new recovery mode");
  await setup();
  const retry = await page.evaluate(() => {
    const d = window.__TR__, g = d.game;
    const coins = g.coins;
    const reward = coins.coins.find(c => c.pos.y < -5);
    if (!reward) throw new Error("missing below-face swing reward");
    d.warp(0, reward.pos.x, reward.pos.y, reward.pos.z);
    const collected = [];
    coins.collect([g.players[0]], collected, g.tunnel.drum);
    const count = coins.takenCount;
    g.die();
    for (let i = 0; i < 12; i++) g.frame(0.1);
    return { count, sameCoins: coins === g.coins, retained: g.coins.takenCount, level: d.snapshot().level, state: d.snapshot().state };
  });
  assert(retry.count > 0 && retry.sameCoins && retry.retained === retry.count && retry.level === 3 && retry.state === "Playing", JSON.stringify(retry));
  console.log("PASS optional swing rewards collect; local retry retains collected coins");

  const rotor = await page.evaluate(() => {
    const d = window.__TR__, g = d.game;
    d.startRun(8); d.setAutoRun(0, false); d.setAutoRun(1, false);
    g.setAutopilot(0, false); g.setAutopilot(1, false);
    const initial = g.players.map(p => p.body.translation());
    for (let i = 0; i < 720; i++) g.fixedUpdate(1 / 120);
    return {
      angle: g.tunnel.drum.angle, visualAngle: g.tunnel.group.rotation.z,
      local: g.players.map(p => { const v = p.position(g.tmpA).clone(); return g.tunnel.drum.toLocal(v).toArray(); }),
      initial, grounded: g.players.map(p => p.grounded), state: g.state,
      body: g.tunnel.drum.bodies[0].body.rotation(),
    };
  });
  assert(Math.abs(rotor.angle - 0.6) < 0.001, JSON.stringify(rotor));
  assert(Math.abs(rotor.body.z - Math.sin(0.3)) < 0.001);
  assert(Math.abs(rotor.visualAngle - rotor.angle) < 0.001);
  assert(rotor.grounded.every(Boolean), JSON.stringify(rotor));
  assert(rotor.local.every((p, i) => Math.abs(p[0] - rotor.initial[i].x) < 0.2 && Math.abs(p[1] + 4.52) < 0.12), JSON.stringify(rotor));
  console.log("PASS real kinematic drum carries two colliding robots for six seconds", rotor.local);
  const network = await page.evaluate(() => {
    const g = window.__TR__.game, snapshot = g.networkSnapshot();
    g.setNetworkRole("guest"); g.applyNetworkSnapshot(snapshot);
    const mirrored = g.networkSnapshot();
    g.applyNetworkSnapshot({ ...snapshot, state: 3 });
    for (let i = 0; i < 12; i++) g.frame(0.1);
    const heldDying = g.state === 3;
    g.applyNetworkSnapshot({ ...snapshot, state: 4 });
    for (let i = 0; i < 12; i++) g.frame(0.1);
    const heldComplete = g.state === 4 && g.levelIdx === snapshot.level;
    g.applyNetworkSnapshot(snapshot);
    g.setNetworkRole("local");
    g.setRemoteInput(0.2, false, true);
    const input = g.input.sample(1);
    g.setNetworkRole("local");
    return { snapshot, mirrored, input, heldDying, heldComplete };
  });
  assert.equal(network.snapshot.drumAngle, network.mirrored.drumAngle);
  assert(network.input.gripHeld);
  assert(network.heldDying && network.heldComplete, "guest must wait for the host's retry/advance decision");
  console.log("PASS host snapshot carries drum phase and boot state; remote grip input survives");
  const output = mkdtempSync(join(tmpdir(), "run-elastic-"));
  await page.evaluate(() => {
    const g = window.__TR__.game;
    g.timeScale = 1;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(output, "drum.png") });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => document.body.classList.add("touch"));
  await page.screenshot({ path: join(output, "touch.png") });
  assert.deepEqual(errors, []);
  console.log(`PASS no browser errors; screenshots ${output}`);
} finally {
  await browser?.close(); await server.close();
}
