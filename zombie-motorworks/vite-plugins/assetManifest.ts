/**
 * Content hashes for everything under `public/assets`, as a virtual module.
 *
 * Files in `public/` are copied to the deploy verbatim, so their URLs never
 * change and the CDN has no way to know when one has. The deploy config used to
 * settle that with `max-age=0, must-revalidate`, which is correct but costs a
 * conditional request per file — around a hundred round trips on every arena
 * load, on top of the ones that actually transfer something.
 *
 * Hashing the bytes at build time and hanging the hash off the URL as `?v=`
 * lets those responses be `immutable` instead: a changed file gets a new URL,
 * and an unchanged one is never asked about again. The query is used rather
 * than a renamed file so nothing has to rewrite the CSS `url()` or the recipe
 * strings that name these assets.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:asset-manifest';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Long enough that a collision is not a practical concern, short in a URL. */
const HASH_LENGTH = 8;

function hashesFor(root: string): Record<string, string> {
  const manifest: Record<string, string> = {};
  if (!fs.existsSync(root)) return manifest;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const key = path.relative(root, full).split(path.sep).join('/');
      manifest[key] = createHash('sha256')
        .update(fs.readFileSync(full))
        .digest('hex')
        .slice(0, HASH_LENGTH);
    }
  };
  walk(root);
  return manifest;
}

/**
 * Publishes `virtual:asset-manifest`, a `Record<assetPath, hash>` keyed by path
 * relative to `public/assets` — `'graveyard/SM-3-Tomb1.glb'`, say.
 *
 * The manifest is rebuilt on each load rather than cached, so a re-converted
 * asset picks up its new hash on the next dev reload without a server restart.
 */
export function assetManifest(): Plugin {
  let assetRoot = '';
  return {
    name: 'scrap-rig:asset-manifest',
    configResolved(config) {
      assetRoot = path.join(config.root, 'public', 'assets');
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      return `export default ${JSON.stringify(hashesFor(assetRoot))};`;
    },
  };
}
