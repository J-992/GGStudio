/**
 * Reads and validates one game's `poki.json`.
 *
 * `poki.json` is @poki/cli's own config file -- it reads `game_id` and
 * `build_dir` out of the current working directory and ignores everything
 * else. That "ignores everything else" is the hook this monorepo hangs on:
 * the `ggs` block below lives in the same file, so a game is described in
 * exactly one place and adding a game to the deploy pipeline is adding one
 * file, not editing a workflow.
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** A game_id that is still this string is a game nobody has registered yet. */
export const PLACEHOLDER = 'REPLACE_WITH_POKI_GAME_ID';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Origins every Poki build is allowed to reach, on top of per-game extras. */
const DEFAULT_ALLOWED_ORIGINS = [ 'https://game-cdn.poki.com' ];

/**
 * Origins that appear in bundled source as text and are never fetched --
 * engine homepages, spec URLs, XML namespaces. Poki's reviewers care about
 * requests, not strings, and a build that mentions w3.org in an SVG namespace
 * has not phoned anyone.
 */
const DEFAULT_IGNORED_ORIGINS = [
    'phaser\\.io$',
    'labs\\.phaser\\.io$',
    'threejs\\.org$',
    '(^|\\.)w3\\.org$',
    '(^|\\.)khronos\\.org$',
    '(^|\\.)github\\.com$',
    '(^|\\.)githubusercontent\\.com$',
    '(^|\\.)opensource\\.org$',
    '(^|\\.)mozilla\\.org$',
    '(^|\\.)npmjs\\.com$',
    //  Font and licence boilerplate. Every OFL font ships the licence text
    //  with the URL in it; nothing loads it.
    '(^|\\.)openfontlicense\\.org$',
    '(^|\\.)sil\\.org$',
    '(^|\\.)fontsquirrel\\.com$'
];

export class ConfigError extends Error {}

function requireString (value, what, file)
{
    if (typeof value !== 'string' || value.trim() === '')
    {
        throw new ConfigError(`${file}: ${what} must be a non-empty string.`);
    }

    return value.trim();
}

function requireArray (value, what, file, fallback)
{
    if (value === undefined) return fallback;

    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    {
        throw new ConfigError(`${file}: ${what} must be an array of strings.`);
    }

    return value;
}

/**
 * `token_secret` is the NAME of a GitHub Actions secret, never the token.
 *
 * Getting that backwards puts a live upload token in a committed file and in
 * every job log that mentions it, which has happened. GitHub stores secret
 * names upper-cased, so requiring that here costs nothing and rejects a pasted
 * token on sight.
 *
 * The bad value is deliberately never echoed: if somebody did paste a token,
 * repeating it in the error would copy it into the CI log all over again.
 */
function requireSecretName (value, file)
{
    const name = requireString(value, '"ggs.token_secret"', file);

    if (!/^[A-Z][A-Z0-9_]*$/.test(name))
    {
        throw new ConfigError(
            `${file}: "ggs.token_secret" must be the NAME of a GitHub Actions secret ` +
            '(upper case, letters digits and underscores -- e.g. POKI_UPLOAD_TOKEN_AIMER), ' +
            'not the token itself. The value is never stored in this repo: put it under ' +
            'Settings -> Secrets and variables -> Actions, and name it here.\n' +
            '        If what you pasted was a real upload token, rotate it at ' +
            'developers.poki.com -- it is in this file\'s git history now.'
        );
    }

    return name;
}

/**
 * @param {string} file  Path to a `poki.json`.
 * @returns {object} The normalised game descriptor. `id`, `dir` and every
 *   command are safe to hand to the workflow matrix as-is.
 */
export function readGame (file)
{
    const path = resolve(file);
    const dir = dirname(path);

    let raw;

    try
    {
        raw = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (err)
    {
        throw new ConfigError(`${file}: not readable as JSON -- ${err.message}`);
    }

    const ggs = raw.ggs ?? {};
    const gameId = requireString(raw.game_id, '"game_id"', file);
    const buildDir = requireString(raw.build_dir ?? 'dist', '"build_dir"', file);

    if (gameId !== PLACEHOLDER && !UUID.test(gameId))
    {
        throw new ConfigError(
            `${file}: "game_id" is neither a UUID nor ${PLACEHOLDER}. ` +
            'Copy the id out of the address bar on the game page at https://developers.poki.com/.'
        );
    }

    if (buildDir.startsWith('/') || buildDir.split('/').includes('..'))
    {
        throw new ConfigError(`${file}: "build_dir" must stay inside the game directory.`);
    }

    const id = ggs.id === undefined ? basename(dir) : requireString(ggs.id, '"ggs.id"', file);

    return {
        //  Matrix key and concurrency key. One job per id, ever.
        id,
        dir,
        file: path,
        gameId,
        buildDir,
        buildPath: join(dir, buildDir),
        registered: gameId !== PLACEHOLDER,
        enabled: ggs.enabled !== false,

        //  --- how to build it -------------------------------------------
        packageManager: ggs.package_manager === undefined
            ? 'npm'
            : requireString(ggs.package_manager, '"ggs.package_manager"', file),
        //  Each game pins its own toolchain. A monorepo where one Node version
        //  has to suit every game is a monorepo where upgrading one game is a
        //  negotiation with all the others.
        nodeVersion: requireString(ggs.node_version ?? '22', '"ggs.node_version"', file),
        bunVersion: ggs.bun_version === undefined
            ? 'latest'
            : requireString(ggs.bun_version, '"ggs.bun_version"', file),
        install: requireString(ggs.install ?? 'npm ci', '"ggs.install"', file),
        build: requireString(ggs.build ?? 'npm run build', '"ggs.build"', file),
        //  Gates that run before the build. A game that cannot typecheck has
        //  no business becoming a version on Poki's dashboard.
        verify: requireArray(ggs.verify, '"ggs.verify"', file, []),

        //  --- what the checkout has to contain ---------------------------
        //  `git lfs pull` is scoped to these globs rather than the whole repo:
        //  Shared/ and comfy-zoo/ hold 700-odd LFS objects no game build reads,
        //  and pulling them on every deploy burns the LFS bandwidth quota.
        lfs: requireArray(ggs.lfs, '"ggs.lfs"', file, []),

        //  --- when to deploy it ------------------------------------------
        //  The game's own directory always counts; `watch` adds shared code or
        //  assets that also ought to trigger a redeploy.
        watch: requireArray(ggs.watch, '"ggs.watch"', file, []),

        //  --- what the build is allowed to look like ----------------------
        allowedOrigins: [
            ...DEFAULT_ALLOWED_ORIGINS,
            ...requireArray(ggs.allowed_origins, '"ggs.allowed_origins"', file, [])
        ],
        ignoredOrigins: [
            ...DEFAULT_IGNORED_ORIGINS,
            ...requireArray(ggs.ignore_origins, '"ggs.ignore_origins"', file, [])
        ],
        requireSdk: ggs.require_sdk !== false,
        maxBytes: ggs.max_bytes === undefined ? 0 : Number(ggs.max_bytes),

        //  --- what happens after the upload -------------------------------
        //  Off by default. An upload creates a version; making it public
        //  replaces what players are being served right now, and that should
        //  be a decision somebody makes rather than a side effect of a push.
        makePublic: ggs.make_public === true,
        tokenSecret: requireSecretName(ggs.token_secret ?? 'POKI_UPLOAD_TOKEN', file)
    };
}
