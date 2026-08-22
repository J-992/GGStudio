/**
 * CI gate: boots every script against a stub Phaser (catches syntax errors and
 * moved globals), then compiles all 15 levels through the real Course builder
 * and checks the things a player would otherwise find:
 *   - every gap along the center route is jumpable at that level's speed
 *   - every gate leaves at least one opening wide enough to fit through
 *   - checkpoints and the finish line actually sit on solid ground
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const ROOT = resolve(import.meta.dirname, '..');
const failures = [];
const fail = (m) => failures.push(m);

// ---- load order comes from index.html, same as the browser ----
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const sources = [...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g)].map((m) => m[1]);
if (sources.length === 0) fail('index.html lists no src/ script tags.');

// ---- stub Phaser: just enough for top-level execution ----
const captured = {};
const sandbox = {
  console, setTimeout, Date, Math, JSON, Object, Promise,
  location: { hostname: 'example.com', search: '' },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { addEventListener() {}, getElementById: () => null, createElement: () => ({ style: {}, appendChild() {} }) },
  Phaser: {
    AUTO: 0,
    Scene: class { constructor(key) { this.key = key; } },
    Game: class { constructor(config) { captured.config = config; } },
    Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
    Math: { Clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)), Between: () => 0 },
    Input: { Keyboard: { KeyCodes: new Proxy({}, { get: () => 0 }), JustDown: () => false } },
    Display: {
      Color: {
        IntegerToColor: (c) => ({
          red: (c >> 16) & 255, green: (c >> 8) & 255, blue: c & 255,
          brighten() { return { color: c }; }
        }),
        GetColor: (r, g, b) => (r << 16) | (g << 8) | b
      }
    },
    Geom: { Rectangle: class {} }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const context = createContext(sandbox);

for (const file of sources) {
  try {
    runInContext(readFileSync(join(ROOT, file), 'utf8'), context, { filename: file });
  } catch (err) {
    fail(`${file} does not load: ${err.message}`);
  }
}
await new Promise((r) => setTimeout(r, 0));
if (!captured.config) fail('no Phaser.Game was constructed -- main.js did not boot the game.');

let data = {};
try {
  data = runInContext('({ LEVELS, CFG, Course })', context);
} catch (err) {
  if (failures.length === 0) fail(`globals unreadable: ${err.message}`);
}
const { LEVELS, CFG, Course } = data;

// ---- level validation through the real builder ----
if (LEVELS && CFG && Course) {
  if (LEVELS.length !== 15) fail(`expected 15 levels, found ${LEVELS.length}.`);
  for (const lv of LEVELS) {
    const where = `level ${lv.id} (${lv.name})`;
    let course;
    try {
      course = Course.build(lv);
    } catch (err) {
      fail(`${where}: Course.build threw: ${err.message}`);
      continue;
    }
    if (course.platforms.length === 0) { fail(`${where}: no platforms.`); continue; }

    // union of platform z-coverage -> find the gaps (any lateral position counts:
    // moving platforms swing, so sample their full range)
    const spans = course.platforms
      .map((p) => [p.z0, p.z1])
      .sort((a, b) => a[0] - b[0]);
    let coveredTo = spans[0][0];
    if (coveredTo > 0.5) fail(`${where}: course starts at z=${coveredTo}, players spawn at z=2.`);
    // a full jump: airtime 2*JUMP_VEL/GRAVITY at this level's run speed
    const maxJump = 2 * CFG.JUMP_VEL / CFG.GRAVITY * CFG.RUN_SPEED * lv.speed;
    for (const [z0, z1] of spans) {
      if (z0 > coveredTo) {
        const gap = z0 - coveredTo;
        // pads before a gap earn extra reach
        const pad = course.pads.some((p) => p.z < coveredTo && p.z > coveredTo - 8);
        const reach = pad ? maxJump * 1.8 : maxJump;
        if (gap > reach - 0.8) {
          fail(`${where}: gap of ${gap.toFixed(1)} at z=${coveredTo.toFixed(1)} exceeds jump reach ${reach.toFixed(1)}.`);
        }
      }
      coveredTo = Math.max(coveredTo, z1);
    }
    if (course.finishZ > coveredTo) fail(`${where}: finish line beyond last platform.`);

    for (const gz of course.checkpoints) {
      if (!course.groundAt(0, gz, 0)) fail(`${where}: checkpoint at z=${gz} is not over ground.`);
    }
    for (const gate of course.gatesInfo) {
      if (!gate.openings.some((o) => o.w >= 1.2)) fail(`${where}: gate at z=${gate.z} has no opening wide enough.`);
    }
    for (const b of course.bolts) {
      if (b.y > 2.2) fail(`${where}: bolt at z=${b.z.toFixed(1)} floats too high to collect (y=${b.y}).`);
    }
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`\n  FAIL  ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`\n  OK -- ${sources.length} scripts boot, ${LEVELS.length} levels validate.\n`);
