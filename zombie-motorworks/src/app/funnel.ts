/**
 * Where players stop playing.
 *
 * This is a retention funnel, not a debug log. Nothing here measures the
 * simulation — `VehicleTelemetry` and `SurvivalMode.debugTelemetry` already do
 * that, and they never leave the machine. What this records is the far coarser
 * question a portal listing lives or dies on: of everyone who loaded the page,
 * how many reached the garage, how many deployed, how many cleared wave one,
 * and where the rest went.
 *
 * Three rules keep the numbers readable, all three learned the hard way on
 * Merge Ninja:
 *
 * 1. **Paired shapes.** Progress is `start` then `complete` or `fail`; a
 *    one-off fact is `reached`. A dashboard column that counts starts against
 *    completes is only meaningful when every start eventually gets one of the
 *    two, so a wave that fails must not also be left open, and a wave already
 *    cleared must never be failed on the way out.
 * 2. **Once per session.** A funnel asks "what fraction of players got here",
 *    which is a question about players, not about visits. Every checkpoint is
 *    deduplicated by its own key, so a player who opens the garage forty times
 *    counts once and a run that clears sixty waves does not drown the signal.
 * 3. **A small label set.** Cardinality is the thing that makes a funnel
 *    unreadable — and, on a metered sink, expensive. Waves are named exactly
 *    while the drop-off is steep and banded once it flattens; see `waveLabel`.
 *
 * The module is deliberately free of DOM, storage, SDK and timer access: the
 * caller feeds it frame deltas and lifecycle calls, and one injected sink
 * decides where the measures actually go. That is what makes the whole funnel
 * testable without a browser, and what lets a build with no analytics at all
 * pass a sink that does nothing.
 */

/**
 * The verbs, and only these.
 *
 * `abandon` is deliberately distinct from `fail`: a run the player walked out
 * of is a retention fact, a run the zombies ended is a difficulty fact, and
 * collapsing them hides whichever one is the actual problem.
 */
export type FunnelAction =
  | 'start'
  | 'complete'
  | 'fail'
  | 'abandon'
  | 'reached';

export interface FunnelMeasure {
  readonly category: string;
  readonly what: string;
  readonly action: FunnelAction;
}

export type FunnelSink = (measure: FunnelMeasure) => void;

/**
 * The screens a player can be looking at.
 *
 * One per place a session can end, which is what makes the exit beacon worth
 * reading. `chamber` is the Test Chamber, `survival` is any live wave, and the
 * first-play celebration is its own screen because leaving on it means the
 * tutorial wave worked and the game still lost the player.
 */
export type FunnelScreen =
  | 'title'
  | 'garage'
  | 'chamber'
  | 'survival'
  | 'first-play-victory'
  | 'game-over';

/** Where a run stopped. Mirrors the three ways `App` can end one. */
export type RunOutcomeKind = 'complete' | 'fail' | 'abandon';

/** The garage's own friction points, named for what they cost the player. */
export type GarageEvent =
  | 'deploy'
  | 'rig-ready'
  | 'test-drive'
  | 'part-bought'
  | 'part-placed'
  | 'save-and-quit';

/**
 * Places a live wave loses its grip on the player.
 *
 * None of these end a session by themselves — they are all things the game
 * offers on purpose — but each one is a moment the player stopped fighting to
 * do something else, and a wave that produces a lot of them is a wave that is
 * not working. `bench-trip` is the sandbox's build-test-change loop and is
 * expected; `garage-mid-wave` forfeits a campaign wave and is not.
 */
export type FrictionEvent =
  | 'pause'
  | 'reset-wave'
  | 'bench-trip'
  | 'garage-mid-wave';

/** Boot stages, mirrored from `bootSplash.ts` so the funnel owns no timing. */
export type FunnelBootStage = string;

/**
 * Waves named exactly, because this is where the curve is steep.
 *
 * Anything past here is banded (`waveLabel`): a player who reaches wave forty
 * is not the player we are losing, and one label per wave for an endless mode
 * would be an unbounded label set.
 */
const EXACT_WAVE_LIMIT = 12;

/** Round numbers worth keeping past the early game. */
const WAVE_MILESTONES: readonly number[] = [15, 20, 25, 30, 40, 50, 75, 100];

/** Bands for everything between and after the milestones. */
const WAVE_BANDS: readonly (readonly [number, number])[] = [
  [13, 19],
  [21, 24],
  [26, 29],
  [31, 39],
  [41, 49],
  [51, 74],
  [76, 99],
];

/**
 * Seconds of *active* play worth marking.
 *
 * Active means a wave is running: menus, the garage and the game-over card are
 * excluded, because time spent deciding is not time spent playing and a portal
 * measures the same way. The marks are dense early for the same reason waves
 * are named exactly early.
 */
const PLAYTIME_MARKS: readonly number[] = [30, 60, 120, 300, 600, 1200];

/** Seconds on one screen worth marking. A garage nobody deploys out of is a leak. */
const DWELL_MARKS: readonly number[] = [30, 60, 120, 300];

/**
 * Turn a wave number into a label from a small fixed set.
 *
 * Exact up to `EXACT_WAVE_LIMIT`, exact on each milestone, banded in between,
 * and `100+` past the last band — so an endless run that reaches wave 900 adds
 * no labels at all.
 */
export function waveLabel(wave: number): string {
  const n = Number.isFinite(wave) ? Math.floor(wave) : 1;
  if (n <= 1) return '1';
  if (n <= EXACT_WAVE_LIMIT) return String(n);
  if (WAVE_MILESTONES.includes(n)) return String(n);
  for (const [lo, hi] of WAVE_BANDS) {
    if (n >= lo && n <= hi) return `${lo}-${hi}`;
  }
  return '100+';
}

export class RetentionFunnel {
  /**
   * A hard ceiling on one session's events.
   *
   * Every checkpoint is already deduplicated, so a normal session lands well
   * under this — an hour of endless waves is a few dozen measures. The cap
   * exists for the case the dedup is defeated by something nobody predicted,
   * on a sink that is billed per event.
   */
  static readonly maxEventsPerSession = 250;

  private readonly sent = new Set<string>();
  private count = 0;

  private screen: FunnelScreen | null = null;
  private screenMs = 0;
  private activePlayMs = 0;

  private mode: string | null = null;
  /** The wave that has an unmatched `start`. Null once it is closed. */
  private openWave: number | null = null;
  /** The last wave seen at all, so the exit beacon can name it. */
  private lastWave: number | null = null;
  private runOpen = false;

  private sink: FunnelSink | null;
  /**
   * Measures reported before a sink existed.
   *
   * Boot stages are the whole reason this is here: they are the earliest and
   * most valuable part of the funnel — a player lost to a slow load never
   * reaches anything else — but the sink they eventually go to depends on the
   * portal SDK, which is deliberately not on the boot path. So the recorder
   * runs from the first line of `main.ts` and holds what it has until
   * `connect` arrives. Bounded by the same session cap as everything else.
   */
  private readonly buffered: FunnelMeasure[] = [];

  constructor(sink: FunnelSink | null = null) {
    this.sink = sink;
  }

  /**
   * Attach the real sink and replay everything reported before it existed.
   *
   * Called once, from `funnelSink.ts`, at the point the portal seam is loaded.
   */
  connect(sink: FunnelSink): void {
    this.sink = sink;
    const replay = this.buffered.splice(0, this.buffered.length);
    for (const measure of replay) this.emit(measure);
  }

  // ---------- boot ----------

  /** One measure per boot stage; the gaps are where a cold load loses people. */
  bootStage(stage: FunnelBootStage): void {
    this.send('boot', stage, 'reached');
  }

  // ---------- screens ----------

  /**
   * The player is now looking at `screen`.
   *
   * Re-entering a screen restarts its dwell clock but reports nothing: the
   * question the funnel answers is whether a player ever got here.
   */
  enterScreen(screen: FunnelScreen): void {
    if (this.screen === screen) return;
    this.screen = screen;
    this.screenMs = 0;
    this.send('screen', screen, 'start');
  }

  // ---------- runs and waves ----------

  /**
   * A run has begun in `mode`.
   *
   * The mode is remembered rather than passed on every wave call, so a wave
   * label can never disagree with the mode that opened it.
   */
  startMode(mode: string): void {
    this.endRun('abandon');
    this.mode = mode;
    this.runOpen = true;
    this.send('mode', mode, 'start');
  }

  /**
   * A wave is live.
   *
   * Closes any wave still open first — an endless mode rolls straight from one
   * wave into the next without a clear — so `start` and its answer stay paired
   * however the waves are chained together.
   */
  startWave(wave: number): void {
    if (this.openWave !== null && this.openWave !== wave) {
      this.closeWave(this.openWave, 'complete');
    }
    this.openWave = wave;
    this.lastWave = wave;
    this.send('wave', this.waveWhat(wave), 'start');
  }

  /** The wave was cleared. */
  completeWave(wave: number): void {
    this.closeWave(wave, 'complete');
  }

  /** The rig died on this wave. */
  failWave(wave: number): void {
    this.closeWave(wave, 'fail');
  }

  /**
   * The run is over, however it ended.
   *
   * Closes the live wave with the same verdict before closing the run, so a
   * player who quit on wave nine reads as an abandon at wave nine rather than
   * a wave that simply stops being mentioned. Safe to call when no run is
   * open, which is what lets every exit path call it blindly.
   */
  endRun(outcome: RunOutcomeKind): void {
    if (!this.runOpen) return;
    if (this.openWave !== null) this.closeWave(this.openWave, outcome);
    if (this.mode !== null) this.send('mode', this.mode, outcome);
    this.runOpen = false;
  }

  // ---------- the garage ----------

  /** One of the build screen's friction points. */
  garage(event: GarageEvent): void {
    this.send('garage', event, 'reached');
  }

  /** A moment the live wave lost the player's attention. */
  friction(event: FrictionEvent): void {
    this.send('friction', event, 'reached');
  }

  tourStart(): void {
    this.send('tour', 'onboarding', 'start');
  }

  /** A tour step the player actually performed — buy, attach, fight. */
  tourStep(id: string): void {
    this.send('tour', id, 'reached');
  }

  tourComplete(): void {
    this.send('tour', 'onboarding', 'complete');
  }

  /** The tour was dismissed before its last step. */
  tourAbandoned(step: string): void {
    this.send('tour', 'onboarding', 'abandon');
    this.send('tour-exit', step, 'reached');
  }

  // ---------- the first-play wave ----------

  /** Which door the player took out of the tutorial celebration. */
  firstPlayExit(door: 'survival' | 'creative'): void {
    this.send('first-play', door, 'reached');
  }

  // ---------- time ----------

  /**
   * Advance both clocks by one frame.
   *
   * `playing` is the same fact the portal is told through
   * `setPlatformGameplayActive`: a live wave, not a menu, a pause or a result
   * card. Screen dwell runs regardless, because a player sitting on a screen
   * doing nothing is exactly the case worth catching.
   */
  tick(dtMs: number, playing: boolean): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    // A tab that was backgrounded for ten minutes comes back with one enormous
    // delta. Counting it would report a play session nobody played.
    const dt = Math.min(dtMs, 1_000);

    if (this.screen !== null) {
      this.screenMs += dt;
      const screen = this.screen;
      for (const mark of DWELL_MARKS) {
        if (this.screenMs >= mark * 1_000) {
          this.send('dwell', `${screen}-${mark}s`, 'reached');
        }
      }
    }

    if (!playing) return;
    this.activePlayMs += dt;
    for (const mark of PLAYTIME_MARKS) {
      if (this.activePlayMs >= mark * 1_000) {
        this.send('playtime', `${mark}s`, 'reached');
      }
    }
  }

  // ---------- leaving ----------

  /**
   * The page is going away. Name the last thing the player was looking at.
   *
   * Deduplicated on the full state, so a tab hidden and reopened on the same
   * screen reports once, while a player who leaves the title, comes back and
   * later leaves mid-wave contributes both facts. Treat this as a supplement
   * to the reached-counts above rather than the primary reading: a beacon sent
   * during teardown is the one measure that can be dropped in flight.
   */
  leave(): void {
    if (this.screen === null) return;
    this.send('exit', this.screen, 'reached');
    if (this.screen === 'survival' && this.lastWave !== null) {
      this.send('exit-wave', this.waveWhat(this.lastWave), 'reached');
    }
  }

  // ---------- verification ----------

  /** Everything this session has reported, for the debug seam. */
  debugLog(): string[] {
    return [...this.sent];
  }

  // ---------- internals ----------

  private closeWave(wave: number, outcome: RunOutcomeKind): void {
    if (this.openWave === null) return;
    this.openWave = null;
    this.send('wave', this.waveWhat(wave), outcome);
  }

  private waveWhat(wave: number): string {
    return `${this.mode ?? 'campaign'}-${waveLabel(wave)}`;
  }

  private send(category: string, what: string, action: FunnelAction): void {
    const key = `${category}:${what}:${action}`;
    if (this.sent.has(key)) return;
    if (this.count >= RetentionFunnel.maxEventsPerSession) return;
    this.sent.add(key);
    this.count += 1;
    this.emit({ category, what, action });
  }

  private emit(measure: FunnelMeasure): void {
    const sink = this.sink;
    if (sink === null) {
      this.buffered.push(measure);
      return;
    }
    // A sink is a network call behind an ad blocker, a portal SDK that never
    // arrived, or a browser with storage disabled. None of those are the
    // game's problem, and none of them may reach a caller mid-wave.
    try {
      sink(measure);
    } catch {
      /* analytics are never worth a frame */
    }
  }
}

/**
 * The game's funnel.
 *
 * A module singleton rather than something threaded through constructors: the
 * callers are screen transitions scattered across `App`, `EditorMode` and
 * `SurvivalMode`, and a funnel that some of them could be holding a different
 * instance of would silently report a broken session. It starts with no sink
 * and buffers, so importing it costs a cold boot one small module and no
 * network at all; `funnelSink.ts` connects the real one. Tests build their own
 * `RetentionFunnel` with their own sink and never touch this.
 */
export const funnel = new RetentionFunnel();
