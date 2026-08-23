import { describe, expect, it } from 'vitest';
import {
  LEGACY_PICKUP_TUNING,
  POWERUPS,
  POWERUP_ORDER,
  coinFrenzyCoinValue,
  type PowerupDef,
  type PowerupId,
} from '../src/data/powerups';
import { POTION, potionGapMs } from '../src/data/pickups';
import { PowerupSystem } from '../src/systems/PowerupSystem';
import { GameCore } from '../src/core/GameCore';

/** Deterministic rng (mulberry32) so gap rolls replay identically. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const def = (overrides: Partial<PowerupDef> & Pick<PowerupDef, 'id'>): PowerupDef =>
  ({
    label: 'TEST',
    iconTexture: 'powerup_test',
    iconPath: 'assets/powerups/test.webp',
    cadence: { firstSpawnMs: 10_000, minGapMs: 5_000, maxGapMs: 9_000 },
    travelMs: 11_500,
    tapRadiusPx: 62,
    stack: 'refresh',
    maxActiveOfSame: 1,
    hudColor: 0xff00ff,
    effect: 'dpsMultiplier',
    factor: 2,
    durationMs: 8_000,
    ...overrides,
  }) as PowerupDef;

const frenzyDef = (): PowerupDef => ({ ...POWERUPS.shurikenFrenzy });
const charmDef = (): PowerupDef => ({ ...POWERUPS.luckyCharm });
const smokeDef = (): PowerupDef => ({ ...POWERUPS.smokeBomb });
const wardDef = (): PowerupDef => ({ ...POWERUPS.protectiveWard });
const coinDef = (): PowerupDef => ({ ...POWERUPS.coinFrenzy });

/** Drive the system in fixed frames and collect every spawn with its time. */
function runTo(
  sys: PowerupSystem,
  untilMs: number,
  frameMs = 100,
): Array<{ id: PowerupId; atMs: number }> {
  const spawns: Array<{ id: PowerupId; atMs: number }> = [];
  for (let t = 0; t <= untilMs; t += frameMs) {
    sys.update(frameMs);
    const id = sys.maybeSpawn(t + frameMs);
    if (id !== null) spawns.push({ id, atMs: t + frameMs });
  }
  return spawns;
}

describe('powerup data', () => {
  it('staggers the five first-spawn checks so early offers never collide', () => {
    const firsts = POWERUP_ORDER.map((id) => POWERUPS[id].cadence.firstSpawnMs);
    expect(firsts).toEqual([90_000, 150_000, 210_000, 270_000, 300_000]);
    for (let i = 1; i < firsts.length; i += 1) {
      expect(firsts[i]!).toBeGreaterThan(firsts[i - 1]!);
    }
  });

  it('gives every powerup dedicated, uniquely keyed artwork', () => {
    const textures = POWERUP_ORDER.map((id) => POWERUPS[id].iconTexture);
    const paths = POWERUP_ORDER.map((id) => POWERUPS[id].iconPath);
    expect(new Set(textures).size).toBe(POWERUP_ORDER.length);
    expect(new Set(paths).size).toBe(POWERUP_ORDER.length);
    for (const path of paths) expect(path).toMatch(/^assets\/powerups\/.+\.webp$/);
  });

  it('keeps labels uppercase-safe', () => {
    for (const id of POWERUP_ORDER) {
      const { label } = POWERUPS[id];
      expect(label).toBe(label.toUpperCase());
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps every respawn window inside its own min..max span', () => {
    for (const id of POWERUP_ORDER) {
      const { cadence } = POWERUPS[id];
      expect(cadence.minGapMs).toBeLessThanOrEqual(cadence.maxGapMs);
      expect(cadence.minGapMs).toBeGreaterThan(0);
      if (cadence.spawnChance !== undefined) {
        expect(cadence.spawnChance).toBeGreaterThan(0);
        expect(cadence.spawnChance).toBeLessThanOrEqual(1);
      }
    }
  });

  it('scales each Coin Frenzy coin monotonically with the current stage', () => {
    const values = [1, 5, 10, 20, 40].map(coinFrenzyCoinValue);
    expect(values[0]).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < values.length; i += 1) expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    expect(values).toEqual([3, 5, 8, 26, 249]);
  });

  it('re-plumbs the legacy potion tuning without changing a number', () => {
    // Byte-compatible with what pickups.ts used to hard-code: same keys,
    // same values, and potionGapMs behaviour unchanged.
    expect(POTION).toEqual({
      healRatio: 0.22,
      firstSpawnMs: 22_000,
      minGapMs: 34_000,
      maxGapMs: 62_000,
      urgentBelowRatio: 0.4,
      urgentMinGapMs: 12_000,
      urgentMaxGapMs: 22_000,
      travelMs: 12_500,
      bobPixels: 38,
      bobMs: 2_050,
    });
    expect(POTION).toBe(LEGACY_PICKUP_TUNING.potion);
    expect(potionGapMs(0.2, 0)).toBe(12_000);
    expect(potionGapMs(0.9, 1)).toBe(62_000);
    expect(potionGapMs(0.9, 0.5)).toBe(48_000);
    // The clock block travels with it so TimeClock.ts has a migration path.
    expect(LEGACY_PICKUP_TUNING.clock.multiplier).toBe(10);
    expect(LEGACY_PICKUP_TUNING.clock.boostMs).toBe(10_000);
  });
});

describe('PowerupSystem spawning', () => {
  it('is deterministic under an equal seed and call script', () => {
    const script = (): PowerupDef[] => [def({ id: 'shurikenFrenzy' }), def({ id: 'smokeBomb' })];
    const a = new PowerupSystem(script(), { rng: seededRng(1234) });
    const b = new PowerupSystem(script(), { rng: seededRng(1234) });
    const runsA = runTo(a, 400_000);
    const runsB = runTo(b, 400_000);
    expect(runsA.length).toBeGreaterThan(2);
    expect(runsA).toEqual(runsB);
  });

  it('differs across seeds over many windows', () => {
    const script = (): PowerupDef[] => [def({ id: 'shurikenFrenzy' })];
    const a = runTo(new PowerupSystem(script(), { rng: seededRng(1) }), 600_000);
    const b = runTo(new PowerupSystem(script(), { rng: seededRng(99) }), 600_000);
    expect(a).not.toEqual(b);
  });

  it('never spawns before its first-spawn time, and fires exactly at it', () => {
    const sys = new PowerupSystem([frenzyDef()], { rng: seededRng(7) });
    expect(sys.maybeSpawn(0)).toBeNull();
    // Tick every frame up to one frame short of the 90s boundary.
    for (let t = 100; t < 90_000; t += 100) {
      sys.update(100);
      expect(sys.maybeSpawn(t), `t=${t}`).toBeNull();
    }
    // The frame that reaches 90_000 is the first legal offer.
    sys.update(100);
    expect(sys.maybeSpawn(90_000)).toBe('shurikenFrenzy');
    // One offer per window: an immediate re-poll must not re-fire.
    expect(sys.maybeSpawn(90_000)).toBeNull();
  });

  it('keeps every respawn gap inside the configured window', () => {
    const d = def({ id: 'shurikenFrenzy', cadence: { firstSpawnMs: 1_000, minGapMs: 4_000, maxGapMs: 6_000 } });
    const sys = new PowerupSystem([d], { rng: seededRng(42) });
    const spawns = runTo(sys, 200_000);
    expect(spawns.length).toBeGreaterThanOrEqual(30);
    const gaps = spawns.slice(1).map((s, i) => s.atMs - spawns[i]!.atMs);
    for (const gap of gaps) {
      // One frame of scheduling slop is allowed on top of the rolled window.
      expect(gap).toBeGreaterThanOrEqual(4_000 - 100);
      expect(gap).toBeLessThanOrEqual(6_000 + 100);
    }
  });

  it('only offers a rare powerup when its due-window roll succeeds', () => {
    const rolls = [0.9, 0, 0.1, 0];
    const rare = {
      ...coinDef(),
      cadence: { firstSpawnMs: 100, minGapMs: 100, maxGapMs: 100, spawnChance: 0.2 },
    };
    const sys = new PowerupSystem([rare], { rng: () => rolls.shift() ?? 0 });
    sys.update(100);
    expect(sys.maybeSpawn(100)).toBeNull();
    sys.update(100);
    expect(sys.maybeSpawn(200)).toBe('coinFrenzy');
  });
});

describe('PowerupSystem gating', () => {
  it('produces no phantom spawns while gated, then a single catch-up', () => {
    let open = false;
    const sys = new PowerupSystem([frenzyDef()], { rng: seededRng(5), canSpawn: () => open });
    // Gate shut straight through the whole first window and far beyond.
    for (let t = 0; t <= 300_000; t += 100) {
      sys.update(100);
      expect(sys.maybeSpawn(t)).toBeNull();
    }
    // Open the gate: exactly one spawn leaves on the first poll...
    open = true;
    const first = sys.maybeSpawn(300_100);
    expect(first).toBe('shurikenFrenzy');
    // ...and no burst behind it: the same def's fresh window is strictly future.
    for (let i = 0; i < 50; i += 1) {
      expect(sys.maybeSpawn(300_100)).toBeNull();
    }
    // The fresh window is at least minGapMs long; nothing can re-fire early.
    let refire: PowerupId | null = null;
    for (let t = 380_000; t <= 500_000 && refire === null; t += 100) {
      sys.update(100);
      refire = sys.maybeSpawn(t);
    }
    expect(refire).toBe('shurikenFrenzy');
  });

  it('lets overdue defs surface one per poll cycle after a long gate', () => {
    let open = false;
    const sys = new PowerupSystem([frenzyDef(), smokeDef()], {
      rng: seededRng(11),
      canSpawn: () => open,
    });
    for (let t = 0; t <= 400_000; t += 100) {
      sys.update(100);
      sys.maybeSpawn(t);
    }
    open = true;
    const drained: PowerupId[] = [];
    for (let i = 0; i < 4 && drained.length < 2; i += 1) {
      const id = sys.maybeSpawn(400_000);
      if (id !== null) drained.push(id);
    }
    // Both overdue defs eventually surface, each exactly once.
    expect(drained.sort()).toEqual(['shurikenFrenzy', 'smokeBomb']);
  });
});

describe('PowerupSystem stack policies', () => {
  it('treats Coin Frenzy as instant and never leaves a timed HUD effect', () => {
    const sys = new PowerupSystem([coinDef()]);
    expect(sys.activate('coinFrenzy')).toBe(true);
    expect(sys.activeEffects()).toEqual([]);
    expect(sys.hudState()).toEqual([]);
  });
  it('refresh resets the remaining time instead of stacking', () => {
    const sys = new PowerupSystem([frenzyDef()]);
    sys.activate('shurikenFrenzy');
    sys.update(3_000);
    expect(sys.activeEffects()[0]?.remainingMs).toBe(12_000 - 3_000);
    sys.activate('shurikenFrenzy');
    expect(sys.activeEffects()).toHaveLength(1);
    expect(sys.activeEffects()[0]?.remainingMs).toBe(12_000);
    expect(sys.dpsMultiplier).toBe(2);
  });

  it('extend adds duration but caps at double the nominal length', () => {
    const sys = new PowerupSystem([charmDef()]);
    sys.activate('luckyCharm');
    expect(sys.coinMultiplier).toBe(2);
    // Fresh activation extends to the 2x cap immediately.
    sys.activate('luckyCharm');
    expect(sys.activeEffects()[0]?.remainingMs).toBe(36_000);
    // A third tap cannot push past the cap.
    sys.activate('luckyCharm');
    expect(sys.activeEffects()[0]?.remainingMs).toBe(36_000);
    // Partially burned charm still cannot push past the 2x cap.
    sys.update(10_000);
    sys.activate('luckyCharm');
    expect(sys.activeEffects()[0]?.remainingMs).toBe(36_000);
  });

  it('stacks the ward up to its charge cap, consumes in order, refuses when empty', () => {
    const sys = new PowerupSystem([wardDef()]);
    expect(sys.wardCharges).toBe(0);
    sys.activate('protectiveWard');
    expect(sys.wardCharges).toBe(3);
    // Re-topping cannot exceed the cap.
    sys.activate('protectiveWard');
    expect(sys.wardCharges).toBe(3);
    expect(sys.consumeWardCharge()).toBe(true);
    expect(sys.wardCharges).toBe(2);
    sys.consumeWardCharge();
    sys.consumeWardCharge();
    expect(sys.wardCharges).toBe(0);
    expect(sys.consumeWardCharge()).toBe(false);
    expect(sys.wardCharges).toBe(0);
    // The ward never lapses on its own.
    sys.update(600_000);
    expect(sys.activeEffects()).toHaveLength(0);
    sys.activate('protectiveWard');
    sys.update(600_000);
    expect(sys.wardCharges).toBe(3);
  });

  it('honours maxActiveOfSame when instances may coexist', () => {
    const twin: PowerupDef = { ...charmDef(), maxActiveOfSame: 2 };
    const sys = new PowerupSystem([twin], { rng: seededRng(3) });
    sys.activate('luckyCharm');
    sys.activate('luckyCharm');
    expect(sys.activeEffects()).toHaveLength(2);
    expect(sys.coinMultiplier).toBe(4); // product across stacked instances
    // Third is refused as a new instance; policy refreshes nothing for extend.
    sys.activate('luckyCharm');
    expect(sys.activeEffects()).toHaveLength(2);
  });
});

describe('Coin Frenzy rewards', () => {
  it('pays only clicked coins, freezes the stage value, and caps the claim count', () => {
    const core = new GameCore({ storage: null, now: () => 0 });
    core.skipEnemy(); // Stage 2: prove the value is not a stage-1 constant.
    expect(core.collectPowerup('coinFrenzy')).toBe(true);
    const start = core.economy.coins;
    const { remaining, coinValue } = core.coinFrenzyState;
    const coinDef = POWERUPS.coinFrenzy;
    expect(coinDef.effect).toBe('coinRain');
    expect(remaining).toBe(coinDef.effect === 'coinRain' ? coinDef.coinCount : 0);
    expect(coinValue).toBe(coinFrenzyCoinValue(2));
    expect(core.economy.coins).toBe(start); // Activation itself mints nothing.

    expect(core.collectCoinFrenzyCoin()).toBe(coinValue);
    expect(core.missCoinFrenzyCoin()).toBe(true);
    expect(core.economy.coins).toBe(start + coinValue);
    for (let i = 0; i < remaining - 2; i += 1) core.collectCoinFrenzyCoin();
    expect(core.coinFrenzyState.remaining).toBe(0);
    expect(core.collectCoinFrenzyCoin()).toBe(0);
    expect(core.economy.coins).toBe(start + coinValue * (remaining - 1));
  });
});

describe('PowerupSystem getters and composition', () => {
  it('defaults every multiplier to neutral with nothing running', () => {
    const sys = new PowerupSystem([frenzyDef(), charmDef(), smokeDef(), wardDef()]);
    expect(sys.dpsMultiplier).toBe(1);
    expect(sys.coinMultiplier).toBe(1);
    expect(sys.bossAttacksPaused).toBe(false);
    expect(sys.wardCharges).toBe(0);
    expect(sys.activeEffects()).toEqual([]);
    expect(sys.hudState()).toEqual([]);
  });

  it('composes independent effects multiplicatively and reports pause separately', () => {
    const sys = new PowerupSystem([frenzyDef(), charmDef(), smokeDef(), wardDef()]);
    sys.activate('shurikenFrenzy');
    sys.activate('luckyCharm');
    sys.activate('smokeBomb');
    sys.activate('protectiveWard');
    expect(sys.dpsMultiplier).toBe(2);
    expect(sys.coinMultiplier).toBe(2);
    expect(sys.bossAttacksPaused).toBe(true);
    expect(sys.hudState()).toHaveLength(4);

    const views = sys.activeEffects();
    const byId = new Map(views.map((v) => [v.id, v]));
    expect(byId.get('shurikenFrenzy')?.factor).toBe(2);
    expect(byId.get('luckyCharm')?.factor).toBe(2);
    expect(byId.get('smokeBomb')?.factor).toBeUndefined();
    expect(byId.get('protectiveWard')?.charges).toBe(3);
    expect(byId.get('protectiveWard')?.remainingMs).toBe(-1);
  });

  it('expires timed effects through update but keeps ward charges intact', () => {
    const sys = new PowerupSystem([frenzyDef(), smokeDef(), wardDef()]);
    sys.activate('shurikenFrenzy');
    sys.activate('smokeBomb');
    sys.activate('protectiveWard');

    sys.update(6_999);
    expect(sys.bossAttacksPaused).toBe(true);
    expect(sys.dpsMultiplier).toBe(2);
    sys.update(1);
    expect(sys.bossAttacksPaused).toBe(false); // 7s smoke gone
    expect(sys.dpsMultiplier).toBe(2); // 12s frenzy still burning

    sys.update(5_001);
    expect(sys.dpsMultiplier).toBe(1);
    expect(sys.wardCharges).toBe(3); // untimed pool survives both
  });
});

describe('PowerupSystem lifecycle', () => {
  it('clear() returns to pristine state including schedules', () => {
    const sys = new PowerupSystem([frenzyDef()], { rng: seededRng(21) });
    sys.activate('shurikenFrenzy');
    runTo(sys, 120_000); // spawned once, schedule moved deep into the run
    sys.clear();
    expect(sys.activeEffects()).toEqual([]);
    expect(sys.dpsMultiplier).toBe(1);
    // The full fresh stagger comes back: nothing before 90s, offer at 90s.
    for (let t = 100; t < 90_000; t += 100) {
      sys.update(100);
      expect(sys.maybeSpawn(t)).toBeNull();
    }
    sys.update(100);
    expect(sys.maybeSpawn(90_000)).toBe('shurikenFrenzy');
  });

  it('round-trips serialize -> deserialize preserving effects and schedules', () => {
    const build = (): PowerupSystem =>
      new PowerupSystem([frenzyDef(), charmDef(), wardDef()], { rng: seededRng(31), now: () => 777 });
    const original = build();
    original.activate('shurikenFrenzy');
    original.activate('protectiveWard');
    original.consumeWardCharge();
    original.update(2_500);
    const firedAt = 95_000;
    original.update(firedAt - 2_500);
    expect(original.maybeSpawn(firedAt)).toBe('shurikenFrenzy');

    const snapshot = JSON.parse(JSON.stringify(original.serialize())) as unknown;
    const restored = build();
    expect(restored.deserialize(snapshot)).toBe(true);
    expect(restored.dpsMultiplier).toBe(original.dpsMultiplier);
    expect(restored.wardCharges).toBe(original.wardCharges);
    expect(restored.activeEffects()).toEqual(original.activeEffects());

    // Schedules survive too: both systems refuse/re-fire identically afterwards.
    const nextA = original.maybeSpawn(firedAt);
    const nextB = restored.maybeSpawn(firedAt);
    expect(nextA).toBe(nextB);
  });

  it('rejects malformed snapshots wholesale', () => {
    const sys = new PowerupSystem([frenzyDef()]);
    sys.activate('shurikenFrenzy');
    expect(sys.deserialize(null)).toBe(false);
    expect(sys.deserialize({ version: 2 })).toBe(false);
    expect(sys.deserialize({ version: 1, visibleClockMs: 0, schedules: [], effects: [] })).toBe(false);
    // Failed restores leave state untouched.
    expect(sys.dpsMultiplier).toBe(2);
  });

  it('throws on duplicate ids instead of silently merging defs', () => {
    expect(() => new PowerupSystem([frenzyDef(), { ...frenzyDef() }])).toThrow(/duplicate/);
  });
});
