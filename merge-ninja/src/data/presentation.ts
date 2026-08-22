import { BOSS_COUNT } from './enemies';

/**
 * Presentation arithmetic that has to be right but does not need Phaser.
 *
 * Both of these were bugs the eye caught before any test did -- bosses that
 * read as smaller than the ninjas fighting them, and an almanac that only ever
 * showed its first page -- so the maths lives here where the unit suite can
 * hold it still.
 */

export interface Box {
  w: number;
  h: number;
}

/** One pose in a supplied-character, four-frame transform animation. */
export interface FourFramePose {
  /** How long this pose is held before progressing to the next one. */
  duration: number;
  /** Horizontal offset in art pixels. Positive means toward the target. */
  x: number;
  /** Vertical offset in art pixels. Negative lifts the fighter. */
  y: number;
  angle: number;
  scaleX: number;
  scaleY: number;
}

/** Fixed-length by design: the game uses a readable pixel-animation cadence. */
export type FourFrameAnimation = readonly [
  FourFramePose,
  FourFramePose,
  FourFramePose,
  FourFramePose,
];

const pose = (
  duration: number,
  x: number,
  y: number,
  angle: number,
  scaleX = 1,
  scaleY = 1,
): FourFramePose => ({ duration, x, y, angle, scaleX, scaleY });

/**
 * Guard → first weapon raise → counter-swing → recovery timing for the real
 * ninja strips. Movement is inside the source frames, so every transform stays
 * neutral and can never slide or tilt the full character body.
 */
export const NINJA_IDLE_FOUR_FRAME: FourFrameAnimation = [
  pose(260, 0, 0, 0),
  pose(170, 0, 0, 0),
  pose(170, 0, 0, 0),
  pose(240, 0, 0, 0),
];

/**
 * The accepted Flame Shogun strip has its own katana/aura poses. This only
 * supplies cadence while its source frames advance 0 → 1 → 2 → 3.
 */
export const FLAME_SHOGUN_IDLE_FOUR_FRAME: FourFrameAnimation = [
  pose(260, 0, 0, 0),
  pose(180, 0, 0, 0),
  pose(180, 0, 0, 0),
  pose(250, 0, 0, 0),
];

/** Wind-up → high guard → basic strike → recovery. */
export const NINJA_BASIC_FOUR_FRAME: FourFrameAnimation = [
  pose(105, -7, 5, 8, .97, 1.04),
  pose(120, -3, -7, 12, 1.04, .94),
  pose(90, 29, -10, -18, 1.10, .94),
  pose(230, 4, -2, -3, 1.01, .99),
];

/** Wind-up → charged guard → long special strike → recovery. */
export const NINJA_SPECIAL_FOUR_FRAME: FourFrameAnimation = [
  pose(130, -12, 8, 12, .94, 1.08),
  pose(145, -6, -13, 18, 1.08, .90),
  pose(120, 43, -17, -24, 1.17, .90),
  pose(280, 6, -3, -4, 1.02, .985),
];

/** A larger humanoid boss mirrors the same readable ready cycle. */
export const HUMANOID_BOSS_IDLE_FOUR_FRAME: FourFrameAnimation = [
  pose(270, 0, 0, 0),
  pose(165, -8, -6, 9, 1.045, .945),
  pose(120, 18, -12, -15, 1.10, .92),
  pose(270, 5, -2, -4, 1.02, .99),
];

/** Wind-up → high guard → basic counter → recovery for humanoid bosses. */
export const HUMANOID_BOSS_BASIC_FOUR_FRAME: FourFrameAnimation = [
  pose(120, -10, 8, 4, .97, 1.04),
  pose(125, -12, -8, 9, 1.05, .93),
  pose(100, 44, -10, -10, 1.11, .93),
  pose(245, 8, -2, -2, 1.01, .99),
];

/** Wind-up → charged guard → long special counter → recovery. */
export const HUMANOID_BOSS_SPECIAL_FOUR_FRAME: FourFrameAnimation = [
  pose(145, -15, 10, 6, .94, 1.08),
  pose(150, -18, -14, 13, 1.10, .89),
  pose(125, 70, -18, -14, 1.20, .88),
  pose(300, 10, -3, -3, 1.02, .985),
];

/** Resolves the active discrete pose in a looping four-frame animation. */
export function fourFramePoseAt(animation: FourFrameAnimation, elapsedMs: number): { index: number; pose: FourFramePose } {
  const total = animation.reduce((sum, frame) => sum + frame.duration, 0);
  let remaining = ((Math.max(0, elapsedMs) % total) + total) % total;
  for (let index = 0; index < animation.length; index += 1) {
    const frame = animation[index]!;
    if (remaining < frame.duration) return { index, pose: frame };
    remaining -= frame.duration;
  }
  return { index: animation.length - 1, pose: animation[animation.length - 1]! };
}

/**
 * The board and arena share this clock-driven resolver. Keeping it free of
 * tween lifecycle means a resize or roster reconcile cannot restart a strip
 * at its guard frame and make the animation appear frozen.
 */
export function ninjaIdleFrameAt(
  elapsedMs: number,
  phaseOffsetMs: number,
  flameShogun: boolean,
): number {
  return fourFramePoseAt(
    flameShogun ? FLAME_SHOGUN_IDLE_FOUR_FRAME : NINJA_IDLE_FOUR_FRAME,
    elapsedMs + phaseOffsetMs,
  ).index;
}

/**
 * Idle motion language for a boss silhouette.
 *
 * Fifteen creature identities carry authored eight-frame strips. The remaining
 * humanoid portraits still receive a small, bounded transform vocabulary
 * shaped by their body and fighting style.
 */
export type BossIdleFamily = 'breathe' | 'serpent' | 'winged' | 'brute' | 'spirit' | 'humanoid';

/** How a boss goes down before the reward burst takes over. */
export type BossDefeatStyle = 'collapse' | 'dissolve' | 'topple';

export interface BossMotionRecipe {
  /** Which transform vocabulary the idle loop speaks. */
  idleFamily: BossIdleFamily;
  /** Length of one full idle cycle. Bounds: 900-4800 ms. */
  idlePeriodMs: number;
  /**
   * Depth of the idle pump, as a share of the drawn height: half of it is a
   * vertical bob, half a matching scale breathe. Bounds: 0.004-0.06.
   */
  breatheAmount: number;
  /** Peak lean either side of upright, in degrees. Bounds: 0-6. */
  swayDegrees: number;
  /** Attack anticipation hold before the lunge commits. Bounds: 50-300 ms. */
  attackWindupMs: number;
  /** How far the attack lunge reaches toward the player line, in px. Bounds: 8-56. */
  attackLungePx: number;
  /** Knockback nudge per landed hit, in px. Bounds: 2-24. */
  hitRecoilPx: number;
  defeatStyle: BossDefeatStyle;
}

const motion = (
  idleFamily: BossIdleFamily,
  idlePeriodMs: number,
  breatheAmount: number,
  swayDegrees: number,
  attackWindupMs: number,
  attackLungePx: number,
  hitRecoilPx: number,
  defeatStyle: BossDefeatStyle,
): BossMotionRecipe => Object.freeze({ idleFamily, idlePeriodMs, breatheAmount, swayDegrees, attackWindupMs, attackLungePx, hitRecoilPx, defeatStyle });

/** Upright sword-and-staff fighters: the readable ready cycle, barely moving. */
const HUMANOID_DUELIST = motion('humanoid', 2400, .016, 1.2, 130, 34, 7, 'collapse');
/** Blade-first humanoids: lighter on their feet, quicker to commit. */
const HUMANOID_ASSASSIN = motion('humanoid', 1750, .012, 1.6, 85, 42, 5, 'collapse');
/** Stocky heavies: a slow squash-breathe, hits like a sack of gear. */
const BRUTE_SQUASH = motion('brute', 2000, .05, .8, 185, 24, 6, 'collapse');
/** Colossi and bears: the heaviest body in the game earns the heaviest heave. */
const COLOSSUS_HEAVE = motion('brute', 2900, .06, .6, 260, 20, 10, 'topple');
/** Wisps, reapers and foxfire: they hover, they never quite touch ground. */
const SPIRIT_HOVER = motion('spirit', 3100, .02, 2.4, 120, 14, 3, 'dissolve');
/** Winged fighters: a quick wing-bob with a restless lean. */
const WINGED_FLAP = motion('winged', 1450, .024, 2.8, 95, 38, 6, 'topple');
/** Serpents, leviathans and many-legged things: long S-sways, far reach. */
const SERPENT_COIL = motion('serpent', 3400, .032, 4.6, 220, 46, 9, 'collapse');
/** Quadrupeds and hoppers: animal pant cadence, short explosive lunges. */
const BEAST_PANT = motion('breathe', 1250, .042, 1.4, 75, 30, 8, 'topple');

const IDENTITY_MOTION: readonly BossMotionRecipe[] = [
  // Chronofog .. Masked Signal: first-act humanoid ladder.
  HUMANOID_DUELIST, HUMANOID_DUELIST, HUMANOID_DUELIST, HUMANOID_DUELIST, HUMANOID_ASSASSIN, HUMANOID_ASSASSIN,
  // Ironfist .. Chain Sickle.
  HUMANOID_DUELIST, BRUTE_SQUASH, BRUTE_SQUASH, HUMANOID_ASSASSIN,
  // Reaper .. Goldwing: spirits and one fencer with wings.
  SPIRIT_HOVER, SPIRIT_HOVER, SPIRIT_HOVER, BRUTE_SQUASH, WINGED_FLAP,
  // Cinderblade .. Frostbound Warhawk.
  HUMANOID_DUELIST, SERPENT_COIL, SPIRIT_HOVER, HUMANOID_DUELIST, WINGED_FLAP,
  // Thornroot .. Thornscale: creatures take over.
  COLOSSUS_HEAVE, BEAST_PANT, BRUTE_SQUASH, SERPENT_COIL, SPIRIT_HOVER, BEAST_PANT,
  // Stonefist Bear Chief .. Molten Dragon-Wolf Fusion.
  COLOSSUS_HEAVE, WINGED_FLAP, BEAST_PANT, SPIRIT_HOVER, SERPENT_COIL, COLOSSUS_HEAVE,
  SERPENT_COIL, SERPENT_COIL, WINGED_FLAP, SERPENT_COIL, WINGED_FLAP,
];

if (IDENTITY_MOTION.length !== BOSS_COUNT) {
  throw new Error('Every boss identity must map to a motion recipe');
}

/** Hand-tuned per-identity flavor where the family default is not enough. */
const MOTION_OVERRIDES: Record<number, Partial<BossMotionRecipe>> = {
  14: { idlePeriodMs: 1250, swayDegrees: 2.2, attackLungePx: 28 }, // Goldwing Duelist fences light
  16: { idlePeriodMs: 3800 }, // Abyssal Tentacle Ronin coils slow
  19: { idlePeriodMs: 1050, swayDegrees: 3.4 }, // Frostbound Warhawk flaps quick
  23: { attackLungePx: 52 }, // Tide Crown Leviathan surges far
  29: { defeatStyle: 'dissolve', swayDegrees: 3 }, // Kitsune burns out as foxfire
  30: { idlePeriodMs: 2600 }, // Fused Spider creeps rather than sways
  32: { defeatStyle: 'dissolve', swayDegrees: 5.4 }, // Shadow dragon unravels into smoke
  35: { idlePeriodMs: 3800, swayDegrees: 5.6, attackLungePx: 54 }, // Hydra has the widest sweep
  36: { idlePeriodMs: 1350, defeatStyle: 'topple' }, // Molten wolf-dragon moves angry
};

/** Fallback so an unexpected id still gets a legal, gentle recipe. */
const DEFAULT_MOTION = HUMANOID_DUELIST;

/** Deterministic: the same identity always resolves to the same recipe. */
export function bossMotionForIdentity(identity: number): BossMotionRecipe {
  if (!Number.isFinite(identity)) return DEFAULT_MOTION;
  const safe = ((Math.floor(identity) % BOSS_COUNT) + BOSS_COUNT) % BOSS_COUNT;
  const base = IDENTITY_MOTION[safe]!;
  const override = MOTION_OVERRIDES[safe];
  return override === undefined ? base : Object.freeze({ ...base, ...override });
}

/**
 * Characters are normalised on height: the roster art is all upright, so the
 * width plays no part -- it is taken only to mirror `bossScale`'s shape at the
 * call sites and in the tests that compare the two.
 */
export function ninjaScale(_frameWidth: number, frameHeight: number, targetHeight: number): number {
  return targetHeight / Math.max(1, frameHeight);
}

/**
 * How big a boss draws, given the stage it has to fit inside.
 *
 * Scaling a boss on height alone is what made the squat, wide portraits (a
 * coiled dragon, a low hydra) look *smaller* than the ninjas attacking them:
 * their height is mostly the only small dimension they have. Normalising on the
 * geometric mean of the frame instead means "presence" is about how much of the
 * stage the art covers, so every boss reads as the same weight class whatever
 * its silhouette. The arena still gets the last word, so nothing outgrows it.
 */
export function bossScale(frameWidth: number, frameHeight: number, presence: number, arena: Box): number {
  const width = Math.max(1, frameWidth);
  const height = Math.max(1, frameHeight);
  const mean = Math.sqrt(width * height);
  return Math.min(
    presence / mean,
    (arena.h * 0.62) / height,
    (arena.w * 0.52) / width,
  );
}

/** How many pages the almanac needs to show both lists in full. */
export function almanacPageCount(ninjaCount: number, bossCount: number, perSection: number): number {
  const longest = Math.max(0, ninjaCount, bossCount);
  return Math.max(1, Math.ceil(longest / Math.max(1, perSection)));
}

/**
 * The half-open range of one list shown on a page.
 *
 * The two lists are different lengths, so the shorter one simply runs out and
 * leaves its half of the spread empty rather than wrapping back to its start.
 */
export function almanacPageSlice(count: number, page: number, perSection: number): { start: number; end: number } {
  const size = Math.max(1, perSection);
  const start = Math.min(Math.max(0, count), Math.max(0, page) * size);
  return { start, end: Math.min(count, start + size) };
}
