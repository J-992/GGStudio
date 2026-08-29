/**
 * The gate CI runs before it builds -- `verify` in poki.json.
 *
 * There is no test framework here and no typechecker to lean on, so this does
 * the two things that would otherwise be found by a player: it boots every
 * script against a stub Phaser (see boot.mjs), which catches a syntax error or
 * a global that moved, and it compiles all 15 levels through the real Course
 * builder and checks what a level can get wrong.
 *
 * The data checks are the design rules, enforced: a gap wider than a jump at
 * that level's speed is an unfinishable level, a gate with no opening wide
 * enough is a wall, and a checkpoint over a hole respawns you into the void.
 * All three are one number in a data file and none of them is visible until
 * somebody plays that far.
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

const { LEVELS, CFG, Course, Poki } = data;

if (!LEVELS || !CFG || !Course) {
  if (errors.length === 0) fail('LEVELS, CFG or Course are not defined.');
  done();
}

//  The wrapper has to survive a page with no SDK on it -- that is every run
//  outside poki.com, including this one.
if (Poki && Poki.ready) fail('Poki.ready is true with no SDK present; the wrapper is not degrading to no-ops.');

if (LEVELS.length !== 15) fail(`expected 15 levels, found ${LEVELS.length}.`);

const ids = new Set();

for (const level of LEVELS) {
  const where = `level ${level.id} (${level.name})`;

  if (ids.has(level.id)) fail(`${where}: duplicate id -- level select finds only the first.`);
  ids.add(level.id);

  let course;

  try {
    course = Course.build(level);
  } catch (err) {
    fail(`${where}: Course.build threw: ${err.message}`);
    continue;
  }

  if (course.platforms.length === 0) { fail(`${where}: no platforms.`); continue; }

  //  Union of platform z-coverage: what is left between the spans is a gap the
  //  players have to clear.
  const spans = course.platforms.map((p) => [p.z0, p.z1]).sort((a, b) => a[0] - b[0]);
  let coveredTo = spans[0][0];

  if (coveredTo > 0.5) fail(`${where}: course starts at z=${coveredTo}, players spawn at z=2.`);

  //  A full jump: airtime (2 * JUMP_VEL / GRAVITY) at this level's run speed.
  const maxJump = 2 * CFG.JUMP_VEL / CFG.GRAVITY * CFG.RUN_SPEED * level.speed;

  for (const [z0, z1] of spans) {
    if (z0 > coveredTo) {
      const gap = z0 - coveredTo;
      //  A launch pad just before a gap buys a lot more air.
      const pad = course.pads.some((p) => p.z < coveredTo && p.z > coveredTo - 8);
      const reach = pad ? maxJump * 1.8 : maxJump;

      if (gap > reach - 0.8) {
        fail(`${where}: gap of ${gap.toFixed(1)} at z=${coveredTo.toFixed(1)} exceeds jump reach ${reach.toFixed(1)}.`);
      }
    }

    coveredTo = Math.max(coveredTo, z1);
  }

  if (course.finishZ > coveredTo) fail(`${where}: finish line beyond the last platform.`);

  for (const cz of course.checkpoints) {
    if (!course.groundAt(0, cz, 0)) fail(`${where}: checkpoint at z=${cz} is not over ground.`);
  }

  for (const gate of course.gatesInfo) {
    if (!gate.openings.some((o) => o.w >= 1.2)) fail(`${where}: gate at z=${gate.z} has no opening wide enough to fit through.`);
  }

  for (const b of course.bolts) {
    if (b.y > 2.2) fail(`${where}: bolt at z=${b.z.toFixed(1)} floats too high to collect (y=${b.y}).`);
  }
}

//  ------------------------------------------------------------------ poki

/**
 * Poki's inspector fails a build that never fires gameplayStart, and the way to
 * lose it is not to forget the call -- it is to make it while `PokiSDK.init()`
 * is still pending. The game boots on a race with a 5s timeout, so a slow SDK
 * means the menu, the first level and its gameplayStart can all happen before
 * the wrapper is ready. Those calls have to be replayed, in order, on init.
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
    AudioSys: { stopTension() {}, suspend() {}, resume() {} },
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

console.log(`\n  OK -- ${sources.length} scripts boot, ${LEVELS.length} levels validate.\n`);
