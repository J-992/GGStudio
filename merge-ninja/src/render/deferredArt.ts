import Phaser from 'phaser';
import { deferredPortraits, deferredThemeArt } from './loadPlan';
import { readResumePoint } from './resumePoint';
import { VFX_ANIMATION_ORDER, VFX_ANIMATIONS } from '../data/vfxAssets';

/**
 * Streams the art the first frame did not wait for.
 *
 * This runs on its own loader after the game is already playable, so a slow
 * connection costs the player nothing but fidelity, and only briefly -- see
 * `portraitTexture.ts` for what is drawn in the meantime.
 *
 * Two things matter about how it is done:
 *
 * Order. Files go out in the order the player will reach them, so the stream is
 * always running ahead of play rather than racing it. `loadPlan.ts` owns that
 * ordering and explains it.
 *
 * Batching. The whole tail is not handed to Phaser at once. Phaser's loader
 * opens as many parallel requests as it is given work for, and a hundred of
 * them will saturate a phone's connection and compete with nothing -- except
 * that decoding each arriving image happens on the main thread, which is the
 * thread drawing the game. Loading in small batches keeps that decode work in
 * slices short enough to disappear between frames.
 */

/** Emitted on the scene when a batch lands and sprites should re-read their art. */
export const DEFERRED_ART_BATCH = 'merge-ninja:deferred-art-batch';

/** Files per batch. Small enough that decoding a batch fits inside a frame budget. */
const BATCH_SIZE = 6;

/** Idle gap between batches, so the stream yields to gameplay rather than fighting it. */
const BATCH_GAP_MS = 120;

type Queued = (loader: Phaser.Loader.LoaderPlugin) => void;

function queueForScene(scene: Phaser.Scene): Queued[] {
  const jobs: Queued[] = [];
  const resume = readResumePoint();

  // The effect strips go first, and by a wide margin. They are 398 KB, which is
  // why they are no longer worth blocking the first frame on, but the first
  // merge and the first attack are only a second or two away -- so they lead
  // the queue rather than taking their turn behind art for stage forty.
  for (const id of VFX_ANIMATION_ORDER) {
    const effect = VFX_ANIMATIONS[id];
    if (scene.textures.exists(effect.textureKey)) continue;
    jobs.push((loader) => {
      loader.spritesheet(effect.textureKey, effect.path, {
        frameWidth: effect.frameWidth,
        frameHeight: effect.frameHeight,
        endFrame: effect.frames - 1,
      });
    });
  }

  for (const portrait of deferredPortraits(resume)) {
    if (scene.textures.exists(portrait.textureKey)) continue;
    jobs.push((loader) => {
      if (portrait.animation !== undefined) {
        loader.spritesheet(portrait.textureKey, portrait.texturePath, portrait.animation);
      } else {
        loader.image(portrait.textureKey, portrait.texturePath);
      }
    });
  }

  for (const art of deferredThemeArt(resume)) {
    if (scene.textures.exists(art.key)) continue;
    jobs.push((loader) => loader.image(art.key, art.path));
  }

  return jobs;
}

/**
 * Starts the background stream. Safe to call more than once: anything already
 * loaded is skipped, so a scene restart re-queues only what is genuinely missing.
 */
export function streamDeferredArt(scene: Phaser.Scene): void {
  const jobs = queueForScene(scene);
  if (jobs.length === 0) return;

  let index = 0;

  const runBatch = (): void => {
    // The scene can be torn down mid-stream -- a restart, or the tab going away
    // -- and a loader firing into a dead scene throws inside Phaser's own code.
    if (!scene.scene.isActive() && !scene.scene.isPaused()) return;

    // The scene's own loader, not a fresh LoaderPlugin. A hand-constructed one
    // is never wired to the scene's texture manager or its update loop, so it
    // accepts files, reports COMPLETE, and fetches nothing -- failing silently
    // in exactly the way that looks like the feature working.
    const loader = scene.load;
    const batch = jobs.slice(index, index + BATCH_SIZE);
    index += batch.length;
    for (const job of batch) job(loader);

    loader.once(Phaser.Loader.Events.COMPLETE, () => {
      buildDeferredAnimations(scene);
      scene.events.emit(DEFERRED_ART_BATCH);
      if (index < jobs.length) scene.time.delayedCall(BATCH_GAP_MS, runBatch);
    });

    loader.start();
  };

  // Straight into the first batch rather than waiting out a gap: that batch is
  // now the effect strips, and every frame it is delayed is a frame the game
  // might have to draw a merge with a stand-in.
  runBatch();
}

/**
 * Builds animations for any VFX strip that has arrived since the last batch.
 *
 * BootScene does this for the strips it loads; deferred strips need the same
 * treatment or the texture exists with no animation to play against it.
 */
function buildDeferredAnimations(scene: Phaser.Scene): void {
  for (const id of VFX_ANIMATION_ORDER) {
    const effect = VFX_ANIMATIONS[id];
    if (scene.anims.exists(effect.animationKey)) continue;
    if (!scene.textures.exists(effect.textureKey)) continue;
    scene.anims.create({
      key: effect.animationKey,
      frames: scene.anims.generateFrameNumbers(effect.textureKey, {
        start: 0,
        end: effect.frames - 1,
      }),
      frameRate: effect.frameRate,
      repeat: 0,
    });
  }
}
