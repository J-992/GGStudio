import { MusicEngine } from "./MusicEngine";

class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music: MusicEngine | null = null;
  private muted = false;
  private tensionOsc!: OscillatorNode;
  private tensionGain!: GainNode;
  private tensionFilter!: BiquadFilterNode;
  private lastLand = 0;

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.4;
    this.master.connect(this.ctx.destination);
    this.music = new MusicEngine(this.ctx, this.master);

    this.tensionOsc = this.ctx.createOscillator();
    this.tensionOsc.type = "sawtooth";
    this.tensionOsc.frequency.value = 55;
    this.tensionFilter = this.ctx.createBiquadFilter();
    this.tensionFilter.type = "lowpass";
    this.tensionFilter.frequency.value = 300;
    this.tensionGain = this.ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionOsc.connect(this.tensionFilter).connect(this.tensionGain).connect(this.master);
    this.tensionOsc.start();
  }

  resume() {
    this.init();
    void this.ctx?.resume();
    this.music?.start();
  }

  get musicPlaying(): boolean {
    return this.music?.playing ?? false;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : 0.4;
    return this.muted;
  }

  setTension(t: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.tensionGain.gain.setTargetAtTime(t > 0.05 ? t * t * 0.16 : 0, now, 0.08);
    this.tensionOsc.frequency.setTargetAtTime(55 + t * 130, now, 0.08);
    this.tensionFilter.frequency.setTargetAtTime(200 + t * 900, now, 0.08);
  }

  private env(gain: GainNode, peak: number, attack: number, decay: number, when?: number) {
    const ctx = this.ctx!;
    const t = when ?? ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, peak, 0.008, dur, t);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, freq: number, peak: number, type: BiquadFilterType = "lowpass") {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = peak;
    src.connect(filt).connect(g).connect(this.master);
    src.start();
  }

  jump() { this.tone("square", 320, 640, 0.14, 0.16); }
  land() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastLand < 0.09) return;
    this.lastLand = now;
    this.noise(0.09, 420, 0.22);
    this.tone("sine", 150, 60, 0.09, 0.18);
  }
  rotate() { this.tone("triangle", 220, 440, 0.22, 0.2); this.noise(0.16, 1400, 0.06, "highpass"); }
  death() {
    this.tone("sawtooth", 380, 40, 0.5, 0.25);
    this.noise(0.4, 500, 0.3);
    this.setTension(0);
  }
  save() {
    this.tone("square", 520, 780, 0.12, 0.14);
    this.tone("square", 780, 1170, 0.16, 0.14, 0.09);
  }
  portal() {
    [440, 554, 659, 880].forEach((f, i) => this.tone("triangle", f, f * 1.02, 0.28, 0.16, i * 0.07));
    this.noise(0.5, 2400, 0.05, "highpass");
  }
  snap() { this.noise(0.12, 2000, 0.2, "bandpass"); }
}

export const audio = new AudioManager();
