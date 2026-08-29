/**
 * Turns `dist/` into the zip Poki wants, and refuses to do it if the build
 * would fail their technical review.
 *
 * The checks are not here. They live in `scripts/poki/preflight.mjs` at the
 * repo root, because the same mistakes end a submission for every game in this
 * monorepo and a second copy of the rules is a copy that drifts. What is left
 * here is the packaging: an archive with `index.html` at its root, which is
 * where Poki looks for it.
 *
 * CI does not use this script -- `@poki/cli` makes its own archive. This is the
 * path for uploading by hand through the dashboard.
 *
 * Two archivers, because this repo is developed on Windows where Git Bash has
 * no `zip`. The PowerShell fallback names every entry itself rather than
 * calling `Compress-Archive` or `ZipFile.CreateFromDirectory`: both of those
 * write entry paths with the platform separator, so on Windows you get
 * "assets\sprites\x.png" -- which the zip spec says is a FILENAME containing
 * backslashes, not a directory. Poki unpacks that into a flat folder of
 * oddly-named files and reports a missing index.html. Verified here: the
 * CreateFromDirectory version produced 28 such entries.
 *
 * Whichever ran, the result is opened and checked before it is handed over.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { readGame } from '../../scripts/poki/config.mjs';
import { bytes, preflight } from '../../scripts/poki/preflight.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ZIP = join(ROOT, 'brainrot-factory-poki.zip');

const game = readGame(join(ROOT, 'poki.json'));
const dist = resolve(game.buildPath);

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`\n  FAIL  ${game.buildDir}/index.html does not exist -- run \`npm run build:poki\` first.\n`);
  process.exit(1);
}

console.log(`\n  preflight  ${game.id}  (${game.buildDir})\n`);

const result = preflight(game);

for (const failure of result.failures) console.error(`\n  FAIL  ${failure}`);

if (!result.ok) {
  console.error('\n  Not packaging: fix the failures above first.\n');
  process.exit(1);
}

rmSync(ZIP, { force: true });

function haveZip() {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
}

function psFile(script) {
  const file = join(tmpdir(), `sab-zip-${process.pid}.ps1`);
  writeFileSync(file, script, 'utf8');
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' });
  } finally {
    rmSync(file, { force: true });
  }
}

if (haveZip()) {
  //  `-X` drops the resource forks and finder metadata macOS otherwise buries
  //  in the archive; the paths are relative to dist/ so index.html lands at the
  //  root of the zip, which is where Poki looks for it.
  execFileSync('zip', ['-r', '-q', '-X', ZIP, '.', '-x', '.DS_Store'], { cwd: dist });
} else {
  try {
    //  Open an empty archive and add each file under a name we choose, so the
    //  separator is a forward slash on every platform.
    //
    //  Via a script file, not -Command: the body has braces, pipelines and a
    //  method call spanning lines, and every way of flattening that into one
    //  argument is a new quoting bug.
    psFile([
      `$ErrorActionPreference = 'Stop'`,
      `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
      `$src = '${dist}'`,
      `$zip = [System.IO.Compression.ZipFile]::Open('${ZIP}', 'Create')`,
      `Get-ChildItem -Path $src -Recurse -File | ForEach-Object {`,
      `    $rel = $_.FullName.Substring($src.Length + 1).Replace('\\', '/')`,
      `    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)`,
      `}`,
      `$zip.Dispose()`
    ].join('\n'));
  } catch (err) {
    console.error(`\n  FAIL  no \`zip\` and PowerShell could not archive it either: ${err.message}`);
    console.error(`        Archive ${game.buildDir}/ yourself, with index.html at the root of the zip.\n`);
    process.exit(1);
  }
}

//  ---------------------------------------------------------------- verify

//  A zip that unpacks to the wrong shape fails Poki's upload with a message
//  about a missing index.html, which is a long way from the cause. Read the
//  entry names back out and check them here instead.
let entries = [];

try {
  const out = ps(`Add-Type -AssemblyName System.IO.Compression.FileSystem; `
    + `$z=[System.IO.Compression.ZipFile]::OpenRead('${ZIP.split('\\').join('\\\\')}'); `
    + `$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose()`);
  entries = out.split('\n').map((s) => s.trim()).filter(Boolean);
} catch {
  console.log('\n  (could not read the archive back to verify it; check it by hand)');
}

if (entries.length > 0) {
  if (!entries.includes('index.html')) {
    console.error(`\n  FAIL  index.html is not at the root of the zip. Found: ${entries.slice(0, 5).join(', ')}\n`);
    process.exit(1);
  }

  const backslashed = entries.filter((e) => e.includes('\\'));

  if (backslashed.length > 0) {
    console.error(`\n  FAIL  ${backslashed.length} entries use backslash separators, e.g. ${backslashed[0]}`);
    console.error('        Poki will not find the files inside those "directories".\n');
    process.exit(1);
  }
}

console.log(`\n  Ready to upload: ${relative(ROOT, ZIP)}  (${bytes(statSync(ZIP).size)}, ${entries.length} entries)\n`);
console.log(`  Game Title:      Brainrot Factory\n`);
