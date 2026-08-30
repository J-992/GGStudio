import type { PowerUpType } from './ChunkTypes';

/**
 * Single place to retune every power-up number - spawn rates, durations,
 * magnitudes. Nothing outside this file (and `PowerUpManager.ts`'s own
 * per-effect application code, which only ever *reads* these) should
 * contain a magic power-up number, mirroring how `PhysicsConfig.ts` is the
 * one place for movement tuning.
 */

export interface PowerUpTuning {
  /** Seconds the effect lasts once picked up. */
  readonly duration: number;
  /** Relative weight in the spawn-type roll - not a probability by itself. */
  readonly spawnWeight: number;
}

export const POWERUP_TUNING: Readonly<Record<PowerUpType, PowerUpTuning>> = {
  fishMagnet: { duration: 8, spawnWeight: 1 },
  // Bumped up (was 1) - was barely showing up in a run by player report.
  // Duration doubled (was 6) - the speed rush was over before the player got
  // much use out of it.
  catnipRush: { duration: 12, spawnWeight: 1.5 },
  nineLives: { duration: 0, spawnWeight: 0.6 }, // instant, not timed - see PowerUpManager
  // 30s window; one hit absorbed within it ends the effect early - see
  // PowerUpManager.consumeShield.
  shield: { duration: 30, spawnWeight: 0.8 },
};

/** Chance a non-reward chunk gets a power-up at all (0-1). Reward-section
 *  chunks bypass this and always get one - see ChunkGenerators/PowerUps. */
export const POWERUP_RANDOM_SPAWN_CHANCE = 0.05;

/** Fish Magnet: how far the pull reaches, in world units. */
export const FISH_MAGNET_RADIUS = 14;
/**
 * How fast a caught fish closes the distance, in world units per second.
 *
 * A speed, replacing a `lerp` fraction per second (3.5) that was neither
 * frame-rate independent nor ever actually *arriving*: an exponential
 * approach is quick at range and asymptotically slow up close, so coins
 * gathered into a cloud around the runner and then hung there, in the middle
 * of the screen, for the rest of the effect. See `Collectible.pullToward`,
 * which also explains the other half of that bug - the pull could not move
 * them vertically at all.
 *
 * Comfortably faster than the runner (`PHYSICS.runSpeed` peaks around 15, and
 * Catnip Rush takes it half again higher), because a magnet that is slower
 * than the thing it is attached to would trail coins behind the cat instead
 * of eating them. From the full {@link FISH_MAGNET_RADIUS} this is about
 * half a second, and much less for the ones already close.
 */
export const FISH_MAGNET_SPEED = 30;

/**
 * Catnip Rush: multiplies PHYSICS.runSpeed for the effect's duration.
 *
 * Raised from 1.35, which was a boost the player could miss. Part of that was
 * perceptual and is fixed elsewhere (the camera's speed-derived FOV expansion
 * is a ratio against `PHYSICS.runSpeed` - the very field this multiplies - so
 * it cancelled out and the rush was framed with the cruising lens; see
 * `Game`'s `CATNIP_FOV_BOOST`). The rest was simply that a third again is not
 * much when the difficulty ramp adds most of that over an ordinary run
 * anyway. Half again is felt, and the player can afford it: for the whole of
 * the effect they cannot be stopped by anything on the deck.
 */
export const CATNIP_SPEED_MULTIPLIER = 1.5;

/** Nine Lives: how many extra chances one pickup grants. */
export const NINE_LIVES_BONUS = 1;
/**
 * Hard cap on total lives, pickups included.
 *
 * A run starts on three (`LIVES_PER_RUN` in Game.ts) and Nine Lives can take
 * it to four - once. Every pickup after that is a no-op as far as the counter
 * goes, so a lucky spawn run cannot stack itself into an unloseable one, and
 * the HUD never has to draw more pips than fit beside the score.
 */
export const MAX_LIVES = 4;
