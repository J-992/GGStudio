import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RuntimeVehicle } from '../src/runtime/vehicle.ts';
import { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';
import {
  ZOMBIE_POOL_COUNTS,
  ZOMBIE_POOL_SIZE,
} from '../src/survival/zombies/zombieConfig.ts';
import type { ZombieKind } from '../src/survival/zombies/Zombie.ts';

beforeAll(async () => {
  await RAPIER.init();
  installCanvasStub();
});

/**
 * Enough of a canvas for the module-level texture builders a few kinds run on
 * first construction — the gunslinger's scope reticle, the necromancer's sigil,
 * the phone addict's halo. They only ever draw; nothing reads a pixel back
 * without a renderer, and this suite has none. Every context method no-ops and
 * returns the same object, which also covers the gradient builders whose result
 * gets `addColorStop` called on it.
 */
function installCanvasStub(): void {
  if ('document' in globalThis) return;
  const context: unknown = new Proxy(
    {},
    { get: () => () => context, set: () => true },
  );
  const document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
  (globalThis as unknown as { document: unknown }).document = document;
}

/**
 * The pool needs a vehicle for its anchor list and for spawn-point selection.
 * An empty rig gives an empty anchor list, and a body parked at the origin is
 * all the selection needs — none of these tests lets a zombie walk anywhere.
 */
function emptyVehicle(): RuntimeVehicle {
  return {
    assembled: { parts: new Map() },
    body: {
      translation: () => ({ x: 0, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    },
  } as unknown as RuntimeVehicle;
}

function makeSystem(): ZombieSystem {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  return new ZombieSystem(
    world,
    new THREE.Scene(),
    [new THREE.Vector3(30, 0, 0), new THREE.Vector3(-30, 0, 0)],
    emptyVehicle(),
    () => undefined,
  );
}

/** Every body the system has actually built, in creation order. */
function built(system: ZombieSystem): { kind: ZombieKind; index: number }[] {
  const pool = (
    system as unknown as { pool: { kind: ZombieKind; index: number }[] }
  ).pool;
  return pool.map((zombie) => ({ kind: zombie.kind, index: zombie.index }));
}

describe('zombie pool construction', () => {
  it('builds nothing until a wave asks for a body', () => {
    const system = makeSystem();
    // The whole point: standing an arena up no longer costs 167 rigid bodies,
    // 167 model instances and every zombie GLB in the game.
    expect(built(system)).toHaveLength(0);
    expect(system.getActiveCount()).toBe(0);
  });

  it('builds only the kinds a wave actually fields', () => {
    const system = makeSystem();
    system.trySpawnHorde(['walker', 'walker', 'thrower']);

    const kinds = built(system).map((zombie) => zombie.kind);
    expect(kinds).toEqual(['walker', 'walker', 'thrower']);
    // Nothing speculative: no behemoth, and above all no zamboni, whose model
    // is the single largest asset in the game.
    expect(kinds).not.toContain('zamboni');
    expect(kinds).not.toContain('behemoth');
  });

  it('hands out the same pool index the eager pool would have', () => {
    const system = makeSystem();
    // Reconstruct what the old constructor assigned: kinds in declaration
    // order, each taking a contiguous block. `modelFileFor` picks a walker's
    // model off this index, so drifting here would silently reshuffle the
    // horde's appearance.
    const expected = new Map<ZombieKind, number>();
    let next = 0;
    for (const [kind, count] of Object.entries(ZOMBIE_POOL_COUNTS) as [
      ZombieKind,
      number,
    ][]) {
      expected.set(kind, next);
      next += count;
    }

    system.trySpawnHorde(['walker', 'thrower', 'behemoth']);
    for (const zombie of built(system)) {
      expect(zombie.index).toBe(expected.get(zombie.kind));
    }
  });

  it('reuses an idle body instead of building a second one', () => {
    const system = makeSystem();
    system.trySpawnHorde(['walker']);
    expect(built(system)).toHaveLength(1);

    system.reset();
    system.trySpawnHorde(['walker']);
    // Back to the same body — a returning wave must not grow the pool.
    expect(built(system)).toHaveLength(1);
  });

  it('still refuses to exceed a kind’s cap', () => {
    const system = makeSystem();
    const cap = ZOMBIE_POOL_COUNTS.behemoth;
    const asked = cap + 3;

    const spawned = system.trySpawnHorde(
      Array<ZombieKind>(asked).fill('behemoth'),
    );
    // `WaveManager` reads the return value as a prefix count, so overflow has
    // to stop the batch rather than silently wrap.
    expect(spawned).toBe(cap);
    expect(built(system)).toHaveLength(cap);
  });

  it('never allocates an index outside the scratch arrays', () => {
    const system = makeSystem();
    // The separation, watchdog and plow arrays are all sized to the total pool
    // and indexed by `zombie.index`, so an index at or past the total would
    // read and write off the end.
    system.warmKinds(Object.keys(ZOMBIE_POOL_COUNTS) as ZombieKind[]);
    for (const zombie of built(system)) {
      expect(zombie.index).toBeGreaterThanOrEqual(0);
      expect(zombie.index).toBeLessThan(ZOMBIE_POOL_SIZE);
    }
  });

  it('warms one body per kind ahead of the wave that needs it', () => {
    const system = makeSystem();
    system.warmKinds(['walker', 'walker', 'kamikaze']);

    // One each, not one per request — warming is about getting the model
    // loading, not about pre-building the whole wave.
    expect(built(system).map((zombie) => zombie.kind)).toEqual([
      'walker',
      'kamikaze',
    ]);

    // And a warmed body is an idle body: the wave spends it rather than
    // building alongside it.
    system.trySpawnHorde(['walker']);
    expect(built(system)).toHaveLength(2);
  });
});
