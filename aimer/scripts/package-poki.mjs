/**
 * Turns `dist/` into the zip Poki wants, and refuses to do it if the build
 * would fail their technical review.
 *
 * Poki unpacks the archive onto a path of their choosing and serves it from
 * their own domain, so the two things that break a submission are an absolute
 * URL (which resolves against their host, not the game) and a request to some
 * third-party origin (which their sandbox blocks). Both are cheap to check here
 * and expensive to find out about a week later in a review queue.
 */

import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const ZIP = join(ROOT, 'aimer-poki.zip');

/** The one origin a Poki build is allowed to talk to. */
const ALLOWED_ORIGINS = [ 'https://game-cdn.poki.com' ];

const TEXT = /\.(html|js|mjs|css|json|svg|map)$/i;

function walk (dir)
{
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    {
        const full = join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [ full ];
    });
}

function fail (message)
{
    console.error(`\n  FAIL  ${message}\n`);
    process.exitCode = 1;
}

function bytes (n)
{
    return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

let files;

try
{
    files = walk(DIST);
}
catch
{
    fail('dist/ is missing -- run `bun run build` first.');
    process.exit(1);
}

const index = files.find((f) => relative(DIST, f) === 'index.html');

if (!index) fail('dist/index.html is missing; Poki needs it at the root of the archive.');

//  ---------------------------------------------------------------- checks

if (index)
{
    const html = readFileSync(index, 'utf8');

    for (const match of html.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g))
    {
        fail(`index.html points at the absolute path ${match[1]} -- it must be relative ("./...").`);
    }

    if (!html.includes('game-cdn.poki.com'))
    {
        fail('index.html is missing the Poki SDK tag; this looks like a `build:web` build.');
    }
}

for (const file of files)
{
    if (!TEXT.test(file)) continue;

    const text = readFileSync(file, 'utf8');

    for (const match of text.matchAll(/https?:\/\/[a-z0-9.-]+/gi))
    {
        const origin = match[0];

        if (ALLOWED_ORIGINS.includes(origin)) continue;
        //  Phaser's minified source carries its own homepage in a few strings;
        //  a URL nobody fetches is not a network request.
        if (/(phaser\.io|w3\.org|khronos\.org|github\.com|labs\.phaser\.io)$/i.test(origin)) continue;

        fail(`${relative(DIST, file)} references ${origin}; a Poki build may only reach ${ALLOWED_ORIGINS.join(', ')}.`);
    }
}

//  ------------------------------------------------------------------ size

let raw = 0;
let compressed = 0;

for (const file of files)
{
    const size = statSync(file).size;
    raw += size;
    compressed += gzipSync(readFileSync(file)).length;
}

console.log(`\n  ${files.length} files   ${bytes(raw)} raw   ${bytes(compressed)} gzipped`);

for (const file of files.sort((a, b) => statSync(b).size - statSync(a).size).slice(0, 6))
{
    console.log(`    ${bytes(statSync(file).size).padStart(9)}  ${relative(DIST, file)}`);
}

if (process.exitCode === 1)
{
    console.error('\n  Not packaging: fix the failures above first.\n');
    process.exit(1);
}

//  ------------------------------------------------------------------- zip

rmSync(ZIP, { force: true });

try
{
    //  `-X` drops the resource forks and finder metadata macOS otherwise buries
    //  in the archive; the paths are relative to dist/ so index.html lands at
    //  the root of the zip, which is where Poki looks for it.
    execFileSync('zip', [ '-r', '-q', '-X', ZIP, '.', '-x', '.DS_Store' ], { cwd: DIST });
}
catch
{
    fail('`zip` is not available -- archive dist/ yourself with index.html at the root.');
    process.exit(1);
}

console.log(`\n  Ready to upload: ${relative(ROOT, ZIP)}  (${bytes(statSync(ZIP).size)})\n`);
