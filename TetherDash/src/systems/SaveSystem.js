// localStorage persistence: per-level stars/bolts, unlock progress, settings.
const Save = {
  KEY: 'tether-dash-save-v1',
  data: null,

  load() {
    try {
      this.data = JSON.parse(localStorage.getItem(this.KEY)) || {};
    } catch (e) {
      this.data = {};
    }
    this.data.levels = this.data.levels || {};       // id -> { stars, bolts, time }
    if (this.data.sound === undefined) this.data.sound = true;
    this.data.mode = this.data.mode || 'solo';       // 'solo' | 'coop'
    return this.data;
  },

  persist() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* private mode */ }
  },

  levelResult(id) { return this.data.levels[id] || null; },

  recordResult(id, stars, bolts, time) {
    const prev = this.data.levels[id];
    this.data.levels[id] = {
      stars: Math.max(stars, prev ? prev.stars : 0),
      bolts: Math.max(bolts, prev ? prev.bolts : 0),
      time: prev && prev.time ? Math.min(prev.time, time) : time
    };
    this.persist();
  },

  // Highest unlocked level: 1 + the highest completed id.
  unlockedUpTo() {
    let top = 1;
    for (const id of Object.keys(this.data.levels)) {
      const n = parseInt(id, 10);
      if (this.data.levels[id].stars > 0 && n + 1 > top) top = n + 1;
    }
    return Math.min(top, LEVELS.length);
  },

  totalStars() {
    let s = 0;
    for (const id of Object.keys(this.data.levels)) s += this.data.levels[id].stars;
    return s;
  },

  setSound(on) { this.data.sound = on; this.persist(); },
  setMode(mode) { this.data.mode = mode; this.persist(); }
};
