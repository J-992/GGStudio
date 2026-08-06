import { describe, expect, it } from 'vitest';

import { getPartDef } from '../src/core/parts.ts';
import {
  allCounterPartIds,
  assertThreatCountersExist,
  threatPreviewForWave,
} from '../src/survival/threatPreview.ts';
import {
  newThreatsForWave,
  threatWarningsForWave,
} from '../src/survival/waveBalance.ts';
import { modelFileFor, visualHeightMFor } from '../src/survival/zombies/Zombie.ts';
import {
  BOSS_WAVE_INTERVAL,
  bossForWave,
} from '../src/survival/zombies/bossConfig.ts';

const WAVES = Array.from({ length: 30 }, (_, index) => index + 1);

describe('threat alert previews', () => {
  it('names only parts the catalog still has', () => {
    // The tiles are built from `getPartDef`, so a renamed part does not throw
    // in the card — it silently drops its own recommendation, and the player
    // is told to counter a boss with nothing. Nothing but this notices.
    expect(() => assertThreatCountersExist()).not.toThrow();
    expect(allCounterPartIds().length).toBeGreaterThan(0);
  });

  it('previews exactly the waves the old warning text spoke up on', () => {
    // The alert replaced that text. If the two ever disagree, one of the
    // waves that used to warn has gone quiet.
    for (const wave of WAVES) {
      const warned = threatWarningsForWave(wave).length > 0;
      expect(threatPreviewForWave(wave) !== null).toBe(warned);
    }
  });

  it('warns about the boss every time it comes round, not just the first', () => {
    // A specialist announces itself once; a boss is a fight you have to shop
    // for again on every recurrence.
    for (const wave of WAVES.filter((w) => w % BOSS_WAVE_INTERVAL === 0)) {
      const preview = threatPreviewForWave(wave);
      expect(preview).not.toBeNull();
      expect(preview!.boss).toBe(true);
      expect(preview!.subjects).toHaveLength(1);
      expect(preview!.headline).toBe('BOSS INCOMING');
      // The whole point of the boss card: it tells you what to go buy.
      expect(preview!.counters.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('shows the boss standing at the size it will actually be', () => {
    const boss = bossForWave(BOSS_WAVE_INTERVAL * 2);
    expect(boss?.style).toBe('classic');
    const preview = threatPreviewForWave(BOSS_WAVE_INTERVAL * 2)!;
    const definition = boss!.style === 'classic' ? boss!.definition : null;
    expect(preview.subjects[0].modelFile).toBe(
      modelFileFor('boss', 0, definition),
    );
    expect(preview.subjects[0].heightM).toBe(
      visualHeightMFor('boss', definition),
    );
  });

  it('puts each new specialist on the stage with its own model and rig', () => {
    for (const wave of WAVES) {
      const kinds = newThreatsForWave(wave);
      if (kinds.length === 0 || bossForWave(wave)) continue;
      const preview = threatPreviewForWave(wave)!;
      expect(preview.boss).toBe(false);
      expect(preview.subjects.map((subject) => subject.id)).toEqual(kinds);
      for (const subject of preview.subjects) {
        expect(subject.modelFile).toBe(modelFileFor(subject.id as never, 0, null));
        expect(subject.heightM).toBeGreaterThan(0);
        // Every specialist gets its few words. A boss may not — the copy is
        // per-boss, and a boss added without one still has to alert.
        expect(subject.tagline).not.toBe('');
      }
    }
  });

  it('matches the headline to how many things it is putting on screen', () => {
    for (const wave of WAVES) {
      const preview = threatPreviewForWave(wave);
      if (preview === null || preview.boss) continue;
      expect(preview.headline).toBe(
        preview.subjects.length > 1 ? 'NEW THREATS' : 'NEW THREAT',
      );
    }
  });

  it('never recommends the same part twice in one alert', () => {
    for (const wave of WAVES) {
      const preview = threatPreviewForWave(wave);
      if (preview === null) continue;
      expect(new Set(preview.counters).size).toBe(preview.counters.length);
    }
  });

  it('gives every new kind on a shared alert a counter of its own', () => {
    // Two kinds arriving together used to hand both tiles to whichever sorted
    // first, so the second threat arrived with no advice at all.
    const shared = WAVES.map(threatPreviewForWave).find(
      (preview) => preview !== null && !preview.boss && preview.subjects.length > 1,
    );
    if (!shared) return;
    expect(shared.counters.length).toBeGreaterThanOrEqual(2);
  });

  it('quotes counters the store can actually sell', () => {
    for (const id of allCounterPartIds()) {
      const def = getPartDef(id);
      // A build's signature block is bolted on for the run and is not on any
      // shelf, so recommending one is advice the player cannot act on.
      expect(def.buildSignature ?? false).toBe(false);
      expect(def.cost).toBeGreaterThan(0);
    }
  });
});
