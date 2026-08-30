import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, collisionGroups, type PhysicsWorld } from '../../physics/PhysicsWorld';
import { DECK_THICKNESS } from '../TrackConfig';
import {
  DECK_A_LENGTH,
  DECK_B_LENGTH,
  DECK_WIDTH,
  GAP_LENGTH,
  OBSTACLE_SIZE,
  TURN_MARKER_HEIGHT,
  TURN_MARKER_RADIUS,
  VENT_PIPE_DEPTH,
  VENT_PIPE_HEIGHT,
  VENT_PIPE_LENGTH,
} from './ChunkTypes';
import { buildClotheslineHazard } from './ClotheslineHazard';
import { buildVentPipeVisual } from './VentPipeHazard';
import {
  deckMaterial,
  obstacleMaterial,
  turnMarkerMaterial,
  unitBoxGeometry,
  unitConeGeometry,
} from './PlaceholderAssets';

/**
 * One fixed-size, fixed-role rig of bodies per streamer slot.
 *
 * `ChunkStreamer` hands out a small, bounded set of slot indices (the ring
 * size, ~9) and reuses them forever. Rather than a general acquire/release
 * pool keyed by chunk type, this keeps it as simple as the invariant makes
 * possible: **one rig per slot, built once, reused for every chunk that ever
 * lands in that slot.** Every chunk type is a different combination of which
 * roles in the rig are shown and where they sit - never a different body
 * count or collider size - so "recycle" is just "hide what the new chunk
 * doesn't need" and "spawn" is a few `setTranslation`/`setRotation` calls.
 *
 * Ground pieces (the three deck spans) and obstacles get real Rapier
 * colliders, because the player's existing ground probe and `isObstacle()`
 * check already know how to read `GROUP.GROUND`/`GROUP.OBSTACLE` - no new
 * collision code needed. The slide beam deliberately does **not** get a
 * collider: it follows the same pattern as the campaign's `Clothesline`
 * hazard (see that file's own doc comment) - a resizable player capsule is
 * worse than a manual overlap check done once a frame, so `ChunkBuilder`
 * does that check itself against the beam's pooled world transform.
 */

const ALL_DYNAMIC = GROUP.PLAYER | GROUP.OBSTACLE | GROUP.PURSUER | GROUP.SENSOR;

/** Parked far below the track when hidden, so a stray collider can't be hit. */
const PARK_Y = -2000;

export interface BodyEntry {
  /** A single mesh for the ground/obstacle roles; the vent pipe's own visual
   *  (`VentPipeHazard.buildVentPipeVisual()`) can be a multi-mesh group, so
   *  this is typed at the `Object3D` level - every generic consumer here
   *  (`place`/`park`/`dispose`) only ever needs `visible`/position/rotation/
   *  `removeFromParent()`, which both share. */
  readonly mesh: THREE.Object3D;
  readonly body: RAPIER.RigidBody;
}

/** Up to this many independent obstacle decisions in one chunk. Currently
 *  `generateObstacle` uses at most 2; kept at 3 for headroom - raising it
 *  only ever means one more pooled body per streamer slot, cheap, not a
 *  rework. */
export const MAX_OBSTACLES_PER_CHUNK = 3;

export interface SlotRig {
  readonly deckA: BodyEntry;
  readonly deckC: BodyEntry;
  readonly deckB: BodyEntry;
  /** Fills the outside-of-turn gap a 90-degree corner otherwise leaves
   *  between the incoming and outgoing straight decks - see
   *  `ChunkBuilder.placeChunk()`. Parked (like `deckC` on a gap chunk) for
   *  every chunk that isn't a turn. */
  readonly cornerFill: BodyEntry;
  /** Fixed-length; unused entries for a given chunk are simply parked. */
  readonly obstacles: readonly BodyEntry[];
  /** The jump-only, full-width vent pipe - a real collider, like `obstacles`,
   *  not a manual-overlap visual-only role like `beam` below (see
   *  `ChunkTypes.VENT_PIPE_HEIGHT`'s own comment for why duck must not
   *  bypass it). */
  readonly ventPipe: BodyEntry;
  /** Placement group for the duck-under hazard; the clothesline's rope,
   *  posts and sheets are fixed children of it (see `buildVisualOnly`). */
  readonly beam: THREE.Group;
  /** Placement group; the cone mesh is a fixed child of this. */
  readonly turnMarker: THREE.Group;
}

export class ObstaclePool {
  private readonly rigs = new Map<number, SlotRig>();
  private builtRigCount = 0;
  private reuseCount = 0;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly physics: PhysicsWorld,
  ) {}

  /** Debug counter: rigs actually built. Flat after the ring warms up. */
  get builtCount(): number {
    return this.builtRigCount;
  }

  /** Debug counter: times an existing rig was handed back instead of built. */
  get reuseTotal(): number {
    return this.reuseCount;
  }

  rigFor(slot: number): SlotRig {
    const existing = this.rigs.get(slot);
    if (existing) {
      this.reuseCount++;
      return existing;
    }

    const rig: SlotRig = {
      deckA: this.buildGround(DECK_A_LENGTH),
      deckC: this.buildGround(GAP_LENGTH),
      deckB: this.buildGround(DECK_B_LENGTH),
      cornerFill: this.buildGround(DECK_WIDTH / 2, DECK_WIDTH / 2),
      obstacles: Array.from({ length: MAX_OBSTACLES_PER_CHUNK }, () => this.buildObstacle()),
      ventPipe: this.buildVentPipe(),
      beam: this.buildVisualOnly(),
      turnMarker: this.buildTurnMarker(),
    };
    this.rigs.set(slot, rig);
    this.builtRigCount++;
    return rig;
  }

  /**
   * The rig already built for a slot, or undefined if there isn't one.
   *
   * Separate from {@link rigFor} because that one *builds* on a miss and
   * counts every call as a reuse - which is right for the streamer's spawn
   * path and wrong for a per-fixed-step query like
   * `ChunkBuilder.smashPhased`, where it would both allocate rigs for empty
   * slots and turn the debug counter into a frame counter.
   */
  rigAt(slot: number): SlotRig | undefined {
    return this.rigs.get(slot);
  }

  /** Parks every body in a slot's rig out of the way and hides its meshes. */
  hideAll(slot: number): void {
    const rig = this.rigs.get(slot);
    if (!rig) return;
    for (const entry of [rig.deckA, rig.deckC, rig.deckB, rig.cornerFill, rig.ventPipe, ...rig.obstacles]) {
      this.park(entry);
    }
    rig.beam.visible = false;
    rig.turnMarker.visible = false;
  }

  park(entry: BodyEntry): void {
    entry.mesh.visible = false;
    entry.body.setTranslation({ x: 0, y: PARK_Y, z: 0 }, true);
  }

  place(entry: BodyEntry, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    entry.mesh.visible = true;
    entry.mesh.position.copy(position);
    entry.mesh.quaternion.copy(quaternion);
    entry.body.setTranslation(position, true);
    entry.body.setRotation(quaternion, true);
  }

  /** Same idea as {@link place}, for the collider-less visual-only roles. */
  placeVisual(group: THREE.Group, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    group.visible = true;
    group.position.copy(position);
    group.quaternion.copy(quaternion);
  }

  hideVisual(group: THREE.Group): void {
    group.visible = false;
  }

  private buildGround(length: number, width: number = DECK_WIDTH): BodyEntry {
    const mesh = new THREE.Mesh(unitBoxGeometry, deckMaterial);
    mesh.scale.set(width, DECK_THICKNESS, length);
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.scene.add(mesh);

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, PARK_Y, 0),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, DECK_THICKNESS / 2, length / 2)
        .setFriction(0.9)
        .setCollisionGroups(collisionGroups(GROUP.GROUND, ALL_DYNAMIC)),
      body,
    );

    return { mesh, body };
  }

  private buildObstacle(): BodyEntry {
    const mesh = new THREE.Mesh(unitBoxGeometry, obstacleMaterial);
    mesh.scale.set(OBSTACLE_SIZE.width, OBSTACLE_SIZE.height, OBSTACLE_SIZE.depth);
    mesh.castShadow = true;
    mesh.visible = false;
    this.scene.add(mesh);

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, PARK_Y, 0),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        OBSTACLE_SIZE.width / 2,
        OBSTACLE_SIZE.height / 2,
        OBSTACLE_SIZE.depth / 2,
      )
        .setFriction(0.7)
        .setCollisionGroups(collisionGroups(GROUP.OBSTACLE, ALL_DYNAMIC)),
      body,
    );

    return { mesh, body };
  }

  /**
   * The vent pipe: a real, static Rapier collider spanning every lane at a
   * fixed jump-only height, with its own visual (`VentPipeHazard`) riding
   * along - the exact same collider+separate-mesh pattern `buildObstacle()`
   * already uses, just wider and shorter. No manual overlap check needed:
   * unlike the clothesline, nothing about this hazard should ever be
   * bypassed by ducking, and a plain static collider already can't be.
   */
  private buildVentPipe(): BodyEntry {
    const mesh = buildVentPipeVisual();
    mesh.traverse((child) => {
      (child as THREE.Mesh).castShadow = true;
    });
    mesh.visible = false;
    this.scene.add(mesh);

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, PARK_Y, 0),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(VENT_PIPE_LENGTH / 2, VENT_PIPE_HEIGHT / 2, VENT_PIPE_DEPTH / 2)
        .setFriction(0.7)
        .setCollisionGroups(collisionGroups(GROUP.OBSTACLE, ALL_DYNAMIC)),
      body,
    );

    return { mesh, body };
  }

  private buildVisualOnly(): THREE.Group {
    // A strung clothesline - rope, posts and pegged sheets - not a flat
    // panel. The panel it replaces was a placeholder that had already been
    // grown to the full hit band (BEAM_RADIUS * 2 tall, see ChunkTypes.ts's
    // derivation from the campaign's Clothesline curtain) so that what the
    // player sees matches what can hit them; `buildClotheslineHazard` keeps
    // that invariant exactly - it fills the same band from the same origin -
    // and only changes what the band is made of. Its own doc comment carries
    // the rest of the reasoning, including why the prop is rebuilt there
    // rather than reusing `ProceduralProps.buildLaundryLine` directly.
    const group = buildClotheslineHazard();
    this.scene.add(group);
    return group;
  }

  private buildTurnMarker(): THREE.Group {
    const mesh = new THREE.Mesh(unitConeGeometry, turnMarkerMaterial);
    mesh.scale.set(TURN_MARKER_RADIUS * 2, TURN_MARKER_HEIGHT, TURN_MARKER_RADIUS * 2);

    const group = new THREE.Group();
    group.visible = false;
    group.add(mesh);
    this.scene.add(group);
    return group;
  }

  dispose(): void {
    for (const rig of this.rigs.values()) {
      for (const entry of [
        rig.deckA,
        rig.deckC,
        rig.deckB,
        rig.cornerFill,
        rig.ventPipe,
        ...rig.obstacles,
      ]) {
        entry.mesh.removeFromParent();
        this.physics.world.removeRigidBody(entry.body);
      }
      rig.beam.removeFromParent();
      rig.turnMarker.removeFromParent();
    }
    this.rigs.clear();
  }
}
