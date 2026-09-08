/**
 * Pure ad/gameplay sequencing rules for `platform/poki.js`.
 *
 * This is the single source of truth for whether a `gameplayStart()`/
 * `gameplayStop()` call is legal right now, and for the one invariant Poki's
 * own review checks first: **every ad break stops gameplay unconditionally,
 * before the SDK is ever touched.** Keeping this here (no `window`, no SDK,
 * no Promises tied to real timers) means the whole state machine is
 * unit-testable with `node --test` and nothing else — `platform/poki.js`
 * drives real `window.PokiSDK` calls from the booleans this returns, it
 * never re-implements the sequencing itself.
 *
 * `withWatchdog` lives here too: it is equally pure (no DOM/window — just
 * `setTimeout`/`Promise`, both plain JS runtime globals) and is what keeps a
 * hung SDK promise (Poki's `commercialBreak()`/`rewardedBreak()` never
 * settling) from freezing the game.
 */

export class AdGuard {
  constructor() {
    /** @type {boolean} Whether `gameplayStart()` has fired without a matching `gameplayStop()` yet. */
    this._started = false;
    /** @type {boolean} Whether an ad is currently playing. */
    this._adPlaying = false;
  }

  /** @returns {boolean} */
  get started() {
    return this._started;
  }

  /** @returns {boolean} */
  get adPlaying() {
    return this._adPlaying;
  }

  /** @returns {boolean} Whether calling `gameplayStart()` right now is legal — never during an ad, never a second time in a row. */
  canStart() {
    return !this._adPlaying && !this._started;
  }

  /** @returns {boolean} Whether calling `gameplayStop()` right now would do anything — false once already stopped (idempotent no-op territory). */
  canStop() {
    return this._started;
  }

  /**
   * Marks gameplay as started. A no-op (returns `false`, never throws) if
   * illegal right now — during an ad, or already started — so the caller
   * can skip the real SDK call and stay idempotent.
   * @returns {boolean} Whether this call actually transitioned stopped -> started.
   */
  start() {
    if (!this.canStart()) return false;
    this._started = true;
    return true;
  }

  /**
   * Marks gameplay as stopped. Idempotent: calling this twice in a row only
   * transitions (and only the caller's real SDK call fires) the first time.
   * @returns {boolean} Whether this call actually transitioned started -> stopped.
   */
  stop() {
    if (!this._started) return false;
    this._started = false;
    return true;
  }

  /**
   * Enters an ad break. **Unconditionally** stops gameplay first — this is
   * the central invariant every `commercialBreak()`/`rewardedBreak()` call
   * must go through before it ever touches the SDK — and marks an ad as
   * playing, which makes `canStart()` (and therefore `start()`) refuse for
   * as long as the ad lasts.
   * @returns {boolean} Whether gameplay had actually been running (so the
   *   caller knows whether a resume is even meaningful once the ad ends).
   */
  beginAd() {
    const wasStarted = this._started;
    this._started = false;
    this._adPlaying = true;
    return wasStarted;
  }

  /**
   * Leaves the ad break. Deliberately does NOT resume gameplay itself —
   * `canStart()` becomes legal again the instant this returns, but whether
   * to actually call `start()` is a decision only whoever owns the current
   * game state (build/wave vs. title/death/runEnd) can make.
   */
  endAd() {
    this._adPlaying = false;
  }
}

/**
 * Runs `factory()` and resolves with whatever it resolves to, unless `ms`
 * elapses first — then resolves with `fallback` instead, so a hung Promise
 * (an ad SDK call that never settles) can never freeze the caller. If the
 * overrun promise eventually settles anyway, its result is simply ignored —
 * nothing awaits it further and nothing double-resolves.
 *
 * @template T
 * @param {() => Promise<T>} factory
 * @param {number} ms
 * @param {T} fallback
 * @returns {Promise<T>}
 */
export function withWatchdog(factory, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);

    Promise.resolve()
      .then(factory)
      .then(
        (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(fallback);
        },
      );
  });
}
