/**
 * Refuses to upload a build that would fail Poki's technical review.
 *
 * Poki unpacks the archive onto a path of their choosing and serves it from
 * their own domain, so the two things that reliably break a submission are an
 * absolute URL (which resolves against their host, not the game) and a request
 * to a third-party origin (which their sandbox blocks). Both are cheap to
 * check here and expensive to find out about a week later in a review queue.
 *
 * The rules are per-game because the games are not the same shape -- what they
 * share is that a regression in any of them is invisible until a human opens
 * the inspector. Run as a script for one game, or import `preflight` from a
 * game's own packaging script so there is one implementation, not two.
 *
 *   node scripts/poki/preflight.mjs aimer
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { readGame } from './config.mjs';

/** Files worth scanning for URLs. A PNG cannot make a request. */
const TEXT = /\.(html|js|mjs|cjs|css|json|svg|map|txt|xml)$/i;

/** A Git LFS pointer, which is what a file becomes in a checkout without LFS. */
const LFS_POINTER = 'version https://git-lfs.github.com/spec/v1';

export function bytes (n)
{
    return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function walk (dir)
{
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    {
        const full = join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [ full ];
    });
}

/**
 * @param {object} game  A descriptor from `readGame`.
 * @param {(line: string) => void} [log]
 * @returns {{ ok: boolean, failures: string[], raw: number, compressed: number, files: string[] }}
 */
export function preflight (game, log = console.log)
{
    const dist = resolve(game.buildPath);
    const failures = [];
    const fail = (message) => failures.push(message);

    let files;

    try
    {
        files = walk(dist);
    }
    catch
    {
        return {
            ok: false,
            failures: [ `${game.buildDir}/ is missing -- the build did not run, or it writes somewhere else.` ],
            raw: 0,
            compressed: 0,
            files: []
        };
    }

    if (files.length === 0)
    {
        return { ok: false, failures: [ `${game.buildDir}/ is empty.` ], raw: 0, compressed: 0, files: [] };
    }

    //  ------------------------------------------------------------ index

    const index = files.find((f) => relative(dist, f) === 'index.html');

    if (!index)
    {
        fail(`${game.buildDir}/index.html is missing; Poki needs it at the root of the archive.`);
    }
    else
    {
        const html = readFileSync(index, 'utf8');

        for (const match of html.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g))
        {
            fail(`index.html points at the absolute path ${match[1]} -- it must be relative ("./..."). Set \`base: './'\` in the Vite config.`);
        }

        if (game.requireSdk && !html.includes('game-cdn.poki.com'))
        {
            fail('index.html carries no Poki SDK tag; this is a build made for some other platform. Check the build command in poki.json.');
        }
    }

    //  ----------------------------------------------------------- origins

    const ignored = game.ignoredOrigins.map((p) => new RegExp(p, 'i'));

    for (const file of files)
    {
        if (!TEXT.test(file)) continue;

        const text = readFileSync(file, 'utf8');

        for (const match of text.matchAll(/https?:\/\/[a-z0-9.-]+/gi))
        {
            const origin = match[0];

            if (game.allowedOrigins.includes(origin)) continue;

            const host = origin.replace(/^https?:\/\//i, '');

            if (ignored.some((re) => re.test(host))) continue;

            fail(`${relative(dist, file)} references ${origin}; a Poki build may only reach ${game.allowedOrigins.join(', ')}. Add it to "ggs.ignore_origins" in poki.json if nothing fetches it.`);
        }
    }

    //  ------------------------------------------------------- LFS stubs

    //  A checkout that did not fetch LFS leaves a 130-byte text file where an
    //  asset should be. Vite copies it into the build without complaint, and
    //  the first sign of trouble is a missing sprite on Poki's CDN.
    for (const file of files)
    {
        if (statSync(file).size > 1024) continue;

        let head;

        try
        {
            head = readFileSync(file, 'utf8').slice(0, LFS_POINTER.length);
        }
        catch
        {
            continue;
        }

        if (head === LFS_POINTER)
        {
            fail(`${relative(dist, file)} is a Git LFS pointer, not the file itself. Add its path to "ggs.lfs" in poki.json so the deploy fetches it.`);
        }
    }

    //  --------------------------------------------------------------- size

    let raw = 0;
    let compressed = 0;

    for (const file of files)
    {
        raw += statSync(file).size;
        compressed += gzipSync(readFileSync(file)).length;
    }

    if (game.maxBytes > 0 && raw > game.maxBytes)
    {
        fail(`the build is ${bytes(raw)}, over the ${bytes(game.maxBytes)} budget set by "ggs.max_bytes" in poki.json.`);
    }

    log(`  ${files.length} files   ${bytes(raw)} raw   ${bytes(compressed)} gzipped`);

    for (const file of [ ...files ].sort((a, b) => statSync(b).size - statSync(a).size).slice(0, 6))
    {
        log(`    ${bytes(statSync(file).size).padStart(9)}  ${relative(dist, file)}`);
    }

    return { ok: failures.length === 0, failures, raw, compressed, files };
}

//  ------------------------------------------------------------------ cli

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
{
    const target = process.argv[2];

    if (target === undefined)
    {
        console.error('usage: node scripts/poki/preflight.mjs <game-directory>');
        process.exit(2);
    }

    const game = readGame(target.endsWith('poki.json') ? target : join(target, 'poki.json'));

    console.log(`\n  preflight  ${game.id}  (${game.buildPath})\n`);

    const result = preflight(game);

    for (const failure of result.failures) console.error(`\n  FAIL  ${failure}`);

    if (!result.ok)
    {
        console.error('\n  Not uploading: fix the failures above first.\n');
        process.exit(1);
    }

    console.log('\n  OK -- this build is shaped like something Poki will accept.\n');
}
