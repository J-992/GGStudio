/**
 * What the crates scattered around the arena are worth.
 *
 * Every decision a drop makes — which kind spawns, how much cash it pays, which
 * block it hands over, which part of the rig a repair kit goes to — is a pure
 * function here so the balance can be read (and tested) without a physics
 * world. `Pickups` owns the crates themselves; `SurvivalMode` owns what
 * collecting one does to the run.
 */

import { PART_CATALOG } from '../core/parts.ts';

export type PickupKind =
  | 'fuel'
  | 'cash'
  | 'colossus'
  | 'part'
  | 'sentry'
  | 'repair';

export interface PickupKindSpec {
  readonly kind: PickupKind;
  /** Relative chance a spawning crate becomes this kind. */
  readonly weight: number;
  /** Beacon colour — the only thing that says what a crate is from a distance. */
  readonly color: number;
  /** Minimap marker colour for the same crate. */
  readonly minimapColor: string;
  /** The word over the crate's head, and its wording in the HUD receipt. */
  readonly label: string;
  /** Seconds before this slot offers something again after being taken. */
  readonly respawnSeconds: number;
}

/**
 * Fuel used to be every crate on the map; it is now one entry in the table and
 * the least likely of the common ones. Refuelling still has to be findable —
 * a dry tank is a dead run — so it keeps the largest single weight, but with
 * six kinds sharing the slots, roughly a quarter of what is out there is fuel
 * rather than all of it.
 */
export const PICKUP_KINDS: Record<PickupKind, PickupKindSpec> = {
  fuel: {
    kind: 'fuel',
    weight: 26,
    color: 0xff9a34,
    minimapColor: '#ff9a34',
    label: 'FUEL',
    respawnSeconds: 34,
  },
  cash: {
    kind: 'cash',
    weight: 22,
    color: 0xffd257,
    minimapColor: '#ffd257',
    label: 'CASH',
    respawnSeconds: 30,
  },
  repair: {
    kind: 'repair',
    weight: 18,
    color: 0x54e07a,
    minimapColor: '#54e07a',
    label: 'REPAIR',
    respawnSeconds: 40,
  },
  sentry: {
    kind: 'sentry',
    weight: 14,
    color: 0xf04a3c,
    minimapColor: '#f04a3c',
    label: 'SENTRY',
    respawnSeconds: 40,
  },
  colossus: {
    kind: 'colossus',
    weight: 10,
    color: 0x4fa8ff,
    minimapColor: '#4fa8ff',
    label: 'COLOSSUS',
    respawnSeconds: 50,
  },
  part: {
    kind: 'part',
    weight: 10,
    color: 0xc07dff,
    minimapColor: '#c07dff',
    label: 'SALVAGE',
    respawnSeconds: 55,
  },
};

const KIND_ORDER: readonly PickupKind[] = [
  'fuel',
  'cash',
  'repair',
  'sentry',
  'colossus',
  'part',
];

export const TOTAL_PICKUP_WEIGHT = KIND_ORDER.reduce(
  (total, kind) => total + PICKUP_KINDS[kind].weight,
  0,
);

/** Weighted pick over the table above. `random` returns 0..1. */
export function rollPickupKind(random: () => number): PickupKind {
  const roll = Math.min(0.999999, Math.max(0, random())) * TOTAL_PICKUP_WEIGHT;
  let cursor = 0;
  for (const kind of KIND_ORDER) {
    cursor += PICKUP_KINDS[kind].weight;
    if (roll < cursor) return kind;
  }
  return 'fuel';
}

/** Fraction of total tank capacity one fuel crate is worth. */
export const FUEL_REFILL_FRACTION = 0.5;

/** Seconds the Colossus buff runs from one crate. */
export const COLOSSUS_SECONDS = 12;
/** Visual (and felt) size multiplier while Colossus runs. */
export const COLOSSUS_SCALE = 2;
/** Outgoing ram and gun damage multiplier while Colossus runs. */
export const COLOSSUS_DAMAGE_MULTIPLIER = 2;
/** Incoming damage is divided by this while Colossus runs. */
export const COLOSSUS_TOUGHNESS = 2;
/** Drive torque and top speed multiplier — the price of being enormous. */
export const COLOSSUS_MOBILITY = 0.6;

/** Seconds a dropped sentry stands and fires before it burns out. */
export const SENTRY_SECONDS = 5;

/**
 * Cash a money crate pays. Roughly a tenth of a wave's clear bonus early on and
 * a real detour-worth by the late waves, so the crate keeps mattering without
 * ever out-earning the kills themselves.
 */
export function cashDropAmount(wave: number): number {
  const safeWave = Number.isFinite(wave) ? Math.max(1, Math.floor(wave)) : 1;
  return Math.min(250, 25 + safeWave * 10);
}

/**
 * Shelf price a salvage crate is allowed to hand over. It opens on the cheap
 * frames and wheels and widens with the run, so an early crate cannot drop a
 * part worth more than the wave that produced it.
 */
export function partDropBudget(wave: number): number {
  const safeWave = Number.isFinite(wave) ? Math.max(1, Math.floor(wave)) : 1;
  return Math.min(500, 40 + safeWave * 35);
}

/**
 * Every catalog block a salvage crate may contain, cheapest first. The root
 * chassis, one-per-rig blocks, Build signature blocks, and anything with no
 * shelf price are all excluded: they are either already on the rig or not
 * things the store hands out copies of.
 */
export function partDropPool(wave: number): string[] {
  const budget = partDropBudget(wave);
  return Object.values(PART_CATALOG)
    .filter(
      (def) =>
        def.cost > 0 &&
        def.cost <= budget &&
        def.unique !== true &&
        def.isRoot !== true &&
        def.buildSignature !== true,
    )
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))
    .map((def) => def.id);
}

/** Pick one block for a salvage crate, or null when the pool is somehow empty. */
export function rollPartDrop(random: () => number, wave: number): string | null {
  const pool = partDropPool(wave);
  if (pool.length === 0) return null;
  const index = Math.min(
    pool.length - 1,
    Math.floor(Math.max(0, random()) * pool.length),
  );
  return pool[index];
}

// Which block a repair crate spends itself on is decided in
// `src/core/repairKit.ts` and carried out by the Runtime Vehicle: runtime code
// cannot reach into survival, so the priority cannot live here.
