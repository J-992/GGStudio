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
  private onFirstInput: (() => boolean | void) | null = null;
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
      // Ignore synthetic mouse events that follow a touch on hybrid devices.
      if (!e.isPrimary) return;
      e.preventDefault();
      const rect = this.surface.getBoundingClientRect();
      const lane: Lane = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
      this.press(lane);
    };

    const block = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', key, { passive: false });
    this.surface.addEventListener('pointerdown', pointer, { passive: false });
    this.surface.addEventListener('contextmenu', block);
    this.surface.addEventListener('dragstart', block);
    // Stop rubber-band scrolling and double-tap zoom from stealing taps.
    document.addEventListener('touchmove', block, { passive: false });
    document.addEventListener('gesturestart', block as EventListener);

    this.disposers = [
      () => window.removeEventListener('keydown', key),
      () => this.surface.removeEventListener('pointerdown', pointer),
      () => this.surface.removeEventListener('contextmenu', block),
      () => this.surface.removeEventListener('dragstart', block),
      () => document.removeEventListener('touchmove', block),
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
   * Registers the one-time user-gesture hook. Returning false consumes that
   * gesture, which lets a "tap to begin" wake the run without also whiffing.
   */
  setFirstInputHandler(fn: () => boolean | void): void {
    this.onFirstInput = fn;
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

  /** Real-time clock, in seconds — unaffected by hit-stop or slow motion. */
  private now(): number {
    return performance.now() / 1000;
  }

  private press(lane: Lane): void {
    let acceptAsGameplay = true;
    if (!this.firstInputFired) {
      this.firstInputFired = true;
      acceptAsGameplay = this.onFirstInput?.() !== false;
    }
    if (!this.enabled || !acceptAsGameplay) return;
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
