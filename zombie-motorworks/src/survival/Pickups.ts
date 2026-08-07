/**
 * Supply crates scattered across the arena. A small, fixed number of slots
 * exist at once; each one rolls a kind from `dropTable` when it spawns and
 * only comes back a good while after it is collected, so a resupply is
 * something to drive toward rather than a given.
 *
 * A live slot is three things stacked on one spot: a soft pool of light on the
 * ground, the kind's own hovering block above it (`pickupModels`), and the
 * kind's name overhead with an arrow pointing back down at it. Silhouette,
 * word and colour all say the same thing, so no one of them has to carry it.
 *
 * What a kind is worth is not decided here — the owning mode passes a
 * `collect` handler and answers whether the crate was actually spent, exactly
 * the way a full tank leaves a fuel crate standing.
 */

import * as THREE from 'three';
import type { RuntimeVehicle } from '../runtime/vehicle.ts';
import { PICKUP_KINDS, rollPickupKind, type PickupKind } from './dropTable.ts';
import {
  buildPickupModel,
  buildSalvagePartModel,
  createGroundGlowTexture,
  createLabelTexture,
  disposePickupModel,
} from './pickupModels.ts';

interface MapBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Slots on the map at once. Fuel used to own three permanent slots of its own;
 * five now cover six kinds between them, so there is more to find and less of
 * it is fuel.
 */
const SLOT_COUNT = 5;
const INITIAL_DELAY_MIN = 8;
const INITIAL_DELAY_MAX = 34;

const PICKUP_RADIUS = 2.8; // horizontal metres to collect
const PICKUP_RADIUS_SQ = PICKUP_RADIUS * PICKUP_RADIUS;
const EDGE_MARGIN = 8; // keep crates clear of the perimeter walls
const MIN_VEHICLE_DISTANCE = 12; // never drop one on top of the player
const MIN_VEHICLE_DISTANCE_SQ = MIN_VEHICLE_DISTANCE * MIN_VEHICLE_DISTANCE;

const BASE_Y = 1.05; // hover height of the block's centre
const BOB_AMPLITUDE = 0.16;
const BOB_RATE = 2.1; // rad/s
const SPIN_RATE = 0.9; // rad/s
const GLOW_SIZE_M = 3.6;
const GLOW_HEIGHT_M = 0.06; // just clear of the ground, no z-fighting
const GLOW_OPACITY = 0.5;
// Clear of the block with daylight between the two, so the arrow has somewhere
// to point and the word never sits on the hardware it is naming.
const LABEL_Y = 2.75;
const LABEL_WIDTH = 2.2;
const LABEL_HEIGHT = 1.1;

/** A crate the player drove into: what it was, and where it was standing. */
export interface CollectedPickup {
  readonly kind: PickupKind;
  readonly x: number;
  readonly z: number;
  /**
   * For a salvage crate, the block it has been showing since it spawned. The
   * crate draws what it is carrying, so what it hands over is decided on
   * spawn rather than on collection.
   */
  readonly defId: string | null;
}

/**
 * Runs when the vehicle reaches a crate. Returning false leaves the crate
 * where it is (a full tank driving over fuel), so the handler decides what
 * counts as spending one.
 */
export type PickupCollector = (pickup: CollectedPickup) => boolean;

/** Picks the block a salvage crate will carry, or null when none is available. */
export type SalvageRoll = () => { defId: string; name: string } | null;

interface Slot {
  /** Anchored on the ground: carries the glow, the riser and the label. */
  readonly group: THREE.Group;
  readonly glow: THREE.Mesh;
  readonly label: THREE.Sprite;
  /** Bobs and spins; holds the current kind's cloned block. */
  readonly riser: THREE.Group;
  model: THREE.Object3D | null;
  /** Set when `model`/`label` are this slot's own to free, not shared clones. */
  ownedModel: THREE.Object3D | null;
  ownedLabel: THREE.SpriteMaterial | null;
  /** The block a salvage crate is carrying; null for every other kind. */
  defId: string | null;
  active: boolean;
  kind: PickupKind;
  cooldown: number; // seconds until this spot spawns again
  x: number;
  z: number;
  phase: number; // bob/spin animation offset
}

/** Minimap marker for one live crate. */
export interface PickupMarker {
  readonly x: number;
  readonly z: number;
  readonly color: string;
}

export class Pickups {
  private readonly root = new THREE.Group();
  private readonly slots: Slot[] = [];
  private readonly markerSnapshot: PickupMarker[] = [];
  private disposed = false;

  // Owned, shared visuals: one block template, one glow material and one label
  // per kind, built once and worn by whichever slot is showing that kind.
  private readonly models = new Map<PickupKind, THREE.Group>();
  private readonly glowGeometry = new THREE.PlaneGeometry(GLOW_SIZE_M, GLOW_SIZE_M);
  private readonly glowTexture = createGroundGlowTexture();
  private readonly glowMaterials = new Map<PickupKind, THREE.MeshBasicMaterial>();
  private readonly labelMaterials = new Map<PickupKind, THREE.SpriteMaterial>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly vehicle: RuntimeVehicle,
    private readonly bounds: MapBounds,
    private readonly collect: PickupCollector,
    private readonly rollSalvage: SalvageRoll,
    private readonly random: () => number = Math.random,
  ) {
    this.root.name = 'pickups';
    this.scene.add(this.root);
    for (const kind of Object.keys(PICKUP_KINDS) as PickupKind[]) {
      this.buildKindAssets(kind);
    }
    for (let i = 0; i < SLOT_COUNT; i++) this.slots.push(this.createSlot());
  }

  private buildKindAssets(kind: PickupKind): void {
    const spec = PICKUP_KINDS[kind];
    this.models.set(kind, buildPickupModel(kind, spec.color));
    this.glowMaterials.set(
      kind,
      new THREE.MeshBasicMaterial({
        color: spec.color,
        map: this.glowTexture,
        transparent: true,
        opacity: GLOW_OPACITY,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.labelMaterials.set(
      kind,
      new THREE.SpriteMaterial({
        map: createLabelTexture(spec.label, spec.minimapColor),
        transparent: true,
        depthWrite: false,
      }),
    );
  }

  private createSlot(): Slot {
    const group = new THREE.Group();
    group.visible = false;

    // A pool of light rather than a ring on the floor: the crate should look
    // lit where it stands, not stencilled onto the terrain.
    const glow = new THREE.Mesh(this.glowGeometry, this.glowMaterials.get('fuel'));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = GLOW_HEIGHT_M;
    group.add(glow);

    // No real light source here on purpose: toggling a light's visibility
    // changes the scene's active-light count, which makes three.js recompile
    // every material in the scene (a hard frame spike on spawn/collect). The
    // unlit glow above reads as a beacon without touching lighting.

    const riser = new THREE.Group();
    riser.position.y = BASE_Y;
    group.add(riser);

    const label = new THREE.Sprite(this.labelMaterials.get('fuel'));
    label.position.y = LABEL_Y;
    label.scale.set(LABEL_WIDTH, LABEL_HEIGHT, 1);
    group.add(label);

    this.root.add(group);

    return {
      group,
      glow,
      label,
      riser,
      model: null,
      ownedModel: null,
      ownedLabel: null,
      defId: null,
      active: false,
      kind: 'fuel',
      cooldown:
        INITIAL_DELAY_MIN +
        this.random() * (INITIAL_DELAY_MAX - INITIAL_DELAY_MIN),
      x: 0,
      z: 0,
      phase: this.random() * Math.PI * 2,
    };
  }

  /** Advance respawn timers and collect any crate the vehicle is sitting on. */
  step(dt: number): void {
    if (this.disposed) return;
    const pos = this.vehicle.body.translation();
    for (const slot of this.slots) {
      if (!slot.active) {
        slot.cooldown -= dt;
        if (slot.cooldown <= 0) this.spawn(slot, pos);
        continue;
      }
      const dx = pos.x - slot.x;
      const dz = pos.z - slot.z;
      if (dx * dx + dz * dz > PICKUP_RADIUS_SQ) continue;
      const spent = this.collect({
        kind: slot.kind,
        x: slot.x,
        z: slot.z,
        defId: slot.defId,
      });
      if (spent) this.take(slot);
    }
  }

  /** Live crate positions and colours for the minimap, backed by a reused array. */
  activeMarkers(): readonly PickupMarker[] {
    this.markerSnapshot.length = 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      this.markerSnapshot.push({
        x: slot.x,
        z: slot.z,
        color: PICKUP_KINDS[slot.kind].minimapColor,
      });
    }
    return this.markerSnapshot;
  }

  private spawn(slot: Slot, vehiclePos: { x: number; z: number }): void {
    const point = this.pickLocation(vehiclePos);
    slot.kind = rollPickupKind(this.random);
    slot.glow.material = this.glowMaterials.get(slot.kind)!;
    this.releaseOwned(slot);

    // A salvage crate shows the block it is carrying, named on its own label;
    // every other kind wears the shared template and the kind's own word.
    const salvage = slot.kind === 'part' ? this.rollSalvage() : null;
    slot.defId = salvage?.defId ?? null;
    const salvageModel =
      salvage === null ? null : buildSalvagePartModel(salvage.defId);

    if (salvage !== null && salvageModel !== null) {
      slot.ownedModel = salvageModel;
      slot.ownedLabel = new THREE.SpriteMaterial({
        map: createLabelTexture(
          salvage.name.toUpperCase(),
          PICKUP_KINDS.part.minimapColor,
        ),
        transparent: true,
        depthWrite: false,
      });
      slot.label.material = slot.ownedLabel;
    } else {
      slot.defId = null;
      slot.label.material = this.labelMaterials.get(slot.kind)!;
    }

    // Clones share the template's geometry and materials, so swapping the
    // block a slot is showing costs a handful of objects and no GPU upload.
    if (slot.model !== null) slot.riser.remove(slot.model);
    slot.model = slot.ownedModel ?? this.models.get(slot.kind)!.clone();
    slot.riser.add(slot.model);
    slot.riser.rotation.y = this.random() * Math.PI * 2;
    slot.x = point.x;
    slot.z = point.z;
    slot.active = true;
    slot.group.position.set(point.x, 0, point.z);
    slot.group.visible = true;
  }

  /** Free the per-spawn model and label a salvage crate built for itself. */
  private releaseOwned(slot: Slot): void {
    if (slot.ownedModel !== null) {
      slot.riser.remove(slot.ownedModel);
      disposePickupModel(slot.ownedModel);
      if (slot.model === slot.ownedModel) slot.model = null;
      slot.ownedModel = null;
    }
    if (slot.ownedLabel !== null) {
      slot.ownedLabel.map?.dispose();
      slot.ownedLabel.dispose();
      slot.ownedLabel = null;
    }
  }

  private take(slot: Slot): void {
    slot.active = false;
    slot.cooldown = PICKUP_KINDS[slot.kind].respawnSeconds;
    slot.group.visible = false;
  }

  private pickLocation(vehiclePos: { x: number; z: number }): {
    x: number;
    z: number;
  } {
    const minX = this.bounds.minX + EDGE_MARGIN;
    const maxX = this.bounds.maxX - EDGE_MARGIN;
    const minZ = this.bounds.minZ + EDGE_MARGIN;
    const maxZ = this.bounds.maxZ - EDGE_MARGIN;
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      x = minX + this.random() * (maxX - minX);
      z = minZ + this.random() * (maxZ - minZ);
      const dx = x - vehiclePos.x;
      const dz = z - vehiclePos.z;
      if (dx * dx + dz * dz >= MIN_VEHICLE_DISTANCE_SQ) break;
    }
    return { x, z };
  }

  /** Bob and turn the live blocks so they read as collectible beacons. */
  updateVisuals(frameDt: number): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.phase += frameDt;
      slot.riser.position.y =
        BASE_Y + Math.sin(slot.phase * BOB_RATE) * BOB_AMPLITUDE;
      slot.riser.rotation.y += SPIN_RATE * frameDt;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.root);
    this.root.clear();
    for (const slot of this.slots) this.releaseOwned(slot);
    this.glowGeometry.dispose();
    this.glowTexture.dispose();
    for (const material of this.glowMaterials.values()) material.dispose();
    for (const material of this.labelMaterials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    for (const model of this.models.values()) disposePickupModel(model);
    this.glowMaterials.clear();
    this.labelMaterials.clear();
    this.models.clear();
    this.slots.length = 0;
  }
}
