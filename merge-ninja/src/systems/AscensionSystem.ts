import { BALANCE } from '../data/balance';
import { BOSS_COUNT } from '../data/enemies';

/**
 * The prestige gate: the run must have beaten the whole boss ladder once, or
 * climbed to the final tier. Either way the goal-gradient has gone flat and
 * "go again, faster" is the only thing left to reach for.
 */
export function ascensionUnlocked(stage: number, highestTierEverOwned: number): boolean {
  return (
    Math.max(1, Math.floor(stage)) > BOSS_COUNT ||
    Math.max(1, Math.floor(highestTierEverOwned)) >= BALANCE.tiers.count
  );
}

/**
 * A title carried between runs.
 *
 * The income bonus an ascension grants shrinks every time (that is what keeps
 * the curve honest), so by the fourth prestige the reward is a number almost
 * nobody can feel. The rank is the half of the reward that does not decay: it
 * is the same size at ascension eight as at ascension one, it shows on the end
 * screen and the achievements page, and it is the reason to go around again
 * once the percentages have flattened out.
 */
export interface AscensionRank {
  /** 0 for a player who has never ascended. */
  index: number;
  name: string;
  tint: number;
}

/**
 * Rank names climb a dojo ladder and then stop climbing: past the last named
 * rank every further ascension keeps the top title rather than inventing
 * increasingly silly ones. The count is shown alongside it, so progress past
 * the ceiling is still visible.
 */
const RANKS: ReadonlyArray<{ name: string; tint: number }> = [
  { name: 'STUDENT', tint: 0xcbb79a },
  { name: 'INITIATE', tint: 0xd8975a },
  { name: 'ADEPT', tint: 0xc9c9d4 },
  { name: 'SHADOW', tint: 0x8fa9d6 },
  { name: 'SENSEI', tint: 0x6fbf52 },
  { name: 'MASTER', tint: 0xffd23f },
  { name: 'GRANDMASTER', tint: 0xb07af0 },
  { name: 'LEGEND', tint: 0xff9ad2 },
  { name: 'ETERNAL', tint: 0xfff6dd },
];

/** The title earned by a given number of completed ascensions. */
export function ascensionRank(ascensions: number): AscensionRank {
  const count = Math.max(0, Math.floor(Number.isFinite(ascensions) ? ascensions : 0));
  const index = Math.min(count, RANKS.length - 1);
  const rank = RANKS[index] ?? RANKS[0]!;
  return { index, name: rank.name, tint: rank.tint };
}

/** Highest rank index the ladder defines; ascending past it keeps the title. */
export const MAX_ASCENSION_RANK = RANKS.length - 1;

/**
 * Permanent coin-income share granted by stacked ascensions: the configured
 * first bonus, with each further ascension adding a decaying share of the one
 * before, capped at the configured ceiling. Zero ascensions pay nothing.
 */
export function ascensionIncomeBonus(ascensions: number): number {
  const { incomeBonusFirst, incomeBonusDecay, maxIncomeBonus } = BALANCE.ascension;
  const count = Math.max(0, Math.floor(ascensions));
  if (count === 0) return 0;

  let total = 0;
  let step = incomeBonusFirst;
  for (let index = 0; index < count; index += 1) {
    total += step;
    if (total >= maxIncomeBonus) return maxIncomeBonus;
    step *= incomeBonusDecay;
  }
  return Math.min(total, maxIncomeBonus);
}
