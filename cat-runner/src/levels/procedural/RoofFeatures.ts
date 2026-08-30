import * as THREE from 'three';
import { PHYSICS } from '../../physics/PhysicsConfig';
import {
  buildAcUnit,
  buildChimney,
  buildRoofFan,
  buildSatelliteDish,
  buildWaterTank,
  freezeStatic,
  getMaterial,
  PALETTE,
} from '../../assets/ProceduralProps';
import { ROOF_LOW, ROOF_MEDIUM, ROOF_TIER_HEIGHT, type ChunkType, type RoofTier } from './ChunkTypes';
import { CHUNK_LENGTH, DECK_WIDTH } from '../TrackConfig';
import type { Rng } from './ChunkGenerators';

/**
 * Rooftop-to-rooftop traversal: three roof height tiers, a trampoline that
 * makes stepping up to a higher one automatic and predictable, and a
 * handful of purely decorative rooftop props.
 *
 * Height only ever changes on a `'jump'` chunk - a gap - and only ever by
 * one tier per chunk (`RoofDirector.next()` enforces both). Tying the
 * change to the gap itself (rather than an ordinary `'straight'` chunk, as
 * an earlier pass had it) is what makes a height step something the player
 * actually jumps across instead of an invisible step at a chunk boundary:
 * deck A sits at the old tier, the gap opens, deck B sits at the new one -
 * see `ChunkBuilder.placeChunk()`'s `atPrev`/`at` split. "The differences
 * stay small and readable" is a property of the *generator*, not a rule the
 * player has to intuit, and it keeps a height change from ever compounding
 * with a turn in the same 30-unit span (turns and gaps are already
 * mutually exclusive chunk types).
 */

// ---------------------------------------------------------------------------
// Tiers
//
// RoofTier/ROOF_TIER_HEIGHT/PARAPET_SIZE live in ChunkTypes.ts, not here -
// ChunkSpec itself carries a RoofTier, and every other chunk-geometry
// constant already lives there, so this is that file's job, not this one's.
// ---------------------------------------------------------------------------

/**
 * Vertical takeoff speed a trampoline launch gives the player - re-derived
 * directly from the real tier rise rather than as a multiplier on the
 * standing jump, now that the rise is large enough to matter on its own
 * terms (tiers only ever change by one step, see `RoofDirector`).
 *
 * `v = sqrt(2 * |gravity| * apex)`, `apex = TIER_RISE + LANDING_MARGIN`.
 * The previous tuning (a 1-unit rise, back when `ROOF_TIER_HEIGHT` stepped
 * by 1) targeted `STANDING_JUMP_APEX * 2.7` instead - "much higher than a
 * normal jump" stated in terms of the jump it had to visibly beat, since the
 * rise itself was trivial next to any apex worth having. With `TIER_RISE`
 * now 3 (a real storey, not a step), the rise itself is the thing that has
 * to be cleared with margin, so this targets that directly:
 * `apex = 3 + 1.0 = 4.0`, `velocity = sqrt(2*18*4) = 12.0` - still clears
 * the standing jump's own apex (`jumpImpulse^2 / (2*|gravity|)` = 1.73) by a
 * wide, dramatic margin, same as before.
 *
 * Hang time (`2*velocity/|gravity|` = 1.333s) at `PHYSICS.runSpeed` (11)
 * covers ~14.67 horizontal units - just inside `CHUNK_LENGTH` (15), matching
 * the "does not fling the player over the chunk beyond the one it launches
 * from" boundary the old multiplier was chosen against (`tests/roof.test.ts`
 * checks `< CHUNK_LENGTH` directly, so this is re-verified, not assumed).
 * A *stacked* Catnip Rush + late-game speed-ramp launch can still carry
 * further than that - accepted, not engineered around, since overshoot here
 * only skips track during an already-privileged temporary buff and never
 * creates a hazard.
 */
const TIER_RISE = ROOF_TIER_HEIGHT[ROOF_MEDIUM] - ROOF_TIER_HEIGHT[ROOF_LOW];
const LANDING_MARGIN = 1.0;
export const TRAMPOLINE_LAUNCH_VELOCITY = Math.sqrt(2 * Math.abs(PHYSICS.gravity) * (TIER_RISE + LANDING_MARGIN));

/**
 * Only `'jump'` chunks (gaps) may change tier - see the module doc comment.
 *
 * Lower than the 0.45 an earlier pass used: this now rolls on every gap,
 * and gaps are themselves far more frequent than `'straight'` chunks used
 * to be (see `ChunkDirector.SECTION_WEIGHTS`), so a chance sized for the old
 * trigger would have switched height back and forth almost every other
 * gap. At 0.2, roughly four in five gaps are same-height - a height holds
 * for several chunks before the next transition, per spec - and the one in
 * five that does transition still can't repeat two chunks running, because
 * `'jump'` chunks are never adjacent (every other chunk type sits between
 * them).
 */
const TIER_CHANGE_CHANCE = 0.2;

export interface RoofTransition {
  readonly tier: RoofTier;
  /** The tier the *previous* chunk sat at - needed on top of `tier` because
   *  the trampoline pad sits at the OLD height (the low side of the step),
   *  not this chunk's own new one. */
  readonly previousTier: RoofTier;
  /** True the one chunk a tier increase happens on - `ChunkBuilder` places a
   *  trampoline on deck A, just before the gap, still at `previousTier`. */
  readonly trampoline: boolean;
}

/**
 * Decides each chunk's roof tier, one chunk at a time - the tier-progression
 * analogue of `ChunkDirector`'s own turn/hazard state machine, and
 * deliberately just as stateful: unlike the fully-decided-by-index skyline
 * in `Buildings.ts`, a roof's height is baked into `ChunkSpec` once and
 * never recomputed, so this only ever needs to remember the *previous*
 * chunk's tier, not the whole history.
 */
export class RoofDirector {
  private tier: RoofTier = 0;

  next(chunkType: ChunkType, rng: Rng): RoofTransition {
    const previousTier = this.tier;
    if (chunkType !== 'jump' || rng() >= TIER_CHANGE_CHANCE) {
      return { tier: previousTier, previousTier, trampoline: false };
    }

    // At an extreme, the only legal step is back off it; otherwise either
    // direction is fair game.
    const canRise = previousTier < 2;
    const canFall = previousTier > 0;
    const goUp = canRise && (!canFall || rng() < 0.5);
    const newTier = (previousTier + (goUp ? 1 : -1)) as RoofTier;

    this.tier = newTier;

    return { tier: newTier, previousTier, trampoline: goUp };
  }
}

// ---------------------------------------------------------------------------
// Trampoline - visual-only pad; ChunkBuilder triggers the launch itself via
// a position check against `PlayerController.launchUpward()`, the same
// manual-overlap pattern the slide beam already uses rather than a Rapier
// sensor.
// ---------------------------------------------------------------------------

const PAD_MAT = getMaterial(PALETTE.fabricRed);
const PAD_RIM_MAT = getMaterial(PALETTE.metalDark);
const PAD_LEG_MAT = getMaterial(PALETTE.metal);

/** How close (world units) the player has to be to trigger the launch. */
export const TRAMPOLINE_TRIGGER_RADIUS = 1.4;

function buildTrampolinePad(): THREE.Group {
  const group = new THREE.Group();

  const bed = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.15, 12), PAD_MAT);
  bed.position.y = 0.35;
  bed.castShadow = true;
  group.add(bed);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 6, 12), PAD_RIM_MAT);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.35;
  group.add(rim);

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 6), PAD_LEG_MAT);
    leg.position.set(Math.cos(angle) * 0.75, 0.175, Math.sin(angle) * 0.75);
    leg.castShadow = true;
    group.add(leg);
  }

  group.visible = false;
  return group;
}

export class TrampolinePool {
  private readonly pads = new Map<number, THREE.Group>();

  constructor(private readonly scene: THREE.Object3D) {}

  padFor(slot: number): THREE.Group {
    const existing = this.pads.get(slot);
    if (existing) return existing;
    const pad = buildTrampolinePad();
    this.scene.add(pad);
    this.pads.set(slot, pad);
    return pad;
  }

  place(slot: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    const pad = this.padFor(slot);
    pad.visible = true;
    pad.position.copy(position);
    pad.quaternion.copy(quaternion);
  }

  hide(slot: number): void {
    const pad = this.pads.get(slot);
    if (pad) pad.visible = false;
  }

  dispose(): void {
    for (const pad of this.pads.values()) pad.removeFromParent();
    this.pads.clear();
  }
}

// ---------------------------------------------------------------------------
// Rooftop props - purely decorative, no collider. Built once per streamer
// slot with every kind present as a child, toggled the same way
// `PowerUpPool` swaps between its sculpted models.
// ---------------------------------------------------------------------------

export type PropKind = 'acUnit' | 'chimney' | 'waterTank' | 'satelliteDish' | 'vent';
const PROP_KINDS: readonly PropKind[] = ['acUnit', 'chimney', 'waterTank', 'satelliteDish', 'vent'];

export interface PropPlacement {
  readonly kind: PropKind;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Chance any given chunk gets a prop at all - most chunks should have one,
 *  per "most props should be decorative" (i.e. common), but not literally
 *  every chunk, or the roofline stops reading as varied. */
const PROP_CHANCE = 0.6;
/** Kept well outside the lane span (`PHYSICS.laneSpacing * 2` from centre,
 *  ~2.4u) and well inside the deck edge (`DECK_WIDTH / 2` = 7u), so a prop
 *  never has to be avoided - it was never in the way. */
const PROP_X_OFFSET = DECK_WIDTH / 2 - 2;

export function generateRoofProp(hasGap: boolean, rng: Rng): PropPlacement | null {
  if (rng() >= PROP_CHANCE) return null;

  const kind = PROP_KINDS[Math.floor(rng() * PROP_KINDS.length)];
  const side = rng() < 0.5 ? -1 : 1;

  let z = 4 + rng() * (CHUNK_LENGTH - 8);
  if (hasGap) {
    // GAP_START_Z/GAP_END_Z aren't imported to avoid a cycle with
    // ChunkTypes - the gap is always centred in the chunk, so a prop kept
    // out of the middle third clears it with margin either way.
    const third = CHUNK_LENGTH / 3;
    z = rng() < 0.5 ? third * 0.4 : CHUNK_LENGTH - third * 0.4;
  }

  return { kind, x: side * PROP_X_OFFSET, z, yaw: rng() * Math.PI * 2 };
}

/**
 * Roughly 2x world size, on top of each shape's own authored `scale` option
 * - a request to make rooftop dressing "clearly visible from a distance"
 * (the same ask power-up scale got, see `PowerUpModels.ts`). Applied as one
 * outer group scale per prop rather than doubling each internal dimension in
 * `ProceduralProps.ts`, so the shared builder functions (and whatever else
 * might call them at their original size) are untouched.
 */
const PROP_SCALE = 2;

function buildPropSet(): Record<PropKind, THREE.Group> {
  const set = {
    acUnit: buildAcUnit(),
    chimney: buildChimney(),
    waterTank: buildWaterTank({ scale: 0.85 }),
    satelliteDish: buildSatelliteDish({ scale: 0.8 }),
    vent: buildRoofFan({ scale: 1.1 }),
  };
  for (const kind of PROP_KINDS) {
    const prop = set[kind];
    // Purely decorative dressing, one of several per visible chunk - the
    // shadow pass re-renders every caster's geometry a second time, and
    // none of these are large or close enough to the camera for a missing
    // self-shadow to actually read. `ProceduralProps.ts`'s own builders
    // mark most of their meshes `castShadow: true` since they're shared
    // with contexts where that does matter (e.g. street-level props at
    // eye height) - overridden here rather than there, so this stays
    // scoped to rooftop dressing specifically.
    //
    // Done *before* `freezeStatic` on purpose: the shadow flags are part of
    // its bucket key, so flattening them first is what lets a whole prop
    // collapse into one mesh per colour instead of one per (colour, flag)
    // pair.
    prop.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = false;
    });

    // A prop is modelled as a dozen-odd primitives (an AC unit is a shell,
    // a grille, four feet and a fan housing) and each one was its own draw
    // call. They never move relative to the prop and they draw from a
    // handful of shared palette materials, which is exactly the case
    // `freezeStatic` exists for: it bakes each static mesh's local
    // transform into its vertices and merges by material, leaving one mesh
    // per colour. The fan's blades opt out via `markAnimated` and keep
    // spinning.
    //
    // This also shrinks the scene graph, which matters just as much: a rig
    // is built per streamer slot with *every* kind present and all but one
    // hidden, and `updateMatrixWorld` walks hidden nodes too.
    freezeStatic(prop);

    // After the merge - `freezeStatic` works in the prop's own frame, but
    // scaling first would mean baking geometry that is then scaled again.
    prop.scale.setScalar(PROP_SCALE);
  }
  return set;
}

export interface PropSlotRig {
  readonly root: THREE.Group;
  readonly byKind: Record<PropKind, THREE.Group>;
}

export class RoofPropPool {
  private readonly rigs = new Map<number, PropSlotRig>();

  constructor(private readonly scene: THREE.Object3D) {}

  rigFor(slot: number): PropSlotRig {
    const existing = this.rigs.get(slot);
    if (existing) return existing;

    const root = new THREE.Group();
    root.visible = false;
    const byKind = buildPropSet();
    for (const kind of PROP_KINDS) {
      byKind[kind].visible = false;
      root.add(byKind[kind]);
    }
    this.scene.add(root);

    const rig: PropSlotRig = { root, byKind };
    this.rigs.set(slot, rig);
    return rig;
  }

  place(slot: number, placement: PropPlacement, position: THREE.Vector3): void {
    const rig = this.rigFor(slot);
    rig.root.visible = true;
    rig.root.position.copy(position);
    for (const kind of PROP_KINDS) rig.byKind[kind].visible = kind === placement.kind;
    rig.byKind[placement.kind].rotation.y = placement.yaw;
  }

  hide(slot: number): void {
    const rig = this.rigs.get(slot);
    if (rig) rig.root.visible = false;
  }

  dispose(): void {
    for (const rig of this.rigs.values()) {
      // Everything a prop is built from is cache-owned by `ProceduralProps`
      // *except* the geometry `freezeStatic` merges, which is minted per rig
      // and would otherwise leak a buffer per prop per slot.
      rig.root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry?.userData.merged) mesh.geometry.dispose();
      });
      rig.root.removeFromParent();
    }
    this.rigs.clear();
  }
}

