/**
 * The First Play rig is a loaner, and these are the guards that keep it that
 * way. A player who closes the tab between the tutorial wave and the Build
 * picker must come back to an ordinary starter Garage — not to the six-engine
 * demo rig, and not to a "Resume Run" that hands the whole thing back.
 */

import { describe, expect, it } from 'vitest';
import {
  FIRST_PLAY_BLUEPRINT_NAME,
  buildFirstPlayBlueprint,
  buildStarterRig,
  isFirstPlayBlueprint,
} from '../src/core/builds.ts';
import {
  purgeFirstPlayLoaner,
  type LoanerStorage,
} from '../src/app/firstPlayLoaner.ts';
import { BLUEPRINT_STORAGE_KEY } from '../src/editor/EditorMode.ts';
import { ProfileStore } from '../src/app/profileStore.ts';
import { RunSaveStore } from '../src/app/runSaveStore.ts';
import { encodeProfile, defaultProfile } from '../src/core/profile.ts';
import { serializeBlueprint } from '../src/core/serialize.ts';
import { encodeSavedRun, type SavedRun } from '../src/core/runSave.ts';
import type { VehicleBlueprint } from '../src/core/types.ts';

class MemoryStorage implements LoanerStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function savedRunOn(blueprint: VehicleBlueprint): SavedRun {
  return {
    schemaVersion: 6,
    phase: 'build',
    activeWave: 1,
    score: 0,
    wave: 2,
    kills: 4,
    biomeId: 'graveyard',
    seed: 7,
    bankedEarnings: 120,
    elapsedSeconds: 41,
    blueprint,
    partHp: {},
    missingParts: [],
    savedAt: 1_700_000_000_000,
  };
}

/** Storage as an older build left it: the loaner banked everywhere it could be. */
function stuckStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  const loaner = buildFirstPlayBlueprint();
  storage.values.set(
    BLUEPRINT_STORAGE_KEY,
    JSON.stringify({
      [FIRST_PLAY_BLUEPRINT_NAME]: serializeBlueprint(loaner),
      'Death Machine': serializeBlueprint({
        ...loaner,
        name: 'Death Machine',
      }),
    }),
  );
  storage.values.set(
    'scraprig.profile.v1',
    encodeProfile({
      ...defaultProfile(),
      currentBlueprintName: FIRST_PLAY_BLUEPRINT_NAME,
    }),
  );
  storage.values.set('scraprig.run.v1', encodeSavedRun(savedRunOn(loaner)));
  return storage;
}

describe('the First Play loaner never becomes the player’s rig', () => {
  it('names only the demo rig', () => {
    expect(isFirstPlayBlueprint(buildFirstPlayBlueprint())).toBe(true);
    expect(isFirstPlayBlueprint(buildStarterRig('medium'))).toBe(false);
  });

  it('clears the banked slot, the pointer, and the resumable run', () => {
    const storage = stuckStorage();
    const profiles = new ProfileStore(storage);
    const runs = new RunSaveStore(storage);

    expect(purgeFirstPlayLoaner(storage, profiles, runs)).toBe(true);

    const slots = JSON.parse(
      storage.values.get(BLUEPRINT_STORAGE_KEY) ?? '{}',
    ) as Record<string, string>;
    expect(slots[FIRST_PLAY_BLUEPRINT_NAME]).toBeUndefined();
    expect(profiles.load().currentBlueprintName).toBeUndefined();
    expect(runs.load()).toBeNull();
  });

  it('leaves the designs the player saved themselves alone', () => {
    const storage = stuckStorage();

    purgeFirstPlayLoaner(storage, new ProfileStore(storage), new RunSaveStore(storage));

    const slots = JSON.parse(
      storage.values.get(BLUEPRINT_STORAGE_KEY) ?? '{}',
    ) as Record<string, string>;
    expect(Object.keys(slots)).toEqual(['Death Machine']);
  });

  it('leaves an ordinary save untouched, and reports nothing found', () => {
    const storage = new MemoryStorage();
    const mine = { ...buildFirstPlayBlueprint(), name: 'Death Machine' };
    storage.values.set(
      BLUEPRINT_STORAGE_KEY,
      JSON.stringify({ 'Death Machine': serializeBlueprint(mine) }),
    );
    storage.values.set(
      'scraprig.profile.v1',
      encodeProfile({
        ...defaultProfile(),
        currentBlueprintName: 'Death Machine',
      }),
    );
    storage.values.set('scraprig.run.v1', encodeSavedRun(savedRunOn(mine)));
    const profiles = new ProfileStore(storage);
    const runs = new RunSaveStore(storage);

    expect(purgeFirstPlayLoaner(storage, profiles, runs)).toBe(false);

    expect(profiles.load().currentBlueprintName).toBe('Death Machine');
    expect(runs.load()?.blueprint.name).toBe('Death Machine');
  });

  it('survives storage it cannot parse', () => {
    const storage = new MemoryStorage();
    storage.values.set(BLUEPRINT_STORAGE_KEY, '{not json');

    expect(() =>
      purgeFirstPlayLoaner(
        storage,
        new ProfileStore(storage),
        new RunSaveStore(storage),
      ),
    ).not.toThrow();
  });
});
