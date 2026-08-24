import type Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import {
  VFX_ANIMATIONS,
  VFX_STANDIN_FRAME,
  type VfxAnimationId,
} from '../data/vfxAssets';

type VfxSource = { texture: string; frame: string | number; animation?: string };

/**
 * VFX strips stream after the opening frame. Presenters must never hand
 * Phaser a not-yet-loaded texture (which renders as its black/green missing
 * texture marker); use the packed-atlas stand-in until the animation exists.
 */
export function vfxSource(scene: Phaser.Scene, id: VfxAnimationId): VfxSource {
  const def = VFX_ANIMATIONS[id];
  if (scene.textures.exists(def.textureKey) && scene.anims.exists(def.animationKey)) {
    return { texture: def.textureKey, frame: 0, animation: def.animationKey };
  }
  return { texture: ATLAS_KEY, frame: VFX_STANDIN_FRAME[id] };
}

/** Selects the safest current VFX art and starts it only when it is animated. */
export function playVfx(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite, id: VfxAnimationId): void {
  const source = vfxSource(scene, id);
  sprite.stop().setTexture(source.texture, source.frame);
  if (source.animation !== undefined) sprite.play(source.animation);
}
