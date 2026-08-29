// localStorage persistence. META (collection, bestStars, stats, settings)
// never lives inside `run`, so a future "restart progress" can wipe the run
// without touching the BRAINDEX. The run snapshot puts a reload back exactly
// where it was: board, coins, tickets, stage, machine pull count.
const SaveSys = {
  data: null,

  defaults() {
    return {
      // ---- meta ----
      muted: false,
      tutorialDone: false,
      tutorialStep: null,     // resume mid-tutorial after a reload
      taught: {},             // one-off lessons already shown
      discovered: [],         // creature ids ever owned
      bestStars: {},          // id -> highest star reached (feeds the Braindex)
      stats: {
        sessions: 0, playMs: 0, pulls: 0, merges: 0, kills: 0, bossKills: 0,
        stagesCleared: 0, coinsEarned: 0, fiveStars: 0,
      },
      // ---- current run ----
      run: {
        coins: CFG.ECON.startCoins, tickets: 0, stage: 1, pulls: 0,
        board: new Array(17).fill(null),   // [{ i: creatureId, s: star } | null]
      },
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(CFG.SAVE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      this.data = Object.assign(this.defaults(), parsed);
      this.data.taught = Object.assign({}, parsed.taught || {});
      this.data.bestStars = Object.assign({}, parsed.bestStars || {});
      this.data.stats = Object.assign(this.defaults().stats, parsed.stats || {});
      this.data.run = Object.assign(this.defaults().run, parsed.run || {});
      // One corrupt field costs only itself: the board must be a 17-slot array
      // of null or {i, s} with a known creature and a sane star.
      const board = Array.isArray(this.data.run.board) ? this.data.run.board : [];
      this.data.run.board = new Array(17).fill(null).map((_, k) => {
        const e = board[k];
        if (!e || !CREATURES_BY_ID[e.i]) return null;
        const s = Math.max(1, Math.min(CFG.STAR.max, Math.floor(e.s) || 1));
        return { i: e.i, s };
      });
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

  bestStar(id, star) {
    if ((this.data.bestStars[id] || 0) < star) {
      this.data.bestStars[id] = star;
      this.save();
    }
  },

  addStat(key, n) {
    this.data.stats[key] = (this.data.stats[key] || 0) + (n === undefined ? 1 : n);
  },

  snapshotRun(economy, board, stage) {
    this.data.run = {
      coins: Math.floor(economy.coins), tickets: economy.tickets,
      stage, pulls: this.data.run.pulls || 0,
      board: board.serialize(),
    };
    this.save();
  },
};
window.SaveSys = SaveSys;
