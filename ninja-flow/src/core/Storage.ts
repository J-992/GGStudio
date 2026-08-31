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
  /** Content version of the completed core lesson. */
  tutorialVersion: number;
  seenFlowTip: boolean;
  seenGuardTip: boolean;
  seenFeintTip: boolean;
  seenRareTip: boolean;
  /** Cosmetic loadout per character, keyed by slot. Validated by Cosmetics. */
  loadouts: Record<string, Record<string, string>>;
  /** Today's goals: the day it belongs to, progress per goal, and payouts made. */
  daily: { day: string; progress: Record<string, number>; claimed: string[] };
  /** Score of the previous finished run, chased on the HUD during the next one. */
  lastScore: number;
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
  tutorialVersion: 0,
  seenFlowTip: false,
  seenGuardTip: false,
  seenFeintTip: false,
  seenRareTip: false,
  loadouts: {},
  daily: { day: '', progress: {}, claimed: [] },
  lastScore: 0,
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
  // Saves written before tutorial versioning still remember that the original
  // lesson was completed, but receive the corrected lesson once.
  const legacyTutorialVersion = input.seenTutorial === true ? 1 : 0;
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
    tutorialVersion: Math.max(0, num(input.tutorialVersion, legacyTutorialVersion)),
    seenFlowTip: input.seenFlowTip === true,
    seenGuardTip: input.seenGuardTip === true,
    seenFeintTip: input.seenFeintTip === true,
    seenRareTip: input.seenRareTip === true,
    // Kept as loose strings on purpose: the wardrobe validates ids against the
    // live catalogue, so a save written before an item was renamed still loads.
    loadouts: sanitizeLoadouts(input.loadouts),
    daily: sanitizeDaily(input.daily),
    lastScore: Math.max(0, num(input.lastScore, 0)),
  };
}

/**
 * Daily progress is a plain bag of counters, so it is validated shape-first and
 * never trusted for its contents: the goal ids come from the date, and an entry
 * for a goal that is not in today's set is simply never read.
 */
function sanitizeDaily(input: unknown): SaveData['daily'] {
  if (!input || typeof input !== 'object') return { ...DEFAULTS.daily };
  const raw = input as Record<string, unknown>;
  const progress: Record<string, number> = {};
  if (raw.progress && typeof raw.progress === 'object') {
    for (const [k, v] of Object.entries(raw.progress as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) progress[k] = v;
    }
  }
  return {
    day: typeof raw.day === 'string' ? raw.day : '',
    progress,
    claimed: Array.isArray(raw.claimed)
      ? raw.claimed.filter((v): v is string => typeof v === 'string')
      : [],
  };
}
