/**
 * Runs the game's scripts against a stub Phaser, far enough to see whether
 * they load and what they left on the window.
 *
 * Nothing renders and no scene body runs: top-level execution is the part
 * worth checking without a browser, because it is where the classic scripts
 * declare the globals they hand each other. A syntax error, a file dropped
 * from `index.html`, or a concatenation that broke on a missing semicolon all
 * show up here as a script that does not load or a game that never boots.
 *
 * Shared by `check.mjs`, which boots `src/`, and `build-poki.mjs`, which boots
 * the `game.js` it just wrote.
 */

import { createContext, runInContext } from 'node:vm';

/** Just enough Phaser for `class X extends Phaser.Scene` and `new Phaser.Game`. */
function stubPhaser (captured)
{
    return {
        AUTO: 0,
        Scene: class { constructor (key) { this.key = key; } },
        Game: class { constructor (config) { captured.config = config; } },
        Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
        Math: { Between: () => 0, Distance: { Between: () => 0 } },
        Utils: { Array: { GetRandom: (a) => a[0] } },
        Display: { Color: { IntegerToColor: () => ({ darken: () => ({ color: 0 }) }) } },
        Geom: { Rectangle: class {} }
    };
}

/**
 * @param {{ name: string, code: string }[]} scripts  In load order.
 * @returns {Promise<{ errors: string[], config: object|undefined, data: object }>}
 *   `data` holds the level catalogues, or `{}` if a script failed before them.
 */
export async function boot (scripts)
{
    const captured = {};
    const store = new Map();
    const errors = [];

    const sandbox = {
        console: { log () {}, warn () {}, error () {} },
        setTimeout,
        Date,
        Math,
        JSON,
        Object,
        Promise,
        location: { hostname: 'example.com' },
        innerWidth: 960,
        innerHeight: 640,
        addEventListener () {},
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v))
        },
        document: { addEventListener () {} },
        Phaser: stubPhaser(captured)
    };

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const context = createContext(sandbox);

    for (const { name, code } of scripts)
    {
        try
        {
            runInContext(code, context, { filename: name });
        }
        catch (err)
        {
            errors.push(`${name} does not load: ${err.message}`);
        }
    }

    //  main.js boots the game from a promise; let the microtask queue drain.
    await new Promise((res) => setTimeout(res, 0));

    if (!captured.config) errors.push('no Phaser.Game was constructed -- main.js did not boot the game.');
    else if (!Array.isArray(captured.config.scene) || captured.config.scene.length === 0) errors.push('the game config lists no scenes.');

    //  The catalogues are `const` at the top of their files, so they live in
    //  the context's global lexical scope -- shared between scripts exactly as
    //  they are in the browser, but not properties of the sandbox object.
    let data = {};

    try
    {
        data = runInContext('({ ITEM_DEFS, LEVELS, DECORATIONS })', context);
    }
    catch (err)
    {
        //  Already explained by a load failure above, when there was one.
        if (errors.length === 0) errors.push(`the level data is unreadable: ${err.message}`);
    }

    return { errors, config: captured.config, data };
}
