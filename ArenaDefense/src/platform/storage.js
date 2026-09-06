// `localStorage`-backed `SaveIO` for `core/storage.js`'s `loadSave`/`saveSave`.
// Poki runs the game inside a cross-origin iframe and Safari private mode
// throws on the very first `setItem` — every access is guarded behind a
// write-probe, and a failure degrades to an in-memory `Map` for the rest of
// the session rather than taking the game down. Ports the `raw()` probe idea
// from `ninja-flow/src/core/Storage.ts`, trimmed to the `{get, set}` shape
// `core/storage.js` expects (see its `SaveIO` typedef in `core/types.js`) —
// this file never touches `JSON.parse`/sanitizing itself, that's `core/
// storage.js`'s job.
const PROBE_KEY = '__arenadefense_probe__';

let storageOk = true;
/** @type {Map<string, string>} Always kept in sync with every `set()` call,
 *  regardless of whether `localStorage` itself is reachable, so a mid-
 *  session storage failure never loses the write for the rest of the run. */
const memory = new Map();

/**
 * @returns {Storage|null} `window.localStorage` if a real write succeeds
 *   right now, `null` (and latches `storageOk = false` for the rest of the
 *   session) otherwise.
 */
function raw() {
  if (!storageOk) return null;
  try {
    const s = window.localStorage;
    s.setItem(PROBE_KEY, '1');
    s.removeItem(PROBE_KEY);
    return s;
  } catch {
    storageOk = false;
    return null;
  }
}

/** @type {import('../core/types.js').SaveIO} */
export const storageIO = {
  /**
   * @param {string} key
   * @returns {string|null}
   */
  get(key) {
    const s = raw();
    if (s) {
      try {
        return s.getItem(key);
      } catch {
        storageOk = false;
      }
    }
    return memory.has(key) ? memory.get(key) : null;
  },

  /**
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    memory.set(key, value);
    const s = raw();
    if (!s) return;
    try {
      s.setItem(key, value);
    } catch {
      storageOk = false;
    }
  },
};
