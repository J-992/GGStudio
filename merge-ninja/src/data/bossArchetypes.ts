/**
 * What makes one boss different from the next.
 *
 * Pure data plus the rotation rule, so the sim, the HUD, and the unit runner
 * all read the same ladder. Every modifier answers a different verb the player
 * already owns -- tapping, merging, and speed -- rather than adding a new one,
 * which is why none of them needs a tutorial: the first encounter of each is
 * the gentlest instance that archetype ever produces.
 */

import { BALANCE } from './balance';

export type ArchetypeId = 'bare' | 'shielded' | 'enraged' | 'greedy';

export interface ArchetypeDef {
  readonly id: ArchetypeId;
  /** Banner word shown once, on the first encounter only. */
  readonly label: string;
  /** The verb this archetype asks the player to use. */
  readonly asks: 'nothing' | 'tap' | 'merge' | 'speed';
  /** First stage this may appear on; `bare` is always available. */
  readonly fromStage: number;
}

export const ARCHETYPES: Readonly<Record<ArchetypeId, ArchetypeDef>> = {
  bare: { id: 'bare', label: 'CHALLENGER', asks: 'nothing', fromStage: 1 },
  shielded: {
    id: 'shielded',
    label: 'SHIELDED',
    asks: 'tap',
    fromStage: BALANCE.archetypes.shieldedFromStage,
  },
  enraged: {
    id: 'enraged',
    label: 'ENRAGED',
    asks: 'merge',
    fromStage: BALANCE.archetypes.enragedFromStage,
  },
  greedy: {
    id: 'greedy',
    label: 'GREEDY',
    asks: 'speed',
    fromStage: BALANCE.archetypes.greedyFromStage,
  },
};

/** Every archetype that actually changes the fight. */
export type ModifiedArchetypeId = Exclude<ArchetypeId, 'bare'>;

/** Rotation order once a modifier is due; stable so runs stay reproducible. */
export const MODIFIED_ORDER: readonly ModifiedArchetypeId[] = ['shielded', 'enraged', 'greedy'];

export const ARCHETYPE_ORDER: readonly ArchetypeId[] = ['bare', ...MODIFIED_ORDER];

export function archetype(id: ArchetypeId): ArchetypeDef {
  return ARCHETYPES[id];
}

export function isArchetypeId(value: unknown): value is ArchetypeId {
  return typeof value === 'string' && value in ARCHETYPES;
}

/** Everything the fight needs to know, resolved from the stage alone. */
export interface ArchetypeSpec {
  readonly id: ArchetypeId;
  /** Tap charges holding ninja DPS off. 0 for every other archetype. */
  readonly shieldCharges: number;
  /** Share of maximum health regained per second while unanswered. */
  readonly regenPerSec: number;
  /** How long a merge holds the regeneration off. */
  readonly mergeWindowMs: number;
  /** How long the tripled reward stands. */
  readonly bountyWindowMs: number;
  readonly rewardMultiplier: number;
  /** True on the stage this archetype is introduced, which is its gentlest instance. */
  readonly introduction: boolean;
}

export const BARE_ARCHETYPE: ArchetypeSpec = {
  id: 'bare',
  shieldCharges: 0,
  regenPerSec: 0,
  mergeWindowMs: 0,
  bountyWindowMs: 0,
  rewardMultiplier: 1,
  introduction: false,
};

/**
 * Which modifier stage N carries.
 *
 * Three rules, in order, and the order is the design:
 *
 * 1. Below the first modified stage everything is plain. The opening ladder
 *    teaches buying and merging and must not compete with anything.
 * 2. A stage that is exactly some archetype's `fromStage` always plays that
 *    archetype. Introductions are the only teaching these mechanics get, so
 *    they cannot be left to a rotation that might skip them.
 * 3. Below `restBeatUntilStage`, every other stage is plain. Back-to-back
 *    modifiers early read as the difficulty going up rather than the variety,
 *    which is the opposite of the point.
 *
 * Above that band `bare` stays in the rotation as a deliberate rest beat --
 * an unbroken run of modified bosses is just a higher baseline, and a
 * baseline is what this is trying to break up.
 *
 * Pure and total in `stage`, so a seeded run reproduces exactly and the
 * pacing sim stays comparable across builds.
 */
export function archetypeForStage(stage: number): ArchetypeSpec {
  const safe = Math.max(1, Math.floor(stage));
  const { restBeatUntilStage } = BALANCE.archetypes;
  const first = ARCHETYPES.shielded.fromStage;
  if (safe < first) return BARE_ARCHETYPE;

  const introduced = MODIFIED_ORDER.find((id) => ARCHETYPES[id].fromStage === safe);
  if (introduced !== undefined) return spec(introduced, safe, true);

  if (safe < restBeatUntilStage && (safe - first) % 2 === 1) return BARE_ARCHETYPE;

  const pool = safe < restBeatUntilStage
    ? MODIFIED_ORDER.filter((id) => safe >= ARCHETYPES[id].fromStage)
    : ARCHETYPE_ORDER.filter((id) => safe >= ARCHETYPES[id].fromStage);
  const id: ArchetypeId = pool[Math.floor(safe / 2) % pool.length] ?? 'bare';
  return id === 'bare' ? BARE_ARCHETYPE : spec(id, safe, false);
}

function spec(id: ModifiedArchetypeId, stage: number, introduction: boolean): ArchetypeSpec {
  const a = BALANCE.archetypes;
  if (id === 'shielded') {
    return {
      ...BARE_ARCHETYPE,
      id,
      introduction,
      // The introduction is always a single charge: one tap, one visible
      // segment shattering, and the rule is taught without a word of copy.
      shieldCharges: introduction
        ? 1
        : Math.min(a.shield.maxCharges, Math.max(1, Math.ceil(stage / a.shield.stageDivisor))),
    };
  }
  if (id === 'enraged') {
    return {
      ...BARE_ARCHETYPE,
      id,
      introduction,
      regenPerSec: a.enrage.regenPerSec,
      mergeWindowMs: introduction ? a.enrage.firstWindowMs : a.enrage.windowMs,
    };
  }
  return {
    ...BARE_ARCHETYPE,
    id,
    introduction,
    bountyWindowMs: introduction ? a.greed.firstWindowMs : a.greed.windowMs,
    rewardMultiplier: a.greed.rewardMultiplier,
  };
}
