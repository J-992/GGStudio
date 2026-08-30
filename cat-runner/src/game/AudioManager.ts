import * as THREE from 'three';
import { ASSET_BASE } from '../assets/assetBase';

/**
 * AudioManager - mostly procedural sound engine for the game.
 *
 * -----------------------------------------------------------------------
 * PROCEDURAL AUDIO, WITH REAL SAMPLES LAYERED IN
 * -----------------------------------------------------------------------
 * Most one-shot sound effects are synthesised at runtime with the raw Web
 * Audio API: oscillators, a single shared noise buffer, filters, envelopes
 * and a WaveShaper for light distortion. That keeps most of the game's asset
 * footprint at zero and every sound trivially tweakable in code
 * (frequencies, envelope times, filter curves are all named constants
 * below).
 *
 * Six `SoundName`s (`jump`, `collision`, `powerUp`, `fishCollect`,
 * `slideDuck`, `catMeow`) instead play a real recorded sample - see
 * `SAMPLE_URLS` below. The hook point is `buildSound(name, options)`'s
 * dispatch inside `play()`/`playAt()`:
 *
 *   1. `unlock()` fires off a `fetch` + `AudioContext.decodeAudioData` per
 *      entry in `SAMPLE_URLS`, storing the decoded `AudioBuffer`s in
 *      `sampleBuffers`. Not awaited as part of unlock's own promise - the
 *      context has to resume immediately for responsiveness, and a sound
 *      played before its buffer lands just falls back to its `synth*`
 *      method for that one call, same as if the file were missing/failed to
 *      extract entirely.
 *   2. `buildSound()` checks `sampleBuffers` first; a hit builds an
 *      `AudioBufferSourceNode` via `buildSampleSource()` (source -> gain ->
 *      category gain -> master -> destination, the same wiring pattern
 *      every `synth*` method already uses) instead of calling the matching
 *      `synth*` method.
 *   3. `playAt()` and the envelope/cleanup/PannerNode plumbing need no
 *      changes at all - they are already source-agnostic; they just take
 *      whatever `AudioNode` the one-shot builder hands back.
 *
 * Every other `SoundName` keeps its synth. The gameplay music bed
 * (`startMusic()`/`stopMusic()`) is the same idea one level up: it prefers a
 * real recorded track (`MUSIC_URL`, decoded into `musicBuffer` the same way
 * as the samples above) looped via `AudioBufferSourceNode.loop = true`, and
 * falls back to a synthesised chord progression only until that buffer
 * lands - see `startMusic()`'s own doc comment. `slide`/`wind` are the two
 * remaining loops that stay purely synthesised.
 * -----------------------------------------------------------------------
 */

export type SoundName =
  | 'footstep'
  | 'jump'
  | 'land'
  | 'landHard'
  | 'slide'
  | 'slideDuck'
  | 'collision'
  | 'fishCollect'
  | 'powerUp'
  | 'bark'
  | 'chefShout'
  | 'pigeon'
  | 'steam'
  | 'levelComplete'
  | 'fail'
  | 'uiClick'
  | 'uiHover'
  | 'countdown'
  | 'catMeow';

const AUDIO_ROOT = `${ASSET_BASE}/assets/audio`;

/** The only `SoundName`s backed by a real sample; everything else stays synthesised. */
const SAMPLE_URLS: Partial<Record<SoundName, string>> = {
  jump: `${AUDIO_ROOT}/bounce.wav`,
  collision: `${AUDIO_ROOT}/bwah.wav`,
  powerUp: `${AUDIO_ROOT}/bonus.wav`,
  fishCollect: `${AUDIO_ROOT}/collect4.wav`,
  slideDuck: `${AUDIO_ROOT}/wobbledown2.wav`,
  catMeow: `${AUDIO_ROOT}/meow2.wav`,
};

/** The gameplay music bed. Not a `SoundName` - it loops for the whole run
 *  rather than firing as a one-shot, so it gets its own load path and its
 *  own node graph in `startMusic()`/`stopMusic()` instead of going through
 *  `sampleBuffers`/`buildSound()`. */
const MUSIC_URL = `${AUDIO_ROOT}/background_music.ogg`;

interface PlayOptions {
  /** Playback-rate / pitch multiplier. 1 = unmodified. */
  rate?: number;
  /** Linear gain multiplier applied on top of the effects volume. */
  gain?: number;
}

/** Duration (seconds) of the shared reusable noise buffer. */
const NOISE_BUFFER_SECONDS = 2;

/** Smoothing time constant used for all per-frame AudioParam ramps. */
const SMOOTH_TIME = 0.08;

/** Sensible defaults for positional (PannerNode) audio in this world. */
const PANNER_REF_DISTANCE = 4;
const PANNER_MAX_DISTANCE = 60;
const PANNER_ROLLOFF = 1.4;

// --- Music bed -------------------------------------------------------------

/** How often the scheduler wakes up, and how far ahead it queues notes. */
const MUSIC_SCHEDULER_MS = 25;
const MUSIC_LOOKAHEAD_SECONDS = 0.2;

/** 108 BPM in eighth notes - an easy jog, not a panic. */
const MUSIC_TEMPO_BPM = 108;
const MUSIC_STEPS_PER_BAR = 8;
const MUSIC_STEP_SECONDS = 60 / MUSIC_TEMPO_BPM / 2;

/**
 * Four bars of Am - F - C - G as [root, third, fifth], voiced around A3-G4.
 * Kept above 170 Hz on purpose: the low end is where the old bed lived, and it
 * is also where the dogs, the chef and the landing thuds need to be heard.
 */
const MUSIC_PROGRESSION: readonly (readonly [number, number, number])[] = [
  [220.0, 261.63, 329.63], // Am : A3  C4  E4
  [174.61, 220.0, 261.63], // F  : F3  A3  C4
  [261.63, 329.63, 392.0], // C  : C4  E4  G4
  [196.0, 246.94, 293.66], // G  : G3  B3  D4
];

/** Chord-tone index per eighth note; 3 means "root, an octave up". */
const MUSIC_ARP_PATTERN: readonly number[] = [0, 2, 1, 3, 2, 1, 3, 2];

export class AudioManager {
  private ctx: AudioContext | null = null;

  // Mixer graph: source -> (effects|music) gain -> master gain -> destination
  private masterGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  // Listener node used for positional audio (created lazily with the ctx).
  private listener: AudioListener | null = null;

  // Shared, generated-once white-noise source buffer.
  private noiseBuffer: AudioBuffer | null = null;

  // A light WaveShaper curve reused for the "landHard" and "collision" hits.
  private distortionCurve: Float32Array | null = null;

  // Decoded real samples, keyed by SoundName - see SAMPLE_URLS. Populated
  // asynchronously by unlock(); a name with no entry yet (or ever) falls
  // back to its synth* method.
  private sampleBuffers = new Map<SoundName, AudioBuffer>();

  // Decoded gameplay music bed - see MUSIC_URL. null until preloadSamples()'s
  // fetch resolves (or forever, if it fails); startMusic() falls back to the
  // synthesised progression below for as long as it is null.
  private musicBuffer: AudioBuffer | null = null;

  private unlockPromise: Promise<void> | null = null;
  private _isUnlocked = false;

  // ---- Continuous / looping sound state -----------------------------------

  private slideNodes: {
    source: AudioBufferSourceNode;
    bandpass: BiquadFilterNode;
    gain: GainNode;
  } | null = null;

  private windNodes: {
    source: AudioBufferSourceNode;
    lowpass: BiquadFilterNode;
    gain: GainNode;
  } | null = null;

  // The synthesised music bed (fallback path, see startMusic()) is a
  // scheduled sequence, not a sustained voice, so the only long-lived nodes
  // are its output bus. Individual notes create and dispose of themselves
  // exactly like the one-shot effects do.
  private musicBus: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicNextStepTime = 0;
  private musicStep = 0;

  // The real music bed (preferred path): one looping AudioBufferSourceNode
  // through its own fade gain.
  private musicSampleNode: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

  private musicRunning = false;

  // ---- Public mixer state ---------------------------------------------------

  private _masterVolume = 1;
  private _musicVolume = 0.6;
  private _effectsVolume = 1;
  private _muted = false;

  constructor() {
    // Intentionally does nothing that touches the Web Audio API - the
    // AudioContext must not be constructed until a user gesture calls
    // unlock(), otherwise browsers create it in a permanently suspended
    // state (and some will warn loudly in the console).
  }

  // ---------------------------------------------------------------------
  // Unlock / lifecycle
  // ---------------------------------------------------------------------

  get isUnlocked(): boolean {
    return this._isUnlocked;
  }

  /**
   * Must be called from a user-gesture handler (click/keydown/touchstart).
   * Creates the AudioContext and mixer graph on first call, and resumes it
   * on every call. Safe to call repeatedly / concurrently - subsequent
   * calls await the same in-flight promise.
   */
  unlock(): Promise<void> {
    if (this.unlockPromise) {
      return this.unlockPromise;
    }

    this.unlockPromise = (async () => {
      if (!this.ctx) {
        const AudioContextCtor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        this.ctx = new AudioContextCtor();

        this.masterGain = this.ctx.createGain();
        this.effectsGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();

        this.effectsGain.connect(this.masterGain);
        this.musicGain.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);

        this.applyVolumes();

        this.listener = this.ctx.listener;

        this.noiseBuffer = this.createNoiseBuffer(this.ctx);
        this.distortionCurve = this.createDistortionCurve(400);

        this.preloadSamples(this.ctx);
      }

      if (this.ctx.state !== 'running') {
        await this.ctx.resume();
      }

      this._isUnlocked = true;
    })();

    return this.unlockPromise;
  }

  /**
   * Fetches and decodes every `SAMPLE_URLS` entry in the background.
   *
   * Deliberately fire-and-forget rather than part of `unlockPromise`: the
   * context has to resume immediately for a responsive first sound, and a
   * slow or failed fetch should just leave `play()` on the synth fallback
   * for that name, not delay unlocking the whole audio graph.
   */
  private preloadSamples(ctx: AudioContext): void {
    for (const [name, url] of Object.entries(SAMPLE_URLS) as [SoundName, string][]) {
      fetch(url)
        .then((res) => res.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => {
          this.sampleBuffers.set(name, buffer);
        })
        .catch(() => {
          // Missing/failed extraction, or a browser that can't decode the
          // file - play() keeps using the synth for this name either way.
        });
    }

    fetch(MUSIC_URL)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        this.musicBuffer = buffer;
        // The player may already be running by the time a 15 MB file
        // finishes decoding - swap the synthesised bed for the real one
        // rather than leaving it playing until the next restart.
        // `startMusic()` kills the live synth bed instantly before building
        // the sample node, so this swap never overlaps the two.
        if (this.musicRunning) this.startMusic();
      })
      .catch(() => {
        // startMusic() keeps using the synthesised progression either way.
      });
  }

  /** Suspends the whole graph - used on pause / page-visibility change. */
  suspend(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    void this.ctx.suspend();
  }

  /** Resumes the whole graph after a suspend(). No-op before unlock(). */
  resume(): void {
    if (!this.ctx || this.ctx.state !== 'suspended') return;
    void this.ctx.resume();
  }

  /** Tears down all nodes and closes the context. */
  dispose(): void {
    this.stopSlide();
    this.stopWindInternal();
    this.stopMusic();

    if (this.ctx) {
      void this.ctx.close();
    }

    this.ctx = null;
    this.masterGain = null;
    this.effectsGain = null;
    this.musicGain = null;
    this.listener = null;
    this.noiseBuffer = null;
    this.distortionCurve = null;
    this.unlockPromise = null;
    this._isUnlocked = false;
  }

  // ---------------------------------------------------------------------
  // Volume / mute
  // ---------------------------------------------------------------------

  get masterVolume(): number {
    return this._masterVolume;
  }

  set masterVolume(value: number) {
    this._masterVolume = clamp01(value);
    this.applyVolumes();
  }

  get musicVolume(): number {
    return this._musicVolume;
  }

  set musicVolume(value: number) {
    this._musicVolume = clamp01(value);
    this.applyVolumes();
  }

  get effectsVolume(): number {
    return this._effectsVolume;
  }

  set effectsVolume(value: number) {
    this._effectsVolume = clamp01(value);
    this.applyVolumes();
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(value: boolean) {
    this._muted = value;
    this.applyVolumes();
  }

  /** Pushes the current volume/mute state onto the live GainNodes. */
  private applyVolumes(): void {
    if (!this.ctx || !this.masterGain || !this.effectsGain || !this.musicGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const master = this._muted ? 0 : this._masterVolume;
    this.masterGain.gain.setTargetAtTime(master, now, SMOOTH_TIME);
    this.effectsGain.gain.setTargetAtTime(this._effectsVolume, now, SMOOTH_TIME);
    this.musicGain.gain.setTargetAtTime(this._musicVolume, now, SMOOTH_TIME);
  }

  // ---------------------------------------------------------------------
  // One-shot playback
  // ---------------------------------------------------------------------

  /** One-shot sound effect. Silent no-op if not yet unlocked. */
  play(name: SoundName, options?: { rate?: number; gain?: number }): void {
    if (!this.ctx || !this.effectsGain) return;
    const node = this.buildSound(name, options ?? {});
    if (node) node.connect(this.effectsGain);
  }

  /**
   * 3D-positioned one-shot. Falls back to a plain `play()` if a PannerNode
   * cannot be constructed for any reason.
   */
  playAt(
    name: SoundName,
    position: THREE.Vector3,
    options?: { rate?: number; gain?: number },
  ): void {
    if (!this.ctx || !this.effectsGain) return;

    let panner: PannerNode | null = null;
    try {
      panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = PANNER_REF_DISTANCE;
      panner.maxDistance = PANNER_MAX_DISTANCE;
      panner.rolloffFactor = PANNER_ROLLOFF;

      if (panner.positionX) {
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
      } else {
        // Deprecated fallback for older engines.
        (panner as unknown as { setPosition: (x: number, y: number, z: number) => void })
          .setPosition(position.x, position.y, position.z);
      }
    } catch {
      panner = null;
    }

    if (!panner) {
      this.play(name, options);
      return;
    }

    const node = this.buildSound(name, options ?? {});
    if (!node) return;

    node.connect(panner);
    panner.connect(this.effectsGain);
  }

  /**
   * Updates the listener transform for positional sounds. Call once per
   * frame. Allocation-free: only sets AudioParam values.
   */
  setListener(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    if (!this.ctx || !this.listener) return;
    const l = this.listener;
    const now = this.ctx.currentTime;

    if (l.positionX) {
      l.positionX.setTargetAtTime(position.x, now, SMOOTH_TIME);
      l.positionY.setTargetAtTime(position.y, now, SMOOTH_TIME);
      l.positionZ.setTargetAtTime(position.z, now, SMOOTH_TIME);
      l.forwardX.setTargetAtTime(forward.x, now, SMOOTH_TIME);
      l.forwardY.setTargetAtTime(forward.y, now, SMOOTH_TIME);
      l.forwardZ.setTargetAtTime(forward.z, now, SMOOTH_TIME);
      l.upX.setTargetAtTime(up.x, now, SMOOTH_TIME);
      l.upY.setTargetAtTime(up.y, now, SMOOTH_TIME);
      l.upZ.setTargetAtTime(up.z, now, SMOOTH_TIME);
    } else {
      // Deprecated fallback for older engines lacking AudioParam listener props.
      const deprecated = l as unknown as {
        setPosition: (x: number, y: number, z: number) => void;
        setOrientation: (
          fx: number,
          fy: number,
          fz: number,
          ux: number,
          uy: number,
          uz: number,
        ) => void;
      };
      deprecated.setPosition(position.x, position.y, position.z);
      deprecated.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  // ---------------------------------------------------------------------
  // Continuous loops: slide / wind
  // ---------------------------------------------------------------------

  /** Continuous looping sliding noise; `intensity` 0..1, 0 stops it. */
  setSlideIntensity(intensity: number): void {
    if (!this.ctx || !this.effectsGain || !this.noiseBuffer) return;
    const clamped = clamp01(intensity);

    if (clamped <= 0) {
      this.stopSlide();
      return;
    }

    if (!this.slideNodes) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;

      const bandpass = this.ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.Q.value = 0.9;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      source.connect(bandpass);
      bandpass.connect(gain);
      gain.connect(this.effectsGain);
      source.start();

      this.slideNodes = { source, bandpass, gain };
    }

    const now = this.ctx.currentTime;
    // Frequency and gain both track intensity: a light scuff is a soft,
    // low-ish rasp; a full slide is louder and brighter.
    this.slideNodes.bandpass.frequency.setTargetAtTime(
      600 + clamped * 1400,
      now,
      SMOOTH_TIME,
    );
    this.slideNodes.gain.gain.setTargetAtTime(clamped * 0.35, now, SMOOTH_TIME);
  }

  private stopSlide(): void {
    if (!this.slideNodes) return;
    const { source, bandpass, gain } = this.slideNodes;
    try {
      source.stop();
    } catch {
      // Already stopped - ignore.
    }
    source.disconnect();
    bandpass.disconnect();
    gain.disconnect();
    this.slideNodes = null;
  }

  /** Continuous wind that scales with speed; `intensity` 0..1. */
  setWindIntensity(intensity: number): void {
    if (!this.ctx || !this.effectsGain || !this.noiseBuffer) return;
    const clamped = clamp01(intensity);

    if (clamped <= 0) {
      this.stopWindInternal();
      return;
    }

    if (!this.windNodes) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;

      // Bandpass rather than lowpass. Rolling noise off at 300 Hz leaves only
      // the bottom octaves, which is a rumble, not wind - and stacked under the
      // old music bed it was most of the low-frequency muddiness in the mix.
      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'bandpass';
      lowpass.Q.value = 0.7;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      source.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(this.effectsGain);
      source.start();

      this.windNodes = { source, lowpass, gain };
    }

    const now = this.ctx.currentTime;
    this.windNodes.lowpass.frequency.setTargetAtTime(900 + clamped * 1600, now, SMOOTH_TIME);
    this.windNodes.gain.gain.setTargetAtTime(clamped * 0.14, now, SMOOTH_TIME);
  }

  private stopWindInternal(): void {
    if (!this.windNodes) return;
    const { source, lowpass, gain } = this.windNodes;
    try {
      source.stop();
    } catch {
      // Already stopped - ignore.
    }
    source.disconnect();
    lowpass.disconnect();
    gain.disconnect();
    this.windNodes = null;
  }

  // ---------------------------------------------------------------------
  // Music bed
  // ---------------------------------------------------------------------

  /**
   * Starts the music bed, always from a clean slate.
   *
   * Prefers the real recorded track (`MUSIC_URL`, decoded into
   * `musicBuffer` by `preloadSamples()`) looped through its own fade gain.
   * If that buffer isn't ready yet - still fetching, or the file failed to
   * extract - falls back to a synthesised sequence: a four-bar Am - F - C - G
   * loop played as plucked notes with real envelopes, over a light shaker
   * pulse, rather than shipping with no music at all while the real track
   * loads. `preloadSamples()` swaps a running fallback for the real buffer
   * the moment it lands, so the synth path is never more than a startup gap.
   *
   * Used to no-op when `musicRunning` was already true, on the assumption
   * that whatever was playing was this same call's own doing. It wasn't
   * always: `restartCurrentRun()` re-enters `GameState.Playing` (and so this
   * method) without ever passing through `GameState.MainMenu`'s
   * `stopMusic()`, so the guard let the *previous* run's instance carry on
   * silently instead of the new run getting a fresh, clean start - and on
   * the very first run, if the real track's fetch/decode was still in
   * flight, `preloadSamples()` landing mid-run swapped it in over
   * `stopMusic()`'s own asynchronous fade-out, so the outgoing synth bed and
   * the incoming sample both stayed briefly audible at once. Unconditionally
   * killing whatever is live *first*, synchronously, before building
   * anything new closes both: there is never a moment with two sources
   * feeding `musicGain`.
   */
  startMusic(): void {
    if (!this.ctx || !this.musicGain) return;
    this.hardStopMusic();

    if (this.musicBuffer) {
      this.startSampleMusic(this.musicBuffer);
    } else {
      this.startSynthMusic();
    }
    this.musicRunning = true;
  }

  /**
   * Synchronously silences and disconnects whatever music node is currently
   * live, with no fade - the instant, no-overlap counterpart to
   * {@link stopMusic}'s graceful one. Safe to call whether or not anything is
   * actually playing.
   */
  private hardStopMusic(): void {
    if (this.musicSampleNode) {
      const { source, gain } = this.musicSampleNode;
      try {
        source.stop();
      } catch {
        // Already stopped - ignore.
      }
      source.disconnect();
      gain.disconnect();
      this.musicSampleNode = null;
    }

    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }

    if (this.musicBus) {
      const { gain, filter } = this.musicBus;
      gain.disconnect();
      filter.disconnect();
      this.musicBus = null;
    }

    this.musicRunning = false;
  }

  private startSampleMusic(buffer: AudioBuffer): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, now, 0.8);

    source.connect(gain);
    gain.connect(this.musicGain!);
    source.start();

    this.musicSampleNode = { source, gain };
  }

  private startSynthMusic(): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    // Gentle top-end roll-off so the plucks stay warm rather than glassy.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.4;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.55, now, 0.8);

    filter.connect(gain);
    gain.connect(this.musicGain!);

    this.musicBus = { gain, filter };
    this.musicStep = 0;
    this.musicNextStepTime = now + 0.1;

    // Standard Web Audio two-clock scheduling: a coarse setInterval decides
    // *what* to play, and every note is stamped with a precise AudioContext
    // time. Timer jitter therefore never reaches the audio.
    this.musicTimer = setInterval(() => this.pumpMusicScheduler(), MUSIC_SCHEDULER_MS);
    this.pumpMusicScheduler();
  }

  /** Stops the music bed with a short fade-out, whichever path is playing. */
  stopMusic(): void {
    this.musicRunning = false;

    if (this.musicSampleNode && this.ctx) {
      const { source, gain } = this.musicSampleNode;
      gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
      setTimeout(() => {
        source.stop();
        source.disconnect();
        gain.disconnect();
      }, 400);
    }
    this.musicSampleNode = null;

    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }

    if (!this.musicBus || !this.ctx) {
      this.musicBus = null;
      return;
    }

    const { gain, filter } = this.musicBus;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);

    // Long enough for the fade and for any note already scheduled to ring out.
    setTimeout(() => {
      gain.disconnect();
      filter.disconnect();
    }, 1400);

    this.musicBus = null;
  }

  /**
   * Schedules every step that falls inside the lookahead window.
   *
   * Resynchronises if the clock has run away from us, which happens whenever the
   * tab is backgrounded: `setInterval` is throttled to roughly once a second
   * while `currentTime` keeps advancing, and without this the catch-up would
   * dump a second of notes at once on return.
   */
  private pumpMusicScheduler(): void {
    if (!this.ctx || !this.musicBus || !this.musicRunning) return;

    const now = this.ctx.currentTime;
    if (this.musicNextStepTime < now - 0.25) this.musicNextStepTime = now;

    while (this.musicNextStepTime < now + MUSIC_LOOKAHEAD_SECONDS) {
      this.scheduleMusicStep(this.musicStep, this.musicNextStepTime);
      this.musicNextStepTime += MUSIC_STEP_SECONDS;
      this.musicStep = (this.musicStep + 1) % (MUSIC_PROGRESSION.length * MUSIC_STEPS_PER_BAR);
    }
  }

  /** Plays one eighth-note step of the loop. */
  private scheduleMusicStep(step: number, time: number): void {
    const bar = Math.floor(step / MUSIC_STEPS_PER_BAR);
    const beat = step % MUSIC_STEPS_PER_BAR;
    const chord = MUSIC_PROGRESSION[bar];

    // Root on the downbeat and the half-bar, an octave below the chord.
    if (beat === 0 || beat === 4) {
      this.playMusicPluck(chord[0] / 2, time, beat === 0 ? 0.36 : 0.24, 0.55, 'sine');
    }

    // Arpeggio. Index 3 is the root an octave up, which lifts the second half
    // of each bar without needing a second voice.
    const degree = MUSIC_ARP_PATTERN[beat];
    const freq = degree === 3 ? chord[0] * 2 : chord[degree];
    const accent = beat === 0 || beat === 3 || beat === 6 ? 0.26 : 0.17;
    this.playMusicPluck(freq, time, accent, 0.32, 'triangle');

    // Offbeat shaker - just enough pulse to give the loop a tempo.
    if (beat % 2 === 1) this.playMusicShaker(time, beat === 5 ? 0.05 : 0.032);
  }

  /** One plucked note: fast attack, exponential decay, then self-disposing. */
  private playMusicPluck(
    frequency: number,
    time: number,
    peak: number,
    decay: number,
    type: OscillatorType,
  ): void {
    const ctx = this.ctx!;
    const bus = this.musicBus;
    if (!bus) return;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(peak, time + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, time + decay);

    osc.connect(env);
    env.connect(bus.filter);

    this.scheduleStop(osc, time, decay, [env]);
  }

  /** Very short high-passed noise tick, for pulse. */
  private playMusicShaker(time: number, peak: number): void {
    const ctx = this.ctx!;
    const bus = this.musicBus;
    if (!bus) return;

    const source = this.createNoiseSource();
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 6500;

    const env = ctx.createGain();
    env.gain.setValueAtTime(peak, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    source.connect(highpass);
    highpass.connect(env);
    env.connect(bus.gain);

    this.scheduleStop(source, time, 0.05, [highpass, env]);
  }

  // ---------------------------------------------------------------------
  // Sound synthesis dispatch
  // ---------------------------------------------------------------------

  /**
   * Builds one one-shot sound graph and returns its output node (already
   * scheduled to start/stop and self-disconnect on `ended`). Returns null
   * if the context isn't ready. Callers connect the returned node onward
   * (either straight to effectsGain, or via a PannerNode for playAt).
   */
  /**
   * One-shot playback of a decoded sample, wired the same way every `synth*`
   * method is: source -> per-shot gain -> (caller connects onward to
   * effectsGain, or via a PannerNode for playAt). `rate` maps directly onto
   * `playbackRate`, same meaning as it has for every synthesised sound.
   */
  private buildSampleSource(buffer: AudioBuffer, rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    const env = ctx.createGain();
    env.gain.value = gainScale;
    source.connect(env);

    this.scheduleStop(source, now, buffer.duration / rate, [env]);
    return env;
  }

  private buildSound(name: SoundName, options: PlayOptions): AudioNode | null {
    if (!this.ctx) return null;
    const rate = options.rate ?? 1;
    const gain = options.gain ?? 1;

    const sample = this.sampleBuffers.get(name);
    if (sample) return this.buildSampleSource(sample, rate, gain);

    switch (name) {
      case 'footstep':
        return this.synthFootstep(rate, gain);
      case 'jump':
        return this.synthJump(rate, gain);
      case 'land':
        return this.synthLand(rate, gain, false);
      case 'landHard':
        return this.synthLand(rate, gain, true);
      case 'collision':
        return this.synthCollision(rate, gain);
      case 'fishCollect':
        return this.synthFishCollect(rate, gain);
      case 'powerUp':
        return this.synthPowerUp(rate, gain);
      case 'bark':
        return this.synthBark(rate, gain);
      case 'chefShout':
        return this.synthChefShout(rate, gain);
      case 'pigeon':
        return this.synthPigeon(rate, gain);
      case 'steam':
        return this.synthSteam(rate, gain);
      case 'levelComplete':
        return this.synthLevelComplete(rate, gain);
      case 'fail':
        return this.synthFail(rate, gain);
      case 'uiClick':
        return this.synthUiClick(rate, gain);
      case 'uiHover':
        return this.synthUiHover(rate, gain);
      case 'countdown':
        return this.synthCountdown(rate, gain);
      case 'slide':
        // 'slide' is a continuous loop controlled via setSlideIntensity();
        // one-shot play() calls for it are a no-op.
        return null;
      case 'slideDuck':
        return this.synthSlideDuck(rate, gain);
      case 'catMeow':
        return this.synthCatMeow(rate, gain);
    }
  }

  // ---- Individual synths ----------------------------------------------

  /** Very short filtered noise burst with slight random pitch variance. */
  private synthFootstep(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.035;

    const source = this.createNoiseSource();
    const variance = 0.9 + Math.random() * 0.2;
    source.playbackRate.value = rate * variance;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1500;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.5 * gainScale, now);
    env.gain.exponentialRampToValueAtTime(0.001 * gainScale, now + duration);

    source.connect(lowpass);
    lowpass.connect(env);

    this.scheduleStop(source, now, duration, [lowpass, env]);
    return env;
  }

  /** Short upward pitch sweep, 220 -> 520 Hz over 120ms. */
  private synthJump(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.12;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220 * rate, now);
    osc.frequency.exponentialRampToValueAtTime(520 * rate, now + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(0.4 * gainScale, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001 * gainScale, now + duration);

    osc.connect(env);
    this.scheduleStop(osc, now, duration, [env]);
    return env;
  }

  /** Downward thump - filtered noise plus a low sine. Louder/longer/distorted for "hard". */
  private synthLand(rate: number, gainScale: number, hard: boolean): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = hard ? 0.28 : 0.15;
    const peakGain = (hard ? 0.9 : 0.5) * gainScale;

    const bus = ctx.createGain();

    // Noise thud component.
    const noiseSrc = this.createNoiseSource();
    noiseSrc.playbackRate.value = rate;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = hard ? 500 : 700;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(peakGain * 0.6, now);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);
    noiseSrc.connect(lowpass);
    lowpass.connect(noiseEnv);

    // Low sine thump component.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90 * rate, now);
    osc.frequency.exponentialRampToValueAtTime(55 * rate, now + duration);
    const oscEnv = ctx.createGain();
    oscEnv.gain.setValueAtTime(peakGain, now);
    oscEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(oscEnv);

    if (hard) {
      // Light distortion on the hard landing for extra impact.
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.distortionCurve as Float32Array<ArrayBuffer> | null;
      shaper.oversample = '2x';
      noiseEnv.connect(shaper);
      oscEnv.connect(shaper);
      shaper.connect(bus);
    } else {
      noiseEnv.connect(bus);
      oscEnv.connect(bus);
    }

    this.scheduleStop(noiseSrc, now, duration, [lowpass, noiseEnv]);
    this.scheduleStop(osc, now, duration, [oscEnv]);
    // The bus (and shaper, if any) gets cleaned up once both sources end;
    // schedule its own disconnect slightly after the longer of the two.
    const cleanupMs = (duration + 0.05) * 1000;
    setTimeout(() => bus.disconnect(), cleanupMs);

    return bus;
  }

  /** Quick filtered-noise whoosh for ducking under a hazard - lighter and
   *  shorter than the land thud it used to reuse (a re-pitched 'land'). */
  private synthSlideDuck(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.18;
    const peakGain = 0.35 * gainScale;

    const noiseSrc = this.createNoiseSource();
    noiseSrc.playbackRate.value = rate;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.Q.value = 0.8;
    bandpass.frequency.setValueAtTime(1400 * rate, now);
    bandpass.frequency.exponentialRampToValueAtTime(300 * rate, now + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(peakGain, now + 0.03);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noiseSrc.connect(bandpass);
    bandpass.connect(env);

    this.scheduleStop(noiseSrc, now, duration, [bandpass, env]);
    return env;
  }

  /** Noise burst plus a detuned square blip with a fast decay. */
  private synthCollision(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.18;

    const bus = ctx.createGain();

    const noiseSrc = this.createNoiseSource();
    noiseSrc.playbackRate.value = rate;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 900;
    bandpass.Q.value = 0.7;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.7 * gainScale, now);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);
    noiseSrc.connect(bandpass);
    bandpass.connect(noiseEnv);

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(180 * rate, now);
    osc.detune.value = -30;
    const oscEnv = ctx.createGain();
    oscEnv.gain.setValueAtTime(0.001, now);
    oscEnv.gain.exponentialRampToValueAtTime(0.5 * gainScale, now + 0.01);
    oscEnv.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.7);
    osc.connect(oscEnv);

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.distortionCurve as Float32Array<ArrayBuffer> | null;
    shaper.oversample = '2x';

    noiseEnv.connect(shaper);
    oscEnv.connect(shaper);
    shaper.connect(bus);

    this.scheduleStop(noiseSrc, now, duration, [bandpass, noiseEnv]);
    this.scheduleStop(osc, now, duration * 0.7, [oscEnv]);
    setTimeout(() => {
      shaper.disconnect();
      bus.disconnect();
    }, (duration + 0.05) * 1000);

    return bus;
  }

  /** Bright ascending 3-note sine arpeggio. */
  private synthFishCollect(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    const notes = [880, 1174, 1568];
    const noteDuration = 0.09;
    const gap = 0.07;

    notes.forEach((freq, i) => {
      const start = now + i * gap;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * rate;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, start);
      env.gain.exponentialRampToValueAtTime(0.35 * gainScale, start + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, start + noteDuration);

      osc.connect(env);
      env.connect(bus);
      this.scheduleStop(osc, start, noteDuration, [env]);
    });

    const totalDuration = (notes.length - 1) * gap + noteDuration;
    setTimeout(() => bus.disconnect(), (totalDuration + 0.1) * 1000);

    return bus;
  }

  /** A brighter, longer four-note run than `synthFishCollect` - a power-up
   *  is meant to read as a bigger deal than one fish. */
  private synthPowerUp(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    const notes = [523, 659, 784, 1047];
    const noteDuration = 0.11;
    const gap = 0.06;

    notes.forEach((freq, i) => {
      const start = now + i * gap;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq * rate;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, start);
      env.gain.exponentialRampToValueAtTime(0.4 * gainScale, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.001, start + noteDuration);

      osc.connect(env);
      env.connect(bus);
      this.scheduleStop(osc, start, noteDuration, [env]);
    });

    const totalDuration = (notes.length - 1) * gap + noteDuration;
    setTimeout(() => bus.disconnect(), (totalDuration + 0.1) * 1000);

    return bus;
  }

  /** Two quick formant-ish bursts - square through bandpass with a fast pitch drop. */
  private synthBark(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    const burstDuration = 0.09;
    const gap = 0.1;

    for (let i = 0; i < 2; i++) {
      const start = now + i * gap;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(340 * rate, start);
      osc.frequency.exponentialRampToValueAtTime(160 * rate, start + burstDuration);

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 700;
      bandpass.Q.value = 1.2;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, start);
      env.gain.exponentialRampToValueAtTime(0.55 * gainScale, start + 0.015);
      env.gain.exponentialRampToValueAtTime(0.001, start + burstDuration);

      osc.connect(bandpass);
      bandpass.connect(env);
      env.connect(bus);
      this.scheduleStop(osc, start, burstDuration, [bandpass, env]);
    }

    const totalDuration = gap + burstDuration;
    setTimeout(() => bus.disconnect(), (totalDuration + 0.1) * 1000);

    return bus;
  }

  /** Nonverbal angry vowel: sawtooth, lowpass sweep, vibrato, ~300ms. */
  private synthChefShout(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.3;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240 * rate, now);
    osc.frequency.exponentialRampToValueAtTime(180 * rate, now + duration);

    // Vibrato via an LFO into detune.
    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 11;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 25;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.detune);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(2200, now);
    lowpass.frequency.exponentialRampToValueAtTime(500, now + duration);
    lowpass.Q.value = 2;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(0.5 * gainScale, now + 0.04);
    env.gain.setValueAtTime(0.5 * gainScale, now + duration * 0.6);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(lowpass);
    lowpass.connect(env);

    vibrato.start(now);
    vibrato.stop(now + duration + 0.02);
    this.scheduleStop(osc, now, duration, [lowpass, env]);
    setTimeout(() => vibratoGain.disconnect(), (duration + 0.05) * 1000);

    return env;
  }

  /** A short "me-ow": pitch rises then falls, same vibrato-into-detune
   *  trick as `synthChefShout`, through a swept bandpass for a nasal,
   *  vocal-ish timbre rather than a flat tone. */
  private synthCatMeow(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.38;
    const riseEnd = now + duration * 0.4;
    const fallEnd = now + duration;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(380 * rate, now);
    osc.frequency.exponentialRampToValueAtTime(680 * rate, riseEnd);
    osc.frequency.exponentialRampToValueAtTime(340 * rate, fallEnd);

    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 7;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 18;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.detune);

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(900, now);
    bandpass.frequency.exponentialRampToValueAtTime(1400, riseEnd);
    bandpass.frequency.exponentialRampToValueAtTime(700, fallEnd);
    bandpass.Q.value = 3;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(0.45 * gainScale, now + 0.05);
    env.gain.setValueAtTime(0.45 * gainScale, riseEnd);
    env.gain.exponentialRampToValueAtTime(0.001, fallEnd);

    osc.connect(bandpass);
    bandpass.connect(env);

    vibrato.start(now);
    vibrato.stop(fallEnd + 0.02);
    this.scheduleStop(osc, now, duration, [bandpass, env]);
    setTimeout(() => vibratoGain.disconnect(), (duration + 0.05) * 1000);

    return env;
  }

  /** Rapid flutter: repeated short noise bursts with rising amplitude. */
  private synthPigeon(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    const burstCount = 6;
    const burstDuration = 0.03;
    const gap = 0.045;

    for (let i = 0; i < burstCount; i++) {
      const start = now + i * gap;
      const amp = 0.15 + (i / (burstCount - 1)) * 0.35;

      const source = this.createNoiseSource();
      source.playbackRate.value = rate * (1.4 + Math.random() * 0.3);

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 2200;
      bandpass.Q.value = 0.8;

      const env = ctx.createGain();
      env.gain.setValueAtTime(amp * gainScale, start);
      env.gain.exponentialRampToValueAtTime(0.001, start + burstDuration);

      source.connect(bandpass);
      bandpass.connect(env);
      env.connect(bus);
      this.scheduleStop(source, start, burstDuration, [bandpass, env]);
    }

    const totalDuration = burstCount * gap + burstDuration;
    setTimeout(() => bus.disconnect(), (totalDuration + 0.1) * 1000);

    return bus;
  }

  /** Hissy highpass noise with an envelope, ~600ms. */
  private synthSteam(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.6;

    const source = this.createNoiseSource();
    source.playbackRate.value = rate;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 3500;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(0.35 * gainScale, now + 0.05);
    env.gain.setValueAtTime(0.35 * gainScale, now + duration * 0.5);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(highpass);
    highpass.connect(env);

    this.scheduleStop(source, now, duration, [highpass, env]);
    return env;
  }

  /** Cheerful ascending major arpeggio with a little delay-based reverb. */
  private synthLevelComplete(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const bus = ctx.createGain();

    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.16;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.25;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0.3;

    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(bus);

    const notes = [523.25, 659.25, 784.0, 1046.5]; // C5 E5 G5 C6
    const noteDuration = 0.16;
    const gap = 0.12;

    notes.forEach((freq, i) => {
      const start = now + i * gap;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq * rate;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, start);
      env.gain.exponentialRampToValueAtTime(0.4 * gainScale, start + 0.015);
      env.gain.exponentialRampToValueAtTime(0.001, start + noteDuration);

      osc.connect(env);
      env.connect(bus);
      env.connect(delay);
      this.scheduleStop(osc, start, noteDuration, [env]);
    });

    const totalDuration = (notes.length - 1) * gap + noteDuration + 0.6;
    setTimeout(() => {
      delay.disconnect();
      feedback.disconnect();
      delayWet.disconnect();
      bus.disconnect();
    }, totalDuration * 1000);

    return bus;
  }

  /** Descending detuned tone with a comic pitch bend down. */
  private synthFail(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.5;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320 * rate, now);
    osc.frequency.exponentialRampToValueAtTime(90 * rate, now + duration);
    osc.detune.setValueAtTime(0, now);
    osc.detune.linearRampToValueAtTime(-40, now + duration);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1200;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.4 * gainScale, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(lowpass);
    lowpass.connect(env);

    this.scheduleStop(osc, now, duration, [lowpass, env]);
    return env;
  }

  /** Tiny high click. */
  private synthUiClick(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.03;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1400 * rate;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(0.25 * gainScale, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(env);
    this.scheduleStop(osc, now, duration, [env]);
    return env;
  }

  /** Even quieter, higher hover tick. */
  private synthUiHover(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.025;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1800 * rate;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(0.12 * gainScale, now + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(env);
    this.scheduleStop(osc, now, duration, [env]);
    return env;
  }

  /** Single clean beep. */
  private synthCountdown(rate: number, gainScale: number): AudioNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const duration = 0.15;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 660 * rate;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(0.4 * gainScale, now + 0.01);
    env.gain.setValueAtTime(0.4 * gainScale, now + duration * 0.6);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(env);
    this.scheduleStop(osc, now, duration, [env]);
    return env;
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /** Creates a fresh AudioBufferSourceNode backed by the shared noise buffer. */
  private createNoiseSource(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    return source;
  }

  /** Generates NOISE_BUFFER_SECONDS of white noise, once, at unlock time. */
  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** Builds a simple soft-clip distortion curve for the WaveShaper. */
  private createDistortionCurve(amount: number): Float32Array {
    const sampleCount = 44100;
    const curve = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const x = (i * 2) / sampleCount - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  /**
   * Schedules `source` to start now and stop after `duration`, disconnecting
   * it (and any accompanying nodes) once it has ended so nothing leaks.
   */
  private scheduleStop(
    source: AudioScheduledSourceNode,
    startTime: number,
    duration: number,
    accompanying: AudioNode[],
  ): void {
    const stopTime = startTime + duration + 0.02;
    source.start(startTime);
    source.stop(stopTime);
    source.addEventListener('ended', () => {
      source.disconnect();
      for (const node of accompanying) {
        node.disconnect();
      }
    });
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
