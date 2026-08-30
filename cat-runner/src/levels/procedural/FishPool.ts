import * as THREE from 'three';
import { attachFishCoinBatch, Collectible } from '../../entities/Collectible';

/**
 * Same per-streamer-slot pooling model as `ObstaclePool`, applied to fish:
 * `Collectible` already has a `moveTo()` built for exactly this (see its own
 * doc comment), so there's no new pooling mechanism to invent, only the
 * per-slot bookkeeping to reuse instead of building/disposing per chunk.
 *
 * One rig of `MAX_FISH_PER_CHUNK` fish per slot, built once, parked far below
 * the track and hidden when a chunk doesn't use them all.
 */

export const MAX_FISH_PER_CHUNK = 7;

const PARK_Y = -2000;

export class FishPool {
  private readonly rigs = new Map<number, Collectible[]>();
  private nextIndex = 0;
  private builtRigCount = 0;

  constructor(private readonly scene: THREE.Object3D) {
    // Every coin's disc is one instance of a single shared `InstancedMesh`
    // (see `Collectible.ts`'s batch note). It is parented here, to the same
    // object every coin root goes under, so the batch can read each root's
    // local matrix without reconciling two coordinate frames.
    attachFishCoinBatch(scene);
  }

  get builtCount(): number {
    return this.builtRigCount;
  }

  rigFor(slot: number): Collectible[] {
    const existing = this.rigs.get(slot);
    if (existing) return existing;

    const rig: Collectible[] = [];
    for (let i = 0; i < MAX_FISH_PER_CHUNK; i++) {
      // `minor: true` - ordinary score fish, not a saved token; index only
      // has to be unique within this pool, it's never used to key a save.
      const fish = new Collectible(new THREE.Vector3(0, PARK_Y, 0), this.nextIndex++, true);
      fish.root.visible = false;
      this.scene.add(fish.root);
      rig.push(fish);
    }
    this.rigs.set(slot, rig);
    this.builtRigCount++;
    return rig;
  }

  hideAll(slot: number): void {
    const rig = this.rigs.get(slot);
    if (!rig) return;
    for (const fish of rig) fish.root.visible = false;
  }

  dispose(): void {
    for (const rig of this.rigs.values()) {
      for (const fish of rig) fish.dispose();
    }
    this.rigs.clear();
  }
}
