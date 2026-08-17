/**
 * What the player is shown about what is coming next.
 *
 * This replaced a line of red warning text on the wave-clear card. The text
 * was accurate and nobody read it: "Ranged throwers next!" tells a player who
 * has never seen a thrower nothing about what is about to start lobbing things
 * at them. `ThreatAlert` puts the actual model on screen instead, at the size
 * it will actually be, walking its own walk.
 *
 * The copy here is deliberately tiny — a name and a few words — because the
 * model is the description and anything longer competes with it. Counters are
 * bare catalog ids for the same reason: the part's own render is the pitch.
 */

import { getPartDef } from '../core/parts.ts';
import { EMP_SHIELD_LEAK_BY_LEVEL } from '../core/turretModules.ts';
import {
  bossEncounterName,
  bossForWave,
  type BossDefinition,
  type BossEncounter,
} from './zombies/bossConfig.ts';
import {
  modelFileFor,
  rigClipsFor,
  visualHeightMFor,
  type RigClips,
  type ZombieKind,
} from './zombies/Zombie.ts';
import { newThreatsForWave, type SpecialistZombieKind } from './waveBalance.ts';

/**
 * One row of the damage rule: how much of a hit actually lands, drawn as a bar.
 * `fraction` is the bar's own length, so the two rows are the argument — a
 * stubby red bar next to a full green one says "stop shooting it" faster than
 * any sentence can.
 */
export interface ThreatDamageBar {
  /** What is doing the hitting, two words at most. */
  readonly label: string;
  /** Why it lands or does not. */
  readonly detail: string;
  /** Share of the hit that reaches the zombie, 0..1. */
  readonly fraction: number;
  readonly tone: 'bad' | 'good';
}

/**
 * The "hit it with THIS, not THAT" block. Only threats whose whole trick is a
 * damage rule carry one — a zombie you beat by driving well does not need a
 * chart, and one that appears on every alert stops being read.
 */
export interface ThreatDamageRule {
  /** Imperative, shouted: the one instruction the player must leave with. */
  readonly headline: string;
  readonly bars: readonly ThreatDamageBar[];
  /** The mechanism in one line, under the bars. */
  readonly footnote: string;
}

/** One thing the alert puts on screen. */
export interface ThreatSubject {
  /** Stable id — the zombie kind, or the boss's own id. */
  readonly id: string;
  readonly name: string;
  /** Model file relative to `ZOMBIE_ASSET_ROOT`. */
  readonly modelFile: string;
  /** Rendered height in world metres, so the stage can size subjects against each other. */
  readonly heightM: number;
  /** Pose curves that drive the model, or null for an unrigged one. */
  readonly clips: RigClips | null;
  /**
   * Three or four words under the name. Not a description — the model is the
   * description — just the one thing that changes how you drive.
   */
  readonly tagline: string;
  /** Damage-rule chart for this kind, or null for the kinds that need none. */
  readonly rule: ThreatDamageRule | null;
}

export interface ThreatPreview {
  /** The wave being previewed — the one about to start, not the one just cleared. */
  readonly wave: number;
  readonly boss: boolean;
  /** Banner copy above the stage. */
  readonly headline: string;
  readonly subjects: readonly ThreatSubject[];
  /**
   * Catalog ids of parts worth having before this arrives. Rendered as their
   * real meshes, so an id the catalog has dropped shows nothing at all —
   * `assertThreatCountersExist` is the guard.
   */
  readonly counters: readonly string[];
}

interface SpecialistPreview {
  readonly name: string;
  readonly tagline: string;
  readonly counters: readonly string[];
  readonly rule?: ThreatDamageRule;
}

/**
 * The Phone Addict's bubble is the one mechanic in the game that punishes the
 * thing every player does by reflex — hold the trigger — so it gets the chart.
 *
 * Both numbers are read off the code that actually resolves the hit rather than
 * written down here: `ZombieSystem.hitZombieHandle` scales gun damage by
 * `empShieldLeak` and an un-upgraded turret sits at level 0, while melee and ram
 * damage never enter that branch at all — it goes through
 * `Zombie.applyVehicleImpact`, which the bubble does not touch. If either rule
 * changes, this chart changes with it instead of quietly starting to lie.
 */
const PHONE_ADDICT_RULE: ThreatDamageRule = {
  headline: 'RAM IT — DON’T SHOOT IT',
  bars: [
    {
      label: 'GUNS',
      detail: 'bubble eats the rest',
      fraction: EMP_SHIELD_LEAK_BY_LEVEL[0],
      tone: 'bad',
    },
    {
      label: 'BLADES & RAMMING',
      detail: 'bubble does nothing',
      fraction: 1,
      tone: 'good',
    },
  ],
  footnote:
    'The shield only stops bullets. Drive through it with a blade, spikes or ' +
    'the nose of your rig and it takes every point.',
};

/**
 * The pool index a preview model is requested at. Only the phone addict varies
 * its file by index (woman/man), and the preview wants one of them, not both.
 */
const PREVIEW_MODEL_INDEX = 0;

/** How many counters the alert shows. A boss earns a third; a specialist does not. */
const MAX_COUNTERS = 2;
const MAX_BOSS_COUNTERS = 3;

const SPECIALIST_PREVIEWS: Record<SpecialistZombieKind, SpecialistPreview> = {
  gunslinger: {
    name: 'Gunslinger',
    tagline: 'Shoots back',
    counters: ['sniper-light', 'armour-plate'],
  },
  necromancer: {
    name: 'Necromancer',
    tagline: 'Raises more of them',
    counters: ['sniper-light', 'missile-launcher'],
  },
  thrower: {
    name: 'Thrower',
    tagline: 'Throws from range',
    counters: ['drone-swarm', 'armour-plate'],
  },
  worker: {
    name: 'Worker',
    tagline: 'Buries mines',
    counters: ['tread-tank', 'armour-plate'],
  },
  'phone-addict': {
    name: 'Phone Addict',
    tagline: 'Shielded — bullets bounce',
    // Melee, not the turret it used to name: the gun is the wrong answer here
    // until the turret reaches the level-4 EMP Coil, and on this kind's debut
    // wave nobody has that yet. Both of these are on the shelf from wave 1.
    counters: ['sawblade', 'spike-ram'],
    rule: PHONE_ADDICT_RULE,
  },
  kamikaze: {
    name: 'Kamikaze',
    tagline: 'Explodes on contact',
    counters: ['sawblade', 'thumper'],
  },
  behemoth: {
    name: 'Behemoth',
    tagline: 'Slams the ground',
    counters: ['cannon-heavy', 'nitro-injector'],
  },
  zamboni: {
    name: 'Zamboni',
    tagline: 'Ices your grip away',
    counters: ['tread-tank', 'wheel-offroad'],
  },
};

/**
 * Per-boss loadouts and copy. Keyed by boss id rather than derived from the
 * kind, because an elite boss is an ordinary kind with boosted stats, and what
 * beats one of those at four times the health is not what beats the kind.
 */
const BOSS_BRIEFS: Record<
  string,
  { readonly tagline: string; readonly counters: readonly string[] }
> = {
  'behemoth-elite': {
    tagline: 'Stay out of the ring',
    counters: ['cannon-heavy', 'shield-generator', 'nitro-injector'],
  },
  'acid-alchemist': {
    tagline: 'It kites. It leaves acid.',
    counters: ['missile-launcher', 'tread-tank', 'nitro-injector'],
  },
};

function bossSubject(boss: BossEncounter): ThreatSubject {
  const definition: BossDefinition | null =
    boss.style === 'classic' ? boss.definition : null;
  const kind: ZombieKind = boss.style === 'classic' ? 'boss' : boss.elite.kind;
  const id = boss.style === 'classic' ? boss.definition.id : boss.elite.id;
  return {
    id,
    name: bossEncounterName(boss),
    modelFile: modelFileFor(kind, PREVIEW_MODEL_INDEX, definition),
    heightM: visualHeightMFor(kind, definition),
    clips: rigClipsFor(kind, definition),
    // A boss added to the rotation without a brief still gets an alert; it
    // just arrives without advice, which beats not arriving.
    tagline: BOSS_BRIEFS[id]?.tagline ?? '',
    rule: null,
  };
}

function specialistSubject(kind: SpecialistZombieKind): ThreatSubject {
  const preview = SPECIALIST_PREVIEWS[kind];
  return {
    id: kind,
    name: preview.name,
    modelFile: modelFileFor(kind, PREVIEW_MODEL_INDEX, null),
    heightM: visualHeightMFor(kind, null),
    clips: rigClipsFor(kind, null),
    tagline: preview.tagline,
    rule: preview.rule ?? null,
  };
}

/**
 * Dedupe counters across subjects while keeping first-seen order, so a wave
 * that introduces two kinds answered by the same plate does not recommend it
 * twice.
 */
function mergeCounters(
  kinds: readonly SpecialistZombieKind[],
  limit: number,
): string[] {
  const merged: string[] = [];
  // Round-robin rather than kind-by-kind: with two new kinds and room for two
  // tiles, one tile each beats both tiles going to whichever sorts first.
  for (let rank = 0; merged.length < limit; rank += 1) {
    let anyAtRank = false;
    for (const kind of kinds) {
      const partId = SPECIALIST_PREVIEWS[kind].counters[rank];
      if (partId === undefined) continue;
      anyAtRank = true;
      if (merged.includes(partId)) continue;
      merged.push(partId);
      if (merged.length >= limit) break;
    }
    if (!anyAtRank) break;
  }
  return merged;
}

/**
 * What to put on screen before `wave` starts, or null when the wave brings
 * nothing the player has not already met.
 *
 * A boss wave always alerts, every time the boss comes round — unlike a
 * specialist, which announces itself once. Seeing The Alchemist on wave 10 is
 * not why you want the warning on wave 20; the warning is what sends you to
 * the garage for the parts that beat it.
 */
export function threatPreviewForWave(wave: number): ThreatPreview | null {
  const boss = bossForWave(wave);
  if (boss) {
    const subject = bossSubject(boss);
    return {
      wave,
      boss: true,
      headline: 'BOSS INCOMING',
      subjects: [subject],
      counters: (BOSS_BRIEFS[subject.id]?.counters ?? []).slice(
        0,
        MAX_BOSS_COUNTERS,
      ),
    };
  }

  const kinds = newThreatsForWave(wave);
  if (kinds.length === 0) return null;
  return {
    wave,
    boss: false,
    headline: kinds.length > 1 ? 'NEW THREATS' : 'NEW THREAT',
    subjects: kinds.map(specialistSubject),
    counters: mergeCounters(kinds, MAX_COUNTERS),
  };
}

/**
 * Every part id a counter names, for the guard test. A counter pointing at a
 * renamed part is invisible in the alert — the tile just does not render — so
 * nothing but a test catches it.
 */
export function allCounterPartIds(): string[] {
  const ids = new Set<string>();
  for (const preview of Object.values(SPECIALIST_PREVIEWS)) {
    for (const partId of preview.counters) ids.add(partId);
  }
  for (const brief of Object.values(BOSS_BRIEFS)) {
    for (const partId of brief.counters) ids.add(partId);
  }
  return [...ids];
}

/** Throws if any counter names a part the catalog no longer has. */
export function assertThreatCountersExist(): void {
  for (const id of allCounterPartIds()) getPartDef(id);
}
