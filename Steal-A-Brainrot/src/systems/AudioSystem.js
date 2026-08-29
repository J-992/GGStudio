// All audio is synthesized with WebAudio -- zero audio assets to load. One
// small step sequencer supplies background music ('normal' between waves,
// 'battle' during them, 'boss' for boss stages), and sfx() plays short
// synthesized stingers.
const AudioSys = {
  ctx: null,
  master: null,
  musicGain: null,
  muted: false,
  _musicMode: null,       // 'normal' | 'battle' | 'boss' | null
  _seqTimer: null,
  _step: 0,

  // Created lazily on the first user gesture so autoplay policy is satisfied.
  ensure() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.34;
      this.musicGain.connect(this.master);
    } catch (e) { return false; }
    return true;
  },

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

  // One synthesized voice: freq (or [start,end] slide), duration, wave, volume.
  _tone(freq, dur, type, vol, when, dest) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (when || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'square';
    if (Array.isArray(freq)) {
      osc.frequency.setValueAtTime(freq[0], t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq[1]), t + dur);
    } else {
      osc.frequency.setValueAtTime(freq, t);
    }
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(dest || this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  },

  _noise(dur, vol, when) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (when || 0);
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol || 0.2;
    src.connect(g); g.connect(this.master);
    src.start(t);
  },

  sfx(name) {
    if (!this.ensure() || this.muted) return;
    switch (name) {
      case 'coin':
        this._tone(1320, 0.07, 'square', 0.12); this._tone(1760, 0.09, 'square', 0.10, 0.06); break;
      case 'pull':       // machine button pressed
        this._tone([300, 640], 0.14, 'square', 0.2); this._tone(180, 0.1, 'square', 0.16, 0.1); break;
      case 'bounce':     // capsule pings off a peg
        this._tone(880 + Math.random() * 400, 0.05, 'square', 0.1); break;
      case 'capsule':    // capsule lands, cracks open
        this._noise(0.08, 0.22); this._tone([500, 900], 0.12, 'triangle', 0.2, 0.04); break;
      case 'reveal':     // rare+ glow
        this._tone(880, 0.1, 'triangle', 0.25); this._tone(1109, 0.1, 'triangle', 0.25, 0.09);
        this._tone(1319, 0.22, 'triangle', 0.25, 0.18); break;
      case 'legendary':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone(f, 0.16, 'square', 0.22, i * 0.08));
        this._noise(0.3, 0.08, 0.4); break;
      case 'merge':
        [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.14, 'triangle', 0.22, i * 0.06));
        this._noise(0.4, 0.1, 0.42); break;
      case 'pickup':     // drag begins
        this._tone([260, 420], 0.08, 'square', 0.14); break;
      case 'place':      // unit dropped on a slot
        this._tone([420, 260], 0.09, 'square', 0.16); break;
      case 'swap':
        this._tone(392, 0.06, 'square', 0.14); this._tone(523, 0.08, 'square', 0.14, 0.05); break;
      case 'sell':
        this._tone([700, 240], 0.16, 'sawtooth', 0.16); this._tone(1320, 0.08, 'square', 0.12, 0.14); break;
      case 'denied':
        this._tone([300, 180], 0.18, 'sawtooth', 0.18); break;
      case 'shoot':
        this._tone([900, 400], 0.06, 'square', 0.08); break;
      case 'hit':
        this._noise(0.05, 0.16); this._tone([300, 140], 0.07, 'square', 0.14, 0.01); break;
      case 'boom':       // slam / airstrike splash
        this._noise(0.2, 0.3); this._tone([180, 50], 0.3, 'sawtooth', 0.26, 0.02); break;
      case 'kill':
        this._tone([600, 1200], 0.1, 'square', 0.14); break;
      case 'hurt':       // enemy reached the base, life lost
        this._tone([400, 90], 0.3, 'sawtooth', 0.3); this._noise(0.16, 0.24); break;
      case 'wave':       // wave banner
        this._tone(659, 0.1, 'square', 0.22); this._tone(659, 0.1, 'square', 0.22, 0.12);
        this._tone(880, 0.2, 'square', 0.24, 0.24); break;
      case 'victory':
        [392, 523, 659, 784].forEach((f, i) => this._tone(f, 0.12, 'square', 0.24, i * 0.07));
        this._tone(1047, 0.3, 'square', 0.24, 0.3); break;
      case 'defeat':
        this._tone([500, 120], 0.5, 'sawtooth', 0.25); this._noise(0.2, 0.2); break;
      case 'boss':       // boss entrance
        this._tone([80, 160], 0.4, 'sawtooth', 0.3); this._tone([80, 160], 0.4, 'sawtooth', 0.3, 0.45);
        this._noise(0.3, 0.2, 0.9); break;
      case 'tick':
        this._tone(990, 0.03, 'square', 0.08); break;
    }
  },

  // ---- music: a tiny 16-step sequencer ----
  // Patterns: [bass note, arp note] per step (0 = rest), as note offsets from A2.
  _patterns: {
    normal: {
      bass: [0, 0, 7, 0, 5, 0, 7, 0, 3, 0, 7, 0, 5, 0, 10, 12],
      arp:  [12, 0, 16, 0, 19, 0, 16, 0, 15, 0, 19, 0, 17, 0, 22, 24],
      stepMs: 130, bassVol: 0.16, arpVol: 0.07,
    },
    battle: {
      bass: [0, 0, 1, 1, 0, 0, 3, 3, 0, 0, 1, 1, 5, 5, 3, 1],
      arp:  [12, 15, 13, 16, 12, 15, 18, 15, 12, 15, 13, 16, 19, 15, 18, 13],
      stepMs: 105, bassVol: 0.18, arpVol: 0.09,
    },
    boss: {
      bass: [0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 1, 6, 6, 5, 3],
      arp:  [12, 0, 13, 0, 12, 0, 15, 13, 12, 0, 13, 0, 18, 0, 17, 15],
      stepMs: 90, bassVol: 0.2, arpVol: 0.1,
    },
  },

  setMusic(mode) {
    if (mode === this._musicMode) return;
    this._musicMode = mode;
    if (this._seqTimer) { clearInterval(this._seqTimer); this._seqTimer = null; }
    if (!mode || !this.ensure()) return;
    this._step = 0;
    const play = () => {
      if (this.muted || !this.ctx || this.ctx.state !== 'running') { return; }
      const p = this._patterns[this._musicMode];
      if (!p) return;
      const s = this._step % 16;
      const base = 110; // A2
      const b = p.bass[s], a = p.arp[s];
      if (b !== null && s % 2 === 0) this._tone(base * Math.pow(2, b / 12), 0.16, 'triangle', p.bassVol, 0, this.musicGain);
      if (a) this._tone(base * 2 * Math.pow(2, a / 12), 0.1, 'square', p.arpVol, 0, this.musicGain);
      this._step++;
    };
    const p = this._patterns[mode];
    this._seqTimer = setInterval(play, p.stepMs);
  },
};
window.AudioSys = AudioSys;
