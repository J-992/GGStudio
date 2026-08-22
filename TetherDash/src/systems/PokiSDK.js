// Poki SDK wrapper. Every call degrades to a no-op when the SDK is unavailable
// (offline, ad blocker, or serving the folder yourself), so the game stays
// fully playable off-platform.
//
// The rule that shapes this file: ads never play over a live game. Interstitials
// are only ever requested between levels, and while one runs the game loop is
// asleep and the audio context is suspended.
const Poki = {
  ready: false,
  adPlaying: false,
  _gameplayOn: false,
  _levelStarts: 0,
  _lastAdAt: 0,

  get sdk() { return window.PokiSDK || null; },

  // Resolves once the SDK is ready — or right away when there is no SDK.
  // Never rejects: an adblocked init just means "play on without ads".
  init() {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve(false);
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && sdk.setDebug) sdk.setDebug(true);
    const ready = sdk.init()
      .then(() => {
        this.ready = true;
        if (sdk.gameLoadingStart) sdk.gameLoadingStart();
        return true;
      })
      .catch(() => false);
    // Safety net: never let a hung SDK keep the game from booting.
    const timeout = new Promise((res) => setTimeout(() => res(false), 5000));
    return Promise.race([ready, timeout]);
  },

  loadingFinished() { if (this.ready) this.sdk.gameLoadingFinished(); },

  gameplayStart() {
    if (this._gameplayOn) return;
    this._gameplayOn = true;
    if (this.ready) this.sdk.gameplayStart();
  },

  gameplayStop() {
    if (!this._gameplayOn) return;
    this._gameplayOn = false;
    if (this.ready) this.sdk.gameplayStop();
  },

  // Moments of joy — helps Poki tune ad timing away from them.
  happyTime(value) {
    if (this.ready && this.sdk.happyTime) this.sdk.happyTime(value === undefined ? 1 : value);
  },

  // Interstitial on the way into a level. Skips the session's first level
  // (nobody should meet an ad before they have played) and keeps a minimum gap
  // after that. Always resolves, so the caller can start the level either way.
  breakBeforeLevel() {
    const first = this._levelStarts === 0;
    this._levelStarts++;
    if (first) return Promise.resolve();
    return this.commercialBreak();
  },

  // Every path into a level goes through here, so the rule about when an
  // interstitial may play lives in one place: ad first if one is due, then the
  // level starts. Off-platform this is just a scene change a microtask later.
  startLevel(scene, levelId) {
    //  Leaving a level ends its gameplay session before the ad, not after it:
    //  otherwise the ad's resume reports a few milliseconds of "gameplay" that
    //  the level change immediately stops again.
    this.gameplayStop();
    this.breakBeforeLevel().then(() => scene.scene.start('Game', { levelId }));
  },

  // Interstitial. Only ever called between levels, never mid-run.
  commercialBreak(minGapMs) {
    const gap = minGapMs === undefined ? 60000 : minGapMs;
    if (!this.ready || this.adPlaying) return Promise.resolve();
    if (this._lastAdAt && Date.now() - this._lastAdAt < gap) return Promise.resolve();
    const resume = this._adStart();
    return this.sdk.commercialBreak()
      .catch(() => {})
      .then(() => { this._lastAdAt = Date.now(); resume(); });
  },

  // Rewarded video. Resolves true only when the player watched it through.
  // No placement uses this yet — it is here so adding one is wiring a button,
  // not rewriting the ad plumbing.
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
    AudioSys.stopTension();     // the cord creak is a loop; it must not survive an ad
    AudioSys.suspend();
    if (window.game && window.game.loop) window.game.loop.sleep();
    return () => {
      this.adPlaying = false;
      if (window.game && window.game.loop) window.game.loop.wake();
      AudioSys.resume();
      if (wasPlaying) this.gameplayStart();
    };
  }
};
