/**
 * Enforces the shipped size budget for the Poki build.
 *
 * Walks `dist/`, gzips every file the way a browser (and Poki's CDN) would
 * transfer it, and fails loudly if the total is over budget rather than
 * letting a slow-loading regression reach a review queue.
 *
 *   node scripts/budget.mjs
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(import.meta.dirname, '..', 'dist');

/** 1.5 MiB, matching the plan's budget and `poki.json`'s headroom below it. */
export const BUDGET_BYTES = 1572864;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function bytes(n) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * @param {string} dist Path to a Vite build output directory.
 * @returns {{ ok: boolean, total: number, files: { path: string, gz: number }[] }}
 */
export function budget(dist = DIST) {
  let files;
  try {
    files = walk(dist);
  } catch {
    return { ok: false, total: 0, files: [] };
  }

  const sized = files.map((file) => ({
    path: relative(dist, file),
    gz: gzipSync(readFileSync(file), { level: 9 }).length,
  }));

  const total = sized.reduce((sum, f) => sum + f.gz, 0);

  return { ok: total <= BUDGET_BYTES, total, files: sized };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = budget();

  if (result.files.length === 0) {
    console.error(`\n  FAIL  ${relative(process.cwd(), DIST)}/ is missing or empty — run the build first.\n`);
    process.exit(1);
  }

  const top = [...result.files].sort((a, b) => b.gz - a.gz).slice(0, 8);

  console.log(`\n  budget  ${bytes(result.total)} gz / ${bytes(BUDGET_BYTES)} budget\n`);
  for (const f of top) {
    console.log(`    ${bytes(f.gz).padStart(9)}  ${f.path}`);
  }
  console.log('');

  if (!result.ok) {
    console.error(`  FAIL  ${bytes(result.total)} gz is over the ${bytes(BUDGET_BYTES)} budget.\n`);
    process.exit(1);
  }

  console.log('  OK — within budget.\n');
}
