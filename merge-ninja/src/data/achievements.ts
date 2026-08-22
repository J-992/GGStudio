import { BALANCE } from './balance';
import { BOSS_COUNT } from './enemies';

/**
 * Named goals with a moment attached.
 *
 * The game already celebrates two things well -- meeting a new ninja and
 * felling a boss -- but everything else a player does well passes unremarked.
 * These are the rest of those moments: each one is a sentence the player can
 * read as "I did that", awarded once and kept forever.
 *
 * Every threshold is reachable by playing normally. Nothing here asks for a
 * daily visit, a wait, or a purchase, and nothing is hidden behind another
 * achievement, so the list reads as a menu of things to try rather than a
 * chore chart.
 */

/** Loose grouping, used only to tint the badge so the list reads at a glance. */
export type AchievementKind = 'merge' | 'combat' | 'collection' | 'mastery';

export const ACHIEVEMENT_TINTS: Record<AchievementKind, number> = {
  merge: 0x6fbf52,
  combat: 0xd64541,
  collection: 0xffd23f,
  mastery: 0xb07af0,
};

/**
 * Everything an achievement is allowed to look at.
 *
 * Counters that reset with the run (merges, coins earned) describe a single
 * session; the collection and ascension figures are lifetime totals from the
 * meta slot. Both kinds are legitimate goals -- one asks "how good was that
 * run", the other "how far have you come overall".
 */
export interface AchievementSnapshot {
  stage: number;
  highestTier: number;
  merges: number;
  purchases: number;
  bossDefeats: number;
  coinsEarned: number;
  timePlayedMs: number;
  /** Lifetime: distinct ninja tiers ever revealed. */
  tiersDiscovered: number;
  /** Lifetime: distinct boss identities ever met. */
  bossesSeen: number;
  /** Lifetime: completed ascensions. */
  ascensions: number;
  /** Lifetime: distinct calendar days played. */
  daysVisited: number;
}

export interface AchievementDef {
  id: string;
  /** Shouted: the bitmap font carries no lowercase glyphs. */
  name: string;
  description: string;
  kind: AchievementKind;
  earned: (snapshot: AchievementSnapshot) => boolean;
}

const COLLECTION_TOTAL = BALANCE.tiers.count + BOSS_COUNT;

/**
 * Ordered easiest-first: the list doubles as the achievements screen, and a
 * new player should see the next reachable thing near the top.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-merge',
    name: 'FIRST FUSION',
    description: 'MERGE TWO NINJAS TOGETHER',
    kind: 'merge',
    earned: (s) => s.merges >= 1,
  },
  {
    id: 'first-victory',
    name: 'FIRST VICTORY',
    description: 'DEFEAT YOUR FIRST BOSS',
    kind: 'combat',
    earned: (s) => s.bossDefeats >= 1,
  },
  {
    id: 'merge-50',
    name: 'PRACTICED HANDS',
    description: 'MERGE 50 TIMES IN ONE RUN',
    kind: 'merge',
    earned: (s) => s.merges >= 50,
  },
  {
    id: 'stage-10',
    name: 'TENTH GATE',
    description: 'REACH STAGE 10',
    kind: 'combat',
    earned: (s) => s.stage >= 10,
  },
  {
    id: 'tier-10',
    name: 'RISING RANKS',
    description: 'FIELD A LEVEL 10 NINJA',
    kind: 'merge',
    earned: (s) => s.highestTier >= 10,
  },
  {
    id: 'survive-10min',
    name: 'STEADY HAND',
    description: 'PLAY ONE RUN FOR 10 MINUTES',
    kind: 'mastery',
    earned: (s) => s.timePlayedMs >= 10 * 60_000,
  },
  {
    id: 'merge-250',
    name: 'MASTER MERGER',
    description: 'MERGE 250 TIMES IN ONE RUN',
    kind: 'merge',
    earned: (s) => s.merges >= 250,
  },
  {
    id: 'boss-25',
    name: 'GATE BREAKER',
    description: 'DEFEAT 25 BOSSES IN ONE RUN',
    kind: 'combat',
    earned: (s) => s.bossDefeats >= 25,
  },
  {
    id: 'stage-25',
    name: 'DEEP RUN',
    description: 'REACH STAGE 25',
    kind: 'combat',
    earned: (s) => s.stage >= 25,
  },
  {
    id: 'collect-half',
    name: 'CURATOR',
    description: 'DISCOVER HALF THE ALMANAC',
    kind: 'collection',
    earned: (s) => s.tiersDiscovered + s.bossesSeen >= Math.ceil(COLLECTION_TOTAL / 2),
  },
  {
    id: 'tier-20',
    name: 'ELITE ROSTER',
    description: 'FIELD A LEVEL 20 NINJA',
    kind: 'merge',
    earned: (s) => s.highestTier >= 20,
  },
  {
    id: 'rich',
    name: 'FULL COFFERS',
    description: 'EARN 100,000 COINS IN ONE RUN',
    kind: 'mastery',
    earned: (s) => s.coinsEarned >= 100_000,
  },
  {
    id: 'daily-3',
    name: 'REGULAR',
    description: 'PLAY ON THREE DIFFERENT DAYS',
    kind: 'mastery',
    earned: (s) => s.daysVisited >= 3,
  },
  {
    id: 'ascend-1',
    name: 'NEW BEGINNING',
    description: 'ASCEND FOR THE FIRST TIME',
    kind: 'mastery',
    earned: (s) => s.ascensions >= 1,
  },
  {
    id: 'tier-max',
    name: 'FINAL EVOLUTION',
    description: 'FIELD THE LAST NINJA',
    kind: 'merge',
    earned: (s) => s.highestTier >= BALANCE.tiers.count,
  },
  {
    id: 'collect-all',
    name: 'COMPLETIONIST',
    description: 'DISCOVER EVERY ALMANAC ENTRY',
    kind: 'collection',
    earned: (s) => s.tiersDiscovered + s.bossesSeen >= COLLECTION_TOTAL,
  },
  {
    id: 'ascend-5',
    name: 'ETERNAL STUDENT',
    description: 'ASCEND FIVE TIMES',
    kind: 'mastery',
    earned: (s) => s.ascensions >= 5,
  },
];

export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;

/** Lookup by id, for repainting a stored unlock list. */
export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((entry) => entry.id === id);
}
