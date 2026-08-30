#!/usr/bin/env node
/**
 * Serves `dist/` the way Poki does, which is not the way any local server does.
 *
 * Poki iframes a build at `https://games.poki.com/<gameId>/<buildId>?tag=...`:
 * nested two directories deep, and with **no trailing slash** on the document
 * URL. Per RFC 3986 the base for a document-relative reference is everything
 * up to the last `/`, so under that URL a plain `./assets/x` resolves to
 * `/<gameId>/assets/x` - the build directory is silently dropped and every
 * single asset 404s.
 *
 * `vite preview` serves from a root path and issues a redirect to add a
 * trailing slash, so it hides this completely: a build can pass every local
 * check, boot perfectly at `localhost:4173`, and still sit frozen on its
 * loading screen the moment Poki serves it. That is exactly what happened to
 * the first upload.
 *
 * This server reproduces both properties - deep prefix, no redirect - so the
 * failure shows up here instead of in a review queue. A correct build loads
 * with every request logged `200`; a regression shows up as a burst of `404`s
 * with the build-id segment missing from the path.
 *
 * Run with:  npm run build && node scripts/serve-like-poki.mjs
 * Then open: http://localhost:4180/game/build       <- note: no trailing slash
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT ?? 4180);

/** Stand-ins for Poki's `<gameId>/<buildId>`. Only the *shape* matters. */
const PREFIX = '/game/build';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.fbx': 'application/octet-stream',
  '.obj': 'text/plain',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

let failures = 0;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);

  const miss = (why) => {
    failures++;
    console.log(`404 ${path}  (${why})`);
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  };

  if (!path.startsWith(PREFIX)) return miss('outside the build directory');

  // Deliberately no redirect: `/game/build` serves index.html as-is, leaving
  // the browser to resolve relative URLs against `/game/` - the whole point.
  let rel = path.slice(PREFIX.length) || '/';
  if (rel === '/') rel = '/index.html';

  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep)) return miss('path traversal');

  try {
    const body = await readFile(file);
    console.log(`200 ${path}`);
    res
      .writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
      .end(body);
  } catch {
    miss('no such file in dist/');
  }
});

server.listen(PORT, () => {
  console.log(`Serving dist/ the way Poki does, at:\n\n  http://localhost:${PORT}${PREFIX}\n`);
  console.log('Open that URL *without* a trailing slash. Every line below should be 200.\n');
});

process.on('SIGINT', () => {
  console.log(`\n${failures} request(s) 404'd.`);
  server.close(() => process.exit(failures > 0 ? 1 : 0));
});
