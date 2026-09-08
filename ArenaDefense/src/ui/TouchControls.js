// Touch input scheme: a fixed left joystick (JS port of
// `zombie-motorworks/src/ui/touch/Joystick.ts`, reusing `core/joystick.js`
// verbatim) drives movement, and a right-half look pad (a deltas-only port of
// `AimPad.ts` — it accumulates pointer travel instead of reporting absolute
// points, since `ui/input.js` wants pixel deltas to match `KeyboardMouse`'s
// `movementX/Y`) drives looking. A dedicated fire button (`.touch-fire`,
// bottom-right) drives `fire`, level-triggered exactly like `KeyboardMouse`'s
// left mouse button — `Game.js` gates firing on `frame.fire` for both input
// modes and separately bends a touch shot onto a nearby enemy via
// `player.aimTarget(...)` (aim-assist, not auto-fire).
//
// Implements the same `sample()/freeze()/dispose()` contract as
// `KeyboardMouse`, plus `hide()/show()` so `Game`/screens can pull the whole
// layer off pointer-input duty (e.g. behind a title/build overlay) without
// tearing it down.
import { readJoystick, clampStickOffset, NEUTRAL_JOYSTICK } from '../core/joystick.js';

const NON_PASSIVE = { passive: false };

export class TouchControls {
  /**
   * @param {HTMLCanvasElement} canvas Unused directly (touch reads from `#ui` DOM), kept for a uniform scheme constructor signature.
   * @param {import('../core/types.js').GameConfig} config
   */
  constructor(canvas, config) {
    void canvas;
    this._config = config;
    // `CONFIG.touch` names its field `joystickRadiusPx` (a config-file
    // authoring choice — clear at the call site that it sizes the stick),
    // but `core/joystick.js`'s `JoystickConfig` shape expects `radiusPx`.
    // Adapting once here, rather than passing `config.touch` straight
    // through, is what makes `CONFIG.touch.joystickRadiusPx` actually reach
    // `readJoystick`/`clampStickOffset` instead of silently falling back to
    // their own default.
    this._joystickConfig = {
      radiusPx: config.touch.joystickRadiusPx,
      deadzone: config.touch.deadzone,
      saturation: config.touch.saturation,
    };
    this._frozen = false;
    this._visible = true;

    this._joyGesture = null; // { pointerId }
    this._joyVector = NEUTRAL_JOYSTICK;
    this._lookGesture = null; // { pointerId, lastX, lastY }
    this._pendingLookDX = 0;
    this._pendingLookDY = 0;
    this._fireGesture = null; // { pointerId }

    const ui = document.getElementById('ui');

    this._root = document.createElement('div');
    this._root.className = 'touch-layer';
    // Drives every `var(--joystick-radius, 56px)` in style.css (the stick's
    // drawn size and screen position) from the same radius the input math
    // above uses, so a config change to `joystickRadiusPx` moves the visible
    // ring and the input deadzone/saturation together.
    this._root.style.setProperty('--joystick-radius', `${this._joystickConfig.radiusPx}px`);

    this._moveZone = document.createElement('div');
    this._moveZone.className = 'touch-zone touch-zone--move';
    this._lookZone = document.createElement('div');
    this._lookZone.className = 'touch-zone touch-zone--look';

    this._stick = document.createElement('div');
    this._stick.className = 'touch-stick';
    this._stickBase = document.createElement('div');
    this._stickBase.className = 'touch-stick__base';
    this._stickKnob = document.createElement('div');
    this._stickKnob.className = 'touch-stick__knob';
    this._stick.append(this._stickBase, this._stickKnob);

    // Fire button: a child of `.touch-layer` itself (a sibling of
    // `_moveZone`/`_lookZone`, NOT of `Hud`'s `.hud-controls`) — deliberately,
    // see the long comment on `Hud.js`'s `_controls` field. `.touch-zone--
    // move`/`--look` cover the whole screen inside `.touch-layer`'s own
    // stacking context, so a button placed anywhere outside that context
    // (e.g. nested under `.hud`) could never out-stack them; only a sibling
    // *inside* `.touch-layer` can paint above them and actually receive taps.
    this._fireBtn = document.createElement('div');
    this._fireBtn.className = 'touch-fire';
    this._fireBtn.setAttribute('role', 'button');
    this._fireBtn.setAttribute('aria-label', 'Fire');

    this._root.append(this._moveZone, this._lookZone, this._stick, this._fireBtn);
    ui.appendChild(this._root);

    this._onJoyDown = this._onJoyDown.bind(this);
    this._onJoyMove = this._onJoyMove.bind(this);
    this._onJoyEnd = this._onJoyEnd.bind(this);
    this._onLookDown = this._onLookDown.bind(this);
    this._onLookMove = this._onLookMove.bind(this);
    this._onLookEnd = this._onLookEnd.bind(this);
    this._onFireDown = this._onFireDown.bind(this);
    this._onFireUp = this._onFireUp.bind(this);

    this._moveZone.addEventListener('pointerdown', this._onJoyDown, NON_PASSIVE);
    this._moveZone.addEventListener('pointermove', this._onJoyMove, NON_PASSIVE);
    this._moveZone.addEventListener('pointerup', this._onJoyEnd, NON_PASSIVE);
    this._moveZone.addEventListener('pointercancel', this._onJoyEnd, NON_PASSIVE);
    this._moveZone.addEventListener('lostpointercapture', this._onJoyEnd, NON_PASSIVE);

    this._lookZone.addEventListener('pointerdown', this._onLookDown, NON_PASSIVE);
    this._lookZone.addEventListener('pointermove', this._onLookMove, NON_PASSIVE);
    this._lookZone.addEventListener('pointerup', this._onLookEnd, NON_PASSIVE);
    this._lookZone.addEventListener('pointercancel', this._onLookEnd, NON_PASSIVE);
    this._lookZone.addEventListener('lostpointercapture', this._onLookEnd, NON_PASSIVE);

    // Deliberately NOT using `setPointerCapture` here (unlike the joystick/
    // look zones above): capturing would suppress `pointerleave` for the
    // captured pointer, and a finger sliding off the button while still down
    // must release fire via `pointerleave`, not stay latched until an
    // eventual `pointerup` that may never target this element.
    this._fireBtn.addEventListener('pointerdown', this._onFireDown, NON_PASSIVE);
    this._fireBtn.addEventListener('pointerup', this._onFireUp, NON_PASSIVE);
    this._fireBtn.addEventListener('pointercancel', this._onFireUp, NON_PASSIVE);
    this._fireBtn.addEventListener('pointerleave', this._onFireUp, NON_PASSIVE);
  }

  /** @param {boolean} frozen */
  freeze(frozen) {
    this._frozen = frozen;
    if (frozen) this._resetGestures();
  }

  /** Hide the whole touch layer (e.g. behind a menu) and drop in-flight gestures. */
  hide() {
    if (!this._visible) return;
    this._visible = false;
    this._resetGestures();
    this._root.hidden = true;
  }

  /** Show the touch layer again. */
  show() {
    if (this._visible) return;
    this._visible = true;
    this._root.hidden = false;
  }

  /**
   * @returns {{ moveX: number, moveY: number, lookDX: number, lookDY: number, fire: boolean, select: 0, ready: boolean, pause: boolean }}
   */
  sample() {
    const lookDX = this._pendingLookDX;
    const lookDY = this._pendingLookDY;
    this._pendingLookDX = 0;
    this._pendingLookDY = 0;

    if (this._frozen || !this._visible) {
      return { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, fire: false, select: 0, ready: false, pause: false };
    }

    return {
      moveX: this._joyVector.x,
      moveY: this._joyVector.y,
      lookDX,
      lookDY,
      fire: this._fireGesture !== null,
      select: 0,
      ready: false,
      pause: false,
    };
  }

  dispose() {
    this._resetGestures();
    this._moveZone.removeEventListener('pointerdown', this._onJoyDown);
    this._moveZone.removeEventListener('pointermove', this._onJoyMove);
    this._moveZone.removeEventListener('pointerup', this._onJoyEnd);
    this._moveZone.removeEventListener('pointercancel', this._onJoyEnd);
    this._moveZone.removeEventListener('lostpointercapture', this._onJoyEnd);
    this._lookZone.removeEventListener('pointerdown', this._onLookDown);
    this._lookZone.removeEventListener('pointermove', this._onLookMove);
    this._lookZone.removeEventListener('pointerup', this._onLookEnd);
    this._lookZone.removeEventListener('pointercancel', this._onLookEnd);
    this._lookZone.removeEventListener('lostpointercapture', this._onLookEnd);
    this._fireBtn.removeEventListener('pointerdown', this._onFireDown);
    this._fireBtn.removeEventListener('pointerup', this._onFireUp);
    this._fireBtn.removeEventListener('pointercancel', this._onFireUp);
    this._fireBtn.removeEventListener('pointerleave', this._onFireUp);
    this._root.remove();
  }

  _resetGestures() {
    if (this._joyGesture !== null) {
      this._releaseCapture(this._moveZone, this._joyGesture.pointerId);
      this._joyGesture = null;
    }
    this._joyVector = NEUTRAL_JOYSTICK;
    this._stick.classList.remove('is-engaged');
    this._stickKnob.style.transform = 'translate3d(0px, 0px, 0)';
    if (this._lookGesture !== null) {
      this._releaseCapture(this._lookZone, this._lookGesture.pointerId);
      this._lookGesture = null;
    }
    this._pendingLookDX = 0;
    this._pendingLookDY = 0;
    if (this._fireGesture !== null) {
      this._fireGesture = null;
      this._fireBtn.classList.remove('is-active');
    }
  }

  /** Centre of the fixed stick, in client coordinates. */
  _stickOrigin() {
    const rect = this._stick.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  /** @param {PointerEvent} e */
  _onJoyDown(e) {
    if (this._frozen || !this._visible || this._joyGesture !== null) return;
    this._joyGesture = { pointerId: e.pointerId };
    this._stick.classList.add('is-engaged');
    this._applyJoystick(e);
    try { this._moveZone.setPointerCapture(e.pointerId); } catch { /* detached surface */ }
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  _onJoyMove(e) {
    if (this._joyGesture === null || e.pointerId !== this._joyGesture.pointerId) return;
    this._applyJoystick(e);
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  _onJoyEnd(e) {
    if (this._joyGesture === null || e.pointerId !== this._joyGesture.pointerId) return;
    this._joyGesture = null;
    this._joyVector = NEUTRAL_JOYSTICK;
    this._stick.classList.remove('is-engaged');
    this._stickKnob.style.transform = 'translate3d(0px, 0px, 0)';
    this._releaseCapture(this._moveZone, e.pointerId);
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  _applyJoystick(e) {
    const origin = this._stickOrigin();
    this._joyVector = readJoystick(origin.x, origin.y, e.clientX, e.clientY, this._joystickConfig);
    const offset = clampStickOffset(origin.x, origin.y, e.clientX, e.clientY, this._joystickConfig.radiusPx);
    this._stickKnob.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`;
  }

  /** @param {PointerEvent} e */
  _onLookDown(e) {
    if (this._frozen || !this._visible || this._lookGesture !== null) return;
    this._lookGesture = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    try { this._lookZone.setPointerCapture(e.pointerId); } catch { /* detached surface */ }
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  _onLookMove(e) {
    const g = this._lookGesture;
    if (g === null || e.pointerId !== g.pointerId) return;
    this._pendingLookDX += e.clientX - g.lastX;
    this._pendingLookDY += e.clientY - g.lastY;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  _onLookEnd(e) {
    if (this._lookGesture === null || e.pointerId !== this._lookGesture.pointerId) return;
    this._lookGesture = null;
    this._releaseCapture(this._lookZone, e.pointerId);
    e.preventDefault();
  }

  /**
   * Level-triggered fire, exactly like `KeyboardMouse`'s left mouse button:
   * `sample()` reports `fire: true` for every frame between this and the
   * matching `_onFireUp` (11 shots/sec is well within a `pointerdown..up`
   * span's precision — there's no edge-triggering/debounce here to fight).
   * @param {PointerEvent} e
   */
  _onFireDown(e) {
    if (this._frozen || !this._visible || this._fireGesture !== null) return;
    this._fireGesture = { pointerId: e.pointerId };
    this._fireBtn.classList.add('is-active');
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  _onFireUp(e) {
    if (this._fireGesture === null || e.pointerId !== this._fireGesture.pointerId) return;
    this._fireGesture = null;
    this._fireBtn.classList.remove('is-active');
    e.preventDefault();
  }

  /**
   * @param {HTMLElement} el
   * @param {number} pointerId
   */
  _releaseCapture(el, pointerId) {
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch { /* capture already gone */ }
  }
}
