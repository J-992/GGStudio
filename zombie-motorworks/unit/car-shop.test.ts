import { describe, expect, it } from 'vitest';
import {
  SHOP_CARS,
  carBlueprintAt,
  carStageCost,
  carTotalCost,
  getShopCar,
  installableStages,
  type ShopCar,
} from '../src/core/carShop.ts';
import { validateBlueprint } from '../src/core/placement.ts';
import { getPartDef } from '../src/core/parts.ts';
import { STARTER_UNLOCKS, DEFAULT_MONEY } from '../src/core/profile.ts';
import { isSignatureDefId } from '../src/core/builds.ts';

const starter = [...STARTER_UNLOCKS] as string[];
const everything = SHOP_CARS.flatMap((car) =>
  car.stages.flatMap((stage) => stage.parts.map((part) => part.defId)),
);

function describeErrors(car: ShopCar, stage: number): string {
  const report = validateBlueprint(carBlueprintAt(car, stage), getPartDef);
  return report.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
}

describe('the shop itself', () => {
  it('offers ten cars with stable, unique ids', () => {
    expect(SHOP_CARS).toHaveLength(10);
    const ids = SHOP_CARS.map((car) => car.id);
    expect(new Set(ids).size).toBe(10);
  });

  it('finds a car by id and refuses anything else', () => {
    expect(getShopCar(SHOP_CARS[0].id)?.name).toBe(SHOP_CARS[0].name);
    expect(getShopCar('not-a-car')).toBeUndefined();
  });

  it('never sells a signature block, which no store can stock', () => {
    expect(everything.filter(isSignatureDefId)).toEqual([]);
  });

  it('gives every car a base stage and at least four improvements', () => {
    for (const car of SHOP_CARS) {
      expect(car.stages.length, car.id).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('every stage of every car is a drivable rig', () => {
  // The whole promise of the shop: the base car plays, and each thing bought
  // for it is an improvement on a rig that already worked. A stage that fails
  // here would hand the player a car they cannot deploy.
  for (const car of SHOP_CARS) {
    it(`${car.id} validates at every stage`, () => {
      for (let stage = 0; stage < car.stages.length; stage += 1) {
        expect(describeErrors(car, stage), `${car.id} stage ${stage}`).toBe('');
      }
    });
  }

  it('gives every base rig a root, an engine and wheels', () => {
    for (const car of SHOP_CARS) {
      const base = carBlueprintAt(car, 0);
      const defs = base.parts.map((part) => getPartDef(part.defId));
      expect(defs.some((d) => d.isRoot), car.id).toBe(true);
      expect(defs.some((d) => d.engine !== undefined), car.id).toBe(true);
      expect(defs.filter((d) => d.wheel !== undefined).length, car.id)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it('only ever adds parts, so a bought improvement is never taken away', () => {
    for (const car of SHOP_CARS) {
      for (let stage = 1; stage < car.stages.length; stage += 1) {
        const before = carBlueprintAt(car, stage - 1).parts.map((p) => p.id);
        const after = carBlueprintAt(car, stage).parts.map((p) => p.id);
        expect(after.slice(0, before.length), `${car.id} stage ${stage}`)
          .toEqual(before);
      }
    }
  });

  it('keeps part ids unique inside a finished car', () => {
    for (const car of SHOP_CARS) {
      const ids = carBlueprintAt(car, car.stages.length - 1).parts.map(
        (p) => p.id,
      );
      expect(new Set(ids).size, car.id).toBe(ids.length);
    }
  });
});

describe('what a stage costs', () => {
  it('charges the unlock alongside the part the first time it is needed', () => {
    // Off-road wheels cost 26 each and unlock for 13. Four of them on a rig
    // whose owner has never bought one is 4 x 26 + 13, not 4 x (26 + 13).
    const car = SHOP_CARS.find((c) =>
      c.stages[0].parts.some((p) => p.defId === 'wheel-offroad'),
    );
    expect(car).toBeDefined();
    if (car === undefined) return;
    const locked = carStageCost(car, 0, starter);
    const unlocked = carStageCost(car, 0, [...starter, 'wheel-offroad']);
    expect(locked - unlocked).toBe(getPartDef('wheel-offroad').unlockCost ?? 0);
  });

  it('never charges for an unlock the player already owns', () => {
    for (const car of SHOP_CARS) {
      const withAll = carTotalCost(car, everything);
      const withStarter = carTotalCost(car, starter);
      expect(withAll, car.id).toBeLessThanOrEqual(withStarter);
    }
  });

  it('prices the cheapest base rig inside a fresh wallet', () => {
    const cheapest = Math.min(
      ...SHOP_CARS.map((car) => carStageCost(car, 0, starter)),
    );
    expect(cheapest).toBeLessThanOrEqual(DEFAULT_MONEY);
  });

  it('charges something for every improvement', () => {
    for (const car of SHOP_CARS) {
      for (let stage = 1; stage < car.stages.length; stage += 1) {
        expect(carStageCost(car, stage, everything), `${car.id}/${stage}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('orders the shop from cheapest car to dearest', () => {
    const totals = SHOP_CARS.map((car) => carTotalCost(car, starter));
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
  });
});

describe('auto-building with what the player has', () => {
  const car = SHOP_CARS[0];

  it('buys nothing when the next stage is out of reach', () => {
    const result = installableStages(car, 1, 0, starter);
    expect(result).toEqual({ stages: 0, spend: 0, unlocks: [] });
  });

  it('buys exactly one stage when only one is affordable', () => {
    const price = carStageCost(car, 1, starter);
    const result = installableStages(car, 1, price, starter);
    expect(result.stages).toBe(1);
    expect(result.spend).toBe(price);
  });

  it('keeps going while the money lasts', () => {
    const result = installableStages(car, 1, 1_000_000, starter);
    expect(result.stages).toBe(car.stages.length - 1);
    expect(result.spend).toBe(
      carTotalCost(car, starter) - carStageCost(car, 0, starter),
    );
  });

  it('stops at the last stage rather than running off the end', () => {
    const done = car.stages.length;
    expect(installableStages(car, done, 1_000_000, starter).stages).toBe(0);
  });

  it('reports the unlocks it had to buy, so the profile can record them', () => {
    const result = installableStages(car, 1, 1_000_000, starter);
    expect(new Set(result.unlocks).size).toBe(result.unlocks.length);
    for (const defId of result.unlocks) {
      expect(starter).not.toContain(defId);
    }
  });

  it('prices a run of stages the same as buying them one at a time', () => {
    // An unlock paid for in stage two must not be charged again in stage five.
    const bulk = installableStages(car, 1, 1_000_000, starter);
    let owned = [...starter];
    let oneByOne = 0;
    for (let stage = 1; stage < car.stages.length; stage += 1) {
      oneByOne += carStageCost(car, stage, owned);
      owned = [...owned, ...car.stages[stage].parts.map((p) => p.defId)];
    }
    expect(bulk.spend).toBe(oneByOne);
  });

  it('refuses a nonsense wallet rather than handing out a free car', () => {
    expect(installableStages(car, 1, Number.NaN, starter).stages).toBe(0);
    expect(installableStages(car, 1, -500, starter).stages).toBe(0);
  });
});
