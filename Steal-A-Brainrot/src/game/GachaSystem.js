// The Brainrot Machine's logic, presentation-free (MachineUI is the theater).
// Two-stage weighted draw: reward kind first, then a creature within it, so a
// fixed pool still reads as authored. rng is injectable for tests.
class GachaSystem {
  constructor(board, economy) {
    this.board = board;
    this.economy = economy;
  }

  cost() {
    // The two rigged tutorial pulls are free: the first merge must never be
    // blocked by a coin balance.
    if (this._rigged()) return 0;
    return Math.round(CFG.MACHINE.baseCost * Math.pow(CFG.MACHINE.costGrowth, SaveSys.data.run.pulls || 0));
  }

  _rigged() {
    return !SaveSys.data.tutorialDone && (SaveSys.data.stats.pulls || 0) < 2;
  }

  // null = pull allowed, else the reason the button should explain
  whyNot() {
    if (this.board.firstEmptyBench() === -1) return 'bench';
    if (!this.economy.canAfford(this.cost())) return 'coins';
    return null;
  }

  // Spends the coins and rolls. Returns { kind, defs: [creatureDef], coins }.
  // The caller spawns the creatures after its reveal ceremony.
  pull(rng) {
    const r = rng || Math.random;
    if (this.whyNot()) return null;
    // Tutorial rig: the first two pulls are free and hand out the same common
    // so the very first merge is guaranteed. The "I already have this --
    // MERGE!" beat is the whole game; it must not be left to luck.
    const rigged = this._rigged();
    this.economy.spend(this.cost());
    SaveSys.data.run.pulls = (SaveSys.data.run.pulls || 0) + 1;
    SaveSys.addStat('pulls');
    if (rigged) {
      return { kind: 'brainrot', defs: [CREATURES_BY_ID.boneca], coins: 0 };
    }

    const kind = this._rollKind(r);
    const cost = this.cost();

    switch (kind) {
      case 'coins':
        return { kind, defs: [], coins: Math.round(cost * CFG.MACHINE.coinsPayout) };
      case 'double': {
        const defs = [this._rollCreature(0, r)];
        if (this.board.emptyBenchCount() >= 2) defs.push(this._rollCreature(0, r));
        return { kind, defs, coins: 0 };
      }
      case 'rareCapsule':
        return { kind, defs: [this._rollCreature(2, r)], coins: 0 };
      case 'jackpot':
        return { kind, defs: [this._rollCreature(3, r)], coins: Math.round(cost * CFG.MACHINE.jackpotCoins) };
      default:
        return { kind: 'brainrot', defs: [this._rollCreature(0, r)], coins: 0 };
    }
  }

  // Guaranteed rare-or-better, paid with a ticket.
  ticketPull(rng) {
    const r = rng || Math.random;
    if (this.board.firstEmptyBench() === -1) return null;
    if (!this.economy.spendTicket()) return null;
    SaveSys.addStat('pulls');
    return { kind: 'rareCapsule', defs: [this._rollCreature(CFG.TICKET_PULL_MIN_TIER, r)], coins: 0 };
  }

  _rollKind(r) {
    const table = CFG.MACHINE.rewards;
    let total = 0;
    for (const k of Object.keys(table)) total += table[k];
    let roll = r() * total;
    for (const k of Object.keys(table)) {
      roll -= table[k];
      if (roll <= 0) return k;
    }
    return 'brainrot';
  }

  _rollCreature(minTier, r) {
    // Bias part of the mass toward a duplicate the player can actually merge:
    // it manufactures the core-loop beat without ever *blocking* new pulls.
    if (minTier === 0 && r() < CFG.MACHINE.dupeBias) {
      const owned = this.board.allUnits().filter((u) => u.star < CFG.STAR.max);
      if (owned.length > 0) {
        const pickFrom = owned[Math.floor(r() * owned.length)];
        return CREATURES_BY_ID[pickFrom.id];
      }
    }
    return this.pickDef(minTier, r);
  }

  // Weighted rarity roll: a rarity's weight is split across its members, so
  // adding a creature never inflates its whole tier.
  pickDef(minTier, r) {
    const counts = {};
    CREATURES.forEach((c) => { counts[c.rarity] = (counts[c.rarity] || 0) + 1; });
    const pool = CREATURES.filter((c) => RARITIES[c.rarity].tier >= (minTier || 0));
    let total = 0;
    const weights = pool.map((c) => {
      const w = (CFG.RARITY_WEIGHTS[c.rarity] || 0) / counts[c.rarity];
      total += w;
      return w;
    });
    let roll = r() * total;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }
}
window.GachaSystem = GachaSystem;
