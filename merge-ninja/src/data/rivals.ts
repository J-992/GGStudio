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
const CHAPTER_STAGES = [10, 19, 28, 37, 50, 65, 82, 100] as const;
const CHAPTER_AVATARS = [5, 8, 10, 12, 15, 18, 22, 29] as const;

/**
 * The opening targets land exactly on the authored arena chapters. That makes
 * each marker a promise of visible new content rather than another arbitrary
 * number. Beyond the Stage-100 record, the ladder remains open-ended.
 */
export function rivalMilestone(index: number): RivalMilestone {
  const safeIndex = Math.max(0, Math.floor(index));
  const stage = CHAPTER_STAGES[safeIndex]
    ?? CHAPTER_STAGES[CHAPTER_STAGES.length - 1]! + (safeIndex - CHAPTER_STAGES.length + 1) * 25;
  return {
    index: safeIndex,
    name: NAMES[safeIndex % NAMES.length]!,
    stage,
    avatarTier: CHAPTER_AVATARS[safeIndex] ?? ((safeIndex * 3) % 29) + 1,
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

/** True when this exact stage is one of the named rival finish lines. */
export function isRivalMilestoneStage(stage: number): boolean {
  const safeStage = Math.max(1, Math.floor(stage));
  return rivalMilestone(nextRivalIndex(safeStage - 1)).stage === safeStage;
}
