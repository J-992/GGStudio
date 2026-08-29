import { describe, expect, it } from 'vitest';
import { ARCHETYPES, MODIFIED_ORDER, archetypeForStage } from '../src/data/bossArchetypes';
import { BALANCE } from '../src/data/balance';
import { BossController } from '../src/systems/BossController';

const A = BALANCE.archetypes;
const stages = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const noop = {
  damaged: (): void => {},
  defeated: (): void => {},
  spawned: (): void => {},
  attack: (): void => {},
};

describe('archetype rotation', () => {
  it('leaves the opening ladder entirely plain', () => {
    stages(1, A.shieldedFromStage - 1).forEach((stage) => {
      expect(archetypeForStage(stage).id).toBe('bare');
    });
  });

  it('introduces each archetype on exactly its own stage', () => {
    MODIFIED_ORDER.forEach((id) => {
      const spec = archetypeForStage(ARCHETYPES[id].fromStage);
      expect(spec.id).toBe(id);
      expect(spec.introduction).toBe(true);
    });
  });

  it('never plays an archetype before it has been introduced', () => {
    MODIFIED_ORDER.forEach((id) => {
      stages(1, ARCHETYPES[id].fromStage - 1).forEach((stage) => {
        expect(archetypeForStage(stage).id).not.toBe(id);
      });
    });
  });

  it('puts a plain rest beat between every modifier below the rest-beat line', () => {
    stages(A.shieldedFromStage, A.restBeatUntilStage - 2).forEach((stage) => {
      const here = archetypeForStage(stage).id;
      const next = archetypeForStage(stage + 1).id;
      expect(here === 'bare' || next === 'bare').toBe(true);
    });
  });

  it('keeps plain bosses in the rotation above the rest-beat line', () => {
    const seen = new Set(stages(A.restBeatUntilStage, A.restBeatUntilStage + 40).map((s) => archetypeForStage(s).id));
    expect(seen.has('bare')).toBe(true);
    MODIFIED_ORDER.forEach((id) => expect(seen.has(id)).toBe(true));
  });

  it('is deterministic and total for any stage', () => {
    stages(1, 200).forEach((stage) => {
      expect(archetypeForStage(stage)).toEqual(archetypeForStage(stage));
    });
    expect(archetypeForStage(0).id).toBe('bare');
    expect(archetypeForStage(-5).id).toBe('bare');
  });

  it('gives every introduction the gentlest settings that archetype ever has', () => {
    expect(archetypeForStage(ARCHETYPES.shielded.fromStage).shieldCharges).toBe(1);
    expect(archetypeForStage(ARCHETYPES.enraged.fromStage).mergeWindowMs).toBe(A.enrage.firstWindowMs);
    expect(archetypeForStage(ARCHETYPES.greedy.fromStage).bountyWindowMs).toBe(A.greed.firstWindowMs);
    expect(A.enrage.firstWindowMs).toBeGreaterThan(A.enrage.windowMs);
    expect(A.greed.firstWindowMs).toBeGreaterThan(A.greed.windowMs);
  });

  it('scales shield charges with the stage, inside the cap', () => {
    stages(A.shieldedFromStage, 300).forEach((stage) => {
      const spec = archetypeForStage(stage);
      if (spec.id !== 'shielded' || spec.introduction) return;
      expect(spec.shieldCharges).toBe(
        Math.min(A.shield.maxCharges, Math.max(1, Math.ceil(stage / A.shield.stageDivisor))),
      );
      expect(spec.shieldCharges).toBeLessThanOrEqual(A.shield.maxCharges);
    });
  });
});

describe('archetype behaviour in the fight', () => {
  const shieldedStage = ARCHETYPES.shielded.fromStage;
  const findStage = (predicate: (stage: number) => boolean): number => {
    for (let stage = 1; stage < 400; stage += 1) if (predicate(stage)) return stage;
    throw new Error('no stage matched');
  };

  it('holds the whole roster off while a barrier stands', () => {
    const boss = new BossController(shieldedStage);
    expect(boss.shielded).toBe(true);
    const before = boss.hp;
    boss.update(100, 10_000, { attackIntervalMultiplier: 1, attackDamageMultiplier: 1 } as never, noop);
    expect(boss.hp).toBe(before);
  });

  it('lets the barrier fall on its own, so a player who never taps is not walled', () => {
    const boss = new BossController(shieldedStage);
    boss.update(BALANCE.archetypes.shield.decayMs, 0, { attackIntervalMultiplier: 1, attackDamageMultiplier: 1 } as never, noop);
    expect(boss.shielded).toBe(false);
  });

  it('spends one charge per tap', () => {
    const stage = findStage((s) => {
      const spec = archetypeForStage(s);
      return spec.id === 'shielded' && spec.shieldCharges >= 3;
    });
    const boss = new BossController(stage);
    const charges = boss.shieldCharges;

    expect(boss.breakShield()).toBe(true);
    expect(boss.shieldCharges).toBe(charges - 1);
    while (boss.shielded) boss.breakShield();
    expect(boss.breakShield()).toBe(false);
  });

  it('heals an enraged boss only once the merge window has lapsed', () => {
    const stage = ARCHETYPES.enraged.fromStage;
    const spec = archetypeForStage(stage);
    const boss = new BossController(stage);
    boss.hp = boss.boss.maxHealth / 2;
    const tempo = { attackIntervalMultiplier: 1, attackDamageMultiplier: 1 } as never;

    boss.update(spec.mergeWindowMs - 200, 0, tempo, noop);
    expect(boss.enraged).toBe(false);
    expect(boss.hp).toBeCloseTo(boss.boss.maxHealth / 2, 6);

    boss.update(1_200, 0, tempo, noop);
    expect(boss.enraged).toBe(true);
    expect(boss.hp).toBeGreaterThan(boss.boss.maxHealth / 2);

    const healed = boss.hp;
    boss.noteMerge();
    boss.update(200, 0, tempo, noop);
    expect(boss.enraged).toBe(false);
    expect(boss.hp).toBeCloseTo(healed, 6);
  });

  it('never heals an enraged boss past full health', () => {
    const stage = ARCHETYPES.enraged.fromStage;
    const boss = new BossController(stage);
    boss.hp = boss.boss.maxHealth - 1;
    boss.update(120_000, 0, { attackIntervalMultiplier: 1, attackDamageMultiplier: 1 } as never, noop);
    expect(boss.hp).toBe(boss.boss.maxHealth);
  });

  it('closes a greedy window exactly once', () => {
    const stage = ARCHETYPES.greedy.fromStage;
    const spec = archetypeForStage(stage);
    let expired = 0;
    const boss = new BossController(stage);
    expect(boss.bountyMsLeft).toBe(spec.bountyWindowMs);

    boss.update(spec.bountyWindowMs + 5_000, 0, { attackIntervalMultiplier: 1, attackDamageMultiplier: 1 } as never, {
      ...noop,
      bountyExpired: () => { expired += 1; },
    });
    expect(boss.bountyMsLeft).toBe(0);
    expect(expired).toBe(1);
  });

  it('re-arms the archetype for every boss the ladder spawns', () => {
    const boss = new BossController(1);
    for (let i = 1; i < 30; i += 1) {
      boss.forceNext();
      expect(boss.archetype).toEqual(archetypeForStage(boss.stage));
      expect(boss.shieldCharges).toBe(boss.archetype.shieldCharges);
    }
    boss.reset();
    expect(boss.stage).toBe(1);
    expect(boss.archetype.id).toBe('bare');
  });
});
