import * as THREE from 'three';
import { FISH_MAGNET_SPEED } from '../levels/procedural/PowerUpConfig';

/**
 * A fish-coin token.
 *
 * Collection is a plain radius test against the cat's position rather than a
 * physics sensor: tokens sit on the riskiest lines in the level, where the cat
 * is usually moving at full speed, and a thin sensor volume would be tunnelled
 * straight through at 15 units a second.
 *
 * The collected state is per-attempt. LevelManager merges it into the permanent
 * save only when the level is actually finished, so grabbing a token and then
 * falling earns nothing.
 *
 * The visual is the provided `fish_coin.webp` on a flat, double-sided disc -
 * deliberately NOT `Cat.buildFish()`, the 3D model the cat's own mouth-held
 * fish uses. That function is shared with the mouth fish specifically so a
 * change to one is a change to both; the endless track's collectible needed
 * its own, separate visual precisely so the mouth fish could stay untouched.
 * `CircleGeometry` already faces +Z by default, so the disc's face is
 * perpendicular to the track rather than lying flat on it - spinning it
 * around Y (see `update()`) reads as a coin flipping edge-on-face-on, the
 * classic "spinning coin" look, rather than an in-plane spin that wouldn't
 * read as three-dimensional at all.
 */

/** How far the idle hover carries a resting coin above and below its anchor. */
const IDLE_BOB_AMPLITUDE = 0.18;
const COLLECT_RADIUS = 1.5;
const COLLECT_RADIUS_SQ = COLLECT_RADIUS * COLLECT_RADIUS;

const COIN_RADIUS = 0.75;

/** How much larger a saved token is than an ordinary score fish. */
const TOKEN_SCALE = 1.7;

/**
 * How long the collection "pop" plays for, seconds. Deliberately very short
 * - it is a confirmation that the coin registered, not an effect; anything
 * longer reads as the coin failing to disappear at a run's speed.
 */
export const COLLECT_ANIM_DURATION = 0.16;
/** Peak extra scale at the middle of the pop (`1 + this` at t = 0.5). */
const COLLECT_ANIM_SCALE = 0.5;
/** How far the coin drifts upward over the pop, world units. */
const COLLECT_ANIM_RISE = 0.5;
let coinGeometry: THREE.CircleGeometry | null = null;
let coinMaterial: THREE.MeshBasicMaterial | null = null;

function ensureCoinAssets(): { geometry: THREE.CircleGeometry; material: THREE.MeshBasicMaterial } {
  if (!coinGeometry) coinGeometry = new THREE.CircleGeometry(COIN_RADIUS, 20);
  if (!coinMaterial) {
    // Flat gold fallback tint until the real texture resolves - every other
    // "provided asset, built-once, non-fatal fallback" swap in this codebase
    // (AssetRegistry's own model/texture getters) follows the same shape:
    // never throw on a slow load, just render something reasonable first.
    coinMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd54a,
      transparent: true,
      side: THREE.DoubleSide,
    });
  }
  return { geometry: coinGeometry, material: coinMaterial };
}

/** Call once the real coin texture has loaded - swaps every existing and
 *  future coin over to it, since all coins share this one material. */
export function setFishCoinTexture(texture: THREE.Texture): void {
  const { material } = ensureCoinAssets();
  material.map = texture;
  material.color.set(0xffffff);
  material.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// The shared coin batch
// ---------------------------------------------------------------------------

/**
 * Every fish coin in the game is the same twenty-segment disc wearing the
 * same texture, and `FishPool` keeps `MAX_FISH_PER_CHUNK` of them per live
 * streamer slot - around a hundred on screen at once. Drawn as individual
 * meshes that was ~100 draw calls a frame, which after the skyline's own
 * per-face draw-call bug was fixed became the single largest line item left
 * in the frame: a fifth of the whole budget, spent re-binding vertex state
 * that is identical down to the vertex.
 *
 * So the discs live in one `InstancedMesh` and cost one draw call between
 * them. Nothing else about a `Collectible` changes: it still owns a real
 * `Object3D` (`root`), still spins/bobs/pops it exactly as before, and
 * callers still read `root.position` for the fish magnet and set
 * `root.visible` to park a coin. The batch simply copies each live root's
 * matrix into the instance buffer instead of the renderer walking a hundred
 * separate meshes to do the same thing.
 *
 * The copy happens in `onBeforeRender`, for two reasons. It is late enough
 * to be correct - the renderer calls it immediately before submitting this
 * object, so every transform written anywhere earlier in the frame is
 * already in - and it is the *only* hook guaranteed to run no matter what a
 * caller did to a root, which matters because visibility is toggled by
 * direct field assignment (`fish.root.visible = false`) from three different
 * places and there is nothing to intercept.
 */
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
/** Grown by doubling as `FishPool` builds rigs - see {@link acquireInstance}. */
const INITIAL_BATCH_CAPACITY = 64;

let batchMesh: THREE.InstancedMesh | null = null;
let batchParent: THREE.Object3D | null = null;
/** Instance slot -> its owner, or null for a freed slot. Index is the
 *  instance id; `members.length` is the high-water mark actually in use. */
let members: (Collectible | null)[] = [];
const freeSlots: number[] = [];

function syncBatch(): void {
  if (!batchMesh) return;
  for (let i = 0; i < members.length; i++) {
    const owner = members[i];
    if (owner && owner.root.visible) {
      owner.root.updateMatrix();
      batchMesh.setMatrixAt(i, owner.root.matrix);
    } else {
      batchMesh.setMatrixAt(i, HIDDEN_MATRIX);
    }
  }
  batchMesh.instanceMatrix.needsUpdate = true;
}

function buildBatch(capacity: number): THREE.InstancedMesh {
  const { geometry, material } = ensureCoinAssets();
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  // A coin's own root carries its position; the batch's bounding volume
  // would have to span the whole streamed track to be correct, so culling it
  // is both meaningless and a way to lose every coin at once.
  mesh.frustumCulled = false;
  mesh.onBeforeRender = syncBatch;
  for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, HIDDEN_MATRIX);
  return mesh;
}

function growBatch(capacity: number): void {
  const replacement = buildBatch(capacity);
  if (batchMesh) {
    batchMesh.removeFromParent();
    batchMesh.dispose();
  }
  batchMesh = replacement;
  batchParent?.add(batchMesh);
}

/**
 * Parents the shared batch under `parent` - called by `FishPool` with the
 * same object it parents every coin root to, which is what lets the batch
 * use each root's *local* matrix rather than reconciling two frames.
 */
export function attachFishCoinBatch(parent: THREE.Object3D): void {
  batchParent = parent;
  if (!batchMesh) growBatch(Math.max(INITIAL_BATCH_CAPACITY, members.length));
  else parent.add(batchMesh);
}

function acquireInstance(owner: Collectible): number {
  const reused = freeSlots.pop();
  if (reused !== undefined) {
    members[reused] = owner;
    return reused;
  }

  const index = members.length;
  members.push(owner);
  if (!batchMesh || index >= batchMesh.count) {
    growBatch(Math.max(INITIAL_BATCH_CAPACITY, (index + 1) * 2));
  }
  return index;
}

function releaseInstance(index: number): void {
  if (index < 0 || index >= members.length) return;
  members[index] = null;
  freeSlots.push(index);
  batchMesh?.setMatrixAt(index, HIDDEN_MATRIX);
}

/** Frees the shared coin geometry/material/batch - a whole-module, one-time
 *  teardown, not per-instance (see `Collectible.dispose()`'s own note). */
export function disposeFishCoinAssets(): void {
  batchMesh?.removeFromParent();
  batchMesh?.dispose();
  batchMesh = null;
  batchParent = null;
  members = [];
  freeSlots.length = 0;

  coinGeometry?.dispose();
  coinMaterial?.dispose();
  coinGeometry = null;
  coinMaterial = null;
}

export class Collectible {
  readonly root = new THREE.Group();
  collected = false;

  private spinPhase = Math.random() * Math.PI * 2;
  private position = new THREE.Vector3();
  /** Slot in the shared `InstancedMesh` - see the batch note above. */
  private readonly batchIndex: number;
  /** `root`'s resting scale, which the pop animates around. Non-unit for a
   *  saved token now that the size lives on `root` rather than on a child. */
  private readonly baseScale: number;
  /** Seconds into the collection pop, or null when not popping (which is
   *  both "not collected yet" and "collected, pop already finished"). */
  private collectAnimT: number | null = null;
  /** Rendered Y the coin was at on the frame it was collected - the pop
   *  rises from there rather than from `position.y`, so it doesn't snap by
   *  however far the bob happened to have carried it. */
  private collectFromY = 0;

  constructor(
    position: THREE.Vector3,
    /** Index within the level. Identifies a token in the save file. */
    readonly index: number,
    /**
     * A plain score fish rather than one of the three saved tokens.
     *
     * Smaller, because the two mean different things and the player has to
     * be able to tell at a glance which one is worth going out of their way
     * for. Only the three tokens are recorded in the save and gate skin
     * unlocks; score fish are counted for the run.
     */
    readonly minor = false,
  ) {
    this.baseScale = minor ? 1 : TOKEN_SCALE;
    this.position.copy(position);
    this.root.position.copy(position);
    // The disc is not parented here - it is one instance of the shared batch
    // above, drawn from `root`'s matrix. The size difference between a score
    // fish and a saved token therefore has to live on `root` itself, since
    // that matrix is now the only thing the instance sees.
    this.root.scale.setScalar(this.baseScale);
    this.batchIndex = acquireInstance(this);
  }

  /**
   * Drags the coin toward `target` at a real speed, Fish Magnet's whole
   * effect.
   *
   * Moves {@link position} - the coin's *anchor* - rather than `root`
   * directly, and that is the fix rather than a detail. The magnet used to
   * lerp `root.position`, and the very next line of {@link update} rewrote
   * `root.position.y` from `this.position.y` plus the idle bob. So the pull
   * only ever worked in X and Z: a coin authored above head height would
   * close in horizontally, arrive at the runner's own column, and *stay
   * there*, hovering in the middle of the screen for the rest of the effect -
   * never collected, because {@link COLLECT_RADIUS} is measured in three
   * dimensions and the height it could not close was bigger than the radius.
   *
   * A constant speed rather than a lerp, for the second half of the same
   * complaint. `lerp(target, rate * dt)` is an exponential approach: it is
   * quick at range and asymptotically slow up close, which is exactly
   * backwards for something meant to be swallowed. It is also not
   * frame-rate independent, so the magnet was weaker on a slow phone - the
   * one place the screen can least afford a shoal of coins parked on it.
   */
  pullToward(target: THREE.Vector3, dt: number): void {
    if (this.collected) return;

    const step = FISH_MAGNET_SPEED * dt;
    const distance = this.position.distanceTo(target);
    if (distance <= step) {
      this.position.copy(target);
      return;
    }
    this.position.lerp(target, step / distance);
  }

  /**
   * @returns true on the frame it is collected, so the caller can score it
   *
   * Keeps being called every frame after collection (the pools drive every
   * fish in a live chunk unconditionally - see
   * `ChunkBuilder.updateFishVisuals`), which is what the collection pop below
   * runs on. It returns `false` for all of those frames: scoring already
   * happened, synchronously, on the one frame the pickup was detected, and
   * only the visual lingers.
   */
  update(dt: number, playerPosition: THREE.Vector3): boolean {
    if (this.collected) {
      this.advanceCollectAnim(dt);
      return false;
    }

    this.spinPhase += dt * 1.8;
    this.root.rotation.y = this.spinPhase;
    // All three axes, from the anchor. This line used to write only `.y`,
    // which quietly made `position` the authority on height and `root` the
    // authority on everything else - so Fish Magnet, which moved `root`, was
    // overruled vertically on the very next frame and could never pull a coin
    // down to the runner. See {@link pullToward}.
    this.root.position.set(
      this.position.x,
      this.position.y + Math.sin(this.spinPhase * 1.4) * IDLE_BOB_AMPLITUDE,
      this.position.z,
    );

    if (this.root.position.distanceToSquared(playerPosition) > COLLECT_RADIUS_SQ) return false;

    this.collected = true;
    // Deliberately still visible: the pop needs a mesh to play on, and hides
    // it itself once it finishes. Scoring is unaffected either way.
    this.collectAnimT = 0;
    this.collectFromY = this.root.position.y;
    return true;
  }

  /**
   * Pure spin/bob, no collection check and no state mutation - the attract-
   * mode main-menu scene reuses the same pooled `Collectible`s the real run
   * would (see `ChunkBuilder.updateIdleFishVisuals`), but nothing should
   * ever be "caught" there, so this skips the distance check and scoring
   * entirely rather than calling `update()` against a fake player position.
   * Same spin/bob formula as `update()`, so a menu coin reads identically to
   * an in-game one.
   */
  animateIdle(dt: number): void {
    if (this.collected) return;
    this.spinPhase += dt * 1.8;
    this.root.rotation.y = this.spinPhase;
    this.root.position.y =
      this.position.y + Math.sin(this.spinPhase * 1.4) * IDLE_BOB_AMPLITUDE;
  }

  /**
   * The collection pop: a quick swell-and-shrink plus a small upward drift,
   * over {@link COLLECT_ANIM_DURATION}, then the coin hides itself.
   *
   * Pure transform work on the group that already exists - no particles, no
   * new geometry or materials, one sine per animating coin for a sixth of a
   * second - so it stays inside the same build-once/reuse pooling budget the
   * rest of the fish system works to.
   */
  private advanceCollectAnim(dt: number): void {
    if (this.collectAnimT === null) return;

    this.collectAnimT += dt;
    const t = Math.min(1, this.collectAnimT / COLLECT_ANIM_DURATION);
    // sin(pi * t): 0 -> 1 -> 0, so the coin swells and shrinks back rather
    // than ending mid-swell on the frame it vanishes.
    this.root.scale.setScalar(this.baseScale * (1 + Math.sin(t * Math.PI) * COLLECT_ANIM_SCALE));
    this.root.position.y = this.collectFromY + t * COLLECT_ANIM_RISE;
    this.root.rotation.y = this.spinPhase + t * Math.PI;

    if (this.collectAnimT >= COLLECT_ANIM_DURATION) {
      this.root.visible = false;
      this.root.scale.setScalar(this.baseScale);
      this.collectAnimT = null;
    }
  }

  reset(): void {
    this.collected = false;
    this.root.visible = true;
    this.root.position.copy(this.position);
    this.root.scale.setScalar(this.baseScale);
    this.collectAnimT = null;
    this.spinPhase = Math.random() * Math.PI * 2;
  }

  /**
   * Moves an already-built token somewhere else and un-collects it.
   *
   * On an endless track - where a chunk retires every few seconds - building
   * and disposing tokens per chunk would be a steady stream of GPU uploads
   * for no reason. Reusing the instance makes the cost one-off; the coin
   * mesh itself already shares its geometry/material across every instance
   * (see `ensureCoinAssets()`), so there is nothing per-instance to reclaim
   * on a move anyway.
   */
  moveTo(position: THREE.Vector3): void {
    this.position.copy(position);
    this.reset();
  }

  /**
   * Only detaches from the scene - the coin mesh's geometry/material are the
   * shared module-level singletons every `Collectible` uses (see
   * `ensureCoinAssets()`), not owned per-instance, so disposing them here
   * would break every other still-live token. `disposeFishCoinAssets()` is
   * the one-time, whole-module teardown for those, called once when the
   * endless track itself tears down - mirroring `disposeVentPipeAssets()`'s
   * own convention for a shared, module-owned cache.
   */
  dispose(): void {
    releaseInstance(this.batchIndex);
    this.root.removeFromParent();
  }
}
