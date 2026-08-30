import * as THREE from 'three';
import type { Lane } from '../chunkTemplate';
import type { Rng } from './ChunkGenerators';
import type { SectionType } from './SectionDirector';
import { POWERUP_RANDOM_SPAWN_CHANCE, POWERUP_TUNING } from './PowerUpConfig';
import {
  GAP_END_Z,
  GAP_START_Z,
  TURN_MARKER_LOCAL_Z,
  type ChunkSpec,
  type PowerUpPlacement,
  type PowerUpType,
} from './ChunkTypes';
import {
  buildEnergyDrinkModel,
  buildHeartModel,
  buildMagnetModel,
  buildShieldModel,
  disposeIfOwned,
} from './PowerUpModels';

/**
 * Placement (this file) is procedural-generation data, exactly like an
 * obstacle or a fish - *where* a pickup goes and *which* type it is.
 * *What picking it up does* lives entirely in `src/game/PowerUpManager.ts`,
 * which knows about lives/speed/score and this file never needs to.
 */

const POWERUP_TYPES: readonly PowerUpType[] = ['fishMagnet', 'catnipRush', 'nineLives', 'shield'];

/**
 * Candidate chunk-local (lane, z) spots checked for a clear placement -
 * near the head/centre/tail of `CHUNK_LENGTH` (15; was `[4, 15, 26]` against
 * the 30-unit grid, rescaled in the same proportions - head/tail margin
 * roughly 13% of the chunk in, centre dead on `CHUNK_LENGTH * 0.5`, which is
 * deliberately the same spot `BEAM_LOCAL_Z`/`VENT_PIPE_LOCAL_Z` sit at, see
 * `findSafeSpot`'s own doc comment for why that coincidence matters).
 * Deliberately close to the edges rather than an even quarter/half/three-
 * quarter split: the gap a jump chunk opens (`GAP_START_Z`..`GAP_END_Z`) plus
 * `CLEARANCE` padding excludes most of the chunk's centre, so at least the
 * two edge candidates need to survive that exclusion for a jump chunk to
 * ever get a power-up.
 */
const CANDIDATE_Z: readonly number[] = [2, 7.5, 13];
const CANDIDATE_LANES: readonly Lane[] = [-1, 0, 1];
/** How close a candidate spot must stay from any obstacle (or the gap) at a
 *  similar Z to be considered blocked. A pickup missed isn't punishing the
 *  way a hazard misjudged is, so this can run tighter than
 *  `MIN_HAZARD_SPACING`. Was 4 against the 30-unit grid; halved to 2 along
 *  with everything else when it shrank to 15 - at the old value, the gap's
 *  own exclusion zone (`GAP_START_Z - CLEARANCE` .. `GAP_END_Z + CLEARANCE`)
 *  would have swallowed the *entire* new, much shorter chunk, leaving a jump
 *  chunk with nowhere a power-up could ever spawn. */
const CLEARANCE = 2;

function pickType(rng: Rng): PowerUpType {
  const total = POWERUP_TYPES.reduce((sum, t) => sum + POWERUP_TUNING[t].spawnWeight, 0);
  let roll = rng() * total;
  for (const type of POWERUP_TYPES) {
    roll -= POWERUP_TUNING[type].spawnWeight;
    if (roll <= 0) return type;
  }
  return POWERUP_TYPES[POWERUP_TYPES.length - 1];
}

/**
 * A power-up is only ever placed somewhere it can be collected without also
 * having to clear a hazard - reading `spec`'s actual geometry rather than
 * assuming any chunk type is "safe," so this keeps working correctly however
 * chunk generation changes later.
 *
 * Returns `null` when the chunk genuinely has nowhere clear, rather than
 * falling back to a fixed spot. That fallback used to return the centre
 * candidate `{ lane: 0, z: 15 }` *without checking it against anything*, which
 * meant the one case where placement was hardest was the one case it gave up
 * and dropped the pickup wherever it landed. A chunk with no room is not a
 * chunk that needs a power-up.
 *
 * Every hazard on the chunk has to be represented here, and the reason this
 * went wrong is instructive: the original only knew about `obstacles` and
 * `hasGap`. It had no idea `beamZ` existed - so on a 'slide' chunk, whose beam
 * sits at `BEAM_LOCAL_Z` (`CHUNK_LENGTH * 0.5`) and spans *all three lanes*,
 * the centre candidate row (also `CHUNK_LENGTH * 0.5` - deliberately the same
 * spot, see `CANDIDATE_Z`'s own doc comment) was considered perfectly clear
 * in every lane, and a third of that chunk type's candidate spots put the
 * pickup literally inside the barrier. That is the "power-ups spawn inside
 * the obstacle" bug.
 */
function findSafeSpot(spec: ChunkSpec, rng: Rng): { lane: Lane; z: number } | null {
  const candidates: { lane: Lane; z: number }[] = [];
  for (const lane of CANDIDATE_LANES) {
    for (const z of CANDIDATE_Z) {
      const inGap = spec.hasGap && z > GAP_START_Z - CLEARANCE && z < GAP_END_Z + CLEARANCE;
      if (inGap) continue;

      // The slide beam spans the full deck width, so it rules out a Z outright
      // rather than a single (lane, Z) the way a crate does.
      if (spec.beamZ !== null && Math.abs(spec.beamZ - z) < CLEARANCE) continue;

      // Same reasoning as the beam above: the vent pipe also spans every
      // lane, so it rules out the whole Z rather than one (lane, Z) pair.
      if (spec.ventZ !== null && Math.abs(spec.ventZ - z) < CLEARANCE) continue;

      // The turn marker is a cone, not a hazard - nothing is hurt by touching
      // it. It is excluded anyway because a pickup buried inside it looks
      // exactly like the bug above, and "reads as broken" is reason enough
      // when the cost is one candidate spot on turn chunks only.
      if (
        spec.turn &&
        spec.turn.dir === lane &&
        Math.abs(TURN_MARKER_LOCAL_Z - z) < CLEARANCE
      ) {
        continue;
      }

      const blocked = spec.obstacles.some(
        (o) => o.lane === lane && Math.abs(o.z - z) < CLEARANCE,
      );
      if (!blocked) candidates.push({ lane, z });
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

/**
 * Decides whether this chunk gets a power-up, and if so where/which.
 * Guaranteed on `'reward'` sections (the whole point of a reward); a small
 * random chance elsewhere (`POWERUP_RANDOM_SPAWN_CHANCE`) so they still turn
 * up unpredictably rather than only ever on the same beat.
 *
 * "Guaranteed" is guaranteed *subject to there being a clear spot* - a reward
 * section whose chunk has nowhere safe yields no pickup rather than one jammed
 * into a hazard. `SectionDirector` runs reward sections over several chunks, so
 * skipping one is invisible; a pickup inside a barrier is not.
 */
export function generatePowerUp(
  spec: ChunkSpec,
  section: SectionType,
  rng: Rng,
): PowerUpPlacement | null {
  const guaranteed = section === 'reward';
  if (!guaranteed && rng() > POWERUP_RANDOM_SPAWN_CHANCE) return null;

  const spot = findSafeSpot(spec, rng);
  if (!spot) return null;
  return { kind: pickType(rng), lane: spot.lane, z: spot.z };
}

// -------------------------------------------------------------------------
// Pooling - one pickup rig per streamer slot (at most one power-up per
// chunk). Every remaining type (shield/nineLives/fishMagnet/catnipRush) gets
// its own sculpted model (see PowerUpModels.ts) - there is no shared generic
// gem any more, now that Golden Fish/Super Jump (the two types that used to
// fall back to it) are gone. Every model is built once per slot and only
// ever toggled visible/invisible - the same build-once-toggle-visibility
// convention `FishPool`/`ChunkBuilder`'s own obstacle pooling already use,
// rather than rebuilding meshes per placement.
// -------------------------------------------------------------------------

export interface PowerUpEntry {
  readonly root: THREE.Group;
  readonly shield: THREE.Group;
  readonly heart: THREE.Group;
  readonly magnet: THREE.Group;
  /** Catnip Rush's world pickup - the energy-drink can (or the procedural
   *  sneaker, if the GLB never arrived). Named for what it is rather than
   *  `sneakers`, which it stopped being when the model was swapped; the
   *  cat's own equipped shoes are a separate thing entirely, built by
   *  `PowerUpModels.buildCatnipPickupModel()` from `Cat.attachSneakers()`. */
  readonly energyDrink: THREE.Group;
  kind: PowerUpType | null;
  collected: boolean;
  /** World-space Y the rig was placed at, before the bob offset - `baseY +
   *  bob` is what actually gets written to `root.position.y` every frame. */
  baseY: number;
}

const PARK_Y = -2000;

/**
 * Roughly 2x the sculpted models' own authored size, so a pickup reads
 * clearly at a run's speed and distance. Applied here, per pickup instance,
 * rather than inside `PowerUpModels.ts`'s `build*Model()` functions - those
 * are also used to build the props equipped on the *cat* (the sneaker on its
 * feet, the magnet over its head) via `Cat.ts`, which asked for no size
 * change, and doubling the shared builder's own output would have doubled
 * those too. Collection is a plain distance check against `entry.root`'s
 * position (see `ChunkBuilder.updatePowerUps`), not against this geometry,
 * so this is purely visual - it does not touch collision.
 *
 * Was 2 (twice authored size); halved back to 1 (authored size) on a
 * follow-up "too large" report - net effect across both requests is back to
 * where the sculpted models started.
 */
const PICKUP_SCALE = 1;
/** Extra scale applied only to the energy drink, on top of `PICKUP_SCALE` -
 *  it read as too easy to miss among the other pickups, and unlike them has
 *  no glow anymore to help it stand out (see `AssetRegistry.loadEnergyDrinkModel`),
 *  so it leans on being visibly larger instead. */
const ENERGY_DRINK_SCALE_BOOST = 1.6;

const _floorBox = new THREE.Box3();
/** How far above `entry.root`'s own origin a pickup's *lowest* point should
 *  sit, regardless of which model is active. */
const MIN_FLOOR_CLEARANCE = 0.12;

/**
 * Shifts `model` up so its own lowest point clears `MIN_FLOOR_CLEARANCE`
 * above its parent's origin. Every sculpted model (and the real OBJ models
 * some of them prefer once loaded - see `PowerUpModels.ts`) authors its own
 * pivot differently, so trusting `POWERUP_HEIGHT` alone to keep every one of
 * them clear of the deck means each model's own footprint has to be eyeballed
 * separately - and a taller one (or, in practice, the provided Jordan model
 * for Catnip Rush) can end up dipping into the rooftop where a smaller one
 * would have floated clear. Measuring the actual bounding box after scaling
 * makes "floats above the ground" true for whichever model is active, not
 * just the one it happened to be tuned against.
 */
function anchorAboveGround(model: THREE.Object3D): void {
  model.updateMatrixWorld(true);
  _floorBox.setFromObject(model);
  if (!Number.isFinite(_floorBox.min.y)) return;
  model.position.y += MIN_FLOOR_CLEARANCE - _floorBox.min.y;
}

export class PowerUpPool {
  private readonly rigs = new Map<number, PowerUpEntry>();

  constructor(private readonly scene: THREE.Object3D) {}

  rigFor(slot: number): PowerUpEntry {
    const existing = this.rigs.get(slot);
    if (existing) return existing;

    const root = new THREE.Group();
    root.position.set(0, PARK_Y, 0);
    root.visible = false;

    const shield = buildShieldModel();
    shield.visible = false;
    shield.scale.setScalar(PICKUP_SCALE);
    anchorAboveGround(shield);
    root.add(shield);

    const heart = buildHeartModel();
    heart.visible = false;
    heart.scale.setScalar(PICKUP_SCALE);
    anchorAboveGround(heart);
    root.add(heart);

    const magnet = buildMagnetModel();
    magnet.visible = false;
    magnet.scale.setScalar(PICKUP_SCALE);
    anchorAboveGround(magnet);
    root.add(magnet);

    const energyDrink = buildEnergyDrinkModel();
    energyDrink.visible = false;
    energyDrink.scale.setScalar(PICKUP_SCALE * ENERGY_DRINK_SCALE_BOOST);
    anchorAboveGround(energyDrink);
    root.add(energyDrink);

    this.scene.add(root);

    const entry: PowerUpEntry = {
      root,
      shield,
      heart,
      magnet,
      energyDrink,
      kind: null,
      collected: false,
      baseY: PARK_Y,
    };
    this.rigs.set(slot, entry);
    return entry;
  }

  place(slot: number, kind: PowerUpType, position: THREE.Vector3): void {
    const entry = this.rigFor(slot);
    entry.root.position.copy(position);
    entry.baseY = position.y;
    entry.root.visible = true;
    entry.kind = kind;
    entry.collected = false;

    entry.shield.visible = kind === 'shield';
    entry.heart.visible = kind === 'nineLives';
    entry.magnet.visible = kind === 'fishMagnet';
    entry.energyDrink.visible = kind === 'catnipRush';
  }

  hide(slot: number): void {
    const entry = this.rigs.get(slot);
    if (!entry) return;
    entry.root.visible = false;
    entry.root.position.y = PARK_Y;
    entry.baseY = PARK_Y;
    entry.kind = null;
    entry.collected = false;
  }

  dispose(): void {
    for (const entry of this.rigs.values()) {
      entry.root.removeFromParent();
      // disposeIfOwned skips anything AssetRegistry marked userData.shared -
      // shield/heart/magnet may be clones of a cached provided model, and
      // disposing those would free the resource every other clone (and the
      // cache itself) still needs. The procedural fallbacks aren't marked,
      // so they're still freed as before.
      for (const custom of [entry.shield, entry.heart, entry.magnet, entry.energyDrink]) {
        disposeIfOwned(custom);
      }
    }
    this.rigs.clear();
  }
}
