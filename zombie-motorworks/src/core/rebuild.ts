/**
 * Buying back everything a wave tore off, in one transaction.
 *
 * Parts destroyed in a wave are remembered as a flat list, but they do not go
 * back on a flat rig: a wheel hangs off the frame box beside it, and that frame
 * box may have died in the same wave. Validating each missing part against the
 * blueprint as it stands right now therefore rejects the wheel — its mount is
 * not there yet — and the player has to press Rebuild Car a second time to get
 * the parts the first press unblocked.
 *
 * So the plan is resolved in passes against a growing draft blueprint: place
 * everything that fits, then look again at what is left, and stop when a pass
 * places nothing. One press restores the whole tree however deep it goes.
 *
 * Anything still unplaceable after that is genuinely blocked — its old cell has
 * been built over since — and is left out of both the cost and the action
 * rather than holding up the rest.
 *
 * Pure blueprint arithmetic (see AGENTS.md): no engine, DOM, or storage.
 */

import { withPartAdded } from './blueprint.ts';
import { canPlacePart } from './placement.ts';
import type { PartDefinition, PlacedPart, VehicleBlueprint } from './types.ts';

type Catalog = (defId: string) => PartDefinition;

export interface RebuildPlan {
  /**
   * Parts to re-place, in an order where each one is valid against the
   * blueprint plus every part before it. Apply them in this order.
   */
  parts: PlacedPart[];
  /** Combined shelf price of `parts`. */
  totalCost: number;
}

export function planRebuild(
  bp: VehicleBlueprint,
  getDef: Catalog,
  missingParts: readonly PlacedPart[],
): RebuildPlan {
  const parts: PlacedPart[] = [];
  let totalCost = 0;
  let draft = bp;
  let remaining = [...missingParts];

  let placedThisPass = true;
  while (placedThisPass && remaining.length > 0) {
    placedThisPass = false;
    const blocked: PlacedPart[] = [];
    for (const part of remaining) {
      const check = canPlacePart(
        draft,
        getDef,
        part.defId,
        part.pos,
        part.orient,
        part.config,
      );
      if (!check.ok) {
        blocked.push(part);
        continue;
      }
      draft = withPartAdded(draft, part);
      parts.push(part);
      totalCost += getDef(part.defId).cost;
      placedThisPass = true;
    }
    remaining = blocked;
  }

  return { parts, totalCost };
}
