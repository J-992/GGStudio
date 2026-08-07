/**
 * Which block a repair kit should spend itself on.
 *
 * Pure so the priority can be read and tested on its own: the Runtime Vehicle
 * supplies the candidates and carries the decision out, and the survival drop
 * that hands out kits never re-implements the ordering.
 */

/** One block as a repair kit sees it. */
export interface RepairCandidate {
  readonly id: string;
  /** Tires first — a rig missing a wheel is a rig that cannot fight. */
  readonly isWheel: boolean;
  readonly alive: boolean;
  /** Blown clear of the rig; those are gone for good and cannot be rebuilt. */
  readonly detached: boolean;
  /** At least one living, attached neighbour to bolt back onto. */
  readonly hasLiveNeighbour: boolean;
  readonly health: number;
  readonly maxHealth: number;
}

export type RepairChoice =
  | { readonly action: 'rebuild'; readonly id: string }
  | { readonly action: 'heal'; readonly id: string }
  | { readonly action: 'none' };

/**
 * What one repair kit should do, in the order the player would want it:
 * rebuild a lost block (a lost tire before anything else), otherwise top up
 * whichever surviving block is hurt worst, otherwise nothing at all.
 *
 * Only a block with a living neighbour can be rebuilt — bolting one back into
 * mid-air would have the structure solver tear it straight off again as its
 * own island.
 */
export function chooseRepairTarget(
  candidates: readonly RepairCandidate[],
): RepairChoice {
  let rebuild: RepairCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.alive || candidate.detached) continue;
    if (!candidate.hasLiveNeighbour) continue;
    if (rebuild === null) {
      rebuild = candidate;
      continue;
    }
    // Wheels win outright; between two blocks of the same kind the choice is
    // arbitrary, so ties fall to the first seen and stay stable.
    if (candidate.isWheel && !rebuild.isWheel) rebuild = candidate;
  }
  if (rebuild !== null) return { action: 'rebuild', id: rebuild.id };

  let heal: RepairCandidate | null = null;
  let healFraction = 1;
  for (const candidate of candidates) {
    if (!candidate.alive || candidate.detached) continue;
    if (candidate.maxHealth <= 0) continue;
    const fraction = Math.max(0, candidate.health) / candidate.maxHealth;
    if (fraction >= 1) continue;
    if (heal === null || fraction < healFraction) {
      heal = candidate;
      healFraction = fraction;
    }
  }
  if (heal !== null) return { action: 'heal', id: heal.id };

  return { action: 'none' };
}
