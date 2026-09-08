// `localStorage`-backed `SaveIO` for `core/storage.js`'s `loadSave`/`saveSave`.
// Poki runs the game inside a cross-origin iframe and Safari private mode
// throws on the very first `setItem` — every access is guarded behind a
// write-probe, and a failure degrades to an in-memory `Map` for the rest of
// the session rather than taking the game down. Ports the `raw()` probe idea
// from `ninja-flow/src/core/Storage.ts`, trimmed to the `{get, set}` shape
// `core/storage.js` expects (see its `SaveIO` typedef in `core/types.js`) —
// this file never touches `JSON.parse`/sanitizing itself, that's `core/
// storage.js`'s job.
import { sanitizePrefs } from '../core/prefs.js';

const PROBE_KEY = '__arenadefense_probe__';

/** Deliberately its own key, NOT part of `core/storage.js`'s
 *  `{coins, bestWave, unlocks}` save shape (that set is test-enforced — see
 *  `test/storage.test.js`) — mute is a device/session preference, not run
 *  progress. */
const MUTE_KEY = 'arenadefense.muted';

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

/** @returns {boolean} Persisted mute preference; `false` (unmuted) if never set or storage is unavailable. */
export function loadMuted() {
  return storageIO.get(MUTE_KEY) === '1';
}

/** @param {boolean} muted */
export function saveMuted(muted) {
  storageIO.set(MUTE_KEY, muted ? '1' : '0');
}

// Device preferences (look sensitivity, invert-look, FPS readout, last weapon
// picked). Under their own key for the same reason the mute flag is: they
// belong to the device, not to a run, and `core/storage.js`'s
// `{coins, bestWave, unlocks}` shape is test-enforced.
const PREFS_KEY = 'arenadefense.prefs';

/** @returns {ReturnType<typeof sanitizePrefs>} Defaults if never set, unavailable, or corrupt. */
export function loadPrefs() {
  const raw = storageIO.get(PREFS_KEY);
  if (!raw) return sanitizePrefs(null);
  try {
    return sanitizePrefs(JSON.parse(raw));
  } catch {
    // Truncated or hand-edited value — fall back rather than break the boot.
    return sanitizePrefs(null);
  }
}

/**
 * @param {Partial<ReturnType<typeof sanitizePrefs>>} patch Merged over what is stored.
 * @returns {ReturnType<typeof sanitizePrefs>} The full prefs after the merge.
 */
export function savePrefs(patch) {
  const next = sanitizePrefs({ ...loadPrefs(), ...patch });
  storageIO.set(PREFS_KEY, JSON.stringify(next));
  return next;
}
