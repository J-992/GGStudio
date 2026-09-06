// Desktop input scheme: WASD/arrows to move, mouse to look (pointer-lock on
// canvas click, drag-to-look fallback if that's rejected), left button to
// fire, 1/2/3 to pick a turret type, Space/Enter for Ready, Escape to pause.
//
// Implements the `sample()/freeze()/dispose()` contract `ui/input.js` expects
// from any input scheme: `sample()` returns this frame's reading and resets
// every edge/delta accumulator; `freeze(bool)` stops the scheme reacting to
// new input (but a caller must keep calling `sample()` to drain
// accumulators — `Input` does this); `dispose()` removes every listener.

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const POINTER_LOCK_TIMEOUT_MS = 300;

export class KeyboardMouse {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/types.js').GameConfig} config
   */
  constructor(canvas, config) {
    void config;
    this._canvas = canvas;
    this._keys = new Set();
    this._mouseDown = false;
    this._dragging = false;
    this._locked = false;
    this._fallbackMode = false;
    this._frozen = false;
    this._pendingLookDX = 0;
    this._pendingLookDY = 0;
    this._pendingSelect = 0;
    this._pendingReady = false;
    this._pendingPause = false;
    this._lockTimeout = null;

    /** Public: false once pointer lock has been rejected/timed out and the
     * scheme has fallen back to drag-to-look. Mirrors the plan's
     * `input.pointerLocked` field. */
    this.pointerLocked = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onPointerLockError = this._onPointerLockError.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('click', this._onClick);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('pointerlockerror', this._onPointerLockError);
  }

  /**
   * @param {boolean} frozen
   */
  freeze(frozen) {
    this._frozen = frozen;
    if (frozen) {
      this._keys.clear();
      this._mouseDown = false;
      this._dragging = false;
    }
  }

  /**
   * @returns {{ moveX: number, moveY: number, lookDX: number, lookDY: number, fire: boolean, select: 0|1|2|3, ready: boolean, pause: boolean }}
   */
  sample() {
    const select = this._pendingSelect;
    const ready = this._pendingReady;
    const pause = this._pendingPause;
    this._pendingSelect = 0;
    this._pendingReady = false;
    this._pendingPause = false;

    if (this._frozen) {
      this._pendingLookDX = 0;
      this._pendingLookDY = 0;
      return { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, fire: false, select, ready, pause };
    }

    let moveX = (this._keys.has('d') || this._keys.has('arrowright') ? 1 : 0)
      - (this._keys.has('a') || this._keys.has('arrowleft') ? 1 : 0);
    let moveY = (this._keys.has('w') || this._keys.has('arrowup') ? 1 : 0)
      - (this._keys.has('s') || this._keys.has('arrowdown') ? 1 : 0);
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }

    const lookDX = this._pendingLookDX;
    const lookDY = this._pendingLookDY;
    this._pendingLookDX = 0;
    this._pendingLookDY = 0;

    return { moveX, moveY, lookDX, lookDY, fire: this._mouseDown, select, ready, pause };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    this._canvas.removeEventListener('mousedown', this._onMouseDown);
    this._canvas.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('pointerlockerror', this._onPointerLockError);
    if (this._lockTimeout !== null) clearTimeout(this._lockTimeout);
    if (document.pointerLockElement === this._canvas) {
      try { document.exitPointerLock(); } catch { /* already unlocked */ }
    }
  }

  /** @param {KeyboardEvent} e */
  _onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.has(k)) {
      this._keys.add(k);
      e.preventDefault();
      return;
    }
    if (k === '1' || k === '2' || k === '3') {
      this._pendingSelect = /** @type {1|2|3} */ (Number(k));
      e.preventDefault();
      return;
    }
    if (k === ' ' || k === 'enter') {
      this._pendingReady = true;
      e.preventDefault();
      return;
    }
    if (k === 'escape') {
      this._pendingPause = true;
      e.preventDefault();
    }
  }

  /** @param {KeyboardEvent} e */
  _onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.has(k)) {
      this._keys.delete(k);
      e.preventDefault();
    }
  }

  /** @param {MouseEvent} e */
  _onMouseMove(e) {
    if (this._frozen) return;
    if (this._locked || (this._fallbackMode && this._dragging)) {
      this._pendingLookDX += e.movementX;
      this._pendingLookDY += e.movementY;
    }
  }

  /** @param {MouseEvent} e */
  _onMouseDown(e) {
    if (e.button !== 0) return;
    this._mouseDown = true;
    if (this._fallbackMode) this._dragging = true;
  }

  /** @param {MouseEvent} e */
  _onMouseUp(e) {
    if (e.button !== 0) return;
    this._mouseDown = false;
    this._dragging = false;
  }

  _onClick() {
    if (this._frozen || this._fallbackMode || this._locked) return;
    try {
      this._canvas.requestPointerLock();
    } catch {
      this._enableFallback();
      return;
    }
    if (this._lockTimeout !== null) clearTimeout(this._lockTimeout);
    this._lockTimeout = setTimeout(() => {
      if (!this._locked) this._enableFallback();
    }, POINTER_LOCK_TIMEOUT_MS);
  }

  _onPointerLockChange() {
    if (document.pointerLockElement === this._canvas) {
      if (this._lockTimeout !== null) {
        clearTimeout(this._lockTimeout);
        this._lockTimeout = null;
      }
      this._locked = true;
      this.pointerLocked = true;
    } else {
      this._locked = false;
      this.pointerLocked = false;
    }
  }

  _onPointerLockError() {
    if (this._lockTimeout !== null) {
      clearTimeout(this._lockTimeout);
      this._lockTimeout = null;
    }
    this._enableFallback();
  }

  _enableFallback() {
    this._fallbackMode = true;
    this._locked = false;
    this.pointerLocked = false;
  }
}
