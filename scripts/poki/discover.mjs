/**
 * Works out which games this push has to redeploy, and emits the GitHub
 * Actions matrix for them.
 *
 * Every game that ships to Poki owns a `poki.json`; this finds them all rather
 * than reading a list, so registering a new game is adding one file and never
 * touching the workflow. That is the whole point -- a pipeline you have to
 * edit to add a game is a pipeline that will quietly stop covering one.
 *
 *   node scripts/poki/discover.mjs --base <sha> --head <sha>   # push
 *   node scripts/poki/discover.mjs --only aimer                # dispatch
 *   node scripts/poki/discover.mjs --all                       # everything
 */

import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';

import { ConfigError, readGame } from './config.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** Directories that never hold a game and are expensive to walk. */
const SKIP = new Set([ 'node_modules', '.git', 'dist', 'build', '.next', 'public', 'saved', 'Shared' ]);

/** How deep below the repo root a `poki.json` may live. */
const MAX_DEPTH = 3;

function findConfigs (dir = ROOT, depth = 0)
{
    const found = [];

    if (depth > 0 && existsSync(join(dir, 'poki.json'))) found.push(join(dir, 'poki.json'));

    if (depth >= MAX_DEPTH) return found;

    for (const entry of readdirSync(dir, { withFileTypes: true }))
    {
        if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;

        found.push(...findConfigs(join(dir, entry.name), depth + 1));
    }

    return found;
}

/**
 * A deliberately small glob: `*` stops at a slash, `**` does not. Enough for
 * the `watch` patterns a game writes, and it brings in no dependency that a
 * deploy workflow would then have to trust.
 */
function globToRegExp (pattern)
{
    let out = '';

    for (let i = 0; i < pattern.length; i++)
    {
        const c = pattern[i];

        if (c === '*')
        {
            if (pattern[i + 1] === '*')
            {
                //  `**/` matches zero or more directories, so `a/**/b.ts`
                //  matches `a/b.ts` too.
                if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
                else { out += '.*'; i += 1; }
            }
            else out += '[^/]*';
        }
        else if (c === '?') out += '[^/]';
        else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }

    return new RegExp(`^${out}$`);
}

function changedFiles (base, head)
{
    const out = execFileSync('git', [ 'diff', '--name-only', `${base}`, `${head}` ], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
    });

    return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function touches (game, files)
{
    const prefix = `${relative(ROOT, game.dir).split(sep).join('/')}/`;
    const globs = game.watch.map(globToRegExp);

    return files.some((f) => f.startsWith(prefix) || globs.some((re) => re.test(f)));
}

//  ------------------------------------------------------------------ args

const args = process.argv.slice(2);
const flag = (name) =>
{
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
};

const only = flag('only');
const base = flag('base');
const head = flag('head') ?? 'HEAD';
const all = args.includes('--all') || only === 'all';

//  --------------------------------------------------------------- discover

const notes = [];
const games = [];

for (const file of findConfigs().sort())
{
    try
    {
        games.push(readGame(file));
    }
    catch (err)
    {
        if (!(err instanceof ConfigError)) throw err;

        //  A malformed config is a hard stop, not a skip. Skipping it would
        //  silently drop a game out of the pipeline, which is the one failure
        //  mode this script exists to prevent.
        console.error(`\n  FAIL  ${err.message}\n`);
        process.exit(1);
    }
}

if (games.length === 0)
{
    console.error('\n  FAIL  no poki.json anywhere in the repo -- nothing to deploy.\n');
    process.exit(1);
}

let selected = games;

for (const game of games)
{
    if (!game.enabled) notes.push(`${game.id}: skipped, "ggs.enabled" is false.`);
    else if (!game.registered) notes.push(`${game.id}: skipped, "game_id" is still the placeholder -- register the game at developers.poki.com and put its id in ${relative(ROOT, game.file)}.`);
}

selected = selected.filter((g) => g.enabled && g.registered);

if (only !== undefined && !all)
{
    const match = games.find((g) => g.id === only);

    if (match === undefined)
    {
        console.error(`\n  FAIL  no game called "${only}". Known: ${games.map((g) => g.id).join(', ')}\n`);
        process.exit(1);
    }

    selected = selected.filter((g) => g.id === only);
}
else if (!all && base !== undefined)
{
    //  A force push, a squashed branch, the very first push to a branch: the
    //  base commit is either all-zeros or not in this clone, and there is no
    //  diff to compute. Deploying everything is the wrong answer -- it puts a
    //  new version on every game's dashboard because CI could not subtract
    //  two commits. Deploying nothing and saying why lets a human choose.
    if (!/^[0-9a-f]{7,40}$/i.test(base) || /^0+$/.test(base))
    {
        notes.push(`no usable base commit (got "${base}"), so there is no diff to read. Nothing deployed -- re-run this workflow manually and pick the game.`);
        selected = [];
    }
    else
    {
        let files = [];

        try
        {
            files = changedFiles(base, head);
        }
        catch (err)
        {
            notes.push(`could not diff ${base}..${head} (${err.message.split('\n')[0]}). Nothing deployed -- re-run this workflow manually and pick the game.`);
            selected = [];
        }

        if (selected.length > 0)
        {
            const before = selected;
            selected = selected.filter((g) => touches(g, files));

            for (const game of before)
            {
                if (!selected.includes(game))
                {
                    notes.push(`${game.id}: nothing under ${relative(ROOT, game.dir)}/ changed.`);
                }
            }
        }
    }
}

//  ----------------------------------------------------------------- output

const include = selected.map((g) => ({
    id: g.id,
    dir: relative(ROOT, g.dir).split(sep).join('/'),
    build_dir: g.buildDir,
    game_id: g.gameId,
    package_manager: g.packageManager,
    node_version: g.nodeVersion,
    bun_version: g.bunVersion,
    install: g.install,
    build: g.build,
    verify: g.verify.join(' && '),
    lfs: g.lfs.join(','),
    make_public: g.makePublic,
    token_git_secret_name: g.tokenGitSecretName
}));

console.log(`\n  ${games.length} game(s) registered, ${include.length} to deploy: ${include.map((g) => g.id).join(', ') || '(none)'}\n`);

for (const note of notes) console.log(`    - ${note}`);

if (process.env.GITHUB_OUTPUT)
{
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include })}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `count=${include.length}\n`);
}

if (process.env.GITHUB_STEP_SUMMARY)
{
    const lines = [ '## Poki deploy plan', '' ];

    lines.push(include.length > 0
        ? `Deploying: ${include.map((g) => `\`${g.id}\``).join(', ')}`
        : 'Nothing to deploy.');

    if (notes.length > 0) lines.push('', ...notes.map((n) => `- ${n}`));

    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
