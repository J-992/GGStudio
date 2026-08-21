/**
 * The gate CI runs before it builds -- `verify` in poki.json.
 *
 * There is no test framework here and no typechecker to lean on, so this does
 * the two things that would otherwise be found by a player: it boots every
 * script against a stub Phaser (see boot.mjs), which catches a syntax error or
 * a global that moved, and it reads the level data the way the scenes will.
 *
 * The data checks are the README's rules of thumb, enforced: a level whose
 * trays hold fewer slots than it scatters items can never be completed, and a
 * reward key with no decoration behind it crashes the reward screen. Both are
 * one-character mistakes in a data file that nothing else would catch until
 * somebody played that far.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { boot } from './boot.mjs';

const ROOT = resolve(import.meta.dirname, '..');

const failures = [];
const fail = (message) => failures.push(message);

const done = () =>
{
    for (const failure of failures) console.error(`\n  FAIL  ${failure}`);

    console.error('');
    process.exit(1);
};

//  ------------------------------------------------------------------ boot

//  index.html is where the load order lives; the build reads it too.
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const sources = [ ...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g) ].map((m) => m[1]);

if (sources.length === 0) fail('index.html lists no src/ script tags.');

for (const file of sources)
{
    if (!existsSync(join(ROOT, file))) fail(`index.html loads ${file}, which does not exist.`);
}

if (failures.length > 0) done();

const { errors, data } = await boot(sources.map((file) => ({ name: file, code: readFileSync(join(ROOT, file), 'utf8') })));

failures.push(...errors);

//  ------------------------------------------------------------------ data

const { ITEM_DEFS, LEVELS, DECORATIONS } = data;

if (!ITEM_DEFS || !LEVELS || !DECORATIONS)
{
    if (errors.length === 0) fail('ITEM_DEFS, LEVELS or DECORATIONS are not defined.');

    done();
}

const ids = new Set();

for (const level of LEVELS)
{
    const where = `level ${level.id}`;

    if (ids.has(level.id)) fail(`${where}: duplicate id -- Progression.levelData finds only the first.`);

    ids.add(level.id);

    //  Every scattered item needs a texture and a tray that will take it.
    const capacity = {};

    for (const c of level.containers)
    {
        const slots = c.grid.cols * c.grid.rows;

        for (const category of c.accepts) capacity[category] = (capacity[category] ?? 0) + slots;
    }

    const wanted = {};

    for (const entry of level.items)
    {
        const def = ITEM_DEFS[entry.key];

        if (!def) { fail(`${where}: item "${entry.key}" is not in ITEM_DEFS.`); continue; }

        wanted[def.category] = (wanted[def.category] ?? 0) + entry.count;
    }

    for (const [ category, count ] of Object.entries(wanted))
    {
        const slots = capacity[category] ?? 0;

        //  Trays that accept several categories make this a lower bound rather
        //  than an exact sum, but a category with fewer slots than items is
        //  unwinnable however the sharing works out.
        if (slots < count) fail(`${where}: ${count} ${category} item(s) but only ${slots} slot(s) accept them -- the level cannot be completed.`);
    }

    for (const key of level.reward?.options ?? [])
    {
        if (!DECORATIONS[key]) fail(`${where}: reward "${key}" is not in DECORATIONS.`);
    }
}

//  ------------------------------------------------------------------ done

if (failures.length > 0) done();

console.log(`\n  OK -- ${sources.length} scripts boot, ${LEVELS.length} levels are playable.\n`);
