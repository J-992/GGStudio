/**
 * The bookkeeping half of the endless track: which chunks should exist right
 * now, and which slot each one lives in.
 *
 * It is deliberately free of three.js, Rapier and the obstacle factory. The
 * failure this class exists to prevent - a slow leak where chunks are spawned
 * faster than they are retired until the tab dies twenty minutes in - is a
 * counting bug, not a rendering one, and counting bugs are only cheap to catch
 * if they can be simulated for a hundred thousand units of running in a unit
 * test. An engine-bound caller supplies the meaning of "spawn" and "recycle";
 * this supplies the decision.
 *
 * The central invariant is that live chunks are always a **contiguous run** of
 * indices. Chunks are dealt strictly in increasing order and retired only from
 * behind, so the live set is exactly `[lowestLive, nextIndex - 1]`. Everything
 * else follows from that: the ring can never fragment, a slot search is a scan
 * of six entries, and "is the track continuous under the player" reduces to a
 * range check.
 */

export interface ChunkPlacement {
  /** Monotonically increasing chunk index. Negative behind the spawn point. */
  readonly index: number;
  /** World Z of the chunk's leading edge. */
  readonly startZ: number;
}

export interface StreamerCallbacks {
  /** Build (or, from Phase 2, relocate) the chunk into `slot`. */
  spawn(placement: ChunkPlacement, slot: number): void;
  /** The chunk in `slot` has fallen behind the window and must be released. */
  recycle(placement: ChunkPlacement, slot: number): void;
}

export interface ChunkStreamerOptions {
  chunkLength: number;
  /** How far ahead of the player track must already exist. */
  aheadDistance: number;
  /** How far behind the player a chunk is kept before being retired. */
  behindDistance: number;
  /**
   * Ring size. Defaults to the tightest value that can never starve, plus two
   * spare, which is what lets `update()` cap itself at one spawn per frame.
   */
  slotCount?: number;
  /**
   * Chunks built per `update()`. One, because building a chunk touches Rapier
   * and uploads geometry, and doing several in the frame the player crosses a
   * boundary is exactly the hitch an endless runner cannot afford.
   */
  maxSpawnsPerUpdate?: number;
}

export class ChunkStreamer {
  readonly chunkLength: number;
  readonly aheadDistance: number;
  readonly behindDistance: number;
  readonly slotCount: number;
  readonly maxSpawnsPerUpdate: number;

  private readonly slots: (ChunkPlacement | null)[];
  /** Lowest chunk index not yet dealt. */
  private nextIndex = 0;
  private live = 0;

  /** Lifetime counters. `spawns - recycles === liveCount` is the leak canary. */
  private spawns = 0;
  private recycles = 0;

  constructor(options: ChunkStreamerOptions) {
    const { chunkLength, aheadDistance, behindDistance } = options;
    if (!(chunkLength > 0)) throw new Error('ChunkStreamer needs a positive chunkLength');

    this.chunkLength = chunkLength;
    this.aheadDistance = aheadDistance;
    this.behindDistance = behindDistance;
    this.maxSpawnsPerUpdate = options.maxSpawnsPerUpdate ?? 1;

    // The window spans `ahead + behind`, so it can straddle at most
    // ceil(span / chunkLength) + 1 chunks. Two spare on top of that is what
    // guarantees a free slot exists on the frame a boundary is crossed, which
    // is what makes the one-per-frame cap safe rather than a stall.
    this.slotCount =
      options.slotCount ?? Math.ceil((aheadDistance + behindDistance) / chunkLength) + 3;
    this.slots = new Array<ChunkPlacement | null>(this.slotCount).fill(null);
  }

  get liveCount(): number {
    return this.live;
  }

  get spawnCount(): number {
    return this.spawns;
  }

  get recycleCount(): number {
    return this.recycles;
  }

  /** Inclusive index range currently live, or null when nothing is dealt. */
  liveRange(): { first: number; last: number } | null {
    if (this.live === 0) return null;
    let first = Infinity;
    for (const placement of this.slots) {
      if (placement && placement.index < first) first = placement.index;
    }
    return { first, last: this.nextIndex - 1 };
  }

  /** Read-only view of the ring, for a caller's own per-chunk step and the debug panel. */
  get placements(): readonly (ChunkPlacement | null)[] {
    return this.slots;
  }

  /**
   * Drops everything and deals a fresh opening run around `playerZ`.
   *
   * The opening deal ignores `maxSpawnsPerUpdate` on purpose: the player is
   * about to be dropped onto this track, and rationing it one chunk per frame
   * would put them on a deck that does not reach as far as they can see.
   *
   * This is also the only way to move the player a long way without tearing the
   * track. `update()` repairs small backward movement (a fall recovery's
   * six-unit setback) for free, because retiring only ever happens from behind;
   * a teleport backwards past a whole chunk must come through here.
   */
  reset(playerZ: number, callbacks: StreamerCallbacks): void {
    for (let slot = 0; slot < this.slots.length; slot++) {
      const placement = this.slots[slot];
      if (!placement) continue;
      this.slots[slot] = null;
      this.live--;
      this.recycles++;
      callbacks.recycle(placement, slot);
    }

    this.nextIndex = this.firstIndexAt(playerZ);
    this.fill(playerZ, callbacks, Infinity);
  }

  /** Render-rate. Retires what has fallen behind, then deals what is missing. */
  update(playerZ: number, callbacks: StreamerCallbacks): void {
    this.retire(playerZ, callbacks);
    this.fill(playerZ, callbacks, this.maxSpawnsPerUpdate);
  }

  /** Index of the chunk containing the trailing edge of the window. */
  firstIndexAt(playerZ: number): number {
    return Math.floor((playerZ - this.behindDistance) / this.chunkLength);
  }

  /** Index of the chunk containing the leading edge of the window. */
  lastIndexAt(playerZ: number): number {
    return Math.floor((playerZ + this.aheadDistance) / this.chunkLength);
  }

  private retire(playerZ: number, callbacks: StreamerCallbacks): void {
    const cutoff = playerZ - this.behindDistance;

    for (let slot = 0; slot < this.slots.length; slot++) {
      const placement = this.slots[slot];
      if (!placement) continue;
      // Only when the chunk is WHOLLY behind. Retiring one the player is still
      // standing on would delete the deck under their feet.
      if (placement.startZ + this.chunkLength >= cutoff) continue;

      this.slots[slot] = null;
      this.live--;
      this.recycles++;
      callbacks.recycle(placement, slot);
    }
  }

  private fill(playerZ: number, callbacks: StreamerCallbacks, budget: number): void {
    // If the player has outrun the streamer - a long stall, or a forward
    // teleport - the chunks in between are already behind the window and
    // building them would be wasted work.
    const first = this.firstIndexAt(playerZ);
    if (this.nextIndex < first) this.nextIndex = first;

    const last = this.lastIndexAt(playerZ);
    let spawned = 0;

    while (this.nextIndex <= last && spawned < budget) {
      const slot = this.slots.indexOf(null);
      // Cannot happen with the derived slot count; if a caller overrides it too
      // tightly, back off and try again next frame rather than evicting a chunk
      // the player may be standing on.
      if (slot < 0) break;

      const placement: ChunkPlacement = {
        index: this.nextIndex,
        startZ: this.nextIndex * this.chunkLength,
      };

      this.slots[slot] = placement;
      this.live++;
      this.spawns++;
      spawned++;
      this.nextIndex++;

      callbacks.spawn(placement, slot);
    }
  }
}
