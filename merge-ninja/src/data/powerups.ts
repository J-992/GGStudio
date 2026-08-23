/**
 * Data-driven powerup definitions.
 *
 * Pure data plus the legacy pickup tuning it now owns -- no Phaser, no engine
 * imports, so the unit runner can read every number. The scene layer renders
 * these; this file only decides what exists, when it shows up, and how it
 * stacks. Every pickup references a dedicated low-density texture generated
 * for its silhouette, keeping the drifting token and HUD chip easy to read.
 * The compact standalone art is loaded directly by BootScene.
 */

import { bossForStage } from './enemies';

/** Every powerup id. Kept a closed union so lookups stay exhaustive. */
export type PowerupId =
  | 'shurikenFrenzy'
  | 'smokeBomb'
  | 'luckyCharm'
  | 'protectiveWard'
  | 'coinFrenzy';

/** How a repeat activation interacts with an effect already running. */
export type StackPolicy = 'refresh' | 'extend' | 'charges' | 'instant';

interface PowerupBase {
  /** Stable id; also the spawn/collect event key. */
  readonly id: PowerupId;
  /** UPPERCASE-safe banner text; renderers may lowercase but never widen it. */
  readonly label: string;
  /** Standalone texture loaded by BootScene. Dedicated art keeps pickups legible. */
  readonly iconTexture: string;
  /** Path relative to the public root. */
  readonly iconPath: string;
  /**
   * Spawn rhythm in visible-play milliseconds. First spawns are staggered so
   * early minutes never offer two pickups at once; afterwards the gap is
   * rolled uniform in [minGapMs, maxGapMs].
   */
  readonly cadence: {
    readonly firstSpawnMs: number;
    readonly minGapMs: number;
    readonly maxGapMs: number;
    /** Optional offer roll; omitted means every due window produces a pickup. */
    readonly spawnChance?: number;
  };
  /** Drift-across-the-arena lifetime, mirroring the potion/clock lanes. */
  readonly travelMs: number;
  /** Generous tap radius in layout pixels; these are moving targets. */
  readonly tapRadiusPx: number;
  readonly stack: StackPolicy;
  /** Ceiling on concurrently stacked instances of this one powerup. */
  readonly maxActiveOfSame: number;
  /** HUD chip/banner accent colour (0xRRGGBB). */
  readonly hudColor: number;
}

export type PowerupDef = PowerupBase &
  (
    | { readonly effect: 'dpsMultiplier'; readonly factor: number; readonly durationMs: number }
    | { readonly effect: 'bossAttacksPaused'; readonly durationMs: number }
    | { readonly effect: 'coinMultiplier'; readonly factor: number; readonly durationMs: number }
    | { readonly effect: 'ward'; readonly charges: number }
    | { readonly effect: 'coinRain'; readonly coinCount: number; readonly bossRewardDivisor: number }
  );

/** Iteration/poll order; also the tie-break when several spawns come due together. */
export const POWERUP_ORDER: readonly PowerupId[] = [
  'shurikenFrenzy',
  'smokeBomb',
  'luckyCharm',
  'protectiveWard',
  'coinFrenzy',
];

export const POWERUPS: Readonly<Record<PowerupId, PowerupDef>> = {
  shurikenFrenzy: {
    id: 'shurikenFrenzy',
    label: 'SHURIKEN FRENZY',
    iconTexture: 'powerup_shuriken_frenzy',
    iconPath: 'assets/powerups/shuriken-frenzy.webp',
    effect: 'dpsMultiplier',
    factor: 2,
    durationMs: 12_000,
    cadence: { firstSpawnMs: 90_000, minGapMs: 80_000, maxGapMs: 160_000 },
    travelMs: 11_500,
    tapRadiusPx: 62,
    stack: 'refresh',
    maxActiveOfSame: 1,
    hudColor: 0xff6b57,
  },
  smokeBomb: {
    id: 'smokeBomb',
    label: 'SMOKE BOMB',
    iconTexture: 'powerup_smoke_bomb',
    iconPath: 'assets/powerups/smoke-bomb.webp',
    effect: 'bossAttacksPaused',
    durationMs: 7_000,
    cadence: { firstSpawnMs: 150_000, minGapMs: 120_000, maxGapMs: 220_000 },
    travelMs: 12_000,
    tapRadiusPx: 66,
    stack: 'refresh',
    maxActiveOfSame: 1,
    hudColor: 0x8fd8ff,
  },
  luckyCharm: {
    id: 'luckyCharm',
    label: 'LUCKY CHARM',
    iconTexture: 'powerup_lucky_charm',
    iconPath: 'assets/powerups/lucky-charm.webp',
    effect: 'coinMultiplier',
    factor: 2,
    durationMs: 18_000,
    cadence: { firstSpawnMs: 210_000, minGapMs: 150_000, maxGapMs: 260_000 },
    travelMs: 12_000,
    tapRadiusPx: 62,
    stack: 'extend',
    maxActiveOfSame: 1,
    hudColor: 0xffc63f,
  },
  protectiveWard: {
    id: 'protectiveWard',
    label: 'PROTECTIVE WARD',
    iconTexture: 'powerup_protective_ward',
    iconPath: 'assets/powerups/protective-ward.webp',
    effect: 'ward',
    charges: 3,
    cadence: { firstSpawnMs: 270_000, minGapMs: 180_000, maxGapMs: 300_000 },
    travelMs: 12_500,
    tapRadiusPx: 70,
    stack: 'charges',
    maxActiveOfSame: 1,
    hudColor: 0x7dff9e,
  },
  coinFrenzy: {
    id: 'coinFrenzy',
    label: 'COIN FRENZY',
    iconTexture: 'powerup_coin_frenzy',
    iconPath: 'assets/powerups/coin-frenzy.webp',
    effect: 'coinRain',
    coinCount: 36,
    // A perfect clear pays roughly six current-stage boss bonuses; because
    // coins can fall away, normal clears land below that headline payout.
    bossRewardDivisor: 6,
    // One eligibility check at five minutes, then widely spaced retries. The
    // 18% offer roll makes this a memorable surprise, not a run fixture.
    cadence: {
      firstSpawnMs: 300_000,
      minGapMs: 360_000,
      maxGapMs: 600_000,
      spawnChance: 0.18,
    },
    travelMs: 14_000,
    tapRadiusPx: 70,
    stack: 'instant',
    maxActiveOfSame: 1,
    hudColor: 0xffd23f,
  },
};

/**
 * Freeze one rain coin's value when the frenzy starts.
 *
 * Tying the payout to the canonical boss reward curve makes it rise with the
 * stage without inventing a second exponential. A full 36-coin clear is worth
 * about six boss bonuses at every stage, while missed coins pay nothing.
 */
export function coinFrenzyCoinValue(stage: number): number {
  const def = POWERUPS.coinFrenzy;
  if (def.effect !== 'coinRain') throw new Error('coinFrenzy must use the coinRain effect');
  return Math.max(1, Math.round(bossForStage(stage).reward / def.bossRewardDivisor));
}

/**
 * The original drifting pickups expressed in the same vocabulary as the
 * powerups above. `src/data/pickups.ts` re-exports the potion block and
 * `src/ui/TimeClock.ts` still owns its widget-local constants; both now read
 * from here so balance edits land in exactly one file.
 */
export const LEGACY_PICKUP_TUNING = {
  potion: {
    healRatio: 0.22,
    firstSpawnMs: 22_000,
    minGapMs: 34_000,
    maxGapMs: 62_000,
    urgentBelowRatio: 0.4,
    urgentMinGapMs: 12_000,
    urgentMaxGapMs: 22_000,
    travelMs: 12_500,
    bobPixels: 38,
    bobMs: 2_050,
  },
  clock: {
    multiplier: 10,
    boostMs: 10_000,
    firstSpawnMs: 45_000,
    minGapMs: 80_000,
    maxGapMs: 165_000,
    travelMs: 11_000,
    bobPixels: 46,
    bobMs: 2_300,
  },
} as const;
