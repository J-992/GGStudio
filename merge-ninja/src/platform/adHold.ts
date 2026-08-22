import type Phaser from 'phaser';
import type { Sfx } from '../audio/Sfx';
import { subscribePlatformAudioMute } from './platform';

/**
 * Freezes the game while an ad is on screen.
 *
 * Poki's checklist is blunt about it: nothing may move and nothing may be
 * audible behind a break. Three things have to happen together, and none of
 * them is enough alone -- pausing the scene leaves the render loop burning
 * frames behind the ad, sleeping the loop leaves Phaser's own visibility
 * handler free to wake it back up mid-break, and both together still leave the
 * WebAudio bus playing the theme.
 *
 * The mute channel is the trigger because Poki fires it from `beforeAd`, the
 * last moment before the ad renders -- earlier and the game freezes against a
 * break that may never fill, later and the first frame of the ad lands over a
 * running game.
 *
 * Returns the unsubscribe, which also releases any hold still standing.
 */
export function attachAdHold(scene: Phaser.Scene, sfx: Sfx): () => void {
  let held = false;

  const release = (): void => {
    if (!held) return;
    held = false;
    sfx.setPlatformMuted(false);
    scene.game.loop.wake();
    if (scene.scene.isPaused(scene.scene.key)) scene.scene.resume(scene.scene.key);
  };

  const unsubscribe = subscribePlatformAudioMute((muted) => {
    if (muted === held) return;

    if (muted) {
      held = true;
      sfx.setPlatformMuted(true);
      scene.scene.pause(scene.scene.key);
      scene.game.loop.sleep();
      return;
    }

    release();
  });

  return () => { unsubscribe(); release(); };
}
