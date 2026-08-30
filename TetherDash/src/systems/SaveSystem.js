// localStorage persistence: personal bests for the endless run, plus settings.
//
// The key is versioned, and v2 is a clean break from the fifteen-level save v1
// wrote -- there are no levels to migrate, and a stale `levels` blob would just
// sit there forever.
const Save = {
  KEY: 'tether-dash-save-v2',
  data: null,

  load() {
    try {
      this.data = JSON.parse(localStorage.getItem(this.KEY)) || {};
    } catch (e) {
      this.data = {};
    }
    const d = this.data;
    d.best = d.best || 0;             // best score
    d.bestDist = d.bestDist || 0;     // best distance, metres
    d.bolts = d.bolts || 0;           // bolts collected across every run
    d.runs = d.runs || 0;
    if (d.sound === undefined) d.sound = true;
    if (d.seenTutorial === undefined) d.seenTutorial = false;
    return d;
  },

  persist() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* private mode */ }
  },

  /** -> true when this run beat the stored best, so the HUD can say so. */
  recordRun(score, distance, bolts) {
    const d = this.data;
    const beat = score > d.best;
    d.best = Math.max(d.best, score);
    d.bestDist = Math.max(d.bestDist, distance);
    d.bolts += bolts;
    d.runs++;
    this.persist();
    return beat;
  },

  setSound(on) { this.data.sound = on; this.persist(); },
  markTutorialSeen() { this.data.seenTutorial = true; this.persist(); }
};
