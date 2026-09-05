#!/usr/bin/env node
/**
 * Pull the OBJ/FBX/PNG/TTF/OGG sources ArenaDefense's models, sprites, fonts
 * and UI sound effects are built from into `art-src/` (gitignored).
 *
 * Every `.png .glb .gltf .fbx .ttf .ogg .mp3 .zip` under `/Shared`, `/saved`
 * and `Steal-A-Brainrot/assets` in this checkout is a 130-byte Git LFS
 * pointer (`git lfs` is not installed here, and the LFS batch API 403s), so
 * those files are downloaded instead from the branch's raw-media mirror:
 *
 *   https://media.githubusercontent.com/media/<owner>/<repo>/<branch>/<path>
 *
 * `.obj .mtl .vox .svg .bin .txt` are real files already, so for those (and
 * for any file whose local copy on disk turns out not to be an LFS pointer)
 * this just copies straight out of the monorepo checkout.
 *
 *   node scripts/fetch-sources.mjs [--force]
 *
 * `--force` re-fetches everything, ignoring files already present in
 * art-src/. Exits non-zero if any source ends up missing, empty, or still an
 * LFS pointer after the attempt.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(GAME_DIR, '..');
const ART_SRC = path.join(GAME_DIR, 'art-src');

const MEDIA_OWNER = 'JosephLiao542211';
const MEDIA_REPO = 'GGStudio';
const MEDIA_BRANCH = 'turret-defense';

const LFS_HEADER = 'version https://git-lfs.github.com/spec/v1';
/** Below this a "fetched" file is treated as an error page or empty pointer. */
const MIN_OK_BYTES = 200;

// ---------------------------------------------------------------------------
// What to fetch — every repo-relative path build-assets.mjs reads from
// art-src/. Combat SFX are not here: those come straight from
// zombie-motorworks/public/assets/audio, which are ordinary (non-LFS) blobs
// in this checkout already, so build-assets.mjs reads them directly.
// ---------------------------------------------------------------------------

const MANIFEST = [
  // Voxel zombies (Max Parata, CC BY-ND) — shambler + spitter small enemies.
  'Shared/voxel/characters/Package/OBJ/Zed_1.obj',
  'Shared/voxel/characters/Package/OBJ/Zed_1.mtl',
  'Shared/voxel/characters/Package/OBJ/Zed_1.png',
  'Shared/voxel/characters/Package/OBJ/Zed_3.obj',
  'Shared/voxel/characters/Package/OBJ/Zed_3.mtl',
  'Shared/voxel/characters/Package/OBJ/Zed_3.png',

  // Graveyard dressing (Max Parata, CC BY-ND).
  'Shared/voxel/env/Assets/SM-7-Fence.obj',
  'Shared/voxel/env/Assets/SM-7-Fence.mtl',
  'Shared/voxel/env/Assets/SM-7-Fence.png',
  'Shared/voxel/env/Assets/SM-8-Pillar.obj',
  'Shared/voxel/env/Assets/SM-8-Pillar.mtl',
  'Shared/voxel/env/Assets/SM-8-Pillar.png',
  'Shared/voxel/env/Assets/SM-3-Tomb1.obj',
  'Shared/voxel/env/Assets/SM-3-Tomb1.mtl',
  'Shared/voxel/env/Assets/SM-3-Tomb1.png',

  // Rocks (Quaternius, CC0) — flat diffuse colours, no textures.
  'Shared/Ultimate Stylized Nature - May 2022/OBJ/Rock_1.obj',
  'Shared/Ultimate Stylized Nature - May 2022/OBJ/Rock_1.mtl',
  'Shared/Ultimate Stylized Nature - May 2022/OBJ/Rock_2.obj',
  'Shared/Ultimate Stylized Nature - May 2022/OBJ/Rock_2.mtl',
  'Shared/Ultimate Stylized Nature - May 2022/OBJ/Rock_4.obj',
  'Shared/Ultimate Stylized Nature - May 2022/OBJ/Rock_4.mtl',

  // Props (unknown licence — see ASSET_LICENSES.md).
  'Shared/voxel/env/Buildings/Gun_03.fbx',
  'Shared/voxel/env/Buildings/Gun_02.fbx',
  'Shared/voxel/env/Buildings/AmmoBox_5.fbx',
  'Shared/voxel/env/Buildings/AttachedBoxes.fbx',
  'Shared/voxel/env/Buildings/Barricade_03.fbx',
  'Shared/voxel/env/Buildings/BarbedWires.fbx',
  'Shared/voxel/env/Buildings/Props_01_diffuse.png',
  'Shared/voxel/env/Buildings/Props_02_diffuse.png',
  'Shared/voxel/env/Buildings/VoxelApocalypse_Character.png',

  // Brainrot sprites (Steal-A-Brainrot character artwork — licence unknown).
  'Steal-A-Brainrot/assets/sprites/cr_patapim.png',
  'Steal-A-Brainrot/assets/sprites/cr_tungtung.png',
  'Steal-A-Brainrot/assets/sprites/cr_bombardiro.png',
  'Steal-A-Brainrot/assets/sprites/cr_tralalero.png',
  'Steal-A-Brainrot/assets/sprites/cr_assassino.png',
  'Steal-A-Brainrot/assets/sprites/cr_lirili.png',

  // Font (OFL 1.1).
  'Shared/Fonts/Lillita_One/LilitaOne-Regular.ttf',
  'Shared/Fonts/Lillita_One/OFL.txt',

  // UI SFX (lolurio, CC BY 4.0).
  'Shared/Sound/OGG/UI SFX_MENU_Scroll.ogg',
  'Shared/Sound/OGG/UI SFX_FEEDBACK_Positive.ogg',
  'Shared/Sound/OGG/UI SFX_FEEDBACK_Negative.ogg',
  'Shared/Sound/OGG/UI SFX_EXTRA_Quick Sub Descending.ogg',
  'Shared/Sound/OGG/UI SFX_FEEDBACK_Alert.ogg',
  'Shared/Sound/OGG/UI SFX_FEEDBACK_Woop.ogg',
  'Shared/Sound/LICENSE.txt',
];

function mediaUrl(relPath) {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `https://media.githubusercontent.com/media/${MEDIA_OWNER}/${MEDIA_REPO}/${MEDIA_BRANCH}/${encoded}`;
}

/** Read just enough of a file to tell an LFS pointer from real content. */
function readHead(filePath, n = 64) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(n);
    const bytesRead = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function isLfsPointer(filePath) {
  return readHead(filePath, LFS_HEADER.length).toString('utf8') === LFS_HEADER;
}

/** Node's fetch, falling back to `curl` if the proxy rejects a bare fetch. */
async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return;
  } catch (fetchError) {
    try {
      execFileSync('curl', ['-sSL', '-f', '-o', dest, url], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (curlError) {
      throw new Error(`fetch failed (${fetchError.message}) and curl failed (${curlError.message})`);
    }
  }
}

function fmtBytes(n) {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

async function fetchOne(rel, force) {
  const dest = path.join(ART_SRC, rel);

  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0 && !isLfsPointer(dest)) {
    return { rel, action: 'skip (exists)', size: fs.statSync(dest).size, ok: true };
  }

  // A real (non-LFS-pointer) local file is trusted at whatever size it is —
  // several of these (MTLs, the licence .txt) are legitimately under
  // MIN_OK_BYTES; that floor exists to catch a *download* landing on an
  // error page or an unresolved pointer, not to second-guess a file already
  // known to be genuine.
  const localPath = path.join(REPO_ROOT, rel);
  if (fs.existsSync(localPath) && !isLfsPointer(localPath)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(localPath, dest);
    const size = fs.statSync(dest).size;
    return { rel, action: 'copied (local)', size, ok: size > 0 };
  }

  try {
    await download(mediaUrl(rel), dest);
  } catch (error) {
    return { rel, action: `FAILED: ${error.message}`, size: 0, ok: false };
  }
  if (!fs.existsSync(dest)) return { rel, action: 'FAILED: no file written', size: 0, ok: false };
  const size = fs.statSync(dest).size;
  if (size <= MIN_OK_BYTES) return { rel, action: 'FAILED: too small', size, ok: false };
  if (isLfsPointer(dest)) return { rel, action: 'FAILED: still an LFS pointer', size, ok: false };
  return { rel, action: 'downloaded', size, ok: true };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const force = args.has('--force');

  const rows = [];
  for (const rel of MANIFEST) {
    rows.push(await fetchOne(rel, force));
  }

  const nameWidth = Math.min(64, Math.max(...rows.map((r) => r.rel.length)));
  console.log(`\n${'source'.padEnd(nameWidth)}  action           size`);
  console.log('-'.repeat(nameWidth + 28));
  for (const row of rows) {
    const mark = row.ok ? ' ' : '!';
    console.log(
      `${mark}${row.rel.padEnd(nameWidth)}  ${row.action.padEnd(16)} ${fmtBytes(row.size).padStart(9)}`,
    );
  }

  const failed = rows.filter((r) => !r.ok);
  const totalBytes = rows.reduce((sum, r) => sum + r.size, 0);
  console.log(`\n${rows.length} sources, ${failed.length} failed, ${fmtBytes(totalBytes)} total in art-src/`);

  if (failed.length > 0) {
    console.error(`\n${failed.length} source(s) missing or invalid:`);
    for (const row of failed) console.error(`  ${row.rel}: ${row.action}`);
    process.exitCode = 1;
  }
}

await main();
