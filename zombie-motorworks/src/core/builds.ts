/**
 * Builds: the three starting rigs a new game picks between.
 *
 * A Build is a chassis and a signature block bought as one decision, before the
 * garage is ever opened. It decides how the rig moves (three light wheels, four
 * wheels behind armour, or a pair of belts), what the left mouse button does
 * (see `SignatureDefinition`), and what sits in the first ability slot. Nothing
 * else about the run is gated by it: every store part is available to every
 * build, so the choice sets a starting shape rather than a class the player is
 * locked into.
 *
 * The signature block is not on the shelf and cannot be sold, so this file is
 * the only place any of the three ever enters a blueprint.
 *
 * Pure data (see AGENTS.md): the rigs are plain `PlacedPart` arrays, so the
 * title screen can render one and the app can start a run from one without
 * either of them owning the layout.
 */

import { createEmptyBlueprint } from './blueprint.ts';
import { orientationFromSteps } from './grid.ts';
import { PART_CATALOG } from './parts.ts';
import { SIGNATURE_KIND_META } from './signatures.ts';
import type {
  PartConfig,
  PlacedPart,
  Vec3i,
  VehicleBlueprint,
} from './types.ts';

export type BuildId = 'light' | 'medium' | 'heavy';

export interface BuildDefinition {
  id: BuildId;
  /** Rig name, shown as the headline on the picker. */
  name: string;
  /** Two or three words on the chassis, e.g. "Three wheels, no armour". */
  chassis: string;
  /** One line on how it plays, shown under the name. */
  blurb: string;
  /** Catalog id of the signature block bolted to this rig. */
  signatureDefId: string;
  /** Name of the click attack, for the picker's stat rows. */
  signatureName: string;
  /** Name of the ability the block puts in the bar. */
  abilityName: string;
}

export const BUILDS: Record<BuildId, BuildDefinition> = {
  light: {
    id: 'light',
    name: 'Sparkrunner',
    chassis: 'Three wheels, no armour',
    blurb:
      'The quickest thing in the graveyard and the easiest to kill. Its mast ' +
      'fires itself — just point at the horde — and it dashes clean through ' +
      'them when they close.',
    signatureDefId: 'storm-rod',
    signatureName: 'Chain Lightning (auto)',
    abilityName: 'Dash',
  },
  medium: {
    id: 'medium',
    name: 'Emberframe',
    chassis: 'Four wheels, plated',
    blurb:
      'A square, armoured deck that can take a few hits. Lobs fire onto a ' +
      'crowd, and opens up into a lance when one gets too close.',
    signatureDefId: 'pyre-core',
    signatureName: 'Fireball',
    abilityName: 'Fire Blast',
  },
  heavy: {
    id: 'heavy',
    name: 'Fallout Crawler',
    chassis: 'Tank treads, armoured',
    blurb:
      'Slow, heavy, and nearly impossible to stop. Shells the horde from ' +
      'across the arena, and bolts itself shut when the shelling is not ' +
      'enough.',
    signatureDefId: 'fallout-silo',
    signatureName: 'Nuke Launcher',
    abilityName: 'Reinforce',
  },
};

export const DEFAULT_BUILD_ID: BuildId = 'light';

/** Every build id, in picker order: light, medium, heavy. */
export const BUILD_IDS: readonly BuildId[] = ['light', 'medium', 'heavy'];

/** Narrows persisted or URL-supplied values to a real build id. */
export function isBuildId(value: unknown): value is BuildId {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUILDS, value)
  );
}

/** The build for an id, falling back to the default for anything unknown. */
export function getBuild(id: unknown): BuildDefinition {
  return isBuildId(id) ? BUILDS[id] : BUILDS[DEFAULT_BUILD_ID];
}

/** Catalog ids of every signature block, so callers can filter the store. */
export const SIGNATURE_DEF_IDS: readonly string[] = BUILD_IDS.map(
  (id) => BUILDS[id].signatureDefId,
);

/** True for the three blocks handed out by a build and sold by nobody. */
export function isSignatureDefId(defId: string): boolean {
  return SIGNATURE_DEF_IDS.includes(defId);
}

const YAW_180 = orientationFromSteps(0, 2, 0);

function driveWheel(): PartConfig {
  return { driven: true, braking: true, steerInverted: false };
}

/**
 * The Sparkrunner rides on Off-road Wheels — the big knobbly monster wheel, not
 * the road one. It was on the thin Motorcycle Wheel, and that wheel is a trap
 * on the rig that most needs to survive being touched: a 45 HP hub with a 3.8 t
 * load rating buckles the moment a player bolts anything on, so the fast build
 * spent its first three waves losing wheels rather than being fast.
 *
 * The monster wheel is the opposite trade. Nearly three times the health, four
 * times the load rating, more grip in both directions and half again the drive
 * torque limit, paid for with weight and a 32-degree lock instead of 42. The
 * rig stays the quickest thing in the graveyard because it is still the
 * lightest chassis in the game — it just no longer falls apart from underneath.
 *
 * They run the off-road suspension preset on top: more travel and appreciably
 * more damping, which keeps all three planted over rubble and headstones
 * instead of skipping off and landing crooked with no steering authority.
 */
const AGILE_WHEEL_DEF_ID = 'wheel-offroad';

function agileWheel(): PartConfig {
  return { ...driveWheel(), suspensionPreset: 'off-road' };
}

/** Builds the numbered `PlacedPart` list for a rig, in declaration order. */
function rig(
  parts: readonly [
    defId: string,
    pos: Vec3i,
    orient?: number,
    config?: PartConfig,
  ][],
): PlacedPart[] {
  return parts.map(([defId, pos, orient = 0, config = {}], index) => ({
    id: `p${index + 1}`,
    defId,
    pos: { ...pos },
    orient,
    config: { ...config },
  }));
}

const v = (x: number, y: number, z: number): Vec3i => ({ x, y, z });

/**
 * Tight little triwheel: one steered wheel up front on a motorcycle fork, a
 * driven pair out back. The short spine keeps mass — and therefore health —
 * low, which is the trade the whole light build is built around.
 *
 * The deck is a T, not a cross: a three-cell spine running forward from a
 * three-cell rear beam.
 *
 * ```text
 *          W          front wheel, z = +2
 *         [ ]         spine
 *         [C]         chassis core
 *         [ ]         spine
 *    W [ ][ ][ ] W    rear beam and the driven pair, z = -2
 * ```
 *
 * The beam is at the very back rather than one cell in, which is what makes it
 * a T. That stretches the wheelbase to four cells, so the rig tracks straight
 * under the weight of the monster wheels instead of pivoting around a
 * mid-mounted axle, and it gives the twin motors somewhere symmetric to sit
 * directly over the wheels they drive. The centre of the deck above it is left
 * clear: (0, 2, -2) is the free, frame-topped weapon bay no other starting rig
 * hands out, so the first gun the player buys has somewhere to go without
 * selling the tank or the mast to make room.
 */
function lightRig(): PlacedPart[] {
  return rig([
    ['chassis-core', v(0, 1, 0)],
    ['frame-box', v(0, 1, 1)],
    ['frame-box', v(0, 1, -1)],
    // The bar of the T.
    ['frame-box', v(0, 1, -2)],
    ['frame-box', v(1, 1, -2)],
    ['frame-box', v(-1, 1, -2)],
    [AGILE_WHEEL_DEF_ID, v(0, 1, 2), 0, agileWheel()],
    [AGILE_WHEEL_DEF_ID, v(2, 1, -2), YAW_180, agileWheel()],
    [AGILE_WHEEL_DEF_ID, v(-2, 1, -2), 0, agileWheel()],
    // Twin motors, one over each driven wheel.
    //
    // Torque sums across engines and mass does not double the rig, so the
    // second block is felt entirely in the launch: the Sparkrunner leaves a
    // standing start ahead of anything else in the game, which is the one
    // thing the fast build should never lose at. It does not raise flat-out
    // speed — that is gearing and redline, and both engines share the same
    // ceiling — so the rig stays quick rather than becoming untouchable.
    //
    // They sit on the beam ends rather than down the spine so the pair is
    // symmetric about the centreline and the weight lands over the drive
    // axle, where it buys traction instead of costing turn-in. That also
    // leaves the whole spine above the deck open: (0, 2, -1) and the bay at
    // (0, 2, -2) are both free mounts.
    //
    // Both ship at level 3 — Turbocharger and Intercooler already bought,
    // the only starting rig with unlocks on it. The cans are on the model, so
    // the stars in the garage are visible on the rig too.
    //
    // The bill for all of this is fuel: two engines burn a tank twice as fast
    // as one, and the pair only carries 15 L more between them. The fast build
    // is now the build that has to think about refuel crates.
    ['engine-small', v(-1, 2, -2), 0, { level: 3 }],
    ['engine-small', v(1, 2, -2), 0, { level: 3 }],
    ['fuel-tank', v(0, 2, 0)],
    // The mast rides high and central so the rod has a clear line up.
    ['storm-rod', v(0, 2, 1)],
  ]);
}

/**
 * A square four-wheel deck with plate down both flanks. Heavier and slower off
 * the line than the triwheel, and it survives the contact the light build has
 * to avoid entirely.
 */
function mediumRig(): PlacedPart[] {
  return rig([
    ['chassis-core', v(0, 1, 0)],
    // Two-by-two floor: the deck is square, which is what gives the medium
    // build the mounting room the light one does not have.
    ['frame-box', v(1, 1, 0)],
    ['frame-box', v(-1, 1, 0)],
    ['frame-box', v(0, 1, 1)],
    ['frame-box', v(1, 1, 1)],
    ['frame-box', v(-1, 1, 1)],
    ['frame-box', v(0, 1, -1)],
    ['frame-box', v(1, 1, -1)],
    ['frame-box', v(-1, 1, -1)],
    ['wheel-standard', v(2, 1, 1), YAW_180, driveWheel()],
    ['wheel-standard', v(-2, 1, 1), 0, driveWheel()],
    ['wheel-standard', v(2, 1, -1), YAW_180, driveWheel()],
    ['wheel-standard', v(-2, 1, -1), 0, driveWheel()],
    ['engine-small', v(0, 2, -1)],
    ['fuel-tank', v(1, 2, -1)],
    // Plate on the shoulders, where a walker reaches the deck from.
    ['armour-plate', v(1, 2, 1)],
    ['armour-plate', v(-1, 2, 1)],
    ['pyre-core', v(0, 2, 1)],
  ]);
}

/**
 * Two three-cell belts either side of an armoured hull. It skid-steers, tops
 * out slowly, and shrugs off nearly everything — the silo it carries is the
 * only weapon on any starting rig that can reach across the whole arena.
 */
function heavyRig(): PlacedPart[] {
  return rig([
    // Hull: four cells wide by three deep, almost all of it reinforced frame.
    //
    // The width is even on purpose. The silo's barbette is two cells across,
    // and a two-cell pad can only sit on the centreline of a hull with an even
    // width — on a three-wide deck the gun is always half a cell off to one
    // side. The whole rig is therefore symmetric about x = -0.5 rather than
    // about the blueprint origin, which costs nothing at runtime (mass and
    // handling are derived from the parts, not from the origin) and buys a
    // tank whose gun points down its own spine.
    ['chassis-core', v(0, 1, 0)],
    ['frame-reinforced', v(-2, 1, 0)],
    ['frame-reinforced', v(-1, 1, 0)],
    ['frame-reinforced', v(1, 1, 0)],
    ['frame-reinforced', v(-2, 1, 1)],
    ['frame-reinforced', v(-1, 1, 1)],
    ['frame-reinforced', v(0, 1, 1)],
    ['frame-reinforced', v(1, 1, 1)],
    ['frame-reinforced', v(-2, 1, -1)],
    ['frame-reinforced', v(-1, 1, -1)],
    ['frame-reinforced', v(0, 1, -1)],
    ['frame-reinforced', v(1, 1, -1)],
    // Belts run the full depth of the hull, one cell outboard of each flank.
    // Each turns its own way so both mount inward onto the frame beside it.
    ['tread-tank', v(-3, 1, 0), 0, driveWheel()],
    ['tread-tank', v(2, 1, 0), YAW_180, driveWheel()],
    // The pedestal: a two-by-two block of reinforced frame carrying the silo a
    // storey above the deck, set back so there is nose ahead of it to armour.
    ['frame-reinforced', v(-1, 2, -1)],
    ['frame-reinforced', v(0, 2, -1)],
    ['frame-reinforced', v(-1, 2, 0)],
    ['frame-reinforced', v(0, 2, 0)],
    // A full bank of plate across the nose. This is the face that meets the
    // horde every time the Crawler drives into one, and the weight of it is
    // half the reason the rig moves the way it does.
    ['armour-plate', v(-2, 2, 1)],
    ['armour-plate', v(-1, 2, 1)],
    ['armour-plate', v(0, 2, 1)],
    ['armour-plate', v(1, 2, 1)],
    // Plate down one exposed flank; the other side of the deck is engine bay.
    ['armour-plate', v(1, 2, 0)],
    // Two engines, mounted symmetrically about the rig's centreline so the
    // belts are fed evenly. Two rather than one is not a luxury: at nearly
    // three tonnes on two belts, a single small block leaves the Crawler
    // slower than a walker, which is not a slow tank so much as a stationary
    // one. Even with the pair it is comfortably the slowest thing in the game.
    ['engine-small', v(-2, 2, -1)],
    ['engine-small', v(1, 2, -1)],
    ['fuel-tank', v(-2, 2, 0)],
    // Four cells of launch tube on top of the pedestal, on the centreline.
    ['fallout-silo', v(-1, 3, -1)],
  ]);
}

const BUILD_RIGS: Record<BuildId, () => PlacedPart[]> = {
  light: lightRig,
  medium: mediumRig,
  heavy: heavyRig,
};

/**
 * A small, valid, drivable rig for `buildId`, with its signature block already
 * bolted on. Every call returns a fresh blueprint with fresh part objects, so
 * a caller can mutate what it gets back without touching the next one.
 */
export function buildStarterRig(buildId: unknown): VehicleBlueprint {
  const build = getBuild(buildId);
  return {
    ...createEmptyBlueprint(`${build.name.toLowerCase().replace(/\s+/g, '-')}`),
    parts: BUILD_RIGS[build.id](),
  };
}

/**
 * The line the garage shows once a rig has been chosen: what is bolted on, and
 * which button fires it.
 *
 * A player who has just picked a build has never seen its weapon and has no
 * reason to guess that left-click does anything — every other gun in the game
 * aims itself. This is the only place that is explained, so it names the block,
 * the strike, and the control together.
 */
export function buildWelcomeNotice(buildId: unknown): string {
  const build = getBuild(buildId);
  const def = PART_CATALOG[build.signatureDefId];
  const strike = def?.signature
    ? SIGNATURE_KIND_META[def.signature.kind].label
    : build.signatureName;
  return (
    `${build.name} it is. Your ${def?.name ?? 'signature block'} is already ` +
    `fitted — left-click anywhere in the arena to fire ${strike}, and watch ` +
    `the reticle for when it is ready. Upgrade the block here to hit harder ` +
    `and reload faster.`
  );
}

/**
 * Catalog ids a build has to have unlocked, over and above `STARTER_UNLOCKS`.
 *
 * The heavy rig ships on tank treads and reinforced frame, neither of which is
 * a starter unlock. Without this a player whose belt was torn off in wave two
 * would find the replacement locked behind an unlock fee — on a part they were
 * handed rather than chose. Derived from the rig itself so the two can never
 * drift: change the layout and the grant follows.
 *
 * Signature blocks are excluded because they are not purchasable at any price;
 * they are also never lost, since they cannot come off the rig.
 */
export function buildStarterUnlocks(buildId: unknown): string[] {
  const seen = new Set<string>();
  for (const part of BUILD_RIGS[getBuild(buildId).id]()) {
    if (isSignatureDefId(part.defId)) continue;
    seen.add(part.defId);
  }
  return [...seen];
}
