/**
 * Pure decision table for development preview seeding.
 *
 * The only ways a ninja may appear outside normal play are explicit URL
 * params (`?showcaseTier=14`, `?showcaseBoss=7`, `?showcaseRoster=1`), and
 * they work in dev builds only. Reloads, HMR, responsive relayouts and
 * production boots must never mutate a roster: there is deliberately NO
 * implicit starter seed, so "a random tier 1 after a Vite reload" cannot
 * happen and a fresh run begins through the real economy instead.
 */

export interface PreviewRequest {
  readonly showcaseTier?: string | null;
  readonly showcaseBoss?: string | null;
  readonly showcaseRoster?: boolean;
}

export interface PreviewEnvironment {
  readonly devMode: boolean;
  readonly restarted: boolean;
  readonly loadedFromSave: boolean;
  readonly tierCount: number;
  readonly bossCount: number;
}

export interface PreviewPlan {
  /** Tiers to place on the board, in order, skipping owned duplicates. */
  readonly tiers: readonly number[];
  /** Advance the boss ladder to this stage, or null to leave it alone. */
  readonly skipToStage: number | null;
}

/** The spread used by `?showcaseRoster=1` -- one per early tier plus milestones. */
export const SHOWCASE_ROSTER_TIERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20];

const parseBoundedInt = (raw: string | null | undefined, max: number): number | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) return null;
  return value;
};

export function previewSeedPlan(request: PreviewRequest, env: PreviewEnvironment): PreviewPlan {
  if (!env.devMode || env.restarted) return { tiers: [], skipToStage: null };

  const tier = parseBoundedInt(request.showcaseTier, env.tierCount);
  const boss = parseBoundedInt(request.showcaseBoss, env.bossCount);
  const asked = tier !== null || boss !== null || request.showcaseRoster === true;

  // Without an explicit ask the roster is never touched -- saved runs keep
  // their exact contents across reloads, and brand-new runs start empty.
  if (!asked) return { tiers: [], skipToStage: null };

  const tiers = tier !== null ? [tier] : request.showcaseRoster === true ? [...SHOWCASE_ROSTER_TIERS] : [];
  return { tiers, skipToStage: boss };
}
