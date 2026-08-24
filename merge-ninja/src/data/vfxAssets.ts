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

/**
 * What to draw for an effect whose strip has not arrived yet.
 *
 * The strips are 398 KB and the game used to wait for all of them before its
 * first frame, for effects that first fire a second or two into play. They now
 * stream in at the head of the deferred queue, which leaves a brief window
 * where an effect can be asked for before its animation exists.
 *
 * Every entry here is a frame already inside the packed atlas, which is always
 * loaded -- so the effect still happens, still in the right place and the right
 * colour, just as a single frame instead of an eight-frame cycle. That is the
 * same trade the roster portraits make in `render/portraitTexture.ts`.
 */
export const VFX_STANDIN_FRAME: Readonly<Record<VfxAnimationId, string>> = {
  slash: 'fx_slash',
  smoke: 'fx_puff',
  shockwave: 'fx_ring',
  portal: 'vfx_portal',
  flame: 'vfx_flame',
  lightning: 'vfx_bolt_a',
  merge: 'fx_spark',
};
