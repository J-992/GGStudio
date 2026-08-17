#!/usr/bin/env node
/**
 * Prove the built Rapier chunk can actually start.
 *
 *   npm run build && node scripts/verify-rapier-wasm.mjs
 *
 * `vite-plugins/rapierWasm.ts` rewrites Rapier's inlined base64 wasm into a
 * fetch of a real `.wasm` asset, so the browser can compile it while it
 * downloads. That rewrite is a regex against a minified third-party file, and
 * the failure mode is nasty: the build succeeds, the bundle looks right, and
 * the game dies at boot with `Invalid base URL` because `init()` was handed
 * something that was not a URL.
 *
 * That is exactly what shipped once — the pattern stopped one property access
 * short of the end of the expression it was replacing, leaving `<url>.buffer`,
 * which is `undefined`. Static checks in the plugin passed, because the rewrite
 * *had* happened; it was the result that was wrong. So this does not inspect
 * the output, it runs it: load the real chunk, call `init()`, build a world,
 * and drop a box. Nothing short of that distinguishes the two cases.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = path.resolve(HERE, '..', 'dist', 'assets');

/**
 * Answer `fetch` for `file:` URLs, as a web server would.
 *
 * The chunk resolves the wasm against its own `import.meta.url`, which is a
 * `file:` URL when imported from disk. `application/wasm` is set deliberately:
 * with any other type wasm-bindgen falls back off `instantiateStreaming` to
 * buffering, which would still pass and hide a MIME regression.
 */
function installFileFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : (input?.url ?? String(input));
    if (!url.startsWith('file:')) return realFetch(input, init);
    return new Response(fs.readFileSync(fileURLToPath(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/wasm' },
    });
  };
}

function findChunk() {
  if (!fs.existsSync(DIST_ASSETS)) {
    throw new Error(`No build found at ${DIST_ASSETS}. Run \`npm run build\`.`);
  }
  const chunk = fs
    .readdirSync(DIST_ASSETS)
    .find((name) => /^rapier-.*\.js$/.test(name));
  if (chunk === undefined) throw new Error('No rapier-*.js chunk in the build.');
  return path.join(DIST_ASSETS, chunk);
}

function assertWasmIsExternal(chunkPath) {
  const code = fs.readFileSync(chunkPath, 'utf8');
  if (/toByteArray\("AGFzbQ/.test(code)) {
    throw new Error(
      'The chunk still carries the inlined base64 wasm — the rewrite did not ' +
        'fire, and 1.4 MB of base64 is back on the critical path.',
    );
  }
  const wasm = fs
    .readdirSync(DIST_ASSETS)
    .filter((name) => name.endsWith('.wasm'));
  if (wasm.length === 0) throw new Error('No .wasm asset was emitted.');
  return wasm;
}

async function main() {
  installFileFetch();
  const chunkPath = findChunk();
  const wasmFiles = assertWasmIsExternal(chunkPath);

  const module = await import(pathToFileURL(chunkPath).href);
  // The chunk re-exports Rapier's namespace under a minified name.
  const RAPIER =
    typeof module.init === 'function'
      ? module
      : Object.values(module).find(
          (value) => value && typeof value.init === 'function',
        );
  if (!RAPIER) {
    throw new Error(`No init() among the chunk's exports: ${Object.keys(module)}`);
  }

  await RAPIER.init();

  // Instantiating is not the same as working: run the engine.
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
  for (let step = 0; step < 60; step++) world.step();

  const { y } = body.translation();
  if (!(y < 10)) throw new Error(`Physics did not run: body stayed at y=${y}.`);

  const sizes = wasmFiles
    .map(
      (name) =>
        `${name} (${(fs.statSync(path.join(DIST_ASSETS, name)).size / 1024).toFixed(0)} KB)`,
    )
    .join(', ');
  console.log(`Rapier boots from an external wasm: ${sizes}`);
  console.log(`  init() resolved and 60 steps ran; body fell to y=${y.toFixed(3)}.`);
}

try {
  await main();
} catch (error) {
  console.error(`verify-rapier-wasm: ${error.message}`);
  process.exitCode = 1;
}
