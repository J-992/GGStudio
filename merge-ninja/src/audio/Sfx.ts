import type { StorageLike } from '../data/types';
import { Music, type MusicTrack } from './Music';

/** Every authored cue. Keeping this list public makes event coverage testable. */
export const SFX_NAMES = [
  'click', 'coin', 'pickup', 'drop', 'merge', 'hit', 'strongHit', 'defeat',
  'newTier', 'bossDefeat', 'sell', 'error', 'swap', 'heal', 'powerup',
  'powerupMiss', 'shield', 'combo', 'stage', 'bossIntro', 'attack', 'card',
  'ascend', 'timer',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

/** Where the two channel volumes live between sessions. */
export const AUDIO_STORAGE_KEY = 'mn.audio';

/** Loudest the cue bus ever runs, before the player's own sfx volume. */
const SFX_CEILING = .18;

const clamp01 = (value: number, fallback: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

interface Tone {
  readonly at: number;
  readonly from: number;
  readonly to?: number;
  readonly duration: number;
  readonly gain?: number;
  readonly wave?: OscillatorType;
}

interface Cue {
  readonly tones: readonly Tone[];
  readonly noise?: { readonly at: number; readonly duration: number; readonly gain: number; readonly highpass?: number; readonly lowpass?: number };
}

const note = (at: number, from: number, duration: number, to = from, wave: OscillatorType = 'square', gain = .22): Tone => ({ at, from, to, duration, wave, gain });

/** Distinct silhouettes: actions remain recognisable even underneath music. */
const CUES: Readonly<Record<SfxName, Cue>> = {
  click: { tones: [note(0, 520, .045, 410, 'square', .13)] },
  coin: { tones: [note(0, 880, .08, 1120, 'sine', .2), note(.055, 1320, .1, 1660, 'sine', .14)] },
  pickup: { tones: [note(0, 360, .11, 760, 'triangle', .18), note(.07, 1040, .07, 920, 'sine', .1)] },
  drop: { tones: [note(0, 260, .09, 170, 'triangle', .2)], noise: { at: 0, duration: .045, gain: .08, lowpass: 900 } },
  merge: { tones: [note(0, 420, .12, 630, 'triangle', .2), note(.055, 630, .15, 920, 'square', .13), note(.11, 940, .16, 1260, 'sine', .1)] },
  hit: { tones: [note(0, 185, .09, 105, 'triangle', .22)], noise: { at: 0, duration: .055, gain: .13, lowpass: 1700 } },
  strongHit: { tones: [note(0, 125, .16, 52, 'sawtooth', .28), note(.02, 72, .19, 42, 'sine', .22)], noise: { at: 0, duration: .13, gain: .2, lowpass: 1200 } },
  defeat: { tones: [note(0, 392, .22, 330, 'triangle'), note(.16, 330, .22, 262, 'triangle'), note(.32, 262, .32, 165, 'triangle')] },
  newTier: { tones: [note(0, 523, .1, 659), note(.08, 659, .1, 784), note(.16, 784, .22, 1047, 'square', .2)] },
  bossDefeat: { tones: [note(0, 147, .32, 46, 'sawtooth', .28), note(.1, 523, .12, 659), note(.2, 659, .12, 784), note(.3, 784, .3, 1047)], noise: { at: 0, duration: .25, gain: .2, lowpass: 1400 } },
  sell: { tones: [note(0, 700, .09, 920, 'sine', .17), note(.07, 520, .12, 390, 'triangle', .16)] },
  error: { tones: [note(0, 180, .1, 150, 'square', .16), note(.12, 180, .13, 135, 'square', .18)] },
  swap: { tones: [note(0, 350, .12, 700, 'triangle', .15), note(.015, 700, .12, 350, 'triangle', .15)] },
  heal: { tones: [note(0, 440, .16, 660, 'sine', .16), note(.08, 554, .18, 830, 'sine', .14), note(.16, 659, .28, 988, 'sine', .15)] },
  powerup: { tones: [note(0, 330, .18, 990, 'sawtooth', .12), note(.06, 659, .2, 1318, 'square', .14), note(.12, 988, .28, 1480, 'sine', .14)] },
  powerupMiss: { tones: [note(0, 510, .13, 340, 'triangle', .13), note(.1, 340, .16, 220, 'triangle', .12)] },
  shield: { tones: [note(0, 1200, .08, 720, 'square', .16), note(.035, 1680, .16, 980, 'sine', .12)], noise: { at: 0, duration: .09, gain: .08, highpass: 4200 } },
  combo: { tones: [note(0, 600, .08, 820), note(.055, 820, .08, 1080), note(.11, 1080, .16, 1480)] },
  stage: { tones: [note(0, 196, .38, 130, 'sine', .25), note(.08, 392, .3, 523, 'triangle', .13)], noise: { at: 0, duration: .18, gain: .09, lowpass: 750 } },
  bossIntro: { tones: [note(0, 92, .34, 58, 'sawtooth', .25), note(.22, 116, .36, 73, 'sawtooth', .22)], noise: { at: 0, duration: .25, gain: .12, lowpass: 950 } },
  attack: { tones: [note(0, 620, .12, 105, 'sawtooth', .15)], noise: { at: 0, duration: .1, gain: .12, highpass: 1400 } },
  card: { tones: [note(0, 760, .045, 980, 'triangle', .12), note(.05, 980, .055, 720, 'triangle', .11)], noise: { at: 0, duration: .04, gain: .05, highpass: 3500 } },
  ascend: { tones: [note(0, 392, .16, 523), note(.1, 523, .16, 659), note(.2, 659, .16, 784), note(.3, 784, .34, 1175, 'square', .2)] },
  timer: { tones: [note(0, 980, .045, 1160, 'square', .1), note(.07, 1470, .08, 1760, 'square', .12)] },
};

/** Procedural WebAudio cues. Construction is deferred until a real gesture. */
export class Sfx {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private platformMuted = false;
  private voices = 0;
  private sfxLevel = 1;
  private musicLevel = 1;
  private track: Music | null = null;
  private wantedTrack: MusicTrack = 'dojo';
  private readonly storage: StorageLike | null;

  constructor(opts: { storage?: StorageLike | null } = {}) {
    this.storage = opts.storage === undefined ? this.defaultStorage() : opts.storage;
    this.loadLevels();
  }

  get sfxVolume(): number { return this.sfxLevel; }
  get musicVolume(): number { return this.musicLevel; }
  get musicTrack(): MusicTrack { return this.wantedTrack; }

  unlock(): void {
    if (this.context !== null) { void this.context.resume(); return; }
    const Ctor = window.AudioContext; if (Ctor === undefined) return;
    this.context = new Ctor();
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.master = this.context.createGain(); this.master.gain.value = this.effectiveSfxGain(); this.master.connect(this.context.destination);
    this.music = this.context.createGain(); this.music.gain.value = this.effectiveMusicGain(); this.music.connect(this.context.destination);
    this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.playMusic();
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.track?.stop();
    this.track = null;
    void this.context?.close().catch(() => undefined);
    this.context = null; this.master = null; this.music = null; this.noise = null; this.voices = 0;
  }

  private handleVisibility = (): void => {
    if (document.hidden || this.context === null) return;
    if (this.context.state === 'suspended') void this.context.resume();
  };

  setMuted(muted: boolean): void { this.muted = muted; this.applyGains(); }
  setPlatformMuted(muted: boolean): void { this.platformMuted = muted; this.applyGains(); }
  setSfxVolume(value: number): void { this.sfxLevel = clamp01(value, this.sfxLevel); this.applyGains(); this.saveLevels(); }
  setMusicVolume(value: number): void { this.musicLevel = clamp01(value, this.musicLevel); this.applyGains(); this.saveLevels(); }

  /** Changes the arrangement on its next bar line. Safe before audio unlock. */
  setMusicTrack(track: MusicTrack): void {
    this.wantedTrack = track;
    this.track?.setTrack(track);
  }

  playMusic(): void {
    if (this.context === null || this.music === null || this.track !== null) return;
    this.track = new Music(this.context, this.music, this.wantedTrack);
    this.track.start();
  }

  play(name: SfxName, tier = 1): void {
    if (this.context === null || this.master === null || this.silenced || this.sfxLevel <= 0 || this.voices >= 7) return;
    const cue = CUES[name];
    const pitch = name === 'merge' || name === 'combo' ? Math.min(1.55, 1 + Math.max(0, tier - 1) * .025) : 1;
    const now = this.context.currentTime;
    this.voices += 1;
    let finish = 0;
    for (const tone of cue.tones) {
      this.scheduleTone(now, tone, pitch);
      finish = Math.max(finish, tone.at + tone.duration);
    }
    if (cue.noise !== undefined) {
      this.scheduleNoise(now, cue.noise);
      finish = Math.max(finish, cue.noise.at + cue.noise.duration);
    }
    window.setTimeout(() => { this.voices = Math.max(0, this.voices - 1); }, Math.ceil((finish + .05) * 1000));
  }

  private scheduleTone(now: number, tone: Tone, pitch: number): void {
    const c = this.context; const out = this.master; if (c === null || out === null) return;
    const start = now + tone.at;
    const end = start + tone.duration;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = tone.wave ?? 'square';
    osc.frequency.setValueAtTime(tone.from * pitch, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(35, (tone.to ?? tone.from) * pitch), end);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain ?? .22, start + Math.min(.012, tone.duration / 3));
    gain.gain.exponentialRampToValueAtTime(.0001, end);
    osc.connect(gain).connect(out);
    osc.start(start); osc.stop(end + .01);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  private scheduleNoise(now: number, spec: NonNullable<Cue['noise']>): void {
    const c = this.context; const out = this.master; const buffer = this.noise;
    if (c === null || out === null || buffer === null) return;
    const start = now + spec.at;
    const source = c.createBufferSource(); source.buffer = buffer;
    const filter = c.createBiquadFilter();
    if (spec.highpass !== undefined) { filter.type = 'highpass'; filter.frequency.value = spec.highpass; }
    else { filter.type = 'lowpass'; filter.frequency.value = spec.lowpass ?? 1800; }
    const gain = c.createGain();
    gain.gain.setValueAtTime(spec.gain, start);
    gain.gain.exponentialRampToValueAtTime(.0001, start + spec.duration);
    source.connect(filter).connect(gain).connect(out);
    source.start(start); source.stop(start + spec.duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  private get silenced(): boolean { return this.muted || this.platformMuted; }
  private effectiveSfxGain(): number { return this.silenced ? 0 : SFX_CEILING * this.sfxLevel; }
  private effectiveMusicGain(): number { return this.silenced ? 0 : this.musicLevel; }

  private applyGains(): void {
    if (this.context === null) return;
    const now = this.context.currentTime;
    this.master?.gain.setTargetAtTime(this.effectiveSfxGain(), now, .02);
    this.music?.gain.setTargetAtTime(this.effectiveMusicGain(), now, .02);
  }

  private loadLevels(): void {
    try {
      const raw = this.storage?.getItem(AUDIO_STORAGE_KEY);
      if (raw === null || raw === undefined) return;
      const saved: unknown = JSON.parse(raw);
      if (typeof saved !== 'object' || saved === null) return;
      const { sfx, music } = saved as { sfx?: unknown; music?: unknown };
      if (typeof sfx === 'number') this.sfxLevel = clamp01(sfx, 1);
      if (typeof music === 'number') this.musicLevel = clamp01(music, 1);
    } catch {
      // Unreadable settings are not worth failing a boot over.
    }
  }

  private saveLevels(): void {
    try {
      this.storage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify({ sfx: this.sfxLevel, music: this.musicLevel }));
    } catch {
      // Storage may throw in Safari private browsing; play continues.
    }
  }

  private defaultStorage(): StorageLike | null { try { return globalThis.localStorage; } catch { return null; } }
}
