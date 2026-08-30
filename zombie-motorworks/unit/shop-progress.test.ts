import { describe, expect, it } from 'vitest';
import {
  applyShopPurchase,
  shopCarProgress,
  planShopAutoBuild,
} from '../src/core/shopProgress.ts';
import { SHOP_CARS, carStageCost, carTotalCost } from '../src/core/carShop.ts';
import { defaultProfile, STARTER_UNLOCKS } from '../src/core/profile.ts';
import type { PlayerProfile } from '../src/core/profile.ts';

const CAR = SHOP_CARS[0];
const starter = [...STARTER_UNLOCKS] as string[];

function profileWith(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return { ...defaultProfile(), ...overrides };
}

describe('reading a profile as shop progress', () => {
  it('reports no car when the player has not picked one', () => {
    expect(shopCarProgress(profileWith())).toBeNull();
  });

  it('reports the car and how far along it is', () => {
    const progress = shopCarProgress(
      profileWith({ shopCarId: CAR.id, shopStages: 3 }),
    );
    expect(progress?.car.id).toBe(CAR.id);
    expect(progress?.installed).toBe(3);
    expect(progress?.total).toBe(CAR.stages.length);
    expect(progress?.complete).toBe(false);
  });

  it('knows when a car is finished', () => {
    const progress = shopCarProgress(
      profileWith({ shopCarId: CAR.id, shopStages: CAR.stages.length }),
    );
    expect(progress?.complete).toBe(true);
    expect(progress?.nextStage).toBeNull();
  });

  it('names the next thing being saved up for', () => {
    const progress = shopCarProgress(
      profileWith({ shopCarId: CAR.id, shopStages: 1 }),
    );
    expect(progress?.nextStage?.label).toBe(CAR.stages[1].label);
  });

  it('ignores a car the shop no longer carries', () => {
    expect(
      shopCarProgress(profileWith({ shopCarId: 'retired', shopStages: 2 })),
    ).toBeNull();
  });

  it('clamps a stage count past the end of the build order', () => {
    const progress = shopCarProgress(
      profileWith({ shopCarId: CAR.id, shopStages: 999 }),
    );
    expect(progress?.installed).toBe(CAR.stages.length);
    expect(progress?.complete).toBe(true);
  });
});

describe('buying into a car', () => {
  it('charges the base rig and records the car', () => {
    const profile = profileWith({ money: 10_000 });
    const before = profile.money;
    const result = applyShopPurchase(profile, CAR, 0);
    expect(result.bought).toBe(true);
    expect(profile.shopCarId).toBe(CAR.id);
    expect(profile.shopStages).toBe(1);
    expect(before - profile.money).toBe(carStageCost(CAR, 0, starter));
  });

  it('refuses when the wallet cannot cover the base rig', () => {
    const profile = profileWith({ money: 1 });
    expect(applyShopPurchase(profile, CAR, 0).bought).toBe(false);
    expect(profile.shopCarId).toBeUndefined();
    expect(profile.money).toBe(1);
  });

  it('installs everything the wallet covers in one go', () => {
    const profile = profileWith({ money: 10_000 });
    applyShopPurchase(profile, CAR, 0);
    const result = planShopAutoBuild(profile);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.stages).toBe(CAR.stages.length - 1);
  });

  it('permanently unlocks whatever it had to unlock', () => {
    const car = SHOP_CARS.find((c) =>
      c.stages[0].parts.some((p) => p.defId === 'wheel-offroad'),
    );
    expect(car).toBeDefined();
    if (car === undefined) return;
    const profile = profileWith({ money: 10_000 });
    applyShopPurchase(profile, car, 0);
    expect(profile.unlockedDefIds).toContain('wheel-offroad');
  });

  it('switching cars starts the new one from its own base', () => {
    const profile = profileWith({ money: 10_000 });
    applyShopPurchase(profile, CAR, 0);
    applyShopPurchase(profile, SHOP_CARS[1], 0);
    expect(profile.shopCarId).toBe(SHOP_CARS[1].id);
    expect(profile.shopStages).toBe(1);
  });
});

describe('auto-building between waves', () => {
  it('does nothing without a car', () => {
    expect(planShopAutoBuild(profileWith({ money: 10_000 }))).toBeNull();
  });

  it('does nothing when the next stage is still out of reach', () => {
    const profile = profileWith({ shopCarId: CAR.id, shopStages: 1, money: 0 });
    expect(planShopAutoBuild(profile)).toBeNull();
  });

  it('does nothing once the car is finished', () => {
    const profile = profileWith({
      shopCarId: CAR.id,
      shopStages: CAR.stages.length,
      money: 10_000,
    });
    expect(planShopAutoBuild(profile)).toBeNull();
  });

  it('spends the money and advances the car', () => {
    const price = carStageCost(CAR, 1, starter);
    const profile = profileWith({
      shopCarId: CAR.id,
      shopStages: 1,
      money: price,
    });
    const plan = planShopAutoBuild(profile);
    expect(plan?.stages).toBe(1);
    expect(plan?.spend).toBe(price);
    expect(plan?.installed).toBe(2);
    expect(plan?.labels).toEqual([CAR.stages[1].label]);
  });

  it('hands back a blueprint that matches the stage it reports', () => {
    const profile = profileWith({
      shopCarId: CAR.id,
      shopStages: 1,
      money: 10_000,
    });
    const plan = planShopAutoBuild(profile);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    const expected = CAR.stages
      .slice(0, plan.installed)
      .reduce((sum, stage) => sum + stage.parts.length, 0);
    expect(plan.blueprint.parts).toHaveLength(expected);
  });

  it('leaves the profile untouched — applying the plan is the caller’s job', () => {
    const profile = profileWith({
      shopCarId: CAR.id,
      shopStages: 1,
      money: 10_000,
    });
    const before = { ...profile };
    planShopAutoBuild(profile);
    expect(profile.money).toBe(before.money);
    expect(profile.shopStages).toBe(before.shopStages);
  });

  it('finishes a car for exactly what the shop said it would cost', () => {
    const profile = profileWith({ money: 100_000 });
    const total = carTotalCost(CAR, starter);
    const start = profile.money;
    applyShopPurchase(profile, CAR, 0);
    const plan = planShopAutoBuild(profile);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(start - profile.money + plan.spend).toBe(total);
  });
});
