/**
 * Authored animated VFX strips.
 *
 * Every strip is eight 256px square frames packed left-to-right. Keeping the
 * loading and animation names here gives the arena, merge, reward and reveal
 * presenters one source of truth instead of letting each invent timing.
 */

export type VfxAnimationId =
  | 'slash'
  | 'smoke'
  | 'shockwave'
  | 'portal'
  | 'flame'
  | 'lightning'
  | 'merge';

export interface VfxAnimationDef {
  readonly id: VfxAnimationId;
  readonly textureKey: string;
  readonly animationKey: string;
  readonly path: string;
  readonly frameWidth: 256;
  readonly frameHeight: 256;
  readonly frames: 8;
  readonly frameRate: number;
}

const strip = (
  id: VfxAnimationId,
  frameRate: number,
): VfxAnimationDef => ({
  id,
  textureKey: `vfx_${id}_strip`,
  animationKey: `vfx_${id}_play`,
  path: `assets/vfx/vfx-${id}.webp`,
  frameWidth: 256,
  frameHeight: 256,
  frames: 8,
  frameRate,
});

export const VFX_ANIMATION_ORDER: readonly VfxAnimationId[] = [
  'slash',
  'smoke',
  'shockwave',
  'portal',
  'flame',
  'lightning',
  'merge',
];

export const VFX_ANIMATIONS: Readonly<
  Record<VfxAnimationId, VfxAnimationDef>
> = {
  slash: strip('slash', 30),
  smoke: strip('smoke', 18),
  shockwave: strip('shockwave', 24),
  portal: strip('portal', 16),
  flame: strip('flame', 20),
  lightning: strip('lightning', 28),
  merge: strip('merge', 22),
};

/** Nominal playback time; presenters may fade or travel over the same window. */
export function vfxDurationMs(id: VfxAnimationId): number {
  const def = VFX_ANIMATIONS[id];
  return Math.round((def.frames / def.frameRate) * 1_000);
}
