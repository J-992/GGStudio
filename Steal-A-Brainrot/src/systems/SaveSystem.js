// localStorage persistence. Everything is meta now -- levels are short, so a
// reload mid-level just restarts the level. Coins, the unlocked roster, the
// last squad and the next level to play are the whole progression.
const SaveSys = {
  data: null,

  defaults() {
    const starters = ['cocofanto', 'trippi', 'troppa'];
    return {
      muted: false,
      tutorialDone: false,
      coins: CFG.ECON.startCoins,
      unlocked: starters.slice(),
      team: starters.slice(),      // last squad used (ids, <= CFG.TEAM.size)
      level: 1,                    // next level to play
      stats: {
        sessions: 0, playMs: 0, kills: 0, planted: 0,
        levelsCleared: 0, coinsEarned: 0, bought: 0,
      },
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(CFG.SAVE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      this.data = Object.assign(this.defaults(), parsed);
      this.data.stats = Object.assign(this.defaults().stats, parsed.stats || {});
      // one corrupt field costs only itself
      const known = (id) => !!CREATURES_BY_ID[id];
      const starters = this.defaults().unlocked;
      const unlocked = Array.isArray(this.data.unlocked) ? this.data.unlocked.filter(known) : [];
      this.data.unlocked = [...new Set([...starters, ...unlocked])];
      const team = Array.isArray(this.data.team) ? this.data.team.filter((id) => known(id) && this.data.unlocked.includes(id)) : [];
      this.data.team = (team.length ? team : starters.slice()).slice(0, CFG.TEAM.size);
      this.data.level = Math.max(1, Math.floor(this.data.level) || 1);
      this.data.coins = Math.max(0, Math.floor(this.data.coins) || 0);
    } catch (e) {
      this.data = this.defaults();
    }
    return this.data;
  },

  save() {
    try { localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* full/blocked */ }
  },

  unlock(id) {
    if (this.data.unlocked.indexOf(id) === -1) {
      this.data.unlocked.push(id);
      this.save();
      return true;
    }
    return false;
  },

  addStat(key, n) {
    this.data.stats[key] = (this.data.stats[key] || 0) + (n === undefined ? 1 : n);
  },
};
window.SaveSys = SaveSys;
