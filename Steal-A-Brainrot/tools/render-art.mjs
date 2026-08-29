// Renders every model in art/models/ to a game sprite and writes the manifest
// the game boots from.
//
//   node tools/render-art.mjs                 # render everything that changed
//   node tools/render-art.mjs --force         # re-render everything
//   node tools/render-art.mjs --only=tralalero,vacca
//   node tools/render-art.mjs --turntable=tralalero
//
// Input:  art/models/<textureKey>.glb|fbx|obj   e.g. art/models/cr_tralalero.glb
// Output: assets/sprites/<textureKey>.png  +  assets/manifest.json
//
// A model file is optional for every key. Whatever is missing keeps its
// procedural placeholder, so this can be run after each character lands
// instead of once at the end.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MODELS = join(ROOT, 'art', 'models');
const OUT = join(ROOT, 'assets', 'sprites');
const MANIFEST = join(ROOT, 'assets', 'manifest.json');
const SETTINGS = join(ROOT, 'art', 'models.json');

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

const BLENDER = process.env.BLENDER || [
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
  '/usr/bin/blender',
].find((p) => existsSync(p));

if (!BLENDER) {
  console.error('Blender not found. Set BLENDER=<path to blender executable>.');
  process.exit(1);
}
if (!existsSync(MODELS)) {
  console.error(`No models directory at ${MODELS}\nDrop <textureKey>.glb files there first.`);
  process.exit(1);
}

// Per-model overrides — mostly yaw, because every model faces a different way.
// { "cr_tralalero": { "yaw": 180, "pitch": 20, "outline": 0.012 } }
const settings = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, 'utf8')) : {};

const MODEL_EXT = new Set(['.glb', '.gltf', '.fbx', '.obj']);

// Two accepted layouts: a bare file named after the key, or a folder named
// after the key holding the model and its texture maps. import-models.mjs
// writes the second, because an FBX with external maps has to travel with them.
const models = [];
for (const e of readdirSync(MODELS, { withFileTypes: true })) {
  if (e.isFile() && MODEL_EXT.has(extname(e.name).toLowerCase())) {
    models.push({ key: basename(e.name, extname(e.name)), file: join(MODELS, e.name) });
  } else if (e.isDirectory()) {
    const inner = readdirSync(join(MODELS, e.name))
      .filter((f) => MODEL_EXT.has(extname(f).toLowerCase()))
      .sort();
    if (inner.length) models.push({ key: e.name, file: join(MODELS, e.name, inner[0]) });
  }
}

if (models.length === 0) {
  console.error(`No models in ${MODELS}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

function render(key, file, extra = {}) {
  const opts = { ...(settings[key] || {}), ...extra };
  const argv = [
    '-b', '--factory-startup', '--python', join(ROOT, 'tools', 'render-creature.py'), '--',
    `model=${file.split('\\').join('/')}`,
    `out=${opts.out.split('\\').join('/')}`,
    ...Object.entries(opts)
      .filter(([k]) => k !== 'out')
      .map(([k, v]) => `${k}=${v}`),
  ];
  const log = execFileSync(BLENDER, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const line = log.split('\n').find((l) => l.startsWith('RENDER_DONE') || l.startsWith('TURNTABLE_DONE'));
  if (!line) throw new Error(`render failed for ${key}\n${log.slice(-800)}`);
  return line.trim();
}

// A turntable is how you find an unknown model's facing: 8 views, pick the one
// that looks right, put its yaw in art/models.json.
const turntable = flag('turntable');
if (turntable) {
  const m = models.find((x) => x.key === turntable || x.key === `cr_${turntable}`);
  if (!m) { console.error(`No model named ${turntable} in art/models/`); process.exit(1); }
  const dir = join(ROOT, 'art', 'turntable', m.key);
  mkdirSync(dir, { recursive: true });
  console.log(render(m.key, m.file, { out: `${dir}/`, turntable: 1 }));
  console.log(`8 views in art/turntable/${m.key}/ — put the best yaw in art/models.json`);
  process.exit(0);
}

const only = flag('only');
const wanted = only && only !== true ? new Set(String(only).split(',').map((s) => s.trim())) : null;
const force = !!flag('force');

let rendered = 0;
const sprites = {};
for (const m of models) {
  const out = join(OUT, `${m.key}.png`);
  const selected = !wanted || wanted.has(m.key) || wanted.has(m.key.replace(/^cr_/, ''));
  const stale = !existsSync(out) || statSync(m.file).mtimeMs > statSync(out).mtimeMs;
  if (selected && (force || stale)) {
    process.stdout.write(`${m.key} ... `);
    console.log(render(m.key, m.file, { out }));
    rendered++;
  }
  if (existsSync(out)) sprites[m.key] = `sprites/${m.key}.png`;
}

writeFileSync(MANIFEST, `${JSON.stringify({ base: 'assets/', sprites }, null, 2)}\n`);
console.log(`\n${rendered} rendered, ${Object.keys(sprites).length} sprites in the manifest.`);
console.log(`Wrote ${MANIFEST.replace(ROOT, '.')}`);
