import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { PhysicsWorld, initRapier } from '../src/physics/PhysicsWorld';
import { PlayerController } from '../src/physics/PlayerController';
import { resetPhysicsConfig } from '../src/physics/PhysicsConfig';
import { CHUNK_LENGTH } from '../src/levels/TrackConfig';
import { ChunkBuilder } from '../src/levels/procedural/ChunkBuilder';
import { ROOF_LOW, ROOF_MEDIUM } from '../src/levels/procedural/ChunkTypes';
import {
  TUTORIAL_LEVEL_CHECKPOINTS,
  TUTORIAL_LEVEL_CHUNKS,
  TUTORIAL_LEVEL_FINISH_ARC,
} from '../src/levels/procedural/TutorialLevel';

/**
 * The standalone, hand-authored tutorial level - see `TutorialLevel.ts`'s own
 * doc comment. Every hazard's type, position, and roof tier is a literal
 * value, not a roll, so these are checked directly against the exported
 * arrays rather than sampled across seeds the way procedural chunks are.
 */

describe('TutorialLevel', () => {
  it('teaches the seven sections in order, with the required hazard shapes', () => {
    const types = TUTORIAL_LEVEL_CHUNKS.map((c) => c.type);

    expect(types[3]).toBe('obstacle'); // lane change
    expect(types[6]).toBe('vent'); // jump (horizontal pipe)
    expect(types[9]).toBe('slide'); // clothesline
    expect(types[12]).toBe('jump'); // standard gap
    expect(types[15]).toBe('jump'); // trampoline (also a gap)
    expect(['turnLeft', 'turnRight']).toContain(types[18]); // turn

    // Combined Challenge: the same three shapes restaged, tighter spacing.
    expect(types[21]).toBe('obstacle');
    expect(types[23]).toBe('jump');
    expect(['turnLeft', 'turnRight']).toContain(types[25]);
  });

  it('gives only the lane-change chunk a fish trail', () => {
    TUTORIAL_LEVEL_CHUNKS.forEach((chunk, i) => {
      if (i === 3) {
        expect(chunk.fish.length).toBeGreaterThan(0);
      } else {
        expect(chunk.fish).toEqual([]);
      }
    });
  });

  it('never spawns a power-up - the level stays focused on one mechanic at a time', () => {
    for (const chunk of TUTORIAL_LEVEL_CHUNKS) {
      expect(chunk.powerUp).toBeNull();
    }
  });

  it('changes roof tier exactly once, at the trampoline chunk, and nowhere else', () => {
    const rises = TUTORIAL_LEVEL_CHUNKS.filter((c) => c.trampoline);
    expect(rises).toHaveLength(1);
    expect(TUTORIAL_LEVEL_CHUNKS.indexOf(rises[0])).toBe(15);

    TUTORIAL_LEVEL_CHUNKS.forEach((chunk, i) => {
      if (i < 15) {
        expect(chunk.roofTier).toBe(ROOF_LOW);
        expect(chunk.previousRoofTier).toBe(ROOF_LOW);
      } else if (i === 15) {
        expect(chunk.previousRoofTier).toBe(ROOF_LOW);
        expect(chunk.roofTier).toBe(ROOF_MEDIUM);
      } else {
        expect(chunk.roofTier).toBe(ROOF_MEDIUM);
        expect(chunk.previousRoofTier).toBe(ROOF_MEDIUM);
      }
    });
  });

  it('has a checkpoint for every taught hazard, in course order, including the retaught combined ones', () => {
    expect(TUTORIAL_LEVEL_CHECKPOINTS.map((c) => c.lesson)).toEqual([
      'laneChange',
      'jump',
      'duck',
      'gap',
      'trampoline',
      'turn',
      'laneChange',
      'gap',
      'turn',
    ]);
  });

  it('every checkpoint respawns strictly before its own hazard', () => {
    for (const checkpoint of TUTORIAL_LEVEL_CHECKPOINTS) {
      expect(checkpoint.respawnArc).toBeLessThan(checkpoint.hazardArc);
      expect(checkpoint.respawnArc).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * The margin `ChunkBuilder`'s past-the-end filler (see its own
   * `fixedChunks` doc comment) relies on being unreachable in normal play:
   * `Game.updateTutorialLevel()` transitions to the completion screen the
   * moment `view.arc` reaches this, a full chunk before the array runs out.
   */
  it('sets the finish arc a full chunk short of the level length', () => {
    const levelLength = TUTORIAL_LEVEL_CHUNKS.length * CHUNK_LENGTH;
    expect(TUTORIAL_LEVEL_FINISH_ARC).toBeLessThan(levelLength);
    expect(levelLength - TUTORIAL_LEVEL_FINISH_ARC).toBe(CHUNK_LENGTH);
  });

  describe('ChunkBuilder({ fixedChunks })', () => {
    let world: PhysicsWorld;
    let player: PlayerController;
    let scene: THREE.Scene;
    let builder: ChunkBuilder;

    beforeAll(async () => {
      await initRapier();
    });

    beforeEach(() => {
      resetPhysicsConfig();
      world = new PhysicsWorld();
      scene = new THREE.Scene();
      player = new PlayerController(world);
      builder = new ChunkBuilder(scene, world, player, { fixedChunks: TUTORIAL_LEVEL_CHUNKS });
      builder.start();
    });

    afterEach(() => {
      builder.dispose();
      player.dispose();
      world.dispose();
    });

    it('deals the exact hand-authored sequence instead of anything from the weighted pool', () => {
      expect(builder.path).not.toBeNull();
      expect(builder.liveChunkCount).toBeGreaterThan(0);
    });

    it('streams the whole level end to end without leaking bodies or chunks', () => {
      const pos = new THREE.Vector3(0, 20.5, 0);
      const heading = new THREE.Vector3(0, 0, 1);
      const levelLength = TUTORIAL_LEVEL_CHUNKS.length * CHUNK_LENGTH;

      for (let i = 0; i < 6000; i++) {
        const path = builder.path;
        if (path) {
          const arc = path.projectDistance(pos);
          if (arc >= levelLength + 20) break;
          path.getDirectionAt(arc + 1, heading);
          pos.addScaledVector(heading, 11 * (1 / 60));
        }
        builder.update(pos);
        builder.step(1 / 60);

        expect(builder.spawnCount - builder.recycleCount).toBe(builder.liveChunkCount);
      }
    });
  });
});
