// Web Audio playback: a single lazily-created `AudioContext` (browsers reject
// one made before a user gesture), one master gain, and per-name decoded
// `AudioBuffer`s cached on first use. Pattern follows
// `zombie-motorworks/src/app/sfx.ts`'s `getAudioContext`/`playUrl`, trimmed to
// what this game needs — no loops, no busses beyond the one master gain.
const MASTER_GAIN = 0.5;

export class Audio {
  /**
   * @param {import('../game/assets.js').Assets} assets Supplies raw (not yet decoded) `audioBuffers` by name.
   */
  constructor(assets) {
    this._assets = assets;
    /** @type {AudioContext|null} */
    this._ctx = null;
    /** @type {GainNode|null} */
    this._master = null;
    this._muted = false;
    /** @type {Map<string, AudioBuffer>} */
    this._decoded = new Map();
    /** @type {Map<string, Promise<AudioBuffer>>} */
    this._decoding = new Map();

    this._unlock = this.unlock.bind(this);
    window.addEventListener('pointerdown', this._unlock, { once: true });
    window.addEventListener('keydown', this._unlock, { once: true });
    window.addEventListener('touchstart', this._unlock, { once: true });
  }

  /** Creates the `AudioContext` (idempotent) and resumes it if suspended. Safe to call anytime. */
  unlock() {
    if (this._ctx) {
      if (this._ctx.state === 'suspended') void this._ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (typeof Ctor !== 'function') return;
    try {
      this._ctx = new Ctor();
      this._master = this._ctx.createGain();
      this._master.gain.value = this._muted ? 0 : MASTER_GAIN;
      this._master.connect(this._ctx.destination);
    } catch {
      this._ctx = null;
    }
  }

  /**
   * @param {boolean} muted
   */
  setMuted(muted) {
    this._muted = muted;
    if (this._master) this._master.gain.value = muted ? 0 : MASTER_GAIN;
  }

  /** Pauses all audio output (ad break). */
  suspend() {
    if (this._ctx && this._ctx.state === 'running') void this._ctx.suspend();
  }

  /** Resumes audio output after `suspend()`. */
  resume() {
    if (this._ctx && this._ctx.state === 'suspended') void this._ctx.resume();
  }

  /**
   * @param {string} name
   * @returns {Promise<AudioBuffer>}
   */
  _decode(name) {
    const cached = this._decoded.get(name);
    if (cached) return Promise.resolve(cached);
    let pending = this._decoding.get(name);
    if (!pending) {
      const raw = this._assets.audioBuffers.get(name);
      if (!raw) return Promise.reject(new Error(`audio: no buffer named "${name}"`));
      // decodeAudioData detaches/consumes its input, so hand it a copy —
      // the raw bytes in `assets.audioBuffers` may need decoding again if
      // this attempt is somehow retried.
      pending = this._ctx.decodeAudioData(raw.slice(0)).then((buffer) => {
        this._decoded.set(name, buffer);
        this._decoding.delete(name);
        return buffer;
      }, (err) => {
        this._decoding.delete(name);
        throw err;
      });
      this._decoding.set(name, pending);
    }
    return pending;
  }

  /**
   * Fire-and-forget playback; decodes and caches `name` on first use. Silent
   * no-op if the context isn't unlocked yet, is suspended (ad break), or the
   * game is muted.
   *
   * @param {string} name
   * @param {{ vol?: number, rate?: number, pan?: number }} [opts]
   */
  play(name, opts = {}) {
    if (!this._ctx || this._muted || this._ctx.state !== 'running') return;
    void this._playNow(name, opts);
  }

  /**
   * @param {string} name
   * @param {{ vol?: number, rate?: number, pan?: number }} opts
   */
  async _playNow(name, { vol = 1, rate = 1, pan } = {}) {
    try {
      const buffer = await this._decode(name);
      if (!this._ctx || this._ctx.state !== 'running') return;

      const source = this._ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;

      const gain = this._ctx.createGain();
      gain.gain.value = vol;
      source.connect(gain);

      if (pan !== undefined && typeof this._ctx.createStereoPanner === 'function') {
        const panner = this._ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        gain.connect(panner);
        panner.connect(this._master);
      } else {
        gain.connect(this._master);
      }

      source.start();
    } catch {
      // A missing/failed decode must never throw into the game loop.
    }
  }
}
