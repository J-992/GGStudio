/**
 * Uploads one game's build to Poki for Developers, and fails when it fails.
 *
 * That second half is the reason this wrapper exists. `@poki/cli upload`
 * catches its own errors, prints them, and then calls `process.exit(0)` --
 * verified against 0.1.19 by pointing it at a game id that does not exist:
 *
 *   Error: {"statusCode":404,...}
 *   $ echo $?
 *   0
 *
 * A CI step that shells straight into it is green whether or not anything
 * reached Poki, which is worse than having no pipeline. So the CLI is run as a
 * child, its output is streamed through, and the step only passes if the
 * success line it prints on a 201 actually shows up.
 *
 *   node scripts/poki/upload.mjs <game-directory> [--dry-run]
 *
 * Version name and notes come from POKI_VERSION_NAME / POKI_VERSION_NOTES in
 * the environment rather than from argv built by the workflow. A commit
 * message is attacker-controlled text; interpolating one into a `run:` block
 * is how a workflow gets a shell out of it.
 */

import { appendFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

import { readGame } from './config.mjs';
import { bytes, preflight } from './preflight.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** What @poki/cli prints once the API has answered 201. Nothing else does. */
const SUCCESS = 'Version uploaded successfully';

function summary (markdown)
{
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

function die (message)
{
    console.error(`\n  FAIL  ${message}\n`);
    process.exit(1);
}

//  ------------------------------------------------------------------ args

const target = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (target === undefined) die('usage: node scripts/poki/upload.mjs <game-directory> [--dry-run]');

const game = readGame(target.endsWith('poki.json') ? target : join(target, 'poki.json'));
const where = relative(ROOT, game.dir) || '.';

if (!game.enabled) die(`${game.id} has "ggs.enabled": false in ${where}/poki.json.`);
if (!game.registered) die(`${game.id} has no Poki game id yet -- put the id from developers.poki.com in ${where}/poki.json.`);

//  --------------------------------------------------------------- preflight

console.log(`\n  preflight  ${game.id}  (${where}/${game.buildDir})\n`);

const checks = preflight(game);

for (const failure of checks.failures) console.error(`\n  FAIL  ${failure}`);

if (!checks.ok) die(`${game.id} built something Poki would reject; nothing was uploaded.`);

//  ------------------------------------------------------------------ token

const token = process.env[game.tokenGitSecretName] ?? process.env.POKI_UPLOAD_TOKEN;

if (!dryRun && (token === undefined || token.trim() === ''))
{
    die(
        `no upload token. @poki/cli reads POKI_UPLOAD_TOKEN; this game asks for the secret ` +
        `${game.tokenGitSecretName}. Add it under Settings -> Secrets and variables -> Actions, ` +
        'with the token from developers.poki.com.'
    );
}

//  ------------------------------------------------------------------- args

const name = (process.env.POKI_VERSION_NAME ?? '').trim() || new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const notes = (process.env.POKI_VERSION_NOTES ?? '').trim();
const makePublic = game.makePublic || process.env.POKI_MAKE_PUBLIC === 'true';

const args = [ 'upload', '--game', game.gameId, '--build-dir', game.buildDir, '--name', name ];

if (notes !== '') args.push('--notes', notes);
if (makePublic) args.push('--make-public');

const require = createRequire(import.meta.url);

let bin;

try
{
    //  Resolved from the root package.json rather than fetched by `npx`, so a
    //  deploy uses the version this repo pinned and reviewed.
    bin = require.resolve('@poki/cli/bin/index.js', { paths: [ ROOT ] });
}
catch
{
    die('@poki/cli is not installed. Run `npm ci` at the repo root.');
}

console.log(`\n  ${dryRun ? 'would upload' : 'uploading'}  ${game.id} -> ${game.gameId}`);
console.log(`    version   ${name}`);
console.log(`    public    ${makePublic ? 'yes -- this replaces what players are served' : 'no -- publish from the dashboard'}`);
console.log(`    size      ${bytes(checks.raw)} raw, ${bytes(checks.compressed)} gzipped\n`);

if (dryRun)
{
    console.log('  --dry-run: stopping before the upload.\n');
    summary(`### \`${game.id}\`\n\nDry run — build passed preflight (${bytes(checks.raw)}), nothing uploaded.`);
    process.exit(0);
}

//  ----------------------------------------------------------------- upload

if (!existsSync(bin)) die(`@poki/cli resolved to ${bin}, which does not exist.`);

const child = spawn(process.execPath, [ bin, ...args ], {
    cwd: game.dir,
    env: { ...process.env, POKI_UPLOAD_TOKEN: token },
    stdio: [ 'ignore', 'pipe', 'pipe' ]
});

let output = '';

for (const stream of [ child.stdout, child.stderr ])
{
    stream.setEncoding('utf8');
    stream.on('data', (chunk) =>
    {
        output += chunk;
        process.stdout.write(chunk);
    });
}

const code = await new Promise((done) =>
{
    child.on('error', (err) => die(`could not run @poki/cli -- ${err.message}`));
    child.on('close', done);
});

//  The exit code is not evidence of anything (see the header), so the success
//  line is what decides. Treating a non-zero code as failure is still right --
//  it means the process died before it got as far as lying about it.
if (code !== 0 || !output.includes(SUCCESS))
{
    summary(`### \`${game.id}\` — upload failed\n\nNothing new is on Poki for this game. See the job log.`);
    die(`the upload did not succeed. @poki/cli exits 0 on failure, so this is read off its output, not its exit code (code was ${code}).`);
}

const preview = output.match(/https:\/\/poki\.com\/\S+/)?.[0];
const inspector = output.match(/https:\/\/inspector\.poki\.dev\/\S+/)?.[0];

summary([
    `### \`${game.id}\` — uploaded`,
    '',
    `- Version: \`${name}\``,
    `- Size: ${bytes(checks.raw)} raw, ${bytes(checks.compressed)} gzipped`,
    `- Public: ${makePublic ? '**yes**' : 'no — publish it from the dashboard when you are happy with it'}`,
    preview ? `- [Preview](${preview})` : '',
    inspector ? `- [Inspector](${inspector})` : ''
].filter(Boolean).join('\n'));

console.log(`\n  ${game.id} uploaded.\n`);
