/**
 * A lightweight local rival ladder. These are aspirational milestone markers,
 * not claimed online players: the game can use them offline and every target
 * remains honest about being a stage goal.
 */
export interface RivalMilestone {
  readonly index: number;
  readonly name: string;
  readonly stage: number;
  readonly avatarTier: number;
}

const NAMES = ['KAI', 'MIA', 'ZOE', 'REX', 'NOVA', 'JIN', 'SKYE', 'MAX', 'LUNA', 'ACE'] as const;

/**
 * Targets spread out as a player climbs: 2, 4, 7, 11, 16… . The first rival
 * is immediate, while later rivals remain meaningful accomplishments rather
 * than a noisy notification every single stage.
 */
export function rivalMilestone(index: number): RivalMilestone {
  const safeIndex = Math.max(0, Math.floor(index));
  return {
    index: safeIndex,
    name: NAMES[safeIndex % NAMES.length]!,
    stage: 1 + ((safeIndex + 1) * (safeIndex + 2)) / 2,
    avatarTier: (safeIndex % 12) + 1,
  };
}

/** The next rival whose stated stage has not yet been reached. */
export function nextRivalIndex(stage: number): number {
  const current = Math.max(1, Math.floor(stage));
  let index = 0;
  while (rivalMilestone(index).stage <= current) index += 1;
  return index;
}

export function upcomingRivals(stage: number, count = 3): readonly RivalMilestone[] {
  const start = nextRivalIndex(stage);
  return Array.from({ length: Math.max(1, Math.floor(count)) }, (_, offset) => rivalMilestone(start + offset));
}
