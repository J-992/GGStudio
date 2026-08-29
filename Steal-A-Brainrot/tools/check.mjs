/**
 * The gate CI runs before it builds -- `verify` in poki.json.
 *
 * There is no test framework here and no typechecker to lean on, so this does
 * the things that would otherwise be found by a player or, worse, by Poki's
 * reviewer: it boots every script against a stub Phaser (see boot.mjs), which
 * catches a syntax error or a global that moved; it checks the creature
 * catalogue against the rules the economy assumes; and it checks that the art
 * the manifest promises is actually on disk.
 *
 * The data checks are the design rules, enforced. A creature whose rarity is
 * not in RARITY_WEIGHTS never spawns. A rarity that pays less than the one
 * below it makes the whole ladder pointless. Neither is visible until somebody
 * plays far enough to reach it.
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

//  --------------------------------------------------------------- creatures

const { CFG, CREATURES, CREATURES_BY_ID, RARITIES, ENEMIES, BOSSES, LEVELS, LAYOUT, configureLayout, Poki, Units } = data;

if (!CFG || !CREATURES || !RARITIES || !ENEMIES || !BOSSES || !LEVELS) {
  if (errors.length === 0) fail('CFG, CREATURES, RARITIES, ENEMIES, BOSSES or LEVELS are not defined.');
  done();
}

//  The wrapper has to survive a page with no SDK on it -- that is every run
//  outside poki.com, including this one.
if (Poki && Poki.ready) fail('Poki.ready is true with no SDK present; the wrapper is not degrading to no-ops.');

if (CREATURES.length < 20) fail(`expected at least 20 creatures, found ${CREATURES.length}.`);

const ROLES = new Set(['producer', 'shooter', 'lobber', 'melee', 'ring', 'sniper', 'wall', 'mine']);
const ids = new Set();

for (const c of CREATURES) {
  const where = `creature ${c.id} (${c.name})`;

  if (ids.has(c.id)) fail(`${where}: duplicate id -- the shop and save data key off it.`);
  ids.add(c.id);

  if (!RARITIES[c.rarity]) fail(`${where}: unknown rarity "${c.rarity}".`);
  if (!ROLES.has(c.role)) fail(`${where}: unknown role "${c.role}" -- it would stand on the lawn doing nothing.`);
  if (!(c.cost > 0)) fail(`${where}: brainz cost must be positive.`);
  if (!(c.hp > 0)) fail(`${where}: hp must be positive -- everything can be chewed.`);
  if (!(c.cooldownMs > 0)) fail(`${where}: card cooldown must be positive.`);
  if (!(c.price >= 0)) fail(`${where}: shop price must be >= 0 (0 = starter).`);

  if (c.role === 'producer' && !(c.produceMs > 0 && c.produceAmount > 0)) {
    fail(`${where}: a producer needs produceMs and produceAmount.`);
  }
  if (['shooter', 'lobber', 'melee', 'ring', 'sniper', 'mine'].includes(c.role)) {
    if (!(c.damage > 0)) fail(`${where}: damage must be positive.`);
  }
  if (['shooter', 'lobber', 'melee', 'ring', 'sniper'].includes(c.role)) {
    if (!(c.attackSpeed > 0)) fail(`${where}: attackSpeed must be positive.`);
  }
  if (c.role === 'shooter' && !c.projectile) fail(`${where}: a shooter needs a projectile texture.`);
  if (['lobber', 'ring', 'mine'].includes(c.role) && !(c.radius > 0)) fail(`${where}: role "${c.role}" needs a radius.`);
  if (c.role === 'mine' && !(c.armMs > 0)) fail(`${where}: a mine needs an arming time.`);
}

//  The starters are the level-1 squad: they must exist, be free, and cover
//  the tutorial script (a producer to teach brainz, a shooter to teach lanes).
const starters = CREATURES.filter((c) => c.price === 0);
if (starters.length < 3) fail(`only ${starters.length} starters (price 0); the default squad needs at least 3.`);
if (!starters.some((c) => c.role === 'producer')) fail('no free producer -- the tutorial cannot teach the economy.');
if (!starters.some((c) => c.role === 'shooter')) fail('no free shooter -- the tutorial cannot teach the lanes.');

//  Buying into a higher rarity has to buy more power for the money to mean
//  anything: within the shop, each tier's cheapest entry must cost more than
//  the tier below's dearest.
const byTier = new Map();
for (const c of CREATURES) {
  if (c.price === 0) continue;
  const t = RARITIES[c.rarity].tier;
  const cur = byTier.get(t) || { min: Infinity, max: -Infinity };
  byTier.set(t, { min: Math.min(cur.min, c.price), max: Math.max(cur.max, c.price) });
}
const tiers = [...byTier.keys()].sort((a, b) => a - b);
for (let i = 1; i < tiers.length; i++) {
  const lo = byTier.get(tiers[i - 1]);
  const hi = byTier.get(tiers[i]);
  if (hi.min <= lo.max) fail(`shop tier ${tiers[i]} starts at $${hi.min}, not above tier ${tiers[i - 1]}'s top $${lo.max}.`);
}

//  ---------------------------------------------------------------- enemies

for (const [id, e] of [...Object.entries(ENEMIES), ...Object.entries(BOSSES)]) {
  const where = `enemy ${id} (${e.name})`;
  if (!CREATURES_BY_ID[e.base]) fail(`${where}: base "${e.base}" is not a creature -- it has no sprite to wear.`);
  if (!(e.hp > 0) || !(e.speed > 0) || !(e.bite > 0) || !(e.coins > 0)) {
    fail(`${where}: hp, speed, bite and coins must all be positive.`);
  }
}

//  ----------------------------------------------------------------- levels

if (LEVELS.length < 10) fail(`expected at least 10 levels, found ${LEVELS.length}.`);

let prevReward = 0;
LEVELS.forEach((lv, i) => {
  const where = `level ${lv.level || i + 1}`;
  if (!Array.isArray(lv.lanes) || lv.lanes.length < 1) fail(`${where}: needs active lanes.`);
  for (const l of lv.lanes || []) {
    if (!(l >= 0 && l < CFG.GRID.lanes)) fail(`${where}: lane ${l} is off the ${CFG.GRID.lanes}-lane lawn.`);
  }
  if (!Array.isArray(lv.waves) || lv.waves.length < 1 || lv.waves.length > 5) fail(`${where}: needs 1..5 waves.`);
  for (const w of lv.waves || []) {
    for (const sp of w.spawns || []) {
      if (!ENEMIES[sp.enemy]) fail(`${where}: wave spawns unknown enemy "${sp.enemy}".`);
      if (!(sp.n > 0) || !(sp.everyMs > 0)) fail(`${where}: spawn group needs positive n and everyMs.`);
      if (sp.lane !== undefined && !lv.lanes.includes(sp.lane)) fail(`${where}: spawn pinned to inactive lane ${sp.lane}.`);
    }
  }
  if (lv.boss && !BOSSES[lv.boss]) fail(`${where}: unknown boss "${lv.boss}".`);
  if (!(lv.reward > 0)) fail(`${where}: needs a positive coin reward.`);
  if (lv.reward < prevReward) fail(`${where}: reward ${lv.reward} pays less than the level before it.`);
  prevReward = lv.reward;
});

//  Level 1 is the tutorial: a teaching lawn (not all lanes), and enough
//  starting brainz to plant the starter shooter immediately.
const l1 = LEVELS[0];
if (l1.lanes.length >= CFG.GRID.lanes) fail('level 1 opens every lane; the tutorial needs a smaller lawn.');
const starterShooter = starters.find((c) => c.role === 'shooter');
if (starterShooter && !(l1.startEnergy >= starterShooter.cost)) {
  fail(`level 1 starts with ${l1.startEnergy} brainz; the tutorial's first plant costs ${starterShooter.cost}.`);
}

//  ----------------------------------------------------------------- layout

//  Both orientations have to produce sane zones in the right vertical order.
for (const [vw, vh] of [[390, 844], [1280, 720]]) {
  configureLayout(vw, vh);
  const where = `layout ${vw}x${vh}`;
  const f = LAYOUT.field, cb = LAYOUT.cards;
  if (!f || !cb) { fail(`${where}: zones missing.`); continue; }
  if (cb.y < LAYOUT.hud.h) fail(`${where}: the card bar runs under the HUD.`);
  if (f.y < cb.y + cb.h) fail(`${where}: the lawn runs under the card bar.`);
  for (const [name, r] of [['field', f], ['cards', cb]]) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > LAYOUT.width || r.y + r.h > LAYOUT.height + 1) {
      fail(`${where}: ${name} zone runs off the canvas.`);
    }
  }
  if (!(f.colW > 30)) fail(`${where}: lawn cells are ${f.colW.toFixed(1)}px wide -- too small to tap.`);
  if (!(f.laneH > 40)) fail(`${where}: lanes are ${f.laneH.toFixed(1)}px tall -- too small to read.`);
}

//  --------------------------------------------------------------------- art

//  Every key the manifest promises has to exist, or the boot scene drops the
//  placeholder for it and then fails to load its replacement.
const manifestPath = join(ROOT, CFG.ART_MANIFEST);

if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const base = manifest.base || '';

  for (const [key, file] of Object.entries(manifest.sprites || {})) {
    if (!existsSync(join(ROOT, base, file))) fail(`the manifest lists ${key} -> ${file}, which is not on disk.`);
  }

  //  A sprite for a creature that no longer exists is dead weight in the build.
  const known = new Set([...CREATURES.map((c) => `cr_${c.id}`), 'hand']);

  for (const key of Object.keys(manifest.sprites || {})) {
    if (!known.has(key)) fail(`the manifest ships ${key}, which matches no creature (or the tutorial hand).`);
  }
}

//  ------------------------------------------------------------------ poki

/**
 * Poki's inspector fails a build that never fires gameplayStart, and the way to
 * lose it is not to forget the call -- it is to make it while `PokiSDK.init()`
 * is still pending. The game boots on a race with a 5s timeout, so a slow SDK
 * means the menu and its gameplayStart can happen before the wrapper is ready.
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
    AudioSys: { suspend() {}, resume() {} },
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
  //  init() defers sdk.init() onto the microtask queue so a synchronous throw
  //  inside it cannot escape; let that run before pretending the SDK answered.
  await new Promise((res) => setTimeout(res, 0));
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

/**
 * The Inspector run that failed step 1 of SDK Basics. Two ways the wrapper
 * could swallow gameLoadingFinished, both now covered:
 *
 *   throws  an SDK that rejects a call made in an order it dislikes must not
 *           be able to throw into game code -- that killed Phaser construction
 *           in main.js, so the game never loaded at all
 *   rejects an init() that never succeeds must not mean the loading call is
 *           recorded and never sent
 */
async function checkHostileSdk(label, sdkFactory) {
  const calls = [];

  const sandbox = {
    setTimeout, Date, Math, JSON, Object, Promise,
    location: { hostname: 'games.poki.com', search: '' },
    AudioSys: { suspend() {}, resume() {} },
    PokiSDK: sdkFactory(calls)
  };
  sandbox.window = sandbox;

  const context = createContext(sandbox);
  runInContext(readFileSync(join(ROOT, 'src/systems/PokiSDK.js'), 'utf8'), context, { filename: 'src/systems/PokiSDK.js' });

  const poki = sandbox.Poki;

  try {
    await poki.init();
  } catch (err) {
    fail(`${label}: Poki.init() threw into game code (${err.message}) -- main.js would never construct Phaser.`);
    return;
  }

  poki.loadingFinished();
  await new Promise((res) => setTimeout(res, 0));

  if (!calls.includes('gameLoadingFinished')) {
    fail(`${label}: gameLoadingFinished never reached the SDK (sent: ${calls.join(', ') || 'nothing'}).`);
  }
}

await checkLateInit();

//  An SDK that throws on anything called before init resolves.
await checkHostileSdk('SDK that rejects out-of-order calls', (calls) => {
  let started = false;
  const guard = (name) => () => {
    if (!started && name !== 'init' && name !== 'setDebug') throw new Error('PokiSDK not initialized');
    calls.push(name);
  };
  return {
    init: () => { started = true; calls.push('init'); return Promise.resolve(); },
    setDebug() {},
    gameLoadingStart: guard('gameLoadingStart'),
    gameLoadingFinished: guard('gameLoadingFinished'),
    gameplayStart: guard('gameplayStart'),
    gameplayStop: guard('gameplayStop')
  };
});

//  An SDK whose init() never succeeds -- adblock, sandbox, bad network.
await checkHostileSdk('SDK whose init rejects', (calls) => ({
  init: () => Promise.reject(new Error('blocked')),
  setDebug() {},
  gameLoadingStart: () => calls.push('gameLoadingStart'),
  gameLoadingFinished: () => calls.push('gameLoadingFinished'),
  gameplayStart: () => calls.push('gameplayStart'),
  gameplayStop: () => calls.push('gameplayStop')
}));

//  ------------------------------------------------------------------ done

if (failures.length > 0) done();

console.log(`\n  OK -- ${sources.length} scripts boot, ${CREATURES.length} brainrots and ${LEVELS.length} levels validate.\n`);
