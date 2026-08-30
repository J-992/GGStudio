/**
 * Headless playtest of Rooftop Rascal, driven over the Chrome DevTools
 * Protocol. Zero dependencies: it talks to a locally installed Chrome using
 * Node's built-in WebSocket.
 *
 *   npm run build && npm run preview      # in one terminal
 *   npm run playtest                      # in another
 *
 * It boots the built game, records every console message, uncaught exception
 * and failed request, then genuinely plays it with synthetic key and mouse
 * events - auto-running, changing lanes, taking a corner with a double-tap,
 * jumping gaps, pausing, restarting, losing lives, dying, and loading all
 * three levels - asserting on live scene and physics state as it goes.
 * Screenshots land in `scripts/playtest/shots/`.
 *
 * The player is no longer driven: forward speed is a constant
 * `PHYSICS.runSpeed` and the only inputs are a lane step (A/D, single tap),
 * a corner turn (a double-tap on the same side within the input manager's
 * double-tap window) and a jump. See `RunInput` in `PlayerController.ts`.
 *
 * Note it runs on a software rasteriser (SwiftShader), so the frame rate is
 * low and, worse, wildly inconsistent - anywhere from a few fps down to a
 * fraction of one, measured run to run on the same machine. Because the
 * fixed-step accumulator caps catch-up at `maxSubSteps`, simulated time runs
 * slower than wall-clock time under that load, and by a ratio that varies
 * with it. Everything gameplay-relevant is on the fixed 1/60 timestep, so
 * that affects how long the script waits, not what the game does - but any
 * check added here must poll for the actual simulated condition (see
 * `pollUntil` below) rather than sleeping a guessed duration or accumulating
 * over wall-clock time. Running anything else CPU-heavy on the same machine
 * at the same time (a concurrent build, a second browser) starves the
 * renderer further and can make even generous polling timeouts too short.
 */

import { launchChrome, CdpConnection, evaluate, key, click, screenshot, sleep } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = process.argv[2] ?? 'http://localhost:4173/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(OUT, { recursive: true });

const log = [];
const consoleMsgs = [];
const exceptions = [];
const netFailures = [];
const netRequests = [];
const results = [];
let bootFinishedAt = null;

function note(...a) { const s = a.join(' '); log.push(s); console.log(s); }
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  note(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

/**
 * Polls a page-side expression until `predicate` is true, rather than
 * guessing a sleep duration.
 *
 * The software rasteriser's real-vs-simulated time ratio varies a lot by
 * machine - one run measured 0.5 rendered fps, another comfortably faster -
 * and every timing-sensitive check here waits on something driven by the
 * *simulated* 1/60 clock (a lane seek closing, invulnerability expiring, a
 * turn committing). A fixed sleep tuned for one machine is a flake on a
 * slower one; polling with a generous timeout is not.
 */
async function pollUntil(exprJs, predicate, { timeoutMs = 15000, intervalMs = 200 } = {}) {
  const t0 = Date.now();
  let state = await evaluate(cdp, session, exprJs);
  while (!predicate(state) && Date.now() - t0 < timeoutMs) {
    await sleep(intervalMs);
    state = await evaluate(cdp, session, exprJs);
  }
  return { state, met: predicate(state), elapsedMs: Date.now() - t0 };
}

const chrome = await launchChrome({ headless: true });
note(`# chrome: ${chrome.product}`);
const cdp = await CdpConnection.connect(chrome.wsUrl);

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

cdp.on((method, params) => {
  if (method === 'Runtime.consoleAPICalled') {
    const text = (params.args ?? [])
      .map((a) => a.value ?? a.description ?? (a.preview ? JSON.stringify(a.preview) : a.type))
      .join(' ');
    const entry = { type: params.type, text, phase: bootFinishedAt ? 'runtime' : 'boot' };
    consoleMsgs.push(entry);
    if (params.type === 'error' || params.type === 'warning') note(`  [console.${params.type}] ${text}`);
  } else if (method === 'Runtime.exceptionThrown') {
    const d = params.exceptionDetails;
    const text = d.exception?.description ?? d.text;
    exceptions.push(text);
    note(`  [EXCEPTION] ${text}`);
  } else if (method === 'Log.entryAdded') {
    const e = params.entry;
    consoleMsgs.push({ type: e.level, text: `${e.source}: ${e.text}`, phase: bootFinishedAt ? 'runtime' : 'boot' });
    if (e.level === 'error') note(`  [log.error] ${e.source}: ${e.text}`);
  } else if (method === 'Network.requestWillBeSent') {
    netRequests.push({ url: params.request.url, after: bootFinishedAt !== null });
  } else if (method === 'Network.loadingFailed') {
    netFailures.push({ text: params.errorText, type: params.type });
  } else if (method === 'Network.responseReceived') {
    if (params.response.status >= 400) {
      netFailures.push({ text: `HTTP ${params.response.status} ${params.response.url}`, type: params.type });
    }
  }
});

await cdp.send('Runtime.enable', {}, session);
await cdp.send('Log.enable', {}, session);
await cdp.send('Page.enable', {}, session);
await cdp.send('Network.enable', {}, session);

// ---------------------------------------------------------------- phase: boot
note('\n=== BOOT ===');
const t0 = Date.now();
await cdp.send('Page.navigate', { url: TARGET }, session);

let booted = false;
for (let i = 0; i < 120; i++) {
  await sleep(500);
  const state = await evaluate(cdp, session, `(() => {
    const g = window.__game;
    if (!g) return { ready: false, status: document.getElementById('loading-status')?.textContent ?? '' };
    return { ready: true, state: g.states.current, status: document.getElementById('loading-status')?.textContent ?? '' };
  })()`).catch((e) => ({ ready: false, status: 'eval failed: ' + e.message }));
  if (state.ready) { booted = true; note(`  booted in ${Date.now() - t0} ms, state=${state.state}`); break; }
  if (i % 6 === 5) note(`  waiting... (${state.status})`);
}
bootFinishedAt = Date.now();
check('game boots and exposes window.__game', booted);
if (!booted) {
  note('ABORT: game never booted');
  writeFileSync(join(OUT, '..', 'report.json'), JSON.stringify({ results, consoleMsgs, exceptions, netFailures, log }, null, 2));
  await screenshot(cdp, session, join(OUT, 'boot-failure.png'));
  chrome.close();
  process.exit(1);
}

const glInfo = await evaluate(cdp, session, `(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return { webgl2: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { webgl2: true, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
})()`);
note(`  WebGL2: ${glInfo.webgl2} (${glInfo.renderer ?? 'n/a'})`);

check('boot produced no uncaught exceptions', exceptions.length === 0, exceptions.join(' | ').slice(0, 300));
check('boot produced no console errors',
  consoleMsgs.filter((m) => m.type === 'error' && m.phase === 'boot').length === 0,
  consoleMsgs.filter((m) => m.type === 'error').map((m) => m.text).join(' | ').slice(0, 400));
check('no failed network requests during load', netFailures.length === 0,
  netFailures.map((f) => f.text).join(' | ').slice(0, 400));

// ------------------------------------------------------------- phase: the menu
note('\n=== MAIN MENU ===');
const menu = await evaluate(cdp, session, `(() => {
  const vis = (id) => { const el = document.getElementById(id); if (!el) return 'missing';
    const cs = getComputedStyle(el); return (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') ? 'visible' : 'hidden'; };
  const canvas = document.getElementById('game-canvas');
  return {
    state: window.__game.states.current,
    loading: vis('screen-loading'),
    menuScreen: vis('screen-menu'),
    canvasSize: [canvas.width, canvas.height],
    playRect: (() => { const r = document.getElementById('btn-play').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
    levelButtons: document.querySelectorAll('#level-grid button').length,
    skins: document.querySelectorAll('#skin-grid button').length,
  };
})()`);
note(`  state=${menu.state} loading=${menu.loading} menu=${menu.menuScreen} canvas=${menu.canvasSize.join('x')}`);
check('reaches main menu after load', menu.state === 'mainMenu', `state=${menu.state}`);
check('loading screen dismissed', menu.loading === 'hidden');
check('canvas has non-zero backing store', menu.canvasSize[0] > 0 && menu.canvasSize[1] > 0, menu.canvasSize.join('x'));
check('level select is populated', menu.levelButtons >= 3, `${menu.levelButtons} level buttons`);
await screenshot(cdp, session, join(OUT, '01-menu.png'));

// Verify something is actually rendered (not a blank canvas).
const pixels = await evaluate(cdp, session, `(() => {
  const g = window.__game;
  const info = g.renderer.info.render;
  return { calls: info.calls, triangles: info.triangles, sceneChildren: g.scene.children.length };
})()`);
note(`  render: ${pixels.calls} draw calls, ${pixels.triangles} triangles, ${pixels.sceneChildren} scene roots`);

// ------------------------------------------------------- phase: start a level
note('\n=== START LEVEL 1 (clicking Play) ===');
await click(cdp, session, menu.playRect.x + menu.playRect.width / 2, menu.playRect.y + menu.playRect.height / 2);
await sleep(3000);

const started = await evaluate(cdp, session, `(() => {
  const g = window.__game;
  const p = g.player.body.translation();
  return {
    state: g.states.current,
    level: g.currentLevel?.id ?? null,
    levelName: g.currentLevel?.name ?? null,
    pos: [p.x, p.y, p.z],
    pursuers: g.pursuers.length,
    dogs: g.dogs.length,
    audio: g.audio.ctx ? g.audio.ctx.state : 'none',
    hudVisible: getComputedStyle(document.getElementById('hud')).display !== 'none',
    bodies: g.physics.world.bodies.len(),
    colliders: g.physics.world.colliders.len(),
  };
})()`);
note(`  ${JSON.stringify(started)}`);
check('Play button starts a run', started.state === 'playing' || started.state === 'intro', `state=${started.state}`);
check('level 1 loaded', started.level === 'level-1', String(started.level));
check('pursuers spawned', started.pursuers >= 2, `${started.pursuers} pursuers, ${started.dogs} dogs`);
check('physics world populated', started.colliders > 20, `${started.bodies} bodies / ${started.colliders} colliders`);
check('HUD is visible during play', started.hudVisible === true);
check('AudioContext unlocked by the click gesture', started.audio === 'running', `state=${started.audio}`);
await screenshot(cdp, session, join(OUT, '02-level1-start.png'));

// ------------------------------------------------------------ phase: auto-run
// Forward speed is prescribed - PHYSICS.runSpeed, constant - so there is no
// throttle to hold and nothing to accelerate. The cat simply runs the moment
// the level starts; this phase just watches it happen with no input at all.
note('\n=== AUTO-RUN (no input) ===');
const runSpeed = await evaluate(cdp, session, `window.__physicsConfig.runSpeed`);
const before = await evaluate(cdp, session, `(() => {
  const g = window.__game, p = g.player.body.translation();
  return { pos: [p.x, p.y, p.z], route: g.playerRouteDistance };
})()`);

// Instrument the frame counter so we can measure real fps over the run.
await evaluate(cdp, session, `(() => {
  window.__fps = { n: 0, t: performance.now() };
  const loop = () => { window.__fps.n++; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})()`);

const samples = [];
for (let i = 0; i < 8; i++) {
  await sleep(500);
  samples.push(await evaluate(cdp, session, `(() => {
    const g = window.__game, p = g.player.body.translation(), v = g.player.body.linvel();
    return { z: +p.z.toFixed(2), y: +p.y.toFixed(2), speed: +Math.hypot(v.x, v.z).toFixed(2),
             route: +g.playerRouteDistance.toFixed(1), grounded: g.player.grounded };
  })()`));
}

const fps = await evaluate(cdp, session, `(() => { const f = window.__fps; return +(f.n / ((performance.now() - f.t) / 1000)).toFixed(1); })()`);
note(`  measured render fps (software GL): ${fps}`);
for (const s of samples) note(`    z=${s.z} y=${s.y} speed=${s.speed} route=${s.route} grounded=${s.grounded}`);

const last = samples[samples.length - 1];
// Generous band: a stumble (0.75x) or a lane-seek transient can pull the
// instantaneous reading away from runSpeed, but it should never idle near 0
// or run away past the prescribed ceiling.
const speedsInBand = samples.filter((s) => s.speed > runSpeed * 0.5 && s.speed < runSpeed * 1.3).length;
check('the runner moves forward with no input at all', last.z > before.pos[2] + 2, `z ${before.pos[2].toFixed(1)} -> ${last.z}`);
check('forward speed sits close to the prescribed runSpeed', speedsInBand >= samples.length - 1,
  `runSpeed=${runSpeed}, samples: ${samples.map((s) => s.speed).join(', ')}`);
check('route progress advances on its own', last.route > before.route + 2, `${before.route.toFixed(1)} -> ${last.route}`);
check('cat stays on the roof (does not fall through)', last.y > 15, `y=${last.y}`);
await screenshot(cdp, session, join(OUT, '03-running.png'));

// ------------------------------------------------------------- phase: lanes
// A single tap is a lane change, applied immediately (no double-tap needed).
// Off in the open - nowhere near a corner - a double-tap must NOT turn the
// runner; only laneStep should move.
note('\n=== LANE CHANGE ===');
const laneSpacing = await evaluate(cdp, session, `window.__physicsConfig.laneSpacing`);
const laneBefore = await evaluate(cdp, session, `(() => { const g = window.__game;
  return { lane: g.player.lane, lateral: g.player.lateral, segment: g.player.segment }; })()`);

const LANE_STATE = `(() => { const g = window.__game;
  return { lane: g.player.lane, lateral: g.player.lateral, segment: g.player.segment }; })()`;

await key(cdp, session, 'KeyD', 'down'); await key(cdp, session, 'KeyD', 'up');
const laneStep = await pollUntil(LANE_STATE, (s) => s.lane === laneBefore.lane + 1, { timeoutMs: 8000 });
note(`  single tap D: lane ${laneBefore.lane} -> ${laneStep.state.lane} (after ${laneStep.elapsedMs} ms)`);
check('a single tap shifts exactly one lane', laneStep.met, `${laneBefore.lane} -> ${laneStep.state.lane}`);

// The lane-seek is a proportional controller running on the simulated 1/60
// clock, not the render clock, so how long it takes in *wall* time depends
// entirely on how fast this machine's software rasteriser can advance the
// fixed step - hence a poll with real headroom rather than a fixed sleep.
const laneAfter = await pollUntil(LANE_STATE,
  (s) => Math.abs(s.lateral - laneStep.state.lane * laneSpacing) < 0.6,
  { timeoutMs: 15000 });
note(`  lateral seek: ${laneBefore.lateral.toFixed(2)} -> ${laneAfter.state.lateral.toFixed(2)} (target ${(laneStep.state.lane * laneSpacing).toFixed(2)}, after ${laneAfter.elapsedMs} ms)`);
check('the runner physically seeks toward the new lane centre', laneAfter.met,
  `lateral=${laneAfter.state.lateral.toFixed(2)}, target=${(laneStep.state.lane * laneSpacing).toFixed(2)}`);

// Fast double-tap the other way, out in open track with no corner in reach:
// two lane steps, but no turn - there is nothing to commit to.
const segmentBeforeDoubleTapAway = laneStep.state.segment;
await key(cdp, session, 'KeyA', 'down'); await key(cdp, session, 'KeyA', 'up');
await key(cdp, session, 'KeyA', 'down'); await key(cdp, session, 'KeyA', 'up');
const doubleTapAway = await pollUntil(
  `(() => { const g = window.__game;
    return { lane: g.player.lane, segment: g.player.segment, inTurnZone: g.player.inTurnZone }; })()`,
  (s) => s.lane === laneStep.state.lane - 2,
  { timeoutMs: 8000 });
note(`  double tap A away from any corner: lane -> ${doubleTapAway.state.lane}, segment ${segmentBeforeDoubleTapAway} -> ${doubleTapAway.state.segment}`);
check('a double-tap with no corner in reach only changes lane, never turns',
  doubleTapAway.state.segment === segmentBeforeDoubleTapAway && !doubleTapAway.state.inTurnZone,
  `segment ${segmentBeforeDoubleTapAway} -> ${doubleTapAway.state.segment}, inTurnZone=${doubleTapAway.state.inTurnZone}`);

// ------------------------------------------------------------- phase: jumping
note('\n=== JUMP ===');
const jumpStart = await evaluate(cdp, session, `(() => { const p = window.__game.player.body.translation(); return { y: p.y, grounded: window.__game.player.grounded }; })()`);
await key(cdp, session, 'Space', 'down');
await sleep(120);
await key(cdp, session, 'Space', 'up');
let peakY = jumpStart.y, airborneSeen = false;
for (let i = 0; i < 14; i++) {
  await sleep(90);
  const s = await evaluate(cdp, session, `(() => { const g = window.__game, p = g.player.body.translation(); return { y: p.y, g: g.player.grounded }; })()`);
  peakY = Math.max(peakY, s.y);
  if (!s.g) airborneSeen = true;
}
note(`  jump: y ${jumpStart.y.toFixed(2)} -> peak ${peakY.toFixed(2)} (rise ${(peakY - jumpStart.y).toFixed(2)})`);
check('Space produces a jump', peakY - jumpStart.y > 0.6, `rise ${(peakY - jumpStart.y).toFixed(2)} u`);
check('cat leaves the ground', airborneSeen);

// -------------------------------------------------------- phase: corner turn
// Level 1 has exactly one real (90-degree) corner (see RunPath.ts). Teleport
// the runner - via the controller's own public recoverTo(), which relocates
// it onto the track properly (nearest segment, lane, yaw) rather than a raw
// body.setTranslation - just inside the turn zone before that corner, then
// prove the single-tap/double-tap distinction the way a player would meet it.
note('\n=== CORNER TURN ===');
const junctionInfo = await evaluate(cdp, session, `(() => {
  const g = window.__game;
  const path = g.runPath;
  if (!path) return null;
  const j = path.junctions.find((j) => j.kind === 'turn');
  if (!j) return null;
  const seg = path.segments[j.fromSegment];
  // As far back inside the zone as the segment allows: the corner window is a
  // fixed amount of *simulated* track distance (turnZoneBefore + turnZoneAfter),
  // and on a very slow renderer it can take a long real-world time to even
  // observe a single fixed step - so start with as much of that budget ahead
  // of the runner as possible, rather than close to the corner.
  const remaining = Math.min(10, seg.length * 0.6);
  const along = Math.max(0, seg.length - remaining);
  return {
    turnDir: j.turnDir,
    fromSegment: j.fromSegment,
    pos: [seg.start.x + seg.dir.x * along, seg.start.y, seg.start.z + seg.dir.z * along],
  };
})()`);

if (!junctionInfo) {
  note('  level 1 has no "turn" junction in its RunPath - skipping corner checks');
  check('level 1 route has a turn corner to test', false, 'RunPath.junctions has no kind === "turn" entry');
} else {
  const side = junctionInfo.turnDir < 0 ? 'KeyA' : 'KeyD';
  note(`  corner at segment ${junctionInfo.fromSegment}, turnDir=${junctionInfo.turnDir} (${side})`);

  const CORNER_STATE = `(() => { const g = window.__game;
    return { inTurnZone: g.player.inTurnZone, pendingTurn: g.player.pendingTurn,
             segment: g.player.segment, lane: g.player.lane, yaw: g.player.getYaw() }; })()`;

  async function placeAtCorner() {
    await evaluate(cdp, session, `(() => {
      const g = window.__game, THREE = window.__three;
      g.player.recoverTo(new THREE.Vector3(${junctionInfo.pos[0]}, ${junctionInfo.pos[1]}, ${junctionInfo.pos[2]}));
    })()`);
    // trackProgress() needs at least one fixed step against the new position
    // before inTurnZone reflects it - poll rather than guess how long that takes.
    return pollUntil(CORNER_STATE, (s) => s.inTurnZone, { timeoutMs: 8000 });
  }

  // --- a single tap only changes lane, even inside the turn zone -----------
  const zoneEntry = await placeAtCorner();
  note(`  in turn zone: inTurnZone=${zoneEntry.state.inTurnZone} pendingTurn=${zoneEntry.state.pendingTurn} segment=${zoneEntry.state.segment} (after ${zoneEntry.elapsedMs} ms)`);
  check('the runner enters the turn zone approaching the corner',
    zoneEntry.met && zoneEntry.state.pendingTurn === junctionInfo.turnDir, JSON.stringify(zoneEntry.state));

  await key(cdp, session, side, 'down'); await key(cdp, session, side, 'up');
  const afterSingleTap = await pollUntil(CORNER_STATE,
    (s) => s.lane === zoneEntry.state.lane + junctionInfo.turnDir, { timeoutMs: 8000 });
  note(`  after single tap ${side}: segment=${afterSingleTap.state.segment} lane=${afterSingleTap.state.lane} inTurnZone=${afterSingleTap.state.inTurnZone}`);
  check('a single tap in the turn zone shifts lane but does not commit the turn',
    afterSingleTap.met && afterSingleTap.state.segment === junctionInfo.fromSegment && afterSingleTap.state.inTurnZone,
    JSON.stringify(afterSingleTap.state));

  // --- a double tap on the same side commits the corner ---------------------
  // Fire straight after the teleport, with no confirmation poll in between:
  // the corner window is a fixed amount of *simulated* track distance, and on
  // this slow a renderer, even the wait to confirm re-entry can eat a real
  // chunk of that budget before the runner ever sees the double-tap. The
  // teleport itself puts the runner at a known point inside the zone by
  // construction, so there is nothing to gain from confirming it first here.
  //
  // Retried rather than given one very long wait: whether a single attempt
  // lands depends on how many frames this renderer happens to produce before
  // the window (a fixed simulated distance) runs out, which varies a lot
  // between runs - a fresh teleport reopens the full window, so a retry is
  // cheap when the first attempt was simply unlucky.
  let afterDoubleTap = { met: false, state: null };
  for (let attempt = 1; attempt <= 3 && !afterDoubleTap.met; attempt++) {
    await evaluate(cdp, session, `(() => {
      const g = window.__game, THREE = window.__three;
      g.player.recoverTo(new THREE.Vector3(${junctionInfo.pos[0]}, ${junctionInfo.pos[1]}, ${junctionInfo.pos[2]}));
    })()`);
    await key(cdp, session, side, 'down'); await key(cdp, session, side, 'up');
    await key(cdp, session, side, 'down'); await key(cdp, session, side, 'up');
    afterDoubleTap = await pollUntil(CORNER_STATE,
      (s) => s.segment === junctionInfo.fromSegment + 1, { timeoutMs: 25000 });
    note(`  after double tap ${side} (attempt ${attempt}): segment=${afterDoubleTap.state.segment} inTurnZone=${afterDoubleTap.state.inTurnZone} yaw=${afterDoubleTap.state.yaw.toFixed(3)} (after ${afterDoubleTap.elapsedMs} ms)`);
  }
  check('a double-tap on the same side commits the corner',
    afterDoubleTap.met && !afterDoubleTap.state.inTurnZone, JSON.stringify(afterDoubleTap.state));
}

// ------------------------------------------------------- phase: the cat itself
//
// Everything here was a shipped bug that no existing check could see, because
// they all watch the physics body and every one of these is a mismatch between
// the body and what is actually drawn.
note('\n=== CAT RIG ===');
const rig = await evaluate(cdp, session, `(() => {
  const g = window.__game, cat = g.cat, THREE = window.__three;
  const root = cat.root;
  root.updateMatrixWorld(true);

  // Which way the model is actually pointing, in world space.
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
  const yaw = g.player.getYaw();
  const heading = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

  // Lowest drawn point of the cat vs the surface it is standing on.
  const box = new THREE.Box3().setFromObject(root);
  const body = g.player.body.translation();

  // The fish should be at the muzzle - forward of the cat's centre - not on the
  // tail, which is where a reversed rig used to put it.
  const centre = box.getCenter(new THREE.Vector3());
  const fishPos = cat.fish ? cat.fish.getWorldPosition(new THREE.Vector3()) : null;
  const fishForward = fishPos ? new THREE.Vector3().subVectors(fishPos, centre).dot(facing) : null;

  return {
    facingDotHeading: facing.dot(heading),
    feetY: box.min.y,
    bodyY: body.y,
    grounded: g.player.grounded,
    groundDistance: g.player.groundDistance,
    fishForward,
  };
})()`);
note(`  facing.heading=${rig.facingDotHeading.toFixed(3)} feetY=${rig.feetY.toFixed(3)} bodyY=${rig.bodyY.toFixed(3)} fishForward=${rig.fishForward?.toFixed(3)}`);

check('cat model faces the way it is running (not rear-first)', rig.facingDotHeading > 0.9,
  `model +Z . heading = ${rig.facingDotHeading.toFixed(3)}`);
// The capsule centre sits half a capsule above the surface, so the drawn feet
// must land within a whisker of that much below the body translation.
const expectedDrop = await evaluate(cdp, session,
  `window.__physicsConfig.colliderHalfHeight + window.__physicsConfig.colliderRadius`);
const feetGap = rig.bodyY - rig.feetY - expectedDrop;
check('cat feet touch the surface (not floating above it)', Math.abs(feetGap) < 0.12,
  `feet are ${feetGap >= 0 ? '' : '-'}${Math.abs(feetGap).toFixed(3)} u off the expected contact height`);
check('the fish is at the muzzle, not the tail', (rig.fishForward ?? -1) > 0.1,
  `fish sits ${rig.fishForward?.toFixed(3)} u along the facing direction`);

// ------------------------------------------------- phase: the awkward geometry
//
// The plank, the awning and the moving platforms are all past the point any
// automated run has ever reached, and all three shipped with their collider
// somewhere other than their mesh. Each is checked by dropping the cat onto the
// visible geometry and asserting it is caught.
note('\n=== VISUAL/COLLIDER AGREEMENT ===');

/** Drops the cat from `y` at (x, z) and reports where it comes to rest. */
async function dropOnto(label, x, y, z) {
  await evaluate(cdp, session, `(() => { const g = window.__game;
    g.player.body.setTranslation({ x: ${x}, y: ${y}, z: ${z} }, true);
    g.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    g.player.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    g.physics.resetInterpolation(g.player.body); })()`);
  // Let the teleport actually take effect before believing anything: `grounded`
  // is written by the fixed step, so the first read after a setTranslation can
  // still be describing wherever the cat was standing a moment ago.
  await sleep(250);
  let rest = null;
  let settled = 0;
  // Bounded by wall-clock time, not a fixed step count: how many rendered
  // frames (and therefore fixed steps) 100 iterations buys depends entirely
  // on this machine's software rasteriser, which varies a lot run to run.
  const t0 = Date.now();
  for (let i = 0; i < 100 && Date.now() - t0 < 20000; i++) {
    await sleep(150);
    const s = await evaluate(cdp, session, `(() => { const g = window.__game,
      p = g.player.body.translation(), v = g.player.body.linvel();
      return { y: p.y, x: p.x, z: p.z, vy: v.y, grounded: g.player.grounded }; })()`);
    rest = s;
    settled = s.grounded && Math.abs(s.vy) < 0.5 ? settled + 1 : 0;
    if (settled >= 2) break;
    if (s.y < -20) break;
  }
  note(`  ${label}: rest y=${rest.y.toFixed(2)} grounded=${rest.grounded} (after ${Date.now() - t0} ms)`);
  return rest;
}

// Level 1's plank bridges z 39..53 at x = 0, walking surface ~20.5. Its mesh ran
// its length along X while its collider ran along Z, so the visible board lay
// across the gap and the cat fell through where the plank plainly was.
await key(cdp, session, 'KeyR', 'down'); await key(cdp, session, 'KeyR', 'up');
await sleep(700);
const plank = await dropOnto('plank', 0, 24, 46);
check('the plank catches the cat where it is drawn', plank.grounded && plank.y > 19,
  `rest y=${plank.y.toFixed(2)} (falls through if < 19)`);

// Level 1 Act 5. The fabric was tilted in radians while the collider was tilted
// in degrees, so this beat could not be completed at all.
const awning = await dropOnto('awning', 128, 24, 205);
check('the awning holds the cat up', awning.grounded && awning.y > 14,
  `rest y=${awning.y.toFixed(2)} (kill plane is -6)`);

// ---------------------------------------------------------------- phase: pause
note('\n=== PAUSE ===');
await key(cdp, session, 'Escape', 'down'); await key(cdp, session, 'Escape', 'up');
await sleep(400);
const pausedA = await evaluate(cdp, session, `(() => { const g = window.__game, p = g.player.body.translation();
  return { state: g.states.current, pos: [p.x, p.y, p.z], screen: getComputedStyle(document.getElementById('screen-pause')).display !== 'none' }; })()`);
await sleep(1200);
const pausedB = await evaluate(cdp, session, `(() => { const p = window.__game.player.body.translation(); return [p.x, p.y, p.z]; })()`);
const drift = Math.hypot(pausedB[0] - pausedA.pos[0], pausedB[1] - pausedA.pos[1], pausedB[2] - pausedA.pos[2]);
check('Esc pauses the game', pausedA.state === 'paused', `state=${pausedA.state}`);
check('pause screen is shown', pausedA.screen === true);
check('physics is frozen while paused', drift < 0.05, `drift ${drift.toFixed(4)} u over 1.2 s`);
await screenshot(cdp, session, join(OUT, '04-paused.png'));
await key(cdp, session, 'Escape', 'down'); await key(cdp, session, 'Escape', 'up');
await sleep(500);
check('Esc resumes the game', (await evaluate(cdp, session, `window.__game.states.current`)) === 'playing');

// ------------------------------------------------------------- phase: restart
note('\n=== RESTART (R) ===');
const rt0 = Date.now();
await key(cdp, session, 'KeyR', 'down'); await key(cdp, session, 'KeyR', 'up');
await sleep(600);
const restarted = await evaluate(cdp, session, `(() => { const g = window.__game, p = g.player.body.translation();
  return { state: g.states.current, pos: [p.x, p.y, p.z], time: g.runTimeMs, spawn: g.currentLevel.spawn.position,
           bodies: g.physics.world.bodies.len() }; })()`);
const spawnDist = Math.hypot(restarted.pos[0] - restarted.spawn[0], restarted.pos[2] - restarted.spawn[2]);
note(`  restart took <= ${Date.now() - rt0} ms; pos ${restarted.pos.map((n) => n.toFixed(1))} vs spawn ${restarted.spawn}`);
check('R restarts the run', restarted.state === 'playing', `state=${restarted.state}`);
// Budgeted against the auto-run, not against a fixed number of units. The
// runner never stands still: it is moving at `runSpeed` from the frame the
// restart lands, so by the time this samples, 600 ms later, it has legitimately
// covered some ground. A flat 4-unit tolerance passed only because the software
// rasteriser used to be too slow to advance the simulation that far - once the
// render cost came down the same correct restart started measuring 4.6 u and
// failing. What this check is actually for is "the restart put the cat back at
// the start rather than leaving it where it died", so the bound is the furthest
// it could honestly have run in that window, plus slack for the spawn drop.
const restartBudget = runSpeed * 0.6 + 2;
check('restart returns the cat to spawn', spawnDist < restartBudget,
  `${spawnDist.toFixed(2)} u from spawn (budget ${restartBudget.toFixed(1)} u)`);
check('restart resets the timer', restarted.time < 2000, `${restarted.time.toFixed(0)} ms`);
check('restart does not leak physics bodies', restarted.bodies === started.bodies,
  `${started.bodies} -> ${restarted.bodies}`);

// -------------------------------------------------------- phase: lives / fail
//
// A fall no longer ends the run outright: it costs one of three lives and
// buys ~2 simulated seconds of invulnerability (INVULN_DURATION in Game.ts),
// during which the runner is put back on safe ground. Only the third loss
// actually fails the attempt. This replaces the old harness's single
// "teleport below the kill plane -> instantly failed" check, which is no
// longer true under the new lives model.
note('\n=== LIVES / FAIL PATH ===');
// Restart first so lives are guaranteed full and safe-ground tracking is
// primed from a fresh spawn rather than wherever the rig/geometry probes left it.
await key(cdp, session, 'KeyR', 'down'); await key(cdp, session, 'KeyR', 'up');

// Read authoritative simulation state (g.lives / g.invulnTimer), not the
// rendered g.hudState snapshot: on this slow (0.6 fps) software renderer,
// updateHud() only copies lives/invulnerable into hudState once per rendered
// frame, so hudState can lag the real state by well over a second of wall
// clock - long enough for a poll to time out against a value that never
// actually changes on screen. g.states.current is not a snapshot (the state
// machine transitions synchronously inside fixedStep), so it stays here.
// `reason` is carried even though nothing asserts on it: fail() zeroes lives on
// every path, so a caught-by-dog and a spent-last-life are indistinguishable
// from {lives:0,state:'failed'} alone. Without the reason in the log, a chase
// failure during this phase reads as a lives bug.
const LIFE_STATE = `(() => { const g = window.__game;
  return { lives: g.lives, invuln: g.invulnTimer > 0, state: g.states.current,
           reason: g.failReason }; })()`;

// restartLevel() is itself deferred a frame (see Game.ts), so on this
// renderer, waiting for it to actually land needs the same polling
// discipline as everything else - a fixed sleep can read stale state.
const freshRun = await pollUntil(LIFE_STATE,
  (s) => s.lives === 3 && s.state === 'playing', { timeoutMs: 20000 });
const livesStart = freshRun.state;
note(`  run start: ${JSON.stringify(livesStart)} (after ${freshRun.elapsedMs} ms)`);
check('a fresh run starts with full lives', freshRun.met, JSON.stringify(livesStart));

// The lives reset lands a step or two before the initial spawn-height settle
// finishes (level1's spawn sits 1.2 u above the true surface, a deliberate
// drop-in) - wait for `grounded` too, so the anchor captured just below is a
// genuinely resting position, not a mid-air one.
await pollUntil(`window.__game.player.grounded`, (g) => g === true, { timeoutMs: 10000 });

async function dropBelowKillPlane() {
  await evaluate(cdp, session, `(() => { const g = window.__game, t = g.player.body.translation();
    g.player.body.setTranslation({ x: t.x, y: -20, z: t.z }, true);
    g.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  })()`);
}

// The runner never stops moving - there is no throttle to release - so any
// wait where we are not deliberately testing a fall is a wait where the
// *uncontrolled* cat is still auto-running toward whatever is ahead. Level
// 1's very first corner is close enough to spawn that a long real-time poll
// on this slow a renderer (the invulnerability wait can run to a minute) is
// enough simulated time for the cat to reach and miss it entirely on its
// own, costing lives that have nothing to do with what this section is
// testing and producing results that don't fit either model. Anchoring back
// to a safe point on every tick of an *idle* wait keeps the runner's own
// track progress out of the picture, leaving only the fall we triggered
// on purpose. `recoverTo` doesn't touch lives or the invulnerability timer -
// both live on `Game`, not the controller - so it can't mask what we're
// actually polling for.
//
// The anchor is read off the *settled* body, not `level.spawn.position`:
// level1's authored spawn sits 1.2 units above the true walking surface (a
// deliberate drop-in), so recoverTo-ing straight to that raw coordinate on
// every tick keeps re-triggering a small fall-and-land instead of holding
// still - occasionally enough of those compound into a real, unintended
// life loss. `freshRun` above already confirmed the game is playing with
// full lives, which only happens after that initial settle has finished, so
// its position is the one to freeze on.
const anchor = await evaluate(cdp, session,
  `(() => { const t = window.__game.player.body.translation(); return { x: t.x, y: t.y, z: t.z }; })()`);
async function pollIdle(exprJs, predicate, { timeoutMs = 15000, intervalMs = 150 } = {}) {
  const t0 = Date.now();
  let state = await evaluate(cdp, session, exprJs);
  while (!predicate(state) && Date.now() - t0 < timeoutMs) {
    // Unconditional, not "only if drifted" - this renderer delivers frames in
    // bursts (see the file header), so a distance check sampled once per tick
    // can still miss a burst that covers the whole corner window between two
    // checks. Re-anchoring every tick, at a short interval, minimises the
    // real-time window the runner is ever left completely unsupervised in.
    // Holding the cat still is only half of it. The pursuers are on a separate
    // scalar that keeps advancing regardless, and recoverTo zeroes the cat's
    // velocity - which the rubber band reads as a dawdling player and answers
    // with its full catch-up bonus (Pursuer.computeSpeed's slowFactor). So a
    // pinned cat is not a safe cat: it is the single most catchable state in
    // the game, and a minute of idling here reliably ended the run with
    // caughtByDog, which fail() then reports as lives:0 - indistinguishable
    // from a lives bug. Park the chase at a fixed gap for as long as we idle.
    await evaluate(cdp, session, `(() => {
      const g = window.__game, THREE = window.__three;
      g.player.recoverTo(new THREE.Vector3(${anchor.x}, ${anchor.y}, ${anchor.z}));
      for (const p of g.pursuers) { p.distance = g.playerRouteDistance - 200; p.hasCaught = false; }
    })()`);
    await sleep(intervalMs);
    state = await evaluate(cdp, session, exprJs);
  }
  return { state, met: predicate(state), elapsedMs: Date.now() - t0 };
}

// Two falls, each waited out past the invulnerability window before the next,
// so each one genuinely spends a life instead of being absorbed by it.
for (let i = 0; i < 2; i++) {
  await dropBelowKillPlane();
  // Deliberately not pinned: this poll is watching the fall we just triggered.
  const fallResult = await pollUntil(LIFE_STATE,
    (s) => s.lives <= livesStart.lives - (i + 1) || s.state !== 'playing',
    { timeoutMs: 30000 });
  const afterFall = fallResult.state;
  note(`  fall ${i + 1}: lives=${afterFall.lives} invuln=${afterFall.invuln} state=${afterFall.state} (after ${fallResult.elapsedMs} ms)`);
  check(`fall ${i + 1} costs exactly one life without ending the run`,
    afterFall.lives === livesStart.lives - (i + 1) && afterFall.state === 'playing', JSON.stringify(afterFall));
  check(`fall ${i + 1} grants invulnerability`, afterFall.invuln === true);

  if (i === 0) {
    // This one genuinely is checking presentation (the rendered paw icons),
    // so it stays reading the DOM - but the DOM only updates once per
    // rendered frame, and at 0.6 fps a single frame is ~1.7 s, so a one-shot
    // read right after the authoritative state has changed can still catch
    // the pre-fall HUD. Poll until it catches up instead of reading once.
    const domResult = await pollUntil(
      `document.querySelectorAll('#hud-lives .hud-life:not(.hud-life--spent)').length`,
      (n) => n === afterFall.lives, { timeoutMs: 20000 });
    check('the paw HUD reflects the lost life', domResult.met,
      `HUD shows ${domResult.state} paws, state says ${afterFall.lives} (after ${domResult.elapsedMs} ms)`);
  }

  // Let invulnerability actually expire (INVULN_DURATION, simulated) before
  // the next drop, or the drop is a no-op (loseLife short-circuits while
  // invulnerable) rather than a second genuine life loss. This is the
  // slowest wait in the file: 2 *simulated* seconds, which on this
  // renderer's worst observed real:sim ratio has taken the better part of a
  // minute - pinned, per the note above, so that minute of idling can't run
  // the cat into the corner on its own.
  const cleared = await pollIdle(LIFE_STATE, (s) => s.invuln === false, { timeoutMs: 90000 });
  note(`  invulnerability cleared: ${cleared.met} (after ${cleared.elapsedMs} ms)`);
  if (!cleared.met) note('  WARNING: invulnerability never cleared inside the timeout - the next fall may be a no-op');
}

// Third fall spends the last life and should end the run for real.
await dropBelowKillPlane();
const FAIL_STATE = `(() => { const g = window.__game;
  return { state: g.states.current, lives: g.lives, reason: g.failReason,
           screen: getComputedStyle(document.getElementById('screen-failed')).display !== 'none',
           msg: document.getElementById('fail-message')?.textContent ?? '' }; })()`;
// Deliberately not pinned: watching the fall we just triggered.
const failResult = await pollUntil(FAIL_STATE, (s) => s.state === 'failed', { timeoutMs: 60000 });
const failed = failResult.met ? failResult.state : null;
note(`  third fall -> ${JSON.stringify(failed)} (after ${failResult.elapsedMs} ms)`);
check('losing the third life actually fails the run', failed !== null && failed.lives === 0, JSON.stringify(failed));
check('fail screen appears with a message', !!failed?.screen && (failed?.msg.length ?? 0) > 0, failed?.msg ?? '');
if (failed) await screenshot(cdp, session, join(OUT, '05-failed.png'));

await key(cdp, session, 'KeyR', 'down'); await key(cdp, session, 'KeyR', 'up');
await sleep(800);
check('can retry after failing', (await evaluate(cdp, session, `window.__game.states.current`)) === 'playing');

// -------------------------------------------------- phase: levels 2 and 3 boot
for (const idx of [2, 3]) {
  note(`\n=== LEVEL ${idx} ===`);
  const errsBefore = consoleMsgs.filter((m) => m.type === 'error').length;
  const excBefore = exceptions.length;
  await evaluate(cdp, session, `window.__game.startLevel(${idx})`);
  await sleep(3500);
  const lv = await evaluate(cdp, session, `(() => { const g = window.__game, p = g.player.body.translation();
    return { state: g.states.current, id: g.currentLevel?.id, name: g.currentLevel?.name,
             pos: [p.x, p.y, p.z], colliders: g.physics.world.colliders.len(),
             pursuers: g.pursuers.length, tokens: g.currentLevel?.tokens.length,
             calls: g.renderer.info.render.calls }; })()`);
  note(`  ${JSON.stringify(lv)}`);
  check(`level ${idx} loads and plays`, lv.state === 'playing' && lv.id === `level-${idx}`, `${lv.id} / ${lv.state}`);
  check(`level ${idx} builds geometry`, lv.colliders > 20, `${lv.colliders} colliders, ${lv.calls} draw calls`);
  check(`level ${idx} loads without new errors`,
    consoleMsgs.filter((m) => m.type === 'error').length === errsBefore && exceptions.length === excBefore);

  // No input needed: the auto-run alone is enough to prove the spawn is on
  // solid ground and the level is actually playable.
  const y0 = lv.pos[1];
  await sleep(2500);
  const after = await evaluate(cdp, session, `(() => { const g = window.__game, p = g.player.body.translation();
    return { y: p.y, state: g.states.current, route: g.playerRouteDistance }; })()`);
  note(`  after 2.5 s of auto-run: y ${y0.toFixed(1)} -> ${after.y.toFixed(1)}, route ${after.route.toFixed(1)}, state ${after.state}`);
  check(`level ${idx} spawn is on solid ground`, after.y > y0 - 5 && after.state === 'playing',
    `y ${y0.toFixed(1)} -> ${after.y.toFixed(1)}, state ${after.state}`);
  await screenshot(cdp, session, join(OUT, `06-level${idx}.png`));
}

// ------------------------------------------------- phase: network during play
note('\n=== NETWORK DURING GAMEPLAY ===');
const afterBoot = netRequests.filter((r) => r.after && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
check('zero network requests after the initial load', afterBoot.length === 0,
  afterBoot.map((r) => r.url).slice(0, 5).join(', '));
const external = netRequests.filter((r) => !/^(https?:\/\/(localhost|127\.0\.0\.1)|data:|blob:|about:)/.test(r.url));
check('no external hosts contacted at all', external.length === 0, external.map((r) => r.url).slice(0, 5).join(', '));

// ------------------------------------------------------------------- wrap up
note('\n=== FINAL CONSOLE STATE ===');
const errorMsgs = consoleMsgs.filter((m) => m.type === 'error');
const warnMsgs = consoleMsgs.filter((m) => m.type === 'warning' || m.type === 'warn');
note(`  ${consoleMsgs.length} console messages: ${errorMsgs.length} errors, ${warnMsgs.length} warnings`);
for (const m of errorMsgs.slice(0, 20)) note(`    ERROR (${m.phase}): ${m.text}`);
for (const m of warnMsgs.slice(0, 20)) note(`    WARN  (${m.phase}): ${m.text}`);
check('no uncaught exceptions during the whole session', exceptions.length === 0, exceptions.join(' | ').slice(0, 300));
check('no console errors during the whole session', errorMsgs.length === 0, errorMsgs.map((m) => m.text).join(' | ').slice(0, 400));

const passed = results.filter((r) => r.pass).length;
note(`\n===================================`);
note(`  ${passed}/${results.length} checks passed`);
note(`===================================`);
for (const r of results.filter((r) => !r.pass)) note(`  FAILED: ${r.name} -- ${r.detail}`);

writeFileSync(join(OUT, '..', 'report.json'),
  JSON.stringify({ fps, glInfo, results, exceptions, consoleMsgs, netFailures, log }, null, 2));

cdp.close();
chrome.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
