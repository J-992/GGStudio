/**
 * ============================================================================
 * Poki SDK wrapper
 * ============================================================================
 *
 * The one place in the codebase that knows Poki exists. Gameplay code never
 * touches `window.PokiSDK`; it calls the methods here, and everything degrades
 * to a no-op when the SDK is absent - offline, behind an ad blocker, or served
 * from a plain folder - so the game stays fully playable off-platform. That is
 * a hard Poki requirement, not a nicety.
 *
 * Two rules shape this file.
 *
 * Ads never play over a live game. `adStart()` ends the gameplay session,
 * sleeps the loop and silences audio before the SDK is asked for a break, and
 * undoes all three afterwards.
 *
 * And no lifecycle event is ever dropped. The game boots on a race between
 * `PokiSDK.init()` and a 5s timeout, so the player can already be running while
 * the SDK is still coming up. Calls made in that window are recorded, not
 * thrown away, and replayed in order the moment the SDK answers - a
 * `gameplayStart` lost there is the one event Poki's Inspector will not pass a
 * build without. The same rule covers an SDK that is not merely slow to answer
 * but not there yet at all: see `watchForSdk()`.
 *
 * `flush()` is the single place that talks to the SDK about state, comparing
 * what the game is doing against what the SDK has been told. Duplicate
 * `gameplayStart`/`gameplayStop` pairs - an Inspector warning - are therefore
 * structurally impossible rather than merely avoided at each call site.
 */

/** The subset of the Poki SDK this game uses. */
interface PokiSDKGlobal {
  init(): Promise<unknown>;
  setDebug?(enabled: boolean): void;
  gameLoadingStart?(): void;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(): Promise<unknown>;
  rewardedBreak(): Promise<boolean>;
  happyTime?(value: number): void;
  openExternalLink?(url: string): void;
}

/** Minimum gap between interstitials, in ms. */
const AD_MIN_GAP = 60_000;

/**
 * Longest an ad break may leave the game frozen before it is resumed anyway.
 *
 * `adStart()` stops the render loop and suspends audio, and hands control back
 * only when the SDK's promise settles. The v2 SDK tag is a stub that *queues*
 * every call and replays it once the real bundle downloads and `init()`
 * resolves - so if that bundle never arrives, `commercialBreak()` neither
 * resolves nor rejects, and the game sits frozen and silent for the rest of the
 * session with no error anywhere. A real interstitial is well under this, so
 * the only thing the watchdog ever cuts short is a break that was never going
 * to end.
 */
const AD_WATCHDOG = 60_000;

/** Never let a hung SDK hold up the boot. */
const INIT_TIMEOUT = 5_000;

/**
 * How long to keep watching for a `window.PokiSDK` that was not there yet, and
 * how often to look.
 *
 * The SDK tag is a blocking `<script>` in the document head, so by the time the
 * module bundle runs the global is normally already up. Normally is not always:
 * a slow CDN response, a request that failed and was retried by the browser, or
 * a host that injects the tag itself all leave a window where it is missing -
 * and boot happens to be exactly when this file looks. See {@link waitForSdk}.
 */
const SDK_WAIT_TIMEOUT = 10_000;
const SDK_POLL_INTERVAL = 100;

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])$/;

class PokiIntegration {
  /**
   * True once `init()` has *settled* - resolved, rejected, or timed out.
   *
   * Deliberately not "resolved successfully". This gates `flush()`, so an
   * `init()` that rejected (ad blocker) or never answered at all used to
   * suppress `gameLoadingFinished` permanently, which is the one thing
   * Poki's Inspector will not pass a build without - and it fails closed, in
   * exactly the conditions hardest to reproduce locally. Poki's own reference
   * integration carries on loading from both the `then` and the `catch` for
   * the same reason: the game finished loading whatever the SDK made of it,
   * so the event is true and has to be sent.
   */
  private settled = false;

  /** True while a commercial or rewarded break is on screen. */
  adPlaying = false;

  /** True while {@link watchForSdk} has a look scheduled. */
  private watching = false;

  // What the game is doing, versus what the SDK has been told about it. The
  // gap between the two pairs is what lets events survive the boot race.
  private gameplayOn = false;
  private sentGameplay = false;
  private loadingDone = false;
  private sentLoading = false;

  private runsStarted = 0;
  private lastAdAt = 0;

  /** Wired to the game by `Game.init()`. Defaults are safe no-ops. */
  onAdStart: () => void = () => {};
  onAdEnd: () => void = () => {};

  private get sdk(): PokiSDKGlobal | null {
    return (window as unknown as { PokiSDK?: PokiSDKGlobal }).PokiSDK ?? null;
  }

  /**
   * Runs one SDK call, swallowing anything it throws.
   *
   * An ad-blocked or stubbed `window.PokiSDK` is not required to behave: a
   * method can be missing, or present and throwing. Nothing the SDK does may
   * take the game down with it, and - because `flush()` sends several events
   * in a row - one throwing call must not stop the ones after it.
   */
  private safely(call: () => void): void {
    try {
      call();
    } catch {
      /* Playing on without Poki is a supported state, not an error. */
    }
  }

  /**
   * Same idea as {@link safely} for the two calls that return a promise, and
   * the reason nothing downstream of an ad has to handle failure.
   *
   * `adStart()` has already frozen and silenced the game by the time either is
   * invoked, so the resume is owed unconditionally - and there are three ways
   * to be denied it, not one. The call can throw synchronously rather than
   * rejecting, which skips past any `.then`. It can reject. Or it can simply
   * never settle, which is the one that costs a session: see
   * {@link AD_WATCHDOG}. All three land here as a resolved `undefined`, so the
   * returned promise always settles and the caller only ever needs a `.then`.
   */
  private breakOf<T>(call: () => Promise<T>): Promise<T | undefined> {
    let settle!: (value: T | undefined) => void;
    const guarded = new Promise<T | undefined>((resolve) => {
      settle = resolve;
    });

    // Resolving an already-resolved promise is a no-op, so whichever of the
    // three paths lands first wins and the rest are free.
    const watchdog = setTimeout(() => settle(undefined), AD_WATCHDOG);
    const done = (value: T | undefined): void => {
      clearTimeout(watchdog);
      settle(value);
    };

    try {
      call().then(done, () => done(undefined));
    } catch {
      done(undefined);
    }

    return guarded;
  }

  /**
   * Resolves once the SDK has answered - or immediately when there is none.
   *
   * Never rejects: an ad-blocked `init()` just means "play on without ads",
   * and the caller must not branch on the result.
   */
  init(): Promise<boolean> {
    const sdk = this.sdk;
    if (!sdk) {
      this.watchForSdk();
      return Promise.resolve(false);
    }

    // Local dev only. A build that ships with this on fails review.
    if (LOCAL_HOSTS.test(location.hostname)) this.safely(() => sdk.setDebug?.(true));

    // Load time is measured from here, so it goes in before init() answers.
    this.safely(() => sdk.gameLoadingStart?.());

    // Every path through here opens the gate, because the game keeps loading
    // down every one of them - see `settled`. Whichever lands first wins; the
    // rest are no-ops, since `flush()` only ever sends a change.
    const settle = (ok: boolean): boolean => {
      this.settled = true;
      this.flush();
      return ok;
    };

    let ready: Promise<boolean>;
    try {
      ready = sdk.init().then(
        () => settle(true),
        () => settle(false),
      );
    } catch {
      // A synchronous throw from init() itself, which `.catch` never sees.
      ready = Promise.resolve(settle(false));
    }

    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(settle(false)), INIT_TIMEOUT);
    });

    return Promise.race([ready, timeout]);
  }

  /**
   * True when the document is *expecting* a Poki SDK - i.e. the tag for one is
   * in the markup. The difference between "the SDK is late" and "there is no
   * SDK here at all", which is what decides whether {@link watchForSdk} has
   * anything to wait for.
   */
  private get sdkExpected(): boolean {
    return (
      typeof document !== 'undefined' &&
      document.querySelector('script[src*="poki-sdk"]') !== null
    );
  }

  /**
   * Keeps looking for a `window.PokiSDK` that was not there when boot looked,
   * and runs {@link init} the moment it appears.
   *
   * Finding no SDK used to be *permanent*: `settled` was never set, so
   * `flush()` refused for the rest of the session and neither
   * `gameLoadingFinished` nor `gameplayStart` was ever sent - however soon
   * after boot the SDK turned up, and however much the player then played.
   * That is the Inspector failure with a fit test behind it, and it fails
   * closed in exactly the conditions hardest to reproduce locally, where the
   * tag is served from the same host as the page and is always instant.
   *
   * The tag is a blocking `<script>` in the head, so this should never have
   * anything to do. Should never is not never: a CDN response slow enough to
   * be retried, a host that injects the tag itself, or an extension that
   * defers third-party scripts all open the same window, and boot is exactly
   * when this file looks.
   *
   * Bounded, and only started when the markup says an SDK is coming: a
   * genuinely absent one (offline, ad blocker, the game served from a plain
   * folder) has to settle into the supported no-op state rather than leave a
   * timer running behind the game for the rest of the session.
   */
  private watchForSdk(): void {
    if (this.watching || !this.sdkExpected) return;
    this.watching = true;

    const deadline = Date.now() + SDK_WAIT_TIMEOUT;
    const look = (): void => {
      if (this.sdk) {
        this.watching = false;
        void this.init();
        return;
      }
      if (Date.now() >= deadline) {
        this.watching = false;
        return;
      }
      setTimeout(look, SDK_POLL_INTERVAL);
    };

    setTimeout(look, SDK_POLL_INTERVAL);
  }

  /**
   * The only method that fires the SDK's state events. Everything else records
   * what the game did and calls this, which sends whatever the SDK has not
   * heard yet - including anything recorded before it was ready.
   */
  private flush(): void {
    const sdk = this.sdk;
    if (!this.settled || !sdk) return;

    if (this.loadingDone && !this.sentLoading) {
      // Marked sent before the call, not after: a throwing SDK must not leave
      // this retrying `gameLoadingFinished` on every later flush.
      this.sentLoading = true;
      this.safely(() => sdk.gameLoadingFinished());
    }

    // Gameplay never precedes the end of loading, whichever order the game
    // happened to reach them in.
    if (!this.sentLoading) return;

    const playing = this.gameplayOn && !this.adPlaying;
    if (playing === this.sentGameplay) return;

    this.sentGameplay = playing;
    this.safely(() => (playing ? sdk.gameplayStart() : sdk.gameplayStop()));
  }

  /** Loading screen finished. Conversion-to-play is measured against this. */
  loadingFinished(): void {
    this.loadingDone = true;
    this.flush();
  }

  /** Both are safe to call twice - `flush()` only ever sends a change. */
  gameplayStart(): void {
    this.gameplayOn = true;
    this.flush();
  }

  gameplayStop(): void {
    this.gameplayOn = false;
    this.flush();
  }

  /** A moment of joy. Helps Poki schedule ads away from one. */
  happyTime(value = 1): void {
    if (this.settled) this.safely(() => this.sdk?.happyTime?.(value));
  }

  /**
   * Every path into a run goes through here, so the rule about when an
   * interstitial may play lives in one place: end the previous gameplay
   * session, show an ad if one is due, then start.
   *
   * Ending the session *before* the ad rather than after matters - otherwise
   * the ad's resume reports a few milliseconds of "gameplay" that the run
   * change immediately stops again, which the Inspector flags as a duplicate.
   *
   * The session's first run never carries an ad: nobody should meet one before
   * they have played.
   */
  startRun(begin: () => void): void {
    this.gameplayStop();

    const first = this.runsStarted === 0;
    this.runsStarted++;

    if (first) {
      begin();
      return;
    }

    void this.commercialBreak().then(begin);
  }

  /**
   * Interstitial. Only ever called between runs, never mid-run, and always
   * resolves so the caller can start the run either way.
   *
   * The gap here is a floor to protect the feel of a retry loop that can turn
   * over in seconds - not frequency capping. Poki still decides whether any
   * given call shows an ad at all.
   */
  commercialBreak(): Promise<void> {
    const sdk = this.sdk;
    if (!this.settled || !sdk || this.adPlaying) return Promise.resolve();
    if (this.lastAdAt && Date.now() - this.lastAdAt < AD_MIN_GAP) return Promise.resolve();

    const resume = this.adStart();
    return this.breakOf(() => sdk.commercialBreak()).then(() => {
      this.lastAdAt = Date.now();
      resume();
    });
  }

  /**
   * Rewarded video. Resolves true only when the player watched it through.
   *
   * Call from an explicit player click, never automatically, and never for
   * anything that gates core progression.
   */
  rewardedBreak(): Promise<boolean> {
    const sdk = this.sdk;
    if (!this.settled || !sdk || this.adPlaying) return Promise.resolve(false);

    const resume = this.adStart();
    return this.breakOf(() => sdk.rewardedBreak()).then((success) => {
      this.lastAdAt = Date.now();
      resume();
      return success === true;
    });
  }

  /** The only legal way to leave the page. */
  openExternalLink(url: string): void {
    const sdk = this.sdk;
    if (this.settled && sdk?.openExternalLink) {
      try {
        sdk.openExternalLink(url);
        return;
      } catch {
        // Fall through: a link the player asked for still has to open.
      }
    }
    window.open(url, '_blank', 'noopener');
  }

  /** Freezes and silences the game for the duration of an ad. Returns the undo. */
  private adStart(): () => void {
    const wasPlaying = this.gameplayOn;
    if (wasPlaying) this.gameplayStop();

    this.adPlaying = true;
    this.onAdStart();

    return () => {
      this.adPlaying = false;
      this.onAdEnd();
      if (wasPlaying) this.gameplayStart();
    };
  }
}

export const Poki = new PokiIntegration();
