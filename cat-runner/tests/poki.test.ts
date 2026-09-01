/**
 * The Poki event contract.
 *
 * These are the rules Poki's Inspector checks a build against, and the ones a
 * refactor of the state machine is most likely to break silently: nothing in
 * the game observes them, so a dropped `gameplayStart` shows up as a rejected
 * submission a week later rather than as a bug anyone can see while playing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** A stand-in for `window.PokiSDK` that records the order of everything it is told. */
class FakeSDK {
  calls: string[] = [];
  private initResolve!: (value: unknown) => void;
  readonly initPromise: Promise<unknown>;
  private breakResolve: (() => void) | null = null;

  constructor(private readonly failInit = false) {
    this.initPromise = new Promise((resolve) => {
      this.initResolve = resolve;
    });
  }

  init(): Promise<unknown> {
    this.calls.push('init');
    return this.failInit ? Promise.reject(new Error('blocked')) : this.initPromise;
  }

  /** Lets a test decide exactly when the SDK finishes coming up. */
  finishInit(): Promise<void> {
    this.initResolve(undefined);
    return this.initPromise.then(() => {});
  }

  setDebug(): void {
    this.calls.push('setDebug');
  }
  gameLoadingStart(): void {
    this.calls.push('gameLoadingStart');
  }
  gameLoadingFinished(): void {
    this.calls.push('gameLoadingFinished');
  }
  gameplayStart(): void {
    this.calls.push('gameplayStart');
  }
  gameplayStop(): void {
    this.calls.push('gameplayStop');
  }

  commercialBreak(): Promise<unknown> {
    this.calls.push('commercialBreak');
    return new Promise((resolve) => {
      this.breakResolve = () => resolve(undefined);
    });
  }

  /** Ends the ad that `commercialBreak()` started. */
  finishBreak(): Promise<void> {
    this.breakResolve?.();
    this.breakResolve = null;
    return Promise.resolve();
  }

  rewardedBreak(): Promise<boolean> {
    this.calls.push('rewardedBreak');
    return Promise.resolve(true);
  }
}

/**
 * The suite runs in plain Node (see vitest.config.ts), so the two browser
 * globals the wrapper touches are stubbed rather than pulling in jsdom for a
 * property lookup and a hostname. `hostname` defaults to the deployed case -
 * a test that wants the local-dev branch sets it explicitly.
 */
const globals = globalThis as Record<string, unknown>;

function stubBrowser(hostname = 'games.poki.com'): void {
  globals.location = { hostname };
  globals.window = globals;
}

/**
 * The wrapper is a module singleton, so every test needs its own copy - and
 * `window.PokiSDK` has to be in place before the module is first evaluated in
 * that copy's registry.
 */
async function freshPoki(sdk: FakeSDK | null) {
  vi.resetModules();
  if (sdk) globals.PokiSDK = sdk;
  else delete globals.PokiSDK;
  return (await import('../src/game/PokiSDK')).Poki;
}

beforeEach(() => {
  delete globals.PokiSDK;
  stubBrowser();
});

describe('Poki wrapper without an SDK', () => {
  it('is a complete no-op, so the game runs off-platform', async () => {
    const poki = await freshPoki(null);

    await expect(poki.init()).resolves.toBe(false);

    // None of these may throw - they are called from the game's hot paths.
    poki.loadingFinished();
    poki.gameplayStart();
    poki.gameplayStop();
    poki.happyTime();
    await expect(poki.commercialBreak()).resolves.toBeUndefined();
    await expect(poki.rewardedBreak()).resolves.toBe(false);
  });

  it('still runs the callback in startRun, so Play always starts a run', async () => {
    const poki = await freshPoki(null);
    const begin = vi.fn();
    poki.startRun(begin);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('starts every subsequent run too, even though an ad can never play', async () => {
    const poki = await freshPoki(null);
    const begin = vi.fn();
    poki.startRun(begin);
    poki.startRun(begin);
    await Promise.resolve();
    expect(begin).toHaveBeenCalledTimes(2);
  });
});

describe('Poki wrapper with a blocked SDK', () => {
  it('resolves false rather than rejecting when init is refused', async () => {
    const poki = await freshPoki(new FakeSDK(true));
    await expect(poki.init()).resolves.toBe(false);
  });

  /**
   * The Inspector failure this guards: "Does gameLoadingFinished() fire when
   * your game is done loading?"
   *
   * `flush()` used to be gated on init having *resolved*, so a refused init -
   * the ordinary ad-blocker case, and one that never happens on a developer's
   * own machine - silently suppressed every lifecycle event for the whole
   * session. The game still loaded and still played; it just went dark to
   * Poki, which is exactly the shape of failure nobody notices until a
   * submission is rejected.
   */
  it('still reports that loading finished, which the Inspector requires', async () => {
    const sdk = new FakeSDK(true);
    const poki = await freshPoki(sdk);

    await poki.init();
    poki.loadingFinished();

    expect(sdk.calls).toContain('gameLoadingFinished');
  });

  it('goes on reporting gameplay too, so a blocked session is not a silent one', async () => {
    const sdk = new FakeSDK(true);
    const poki = await freshPoki(sdk);

    await poki.init();
    poki.loadingFinished();
    poki.gameplayStart();
    poki.gameplayStop();

    expect(sdk.calls).toEqual([
      'gameLoadingStart',
      'init',
      'gameLoadingFinished',
      'gameplayStart',
      'gameplayStop',
    ]);
  });

  it('survives an SDK whose methods throw instead of failing cleanly', async () => {
    // A stubbed-out `window.PokiSDK` is not obliged to behave. One throwing
    // call must not take the game down, nor stop the events after it.
    const sdk = new FakeSDK();
    const throwing = {
      ...sdk,
      calls: sdk.calls,
      init: () => Promise.resolve(),
      gameLoadingStart: () => {
        throw new Error('nope');
      },
      gameLoadingFinished: () => {
        sdk.calls.push('gameLoadingFinished');
        throw new Error('nope');
      },
      gameplayStart: () => sdk.calls.push('gameplayStart'),
      gameplayStop: () => sdk.calls.push('gameplayStop'),
    };
    const poki = await freshPoki(throwing as unknown as FakeSDK);

    await poki.init();
    expect(() => poki.loadingFinished()).not.toThrow();
    poki.gameplayStart();

    // Fired once despite throwing - never retried on the next flush - and the
    // gameplay event behind it still got through.
    expect(sdk.calls.filter((c) => c === 'gameLoadingFinished')).toHaveLength(1);
    expect(sdk.calls).toContain('gameplayStart');
  });
});

describe('an SDK that never answers at all', () => {
  /**
   * The worst case, and the one a 5s race was already written for: `init()`
   * neither resolves nor rejects. The race only ever governed the promise
   * `main.ts` throws away, so before this the timeout did nothing for the
   * events - the game loaded, played, and reported none of it.
   */
  it('reports loading finished once the init timeout expires', async () => {
    vi.useFakeTimers();
    try {
      const sdk = new FakeSDK(); // initPromise is never resolved here
      const poki = await freshPoki(sdk);

      void poki.init();
      poki.loadingFinished();
      expect(sdk.calls).not.toContain('gameLoadingFinished');

      await vi.advanceTimersByTimeAsync(5_000);
      expect(sdk.calls).toContain('gameLoadingFinished');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not send it twice if the SDK answers after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const sdk = new FakeSDK();
      const poki = await freshPoki(sdk);

      void poki.init();
      poki.loadingFinished();
      await vi.advanceTimersByTimeAsync(5_000);
      await sdk.finishInit();

      expect(sdk.calls.filter((c) => c === 'gameLoadingFinished')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the boot race', () => {
  it('replays events raised before the SDK was ready, in order', async () => {
    const sdk = new FakeSDK();
    const poki = await freshPoki(sdk);
    void poki.init();

    // The whole loading screen and the first run happen while init() is still
    // outstanding. Nothing may reach the SDK yet...
    poki.loadingFinished();
    poki.gameplayStart();
    expect(sdk.calls).toEqual(['gameLoadingStart', 'init']);

    // ...and all of it must arrive the moment it answers.
    await sdk.finishInit();
    expect(sdk.calls).toEqual([
      'gameLoadingStart',
      'init',
      'gameLoadingFinished',
      'gameplayStart',
    ]);
  });

  it('never reports gameplay before loading finished', async () => {
    const sdk = new FakeSDK();
    const poki = await freshPoki(sdk);
    void poki.init();

    poki.gameplayStart();
    await sdk.finishInit();
    expect(sdk.calls).not.toContain('gameplayStart');

    poki.loadingFinished();
    expect(sdk.calls.slice(-2)).toEqual(['gameLoadingFinished', 'gameplayStart']);
  });

  it('collapses a start/stop pair that both happened before the SDK was up', async () => {
    const sdk = new FakeSDK();
    const poki = await freshPoki(sdk);
    void poki.init();

    poki.loadingFinished();
    poki.gameplayStart();
    poki.gameplayStop();

    await sdk.finishInit();
    // The SDK was never told gameplay was on, so it must not be told it stopped.
    expect(sdk.calls.filter((c) => c.startsWith('gameplay'))).toEqual([]);
  });
});

describe('no duplicate lifecycle events', () => {
  async function readyPoki() {
    const sdk = new FakeSDK();
    const poki = await freshPoki(sdk);
    void poki.init();
    await sdk.finishInit();
    poki.loadingFinished();
    sdk.calls.length = 0;
    return { sdk, poki };
  }

  it('sends only changes, however often the state machine repeats itself', async () => {
    const { sdk, poki } = await readyPoki();

    poki.gameplayStart();
    poki.gameplayStart();
    poki.gameplayStart();
    poki.gameplayStop();
    poki.gameplayStop();
    poki.gameplayStart();

    expect(sdk.calls).toEqual(['gameplayStart', 'gameplayStop', 'gameplayStart']);
  });

  it('fires gameLoadingFinished exactly once', async () => {
    const { sdk, poki } = await readyPoki();
    poki.loadingFinished();
    poki.loadingFinished();
    expect(sdk.calls).not.toContain('gameLoadingFinished');
  });
});

describe('ads', () => {
  async function readyPoki() {
    const sdk = new FakeSDK();
    const poki = await freshPoki(sdk);
    void poki.init();
    await sdk.finishInit();
    poki.loadingFinished();
    sdk.calls.length = 0;
    return { sdk, poki };
  }

  it('never shows an ad before the first run of a session', async () => {
    const { sdk, poki } = await readyPoki();
    poki.startRun(() => {});
    expect(sdk.calls).not.toContain('commercialBreak');
  });

  it('stops gameplay before the break and starts it after, never during', async () => {
    const { sdk, poki } = await readyPoki();

    poki.startRun(() => poki.gameplayStart()); // first run: no ad
    expect(sdk.calls).toEqual(['gameplayStart']);

    // The player dies and retries. The run must end, the ad must play over a
    // stopped game, and gameplay must only resume on the far side of it.
    poki.startRun(() => poki.gameplayStart());
    await Promise.resolve();
    expect(sdk.calls).toEqual(['gameplayStart', 'gameplayStop', 'commercialBreak']);

    await sdk.finishBreak();
    await Promise.resolve();
    await Promise.resolve();
    expect(sdk.calls).toEqual([
      'gameplayStart',
      'gameplayStop',
      'commercialBreak',
      'gameplayStart',
    ]);
  });

  it('freezes and unfreezes the game around a break, exactly once each', async () => {
    const { sdk, poki } = await readyPoki();
    const onAdStart = vi.fn();
    const onAdEnd = vi.fn();
    poki.onAdStart = onAdStart;
    poki.onAdEnd = onAdEnd;

    poki.startRun(() => {});
    poki.startRun(() => {});
    await Promise.resolve();

    expect(onAdStart).toHaveBeenCalledTimes(1);
    expect(onAdEnd).not.toHaveBeenCalled();
    expect(poki.adPlaying).toBe(true);

    await sdk.finishBreak();
    await Promise.resolve();
    await Promise.resolve();

    expect(onAdEnd).toHaveBeenCalledTimes(1);
    expect(poki.adPlaying).toBe(false);
  });

  it('suppresses gameplay events raised while an ad is on screen', async () => {
    const { sdk, poki } = await readyPoki();

    poki.startRun(() => {});
    poki.startRun(() => {});
    await Promise.resolve();
    sdk.calls.length = 0;

    // A stray start during the break - the one thing the Inspector rejects.
    poki.gameplayStart();
    expect(sdk.calls).toEqual([]);
  });

  it('always resolves startRun so a refused ad still begins the run', async () => {
    const { sdk, poki } = await readyPoki();
    const begin = vi.fn();

    poki.startRun(() => {});
    poki.startRun(begin);
    await Promise.resolve();
    expect(begin).not.toHaveBeenCalled();

    await sdk.finishBreak();
    await Promise.resolve();
    await Promise.resolve();
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('keeps a floor between interstitials', async () => {
    const { sdk, poki } = await readyPoki();

    poki.startRun(() => {});
    poki.startRun(() => {});
    await Promise.resolve();
    await sdk.finishBreak();
    await Promise.resolve();
    await Promise.resolve();

    // A third run seconds later must not carry a second ad.
    sdk.calls.length = 0;
    const begin = vi.fn();
    poki.startRun(begin);
    await Promise.resolve();
    expect(sdk.calls).not.toContain('commercialBreak');
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('refuses a rewarded break while a commercial one is running', async () => {
    const { poki } = await readyPoki();
    poki.startRun(() => {});
    poki.startRun(() => {});
    await Promise.resolve();
    await expect(poki.rewardedBreak()).resolves.toBe(false);
  });
});

describe('build hygiene', () => {
  it('never enables SDK debug logging on the served build', async () => {
    const sdk = new FakeSDK();
    const poki = await freshPoki(sdk);
    void poki.init();
    // `setDebug(true)` in a shipped build is a documented review failure.
    expect(sdk.calls).not.toContain('setDebug');
  });

  it('does enable it on localhost, so local runs are still inspectable', async () => {
    stubBrowser('localhost');
    const sdk = new FakeSDK();
    const poki = await freshPoki(sdk);
    void poki.init();
    expect(sdk.calls).toContain('setDebug');
  });

  it('starts the load-time clock before it asks the SDK to initialise', async () => {
    const sdk = new FakeSDK();
    const poki = await freshPoki(sdk);
    void poki.init();
    expect(sdk.calls.indexOf('gameLoadingStart')).toBeLessThan(sdk.calls.indexOf('init'));
  });
});

/**
 * The two ways a session can be reported as having no gameplay at all even
 * though the game ran and was played. Both are silent by construction: nothing
 * throws, nothing logs, and the game looks fine right up until the Inspector
 * says a version has no `gameplayStart` and the fit test cannot be started.
 */
describe('an SDK that is late rather than absent', () => {
  /** Enough of a `<script src=".../poki-sdk.js">` for the wrapper's look-up. */
  function stubSdkTag(present: boolean): void {
    globals.document = { querySelector: () => (present ? {} : null) };
  }

  it('picks up a PokiSDK that only appears after boot has looked for it', async () => {
    vi.useFakeTimers();
    stubSdkTag(true);
    try {
      const poki = await freshPoki(null);
      // Boot finds nothing and carries on - it must never wait on the SDK.
      await expect(poki.init()).resolves.toBe(false);

      // The tag lands a moment later, the way a slow CDN response does.
      const sdk = new FakeSDK();
      globals.PokiSDK = sdk;
      await vi.advanceTimersByTimeAsync(100);
      expect(sdk.calls).toContain('init');

      // ...and the session reports normally from there, which is the whole
      // point: this used to be a permanently dead wrapper.
      await sdk.finishInit();
      poki.loadingFinished();
      poki.gameplayStart();
      expect(sdk.calls).toContain('gameLoadingFinished');
      expect(sdk.calls).toContain('gameplayStart');
    } finally {
      vi.useRealTimers();
      delete globals.document;
    }
  });

  it('does not sit polling when the page has no SDK tag at all', async () => {
    vi.useFakeTimers();
    stubSdkTag(false);
    try {
      const poki = await freshPoki(null);
      await expect(poki.init()).resolves.toBe(false);
      // Off-platform is a supported state, not a wait: nothing is scheduled.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      delete globals.document;
    }
  });
});

describe('an ad break that never ends', () => {
  it('gives the game back rather than leaving it frozen for the session', async () => {
    vi.useFakeTimers();
    try {
      const sdk = new FakeSDK();
      const poki = await freshPoki(sdk);
      void poki.init();
      await sdk.finishInit();
      poki.loadingFinished();

      const onAdEnd = vi.fn();
      poki.onAdEnd = onAdEnd;

      poki.startRun(() => {}); // first run of the session: never an ad
      const begin = vi.fn();
      poki.startRun(begin); // second: an ad is requested and never finished
      await vi.advanceTimersByTimeAsync(0);

      // The loop is stopped and the audio suspended at this point. The v2 SDK
      // tag queues every call and replays it only once the real bundle
      // downloads, so a bundle that never arrives means this promise never
      // settles - and without the watchdog the game stays here for good.
      expect(poki.adPlaying).toBe(true);
      expect(begin).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(onAdEnd).toHaveBeenCalledTimes(1);
      expect(poki.adPlaying).toBe(false);
      // And the run the player asked for actually starts.
      expect(begin).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
