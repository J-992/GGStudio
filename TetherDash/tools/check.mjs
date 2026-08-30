/**
 * The gate CI runs before it builds -- `verify` in poki.json.
 *
 * There is no test framework here and no typechecker to lean on, so this does
 * three things that would otherwise be found by a player: it boots every script
 * against a stub Phaser (see boot.mjs), which catches a syntax error or a global
 * that moved; it audits every track piece; and it runs the endless generator for
 * several kilometres to see that it stays inside its budget.
 *
 * The piece audit is the design rules, enforced. An endless runner has no
 * hand-checked levels -- the generator will eventually show a player every
 * piece, at every difficulty, arriving on every face -- so the guarantee has to
 * be per piece and it has to be structural:
 *
 *   * Every piece is entered through a coupler ring where all four faces are
 *     solid, so a route search may start on any face.
 *   * From there a route must exist to the far end: run along a face, step
 *     round a corner where two faces are both solid, or clear a gap no wider
 *     than a jump at the *slowest* run speed (the pessimistic case -- a faster
 *     run only ever jumps further).
 *
 * A piece that fails that is not a hard piece. It is a piece that kills you no
 * matter what you do, and it is one number in a data file away at all times.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

import { boot } from './boot.mjs';

const ROOT = resolve(import.meta.dirname, '..');

const failures = [];
const fail = (message) => failures.push(message);

const done = () => {
  for (const failure of failures) console.error(`\n  FAIL  ${failure}`);
  console.error('');
  process.exit(1);
};

//  ------------------------------------------------------------------ boot

//  index.html is where the load order lives; the build reads it too.
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const sources = [...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g)].map((m) => m[1]);

if (sources.length === 0) fail('index.html lists no src/ script tags.');

for (const file of sources) {
  if (!existsSync(join(ROOT, file))) fail(`index.html loads ${file}, which does not exist.`);
}

//  Poki's technical review ends a submission over a missing SDK tag, and it is
//  a one-line deletion away at all times.
if (!html.includes('game-cdn.poki.com')) fail('index.html carries no Poki SDK tag.');

if (failures.length > 0) done();

const { errors, data } = await boot(sources.map((file) => ({ name: file, code: readFileSync(join(ROOT, file), 'utf8') })));

failures.push(...errors);

//  ------------------------------------------------------------------ data

const { PIECES, CFG, Track, Poki } = data;

if (!PIECES || !CFG || !Track) {
  if (errors.length === 0) fail('PIECES, CFG or Track are not defined.');
  done();
}

//  The wrapper has to survive a page with no SDK on it -- that is every run
//  outside poki.com, including this one.
if (Poki && Poki.ready) fail('Poki.ready is true with no SDK present; the wrapper is not degrading to no-ops.');

const R = CFG.TUBE_R;

//  Airtime at the slowest the game ever runs. Every distance check below uses
//  this rather than the speed cap: a piece has to be clearable the first time
//  a player meets it, not only once the tunnel has sped up.
const JUMP_REACH = 2 * CFG.JUMP_VEL / CFG.GRAVITY * CFG.RUN_SPEED;
const PAD_REACH = JUMP_REACH * CFG.PAD_BOOST;

Track.init(null, null);

/** Compile one piece on its own, at z = 0, into plain arrays. */
function compile(def) {
  const out = { panels: [], bolts: [], hazards: [], pads: [] };
  out.newPanel = () => ({});
  out.newBolt = () => ({});
  out.newHazard = () => ({});
  out.newPad = () => ({});
  Track.compile(def, 0, out);
  return out;
}

//  ------------------------------------------------------------ piece audit

const ids = new Set();

if (!PIECES[0] || !PIECES[0].rest) {
  fail('PIECES[0] is what a run opens on and what a revive falls back to; it must be a `rest` piece.');
}

for (const def of PIECES) {
  const where = `piece "${def.id}"`;

  if (ids.has(def.id)) fail(`${where}: duplicate id.`);
  ids.add(def.id);

  if (!(def.len > 0)) { fail(`${where}: len must be positive.`); continue; }
  if (!(def.weight > 0)) fail(`${where}: weight must be positive or it can never be picked.`);
  if (!(def.tier >= 0 && def.tier <= 3)) fail(`${where}: tier must be 0..3.`);

  let piece;

  try {
    piece = compile(def);
  } catch (err) {
    fail(`${where}: build() threw: ${err.message}`);
    continue;
  }

  if (piece.panels.length === 0) { fail(`${where}: declares no panels.`); continue; }

  for (const p of piece.panels) {
    if (p.f < 0 || p.f > 3) fail(`${where}: panel on face ${p.f}; faces are 0..3.`);
    if (p.u0 < -R - 0.01 || p.u1 > R + 0.01) fail(`${where}: panel spans u ${p.u0}..${p.u1}, outside the tube (${-R}..${R}).`);
    if (p.u1 - p.u0 < 0.9) fail(`${where}: panel only ${(p.u1 - p.u0).toFixed(2)} units wide -- too narrow to stand on.`);
    if (p.z0 < -0.01 || p.z1 > def.len + 0.01) fail(`${where}: panel spans z ${p.z0}..${p.z1}, outside 0..${def.len}.`);
    if (p.z1 <= p.z0) fail(`${where}: panel at z ${p.z0} has no length.`);
  }

  //  A bolt above the top of a jump arc is decoration that looks collectable.
  const apex = CFG.JUMP_VEL * CFG.JUMP_VEL / (2 * CFG.GRAVITY);

  for (const b of piece.bolts) {
    if (b.h > apex + 0.15) fail(`${where}: bolt at z=${b.z.toFixed(1)} floats at h=${b.h}, above the ${apex.toFixed(2)} a jump reaches.`);
    if (b.u < -R || b.u > R) fail(`${where}: bolt at z=${b.z.toFixed(1)} sits outside the tube.`);
    if (b.z < -0.01 || b.z > def.len + 0.01) fail(`${where}: bolt at z=${b.z} is outside the piece.`);
  }

  //  Hazards and pads that are not on a panel cannot be hit or used.
  for (const h of piece.hazards) {
    if (!solidAt(piece, h.f, h.z, h.u)) fail(`${where}: ${h.kind} hazard at face ${h.f}, z=${h.z} is over a hole.`);
  }

  for (const pad of piece.pads) {
    if (!solidAt(piece, pad.f, pad.z, pad.u)) fail(`${where}: pad at face ${pad.f}, z=${pad.z} is over a hole.`);
  }

  const route = audit(piece, def.len);

  if (!route) fail(`${where}: no route from the coupler ring to the far end -- it kills every player who enters it.`);
}

/** Is there a panel on face `f` covering z (and u, when given)? */
function solidAt(piece, f, z, u) {
  for (const p of piece.panels) {
    if (p.f !== f || z < p.z0 - 0.01 || z > p.z1 + 0.01) continue;
    if (u === undefined || (u >= p.u0 - 0.3 && u <= p.u1 + 0.3)) return true;
  }
  return false;
}

/** Does a panel on `f` reach the +u (side 1) or -u (side -1) corner at z? */
function reachesCorner(piece, f, z, side) {
  for (const p of piece.panels) {
    if (p.f !== f || z < p.z0 - 0.01 || z > p.z1 + 0.01) continue;
    if (side > 0 ? p.u1 >= R - 0.35 : p.u0 <= -R + 0.35) return true;
  }
  return false;
}

/** Is there a launch pad on `f` within `back` units before z? */
function padBefore(piece, f, z, back) {
  return piece.pads.some((p) => p.f === f && p.z <= z + 0.5 && p.z > z - back);
}

/**
 * Breadth-first search over (face, z) for a route to the far end.
 *
 * Deliberately generous about *where* on a face the runner is -- it models
 * reachability, not travel time, because the ring in front of every piece is
 * long enough to cross a face and a piece is visible most of a draw distance
 * before it arrives. What it is strict about is topology: a corner is only
 * walkable where both faces are solid and both reach it, and a gap is only
 * jumpable at the slowest speed in the game.
 */
function audit(piece, len) {
  const STEP = 0.25;
  const N = Math.round(len / STEP) + 1;
  const zAt = (i) => Math.min(i * STEP, len);
  const seen = new Set();
  //  A run enters through the coupler ring, where every face is solid.
  const queue = [0, 1, 2, 3].map((f) => f * N);

  for (const s of queue) seen.add(s);

  while (queue.length > 0) {
    const state = queue.shift();
    const f = Math.floor(state / N);
    const i = state % N;
    const z = zAt(i);

    if (i >= N - 1) return true;
    if (!solidAt(piece, f, z)) continue;

    const push = (nf, ni) => {
      const key = nf * N + ni;
      if (ni < N && !seen.has(key)) { seen.add(key); queue.push(key); }
    };

    //  keep running
    if (solidAt(piece, f, zAt(i + 1))) push(f, i + 1);

    //  step round a corner, either way
    if (reachesCorner(piece, f, z, 1) && reachesCorner(piece, (f + 1) % 4, z, -1)
      && solidAt(piece, (f + 1) % 4, z)) push((f + 1) % 4, i);
    if (reachesCorner(piece, f, z, -1) && reachesCorner(piece, (f + 3) % 4, z, 1)
      && solidAt(piece, (f + 3) % 4, z)) push((f + 3) % 4, i);

    //  jump the gap that starts here, if a jump can cover it
    if (!solidAt(piece, f, zAt(i + 1))) {
      const reach = padBefore(piece, f, z, 3) ? PAD_REACH : JUMP_REACH;
      for (let j = i + 1; j < N && zAt(j) - z <= reach - 0.8; j++) {
        if (solidAt(piece, f, zAt(j))) { push(f, j); break; }
      }
      //  the coupler ring of the next piece counts as landable ground
      if (len - z <= reach - 0.8) return true;
    }
  }

  return false;
}

//  ------------------------------------------------------- the endless loop

/**
 * Five kilometres of generated tunnel. What can go wrong here is not a piece,
 * it is the loop around them: a spawn rule that never retires anything, a
 * grammar that stops finding a legal next piece, or a pool that hands out
 * records it never gets back.
 */
function checkGenerator() {
  Track.reset(20260830);

  const seenIds = new Set();
  let maxChunks = 0;
  let prev = null;
  let z = 0;

  //  Walk the runner forward the way the game does, in one-unit steps.
  while (z < 5000) {
    z += 1;
    Track.update(z, 1 / 60);
    maxChunks = Math.max(maxChunks, Track.chunks.length);

    for (const c of Track.chunks) {
      if (!PIECES.includes(c.def)) { fail(`the generator produced a chunk whose def is not in PIECES.`); return; }
      seenIds.add(c.def.id);
    }

    const head = Track.chunks[Track.chunks.length - 1];

    if (head && head.def !== prev) {
      //  Grammar: never the same piece twice running, and never two hard
      //  pieces back to back.
      if (prev && head.def === prev) fail(`the generator repeated "${head.def.id}" back to back.`);
      if (prev && prev.tier >= 2 && !head.def.rest) {
        fail(`the generator followed hard piece "${prev.id}" with "${head.def.id}", which is not a breather.`);
      }
      prev = head.def;
    }
  }

  //  Draw distance plus the retire margin bounds how much tunnel can be live.
  //  If this climbs, something is spawning and never being handed back.
  const maxLive = Math.ceil((Track.AHEAD + Track.BEHIND) / 12) + 4;

  if (maxChunks > maxLive) {
    fail(`up to ${maxChunks} chunks were live at once; the spawn/retire window should hold at most ${maxLive}.`);
  }

  //  Every record handed out is either in a live chunk or back in its pool.
  const live = { panel: 0, bolt: 0, hazard: 0, pad: 0 };

  for (const c of Track.chunks) {
    live.panel += c.panels.length;
    live.bolt += c.bolts.length;
    live.hazard += c.hazards.length;
    live.pad += c.pads.length;
  }

  const pools = [
    ['panel', Track._panelPool], ['bolt', Track._boltPool],
    ['hazard', Track._hazardPool], ['pad', Track._padPool]
  ];

  for (const [name, pool] of pools) {
    if (pool.live !== live[name]) {
      fail(`${pool.live} ${name} records are checked out of the pool but only ${live[name]} are in live chunks -- the recycler is leaking.`);
    }
  }

  //  Difficulty has to actually open up, or 5 km looks like the first 300 m.
  const tier0 = PIECES.filter((d) => d.tier === 0).map((d) => d.id);
  const hard = PIECES.filter((d) => d.tier >= 2).map((d) => d.id);

  for (const id of tier0) {
    if (!seenIds.has(id)) fail(`piece "${id}" is tier 0 but never appeared in 5 km of tunnel.`);
  }

  if (!hard.some((id) => seenIds.has(id))) fail('no tier 2+ piece appeared in 5 km; the difficulty ramp is not opening up.');

  return seenIds;
}

const seenIds = checkGenerator();

//  ------------------------------------------------------------------ poki

/**
 * Poki's inspector fails a build that never fires gameplayStart, and the way to
 * lose it is not to forget the call -- it is to make it while `PokiSDK.init()`
 * is still pending. The game boots on a race with a 5s timeout, so the menu, the
 * first run and its gameplayStart can all happen before the wrapper is ready.
 * Those calls have to be replayed, in order, on init.
 */
async function checkLateInit() {
  const calls = [];
  let resolveInit;
  const record = (name) => () => calls.push(name);

  //  The wrapper alone, on a page where the SDK exists but is slow to answer.
  //  Not the shared boot stub: that one boots the whole game and deliberately
  //  has no PokiSDK on its window.
  const sandbox = {
    setTimeout, Date, Math, JSON, Object, Promise,
    location: { hostname: 'games.poki.com', search: '' },
    AudioSys: { stopRush() {}, suspend() {}, resume() {} },
    PokiSDK: {
      init: () => new Promise((res) => { resolveInit = res; }),
      setDebug() {},
      gameLoadingStart: record('gameLoadingStart'),
      gameLoadingFinished: record('gameLoadingFinished'),
      gameplayStart: record('gameplayStart'),
      gameplayStop: record('gameplayStop')
    }
  };
  sandbox.window = sandbox;

  const context = createContext(sandbox);

  try {
    runInContext(readFileSync(join(ROOT, 'src/systems/PokiSDK.js'), 'utf8'), context, { filename: 'src/systems/PokiSDK.js' });
  } catch (err) {
    fail(`src/systems/PokiSDK.js does not load on its own: ${err.message}`);
    return;
  }

  const poki = sandbox.Poki;

  if (!poki) {
    fail('PokiSDK.js leaves no window.Poki -- a `const` at the top of a classic script is not a window property.');
    return;
  }

  poki.init();
  poki.loadingFinished();   // the boot scene does not wait for the SDK
  poki.gameplayStart();     // ...and neither does the player
  resolveInit();
  await new Promise((res) => setTimeout(res, 0));

  const sent = calls.join(', ') || 'nothing';

  if (!calls.includes('gameplayStart')) {
    fail(`a gameplayStart fired before the SDK was ready never reached it (sent: ${sent}).`);
  } else if (!calls.includes('gameLoadingFinished')) {
    fail(`gameLoadingFinished fired before the SDK was ready never reached it (sent: ${sent}).`);
  } else if (calls.indexOf('gameLoadingFinished') > calls.indexOf('gameplayStart')) {
    fail(`gameplayStart reached the SDK before gameLoadingFinished (sent: ${sent}).`);
  }

  const before = calls.length;
  poki.gameplayStart();     // a repeat is not a second session
  await new Promise((res) => setTimeout(res, 0));
  if (calls.length !== before) fail('a repeated gameplayStart was forwarded to the SDK twice.');
}

await checkLateInit();

//  ------------------------------------------------------------------ done

if (failures.length > 0) done();

console.log(`\n  OK -- ${sources.length} scripts boot, ${PIECES.length} pieces audited, ${seenIds.size} of them seen in 5 km of generated tunnel.\n`);
