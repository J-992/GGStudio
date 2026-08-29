import { AUDIO } from '../config';

/**
 * Fully procedural WebAudio soundtrack and SFX.
 *
 * Nothing is downloaded: every sound is synthesised, which keeps the essential
 * payload to code, guarantees no external runtime requests, and sidesteps
 * sample licensing entirely. It also lets a Perfect be *layered* — whoosh,
 * body, sub punch and a sharp transient are four separate voices fired on the
 * same frame, which is what makes it read as better rather than just louder.
 *
 * The context stays suspended until the player's first input, per browser
 * autoplay policy, and is suspended again for the duration of any ad.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  private musicIntensity = 0;
  private targetIntensity = 0;
  private started = false;
  private _muted = false;

  get muted(): boolean {
    return this._muted;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this._muted ? 0 : AUDIO.masterVolume;
      this.master.connect(ctx.destination);

      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = AUDIO.musicVolume;
      this.musicGain.connect(this.master);

      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = 1;
      this.sfxGain.connect(this.master);

      this.started = true;
      void ctx.resume();
    } catch {
      // No audio context available — the game is fully playable in silence.
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : AUDIO.masterVolume, this.ctx.currentTime, 0.05);
    }
  }

  /** Used for ad boundaries: Poki requires the game to go quiet. */
  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  swing(): void {
    this.noise(0.09, 900, 3200, 0.16, 'bandpass');
  }

  hitGood(): void {
    this.tone(148, 0.1, 0.34, 'triangle', -0.4);
    this.noise(0.07, 700, 2600, 0.2, 'bandpass');
  }

  hitPerfect(): void {
    // Four layers on one frame: transient, body, sub punch, shimmer.
    this.noise(0.045, 2400, 6000, 0.3, 'bandpass');
    this.tone(196, 0.14, 0.4, 'triangle', -0.55);
    this.tone(58, 0.22, 0.55, 'sine', -0.85);
    this.tone(880, 0.18, 0.14, 'sine', -0.9, 1320);
  }

  hitRare(): void {
    this.tone(660, 0.3, 0.24, 'sine', -0.9, 1760);
    this.tone(440, 0.36, 0.2, 'triangle', -0.8, 880);
  }

  /** Steel on steel: the strike was stopped by a plate, not a body. */
  guardBreak(): void {
    this.noise(0.06, 3200, 8000, 0.26, 'bandpass');
    this.tone(1320, 0.22, 0.16, 'square', -0.9, 660);
    this.tone(330, 0.16, 0.3, 'triangle', -0.6);
  }

  whiff(): void {
    this.noise(0.16, 300, 900, 0.13, 'lowpass');
  }

  flowActivate(): void {
    this.tone(220, 0.7, 0.3, 'sawtooth', -0.9, 660);
    this.tone(110, 0.9, 0.28, 'sine', -0.9, 220);
    this.noise(0.5, 400, 5000, 0.16, 'bandpass');
  }

  flowDash(): void {
    this.noise(0.13, 1400, 5200, 0.2, 'bandpass');
    this.tone(520, 0.1, 0.14, 'sine', -0.7, 900);
  }

  flowHit(): void {
    this.tone(262, 0.11, 0.34, 'triangle', -0.5);
    this.noise(0.05, 1800, 5200, 0.24, 'bandpass');
  }

  finisher(): void {
    this.tone(44, 0.6, 0.7, 'sine', -0.95);
    this.tone(330, 0.4, 0.3, 'sawtooth', -0.9, 110);
    this.noise(0.4, 200, 4000, 0.3, 'bandpass');
  }

  hurt(): void {
    this.tone(90, 0.3, 0.4, 'sawtooth', -0.85, 48);
    this.noise(0.16, 200, 1200, 0.18, 'lowpass');
  }

  /** Deep displacement plus a bright spray transient for a body entering water. */
  splash(strength = 1): void {
    const s = Math.max(0.2, Math.min(1, strength));
    this.tone(68, 0.3, 0.32 * s, 'sine', -0.58, 38);
    this.noise(0.24, 110, 1100, 0.28 * s, 'lowpass');
    this.noise(0.1, 1800, 5200, 0.09 * s, 'bandpass');
  }

  /** Layered timber failure: low beam flex, snap, then loose splinters. */
  woodBreak(strength = 1): void {
    const s = Math.max(0.2, Math.min(1, strength));
    this.tone(92, 0.25, 0.32 * s, 'triangle', -0.65, 46);
    this.noise(0.085, 700, 3600, 0.32 * s, 'bandpass');
    this.noise(0.22, 180, 1500, 0.2 * s, 'lowpass');
  }

  /** Heavy trunk contact followed by the lighter hiss of shed foliage. */
  treeImpact(strength = 1): void {
    const s = Math.max(0.2, Math.min(1, strength));
    this.tone(78, 0.28, 0.31 * s, 'triangle', -0.48, 42);
    this.noise(0.13, 240, 1800, 0.25 * s, 'lowpass');
    this.noise(0.3, 1700, 6200, 0.08 * s, 'highpass');
  }

  ko(): void {
    this.tone(120, 1.2, 0.4, 'sine', -0.98, 40);
    this.noise(0.7, 120, 900, 0.2, 'lowpass');
  }

  ui(): void {
    this.tone(720, 0.07, 0.13, 'sine', -0.7, 980);
  }

  unlockJingle(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.26, 0.2, 'triangle', -0.8), i * 85));
  }

  /** Raises the music's energy, e.g. for the duration of Flow Mode. */
  setIntensity(value: number): void {
    this.targetIntensity = Math.max(0, Math.min(1, value));
  }

  /**
   * Drives the music. Called from the render loop with REAL delta so the
   * soundtrack keeps its tempo through hit-stop and slow motion.
   */
  update(dtReal: number): void {
    if (!this.ctx || !this.musicGain) return;
    this.musicIntensity += (this.targetIntensity - this.musicIntensity) * Math.min(1, dtReal * 2.2);
    this.musicTimer -= dtReal;
    if (this.musicTimer > 0) return;

    const bpm = 124;
    const beat = 60 / bpm / 2;
    this.musicTimer = beat;
    this.musicStep = (this.musicStep + 1) % 16;
    this.playMusicStep(this.musicStep);
  }

  private playMusicStep(step: number): void {
    // A short pentatonic loop: bass pulse, off-beat pluck, and a percussion
    // layer that only appears as intensity rises during Flow.
    const BASS = [55, 55, 0, 55, 73.4, 0, 55, 0, 49, 49, 0, 49, 65.4, 0, 61.7, 0];
    const LEAD = [0, 440, 0, 523, 0, 0, 587, 0, 0, 392, 0, 440, 0, 523, 0, 659];

    const bass = BASS[step];
    if (bass > 0) this.tone(bass, 0.22, 0.32, 'triangle', -0.7, undefined, this.musicGain);

    const lead = LEAD[step];
    if (lead > 0 && (step % 2 === 1 || this.musicIntensity > 0.5)) {
      this.tone(lead, 0.16, 0.07 + this.musicIntensity * 0.06, 'sine', -0.85, undefined, this.musicGain);
    }

    if (step % 4 === 0) this.noise(0.05, 400, 3000, 0.06 + this.musicIntensity * 0.05, 'bandpass', this.musicGain);
    if (this.musicIntensity > 0.35 && step % 2 === 1) {
      this.noise(0.03, 3000, 9000, 0.03 * this.musicIntensity, 'highpass', this.musicGain);
    }
  }

  private tone(
    freq: number,
    duration: number,
    gain: number,
    type: OscillatorType,
    pitchSlide = 0,
    slideTo?: number,
    dest?: GainNode | null,
  ): void {
    const ctx = this.ctx;
    const out = dest ?? this.sfxGain;
    if (!ctx || !out) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    // Jitter every one-shot so a fast combo never sounds like a loop.
    const jitter = 1 + (Math.random() - 0.5) * 2 * AUDIO.pitchJitter;
    osc.frequency.setValueAtTime(freq * jitter, now);
    const target = slideTo ?? freq * (1 + pitchSlide);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, target * jitter), now + duration);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noise(
    duration: number,
    freqLow: number,
    freqHigh: number,
    gain: number,
    filterType: BiquadFilterType,
    dest?: GainNode | null,
  ): void {
    const ctx = this.ctx;
    const out = dest ?? this.sfxGain;
    if (!ctx || !out) return;
    const now = ctx.currentTime;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freqHigh, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, freqLow), now + duration);
    filter.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(out);
    src.start(now);
    src.stop(now + duration + 0.02);
  }
}
