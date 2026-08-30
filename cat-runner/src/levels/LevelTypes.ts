/**
 * Data-driven level format.
 *
 * Levels are plain typed objects - no geometry is constructed in level files
 * and nothing about a level is hard-coded in the game class. ObstacleFactory
 * turns each entry here into meshes plus Rapier colliders, and LevelManager
 * owns the lifecycle.
 *
 * Adding a new obstacle type means: add a variant to LevelObject, handle it in
 * ObstacleFactory, and it is immediately usable from every level file.
 */

import type { RoofHutVariant } from '../assets/ProceduralProps';

export type Vec3 = [number, number, number];
/** Euler angles in DEGREES. Level files are hand-authored, so degrees win. */
export type Euler3 = [number, number, number];

/** Surface treatments. Drive both the material and the footstep sound. */
export type SurfaceStyle =
  | 'terracotta'
  /** Tiled like terracotta, but cool grey. Alternate the two along a route. */
  | 'slate'
  | 'flat'
  | 'garden'
  | 'metal'
  | 'wood'
  | 'stone'
  | 'awning'
  | 'glass';

interface Base {
  position: Vec3;
  rotation?: Euler3;
  /** Optional id so triggers and scripts can refer to this object. */
  id?: string;
}

/** A solid rooftop slab. The bread and butter of every level. */
export interface PlatformDef extends Base {
  kind: 'platform';
  /** Full extents (width, height, depth). */
  size: Vec3;
  style?: SurfaceStyle;
  /** Draws a building body beneath the roof, down to street level. */
  building?: boolean;
  /** Adds a low parapet wall around the edge. Visual and physical. */
  parapet?: boolean;
}

/** An angled surface. Momentum is preserved across it by design. */
export interface RampDef extends Base {
  kind: 'ramp';
  size: Vec3;
  /** Pitch in degrees. Positive ramps up along +Z. */
  angle: number;
  style?: SurfaceStyle;
}

/** Narrow wooden plank bridging a gap. */
export interface PlankDef extends Base {
  kind: 'plank';
  length: number;
  width?: number;
  /** Collapses shortly after the player steps on it. */
  collapsing?: boolean;
}

/** Static box-shaped obstacle: AC units, crates, vents, service structures. */
export interface BlockDef extends Base {
  kind: 'acUnit' | 'chimney' | 'crate' | 'block' | 'roofHut';
  size?: Vec3;
  /**
   * Which service structure a `roofHut` is. Ignored by every other kind.
   *
   * Purely cosmetic - all four are the same box to the physics, which is the
   * point: the player learns one silhouette and it always means the same thing.
   */
  hut?: RoofHutVariant;
}

/** Names of the modelled obstacles in `public/assets/obstacles/`. */
export type ObstacleModel = 'fishcrates' | 'pipevent' | 'table';

/**
 * A modelled lane obstacle.
 *
 * Same role as {@link BlockDef} - a solid thing in one lane that has to be
 * dodged - but drawn from a glTF instead of procedural geometry. The collider
 * is still an axis-aligned box from `size`, deliberately: these are art assets
 * with awkward silhouettes, and a convex hull of a fish crate would give the
 * player a hitbox they cannot read.
 */
export interface ObstacleDef extends Base {
  kind: 'obstacle';
  model: ObstacleModel;
  /** Collider extents, and the height the model is normalised to. */
  size?: Vec3;
}

/** Water tank on legs. Big, solid, good for forcing a detour. */
export interface WaterTowerDef extends Base {
  kind: 'watertower';
  scale?: number;
}

/** Platform that slides between two points on a loop. Carries the player. */
export interface MovingPlatformDef extends Base {
  kind: 'movingPlatform';
  size: Vec3;
  /** Offset from `position` to the far end of the travel. */
  travel: Vec3;
  /** Seconds for one one-way trip. */
  duration: number;
  /** Phase offset 0..1 so a row of platforms can be staggered. */
  phase?: number;
  style?: SurfaceStyle;
}

/** Sign or fan spinning about an axis. Knocks the player sideways. */
export interface RotatingDef extends Base {
  kind: 'rotatingSign' | 'roofFan';
  /** Radians per second. Negative reverses. */
  speed: number;
  size?: Vec3;
  /** Rotation axis. Defaults to Y for signs, Y for fans. */
  axis?: 'x' | 'y' | 'z';
}

/** Billboard or shop sign swinging on a pivot. */
export interface SwingingDef extends Base {
  kind: 'swingingSign';
  size: Vec3;
  /** Peak swing angle in degrees. */
  amplitude: number;
  /** Seconds per full swing cycle. */
  period: number;
  phase?: number;
  /** Length of the arm from pivot to the sign's centre. */
  armLength?: number;
}

/** Upward puff that launches the player. */
export interface SteamVentDef extends Base {
  kind: 'steamVent';
  /** Upward impulse applied on entry. */
  strength?: number;
  /** Seconds between puffs. 0 = always on. */
  interval?: number;
  /** Seconds a puff stays active. */
  activeTime?: number;
  radius?: number;
}

/** Roof tiles that give way a moment after being touched. */
export interface CollapsingTileDef extends Base {
  kind: 'collapsingTile';
  size?: Vec3;
  /** Seconds between contact and collapse. */
  delay?: number;
  /** How many tiles to lay in a row along +Z. */
  count?: number;
  /** Spacing between tiles in a run. */
  spacing?: number;
}

/** Loose physics prop that rolls or tumbles when hit. */
export interface LooseDef extends Base {
  kind: 'barrel' | 'flowerpot' | 'box';
  scale?: number;
  mass?: number;
}

/**
 * Rope strung between two points.
 *
 * Scenery by default - a line high overhead between two buildings, which the
 * runner passes under without touching. With `hazard` it becomes the slide
 * obstacle: a curtain of sheets hung across the lanes at
 * `CLOTHESLINE_ROPE_HEIGHT` above the walking surface, too low to jump and only
 * passable tucked.
 */
export interface ClotheslineDef extends Base {
  kind: 'clothesline';
  /** World-space endpoint of the line. `position` is the other end. */
  end: Vec3;
  /** Number of hanging garments. */
  laundry?: number;
  sag?: number;
  /**
   * Makes this a slide obstacle rather than scenery.
   *
   * Author the endpoints at `SURFACE + CLOTHESLINE_ROPE_HEIGHT` when setting
   * this: the height is what makes the obstacle unjumpable, and hanging one
   * lower would quietly restore the jump as a second answer.
   */
  hazard?: boolean;
}

/** Flock that scatters when the player gets close. Briefly obscures the view. */
export interface PigeonsDef extends Base {
  kind: 'pigeons';
  count?: number;
  /** Distance at which the flock takes off. */
  triggerRadius?: number;
  spread?: number;
}

/** Purely decorative model or procedural prop. No collider. */
export interface PropDef extends Base {
  kind: 'prop';
  /** Procedural prop name, or `pack:model` for a KayKit asset. */
  prop: string;
  scale?: number;
}

/** Sloped fabric awning. Slippery, angled, and fun to ride. */
export interface AwningDef extends Base {
  kind: 'awning';
  size: Vec3;
  angle: number;
  /** Stripe colour. */
  color?: number;
}

export type LevelObject =
  | PlatformDef
  | RampDef
  | PlankDef
  | BlockDef
  | ObstacleDef
  | WaterTowerDef
  | MovingPlatformDef
  | RotatingDef
  | SwingingDef
  | SteamVentDef
  | CollapsingTileDef
  | LooseDef
  | ClotheslineDef
  | PigeonsDef
  | PropDef
  | AwningDef;

// ---------------------------------------------------------------------------

export interface LightingDef {
  /** Sky/background colour. */
  skyColor: number;
  /** Fog colour - usually close to skyColor for a clean horizon. */
  fogColor: number;
  fogNear: number;
  fogFar: number;
  /** Main directional light. */
  sunColor: number;
  sunIntensity: number;
  sunPosition: Vec3;
  /** Hemisphere fill. */
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
  /** Extra coloured point lights, used by the neon level. */
  accents?: { position: Vec3; color: number; intensity: number; distance: number }[];
}

/**
 * What sits beyond the rooftops.
 *
 * This used to also describe a scattered instanced skyline (`buildingCount`,
 * `radius`, `heightRange`). Those buildings were removed for costing about half
 * the frame's triangles while sitting behind fully opaque fog; the horizon is
 * carried by the fog and sky colours in {@link LightingDef} instead, and all
 * that remains out there is the street far below.
 */
export interface BackgroundDef {
  /** Street-level ground plane colour, or omitted for none. */
  groundColor?: number;
  groundY?: number;
}

export interface ChaseDef {
  /** Route distance the dogs start behind the player, in world units. */
  dogStartGap: number;
  /** Route distance the chef starts behind. */
  chefStartGap: number;
  /** Dog speed in world units/second along the route. */
  dogSpeed: number;
  chefSpeed: number;
  /**
   * Extra speed pursuers gain when the player is far ahead, and the distance
   * over which it ramps in. This is the rubber band.
   */
  catchUpSpeed: number;
  catchUpRange: number;
  /** Route distance at which a pursuer catches the player. */
  catchDistance: number;
}

export interface TutorialTrigger {
  /** Fires when the player passes this route progress, 0..1. */
  atProgress: number;
  text: string;
  /** Seconds to display. */
  duration?: number;
}

export interface LevelDef {
  id: string;
  name: string;
  /** 1-based position in the campaign. */
  index: number;

  spawn: { position: Vec3; yaw: number };
  finish: { position: Vec3; radius: number };

  /** Anything below this Y fails the attempt. */
  killPlaneY: number;

  /**
   * Control points for the Catmull-Rom route. Serves double duty as the
   * pursuers' path and as the yardstick for measuring player progress.
   */
  route: Vec3[];

  /** Midpoint respawn used only when Assist Mode is enabled. */
  checkpoint?: { position: Vec3; yaw: number };

  objects: LevelObject[];
  /**
   * The three saved fish tokens. Exactly three, by design - `LevelProgress`
   * stores a fixed-length flag array and skins unlock against the total.
   */
  tokens: Vec3[];
  /**
   * Ordinary fish, collected for score.
   *
   * Deliberately separate from {@link tokens}: these are dense, worth a point
   * each, and forgotten at the end of the run, whereas a token is a one-off
   * that is remembered forever. Merging them would mean either three fish a
   * level or a save file that grows without bound.
   */
  fish?: Vec3[];

  lighting: LightingDef;
  background: BackgroundDef;
  chase: ChaseDef;
  tutorials?: TutorialTrigger[];
}
