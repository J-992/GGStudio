// Device-agnostic input frontend. Owns which scheme (`KeyboardMouse` or
// `TouchControls`) is live, swaps it silently when the primary pointer
// changes (a mouse docked to a tablet, a Bluetooth keyboard attached to a
// phone), and hands `Game.js` one flat `InputFrame` per fixed step — see
// `docs/INTERFACES.md` for the frame's field semantics.
import { decideInputMode } from '../core/inputDetect.js';
import { KeyboardMouse } from './KeyboardMouse.js';
import { TouchControls } from './TouchControls.js';

/**
 * @returns {'touch'|'keyboard'|null}
 */
function readOverride() {
  try {
    const value = new URLSearchParams(location.search).get('touch');
    if (value === '1') return 'touch';
    if (value === '0') return 'keyboard';
  } catch {
    // A malformed query string is not a reason to refuse to boot.
  }
  return null;
}

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/types.js').GameConfig} config
   */
  constructor(canvas, config) {
    this._canvas = canvas;
    this._config = config;
    this._override = readOverride();
    this._frozen = false;
    this._lockWanted = false;
    /** @type {Set<(mode: 'touch'|'keyboard') => void>} */
    this._modeListeners = new Set();

    const touchPoints = navigator.maxTouchPoints ?? 0;
    this._media = window.matchMedia('(pointer: coarse)');
    /** @type {'touch'|'keyboard'} */
    this.mode = decideInputMode({ touchPoints, coarse: this._media.matches, override: this._override });

    document.body.classList.add(this.mode);
    this._scheme = this._createScheme(this.mode);

    this._handleMediaChange = this._handleMediaChange.bind(this);
    this._media.addEventListener('change', this._handleMediaChange);
  }

  /**
   * @param {'touch'|'keyboard'} mode
   */
  _createScheme(mode) {
    return mode === 'touch'
      ? new TouchControls(this._canvas, this._config)
      : new KeyboardMouse(this._canvas, this._config);
  }

  _handleMediaChange() {
    const touchPoints = navigator.maxTouchPoints ?? 0;
    const next = decideInputMode({ touchPoints, coarse: this._media.matches, override: this._override });
    if (next === this.mode) return;

    this._scheme.dispose();
    document.body.classList.remove(this.mode);
    this.mode = next;
    document.body.classList.add(this.mode);
    this._scheme = this._createScheme(this.mode);
    if (this._frozen) this._scheme.freeze(true);
    if (this._lockWanted) this._scheme.setLockWanted?.(true);
    for (const fn of this._modeListeners) fn(this.mode);
  }

  /**
   * @param {(mode: 'touch'|'keyboard') => void} fn
   * @returns {() => void} Unsubscribe.
   */
  onModeChange(fn) {
    this._modeListeners.add(fn);
    return () => this._modeListeners.delete(fn);
  }

  /**
   * Zeroes and ignores all input (used during ads/pauses). The underlying
   * scheme keeps draining its own accumulators via `sample()` so nothing
   * queued while frozen bursts out on the next unfrozen frame.
   * @param {boolean} frozen
   */
  freeze(frozen) {
    this._frozen = frozen;
    this._scheme.freeze(frozen);
  }

  /**
   * Whether gameplay currently owns the pointer. On desktop this asks
   * `KeyboardMouse` for pointer lock (which hides the system cursor); the
   * `hide-cursor` body class hides it over the canvas either way, covering
   * both the drag-to-look fallback and the moment before a lock is granted.
   * Touch has no cursor and no scheme method — the optional call no-ops.
   *
   * @param {boolean} wanted
   */
  setPointerLockWanted(wanted) {
    this._lockWanted = wanted;
    document.body.classList.toggle('hide-cursor', wanted);
    this._scheme.setLockWanted?.(wanted);
  }

  /**
   * @returns {import('../core/types.js').InputFrame}
   */
  frame() {
    const sample = this._scheme.sample();
    if (this._frozen) {
      return { mode: this.mode, moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, fire: false, select: 0, ready: false, pause: false };
    }
    return { mode: this.mode, ...sample };
  }

  dispose() {
    this._media.removeEventListener('change', this._handleMediaChange);
    document.body.classList.remove('hide-cursor');
    this._scheme.dispose();
  }
}
