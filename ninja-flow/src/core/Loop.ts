/**
 * Fixed-source game clock with real hit-stop.
 *
 * Hit-stop is a time-scale freeze, never a busy wait: the RAF loop keeps
 * running so the DOM HUD, deferred asset decoding and audio all stay alive.
 * Systems that must ignore slow-motion (UI animation, camera restore) read
 * `dtReal`; everything gameplay-facing reads `dt`.
 */
export interface Frame {
  /** Scaled delta — respects hit-stop and Flow slow-motion. */
  dt: number;
  /** Unscaled wall-clock delta, clamped against tab-switch spikes. */
  dtReal: number;
  /** Scaled time accumulated since the loop started. */
  time: number;
}

const MAX_DT = 1 / 20;

export class Loop {
  private raf = 0;
  private last = 0;
  private stopTimer = 0;
  private scale = 1;
  private targetScale = 1;
  private time = 0;
  private running = false;
  private readonly frame: Frame = { dt: 0, dtReal: 0, time: 0 };

  constructor(private readonly onFrame: (f: Frame) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Freeze gameplay time for `seconds`, then resume at the current scale. */
  hitStop(seconds: number): void {
    this.stopTimer = Math.max(this.stopTimer, seconds);
  }

  /** Sustained slow-motion, e.g. Flow Mode. Independent of hit-stop. */
  setTimeScale(scale: number): void {
    this.targetScale = scale;
  }

  get timeScale(): number {
    return this.scale;
  }

  /**
   * Advances the clock by hand. Development harness only: lets scripted
   * playthroughs step the game deterministically even when the browser
   * throttles RAF in a hidden tab. Production code never calls this.
   */
  step(dtRealSeconds: number): void {
    this.advance(Math.min(dtRealSeconds, MAX_DT));
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    const dtReal = Math.min((now - this.last) / 1000, MAX_DT);
    this.last = now;
    this.advance(dtReal);
  };

  private advance(dtReal: number): void {

    // Ease toward the target scale so entering/leaving Flow does not pop.
    this.scale += (this.targetScale - this.scale) * Math.min(1, dtReal * 9);

    let dt = dtReal * this.scale;
    if (this.stopTimer > 0) {
      this.stopTimer -= dtReal;
      dt = 0;
    }

    this.time += dt;
    this.frame.dt = dt;
    this.frame.dtReal = dtReal;
    this.frame.time = this.time;
    this.onFrame(this.frame);
  }
}
