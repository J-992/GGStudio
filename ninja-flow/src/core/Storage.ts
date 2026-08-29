/**
 * localStorage that can never take the game down.
 *
 * Poki runs the game inside a cross-origin iframe and Safari private mode
 * throws on the very first `setItem`. Every access is guarded, and a failure
 * silently degrades to an in-memory store: the run still plays, only the
 * persistence is lost.
 */
const KEY = 'ninjaflow.save.v1';

export interface SaveData {
  best: number;
  bestCombo: number;
  mastery: number;
  selected: string;
  unlocked: string[];
  muted: boolean;
  runs: number;
  lastPlayed: number;
  seenTutorial: boolean;
  /** Cosmetic loadout per character, keyed by slot. Validated by Cosmetics. */
  loadouts: Record<string, Record<string, string>>;
}

const DEFAULTS: SaveData = {
  best: 0,
  bestCombo: 0,
  mastery: 0,
  selected: 'fox',
  unlocked: ['fox'],
  muted: false,
  runs: 0,
  lastPlayed: 0,
  seenTutorial: false,
  loadouts: {},
};

let memory: SaveData | null = null;
let storageOk = true;

function raw(): Storage | null {
  if (!storageOk) return null;
  try {
    const s = window.localStorage;
    const probe = '__nf__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    storageOk = false;
    return null;
  }
}

export function loadSave(): SaveData {
  if (memory) return memory;
  const s = raw();
  let data: SaveData = { ...DEFAULTS };
  if (s) {
    try {
      const parsed = JSON.parse(s.getItem(KEY) ?? 'null');
      if (parsed && typeof parsed === 'object') data = sanitize(parsed);
    } catch {
      /* corrupt save — fall through to defaults */
    }
  }
  memory = data;
  return data;
}

export function saveSave(patch: Partial<SaveData>): SaveData {
  const next = { ...loadSave(), ...patch };
  memory = next;
  const s = raw();
  if (s) {
    try {
      s.setItem(KEY, JSON.stringify(next));
    } catch {
      storageOk = false;
    }
  }
  return next;
}

export function storageAvailable(): boolean {
  return storageOk;
}

function sanitizeLoadouts(input: unknown): Record<string, Record<string, string>> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [character, slots] of Object.entries(input as Record<string, unknown>)) {
    if (!slots || typeof slots !== 'object') continue;
    const kept: Record<string, string> = {};
    for (const [slot, id] of Object.entries(slots as Record<string, unknown>)) {
      if (typeof id === 'string') kept[slot] = id;
    }
    out[character] = kept;
  }
  return out;
}

function sanitize(input: Record<string, unknown>): SaveData {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    best: Math.max(0, num(input.best, 0)),
    bestCombo: Math.max(0, num(input.bestCombo, 0)),
    mastery: Math.max(0, num(input.mastery, 0)),
    selected: typeof input.selected === 'string' ? input.selected : DEFAULTS.selected,
    unlocked: Array.isArray(input.unlocked)
      ? input.unlocked.filter((v): v is string => typeof v === 'string')
      : [...DEFAULTS.unlocked],
    muted: input.muted === true,
    runs: Math.max(0, num(input.runs, 0)),
    lastPlayed: num(input.lastPlayed, 0),
    seenTutorial: input.seenTutorial === true,
    // Kept as loose strings on purpose: the wardrobe validates ids against the
    // live catalogue, so a save written before an item was renamed still loads.
    loadouts: sanitizeLoadouts(input.loadouts),
  };
}
