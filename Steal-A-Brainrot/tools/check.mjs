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

const { CFG, CREATURES, RARITIES, Poki } = data;

if (!CFG || !CREATURES || !RARITIES) {
  if (errors.length === 0) fail('CFG, CREATURES or RARITIES are not defined.');
  done();
}

//  The wrapper has to survive a page with no SDK on it -- that is every run
//  outside poki.com, including this one.
if (Poki && Poki.ready) fail('Poki.ready is true with no SDK present; the wrapper is not degrading to no-ops.');

if (CREATURES.length < 15) fail(`expected at least 15 creatures, found ${CREATURES.length}.`);

const ids = new Set();

for (const c of CREATURES) {
  const where = `creature ${c.id} (${c.name})`;

  if (ids.has(c.id)) fail(`${where}: duplicate id -- the collection and save data key off it.`);
  ids.add(c.id);

  if (!RARITIES[c.rarity]) { fail(`${where}: unknown rarity "${c.rarity}".`); continue; }
  if (!(CFG.RARITY_WEIGHTS[c.rarity] > 0)) fail(`${where}: rarity "${c.rarity}" has no spawn weight, so it never reaches the belt.`);
  if (!(c.price > 0)) fail(`${where}: price must be positive.`);
  if (!(c.income > 0)) fail(`${where}: income must be positive.`);
}

//  Value has to climb with rarity, or the ladder means nothing. Compared tier
//  against tier rather than entry against entry, so reordering within a tier
//  stays free.
const byTier = new Map();

for (const c of CREATURES) {
  const t = RARITIES[c.rarity].tier;
  const cur = byTier.get(t) || { min: Infinity, max: -Infinity, minInc: Infinity, maxInc: -Infinity };
  byTier.set(t, {
    min: Math.min(cur.min, c.price), max: Math.max(cur.max, c.price),
    minInc: Math.min(cur.minInc, c.income), maxInc: Math.max(cur.maxInc, c.income)
  });
}

const tiers = [...byTier.keys()].sort((a, b) => a - b);

for (let i = 1; i < tiers.length; i++) {
  const lo = byTier.get(tiers[i - 1]);
  const hi = byTier.get(tiers[i]);
  if (hi.min <= lo.max) fail(`tier ${tiers[i]} starts at $${hi.min}, which is not above tier ${tiers[i - 1]}'s top price $${lo.max}.`);
  if (hi.minInc <= lo.maxInc) fail(`tier ${tiers[i]} earns from $${hi.minInc}/s, which is not above tier ${tiers[i - 1]}'s best $${lo.maxInc}/s.`);
}

//  ------------------------------------------------------------------ rebirth

//  Rebirth gates on owning a creature of REBIRTH_RARITY or better. If no such
//  creature can spawn, the run has no exit and the player grinds forever.
const needed = RARITIES[CFG.REBIRTH_RARITY];

if (!needed) fail(`CFG.REBIRTH_RARITY "${CFG.REBIRTH_RARITY}" is not a rarity.`);
else if (!CREATURES.some((c) => RARITIES[c.rarity].tier >= needed.tier)) {
  fail(`rebirth needs a ${CFG.REBIRTH_RARITY}+ creature and none exists -- the run cannot be completed.`);
}

//  Its cheapest qualifying creature also has to be affordable at the cash gate,
//  or "own one epic" is a second, hidden paywall on top of $50,000.
const cheapestQualifying = Math.min(...CREATURES
  .filter((c) => RARITIES[c.rarity].tier >= needed.tier)
  .map((c) => c.price));

if (cheapestQualifying > CFG.REBIRTH_CASH) {
  fail(`the cheapest ${CFG.REBIRTH_RARITY}+ costs $${cheapestQualifying}, above the $${CFG.REBIRTH_CASH} rebirth gate.`);
}

//  ------------------------------------------------------------------ slots

if (CFG.PLAYER_SLOTS > CFG.MAX_SLOTS) fail(`PLAYER_SLOTS ${CFG.PLAYER_SLOTS} exceeds MAX_SLOTS ${CFG.MAX_SLOTS}.`);

for (const [id, b] of Object.entries(CFG.BASES)) {
  if (b.x - b.w / 2 < 0 || b.x + b.w / 2 > CFG.W) fail(`base ${id} runs off the screen horizontally.`);
  if (b.y - b.h / 2 < 0 || b.y + b.h / 2 > CFG.H) fail(`base ${id} runs off the screen vertically.`);
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
  const known = new Set([
    ...CREATURES.map((c) => `cr_${c.id}`),
    'player',
    ...CFG.BOTS.map((b) => `tex_${b.id}`)
  ]);

  for (const key of Object.keys(manifest.sprites || {})) {
    if (!known.has(key)) fail(`the manifest ships ${key}, which matches no creature, the player or any bot.`);
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

console.log(`\n  OK -- ${sources.length} scripts boot, ${CREATURES.length} creatures across ${tiers.length} tiers validate.\n`);
