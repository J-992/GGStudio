import { describe, expect, it } from 'vitest';
import {
  CRIMSON_DOJO_PAGE,
  bossStickerForStage,
  cleanStickerIds,
  isDojoStyleUnlocked,
  legacyStickerIdsForReachedStage,
  stickerPageProgress,
} from '../src/data/dojoStyles';

describe('dojo style collection', () => {
  it('authors the first runway at stages 1, 5, and 10', () => {
    expect(CRIMSON_DOJO_PAGE.stickers.map((sticker) => sticker.stage)).toEqual([1, 5, 10]);
    expect(bossStickerForStage(5)?.id).toBe('crimson-dojo-2');
    expect(bossStickerForStage(6)).toBeNull();
  });

  it('unlocks Crimson Dojo only when all three seals are collected', () => {
    const partial = new Set(['crimson-dojo-1', 'crimson-dojo-2']);
    expect(stickerPageProgress(CRIMSON_DOJO_PAGE, partial)).toMatchObject({ have: 2, total: 3, complete: false });
    expect(stickerPageProgress(CRIMSON_DOJO_PAGE, partial).next?.stage).toBe(10);
    expect(isDojoStyleUnlocked('classic', partial)).toBe(true);
    expect(isDojoStyleUnlocked('crimson-dojo', partial)).toBe(false);

    partial.add('crimson-dojo-3');
    expect(isDojoStyleUnlocked('crimson-dojo', partial)).toBe(true);
  });

  it('sanitizes saved ids and migrates only milestones proven defeated', () => {
    expect(cleanStickerIds(['crimson-dojo-1', 'bad', 4, 'crimson-dojo-1'])).toEqual(['crimson-dojo-1']);
    expect(legacyStickerIdsForReachedStage(1)).toEqual([]);
    expect(legacyStickerIdsForReachedStage(5)).toEqual(['crimson-dojo-1']);
    expect(legacyStickerIdsForReachedStage(11)).toEqual([
      'crimson-dojo-1',
      'crimson-dojo-2',
      'crimson-dojo-3',
    ]);
  });
});
