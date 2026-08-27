import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { GameCore } from '../src/core/GameCore';
import { NINJAS, ninjaDef } from '../src/data/ninjas';
import { POTION } from '../src/data/pickups';
import { tempoFor } from '../src/data/pacing';
import { compactNumber } from '../src/ui/theme';

const newGame = () => new GameCore({ storage: null, now: () => 0 });
const TICK = BALANCE.boss.fixedTickMs;
const { mergeSpikeTarget, mergeSpikeTolerance } = BALANCE.progression;

/**
 * The merge spike of pair N is the total-board-DPS multiple you get by
 * trading two tier-N ninjas for one tier-(N+1) ninja. The configured target
 * is dpsGrowth / 2; the tolerance absorbs integer rounding of the small early
 * tiers and is asserted to hold for EVERY adjacent pair, not on average.
 */
const mergeSpikeOf = (tier: number): number =>
  ninjaDef(tier + 1).dps / (2 * ninjaDef(tier).dps);

describe('damage progression', () => {
  it('grows strictly monotonically across all 28 adjacent tier pairs', () => {
    for (let tier = 1; tier < BALANCE.tiers.count; tier += 1) {
      expect(ninjaDef(tier + 1).dps, `tier ${tier} -> ${tier + 1}`)
        .toBeGreaterThan(ninjaDef(tier).dps);
    }
  });

  it('gives every one of the 28 merges a total-DPS spike inside the configured band', () => {
    const low = mergeSpikeTarget - mergeSpikeTolerance;
    const high = mergeSpikeTarget + mergeSpikeTolerance;
    const spikes: number[] = [];
    for (let tier = 1; tier < BALANCE.tiers.count; tier += 1) spikes.push(mergeSpikeOf(tier));
    spikes.forEach((spike, index) => {
      const tier = index + 1;
      expect(spike, `merge ${tier}+${tier} -> ${tier + 1} spike ${spike.toFixed(4)}`)
        .toBeGreaterThanOrEqual(low);
      expect(spike, `merge ${tier}+${tier} -> ${tier + 1} spike ${spike.toFixed(4)}`)
        .toBeLessThanOrEqual(high);
    });
    expect(Math.min(...spikes)).toBeGreaterThan(1.05);
  });

  it('keeps the top tier readable by the HUD compact formatter', () => {
    const top = ninjaDef(BALANCE.tiers.count).dps;
    // Top-tier DPS now crosses the trillion line; compactNumber grew a T
    // suffix so the HUD never shows bare 13-digit numbers.
    expect(compactNumber(top)).toMatch(/^[\d.]+[BT]$/);
    expect(compactNumber(top * BALANCE.board.slots)).toMatch(/^[\d.]+[BT]$/);
  });

  it('matches displayed DPS to damage actually removed, tier by tier', () => {
    for (const ninja of NINJAS) {
      const game = newGame();
      game.spawnTier(ninja.tier);
      const expectedTick = ninja.dps * (TICK / 1000);
      let guard = 0;
      // Advance to a boss that is both big enough to absorb a whole tick and
      // carrying no modifier: this asserts the raw DPS accounting contract,
      // and a barrier or a regeneration tick is a different contract with its
      // own tests in bossArchetypes.test.ts.
      while (
        (game.boss.boss.maxHealth < expectedTick * 4 || game.boss.archetype.id !== 'bare') &&
        guard < 400
      ) {
        game.skipEnemy();
        guard += 1;
      }
      const hpBefore = game.boss.hp;
      game.update(TICK);
      expect(game.boss.hp, `tier ${ninja.tier} displayed ${ninja.dps} dps`)
        .toBeCloseTo(hpBefore - expectedTick, 6);
    }
  });
});

describe('board DPS accounting', () => {
  it('turns every successful merge into an immediate boss-health payoff', () => {
    const game = newGame();
    game.grantCoins(100);
    game.buy();
    game.buy();
    const before = game.boss.hp;
    let mergeDamage = 0;
    game.events.on('bossDamaged', (event) => {
      if (event.source === 'merge') mergeDamage = event.damage;
    });

    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('merged');
    const expected = Math.max(1, Math.round(game.boss.boss.maxHealth * BALANCE.progression.mergeStrikeHealthShare));
    expect(mergeDamage).toBe(expected);
    expect(game.boss.hp).toBe(before - expected);
  });

  it('sums DPS from every ninja on the board', () => {
    const game = newGame();
    game.spawnTier(1); game.spawnTier(3); game.spawnTier(5);
    expect(game.totalDps).toBe(ninjaDef(1).dps + ninjaDef(3).dps + ninjaDef(5).dps);
  });

  it('applies board DPS over fixed ticks and pays fractional damage income', () => {
    const game = newGame();
    game.spawnTier(1);
    const hp = game.boss.hp;
    const coins = game.economy.coins;
    game.update(TICK * 2);
    expect(game.economy.coins).toBe(coins);
    game.update(TICK * 20);
    expect(game.economy.coins).toBeGreaterThan(coins);
    expect(game.boss.hp).toBeCloseTo(hp - ninjaDef(1).dps * 2.2, 6);
  });

  it('emits defeat, scales the next boss, and cycles boss identities', () => {
    const game = newGame();
    game.spawnTier(12);
    const firstHp = game.boss.boss.maxHealth;
    let reward = 0;
    game.events.on('bossDefeated', (e) => { reward = e.reward; });
    game.update(TICK);
    expect(reward).toBeGreaterThan(0);
    game.update(BALANCE.boss.defeatDelayMs);
    expect(game.boss.stage).toBe(2);
    expect(game.boss.boss.maxHealth).toBeGreaterThan(firstHp);
    expect(game.boss.hp).toBe(game.boss.boss.maxHealth);
  });

  it('lets every player tap remove the configured share of the boss health immediately', () => {
    const game = newGame();
    game.spawnTier(1);
    const hpBefore = game.boss.hp;
    let tapDamage = 0;
    game.events.on('bossDamaged', (event) => {
      if (event.source === 'tap') tapDamage = event.damage;
    });

    const dealt = game.tapBoss();
    expect(dealt).toBe(Math.max(1, Math.round(game.boss.boss.maxHealth * BALANCE.boss.playerTapHealthShare)));
    expect(game.boss.hp).toBe(hpBefore - dealt);
    expect(tapDamage).toBe(dealt);
    const second = game.tapBoss();
    expect(second).toBe(dealt);
    expect(game.boss.hp).toBe(hpBefore - dealt - second);
  });

  it('does not allow boss taps before the player has a ninja', () => {
    expect(newGame().tapBoss()).toBe(0);
  });
});

describe('incoming damage', () => {
  interface Strike { atMs: number; damage: number }

  /**
   * Steps the core in fixed 10ms slices and records boss strikes with their
   * times. The boss is fattened past everything the current board can deal
   * during the window first, so no kill/defeat pause interrupts the
   * measurement: strike cadence is maintained in active simulation time, so
   * a defeat in the middle would legitimately stretch a wall gap.
   */
  function runStrikes(game: GameCore, durationMs: number): Strike[] {
    const safeHealth = game.totalDps * (durationMs / 1000) * 10 + 100_000;
    let guard = 0;
    while (game.boss.boss.maxHealth < safeHealth && guard < 400) {
      game.skipEnemy();
      guard += 1;
    }
    const strikes: Strike[] = [];
    let clock = 0;
    const offload = game.events.on('bossAttack', (event) => {
      strikes.push({ atMs: clock, damage: event.damage });
    });
    for (let elapsed = 0; elapsed < durationMs; elapsed += TICK) {
      clock = elapsed;
      game.update(TICK);
    }
    offload();
    return strikes;
  }

  it('keeps strike cadence in step with the tempo phase multiplier', () => {
    const game = newGame();
    game.spawnTier(1);
    const opening = runStrikes(game, 12_000);
    expect(opening.length).toBeGreaterThanOrEqual(5);
    const openingInterval = BALANCE.boss.attackIntervalMs * tempoFor(0).attackIntervalMultiplier;
    for (let index = 1; index < opening.length; index += 1) {
      const gap = opening[index]!.atMs - opening[index - 1]!.atMs;
      expect(Math.abs(gap - openingInterval)).toBeLessThanOrEqual(2 * TICK);
    }

    // A champion who can actually clear stages rides constant victory heals
    // through the fast-forward, so the line is alive and healthy at RISING.
    game.spawnTier(29);
    game.update(109_000);
    const rising = runStrikes(game, 12_000);
    expect(rising.length).toBeGreaterThanOrEqual(5);
    const risingStart = 121_000;
    const risingInterval = BALANCE.boss.attackIntervalMs * tempoFor(risingStart).attackIntervalMultiplier;
    for (let index = 1; index < rising.length; index += 1) {
      const gap = rising[index]!.atMs - rising[index - 1]!.atMs;
      expect(Math.abs(gap - risingInterval)).toBeLessThanOrEqual(2 * TICK);
    }
  });

  it('never lets one swing exceed the configured share of maximum health', () => {
    const game = newGame();
    game.spawnTier(24);
    game.update(121_000);
    const ceiling = Math.ceil(game.playerMaxHealth * BALANCE.player.maxHitShare);
    const strikes = runStrikes(game, 30_000);
    expect(strikes.length).toBeGreaterThanOrEqual(10);
    for (const strike of strikes) {
      expect(strike.damage).toBeGreaterThanOrEqual(1);
      expect(strike.damage).toBeLessThanOrEqual(ceiling);
    }
    expect(game.playerHealth).toBeGreaterThanOrEqual(0);
  });

  it('lets the boss posture at an empty line without hurting it', () => {
    const game = newGame();
    let attacks = 0;
    let damage = -1;
    const hp = game.playerHealth;
    game.events.on('bossAttack', (event) => { attacks += 1; damage = event.damage; });
    game.update(BALANCE.boss.attackIntervalMs);
    expect(game.boss.hp).toBe(game.boss.boss.maxHealth);
    expect(attacks).toBe(1);
    expect(damage).toBe(0);
    expect(game.playerHealth).toBe(hp);
  });
});

describe('heal triggers', () => {
  interface Heal { delta: number; reason: string; hp: number; maxHp: number }

  function healLog(game: GameCore): Heal[] {
    const log: Heal[] = [];
    game.events.on('playerHealthChanged', (event) => {
      log.push({ delta: event.delta, reason: event.reason, hp: event.hp, maxHp: event.maxHp });
    });
    return log;
  }

  it('pays 70% of the max-health increase on a rank-up discovery', () => {
    const game = newGame();
    const log = healLog(game);
    game.spawnTier(5);
    const rankUp = log.filter((heal) => heal.reason === 'rankUp');
    expect(rankUp.length).toBe(1);
    const oldMax = BALANCE.player.baseHealth;
    const newMax = BALANCE.player.baseHealth + 4 * BALANCE.player.healthPerTier;
    expect(rankUp[0]!.delta).toBe(Math.ceil((newMax - oldMax) * 0.7));
    expect(rankUp[0]!.hp).toBe(Math.min(newMax, oldMax + rankUp[0]!.delta));
  });

  it('pays 24% of maximum on a boss victory, capped at full health', () => {
    const game = newGame();
    const log = healLog(game);
    game.spawnTier(29);
    const maxHp = game.playerMaxHealth;
    const rankUpSum = log.filter((heal) => heal.reason === 'rankUp')
      .reduce((sum, heal) => sum + heal.delta, 0);
    const afterRankUp = game.playerHealth;
    expect(afterRankUp).toBe(Math.min(maxHp, BALANCE.player.baseHealth + rankUpSum));
    game.update(TICK);
    const victory = log.filter((heal) => heal.reason === 'victory');
    expect(victory.length).toBe(1);
    const nominal = Math.ceil(maxHp * BALANCE.player.bossVictoryHealRatio);
    expect(victory[0]!.delta).toBe(Math.min(nominal, maxHp - afterRankUp));
    expect(victory[0]!.hp).toBe(afterRankUp + victory[0]!.delta);
  });

  it('heals a potion by the widget amount and reports what actually landed', () => {
    const game = newGame();
    game.spawnTier(29);
    game.update(TICK);
    game.clearBoard();
    game.spawnTier(1);
    game.update(121_000);
    let fatten = 0;
    while (game.boss.boss.maxHealth < 100_000 && fatten < 400) {
      game.skipEnemy();
      fatten += 1;
    }
    const maxHp = game.playerMaxHealth;
    const widgetAmount = Math.ceil(maxHp * POTION.healRatio);
    let guard = 0;
    while (maxHp - game.playerHealth < widgetAmount + 50 && guard < 400) {
      game.update(TICK * 50);
      guard += 1;
    }
    const before = game.playerHealth;
    expect(maxHp - before).toBeGreaterThanOrEqual(widgetAmount);
    const landed = game.healPlayer(widgetAmount);
    expect(landed).toBe(Math.min(widgetAmount, maxHp - before));
    expect(landed).toBe(widgetAmount);
    expect(game.playerHealth).toBe(before + landed);
  });
});
