/**
 * Reading and advancing a player's Blueprint Shop car.
 *
 * `carShop.ts` is the catalogue and its prices; this is the half that knows
 * about a wallet. Split in two because the catalogue has to stay answerable
 * without a profile — the shop panel prices every car for a player who owns
 * none of them — while everything here only makes sense with one.
 *
 * The division of labour with `App` is deliberate: `planShopAutoBuild` decides
 * and costs the purchase but changes nothing, and the caller applies it. A
 * garage that opens, spends money and swaps the rig is three side effects that
 * have to happen together or not at all, and the only place that can sequence
 * them safely is the one that owns persistence.
 */

import {
  carBlueprintAt,
  carStageCost,
  getShopCar,
  installableStages,
  type CarStage,
  type ShopCar,
} from './carShop.ts';
import type { PlayerProfile } from './profile.ts';
import type { VehicleBlueprint } from './types.ts';

export interface ShopCarProgress {
  readonly car: ShopCar;
  /** Stages installed. One is the base rig on its own. */
  readonly installed: number;
  readonly total: number;
  readonly complete: boolean;
  /** The next thing being saved up for, or null on a finished car. */
  readonly nextStage: CarStage | null;
  /** What that next stage costs this player, unlocks included. */
  readonly nextCost: number;
}

/**
 * What the profile says about the car being built, if there is one.
 *
 * Returns null rather than throwing for every degenerate case — no car
 * chosen, a car the shop has retired, a stage count from a newer build — so
 * callers can treat "no shop car" and "a shop car nobody can resolve" the
 * same way, which is the only sane thing to do while opening a garage.
 */
export function shopCarProgress(
  profile: PlayerProfile,
): ShopCarProgress | null {
  const car = getShopCar(profile.shopCarId);
  if (car === undefined) return null;

  const installed = Math.min(
    car.stages.length,
    Math.max(1, Math.floor(profile.shopStages ?? 1)),
  );
  const complete = installed >= car.stages.length;
  const nextStage = complete ? null : car.stages[installed];
  return {
    car,
    installed,
    total: car.stages.length,
    complete,
    nextStage,
    nextCost: complete ? 0 : carStageCost(car, installed, profile.unlockedDefIds),
  };
}

export interface ShopPurchaseResult {
  readonly bought: boolean;
  /** The rig to put in the bay. Only set when `bought`. */
  readonly blueprint: VehicleBlueprint | null;
  readonly spend: number;
}

const NOT_BOUGHT: ShopPurchaseResult = {
  bought: false,
  blueprint: null,
  spend: 0,
};

/**
 * Buy exactly one stage of `car`, mutating the profile.
 *
 * One stage, not every stage the wallet covers, because this is the button the
 * player pressed and the price on it has to be the price they pay. Everything
 * after it is the auto-build's job — `App` runs the two back to back, so a
 * rich player still walks out of the shop with as much car as they can afford;
 * the difference is only in which half of the code decided to spend what.
 *
 * Unlike the auto-build this one does commit, because there is nothing to
 * sequence: the wallet, the unlocks and the recorded car move together and the
 * caller's remaining job is to put the returned blueprint in the bay.
 *
 * Switching cars restarts at the new car's base. Carrying stage counts across
 * would be meaningless — the build orders share nothing — and refunding the
 * old car would make the shop a place to launder money.
 */
export function applyShopPurchase(
  profile: PlayerProfile,
  car: ShopCar,
  stageIndex: number,
): ShopPurchaseResult {
  const plan = installableStages(
    car,
    stageIndex,
    // Capped at this one stage's price, so a full wallet cannot run the greedy
    // loop on past the stage the player actually asked for.
    Math.min(
      profile.money,
      carStageCost(car, stageIndex, profile.unlockedDefIds),
    ),
    profile.unlockedDefIds,
  );
  if (plan.stages === 0) return NOT_BOUGHT;

  profile.money -= plan.spend;
  profile.unlockedDefIds = [
    ...new Set([...profile.unlockedDefIds, ...plan.unlocks]),
  ];
  profile.shopCarId = car.id;
  profile.shopStages = stageIndex + plan.stages;

  return {
    bought: true,
    blueprint: carBlueprintAt(car, profile.shopStages - 1),
    spend: plan.spend,
  };
}

export interface ShopAutoBuild {
  readonly car: ShopCar;
  /** How many stages this covers. */
  readonly stages: number;
  readonly spend: number;
  /** Stage count after applying, for `profile.shopStages`. */
  readonly installed: number;
  readonly unlocks: readonly string[];
  /** Labels of what was fitted, in order, for the garage's notice. */
  readonly labels: readonly string[];
  /** The rig to put in the bay once the plan is applied. */
  readonly blueprint: VehicleBlueprint;
}

/**
 * Everything the wallet can bolt on to the car right now, as one plan.
 *
 * Deliberately read-only. The caller applies it, because spending money and
 * swapping the rig have to be one transaction and this module cannot persist
 * anything. Returns null when there is nothing to do, which is the common
 * case — most garage visits cannot afford the next part yet.
 */
export function planShopAutoBuild(
  profile: PlayerProfile,
): ShopAutoBuild | null {
  const progress = shopCarProgress(profile);
  if (progress === null || progress.complete) return null;

  const plan = installableStages(
    progress.car,
    progress.installed,
    profile.money,
    profile.unlockedDefIds,
  );
  if (plan.stages === 0) return null;

  const installed = progress.installed + plan.stages;
  return {
    car: progress.car,
    stages: plan.stages,
    spend: plan.spend,
    installed,
    unlocks: plan.unlocks,
    labels: progress.car.stages
      .slice(progress.installed, installed)
      .map((stage) => stage.label),
    blueprint: carBlueprintAt(progress.car, installed - 1),
  };
}
