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

    // Look-sensitivity override, applied in `frame()` below. These are
    // MULTIPLIERS on the configured sensitivity, not absolute values, so 1
    // means "exactly what config.js says" and behaviour is unchanged until
    // `setLookSensitivity` is called. See that method for why the override
    // lives here rather than in either scheme.
    this._lookSens = { mouse: 1, touch: 1, invertY: false };

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
   * Runtime look-sensitivity/invert override, driven by the settings screen.
   *
   * `mouse` and `touch` are MULTIPLIERS on the configured sensitivity: 1 is
   * "exactly what `config.js` says", 2 is twice as fast. They are stored that
   * way too (`core/prefs.js`), so a later retune of `config.player.lookSens*`
   * still reaches a player who has moved the slider — storing a resolved
   * absolute value would freeze them at whatever the config said the day they
   * first played.
   *
   * Where this is applied, and why: both schemes' `sample()` return raw pixel
   * deltas (`lookDX`/`lookDY`, matching `KeyboardMouse`'s `movementX/Y`
   * convention — see `docs/INTERFACES.md`'s `InputFrame`), and the actual
   * `lookDX/DY * lookSensMouse|Touch` multiplication happens downstream in
   * `Player.js#update`, reading straight off the deep-frozen `CONFIG`. So
   * `frame()` scales the raw delta on the way past and the two compose to
   * `config x multiplier`.
   *
   * It happens in `frame()` — the single place a scheme's `sample()` becomes
   * an `InputFrame` — rather than inside each scheme, so touch and mouse
   * don't each need a copy of the same maths, and a silent scheme swap
   * (`_handleMediaChange`, e.g. a mouse docked to a tablet) can never lose
   * the setting: `_lookSens` belongs to `Input` itself and is read fresh
   * every call, whichever scheme is live.
   *
   * `invertY` flips `lookDY`'s sign here for the same reason: `Player.js`
   * applies one identical multiplier to both axes and exposes no separate
   * invert knob, so the flip has to happen before the frame reaches it.
   *
   * @param {{mouse: number, touch: number, invertY: boolean}} opts
   */
  setLookSensitivity({ mouse, touch, invertY }) {
    this._lookSens = { mouse, touch, invertY };
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
    // `Player.js` still does its own multiplication by the frozen
    // `CONFIG.player.lookSens*` constant; this scales the raw pixel delta on
    // the way past, so the two compose to (config x multiplier).
    const scale = this.mode === 'touch' ? this._lookSens.touch : this._lookSens.mouse;
    const invert = this._lookSens.invertY ? -1 : 1;
    return {
      mode: this.mode,
      ...sample,
      lookDX: sample.lookDX * scale,
      lookDY: sample.lookDY * scale * invert,
    };
  }

  dispose() {
    this._media.removeEventListener('change', this._handleMediaChange);
    document.body.classList.remove('hide-cursor');
    this._scheme.dispose();
  }
}
