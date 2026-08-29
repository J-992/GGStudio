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

const { CFG, CREATURES, RARITIES, ARCHETYPES, ENEMIES, BOSSES, STAGES, LAYOUT, configureLayout, Poki } = data;

if (!CFG || !CREATURES || !RARITIES || !ARCHETYPES || !ENEMIES || !BOSSES || !STAGES) {
  if (errors.length === 0) fail('CFG, CREATURES, RARITIES, ARCHETYPES, ENEMIES, BOSSES or STAGES are not defined.');
  done();
}

//  The wrapper has to survive a page with no SDK on it -- that is every run
//  outside poki.com, including this one.
if (Poki && Poki.ready) fail('Poki.ready is true with no SDK present; the wrapper is not degrading to no-ops.');

if (CREATURES.length < 20) fail(`expected at least 20 creatures, found ${CREATURES.length}.`);

const ids = new Set();

for (const c of CREATURES) {
  const where = `creature ${c.id} (${c.name})`;

  if (ids.has(c.id)) fail(`${where}: duplicate id -- the braindex and save data key off it.`);
  ids.add(c.id);

  if (!RARITIES[c.rarity]) { fail(`${where}: unknown rarity "${c.rarity}".`); continue; }
  if (!(CFG.RARITY_WEIGHTS[c.rarity] > 0)) fail(`${where}: rarity "${c.rarity}" has no gacha weight, so the machine never dispenses it.`);
  if (!ARCHETYPES[c.archetype]) fail(`${where}: unknown archetype "${c.archetype}" -- it would stand on the field and never attack.`);
  if (!(c.baseDamage > 0)) fail(`${where}: baseDamage must be positive.`);
  if (!(c.attackSpeed > 0)) fail(`${where}: attackSpeed must be positive.`);
  if (!(c.sellValue > 0)) fail(`${where}: sellValue must be positive.`);
}

//  Power has to climb with rarity, or pulling a rare is a lie. Compared tier
//  against tier (1-star dps = damage x speed) so reordering within a tier
//  stays free.
const byTier = new Map();

for (const c of CREATURES) {
  const t = RARITIES[c.rarity].tier;
  const dps = c.baseDamage * c.attackSpeed;
  const cur = byTier.get(t) || { min: Infinity, max: -Infinity };
  byTier.set(t, { min: Math.min(cur.min, dps), max: Math.max(cur.max, dps) });
}

const tiers = [...byTier.keys()].sort((a, b) => a - b);

for (let i = 1; i < tiers.length; i++) {
  const lo = byTier.get(tiers[i - 1]);
  const hi = byTier.get(tiers[i]);
  if (hi.min <= lo.max) fail(`tier ${tiers[i]} bottoms out at ${hi.min.toFixed(1)} dps, not above tier ${tiers[i - 1]}'s top ${lo.max.toFixed(1)}.`);
}

//  A merge must always be an upgrade, never a doubling: 2 units become 1 at
//  dmgGrowth x, so dmgGrowth/2 is the board-power multiplier per merge.
if (CFG.STAR.max !== 5) fail(`CFG.STAR.max is ${CFG.STAR.max}; the game and its art are authored for 5.`);
if (!(CFG.STAR.dmgGrowth / 2 > 1)) fail(`CFG.STAR.dmgGrowth ${CFG.STAR.dmgGrowth} makes a merge a downgrade (needs > 2).`);

//  ----------------------------------------------------------------- stages

if (STAGES.length < 10) fail(`expected at least 10 stages, found ${STAGES.length}.`);

STAGES.forEach((st, i) => {
  const where = `stage ${st.stage || i + 1}`;
  if (!Array.isArray(st.waves) || st.waves.length < 1 || st.waves.length > 5) {
    fail(`${where}: needs 1..5 waves.`);
    return;
  }
  for (const w of st.waves) {
    for (const sp of w.spawns || []) {
      if (!ENEMIES[sp.enemy]) fail(`${where}: wave spawns unknown enemy "${sp.enemy}".`);
      if (!(sp.n > 0) || !(sp.everyMs > 0)) fail(`${where}: spawn group needs positive n and everyMs.`);
    }
  }
  if (st.boss && !BOSSES[st.boss]) fail(`${where}: unknown boss "${st.boss}".`);
  const n = st.stage || i + 1;
  if (n % CFG.STAGE.bossEveryN === 0 && !st.boss) fail(`${where}: every ${CFG.STAGE.bossEveryN}th stage must carry a boss.`);
});

//  ----------------------------------------------------------------- layout

//  Both orientations have to produce sane, non-overlapping zones.
for (const [vw, vh] of [[390, 844], [1280, 720]]) {
  configureLayout(vw, vh);
  const where = `layout ${vw}x${vh}`;
  const f = LAYOUT.field, b = LAYOUT.bench, m = LAYOUT.machine;
  if (!f || !b || !m) { fail(`${where}: zones missing.`); continue; }
  if (f.y < LAYOUT.hud.h) fail(`${where}: battlefield runs under the HUD.`);
  for (const [name, r] of [['field', f], ['bench', b], ['machine', m]]) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > LAYOUT.width || r.y + r.h > LAYOUT.height) {
      fail(`${where}: ${name} zone runs off the canvas.`);
    }
  }
  const overlap = !(f.x + f.w <= b.x || b.x + b.w <= f.x || f.y + f.h <= b.y || b.y + b.h <= f.y);
  if (overlap) fail(`${where}: battlefield and bench overlap.`);
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
    ...Object.keys(ENEMIES).map((id) => `en_${id}`),
    ...Object.keys(BOSSES).map((id) => `en_${id}`)
  ]);

  for (const key of Object.keys(manifest.sprites || {})) {
    if (!known.has(key)) fail(`the manifest ships ${key}, which matches no creature, enemy or boss.`);
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
