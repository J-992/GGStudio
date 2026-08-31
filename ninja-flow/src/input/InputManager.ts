import { INPUT } from '../config';

export type Lane = 'left' | 'right';

/**
 * Unified keyboard + pointer input.
 *
 * Latency is the highest technical priority here, so presses are recorded on
 * `keydown`/`pointerdown` with a timestamp taken at the event, not at the next
 * frame. A press that arrives while the player is committed to an attack is
 * held in a one-slot buffer — never a queue, which would feel like input lag.
 */
export class InputManager {
  private buffered: { lane: Lane; at: number } | null = null;
  private enabled = false;
  private firstInputFired = false;
  private onFirstInput: (() => void) | null = null;
  private onPress: ((lane: Lane) => void) | null = null;
  private disposers: Array<() => void> = [];

  constructor(private readonly surface: HTMLElement) {}

  attach(): void {
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const lane = keyToLane(e.code);
      if (!lane) return;
      e.preventDefault();
      this.press(lane);
    };

    const pointer = (e: PointerEvent) => {
      // The game usually runs inside a portal's iframe, where a key press only
      // arrives once something in this document holds focus. Every touch of the
      // arena reclaims it, so a player who clicks the game before typing never
      // meets a dead keyboard.
      this.claimFocus();
      // Every finger counts. Two-thumb play is the normal way to hold a phone
      // for this game, and the second thumb's pointer is never the primary one
      // — filtering on `isPrimary` silently ate half a mobile player's taps.
      // Only a non-left mouse button is ignored; the synthetic mouse event that
      // follows a touch is already suppressed by preventDefault below.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const rect = this.surface.getBoundingClientRect();
      const lane: Lane = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
      this.press(lane);
    };

    const block = (e: Event) => e.preventDefault();
    // Rubber-band scrolling is only stolen from the arena itself. A menu list
    // or a wardrobe row is a real scroller and has to keep its own gestures.
    const blockDrag = (e: TouchEvent) => {
      if (e.target === this.surface) e.preventDefault();
    };

    // Claimed up front too: a first-time player is dropped straight into a run
    // with nothing to click, and their very first arrow key has to count.
    this.claimFocus();
    const refocus = () => {
      if (!document.hidden) this.claimFocus();
    };
    document.addEventListener('visibilitychange', refocus);

    window.addEventListener('keydown', key, { passive: false });
    this.surface.addEventListener('pointerdown', pointer, { passive: false });
    this.surface.addEventListener('contextmenu', block);
    this.surface.addEventListener('dragstart', block);
    // Stop rubber-band scrolling and double-tap zoom from stealing taps.
    document.addEventListener('touchmove', blockDrag, { passive: false });
    document.addEventListener('gesturestart', block as EventListener);

    this.disposers = [
      () => document.removeEventListener('visibilitychange', refocus),
      () => window.removeEventListener('keydown', key),
      () => this.surface.removeEventListener('pointerdown', pointer),
      () => this.surface.removeEventListener('contextmenu', block),
      () => this.surface.removeEventListener('dragstart', block),
      () => document.removeEventListener('touchmove', blockDrag as EventListener),
      () => document.removeEventListener('gesturestart', block as EventListener),
    ];
  }

  detach(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  /** Input is ignored entirely while disabled (ads, game over, cinematics). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.buffered = null;
  }

  /**
   * Registers the one-time user-gesture hook. The triggering control still
   * enters the buffer, so an arrow or tap that starts a run also attacks.
   */
  setFirstInputHandler(fn: () => void): void {
    this.onFirstInput = fn;
  }

  /**
   * Fires on every accepted press, at the DOM event rather than the next frame.
   *
   * Acknowledgement is not the same as resolution: a press that arrives mid
   * commitment still waits its turn in the buffer, but the player must see the
   * game react to their finger immediately or the control reads as dead.
   */
  setPressListener(fn: (lane: Lane) => void): void {
    this.onPress = fn;
  }

  /**
   * Consumes a pending press, reporting how long ago it physically happened.
   *
   * The age is REAL seconds, measured from the DOM event rather than the frame
   * that observes it. The caller converts that into game time, which recovers
   * sub-frame timing accuracy — a press 12 ms before a 16 ms frame boundary is
   * graded as 12 ms early, not as landing on the frame.
   */
  consume(): { lane: Lane; ageSeconds: number } | null {
    if (!this.buffered) return null;
    const ageSeconds = this.now() - this.buffered.at;
    if (ageSeconds * 1000 > INPUT.bufferMs) {
      this.buffered = null;
      return null;
    }
    const lane = this.buffered.lane;
    this.buffered = null;
    return { lane, ageSeconds };
  }

  /**
   * Pulls keyboard focus into this document, and into the arena within it.
   *
   * Both halves matter and neither throws when it is not allowed: `window.focus`
   * is what moves focus out of a host page and into the game's frame, and the
   * surface's own focus is what keeps it off any button that was clicked last.
   */
  private claimFocus(): void {
    try {
      window.focus();
      if (document.activeElement !== this.surface) this.surface.focus({ preventScroll: true });
    } catch {
      // A sandboxed or cross-origin host may refuse; the pointer still plays.
    }
  }

  /** Real-time clock, in seconds — unaffected by hit-stop or slow motion. */
  private now(): number {
    return performance.now() / 1000;
  }

  private press(lane: Lane): void {
    if (!this.firstInputFired) {
      this.firstInputFired = true;
      this.onFirstInput?.();
    }
    if (!this.enabled) return;
    this.onPress?.(lane);
    // One slot only. A newer press replaces an older one rather than stacking:
    // the player's latest intent is always the one that resolves.
    if (INPUT.maxBuffered >= 1) this.buffered = { lane, at: this.now() };
  }
}

function keyToLane(code: string): Lane | null {
  switch (code) {
    case 'KeyA':
    case 'ArrowLeft':
      return 'left';
    case 'KeyD':
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}
