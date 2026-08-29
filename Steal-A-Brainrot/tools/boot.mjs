/**
 * Runs the game's scripts against a stub Phaser, far enough to see whether they
 * load and what they left on the window.
 *
 * Nothing renders and no scene body runs: top-level execution is the part worth
 * checking without a browser, because it is where these classic scripts declare
 * the globals they hand each other. A syntax error, a file dropped from
 * `index.html`, or a concatenation that broke on a missing semicolon all show up
 * here as a script that does not load or a game that never boots.
 *
 * Shared by `check.mjs`, which boots `src/`, and `build-poki.mjs`, which boots
 * the `game.js` it just wrote.
 */

import { createContext, runInContext } from 'node:vm';

/** Just enough Phaser for `class X extends Phaser.Scene` and `new Phaser.Game`. */
function stubPhaser(captured) {
  return {
    AUTO: 0,
    Scene: class { constructor(key) { this.key = key; } },
    Game: class { constructor(config) { captured.config = config; } },
    Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
    Math: {
      Clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
      Between: () => 0,
      Distance: { Between: () => 0 }
    },
    Input: { Keyboard: { KeyCodes: new Proxy({}, { get: () => 0 }), JustDown: () => false } },
    Display: {
      Color: {
        IntegerToColor: (c) => ({
          red: (c >> 16) & 255, green: (c >> 8) & 255, blue: c & 255,
          brighten: () => ({ color: c })
        }),
        GetColor: (r, g, b) => (r << 16) | (g << 8) | b
      }
    },
    Utils: { Array: { GetRandom: (a) => a[0] } },
    Geom: { Rectangle: class {} }
  };
}

/**
 * @param {{ name: string, code: string }[]} scripts  In load order.
 * @returns {Promise<{ errors: string[], config: object|undefined, data: object }>}
 *   `data` holds the creature catalogue and systems, or `{}` if a script failed first.
 */
export async function boot(scripts) {
  const captured = {};
  const errors = [];

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    Date,
    Math,
    JSON,
    Object,
    Promise,
    Proxy,
    //  No PokiSDK on the window: the wrapper must no-op off-platform, and this
    //  is the case that proves it still boots the game.
    location: { hostname: 'example.com', search: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener() {},
    document: {
      addEventListener() {},
      getElementById: () => null,
      createElement: () => ({ style: {}, appendChild() {} })
    },
    Phaser: stubPhaser(captured)
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = createContext(sandbox);

  for (const { name, code } of scripts) {
    try {
      runInContext(code, context, { filename: name });
    } catch (err) {
      errors.push(`${name} does not load: ${err.message}`);
    }
  }

  //  main.js boots the game from a promise; let the microtask queue drain.
  await new Promise((res) => setTimeout(res, 0));

  if (!captured.config) errors.push('no Phaser.Game was constructed -- main.js did not boot the game.');
  else if (!Array.isArray(captured.config.scene) || captured.config.scene.length === 0) errors.push('the game config lists no scenes.');

  //  The catalogues are `const` at the top of their files, so they live in the
  //  context's global lexical scope -- shared between scripts exactly as they
  //  are in the browser, but not properties of the sandbox object.
  let data = {};

  try {
    data = runInContext('({ CFG, CREATURES, RARITIES, ARCHETYPES, ENEMIES, BOSSES, STAGES, LAYOUT, configureLayout, Poki, SaveSys, AudioSys })', context);
  } catch (err) {
    if (errors.length === 0) errors.push(`the game globals are unreadable: ${err.message}`);
  }

  return { errors, config: captured.config, data };
}
