// Procedural WebAudio: every sound is synthesized, nothing is loaded.
// One-shots via play(); the tether has a continuous creak whose pitch/volume
// follow tension via setTension().
const AudioSys = {
  ctx: null,
  master: null,
  creak: null,        // { osc, gain, filter }
  enabled: true,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  },

  // Browsers demand a user gesture before audio; call from the first tap.
  unlock() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  },

  now() { return this.ctx ? this.ctx.currentTime : 0; },

  tone(freq, dur, type, gain, slideTo, delay) {
    if (!this.ctx || !this.enabled) return;
    const t = this.now() + (delay || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  },

  thud(dur, gain, delay) {
    if (!this.ctx || !this.enabled) return;
    const t = this.now() + (delay || 0);
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t);
  },

  play(name) {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case 'jump':      this.tone(300, 0.16, 'square', 0.1, 620); break;
      case 'land':      this.thud(0.09, 0.22); break;
      case 'landHard':  this.thud(0.14, 0.32); this.tone(120, 0.1, 'sine', 0.12, 70); break;
      case 'coin':      this.tone(920, 0.07, 'square', 0.12); this.tone(1380, 0.16, 'square', 0.12, undefined, 0.06); break;
      case 'snap':      this.tone(220, 0.1, 'sawtooth', 0.16, 90); this.thud(0.06, 0.14); break;
      case 'stumble':   this.tone(160, 0.2, 'sawtooth', 0.2, 60); this.thud(0.12, 0.28); break;
      case 'fall':      this.tone(500, 0.5, 'sine', 0.16, 90); break;
      case 'rescue':    this.tone(320, 0.12, 'sine', 0.14, 700); this.tone(700, 0.2, 'sine', 0.14, 1050, 0.1); break;
      case 'checkpoint': this.tone(660, 0.1, 'triangle', 0.16); this.tone(990, 0.22, 'triangle', 0.16, undefined, 0.09); break;
      case 'pad':       this.tone(180, 0.24, 'sine', 0.2, 720); break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.16, undefined, i * 0.11));
        break;
      case 'click':     this.tone(700, 0.05, 'square', 0.08); break;
      case 'swap':      this.tone(500, 0.08, 'square', 0.1, 800); break;
      case 'warn':      this.tone(1100, 0.05, 'square', 0.07); break;
    }
  },

  // Continuous cord creak. tension 0..1 (0 = slack, 1 = at max length).
  setTension(tension) {
    if (!this.ctx || !this.enabled) { return; }
    if (tension > 0.05 && !this.creak) {
      const osc = this.ctx.createOscillator();
      const filt = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      filt.type = 'bandpass'; filt.Q.value = 8;
      g.gain.value = 0;
      osc.connect(filt); filt.connect(g); g.connect(this.master);
      osc.start();
      this.creak = { osc, filt, g };
    }
    if (this.creak) {
      const t = this.now();
      const vol = tension < 0.05 ? 0 : 0.015 + tension * 0.06;
      this.creak.g.gain.setTargetAtTime(vol, t, 0.06);
      this.creak.osc.frequency.setTargetAtTime(60 + tension * 160, t, 0.06);
      this.creak.filt.frequency.setTargetAtTime(220 + tension * 900, t, 0.06);
    }
  },

  stopTension() {
    if (this.creak) {
      try { this.creak.g.gain.setTargetAtTime(0, this.now(), 0.03); this.creak.osc.stop(this.now() + 0.2); } catch (e) {}
      this.creak = null;
    }
  }
};
