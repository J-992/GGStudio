/**
 * Refuses to upload a build that Poki would reject.
 *
 * Poki unpacks the archive onto a path of their choosing and serves it from
 * their own domain, so the two things that reliably break a submission are an
 * absolute URL (which resolves against their host, not the game) and a request
 * to a third-party origin (their sandbox blocks it). Both are cheap to catch
 * here and expensive to discover a week later in a review queue.
 *
 *   node scripts/poki/preflight.mjs
 */

import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { readGame } from "./config.mjs";

/** Files worth scanning for URLs. A PNG cannot make a request. */
const TEXT = /\.(html|js|mjs|cjs|css|json|svg|map|txt|xml)$/i;

export function bytes(n) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function preflight(game, log = console.log) {
  const dist = resolve(game.buildPath);
  const failures = [];
  const fail = (m) => failures.push(m);

  let files;
  try {
    files = walk(dist);
  } catch {
    return {
      ok: false,
      failures: [`${game.buildDir}/ is missing — the build did not run, or it writes somewhere else.`],
      raw: 0, compressed: 0, files: [],
    };
  }
  if (files.length === 0) {
    return { ok: false, failures: [`${game.buildDir}/ is empty.`], raw: 0, compressed: 0, files: [] };
  }

  // --- index.html --------------------------------------------------------
  const index = files.find((f) => relative(dist, f) === "index.html");
  if (!index) {
    fail(`${game.buildDir}/index.html is missing; Poki needs it at the root of the archive.`);
  } else {
    const html = readFileSync(index, "utf8");
    for (const m of html.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g)) {
      fail(`index.html points at the absolute path ${m[1]} — it must be relative ("./..."). Set \`base: './'\` in vite.config.ts.`);
    }
    if (game.requireSdk && !html.includes("game-cdn.poki.com") && !files.some((f) => /\.js$/.test(f) && readFileSync(f, "utf8").includes("game-cdn.poki.com"))) {
      fail("Nothing in the build references the Poki SDK; this is a build made for some other platform.");
    }
  }

  // --- third-party origins ----------------------------------------------
  const ignored = game.ignoredOrigins.map((p) => new RegExp(p, "i"));
  for (const file of files) {
    if (!TEXT.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/https?:\/\/[a-z0-9.-]+/gi)) {
      const origin = m[0];
      if (game.allowedOrigins.includes(origin)) continue;
      const host = origin.replace(/^https?:\/\//i, "");
      if (ignored.some((re) => re.test(host))) continue;
      fail(`${relative(dist, file)} references ${origin}; a Poki build may only reach ${game.allowedOrigins.join(", ")}. Add it to "ggs.ignore_origins" in poki.json if nothing fetches it.`);
    }
  }

  // --- size --------------------------------------------------------------
  let raw = 0;
  let compressed = 0;
  for (const file of files) {
    raw += statSync(file).size;
    compressed += gzipSync(readFileSync(file)).length;
  }
  if (compressed > game.maxBytes) {
    fail(`initial download is ${bytes(compressed)} gzipped, over the ${bytes(game.maxBytes)} this game allows itself.`);
  }

  log(`  ${files.length} files · ${bytes(raw)} raw · ${bytes(compressed)} gzipped`);
  return { ok: failures.length === 0, failures, raw, compressed, files };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const game = readGame(process.argv[2] ?? "poki.json");
  const r = preflight(game);
  for (const f of r.failures) console.error(`\n  FAIL  ${f}`);
  console.log(r.ok ? "\n  preflight passed\n" : "");
  process.exit(r.ok ? 0 : 1);
}
