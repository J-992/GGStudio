const STEP = 60 / 138 / 4;

const BASS_ROOTS = [45, 41, 36, 43];
const BASS_PATTERN = [0, -1, 0, 12, -1, 0, 7, -1, 0, -1, 0, 12, -1, 0, 7, -1];
const LEAD_STEPS: Record<number, number> = {
  0: 12, 3: 19, 6: 16, 10: 12, 12: 15, 14: 19,
};

function midi(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export class MusicEngine {
  readonly gain: GainNode;
  private ctx: AudioContext;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private noiseBuf: AudioBuffer;
  private leadDelay: DelayNode;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.55;
    this.gain.connect(dest);

    this.leadDelay = ctx.createDelay(0.5);
    this.leadDelay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.22;
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    this.leadDelay.connect(fb).connect(this.leadDelay);
    this.leadDelay.connect(wet).connect(this.gain);

    const len = Math.floor(ctx.sampleRate * 0.09);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  start() {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = window.setInterval(() => this.pump(), 25);
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private pump() {
    while (this.nextTime < this.ctx.currentTime + 0.13) {
      this.scheduleStep(this.step % 64, this.nextTime);
      this.step++;
      this.nextTime += STEP;
    }
  }

  private scheduleStep(s: number, t: number) {
    const bar = Math.floor(s / 16);
    const inBar = s % 16;
    const root = BASS_ROOTS[bar];

    if (inBar % 2 === 0) {
      const b = BASS_PATTERN[inBar / 2];
      if (b >= 0) this.bass(t, root + b);
    }
    const leadOff = LEAD_STEPS[inBar];
    if (leadOff !== undefined && (bar % 2 === 1 || inBar !== 12)) {
      this.lead(t, root + 24 + leadOff);
    }
    if (inBar % 4 === 0) this.kick(t);
    if (inBar === 8) this.snare(t);
    if (inBar % 2 === 1) this.hat(t, 0.05);
    else if (inBar % 4 === 2) this.hat(t, 0.028);
  }

  private bass(t: number, n: number) {
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(midi(n), t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 1.7);
    o.connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + STEP * 1.8);
  }

  private lead(t: number, n: number) {
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(midi(n), t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g);
    g.connect(this.gain);
    g.connect(this.leadDelay);
    o.start(t);
    o.stop(t + 0.2);
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(135, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + 0.15);
  }

  private snare(t: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(f).connect(g).connect(this.gain);
    src.start(t);
  }

  private hat(t: number, peak: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(f).connect(g).connect(this.gain);
    src.start(t);
  }
}
