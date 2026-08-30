// Procedural WebAudio: every sound is synthesized, nothing is loaded.
// One-shots via play(); the tunnel has a continuous rush whose pitch and volume
// track how fast the run has got, via setRush().
const AudioSys = {
  ctx: null,
  master: null,
  rush: null,         // { osc, filt, g }
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
      // the magnet grabbing the next face: a short rising zip plus a clunk
      case 'flip':      this.tone(240, 0.13, 'square', 0.13, 780); this.thud(0.05, 0.16); break;
      case 'stumble':   this.tone(160, 0.2, 'sawtooth', 0.2, 60); this.thud(0.12, 0.28); break;
      case 'fall':      this.tone(500, 0.5, 'sine', 0.16, 90); break;
      case 'revive':    this.tone(320, 0.12, 'sine', 0.14, 700); this.tone(700, 0.22, 'sine', 0.14, 1050, 0.1); break;
      case 'milestone': this.tone(660, 0.1, 'triangle', 0.16); this.tone(990, 0.22, 'triangle', 0.16, undefined, 0.09); break;
      case 'pad':       this.tone(180, 0.24, 'sine', 0.2, 720); break;
      case 'best':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.16, undefined, i * 0.11));
        break;
      case 'gameover':
        [440, 349, 262].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.15, undefined, i * 0.14));
        break;
      case 'click':     this.tone(700, 0.05, 'square', 0.08); break;
      case 'warn':      this.tone(1100, 0.05, 'square', 0.07); break;
    }
  },

  // Continuous tunnel rush. `speed01` is 0 at the starting run speed and 1 at
  // the cap, so the soundtrack of a long run is the noise climbing with it.
  setRush(speed01) {
    if (!this.ctx || !this.enabled) return;
    if (speed01 > 0.005 && !this.rush) {
      const osc = this.ctx.createOscillator();
      const filt = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      filt.type = 'bandpass'; filt.Q.value = 4;
      g.gain.value = 0;
      osc.connect(filt); filt.connect(g); g.connect(this.master);
      osc.start();
      this.rush = { osc, filt, g };
    }
    if (this.rush) {
      const t = this.now();
      this.rush.g.gain.setTargetAtTime(0.012 + speed01 * 0.05, t, 0.12);
      this.rush.osc.frequency.setTargetAtTime(52 + speed01 * 46, t, 0.12);
      this.rush.filt.frequency.setTargetAtTime(180 + speed01 * 620, t, 0.12);
    }
  },

  stopRush() {
    if (this.rush) {
      try {
        this.rush.g.gain.setTargetAtTime(0, this.now(), 0.03);
        this.rush.osc.stop(this.now() + 0.2);
      } catch (e) { /* already torn down */ }
      this.rush = null;
    }
  },

  // Used when the tab is hidden and while an ad plays over the game.
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); },
  resume() { if (this.ctx && this.ctx.state === 'suspended' && this.enabled) this.ctx.resume(); }
};

document.addEventListener('visibilitychange', () => {
  // An ad owns the audio context while it runs; leave it alone.
  if (window.Poki && Poki.adPlaying) return;
  if (document.hidden) AudioSys.suspend(); else AudioSys.resume();
});
