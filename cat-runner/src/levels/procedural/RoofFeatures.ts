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
 * `v = sqrt(2 * |gravity| * apex)`, `apex = TIER_RISE + LANDING_MARGIN`. The
 * apex framing alone understates what actually has to be guaranteed, though:
 * the deck the player lands on is 3 units *higher* than the pad, so they
 * touch back down on the way *down* the arc, at whatever height matches the
 * new tier - not at the bottom, and not at the apex. What actually has to be
 * reachable is the *horizontal* distance from the pad to the far edge of the
 * gap it opens (`TRAMPOLINE_LOCAL_Z` to `GAP_END_Z`, both in
 * `ChunkBuilder.ts`/`ChunkTypes.ts` - 7.7 units as of this writing) in the
 * time it takes to descend from launch back to landing height, and it has to
 * hold at the *slowest* speed the game ever runs at - `PHYSICS.baseRunSpeed *
 * SPEED_RAMP_START_MULTIPLIER` (7.7 u/s), the speed every run and every
 * tutorial attempt opens at.
 *
 * At the old tuning (`LANDING_MARGIN = 1.0`, `v = 12.0`), that descent takes
 * exactly 1.0s - and `7.7 u/s * 1.0s = 7.7`, precisely the distance needed,
 * with zero margin. Any friction, timing or discretization noise was enough
 * to turn a textbook-correct landing into a miss; worse, it's worst exactly
 * where a first-time player is most likely to meet their first trampoline.
 *
 * `LANDING_MARGIN = 3.25` (giving `v = 15.0`) is chosen to clear that with
 * real margin instead of exactly meeting it: solving `speed_min * t_land =
 * D_clear + slack` for `slack ≈ 2.5` gives `v ≈ 14.2` as the bare minimum
 * needed; 15.0 is the clean round number above that, landing at **~3.3 units
 * of horizontal margin - about 43% more than the bare minimum - at the
 * slowest speed the game ever runs**, and comfortably more at any faster
 * one. The apex this produces (6.25 units above launch, more than double the
 * 3-unit rise) is a deliberately dramatic bounce, not an accident of the
 * math - launches should read as obviously, comfortably higher than the gap
 * needs, not as a jump tuned to the metre.
 *
 * `TIER_RISE` (below) is the same constant for every transition regardless
 * of which pair of tiers it's between (`ROOF_TIER_HEIGHT` steps uniformly by
 * 3), so this one derivation already covers LOW->MEDIUM and MEDIUM->HIGH
 * identically - there is no separate tuning needed, or possible, per
 * transition. A direct LOW->HIGH transition (skipping MEDIUM) is not
 * something to verify reachable, because it cannot be generated at all:
 * `RoofDirector.next()` only ever steps tier by exactly one per gap chunk.
 *
 * `tests/trampoline.test.ts` proves this against real physics (a genuinely
 * simulated `PlayerController`, not just this arithmetic) at the worst-case
 * speed, for both transitions - see that file for why algebra alone isn't
 * treated as sufficient proof here.
 */
const TIER_RISE = ROOF_TIER_HEIGHT[ROOF_MEDIUM] - ROOF_TIER_HEIGHT[ROOF_LOW];
const LANDING_MARGIN = 3.25;
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

/**
 * How close (world units, horizontal XZ only) the player has to be to
 * trigger the launch - paired with {@link TRAMPOLINE_CATCH_ABOVE}/
 * {@link TRAMPOLINE_CATCH_BELOW} for the vertical band, rather than one 3D
 * radius: a single sphere can't be both "generous enough to catch a runner
 * mid-jump" and "tight enough to still mean centre lane" at once, since a
 * radius wide enough to cover a jump apex vertically also widens the
 * horizontal tolerance at every other height. A cylinder keeps the two
 * independent. Nudged up slightly from the original 1.4 (still comfortably
 * under half of `PHYSICS.laneSpacing`, 2.4, so an adjacent, uncommitted lane
 * still doesn't false-trigger at the pad's own Z) - see `ChunkBuilder.step()`'s
 * trigger check for the fuller story of what this replaces and why.
 */
export const TRAMPOLINE_TRIGGER_RADIUS = 1.6;
/**
 * How far above the pad's own Y (world units) the trigger still counts - the
 * "safety activation zone" that catches a runner who jumped shortly before
 * reaching the pad, rather than only one already `grounded` on it. A
 * standing jump's apex, in capsule-*centre* terms (what `PlayerController`
 * actually reports), is `jumpImpulse²/(2·|gravity|) + capsuleFeetOffset()` ≈
 * `1.73 + 0.5` = 2.23 - this clears that with a little margin, while staying
 * safely under the ~3.5-unit vertical gap to the *next* tier's own deck
 * (`ROOF_TIER_HEIGHT`'s 3-unit step + the same 0.5 capsule offset), so a
 * runner standing on the tier above can never spuriously trigger a pad on
 * the tier below it.
 */
export const TRAMPOLINE_CATCH_ABOVE = 2.4;
/** Small tolerance below the pad's own Y - numerical/step jitter margin,
 *  not a real "rescue from below deck" zone. */
export const TRAMPOLINE_CATCH_BELOW = 0.3;

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

