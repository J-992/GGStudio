// Poki SDK wrapper. Every call degrades to a no-op when the SDK is unavailable
// (offline, ad blocker, or serving the folder yourself), so the game stays
// fully playable off-platform.
//
// Ads never play over a live game: the interstitial slot is the rebirth
// confirmation (a natural break), and while an ad runs the game loop sleeps
// and audio is suspended. The rewarded slot is the optional income-frenzy
// button; nothing in the game requires watching it.
//
// Two rules this file exists to keep, both learned from a failed Inspector run:
//
//   1. No SDK call may throw into game code. `gameLoadingStart()` was being
//      called before `init()` had resolved; when the live SDK rejects that, the
//      exception propagated out of main.js and Phaser was never constructed --
//      so the game did not load at all, and gameLoadingFinished could not fire.
//      Everything now goes through _call/_callAsync, which swallow.
//
//   2. gameLoadingFinished must reach the SDK even when init does not resolve.
//      It used to be gated on `ready`, so an init that hung or rejected meant
//      the call was recorded and never sent. It is now attempted as soon as
//      loading is done, and sent again once init resolves so a pre-init call
//      the SDK ignored is not the only one it ever got.
const Poki = {
  ready: false,
  _degraded: false,         // init settled as a failure; send loading anyway
  adPlaying: false,
  _gameplayOn: false,
  _sentGameplay: false,
  _loadingDone: false,
  _sentLoading: false,      // true only once delivered to an initialised SDK
  _lastAdAt: 0,

  get sdk() { return window.PokiSDK || null; },

  // Guarded call. The SDK is third-party code loaded from a CDN we do not
  // control; a version that throws on an unexpected call order must not be
  // able to take the game down with it.
  _call(name, ...args) {
    const sdk = this.sdk;
    if (!sdk || typeof sdk[name] !== 'function') return undefined;
    try {
      return sdk[name](...args);
    } catch (err) {
      return undefined;
    }
  },

  // Same, for the calls that return a promise. Never rejects.
  _callAsync(name, ...args) {
    try {
      const out = this._call(name, ...args);
      return out && typeof out.then === 'function' ? out.catch(() => undefined) : Promise.resolve(out);
    } catch (err) {
      return Promise.resolve(undefined);
    }
  },

  // Resolves once the SDK is ready — or right away when there is no SDK.
  // Never rejects: an adblocked init just means "play on without ads".
  init() {
    if (!this.sdk) return Promise.resolve(false);
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) this._call('setDebug', true);

    //  Promise.resolve().then keeps a synchronous throw inside sdk.init() on
    //  the promise chain instead of letting it escape this function.
    const ready = Promise.resolve()
      .then(() => this._call('init'))
      .then(() => {
        this.ready = true;
        //  The loading window opens now, not earlier: this is the call that
        //  was being made pre-init.
        this._call('gameLoadingStart');
        this._flush();
        return true;
      })
      .catch(() => { this._giveUp(); return false; });

    //  A hung init is the same situation as a failed one, just slower.
    const timeout = new Promise((res) => setTimeout(() => { this._giveUp(); res(false); }, 5000));
    return Promise.race([ready, timeout]);
  },

  // init is never going to succeed. Send the loading events anyway rather than
  // hold them forever: an SDK that ignores them costs nothing, an Inspector
  // that never sees them fails the submission.
  _giveUp() {
    if (this.ready || this._degraded) return;
    this._degraded = true;
    this._flush();
  },

  // The single place that talks to the SDK about state; sends only changes,
  // including anything recorded before the SDK was ready.
  _flush() {
    if (!this.sdk) return;

    //  Held until init settles one way or the other, so the SDK sees
    //  gameLoadingStart before gameLoadingFinished in the normal case, and
    //  still sees gameLoadingFinished in the case where init never succeeds.
    if (this._loadingDone && !this._sentLoading && (this.ready || this._degraded)) {
      this._sentLoading = true;
      this._call('gameLoadingFinished');
    }

    //  Gameplay events are meaningless to an uninitialised SDK, so unlike
    //  loading they do wait for init rather than being fired hopefully.
    if (!this.ready) return;

    const playing = this._gameplayOn && !this.adPlaying;
    if (playing === this._sentGameplay) return;
    this._sentGameplay = playing;
    this._call(playing ? 'gameplayStart' : 'gameplayStop');
  },

  loadingFinished() { this._loadingDone = true; this._flush(); },
  gameplayStart() { this._gameplayOn = true; this._flush(); },
  gameplayStop() { this._gameplayOn = false; this._flush(); },

  // Moments of joy — helps Poki tune ad timing away from them.
  happyTime(value) {
    if (this.ready) this._call('happyTime', value === undefined ? 1 : value);
  },

  // Interstitial. Only called at the rebirth break, never mid-run.
  commercialBreak(minGapMs) {
    const gap = minGapMs === undefined ? 120000 : minGapMs;
    if (!this.ready || this.adPlaying) return Promise.resolve();
    if (this._lastAdAt && Date.now() - this._lastAdAt < gap) return Promise.resolve();
    const resume = this._adStart();
    return this._callAsync('commercialBreak')
      .then(() => { this._lastAdAt = Date.now(); resume(); });
  },

  // Rewarded video. Resolves true only when the player watched it through.
  rewardedBreak() {
    if (!this.ready || this.adPlaying) return Promise.resolve(false);
    const resume = this._adStart();
    return this._callAsync('rewardedBreak')
      .then((success) => {
        this._lastAdAt = Date.now();
        resume();
        return !!success;
      });
  },

  // Ads must play over a silent, frozen game. Returns the undo.
  _adStart() {
    const wasPlaying = this._gameplayOn;
    if (wasPlaying) this.gameplayStop();
    this.adPlaying = true;
    AudioSys.suspend();
    if (window.game && window.game.loop) window.game.loop.sleep();
    return () => {
      this.adPlaying = false;
      if (window.game && window.game.loop) window.game.loop.wake();
      AudioSys.resume();
      if (wasPlaying) this.gameplayStart();
    };
  },
};

// `const` at the top of a classic script is a lexical global, not a window
// property; systems check `window.Poki` so it must be assigned explicitly.
window.Poki = Poki;
