import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Keeps the art contact sheets out of shipped builds.
 *
 * `public/review/` holds the roster and boss sheets used to eyeball the art
 * between passes. It lives under `public/` because a plain `vite dev` is the
 * easiest way to look at it, which also means Vite copies all eight megabytes
 * of it into every build. Nothing in `src/` references it, so a portal upload
 * would be shipping a folder no player can reach.
 */
const DEV_ONLY_DIRS = ['review'];

export function dropDevArt(): Plugin {
  let outDir = 'dist';

  return {
    name: 'merge-ninja:drop-dev-art',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      for (const dir of DEV_ONLY_DIRS) {
        await rm(path.join(outDir, dir), { recursive: true, force: true });
      }
    },
  };
}
