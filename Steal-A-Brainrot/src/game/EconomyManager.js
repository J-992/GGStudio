// Cash per owner, income accrual, and every income multiplier (upgrades,
// events, rewarded frenzy) resolved in one place.
class EconomyManager {
  constructor(scene) {
    this.scene = scene;
    this.cash = { player: CFG.START_CASH };
    this._acc = { player: 0 };
    CFG.BOTS.forEach((b) => { this.cash[b.id] = CFG.BOT_START_CASH; this._acc[b.id] = 0; });
    this.frenzyUntil = 0;       // rewarded-ad income boost
    this.frenzyReadyAt = 0;
  }

  mult(ownerId) {
    let m = this.scene.eventMgr ? this.scene.eventMgr.incomeMult() : 1;
    if (ownerId === 'player') {
      const upg = this.scene.upgrades.income || 0;
      m *= 1 + 0.25 * upg;
      if (this.scene.time.now < this.frenzyUntil) m *= CFG.FRENZY_MULT;
    }
    return m;
  }

  incomePerSec(ownerId) {
    let base = 0;
    this.scene.creatures.creaturesOf(ownerId).forEach((c) => {
      if (c.state === 'pedestal' || c.state === 'transit' || c.state === 'returning') base += c.income;
    });
    return base * this.mult(ownerId);
  }

  update(dtSec) {
    for (const id in this.cash) {
      let inc = this.incomePerSec(id);
      if (id !== 'player') inc += CFG.BOT_TRICKLE;
      this._acc[id] += inc * dtSec;
      const whole = Math.floor(this._acc[id]);
      if (whole > 0) {
        this._acc[id] -= whole;
        this.cash[id] += whole;
        if (id === 'player') {
          SaveSys.addStat('cashEarned', whole);
          if (this.cash.player > SaveSys.data.best.cash) SaveSys.data.best.cash = this.cash.player;
        }
      }
    }
    const inc = this.incomePerSec('player');
    if (inc > SaveSys.data.best.income) SaveSys.data.best.income = Math.floor(inc);
  }

  canAfford(ownerId, amt) { return this.cash[ownerId] >= amt; }

  spend(ownerId, amt) {
    if (this.cash[ownerId] < amt) return false;
    this.cash[ownerId] -= amt;
    return true;
  }

  earn(ownerId, amt) { this.cash[ownerId] += amt; }

  startFrenzy() {
    this.frenzyUntil = this.scene.time.now + CFG.FRENZY_DUR_MS;
    this.frenzyReadyAt = this.scene.time.now + CFG.FRENZY_CD_MS;
  }
}
window.EconomyManager = EconomyManager;
