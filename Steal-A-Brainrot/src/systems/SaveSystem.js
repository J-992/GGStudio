// localStorage persistence. Holds permanent progression (collection, stats,
// settings) plus a snapshot of the current run so a reload puts the player
// back where they were. Bots always re-roll fresh.
const SaveSys = {
  data: null,

  defaults() {
    return {
      discovered: [],          // creature ids the player has owned at least once
      muted: false,
      tutorialDone: false,
      tutorialStep: null,      // resume mid-tutorial after a reload
      taught: {},              // which one-off lessons have been shown
      best: { cash: 0, income: 0, steals: 0 },
      stats: {
        sessions: 0, playMs: 0, bought: 0, sold: 0, merged: 0, stolen: 0, robbed: 0,
        rares: 0, events: 0, cashEarned: 0,
      },
      // current-run snapshot
      run: null,               // { cash, creatures:[{i:id,n:income}], upgrades:{id:lvl} }
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(CFG.SAVE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      this.data = Object.assign(this.defaults(), parsed);
      this.data.taught = Object.assign({}, parsed.taught || {});
      this.data.best = Object.assign(this.defaults().best, parsed.best || {});
      this.data.stats = Object.assign(this.defaults().stats, parsed.stats || {});
    } catch (e) {
      this.data = this.defaults();
    }
    return this.data;
  },

  save() {
    try { localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* full/blocked */ }
  },

  discover(id) {
    if (this.data.discovered.indexOf(id) === -1) {
      this.data.discovered.push(id);
      this.save();
      return true;    // newly discovered
    }
    return false;
  },

  addStat(key, n) {
    this.data.stats[key] = (this.data.stats[key] || 0) + (n === undefined ? 1 : n);
  },

  snapshotRun(cash, creatures, upgrades) {
    this.data.run = { cash: Math.floor(cash), creatures, upgrades };
    this.save();
  },

  clearRun() {
    this.data.run = null;
    this.save();
  },
};
window.SaveSys = SaveSys;
