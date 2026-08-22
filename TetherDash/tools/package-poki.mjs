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
 * path for uploading by hand through the dashboard, and for seeing what the
 * pipeline would say before pushing.
 */

import { execFileSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { readGame } from '../../scripts/poki/config.mjs';
import { bytes, preflight } from '../../scripts/poki/preflight.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ZIP = join(ROOT, 'tether-dash-poki.zip');

const game = readGame(join(ROOT, 'poki.json'));

console.log(`\n  preflight  ${game.id}  (${game.buildDir})\n`);

const result = preflight(game);

for (const failure of result.failures) console.error(`\n  FAIL  ${failure}`);

if (!result.ok) {
  console.error('\n  Not packaging: fix the failures above first.\n');
  process.exit(1);
}

rmSync(ZIP, { force: true });

try {
  //  `-X` drops the resource forks and finder metadata macOS otherwise buries
  //  in the archive; the paths are relative to dist/ so index.html lands at the
  //  root of the zip, which is where Poki looks for it.
  execFileSync('zip', ['-r', '-q', '-X', ZIP, '.', '-x', '.DS_Store'], { cwd: resolve(game.buildPath) });
} catch {
  console.error(`\n  FAIL  \`zip\` is not available -- archive ${game.buildDir}/ yourself with index.html at the root.\n`);
  process.exit(1);
}

console.log(`\n  Ready to upload: ${relative(ROOT, ZIP)}  (${bytes(statSync(ZIP).size)})\n`);
