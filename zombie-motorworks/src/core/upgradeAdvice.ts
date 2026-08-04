/**
 * Which single upgrade the garage should point at next.
 *
 * The star chains are the deepest part of the economy and the easiest to walk
 * past: a player who never opens the inspector never learns that the block they
 * already own gets stronger. The garage answers that with one coach mark
 * floating over one block — never a board of them — so the advice reads as a
 * next action rather than a shopping list.
 *
 * The ordering below is the whole opinion:
 *
 * 1. Only unlocks the wallet covers right now. Advice the player cannot take is
 *    worse than no advice.
 * 2. Guns before everything else. Damage is what stalls a run; a fifth star on
 *    the fuel tank is not what loses wave nine.
 * 3. Among guns, the one already furthest up its chain. Concentrating stars on
 *    one weapon beats spreading them, and it also means clicking through the
 *    advice walks a single block to level 6 before starting the next.
 * 4. Cheapest first, then part id. Ties resolve the same way every call, so the
 *    mark does not jump between blocks as the camera moves.
 *
 * Pure data and arithmetic (see AGENTS.md): no engine, DOM, or storage.
 */

import { nextUpgrade } from './economy.ts';
import { getPartDef } from './parts.ts';
import type { PartDefinition, PlacedPart } from './types.ts';

export interface UpgradeRecommendation {
  /** Placed part the coach mark hangs over. */
  partId: string;
  /** Catalog id of that part, for naming and icon lookup. */
  defId: string;
  /** Level the unlock grants; the part's level plus one. */
  targetLevel: number;
  /** Price of that single unlock, already known to be affordable. */
  price: number;
}

/**
 * True for the blocks the advice puts first: guns, melee heads, and the build
 * signature blocks. All three are bought to kill things, which is the thing
 * stars help with most.
 */
function isWeaponPart(def: PartDefinition): boolean {
  return (
    def.weapon !== undefined ||
    def.melee !== undefined ||
    def.signature !== undefined
  );
}

function placedLevel(part: PlacedPart): number {
  const level = part.config.level ?? 1;
  return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
}

interface Candidate extends UpgradeRecommendation {
  weaponTier: number;
  level: number;
}

/** Sort key order: weapons first, most-upgraded first, cheapest, then id. */
function betterThan(a: Candidate, b: Candidate): boolean {
  if (a.weaponTier !== b.weaponTier) return a.weaponTier < b.weaponTier;
  if (a.level !== b.level) return a.level > b.level;
  if (a.price !== b.price) return a.price < b.price;
  return a.partId < b.partId;
}

/**
 * The one unlock worth recommending for this rig and wallet, or null when
 * nothing on the vehicle has an affordable next step.
 */
export function recommendUpgrade(
  parts: readonly PlacedPart[],
  money: number,
): UpgradeRecommendation | null {
  if (!Number.isFinite(money) || money < 0) return null;

  let best: Candidate | null = null;
  for (const part of parts) {
    const upgrade = nextUpgrade(part);
    if (upgrade === null || upgrade.price > money) continue;
    const candidate: Candidate = {
      partId: part.id,
      defId: part.defId,
      targetLevel: upgrade.targetLevel,
      price: upgrade.price,
      weaponTier: isWeaponPart(getPartDef(part.defId)) ? 0 : 1,
      level: placedLevel(part),
    };
    if (best === null || betterThan(candidate, best)) best = candidate;
  }
  if (best === null) return null;

  return {
    partId: best.partId,
    defId: best.defId,
    targetLevel: best.targetLevel,
    price: best.price,
  };
}
