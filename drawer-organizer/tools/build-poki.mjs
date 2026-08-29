/**
 * Builds `dist/` -- the folder Poki gets.
 *
 * This game has no bundler and does not want one: its classic scripts share
 * globals through the window, and `index.html` is where their order is
 * written down. So the build reads that order out of the HTML rather than
 * keeping a second list here, concatenates the files in it, and rewrites the
 * page to load the one result. Add a script tag, and the build picks it up.
 *
 * Concatenation, not bundling, and deliberately so. Bun's bundler tree-shakes
 * top-level declarations nothing appears to reference, which for classic
 * scripts means `ITEM_DEFS` and friends silently vanish from the output and
 * the game dies on Poki instead of here. The saving would have been ~20 KB
 * against a 1.2 MB Phaser, which is not worth a build that can eat the level
 * data.
 *
 * Two things must be true of the output or Poki's technical review ends the
 * submission -- no request to a third-party origin, and the SDK tag present.
 * Both are checked by `scripts/poki/preflight.mjs` at the repo root; `bun run
 * package` runs it. What this script does about them is drop the jsdelivr
 * fallback (fine when you serve the folder yourself, fatal in the sandbox)
 * and leave the SDK tag alone.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { boot } from './boot.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

const BUNDLE = 'game.js';

/** Files that are checked in to keep a folder alive, or to be read by humans. */
const NOT_SHIPPED = /(^\.|\.md$|\.DS_Store$)/;

function bytes (n)
{
    return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function die (message)
{
    console.error(`\n  FAIL  ${message}\n`);
    process.exit(1);
}

//  ------------------------------------------------------------------ read

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

//  The script order, straight from the page that already declares it.
const sources = [ ...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g) ].map((m) => m[1]);

if (sources.length === 0)
{
    die('index.html lists no src/ script tags -- has the page changed shape? The build reads the bundle order from them.');
}

for (const file of sources)
{
    if (!existsSync(join(ROOT, file))) die(`index.html loads ${file}, which does not exist.`);
}

//  ----------------------------------------------------------------- bundle

//  A banner per file so a stack trace from Poki's CDN still names the source
//  it came from. `'use strict'` is deliberately absent: these are classic
//  scripts and adding it changes how they run.
const bundle = sources
    .map((file) => `//  ---- ${file} ${'-'.repeat(Math.max(0, 66 - file.length))}\n\n${readFileSync(join(ROOT, file), 'utf8').trimEnd()}\n`)
    .join('\n');

//  ------------------------------------------------------------------ boot

//  Concatenating classic scripts is safe until it isn't: a file ending in an
//  expression, followed by one opening with a bracket, is two statements as
//  separate files and one statement in the bundle. Boot what was just built --
//  check.mjs already covers the sources, and this is the artefact that ships.
const { errors } = await boot([ { name: BUNDLE, code: bundle } ]);

for (const error of errors) die(`the concatenated bundle is broken -- ${error}`);

//  ------------------------------------------------------------------- html

let page = html;

//  The CDN fallback exists so opening the folder without the vendored Phaser
//  still works. In a Poki build it is a request to jsdelivr, which the sandbox
//  blocks and the reviewer rejects.
const fallback = /\n<script>\n\s*\/\/ Fallback to CDN[\s\S]*?<\/script>/;

if (!fallback.test(page)) die('index.html no longer contains the Phaser CDN fallback block this build expects to strip. Check the page, then update tools/build-poki.mjs.');

page = page.replace(fallback, '');

//  Every tag becomes one, in the first tag's place, so load order is kept.
page = page.replace(new RegExp(`<script src="${sources[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"><\\/script>`), `<script src="${BUNDLE}"></script>`);

for (const file of sources.slice(1))
{
    page = page.replace(new RegExp(`\\n<script src="${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"><\\/script>`), '');
}

if (page.includes('src/')) die('some src/ script tags survived the rewrite -- dist/index.html would load files that are not in the build.');

//  ------------------------------------------------------------------ write

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

writeFileSync(join(DIST, 'index.html'), page);
writeFileSync(join(DIST, BUNDLE), bundle);

//  Phaser stays a separate file: it is the one thing here that never changes,
//  and a browser that has it cached should not redownload it because a level
//  moved a tray twelve pixels.
const phaser = join(ROOT, 'vendor', 'phaser.min.js');

if (!existsSync(phaser)) die('vendor/phaser.min.js is missing -- a Poki build cannot fall back to a CDN for it.');

mkdirSync(join(DIST, 'vendor'), { recursive: true });
cpSync(phaser, join(DIST, 'vendor', 'phaser.min.js'));

//  Every sprite and sound is generated at runtime today, so assets/ holds
//  placeholders and notes. Copy whatever real files appear there later.
const assets = join(ROOT, 'assets');

if (existsSync(assets))
{
    cpSync(assets, join(DIST, 'assets'), {
        recursive: true,
        filter: (from) => statSync(from).isDirectory() || !NOT_SHIPPED.test(relative(assets, from).split('/').pop())
    });
}

//  ----------------------------------------------------------------- report

function walk (dir)
{
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        (e.isDirectory() ? walk(join(dir, e.name)) : [ join(dir, e.name) ]));
}

//  cpSync recreates the directory tree whether or not anything survived the
//  filter, and today nothing does -- assets/ is six empty placeholder folders.
//  Depth first, so a directory holding only empty directories goes too.
function prune (dir)
{
    for (const entry of readdirSync(dir, { withFileTypes: true }))
    {
        if (entry.isDirectory()) prune(join(dir, entry.name));
    }

    if (dir !== DIST && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}

prune(DIST);

const files = walk(DIST);
const total = files.reduce((n, f) => n + statSync(f).size, 0);

console.log(`\n  dist/  ${files.length} files, ${bytes(total)}\n`);

for (const file of files.sort((a, b) => statSync(b).size - statSync(a).size))
{
    console.log(`    ${bytes(statSync(file).size).padStart(9)}  ${relative(DIST, file)}`);
}

console.log(`\n  ${sources.length} scripts concatenated into ${BUNDLE}.\n`);
