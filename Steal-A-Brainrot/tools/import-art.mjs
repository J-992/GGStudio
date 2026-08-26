// Turns the character artwork in art/source/ into game sprites.
//
//   node tools/import-art.mjs            # match filenames to creatures, dry run
//   node tools/import-art.mjs --apply    # crop, scale, ground, write manifest
//   node tools/import-art.mjs --apply --only=tralalero,vacca
//
// Source images are matched to creatures by filename, so `tralalero-tralala.png`
// finds Tralalero Tralala. Anything unmatched is listed rather than guessed at;
// fix those with --map=<filename>:<key>.
//
// This is the 2D path. Its 3D sibling is render-art.mjs, which takes models in
// art/models/ instead; both write assets/sprites/ and assets/manifest.json, so
// a game can use either or mix them.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'art', 'source');
const OUT = join(ROOT, 'assets', 'sprites');
const MANIFEST = join(ROOT, 'assets', 'manifest.json');

const args = process.argv.slice(2);
const flag = (n) => {
  const hit = args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  return hit ? (hit.includes('=') ? hit.split('=').slice(1).join('=') : true) : null;
};

// Rebuild the manifest from whatever is already in assets/sprites/, without
// touching the sprites. Use it after adding a sprite by any other route.
function writeManifest() {
  const sprites = {};
  for (const f of readdirSync(OUT)) {
    if (extname(f).toLowerCase() === '.png') sprites[basename(f, '.png')] = `sprites/${f}`;
  }
  writeFileSync(MANIFEST, `${JSON.stringify({ base: 'assets/', sprites }, null, 2)}\n`);
  return sprites;
}

if (flag('manifest')) {
  const s = writeManifest();
  console.log(`manifest rewritten: ${Object.keys(s).length} sprites`);
  process.exit(0);
}

const BLENDER = process.env.BLENDER || [
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
  '/usr/bin/blender',
].find((p) => existsSync(p));

if (!BLENDER) { console.error('Blender not found. Set BLENDER=<path>.'); process.exit(1); }
if (!existsSync(SRC)) { console.error(`No art/source/ directory. Put character PNGs there.`); process.exit(1); }

// ---- what we can fill ----
const creatures = [...readFileSync(join(ROOT, 'src', 'data', 'creatures.js'), 'utf8')
  .matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)]
  .map(([, id, name]) => ({ id, name }));

const targets = [
  ...creatures.map((c) => ({ key: `cr_${c.id}`, words: norm(`${c.name} ${c.id}`) })),
  { key: 'player', words: norm('player hero kid') },
  ...[0, 1, 2, 3, 4].map((i) => ({ key: `tex_bot${i}`, words: norm(`bot${i}`) })),
];

function norm(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // Lirilì -> lirili
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

const IMG_EXT = new Set(['.png', '.webp', '.jpg', '.jpeg']);
const files = readdirSync(SRC).filter((f) => IMG_EXT.has(extname(f).toLowerCase()));
if (!files.length) { console.error(`No images in ${SRC}`); process.exit(1); }

// ---- score filename against each key ----
// Names in this cast rhyme heavily ("trippi troppi" / "troppa trippa"), so a
// token has to match a whole token, not merely appear inside one.
function score(file, t) {
  const hay = norm(basename(file, extname(file)));
  const words = t.words.filter((w) => w.length >= 3);
  if (!words.length || !hay.length) return 0;
  let hits = 0;
  for (const w of words) if (hay.includes(w)) hits++;
  const joined = hay.join('');
  const full = words.join('');
  if (joined === full) hits += 3;
  else if (joined.startsWith(full) || full.startsWith(joined)) hits += 1;
  return hits / words.length;
}

const overrides = new Map();
const mapArg = flag('map');
if (mapArg && mapArg !== true) {
  for (const pair of String(mapArg).split(',')) {
    const [f, k] = pair.split(':');
    if (f && k) overrides.set(f.trim().toLowerCase(), k.trim());
  }
}

const scored = [];
for (const f of files) for (const t of targets) scored.push({ f, key: t.key, s: score(f, t) });
scored.sort((a, b) => b.s - a.s);

const assigned = new Map();
const taken = new Set();
for (const { f, key, s } of scored) {
  if (s < 0.6 || assigned.has(f) || taken.has(key)) continue;
  assigned.set(f, key);
  taken.add(key);
}
for (const f of files) {
  const ov = overrides.get(f.toLowerCase());
  if (ov) { assigned.set(f, ov); taken.add(ov); }
}

const only = flag('only');
const wanted = only && only !== true
  ? new Set(String(only).split(',').map((s) => (s.startsWith('cr_') || s.startsWith('tex_') || s === 'player' ? s : `cr_${s}`)))
  : null;

const matched = files.filter((f) => assigned.has(f) && (!wanted || wanted.has(assigned.get(f))));
const missed = files.filter((f) => !assigned.has(f));
const unfilled = targets.filter((t) => !taken.has(t.key));

console.log(`\n${assigned.size} of ${files.length} images matched a creature:\n`);
for (const f of files) if (assigned.has(f)) console.log(`  ${assigned.get(f).padEnd(16)} <- ${f}`);
if (missed.length) {
  console.log(`\n${missed.length} unmatched (use --map=<file>:<key>):`);
  for (const f of missed) console.log(`  ?                <- ${f}`);
}
if (unfilled.length) console.log(`\nStill on placeholders: ${unfilled.map((t) => t.key).join(', ')}`);

if (!flag('apply')) {
  console.log('\nDry run. Re-run with --apply to build the sprites.');
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const jobs = matched.map((f) => ({ src: join(SRC, f), dest: join(OUT, `${assigned.get(f)}.png`) }));
const jobFile = join(tmpdir(), `sab-import-${process.pid}.json`);
writeFileSync(jobFile, JSON.stringify(jobs));

const log = execFileSync(BLENDER, [
  '-b', '--factory-startup', '--python', join(ROOT, 'tools', 'import-images.py'), '--',
  `jobs=${jobFile.split('\\').join('/')}`,
  `size=${flag('size') || 352}`,
], { encoding: 'utf8' });

for (const l of log.split('\n')) if (l.startsWith('IMPORTED')) console.log(`  ${l.trim()}`);
if (!log.includes('IMPORT_DONE')) { console.error(log.slice(-1500)); process.exit(1); }

// keeps sprites produced by the other routes too
const sprites = writeManifest();
console.log(`\n${jobs.length} sprites built, ${Object.keys(sprites).length} in the manifest.`);
