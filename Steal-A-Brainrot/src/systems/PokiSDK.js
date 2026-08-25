// Poki SDK wrapper. Every call degrades to a no-op when the SDK is unavailable
// (offline, ad blocker, or serving the folder yourself), so the game stays
// fully playable off-platform.
//
// Ads never play over a live game: the interstitial slot is the rebirth
// confirmation (a natural break), and while an ad runs the game loop sleeps
// and audio is suspended. The rewarded slot is the optional income-frenzy
// button; nothing in the game requires watching it.
//
// No lifecycle event is ever dropped: calls made before init resolves are
// recorded and replayed the moment the SDK answers.
const Poki = {
  ready: false,
  adPlaying: false,
  _gameplayOn: false,
  _sentGameplay: false,
  _loadingDone: false,
  _sentLoading: false,
  _lastAdAt: 0,

  get sdk() { return window.PokiSDK || null; },

  // Resolves once the SDK is ready — or right away when there is no SDK.
  // Never rejects: an adblocked init just means "play on without ads".
  init() {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve(false);
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && sdk.setDebug) sdk.setDebug(true);
    if (sdk.gameLoadingStart) sdk.gameLoadingStart();
    const ready = sdk.init()
      .then(() => {
        this.ready = true;
        this._flush();
        return true;
      })
      .catch(() => false);
    const timeout = new Promise((res) => setTimeout(() => res(false), 5000));
    return Promise.race([ready, timeout]);
  },

  // The single place that talks to the SDK about state; sends only changes,
  // including anything recorded before the SDK was ready.
  _flush() {
    if (!this.ready) return;
    if (this._loadingDone && !this._sentLoading) {
      this._sentLoading = true;
      this.sdk.gameLoadingFinished();
    }
    if (!this._sentLoading) return;
    const playing = this._gameplayOn && !this.adPlaying;
    if (playing === this._sentGameplay) return;
    this._sentGameplay = playing;
    if (playing) this.sdk.gameplayStart();
    else this.sdk.gameplayStop();
  },

  loadingFinished() { this._loadingDone = true; this._flush(); },
  gameplayStart() { this._gameplayOn = true; this._flush(); },
  gameplayStop() { this._gameplayOn = false; this._flush(); },

  // Moments of joy — helps Poki tune ad timing away from them.
  happyTime(value) {
    if (this.ready && this.sdk.happyTime) this.sdk.happyTime(value === undefined ? 1 : value);
  },

  // Interstitial. Only called at the rebirth break, never mid-run.
  commercialBreak(minGapMs) {
    const gap = minGapMs === undefined ? 120000 : minGapMs;
    if (!this.ready || this.adPlaying) return Promise.resolve();
    if (this._lastAdAt && Date.now() - this._lastAdAt < gap) return Promise.resolve();
    const resume = this._adStart();
    return this.sdk.commercialBreak()
      .catch(() => {})
      .then(() => { this._lastAdAt = Date.now(); resume(); });
  },

  // Rewarded video. Resolves true only when the player watched it through.
  rewardedBreak() {
    if (!this.ready || this.adPlaying) return Promise.resolve(false);
    const resume = this._adStart();
    return this.sdk.rewardedBreak()
      .catch(() => false)
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
