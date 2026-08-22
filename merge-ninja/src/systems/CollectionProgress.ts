/** Pure counters behind the almanac badge and its section headers. */

/** How many collection entries are still locked; never negative. */
export function remainingCount(unlockedCount: number, totalCount: number): number {
  return Math.max(0, Math.floor(totalCount) - Math.max(0, Math.floor(unlockedCount)));
}

export interface CollectionProgress {
  have: number;
  left: number;
}

/** The badge-shaped summary of a collection section. */
export function collectionProgress(unlockedCount: number, totalCount: number): CollectionProgress {
  const have = Math.max(0, Math.min(Math.floor(unlockedCount), Math.floor(totalCount)));
  return { have, left: remainingCount(have, totalCount) };
}
