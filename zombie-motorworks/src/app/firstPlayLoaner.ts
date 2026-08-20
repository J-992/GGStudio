/**
 * Storage cleanup for the First Play loaner rig.
 *
 * The tutorial wave is driven on a demo vehicle the player is never sold — see
 * `firstPlayRig` — and the Garage that follows opens on it with the Build
 * picker up. Nothing about that rig is theirs until they pick, so nothing about
 * it may reach persistence: not a garage save slot, not `currentBlueprintName`,
 * and not a resumable run checkpoint. Otherwise a player who closes the tab on
 * the picker comes back to six engines and a Heavy Cannon sitting in their bay,
 * and a "Resume Run" that hands the whole demo back.
 *
 * `EditorMode.writeCurrentSlot` and `App.writeRunSave` refuse to write it in the
 * first place. This runs at boot for the browsers that already banked it under
 * an older build, which is exactly the population that is stuck.
 */

import { FIRST_PLAY_BLUEPRINT_NAME } from '../core/builds.ts';
import { BLUEPRINT_STORAGE_KEY } from '../editor/EditorMode.ts';
import { ProfileStore, profileStore } from './profileStore.ts';
import { RunSaveStore, runSaveStore } from './runSaveStore.ts';

export interface LoanerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): LoanerStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Drop every trace of the loaner rig, and report whether anything was found.
 *
 * Only the loaner's own slot goes. A design the player saved themselves under
 * another name is untouched, and clearing `currentBlueprintName` alongside it
 * sends the Garage back to the ordinary starter rig rather than to a blank
 * grid. Unreadable or unwritable storage is not an error: there is then nothing
 * on disk that could be handing the demo back.
 */
export function purgeFirstPlayLoaner(
  storage: LoanerStorage | null = browserStorage(),
  profiles: ProfileStore = profileStore,
  runs: RunSaveStore = runSaveStore,
): boolean {
  let found = false;

  try {
    const raw = storage?.getItem(BLUEPRINT_STORAGE_KEY) ?? null;
    if (raw !== null) {
      const slots: unknown = JSON.parse(raw);
      if (
        typeof slots === 'object' &&
        slots !== null &&
        !Array.isArray(slots) &&
        FIRST_PLAY_BLUEPRINT_NAME in slots
      ) {
        delete (slots as Record<string, unknown>)[FIRST_PLAY_BLUEPRINT_NAME];
        storage?.setItem(BLUEPRINT_STORAGE_KEY, JSON.stringify(slots));
        found = true;
      }
    }
  } catch {
    // Malformed or sealed storage has no loaner to give back.
  }

  try {
    const profile = profiles.load();
    if (profile.currentBlueprintName === FIRST_PLAY_BLUEPRINT_NAME) {
      delete profile.currentBlueprintName;
      profiles.save(profile);
      found = true;
    }
  } catch {
    // A profile that cannot be written still has the pointer dropped in memory.
  }

  const savedRun = runs.load();
  if (savedRun?.blueprint.name === FIRST_PLAY_BLUEPRINT_NAME) {
    runs.clear();
    found = true;
  }

  return found;
}
