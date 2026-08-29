// Maps a downloaded character pack onto this game's texture keys.
//
//   node tools/import-models.mjs "D:/packs/italian-brainrot"        # dry run
//   node tools/import-models.mjs "D:/packs/italian-brainrot" --apply
//
// Packs name their files whatever they like ("Tralalero Tralala.fbx",
// "bombardiro_crocodilo/model.glb"). This matches each one against the creature
// list by name and copies it to art/models/<textureKey>/, bringing any sibling
// texture images with it — an FBX with external maps breaks if you move the
// model away from them.
//
// Nothing is copied without --apply. Review the mapping first: fuzzy matching
// on 18 similar-sounding names gets things wrong, and --map fixes the ones it
// missed.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DEST = join(ROOT, 'art', 'models');

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');
const mapArg = args.find((a) => a.startsWith('--map='));

if (!src || !existsSync(src)) {
  console.error('usage: node tools/import-models.mjs <pack directory> [--apply] [--map=file.fbx:cr_vacca,...]');
  process.exit(1);
}

const MODEL_EXT = new Set(['.glb', '.gltf', '.fbx', '.obj']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.tga', '.bmp', '.webp']);

// ---- the keys we can fill, and the words that identify each ----
const creatures = JSON.parse(
  // read the creature list without running the browser file
  (() => {
    const js = readFileSync(join(ROOT, 'src', 'data', 'creatures.js'), 'utf8');
    const ids = [...js.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)];
    return JSON.stringify(ids.map(([, id, name]) => ({ id, name })));
  })()
);

const targets = [
  ...creatures.map((c) => ({ key: `cr_${c.id}`, words: norm(`${c.name} ${c.id}`) })),
  { key: 'player', words: norm('player hero kid character') },
  ...[0, 1, 2, 3, 4].map((i) => ({ key: `tex_bot${i}`, words: norm(`bot${i} rival${i}`) })),
];

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

// ---- collect candidate model files, recursively ----
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (MODEL_EXT.has(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const files = walk(resolve(src));
if (files.length === 0) { console.error(`No .glb/.fbx/.obj under ${src}`); process.exit(1); }

// ---- score a file against each key ----
// A pack often puts the character name on the folder ("Tralalero/model.fbx"),
// so the parent folder counts as much as the filename.
function score(file, t) {
  const hay = norm(`${basename(dirname(file))} ${basename(file, extname(file))}`);
  if (hay.length === 0) return 0;
  let hits = 0;
  for (const w of t.words) {
    if (w.length < 3) continue;
    if (hay.some((h) => h === w || h.includes(w) || w.includes(h))) hits++;
  }
  const joined = hay.join('');
  const full = t.words.join('');
  if (joined.includes(full) || full.includes(joined)) hits += 2;
  return hits / Math.max(t.words.filter((w) => w.length >= 3).length, 1);
}

const overrides = new Map();
if (mapArg) {
  for (const pair of mapArg.slice('--map='.length).split(',')) {
    const [f, k] = pair.split(':');
    if (f && k) overrides.set(f.trim().toLowerCase(), k.trim());
  }
}

const taken = new Set();
const plan = [];
// Best matches first, so a strong match claims its key before a weak one can.
const scored = [];
for (const f of files) {
  for (const t of targets) scored.push({ f, key: t.key, s: score(f, t) });
}
scored.sort((a, b) => b.s - a.s);

const assigned = new Map();
for (const { f, key, s } of scored) {
  if (s < 0.5) continue;
  if (assigned.has(f) || taken.has(key)) continue;
  assigned.set(f, key);
  taken.add(key);
}
for (const f of files) {
  const ov = overrides.get(basename(f).toLowerCase());
  if (ov) { assigned.set(f, ov); taken.add(ov); }
}

for (const f of files) plan.push({ file: f, key: assigned.get(f) || null });

// ---- report ----
const matched = plan.filter((p) => p.key);
const missed = plan.filter((p) => !p.key);
const unfilled = targets.filter((t) => !taken.has(t.key));

console.log(`\n${matched.length} of ${files.length} model files matched a texture key:\n`);
for (const p of matched) console.log(`  ${p.key.padEnd(18)} <- ${p.file.replace(resolve(src), '').replace(/^[\\/]/, '')}`);
if (missed.length) {
  console.log(`\n${missed.length} unmatched — pass --map=<filename>:<key> for each one you want:\n`);
  for (const p of missed) console.log(`  ?                  <- ${p.file.replace(resolve(src), '').replace(/^[\\/]/, '')}`);
}
if (unfilled.length) console.log(`\nStill on placeholders: ${unfilled.map((t) => t.key).join(', ')}`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to copy these into art/models/.');
  process.exit(0);
}

// ---- copy: model plus the images sitting beside it ----
let copied = 0;
for (const p of matched) {
  const dir = join(DEST, p.key);
  mkdirSync(dir, { recursive: true });
  copyFileSync(p.file, join(dir, `model${extname(p.file)}`));
  for (const e of readdirSync(dirname(p.file), { withFileTypes: true })) {
    if (e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase())) {
      const from = join(dirname(p.file), e.name);
      if (statSync(from).size < 64 * 1024 * 1024) copyFileSync(from, join(dir, e.name));
    }
  }
  copied++;
}
console.log(`\nCopied ${copied} into art/models/. Next: node tools/render-art.mjs`);
