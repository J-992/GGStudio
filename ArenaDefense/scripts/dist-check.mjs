/**
 * Runs the repo's Poki preflight against ArenaDefense's own `dist/`.
 *
 * A thin wrapper so `npm run check` can call one script per game rather than
 * every game's `check` reaching up into `../../scripts/poki` with its own
 * argv-parsing copy-paste. See `../../scripts/poki/preflight.mjs` for what it
 * actually verifies (relative paths, allowed origins, no LFS pointers, size).
 *
 *   node scripts/dist-check.mjs
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readGame } from '../../scripts/poki/config.mjs';
import { preflight } from '../../scripts/poki/preflight.mjs';

const GAME_DIR = resolve(import.meta.dirname, '..');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const game = readGame(resolve(GAME_DIR, 'poki.json'));

  console.log(`\n  dist-check  ${game.id}  (${game.buildPath})\n`);

  const result = preflight(game);

  for (const failure of result.failures) {
    console.error(`\n  FAIL  ${failure}`);
  }

  if (!result.ok) {
    console.error('\n  Not uploading: fix the failures above first.\n');
    process.exit(1);
  }

  console.log('\n  OK — this build is shaped like something Poki will accept.\n');
}
