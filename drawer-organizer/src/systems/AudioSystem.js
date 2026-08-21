// Procedural WebAudio sounds — no audio files needed. Unlocks on first user gesture.
const AudioSys = {
  ctx: null,

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  _tone(freq, start, dur, type, vol, endFreq) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, c.currentTime + start);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, c.currentTime + start + dur);
    g.gain.setValueAtTime(0, c.currentTime + start);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + dur + 0.05);
  },

  play(name) {
    if (!SaveSystem.soundOn) return;
    this.ensure();
    if (!this.ctx) return;
    switch (name) {
      case 'pick':     this._tone(440, 0, 0.09, 'sine', 0.12, 660); break;
      case 'drop':     this._tone(740, 0, 0.12, 'sine', 0.18); this._tone(1110, 0.07, 0.18, 'sine', 0.14); break;
      case 'wrong':    this._tone(300, 0, 0.16, 'triangle', 0.12, 190); break;
      case 'click':    this._tone(520, 0, 0.06, 'sine', 0.10); break;
      case 'sparkle':  this._tone(1560, 0, 0.10, 'sine', 0.07); this._tone(2080, 0.05, 0.10, 'sine', 0.05); break;
      case 'complete':
        [523, 659, 784, 1047].forEach((f, i) => this._tone(f, i * 0.11, 0.28, 'sine', 0.16));
        break;
      case 'reward':
        [784, 988, 1175, 1568].forEach((f, i) => this._tone(f, i * 0.08, 0.22, 'triangle', 0.10));
        break;
    }
  },

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); },
  resume()  { if (this.ctx && this.ctx.state === 'suspended' && SaveSystem.soundOn) this.ctx.resume(); }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) AudioSys.suspend(); else AudioSys.resume();
});
