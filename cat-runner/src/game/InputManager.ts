/**
 * Unified input for keyboard, touch and gamepad.
 *
 * Touch is swipes only - flick left/right to change lane, up to jump, down to
 * slide, and two flicks the same way inside DOUBLE_TAP_MS to take a corner.
 * There are no on-screen buttons: they cost a permanent corner of a phone
 * screen, put the player's thumbs over the track, and are slower than the
 * gesture they replace. The reference is Subway Surfers, which is also why
 * `handleSwipePointerMove` fires on the drag rather than on release.
 *
 * Everything the runner needs is edge-triggered - there are no held axes any
 * more, because the cat runs at a fixed speed and moves between three discrete
 * lanes. Each source latches its presses as they arrive and `update()` resolves
 * them into a single one-frame snapshot, which guarantees exactly one pulse per
 * physical press no matter how many events land between two frames or how long
 * a frame takes.
 *
 * The one piece of real interpretation happens here: a left or right press is
 * both a lane change *and* half of a corner turn. A single tap always shifts a
 * lane immediately, so steering never has input latency; a second tap on the
 * same side inside DOUBLE_TAP_MS additionally raises a turn request, which the
 * controller honours only if a corner is actually in reach. Delaying the lane
 * shift to disambiguate would put a sixth of a second of lag on every input in
 * the game to serve the handful of corners in the campaign.
 */

export interface RunInput {
  /** Net lane steps this frame: -2..+2, negative left. */
  laneStep: number;
  /** Corner turn request: -1 left, +1 right, 0 none. */
  turn: -1 | 0 | 1;
  /** True ONLY on the frame jump was newly pressed. */
  jump: boolean;
  /** True ONLY on the frame slide was newly pressed. */
  slide: boolean;
}

export type InputAction = 'restart' | 'pause' | 'mute' | 'debug' | 'confirm' | 'skip';

/** The four flicks a gesture can resolve to. */
type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/**
 * What one delta measured against the gesture's anchor amounted to.
 *
 * `continued` is the distinction that matters: the delta *was* a recognisable
 * flick, but the same one already counted, so it is consumed (the anchor
 * moves) without raising an input.
 */
type SwipeOutcome = 'none' | 'fired' | 'continued';

/** Two taps on the same side inside this window read as a corner turn. */
const DOUBLE_TAP_MS = 280;

/**
 * Proactive touch-capability check, run once at construction so the HUD's
 * pause button - the one control a swipe cannot express - is correct on the
 * very first frame, rather than only appearing once a gesture has already
 * been made. Guarded against a non-browser environment (this file's tests run
 * in plain Node) rather than assuming `window`/`navigator` exist.
 */
export function detectTouchCapability(): boolean {
  const coarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const hasTouchPoints =
    typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0;
  return coarsePointer || hasTouchPoints;
}

/**
 * Minimum straight-line travel, in CSS px, before a canvas drag counts as a
 * swipe.
 *
 * Cut from 44 with the move to recognise-on-drag (see
 * {@link InputManager.handleSwipePointerMove}). The two numbers are a pair:
 * when a swipe was only classified on *release*, a long threshold cost
 * nothing, because the gesture had already ended by the time it was measured.
 * Now that the threshold is what actually fires the input, every pixel of it
 * is latency the player feels, so it is set to the smallest travel that still
 * reads as a deliberate flick rather than a tap that wobbled.
 */
const SWIPE_MIN_DISTANCE_PX = 26;
/** Longer than this and a drag reads as deliberate/no-op rather than a swipe.
 *  Measured from the gesture's current anchor, which
 *  {@link InputManager.handleSwipePointerMove} re-plants as the finger moves,
 *  so a slow reposition followed by a quick flick still fires. */
const SWIPE_MAX_DURATION_MS = 500;
/** Dominant-axis delta must exceed the cross-axis delta by this ratio to
 *  classify a direction - keeps a diagonal swipe from firing two inputs.
 *  Loosened from 1.5 alongside the shorter distance threshold: a swipe caught
 *  this early has travelled less far, so it has had less distance to
 *  straighten out, and 1.5 rejected real diagonal-ish flicks outright. */
const SWIPE_DIRECTION_BIAS = 1.2;

/**
 * Keyboard codes that map to a discrete, edge-triggered action.
 *
 * F2 raises the debug overlay and is development-only: Poki rejects a build
 * that ships debug code, so in production it is not bound here at all rather
 * than bound to a handler that happens to do nothing. `import.meta.env.DEV`
 * is a literal in the built bundle, so the entry is gone, not skipped.
 */
const ACTION_KEYS: Partial<Record<string, InputAction>> = {
  KeyR: 'restart',
  Escape: 'pause',
  KeyM: 'mute',
  Enter: 'confirm',
  ...(import.meta.env.DEV ? { F2: 'debug' as InputAction } : {}),
};

/** Keys we own entirely - the page must never scroll or the browser react to them. */
const PREVENT_DEFAULT_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  // F2 only where it does something; elsewhere the browser keeps it.
  ...(import.meta.env.DEV ? ['F2'] : []),
]);

/** Radial deadzone for the left stick, as a fraction of full travel. */
const STICK_DEADZONE = 0.18;

/** Gamepad buttons/axes we read, named for clarity at call sites. */
const GAMEPAD_BUTTON_JUMP = 0; // south face button
const GAMEPAD_BUTTON_SLIDE = 1; // east face button
const GAMEPAD_BUTTON_DPAD_DOWN = 13;
const GAMEPAD_BUTTON_PAUSE = 9; // start/menu
const GAMEPAD_BUTTON_TURN_LEFT = 4; // left shoulder
const GAMEPAD_BUTTON_TURN_RIGHT = 5; // right shoulder
const GAMEPAD_AXIS_LANE = 0;
/** D-pad, where the browser exposes it as buttons rather than a hat axis. */
const GAMEPAD_BUTTON_DPAD_LEFT = 14;
const GAMEPAD_BUTTON_DPAD_RIGHT = 15;

export class InputManager {
  private readonly target: HTMLElement;
  private readonly swipeSurface: HTMLElement | null;

  private _isTouchActive = detectTouchCapability();
  get isTouchActive(): boolean {
    return this._isTouchActive;
  }

  private _isGamepadActive = false;
  get isGamepadActive(): boolean {
    return this._isGamepadActive;
  }

  /** Stable object reference - mutated in place every `update()`, never reallocated. */
  readonly drive: RunInput = { laneStep: 0, turn: 0, jump: false, slide: false };

  // --- Lane / turn latches, shared by every source ------------------------
  /** Lane steps banked since the last update(). */
  private lanePending = 0;
  private turnPending: -1 | 0 | 1 = 0;
  private lastTapLeft = Number.NEGATIVE_INFINITY;
  private lastTapRight = Number.NEGATIVE_INFINITY;

  // --- Keyboard state -----------------------------------------------------
  private readonly keysDown = new Set<string>();
  /** Latched by keydown, consumed (cleared) by the next update(). */
  private keyboardJumpPending = false;
  private keyboardSlidePending = false;

  // --- Touch state ---------------------------------------------------------
  // Raised by a swipe (see `classifySwipe`) and consumed by the next
  // `update()`, exactly like their keyboard counterparts above.
  private touchJumpPending = false;
  private touchSlidePending = false;

  // --- Swipe state -----------------------------------------------------------
  /** Only one gesture tracked at a time - a second finger landing while one
   *  is already tracked is ignored, so two thumbs cannot each steer. */
  private swipeActivePointerId: number | null = null;
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeStartTime = 0;
  /** True once this gesture has already produced an input, so the release
   *  handler knows not to fire a second one off the same finger movement. */
  private swipeFired = false;
  /** Direction of the last input this gesture raised; a repeat of it is
   *  refused, which is what keeps one flick to one lane. Cleared when the
   *  finger lands, so every new touch starts unarmed. */
  private swipeLastDirection: SwipeDirection | null = null;

  // --- Gamepad state ---------------------------------------------------------
  private gamepadJumpWasDown = false;
  private gamepadJumpPending = false;
  private gamepadSlideWasDown = false;
  private gamepadSlidePending = false;
  private gamepadPauseWasDown = false;
  private gamepadLaneWasLeft = false;
  private gamepadLaneWasRight = false;
  private gamepadTurnWasLeft = false;
  private gamepadTurnWasRight = false;

  // --- Action subscriptions --------------------------------------------------
  private readonly actionHandlers = new Map<InputAction, Set<() => void>>();

  // --- consumeAnyInput bookkeeping --------------------------------------------
  private anyInputSeen = false;

  // Bound listener refs so add/removeEventListener target the same function.
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
  private readonly onBlur = () => this.clear();
  private readonly onGamepadConnected = () => {
    this._isGamepadActive = true;
  };
  private readonly onGamepadDisconnected = () => {
    this._isGamepadActive = this.hasAnyGamepad();
  };
  private readonly onContextMenu = (e: Event) => e.preventDefault();
  private readonly onSelectStart = (e: Event) => e.preventDefault();
  private readonly onSwipePointerDown = (e: PointerEvent) => this.handleSwipePointerDown(e);
  private readonly onSwipePointerMove = (e: PointerEvent) => this.handleSwipePointerMove(e);
  private readonly onSwipePointerUp = (e: PointerEvent) => this.handleSwipePointerUp(e);

  private disposed = false;

  constructor(target: HTMLElement = document.body, swipeSurface: HTMLElement | null = null) {
    this.target = target;
    this.swipeSurface = swipeSurface;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    this.target.addEventListener('contextmenu', this.onContextMenu);
    this.target.addEventListener('selectstart', this.onSelectStart);

    if (this.swipeSurface) {
      this.swipeSurface.addEventListener('pointerdown', this.onSwipePointerDown);
      this.swipeSurface.addEventListener('pointermove', this.onSwipePointerMove);
      this.swipeSurface.addEventListener('pointerup', this.onSwipePointerUp);
      this.swipeSurface.addEventListener('pointercancel', this.onSwipePointerUp);
    }
  }

  // ===========================================================================
  // Lane / turn taps
  // ===========================================================================

  /**
   * Books one sideways press from any source.
   *
   * The lane step is banked unconditionally so steering stays instant. A second
   * tap on the same side inside the window additionally raises a turn request -
   * and clears the timestamp, so a third tap starts a fresh pair rather than
   * firing a second turn off the back of the same burst.
   */
  private registerTap(side: -1 | 1): void {
    const now = performance.now();
    const last = side < 0 ? this.lastTapLeft : this.lastTapRight;

    if (now - last <= DOUBLE_TAP_MS) {
      this.turnPending = side;
      if (side < 0) this.lastTapLeft = Number.NEGATIVE_INFINITY;
      else this.lastTapRight = Number.NEGATIVE_INFINITY;
    } else if (side < 0) {
      this.lastTapLeft = now;
    } else {
      this.lastTapRight = now;
    }

    this.lanePending += side;
    this.anyInputSeen = true;
  }

  /** Books a corner turn directly, with no double-tap needed. */
  private registerTurn(side: -1 | 1): void {
    this.turnPending = side;
    this.anyInputSeen = true;
  }

  // ===========================================================================
  // Keyboard
  // ===========================================================================

  /** True while focus is inside a text-editing control, where keys should type normally. */
  private isTypingIntoField(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return (el as HTMLElement).isContentEditable === true;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isTypingIntoField()) return;

    if (PREVENT_DEFAULT_CODES.has(e.code)) {
      e.preventDefault();
    }

    // Ignore OS key-repeat for edge-triggered signals; held state (`keysDown`)
    // doesn't care, but a jump pulse must fire once per physical press.
    const isRepeat = e.repeat;

    if (!isRepeat) {
      // W / Up / Space all jump. Space is kept purely for muscle memory.
      if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') {
        this.keyboardJumpPending = true;
        this.anyInputSeen = true;
      }

      // S / Down slide. Edge-triggered like every other verb here: the duck is
      // a timed pose, so holding the key must not hold the cat down.
      if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        this.keyboardSlidePending = true;
        this.anyInputSeen = true;
      }

      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.registerTap(-1);
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.registerTap(1);
    }

    if (!this.keysDown.has(e.code)) {
      this.anyInputSeen = true;
    }
    this.keysDown.add(e.code);

    const action = ACTION_KEYS[e.code];
    if (action && !isRepeat) {
      this.fireAction(action);
      this.anyInputSeen = true;
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (this.isTypingIntoField()) return;
    this.keysDown.delete(e.code);
  }

  // ===========================================================================
  // Touch - swipe gestures, the only touch control there is
  // ===========================================================================

  /**
   * Swipes are attached to the canvas rather than `target`/`document.body` so
   * that the HUD keeps its own presses: the pause button is a real element
   * above the canvas, and a tap on it is dispatched there and never reaches
   * this handler.
   */
  private handleSwipePointerDown(e: PointerEvent): void {
    if (this.swipeActivePointerId !== null) return; // one gesture at a time
    this.swipeActivePointerId = e.pointerId;
    this.anchorSwipe(e.clientX, e.clientY);
    this.swipeFired = false;
    this.swipeLastDirection = null;
    this._isTouchActive = true;
    // Keeps the browser's own gesture recognizer (scroll/pinch) from fighting
    // this manual gesture tracking, same intent as `onContextMenu` above.
    e.preventDefault();
  }

  /** (Re-)plants the origin a swipe is measured from. */
  private anchorSwipe(x: number, y: number): void {
    this.swipeStartX = x;
    this.swipeStartY = y;
    this.swipeStartTime = performance.now();
  }

  /**
   * Fires a swipe the instant the finger crosses the distance threshold,
   * rather than waiting for it to be lifted.
   *
   * This is the touch half of the input-latency pass, and it is the larger
   * half on a phone. Classifying on `pointerup` meant the input landed when
   * the gesture *ended*: the player had already flicked, already seen the
   * obstacle coming, and the lane change waited on them lifting a thumb. That
   * is 100-300 ms of pure, self-inflicted latency on every single steer, and
   * it is not latency the physics or the renderer can win back. Subway
   * Surfers - the reference the controls were asked to match - recognises on
   * the drag, which is why its steering feels attached to the finger.
   *
   * After firing, the anchor is re-planted at the current point so one
   * continuous drag can produce several inputs (flick left, then down, without
   * lifting) - again matching the reference, where a gesture is a stream of
   * swipes rather than a single one per touch. What it must *not* produce is
   * the same input several times over as one flick keeps travelling; see
   * {@link classifySwipe}.
   */
  private handleSwipePointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.swipeActivePointerId) return;

    // A drag that has dawdled past the flick window is treated as a
    // reposition, not a failed swipe: re-anchor and keep watching, so a slow
    // drag followed by a sharp flick still registers the flick.
    if (performance.now() - this.swipeStartTime > SWIPE_MAX_DURATION_MS) {
      this.anchorSwipe(e.clientX, e.clientY);
      return;
    }

    const outcome = this.classifySwipe(e.clientX - this.swipeStartX, e.clientY - this.swipeStartY);
    if (outcome !== 'none') {
      if (outcome === 'fired') this.swipeFired = true;
      this.anchorSwipe(e.clientX, e.clientY);
    }
    e.preventDefault();
  }

  /**
   * Release path. Now only a fallback: an ordinary drag has already been
   * recognised by {@link handleSwipePointerMove}, and `swipeFired` stops this
   * from firing a duplicate off the same movement. It still matters for a
   * flick so fast that the browser coalesced it into no usable move event.
   */
  private handleSwipePointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.swipeActivePointerId) return;
    this.swipeActivePointerId = null;

    const fired = this.swipeFired;
    this.swipeFired = false;
    if (fired) return;

    const duration = performance.now() - this.swipeStartTime;
    if (duration > SWIPE_MAX_DURATION_MS) return;

    this.classifySwipe(e.clientX - this.swipeStartX, e.clientY - this.swipeStartY);
  }

  /**
   * Turns a gesture delta into an input.
   *
   * Shared by the drag and release paths so both agree exactly on what counts
   * as a swipe and which direction it is.
   *
   * The direction of the last input this gesture raised is remembered, and
   * repeating it is refused - which is what keeps one flick to one lane.
   * `SWIPE_MIN_DISTANCE_PX` is 26, deliberately small so steering feels
   * attached to the finger, but a real thumb flick travels 100-200 px: with
   * the anchor re-planted after every fire, a single swipe left crossed that
   * threshold three or four times over and booked a lane step each time. From
   * the centre lane the surplus clamped away at the edge and hid the bug; from
   * an outer lane the cat crossed the whole track on one swipe.
   *
   * Refusing only the *repeat* keeps what the re-anchoring is actually for -
   * a gesture is a stream of inputs, so flick left then down without lifting
   * still gives a lane change and a slide. A change of direction re-arms the
   * previous one, so left-right-left in one drag is three inputs, and lifting
   * the finger clears it entirely.
   */
  private classifySwipe(dx: number, dy: number): SwipeOutcome {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (Math.max(absDx, absDy) < SWIPE_MIN_DISTANCE_PX) return 'none'; // a tap, not a swipe

    let direction: SwipeDirection;
    if (absDx > absDy * SWIPE_DIRECTION_BIAS) direction = dx < 0 ? 'left' : 'right';
    else if (absDy > absDx * SWIPE_DIRECTION_BIAS) direction = dy < 0 ? 'up' : 'down';
    else return 'none'; // too diagonal to classify - discarded

    // Still the same flick travelling. Consumed rather than ignored, so the
    // caller re-anchors and a later flick the other way is measured from here
    // instead of from halfway through this one.
    if (direction === this.swipeLastDirection) return 'continued';
    this.swipeLastDirection = direction;

    if (direction === 'left' || direction === 'right') {
      // The same lane-change primitive the keyboard and gamepad book, so two
      // flicks the same way arm a corner turn exactly as two key presses do -
      // and the two halves may come from different sources.
      this.registerTap(direction === 'left' ? -1 : 1);
      return 'fired';
    }

    if (direction === 'up') this.touchJumpPending = true;
    else this.touchSlidePending = true;
    this.anyInputSeen = true;
    return 'fired';
  }

  // ===========================================================================
  // Gamepad
  // ===========================================================================

  private hasAnyGamepad(): boolean {
    if (!navigator.getGamepads) return false;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (pad) return true;
    }
    return false;
  }

  /** Rescale a deadzoned axis so output still reaches +-1 just past the deadzone edge. */
  private applyDeadzone(value: number, deadzone: number): number {
    const mag = Math.abs(value);
    if (mag <= deadzone) return 0;
    const sign = value < 0 ? -1 : 1;
    const rescaled = (mag - deadzone) / (1 - deadzone);
    return sign * clamp(rescaled, 0, 1);
  }

  private readGamepad(): void {
    if (!navigator.getGamepads) {
      this._isGamepadActive = false;
      return;
    }

    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate) {
        pad = candidate;
        break;
      }
    }

    if (!pad) {
      this._isGamepadActive = false;
      this.gamepadJumpWasDown = false;
      this.gamepadPauseWasDown = false;
      this.gamepadLaneWasLeft = false;
      this.gamepadLaneWasRight = false;
      this.gamepadTurnWasLeft = false;
      this.gamepadTurnWasRight = false;
      return;
    }
    this._isGamepadActive = true;

    // Stick or d-pad, edge-triggered: holding left must not walk the runner
    // across every lane, it is one press for one lane.
    const stick = this.applyDeadzone(pad.axes[GAMEPAD_AXIS_LANE] ?? 0, STICK_DEADZONE);
    const laneLeft =
      stick < -0.5 || (pad.buttons[GAMEPAD_BUTTON_DPAD_LEFT]?.pressed ?? false);
    const laneRight =
      stick > 0.5 || (pad.buttons[GAMEPAD_BUTTON_DPAD_RIGHT]?.pressed ?? false);

    if (laneLeft && !this.gamepadLaneWasLeft) this.registerTap(-1);
    if (laneRight && !this.gamepadLaneWasRight) this.registerTap(1);
    this.gamepadLaneWasLeft = laneLeft;
    this.gamepadLaneWasRight = laneRight;

    // A pad has spare buttons, so corners get dedicated shoulders rather than
    // a double-tap the stick would make awkward.
    const turnLeft = pad.buttons[GAMEPAD_BUTTON_TURN_LEFT]?.pressed ?? false;
    const turnRight = pad.buttons[GAMEPAD_BUTTON_TURN_RIGHT]?.pressed ?? false;
    if (turnLeft && !this.gamepadTurnWasLeft) this.registerTurn(-1);
    if (turnRight && !this.gamepadTurnWasRight) this.registerTurn(1);
    this.gamepadTurnWasLeft = turnLeft;
    this.gamepadTurnWasRight = turnRight;

    const jumpDown = pad.buttons[GAMEPAD_BUTTON_JUMP]?.pressed ?? false;
    if (jumpDown && !this.gamepadJumpWasDown) {
      this.gamepadJumpPending = true;
      this.anyInputSeen = true;
    }
    this.gamepadJumpWasDown = jumpDown;

    // East face button or d-pad down, so the duck is reachable whichever hand
    // the player steers with.
    const slideDown =
      (pad.buttons[GAMEPAD_BUTTON_SLIDE]?.pressed ?? false) ||
      (pad.buttons[GAMEPAD_BUTTON_DPAD_DOWN]?.pressed ?? false);
    if (slideDown && !this.gamepadSlideWasDown) {
      this.gamepadSlidePending = true;
      this.anyInputSeen = true;
    }
    this.gamepadSlideWasDown = slideDown;

    const pauseDown = pad.buttons[GAMEPAD_BUTTON_PAUSE]?.pressed ?? false;
    if (pauseDown && !this.gamepadPauseWasDown) {
      this.fireAction('pause');
      this.anyInputSeen = true;
    }
    this.gamepadPauseWasDown = pauseDown;
  }

  // ===========================================================================
  // Combination / update
  // ===========================================================================

  update(): void {
    // Keyboard and touch both book their inputs from their own event
    // handlers; the gamepad has no events, so it has to be polled here.
    this.readGamepad();

    // Two lanes in one frame is the most that can mean anything with three of
    // them, and clamping stops a stuck key banking an unbounded total.
    this.drive.laneStep = clamp(this.lanePending, -2, 2);
    this.drive.turn = this.turnPending;

    const jump = this.keyboardJumpPending || this.touchJumpPending || this.gamepadJumpPending;
    this.drive.jump = jump;
    if (jump) this.anyInputSeen = true;

    const slide =
      this.keyboardSlidePending || this.touchSlidePending || this.gamepadSlidePending;
    this.drive.slide = slide;
    if (slide) this.anyInputSeen = true;

    // Consume the pulses now that this frame has observed them - each pending
    // value represents "presses that happened since the last update()".
    this.lanePending = 0;
    this.turnPending = 0;
    this.keyboardJumpPending = false;
    this.touchJumpPending = false;
    this.gamepadJumpPending = false;
    this.keyboardSlidePending = false;
    this.touchSlidePending = false;
    this.gamepadSlidePending = false;
  }

  // ===========================================================================
  // Actions
  // ===========================================================================

  on(action: InputAction, handler: () => void): () => void {
    let set = this.actionHandlers.get(action);
    if (!set) {
      set = new Set();
      this.actionHandlers.set(action, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  private fireAction(action: InputAction): void {
    const set = this.actionHandlers.get(action);
    if (!set) return;
    for (const handler of set) {
      handler();
    }
  }

  consumeAnyInput(): boolean {
    const seen = this.anyInputSeen;
    this.anyInputSeen = false;
    return seen;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  clear(): void {
    this.keysDown.clear();
    this.keyboardJumpPending = false;
    this.keyboardSlidePending = false;
    this.touchJumpPending = false;
    this.touchSlidePending = false;
    this.swipeActivePointerId = null;
    this.swipeFired = false;
    this.swipeLastDirection = null;
    this.gamepadJumpPending = false;
    this.gamepadJumpWasDown = false;
    this.gamepadSlidePending = false;
    this.gamepadSlideWasDown = false;
    this.gamepadPauseWasDown = false;
    this.gamepadLaneWasLeft = false;
    this.gamepadLaneWasRight = false;
    this.gamepadTurnWasLeft = false;
    this.gamepadTurnWasRight = false;

    this.lanePending = 0;
    this.turnPending = 0;
    // Losing focus mid-corner must not leave half a double-tap armed.
    this.lastTapLeft = Number.NEGATIVE_INFINITY;
    this.lastTapRight = Number.NEGATIVE_INFINITY;

    this.drive.laneStep = 0;
    this.drive.turn = 0;
    this.drive.jump = false;
    this.drive.slide = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
    this.target.removeEventListener('selectstart', this.onSelectStart);

    if (this.swipeSurface) {
      this.swipeSurface.removeEventListener('pointerdown', this.onSwipePointerDown);
      this.swipeSurface.removeEventListener('pointermove', this.onSwipePointerMove);
      this.swipeSurface.removeEventListener('pointerup', this.onSwipePointerUp);
      this.swipeSurface.removeEventListener('pointercancel', this.onSwipePointerUp);
    }

    this.actionHandlers.clear();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

