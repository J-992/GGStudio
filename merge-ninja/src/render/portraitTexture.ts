import type Phaser from 'phaser';
import { ATLAS_KEY } from './atlasConfig';

/**
 * What to actually draw for a roster or boss entry right now.
 *
 * Most catalog art is streamed in after the game has already started, so at any
 * given moment a tier's real portrait may not have arrived yet. Asking Phaser
 * for a texture that is not loaded does not throw -- it silently draws the
 * green missing-texture box, which in this game would appear in the middle of a
 * fight.
 *
 * Every roster and boss entry already carries `spriteKey`, a frame inside the
 * packed atlas, and the atlas is a boot asset that is always present. That
 * frame is a lower-fidelity version of the same character, which makes it the
 * right thing to show for the fraction of a second before the portrait lands --
 * far better than a placeholder, and better than blocking the whole game on art
 * for a boss thirty stages away.
 *
 * `ArenaManager` refreshes its sprites when a deferred batch arrives, so a
 * substitution never persists past the load that caused it.
 */
export interface PortraitTexture {
  readonly key: string;
  /** Set only when drawing from the atlas; portraits are whole textures. */
  readonly frame?: string;
  /** False while substituting: the atlas frame is a single static pose. */
  readonly animated: boolean;
  /** Zero while substituting: the inset is measured against the real art. */
  readonly footInset: number;
}

interface Drawable {
  readonly textureKey: string;
  readonly spriteKey: string;
}

interface Portrait {
  readonly footInset: number;
  readonly animation?: unknown;
}

export function portraitTexture(
  scene: Phaser.Scene,
  def: Drawable,
  portrait: Portrait | undefined,
): PortraitTexture {
  if (scene.textures.exists(def.textureKey)) {
    return {
      key: def.textureKey,
      animated: portrait?.animation !== undefined,
      footInset: portrait?.footInset ?? 0,
    };
  }
  return { key: ATLAS_KEY, frame: def.spriteKey, animated: false, footInset: 0 };
}
