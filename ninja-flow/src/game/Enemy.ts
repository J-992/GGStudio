import {
  MathUtils,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { Rng } from '../core/Rng';
import {
  COMBAT_ATTACK_IDS,
  ENEMY_ATTACKS,
  REACTIONS,
  sampleEnemy,
  type EnemyAttack,
  type EnemyPose,
  type ReactionKind,
} from './EnemyMoves';
import { ENEMY, FEINT, GUARD, PHYSICS } from '../config';
import {
  WEAPONS,
  buildWeapon,
  weaponById,
  weaponModel,
  type WeaponDef,
  type WeaponId,
} from './Weapons';
import { Inertia, RigidBody, Spring } from '../fx/Physics';
import type { Props } from '../fx/Props';
import type { Side } from './PatternDirector';
import type { ContactImpulse } from './CombatContact';
import { normalizeHeight, RigAdapter, type Pose } from './Rig';

/**
 * Original rigged enemies driven by a lightweight procedural combat controller.
 *
 * A zero-download puppet remains the instant fallback. The streamed cast — a
 * ronin, oni, and tengu authored specifically for this game — shares its joint
 * contract and explicit hand sockets, so one choreography layer and the full
 * armoury work across all three bodies without model-specific attack code.
 */

export type EnemyState = 'idle' | 'approach' | 'windup' | 'contact' | 'reengage' | 'dying' | 'dead';

const GEO = {
  /** Kimono body: narrow shoulders flaring to a hem. */
  robe: new CylinderGeometry(0.17, 0.34, 0.56, 12),
  sash: new TorusGeometry(0.245, 0.045, 6, 14),
  head: new SphereGeometry(0.34, 16, 12),
  maskBand: new BoxGeometry(0.62, 0.17, 0.3),
  eye: new SphereGeometry(0.05, 8, 6),
  earPoint: new ConeGeometry(0.11, 0.3, 6),
  earRound: new SphereGeometry(0.12, 8, 6),
  horn: new ConeGeometry(0.07, 0.22, 6),
  kasa: new ConeGeometry(0.5, 0.24, 10),
  ribbon: new BoxGeometry(0.07, 0.3, 0.02),
  arm: new CylinderGeometry(0.07, 0.06, 0.3, 7),
  paw: new SphereGeometry(0.075, 8, 6),
  leg: new CylinderGeometry(0.07, 0.06, 0.2, 7),
  foot: new BoxGeometry(0.15, 0.09, 0.22),
  scarf: new BoxGeometry(0.16, 0.44, 0.05),
  tail: new SphereGeometry(0.13, 8, 6),
  blade: new BoxGeometry(0.05, 0.85, 0.11),
  guard: new BoxGeometry(0.13, 0.05, 0.18),
  kama: new TorusGeometry(0.2, 0.032, 5, 10, Math.PI * 1.1),
  aura: new SphereGeometry(0.75, 14, 10),
  /** Guard plate: a banded shield the enemy raises into the first strike. */
  plate: new BoxGeometry(0.5, 0.6, 0.08),
  plateBand: new BoxGeometry(0.56, 0.1, 0.1),
} as const;

type Palette = { cloth: number; trim: number; fur: number; metal: number };

/** Clan colors keyed to the hero wardrobe: dark robes, one loud accent each. */
const CLANS: readonly Palette[] = [
  { cloth: 0x232840, trim: 0xe8b64c, fur: 0x8e6f5a, metal: 0xc4cede }, // navy + gold
  { cloth: 0x33244a, trim: 0xb08cf0, fur: 0xa8a4b8, metal: 0xb4bed0 }, // plum + violet
  { cloth: 0x1d3a34, trim: 0x5cd9a8, fur: 0xc9a17b, metal: 0xbccadd }, // pine + jade
  { cloth: 0x47232e, trim: 0xf0736a, fur: 0x9a7a64, metal: 0xc0c8d8 }, // wine + coral
];

const RARE_PALETTE: Palette = { cloth: 0x3a2c10, trim: 0xffd35c, fur: 0xffe6a8, metal: 0xffd35c };

/**
 * Guarded enemies get their own colours, not just a plate.
 *
 * At the distance this game is played from, a player reads silhouette and
 * colour and nothing finer. A guarded enemy carrying a small grey object looked
 * exactly like an unguarded one until it was close enough that the extra beat
 * of timing was already a surprise. Cold steel against four warm clan palettes
 * makes the answer to "does this one take two hits" readable from spawn.
 */
const GUARD_PALETTE: Palette = { cloth: 0x2a3d52, trim: 0x7fd4ff, fur: 0x93a4b5, metal: 0xd6e4f2 };

/**
 * Resting glow on a guard plate.
 *
 * Not just the struck flash: the plate is the thing the player has to aim at
 * first, so it has to catch the eye on the approach rather than announce itself
 * on contact. The block flash settles back to this rather than to nothing.
 */
const PLATE_GLOW = 0.18;

/**
 * Feints wear bone-white and carry nothing.
 *
 * Two cues, both readable in one frame at the distance the game is played at:
 * a colour that appears nowhere else on the board, and empty hands. The second
 * is the one that makes the rule guessable without being told — a threat with
 * no weapon cannot land a hit, so there is nothing to answer.
 */
const FEINT_PALETTE: Palette = { cloth: 0xd9d6cc, trim: 0xa9a396, fur: 0xefece4, metal: 0xbfbcb2 };

type EarStyle = 'points' | 'round' | 'horns' | 'kasa';
const EAR_STYLES: readonly EarStyle[] = ['points', 'round', 'horns', 'kasa'];

/**
 * Keeps every weapon user close enough to read as hand-to-hand combat while
 * preserving a modest reach advantage for polearms and a closer stop for
 * compact weapons.
 */
export function strikeDistanceFor(reach: number): number {
  const distance = ENEMY.strikeDistance + (reach - 1) * ENEMY.reachDistanceScale;
  return MathUtils.clamp(distance, ENEMY.strikeDistanceMin, ENEMY.strikeDistanceMax);
}

const matCache = new Map<string, MeshStandardMaterial>();
function mat(color: number, opts: { rough?: number; metal?: number; emissive?: number } = {}): MeshStandardMaterial {
  const key = `${color}|${opts.rough ?? 0.75}|${opts.metal ?? 0}|${opts.emissive ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.75,
      metalness: opts.metal ?? 0,
      emissive: new Color(opts.emissive ?? 0x000000),
      emissiveIntensity: opts.emissive ? 1.3 : 0,
    });
    matCache.set(key, m);
  }
  return m;
}

function part(geo: BufferGeometry, material: Material, parent: Object3D): Mesh {
  const m = new Mesh(geo, material);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export type WeaponKind = 'katana' | 'kama' | 'tanto';

const WORLD = new Vector3();
const SECONDARY_WORLD = new Vector3();
const LOCAL_GRIP_DIRECTION = new Vector3();
const UP = new Vector3(0, 1, 0);
const WORLD_QUAT = new Quaternion();
const ROOT_QUAT = new Quaternion();
const LINE_QUAT = new Quaternion();
const HOLD_INVERSE = new Quaternion();
const WEAPON_MOUNT = new Quaternion().setFromEuler(new Euler(Math.PI * 0.94, 0, 0.2));
const PLATE_MOUNT = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI * 0.08));

/** Makes a weapon's post-hold +Y axis pass exactly through both hand sockets. */
export function solveTwoHandGrip(
  primary: Vector3,
  secondary: Vector3,
  hold: Quaternion,
  out: Quaternion,
): boolean {
  LOCAL_GRIP_DIRECTION.subVectors(secondary, primary);
  if (LOCAL_GRIP_DIRECTION.lengthSq() < 1e-5) return false;
  LOCAL_GRIP_DIRECTION.normalize();
  LINE_QUAT.setFromUnitVectors(UP, LOCAL_GRIP_DIRECTION);
  HOLD_INVERSE.copy(hold).invert();
  out.copy(LINE_QUAT).multiply(HOLD_INVERSE);
  return true;
}

/**
 * Weapons are authored in metres: a 1.04 m katana against a 1.52 m fighter is
 * already correctly proportioned. Keeping the scale at one preserves the real
 * differences between a tanto, katana, and nagamaki.
 */
const ENEMY_WEAPON_SCALE = 1;
const DETAILED_HEIGHT = 1.52;
let attackCursor = 0;

interface DetailedMaterialBase {
  color: Color;
  emissive: Color;
  emissiveIntensity: number;
  roughness: number;
}

/**
 * Picks an attack the equipped weapon can actually perform.
 *
 * Rotated, never rolled: cosmetic variety must not draw from the seeded
 * gameplay stream, and rotation guarantees neighbours in a wave differ.
 */
function pickAttack(cinematic: boolean, suited: readonly string[]): EnemyAttack {
  const allowed = ENEMY_ATTACKS.filter(
    (a) => suited.includes(a.id) && (cinematic || COMBAT_ATTACK_IDS.includes(a.id)),
  );
  const pool = allowed.length > 0 ? allowed : ENEMY_ATTACKS.filter((a) => COMBAT_ATTACK_IDS.includes(a.id));
  return pool[attackCursor++ % pool.length];
}

let weaponCursor = 0;

function nextWeapon(cinematic: boolean): WeaponDef {
  // Every model-backed weapon belongs in live rotation now that the enemy rig
  // has a verified two-hand socket. The reel also gets the extra procedural
  // polearms, whose larger silhouettes suit its wider staging.
  const pool = cinematic ? WEAPONS : WEAPONS.filter((w) => w.model || w.reach <= 1.05);
  return pool[weaponCursor++ % pool.length];
}

function attackById(id: string): EnemyAttack {
  return ENEMY_ATTACKS.find((a) => a.id === id) ?? ENEMY_ATTACKS[0];
}

export class Enemy {
  readonly group = new Group();
  state: EnemyState = 'dead';
  private readonly bodyVisual = new Group();
  private detailedModel: Object3D | null = null;
  private detailedRig: RigAdapter | null = null;
  private detailedWeaponGrip: Object3D | null = null;
  private detailedOffhandGrip: Object3D | null = null;
  private readonly detailedPose: Pose = {};
  private readonly detailedMaterials: MeshStandardMaterial[] = [];
  private readonly detailedMaterialBases = new Map<MeshStandardMaterial, DetailedMaterialBase>();
  private readonly fallbackMeshes: Mesh[] = [];
  private attack: EnemyAttack = ENEMY_ATTACKS[0];
  private readonly attackPose: EnemyPose = {};
  private reaction: ReactionKind = 'launch';
  private cinematic = false;
  /**
   * Flow-chain marking. The chain asks for a direction, so the body it wants
   * must be unmistakable at a glance: the target wears a lit aura and stands
   * taller, everything still queued shrinks back. Without this the player is
   * guessing, and a guess ends the chain.
   */
  private flowMark: 'none' | 'target' | 'queued' = 'none';
  /** Set when something else owns this body's position (the Flow chain). */
  private posed = false;
  /** Plates left to break before this enemy can be cut down. */
  guard = 0;
  /**
   * True for a threat that never strikes. It is skipped by target selection and
   * by the overdue sweep, so the only way it interacts with the player is by
   * tempting a swing that then finds nothing.
   */
  feint = false;
  private guardMax = 0;
  private blockFlash = 0;
  private squash = 0;
  private squashDir = 1;
  /** Distance the current approach starts from — a re-engage comes in short. */
  private fromDistance: number = ENEMY.spawnDistance;
  private lingerScale = 1;
  private gravityScale = 1;
  /** True once a thrown weapon has left the hand this windup. */
  private threw = false;
  /** Set when this enemy's weapon should be spawned as a projectile. */
  pendingThrow = false;
  side: Side = 'L';
  rare = false;

  /** Absolute run time at which this enemy's strike should be answered. */
  impactAt = 0;
  spawnAt = 0;
  approach = 2;

  private readonly root = new Group();
  private readonly robe: Mesh;
  private readonly sash: Mesh;
  private readonly head: Group;
  private readonly skull: Mesh;
  private readonly maskBand: Mesh;
  private readonly ears: Record<EarStyle, Mesh[]>;
  private readonly ribbons: [Mesh, Mesh];
  private readonly arms: [Group, Group];
  /** Elbow joints: the original puppet's arms had only one rigid segment. */
  private readonly forearms: [Group, Group];
  private readonly legs: [Group, Group];
  /** Knee joints give the scamper and the windup a readable weight shift. */
  private readonly shins: [Group, Group];
  private readonly scarf: Mesh;
  private readonly tail: Mesh;
  private readonly weapon: Group;
  private readonly plate: Group;
  private readonly plateParts: Mesh[];
  private readonly aura: Mesh;

  private phase = 0;
  private dieTimer = 0;
  private launch = { x: 0, y: 0, z: 0, spin: 0 };
  /** The simulated body a killed enemy becomes. */
  private readonly body = new RigidBody();
  /** Tracks the group's own motion, so limbs and cloth can trail it. */
  private readonly inertia = new Inertia();
  private readonly headLag = new Spring(PHYSICS.lagStiffness, PHYSICS.lagDamping);
  private readonly scarfLag = new Spring(PHYSICS.lagStiffness * 0.6, PHYSICS.lagDamping * 0.8);
  private readonly tailLag = new Spring(PHYSICS.lagStiffness * 0.5, PHYSICS.lagDamping * 0.7);
  /** Where dropped weapons and armour go. Null in headless simulation. */
  private props: Props | null = null;
  /** Palette metal, so dropped steel matches the clan it came from. */
  private metalColor = 0x9fb0c8;
  private weaponDef: WeaponDef = weaponById('katana');
  private readonly weaponHoldQuaternion = new Quaternion();
  private readonly deathScale = new Vector3(1, 1, 1);
  private windupProgress = 0;
  private telegraph = 0;
  private reengageVelocity = 0;
  private reengageUntil = 0;

  constructor(props: Props | null = null) {
    this.props = props;
    this.group.add(this.root);
    this.root.add(this.bodyVisual);

    this.robe = part(GEO.robe, mat(0x232840), this.bodyVisual);
    this.robe.position.y = 0.48;

    this.sash = part(GEO.sash, mat(0xe8b64c), this.bodyVisual);
    this.sash.rotation.x = Math.PI / 2;
    this.sash.position.y = 0.5;
    this.sash.scale.y = 1.15;

    // Chibi proportions: the head is nearly half the character, like the heroes.
    this.head = new Group();
    this.head.position.y = 1.06;
    this.bodyVisual.add(this.head);

    this.skull = part(GEO.head, mat(0x8e6f5a, { rough: 0.85 }), this.head);
    this.skull.scale.set(1, 0.94, 0.96);

    // Mask band across the eyes with two glowing eyes — the one high-contrast
    // feature, readable from across the arena, same trick the hero masks use.
    this.maskBand = part(GEO.maskBand, mat(0x232840), this.head);
    this.maskBand.position.set(0, 0.03, 0.12);
    const eyeMat = new MeshBasicMaterial({ color: 0xfff4cf });
    for (const x of [-0.13, 0.13]) {
      const eye = new Mesh(GEO.eye, eyeMat);
      eye.position.set(x, 0.04, 0.29);
      eye.scale.set(1, 1.25, 0.6);
      this.head.add(eye);
    }

    // All headgear variants exist on every instance; spawn toggles visibility.
    const earPointL = part(GEO.earPoint, mat(0x232840), this.head);
    earPointL.position.set(-0.19, 0.36, 0);
    earPointL.rotation.z = 0.32;
    const earPointR = part(GEO.earPoint, mat(0x232840), this.head);
    earPointR.position.set(0.19, 0.36, 0);
    earPointR.rotation.z = -0.32;

    const earRoundL = part(GEO.earRound, mat(0x8e6f5a, { rough: 0.85 }), this.head);
    earRoundL.position.set(-0.22, 0.31, 0);
    const earRoundR = part(GEO.earRound, mat(0x8e6f5a, { rough: 0.85 }), this.head);
    earRoundR.position.set(0.22, 0.31, 0);

    const hornL = part(GEO.horn, mat(0xc4cede, { metal: 0.6, rough: 0.3 }), this.head);
    hornL.position.set(-0.16, 0.33, 0.06);
    hornL.rotation.z = 0.42;
    const hornR = part(GEO.horn, mat(0xc4cede, { metal: 0.6, rough: 0.3 }), this.head);
    hornR.position.set(0.16, 0.33, 0.06);
    hornR.rotation.z = -0.42;

    const kasa = part(GEO.kasa, mat(0x9a7a4a, { rough: 0.9 }), this.head);
    kasa.position.y = 0.34;

    this.ears = {
      points: [earPointL, earPointR],
      round: [earRoundL, earRoundR],
      horns: [hornL, hornR],
      kasa: [kasa],
    };

    // Headband knot: two little ribbons at the back — the cute detail that
    // sells the mask as tied on rather than painted.
    this.ribbons = [part(GEO.ribbon, mat(0xe8b64c), this.head), part(GEO.ribbon, mat(0xe8b64c), this.head)];
    this.ribbons[0].position.set(-0.06, -0.08, -0.3);
    this.ribbons[0].rotation.set(0.35, 0, 0.25);
    this.ribbons[1].position.set(0.07, -0.09, -0.3);
    this.ribbons[1].rotation.set(0.4, 0, -0.3);

    const leftArm = this.makeArm(-0.3);
    const rightArm = this.makeArm(0.3);
    this.arms = [leftArm.shoulder, rightArm.shoulder];
    this.forearms = [leftArm.elbow, rightArm.elbow];
    const leftLeg = this.makeLeg(-0.12);
    const rightLeg = this.makeLeg(0.12);
    this.legs = [leftLeg.hip, rightLeg.hip];
    this.shins = [leftLeg.knee, rightLeg.knee];

    this.scarf = part(GEO.scarf, mat(0xe8b64c), this.bodyVisual);
    this.scarf.geometry = GEO.scarf;
    this.scarf.position.set(0, 0.86, -0.24);
    this.scarf.rotation.x = -0.4;

    this.tail = part(GEO.tail, mat(0x8e6f5a, { rough: 0.85 }), this.bodyVisual);
    this.tail.position.set(0, 0.32, -0.3);
    this.tail.scale.set(1, 0.8, 1.4);

    // Guard plate rides on the off hand, raised in front of the body.
    this.plate = new Group();
    this.forearms[0].add(this.plate);
    this.plate.position.set(0, -0.19, 0.12);
    // Plate materials are per-instance, not from the shared cache: a struck
    // plate flashes, and a shared material would light every guard on screen.
    const plateBody = part(
      GEO.plate,
      mat(0x6d7690, { metal: 0.55, rough: 0.4 }).clone(),
      this.plate,
    );
    plateBody.position.set(0, -0.1, 0);
    const band = part(
      GEO.plateBand,
      mat(0xe8b64c, { metal: 0.7, rough: 0.3 }).clone(),
      this.plate,
    );
    band.position.set(0, -0.1, 0.01);
    for (const m of [plateBody, band]) {
      (m.material as MeshStandardMaterial).emissive.setHex(0xffffff);
      (m.material as MeshStandardMaterial).emissiveIntensity = 0;
    }
    this.plateParts = [plateBody, band];
    this.plate.visible = false;

    this.weapon = new Group();
    this.forearms[1].add(this.weapon);
    this.weapon.position.set(0, -0.2, 0.05);
    // The mount, not each weapon, carries the holder's conventions: models are
    // authored grip-at-origin with the blade along +Y, while this arm hangs
    // downward, so the mount flips them and scales them to a chibi body. Every
    // weapon then attaches with the same small per-weapon tweak.
    this.weapon.rotation.set(Math.PI * 0.94, 0, 0.2);
    this.weapon.scale.setScalar(ENEMY_WEAPON_SCALE);

    this.aura = new Mesh(
      GEO.aura,
      new MeshBasicMaterial({ color: 0xffd35c, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.aura.position.y = 0.75;
    this.aura.visible = false;
    this.root.add(this.aura);

    // When the premium skin arrives, the low-detail anatomy disappears but
    // its animated joints keep driving weapons, plates and silhouette accents.
    this.bodyVisual.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      if (isBelow(o, this.weapon) || isBelow(o, this.plate)) return;
      this.fallbackMeshes.push(o);
    });

    this.group.visible = false;
  }

  /**
   * Replaces the instant-loading puppet body with a rigged player-quality skin.
   * The clone owns its skeleton and materials but shares geometry and textures.
   */
  setDetailedModel(model: Object3D): void {
    if (this.detailedModel) this.root.remove(this.detailedModel);
    for (const material of this.detailedMaterials) material.dispose();
    this.detailedMaterials.length = 0;
    this.detailedMaterialBases.clear();

    model.removeFromParent();
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    normalizeHeight(model, DETAILED_HEIGHT);

    const uniqueMaterials = new Set<MeshStandardMaterial>();
    model.traverse((o) => {
      if (!(o instanceof Mesh || o instanceof SkinnedMesh)) return;
      o.castShadow = true;
      o.receiveShadow = false;
      const source = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = source.map((material) => material.clone());
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
      for (const material of cloned) {
        material.side = FrontSide;
        if (material instanceof MeshStandardMaterial) uniqueMaterials.add(material);
      }
    });

    this.root.add(model);
    this.detailedModel = model;
    this.detailedRig = new RigAdapter(model, DETAILED_HEIGHT);
    this.detailedWeaponGrip = model.getObjectByName('WeaponGripR') ?? null;
    this.detailedOffhandGrip = model.getObjectByName('WeaponGripL') ?? null;
    this.detailedMaterials.push(...uniqueMaterials);
    for (const material of this.detailedMaterials) {
      this.detailedMaterialBases.set(material, {
        color: material.color.clone(),
        emissive: material.emissive.clone(),
        emissiveIntensity: material.emissiveIntensity,
        roughness: material.roughness,
      });
    }
    for (const mesh of this.fallbackMeshes) mesh.visible = false;

    // These mounts stay outside the internally-scaled imported model. Their
    // transforms are copied from its hands each frame, keeping full-size GLB
    // weapons and the breakable plate correctly aligned.
    this.weapon.removeFromParent();
    this.plate.removeFromParent();
    this.root.add(this.weapon, this.plate);
    this.applyDetailedPalette(CLANS[0], false);
    this.syncDetailedVisual();
  }

  get highDetail(): boolean {
    return this.detailedRig !== null;
  }

  private makeArm(x: number): { shoulder: Group; elbow: Group } {
    const shoulder = new Group();
    shoulder.position.set(x, 0.72, 0);
    this.bodyVisual.add(shoulder);
    const upper = part(GEO.arm, mat(0x232840), shoulder);
    upper.scale.y = 0.62;
    upper.position.y = -0.095;

    const elbow = new Group();
    elbow.position.y = -0.19;
    shoulder.add(elbow);
    const lower = part(GEO.arm, mat(0x232840), elbow);
    lower.scale.y = 0.62;
    lower.position.y = -0.095;
    const paw = part(GEO.paw, mat(0x8e6f5a, { rough: 0.85 }), elbow);
    paw.position.y = -0.21;
    return { shoulder, elbow };
  }

  private makeLeg(x: number): { hip: Group; knee: Group } {
    const hip = new Group();
    hip.position.set(x, 0.22, 0);
    this.bodyVisual.add(hip);
    const thigh = part(GEO.leg, mat(0x232840), hip);
    thigh.scale.y = 0.64;
    thigh.position.y = -0.064;

    const knee = new Group();
    knee.position.y = -0.128;
    hip.add(knee);
    const shin = part(GEO.leg, mat(0x232840), knee);
    shin.scale.y = 0.64;
    shin.position.y = -0.064;
    const foot = part(GEO.foot, mat(0xe8b64c), knee);
    foot.position.set(0, -0.15, 0.04);
    return { hip, knee };
  }

  /** Configures a pooled instance for a new threat. */
  spawn(opts: {
    side: Side;
    impactAt: number;
    spawnAt: number;
    approach: number;
    rare: boolean;
    rng: Rng;
    /** Reel staging: unlocks the moves that are too showy for live combat. */
    cinematic?: boolean;
    /** Reel staging: forces one specific attack. */
    attack?: string;
    /** Plates this enemy must have broken before it can be cut down. */
    guard?: number;
    /** A feint: runs in, pulls up short, and must NOT be struck. */
    feint?: boolean;
  }): void {
    const { side, impactAt, spawnAt, approach, rare, rng } = opts;
    this.cinematic = opts.cinematic === true;
    this.side = side;
    this.impactAt = impactAt;
    this.spawnAt = spawnAt;
    this.approach = approach;
    this.rare = rare;
    this.state = 'approach';
    this.phase = rng.range(0, Math.PI * 2);
    this.dieTimer = 0;
    this.windupProgress = 0;
    this.telegraph = 0;
    // Rotated, not rolled: cosmetic variety must never draw from the seeded
    // gameplay stream, or a visual tweak would reshuffle every balance sim.
    // Rotation also guarantees neighbours in a wave never share a style.
    // Rotated, not rolled: cosmetic variety must never draw from the seeded
    // gameplay stream, or a visual tweak would reshuffle every balance sim.
    // Rotation also guarantees neighbours in a wave never share a move.
    this.reaction = 'launch';
    this.lingerScale = 1;
    this.gravityScale = 1;
    this.threw = false;
    this.pendingThrow = false;
    this.weapon.visible = true;
    this.group.position.y = 0;
    this.resetAnimationPose();
    this.flowMark = 'none';
    this.posed = false;
    this.inertia.reset(this.group.position.x, 0);
    this.headLag.reset();
    this.scarfLag.reset();
    this.tailLag.reset();
    this.aura.scale.setScalar(1);
    (this.aura.material as MeshBasicMaterial).color.setHex(0xffd35c);
    (this.aura.material as MeshBasicMaterial).opacity = 0.16;
    this.guard = opts.guard ?? 0;
    this.feint = opts.feint === true;
    if (this.feint) this.guard = 0;
    this.guardMax = this.guard;
    this.blockFlash = 0;
    this.fromDistance = ENEMY.spawnDistance;
    this.plate.visible = this.guard > 0;
    // The plate grows with the number of hits it will take, so a two-plate
    // enemy is visibly carrying more than a one-plate enemy rather than
    // revealing it only after the first break.
    this.plate.scale.setScalar(this.guard > 1 ? 1.55 : 1.3);
    for (const m of this.plateParts) {
      (m.material as MeshStandardMaterial).emissiveIntensity = PLATE_GLOW;
    }

    // Rare wins over guarded: a rare guarded enemy is the biggest prize on the
    // board and should look like gold, with the plate carrying the second read.
    // The clan roll happens exactly when it did before — the seeded stream must
    // draw the same number of values whatever the enemy turns out to look like.
    const clan = rare ? RARE_PALETTE : rng.pick(CLANS);
    const palette = this.feint
      ? FEINT_PALETTE
      : !rare && this.guard > 0
        ? GUARD_PALETTE
        : clan;

    // Silhouette variation: headgear family, build, and tail presence read at a
    // glance and cost nothing — that variety is what keeps minutes of the same
    // enemy fresh.
    const earStyle: EarStyle = rare ? 'horns' : rng.pick(EAR_STYLES);
    for (const style of EAR_STYLES) {
      for (const m of this.ears[style]) m.visible = !this.detailedModel && style === earStyle;
    }
    this.tail.visible = !this.detailedModel && (earStyle === 'points' || earStyle === 'round');

    this.applyPalette(palette, rare, earStyle);

    const build = rng.range(0.9, 1.14);
    // A rare target is worth nine ordinary ones, so it is unmistakably bigger.
    this.root.scale.set(build, rare ? build * 1.22 : build, build);

    // The weapon is chosen first — rotated, never rolled, so cosmetic variety
    // stays out of the seeded gameplay stream — and the attack is then picked
    // from the moves that weapon actually suits.
    const weapon = rare ? weaponById('katana-ornate') : nextWeapon(this.cinematic);
    this.setWeapon(weapon.id, palette, rare);
    // Empty hands: the feint's whole promise is that it cannot hurt you, and
    // the silhouette has to say so before the player has to decide.
    this.weapon.visible = !this.feint;
    this.attack = opts.attack
      ? attackById(opts.attack)
      : pickAttack(this.cinematic, weapon.attacks);

    this.aura.visible = rare;

    const dir = side === 'L' ? -1 : 1;
    this.group.position.set(dir * ENEMY.spawnDistance, 0, 0);
    this.group.rotation.set(0, side === 'L' ? Math.PI / 2 : -Math.PI / 2, 0);
    this.root.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.syncDetailedVisual();
  }

  private applyPalette(p: Palette, rare: boolean, earStyle: EarStyle): void {
    this.metalColor = p.metal;
    const cloth = mat(p.cloth, rare ? { emissive: p.trim, rough: 0.4 } : {});
    const trim = mat(p.trim, rare ? { emissive: p.trim } : {});
    const fur = mat(p.fur, { rough: 0.85 });
    const metal = mat(p.metal, { metal: 0.65, rough: 0.28 });

    this.robe.material = cloth;
    this.sash.material = trim;
    this.skull.material = fur;
    this.maskBand.material = cloth;
    this.scarf.material = trim;
    this.tail.material = fur;
    for (const r of this.ribbons) r.material = trim;

    for (const m of this.ears.points) m.material = cloth;
    for (const m of this.ears.round) m.material = fur;
    for (const m of this.ears.horns) m.material = metal;
    if (earStyle === 'kasa') this.ears.kasa[0].material = mat(0x9a7a4a, { rough: 0.9 });

    for (const armOrLeg of [...this.arms, ...this.forearms, ...this.legs, ...this.shins]) {
      for (const child of armOrLeg.children) {
        if (!(child instanceof Mesh)) continue;
        if (child.geometry === GEO.arm || child.geometry === GEO.leg) child.material = cloth;
        else if (child.geometry === GEO.paw) child.material = fur;
        else if (child.geometry === GEO.foot) child.material = trim;
      }
    }
    this.applyDetailedPalette(p, rare);
  }

  /** Preserves the authored variant palette while retaining gameplay colours. */
  private applyDetailedPalette(p: Palette, rare: boolean): void {
    if (this.detailedMaterials.length === 0) return;
    for (const material of this.detailedMaterials) {
      const base = this.detailedMaterialBases.get(material);
      if (!base) continue;
      const role = material.name.toLowerCase();
      material.color.copy(base.color);
      material.emissive.copy(base.emissive);
      material.emissiveIntensity = base.emissiveIntensity;
      material.roughness = base.roughness;
      // Cloth picks up a little clan identity; metal, skin, and the signature
      // ronin/oni/tengu accents stay exactly as they were authored.
      if (role.includes('cloth')) material.color.lerp(new Color(p.cloth), rare ? 0.38 : 0.18);
      if (rare && (role.includes('accent') || role.includes('eyes'))) {
        material.emissive.setHex(p.trim);
        material.emissiveIntensity = role.includes('eyes') ? 2.8 : 0.35;
      }
      material.needsUpdate = true;
    }
  }

  /** Mirrors the proven combat puppet pose onto the imported humanoid rig. */
  private syncDetailedVisual(): void {
    const rig = this.detailedRig;
    if (!rig) return;
    rig.restoreBasePose();
    this.detailedPose.armL = rotationOf(this.arms[0]);
    this.detailedPose.forearmL = rotationOf(this.forearms[0]);
    this.detailedPose.armR = rotationOf(this.arms[1]);
    this.detailedPose.forearmR = rotationOf(this.forearms[1]);
    if (this.weaponDef.grip === 'twoHand') {
      // The support arm follows the driving arm with a smaller arc. The shaft
      // is solved through both sockets below, so this coupled motion keeps both
      // fists on the handle without making the off hand look nailed in place.
      const armR = this.detailedPose.armR;
      const forearmR = this.detailedPose.forearmR;
      this.detailedPose.armL = [
        MathUtils.clamp(-0.5 + armR[0] * 0.2, -1.08, -0.36),
        0.18 + armR[1] * 0.16,
        -0.58 + armR[2] * 0.2,
      ];
      this.detailedPose.forearmL = [
        MathUtils.clamp(-0.34 + forearmR[0] * 0.28, -0.62, -0.18),
        0.1 + forearmR[1] * 0.12,
        -0.42 + forearmR[2] * 0.18,
      ];
    }
    this.detailedPose.upLegL = rotationOf(this.legs[0]);
    this.detailedPose.legL = rotationOf(this.shins[0]);
    this.detailedPose.upLegR = rotationOf(this.legs[1]);
    this.detailedPose.legR = rotationOf(this.shins[1]);
    this.detailedPose.head = rotationOf(this.head);
    rig.applyPose(this.detailedPose, 1);

    this.detailedModel?.updateWorldMatrix(true, true);
    this.syncWeaponMount();
    this.syncRigMount(this.plate, 'handL', PLATE_MOUNT, this.detailedOffhandGrip);
  }

  /**
   * One-handed steel inherits the authored fist frame. For two-handed weapons,
   * the shaft is solved through both exported sockets so neither hand floats
   * beside the handle as the attack pose changes.
   */
  private syncWeaponMount(): void {
    this.syncRigMount(this.weapon, 'handR', WEAPON_MOUNT, this.detailedWeaponGrip);
    if (
      this.weaponDef.grip !== 'twoHand'
      || !this.detailedWeaponGrip
      || !this.detailedOffhandGrip
    ) return;

    this.detailedWeaponGrip.getWorldPosition(WORLD);
    this.detailedOffhandGrip.getWorldPosition(SECONDARY_WORLD);
    this.root.worldToLocal(WORLD);
    this.root.worldToLocal(SECONDARY_WORLD);
    solveTwoHandGrip(WORLD, SECONDARY_WORLD, this.weaponHoldQuaternion, this.weapon.quaternion);
  }

  private syncRigMount(
    mount: Object3D,
    bone: 'handL' | 'handR',
    correction: Quaternion,
    socket: Object3D | null,
  ): void {
    const target = socket ?? this.detailedRig?.get(bone);
    if (!target) return;
    target.getWorldPosition(WORLD);
    this.root.worldToLocal(WORLD);
    mount.position.copy(WORLD);
    target.getWorldQuaternion(WORLD_QUAT);
    this.root.getWorldQuaternion(ROOT_QUAT).invert();
    mount.quaternion.copy(ROOT_QUAT.multiply(WORLD_QUAT));
    // Legacy player rigs have no authored socket and keep their old correction;
    // the new enemy cast exports the complete grip frame from Blender.
    if (!socket) mount.quaternion.multiply(correction);
  }

  /**
   * Equips one weapon from the armoury, built in this clan's colours.
   *
   * The weapon is not decoration: it decides which attacks this body uses, how
   * far it reaches, and how heavy its windup reads. A naginata sweeps and
   * lunges; a nodachi comes over the top. Choosing the weapon first and the
   * move from it is what keeps the two agreeing.
   */
  private setWeapon(id: WeaponId, p: Palette, rare: boolean): void {
    this.weapon.clear();
    const def = weaponById(id);
    this.weaponDef = def;
    this.weaponHoldQuaternion.setFromEuler(
      new Euler(def.hold.rotation[0], def.hold.rotation[1], def.hold.rotation[2]),
    );
    // A streamed model is used the moment it lands; until then the procedural
    // build stands in, so an enemy is never empty-handed mid-run.
    const model = def.model ? weaponModel(id) : null;
    const equipped = model ?? buildWeapon(id, {
      metal: p.metal,
      wrap: 0x1e1a2a,
      accent: p.trim,
      glow: rare ? p.trim : undefined,
    });
    equipped.position.set(def.hold.position[0], def.hold.position[1], def.hold.position[2]);
    equipped.rotation.set(def.hold.rotation[0], def.hold.rotation[1], def.hold.rotation[2]);
    this.weapon.add(equipped);
  }

  /**
   * Advances the enemy.
   * @param now current run time, in the same clock as `impactAt`
   */
  update(dt: number, now: number): void {
    if (this.state === 'dead') return;

    if (this.state === 'dying') {
      this.dieTimer += dt;
      // A killed body is handed to the physics kernel: it arcs, lands, bounces,
      // slides and comes to rest. Nothing about the aftermath is keyframed.
      this.body.step(dt);
      this.group.position.copy(this.body.position);
      this.root.rotation.set(this.body.rotation.x, this.body.rotation.y, this.body.rotation.z);
      const life = ENEMY.despawnAfter * this.lingerScale;
      this.updateDeathPose(dt);
      this.syncDetailedVisual();
      // Keep physical proportions through the reaction. The old continuous
      // shrink made launched bodies look like balloons losing air; scale-down
      // is now confined to the final few frames before the pooled despawn.
      const vanish = smootherstep((this.dieTimer / life - 0.84) / 0.16);
      const scale = Math.max(0.001, 1 - vanish * 0.999);
      // Contact squash: hard on the first frames, gone within a fifth of a
      // second, compressing along the strike and stretching across it.
      if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 6.5);
      const punch = this.squash * this.squash;
      const along = 1 - punch * 0.42 * Math.abs(this.squashDir);
      const across = 1 + punch * 0.3;
      this.root.scale.set(
        this.deathScale.x * scale * along,
        this.deathScale.y * scale * across,
        this.deathScale.z * scale * across,
      );
      if (this.dieTimer >= life) this.retire();
      return;
    }

    // Gameplay has accepted the hit, but the target remains intact until the
    // animated foot/hand/blade reaches it. Holding the last defensive pose is
    // what makes the upcoming launch begin from visible physical contact.
    if (this.state === 'contact') {
      this.syncDetailedVisual();
      return;
    }

    if (this.state === 'reengage') {
      // Integrate the measured horizontal impulse, then hand the body back to
      // the scheduled approach. This keeps the plate hit physical without
      // allowing a cosmetic bounce to change its next fair impact time.
      this.group.position.x += this.reengageVelocity * dt;
      this.reengageVelocity *= Math.exp(-GUARD.recoilDamping * dt);
      const side = Math.sign(this.group.position.x) || (this.side === 'L' ? -1 : 1);
      this.group.position.x = side * Math.min(ENEMY.spawnDistance, Math.abs(this.group.position.x));
      this.updateReengagePose(dt);
      if (now >= this.reengageUntil) {
        this.fromDistance = Math.abs(this.group.position.x);
        this.spawnAt = now;
        this.approach = Math.max(0.12, this.impactAt - now);
        this.state = 'approach';
        this.inertia.reset(this.group.position.x, this.root.position.y);
      }
      this.syncDetailedVisual();
      return;
    }

    const dir = this.side === 'L' ? -1 : 1;
    // Position is derived from the schedule, not integrated from velocity, so a
    // frame spike can never desync an enemy from its own impact time. A posed
    // body — a Flow-chain target — keeps the placement its owner gave it.
    if (!this.posed) {
      const strikeAt = strikeDistanceFor(this.weaponDef.reach);
      if (this.feint && now >= this.impactAt) {
        // Pulled up short and backing out. Holding your nerve has to LOOK like
        // the right call — an enemy that simply stopped would read as the game
        // forgetting about it.
        const back = easeInQuad(clamp01((now - this.impactAt) / FEINT.retreatAfter));
        this.group.position.x = dir * (strikeAt + (this.fromDistance - strikeAt) * back);
      } else {
        // Constant forward pressure keeps the exchange feeling like a charge.
        // The authored windup supplies the readable tell; locomotion must not
        // ease into a crawl during the most important half-second.
        const progress = clamp01((now - this.spawnAt) / this.approach);
        // Reach still matters, but even a polearm user must enter the fight
        // instead of attacking from a detached-looking body length away.
        const distance = this.fromDistance + (strikeAt - this.fromDistance) * progress;
        this.group.position.x = dir * distance;
      }
    }

    if (this.flowMark !== 'none') this.updateFlowMark(now);

    // The telegraph starts by easing out of the scamper instead of replacing
    // it on one frame. A fighter planting their feet before a cut is far more
    // legible than a puppet snapping from run pose to attack pose.
    const toImpact = this.impactAt - now;
    const raw = toImpact < 0.62 ? clamp01(1 - toImpact / 0.62) : 0;
    // A feint leans in but never finishes the motion. Capping the telegraph is
    // what makes it a fake rather than a strike that happens to miss: the body
    // commits far enough to be tempting and stops short of the frame that would
    // land.
    this.telegraph = this.feint ? Math.min(0.55, raw) : raw;
    // A heavy weapon commits later and harder: the same telegraph window, but
    // the body holds its run posture longer before the shape of the strike
    // takes over. The impact frame is untouched, so the read never changes.
    const windupBlend = smoothstep(Math.pow(this.telegraph, 1 + this.weaponDef.heft * 0.55));

    // Scamper cycle: chibi bodies read best with a quick bouncy waddle — short
    // stride, big vertical bob, head counter-tilting, scarf and tail trailing.
    const speed = MathUtils.lerp(10, 3, windupBlend);
    this.phase += dt * speed;
    const swing = Math.sin(this.phase);
    const bob = Math.abs(Math.cos(this.phase));
    this.arms[0].rotation.set(swing * 0.75, 0, 0);
    this.arms[1].rotation.set(-swing * 0.45 - 0.35, 0, 0);
    this.forearms[0].rotation.set(-swing * 0.42 - 0.12, 0, 0);
    this.forearms[1].rotation.set(swing * 0.3 - 0.18, 0, 0);
    this.legs[0].rotation.set(-swing * 1.05, 0, 0);
    this.legs[1].rotation.set(swing * 1.05, 0, 0);
    // A shin only folds on the leg currently travelling forward. The bend is
    // phase-offset on each side, keeping the feet from reading as stiff rods.
    this.shins[0].rotation.set(Math.max(0, swing) * 0.72, 0, 0);
    this.shins[1].rotation.set(Math.max(0, -swing) * 0.72, 0, 0);
    this.root.position.y = bob * 0.1;

    // Secondary motion driven by the body's OWN acceleration rather than a
    // canned offset: when this enemy speeds up its scarf, tail and head are
    // left behind for a moment, and swing through when it plants its feet.
    // That lag is most of what separates a moving character from a translated
    // model, and it costs one subtraction and three springs per frame.
    this.inertia.step(this.group.position.x, this.root.position.y, dt);
    const facing = this.side === 'L' ? -1 : 1;
    const lagTarget = clampLag(-this.inertia.accelX * PHYSICS.lagPerAccel) * facing;
    const headLag = this.headLag.step(lagTarget, dt);
    const scarfLag = this.scarfLag.step(lagTarget, dt);
    const tailLag = this.tailLag.step(lagTarget, dt);

    this.head.rotation.set(headLag * 0.9, 0, swing * 0.07);
    this.scarf.rotation.set(-0.4 - swing * 0.3 + scarfLag * 1.7, 0, scarfLag * 0.9);
    this.tail.rotation.set(swing * 0.35 + tailLag * 1.4, 0, 0);
    this.root.rotation.set(0, swing * 0.1, 0);

    // Telegraph: the last stretch before impact raises the weapon and leans in.
    if (this.telegraph > 0) {
      this.state = 'windup';
      this.windupProgress = this.telegraph;
      const w = easeInQuad(this.telegraph);
      // The attack track runs across the whole windup: t=0 is the first frame
      // of the tell, t=1 is the instant the blow lands. Whichever move a body
      // is playing, the strike peaks on its impact time, so the read never
      // changes — only the shape of it.
      sampleEnemy(this.attack.track, this.telegraph, this.attackPose);
      const p = this.attackPose;
      const mirror = this.side === 'L' ? -1 : 1;
      if (p.armR) blendRotation(this.arms[1], p.armR, windupBlend);
      if (p.armL) blendRotation(this.arms[0], p.armL, windupBlend);
      if (p.forearmR) blendRotation(this.forearms[1], p.forearmR, windupBlend);
      if (p.forearmL) blendRotation(this.forearms[0], p.forearmL, windupBlend);
      if (p.legR) blendRotation(this.legs[1], p.legR, windupBlend);
      if (p.legL) blendRotation(this.legs[0], p.legL, windupBlend);
      // Elbows and knees give the attack pose a relaxed preparation, then
      // naturally straighten into the contact frame rather than staying rigid.
      if (!p.forearmR) {
        this.forearms[1].rotation.x = MathUtils.lerp(this.forearms[1].rotation.x, -0.16, windupBlend);
      }
      if (!p.forearmL) {
        this.forearms[0].rotation.x = MathUtils.lerp(this.forearms[0].rotation.x, -0.1, windupBlend);
      }
      this.shins[0].rotation.x = MathUtils.lerp(this.shins[0].rotation.x, 0.08, windupBlend);
      this.shins[1].rotation.x = MathUtils.lerp(this.shins[1].rotation.x, 0.08, windupBlend);
      if (p.head) blendRotation(this.head, mirrored(p.head, mirror), windupBlend);
      if (p.scarf) blendRotation(this.scarf, p.scarf, windupBlend);
      if (p.tail) blendRotation(this.tail, p.tail, windupBlend);
      if (p.root) blendRotation(this.root, mirrored(p.root, mirror), windupBlend);
      if (p.offset) {
        this.group.position.x += p.offset[0] * -mirror * windupBlend;
        this.root.position.y += p.offset[1] * windupBlend;
        this.group.position.z += p.offset[2] * windupBlend;
      }

      // A thrown weapon leaves the hand mid-windup; the reel picks the cue up
      // and flies the projectile the rest of the way.
      if (this.attack.throwAt !== undefined && !this.threw && this.telegraph >= this.attack.throwAt) {
        this.threw = true;
        this.pendingThrow = true;
        this.weapon.visible = false;
      }

      if (this.rare) this.aura.scale.setScalar(1 + w * 0.35);
    } else {
      this.arms[0].rotation.z = 0;
      this.arms[1].rotation.z = 0;
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
      this.head.rotation.x = 0;
      this.head.rotation.z = 0;
    }

    // A guarded enemy holds the plate up as it closes, and the plate itself is
    // the tell: it is visible for the whole approach, not just the windup.
    if (this.guard > 0) {
      this.arms[0].rotation.x = -0.95 - this.telegraph * 0.35;
      this.arms[0].rotation.z = 0.25;
    }
    if (this.blockFlash > 0) {
      // The struck plate glows down from white as the recoil settles.
      for (const m of this.plateParts) {
        const mat = m.material as MeshStandardMaterial;
        mat.emissiveIntensity = PLATE_GLOW + this.blockFlash * 2.4;
      }
      // Recoil from the blocked strike: rocked back, plate shoved aside.
      this.blockFlash = Math.max(0, this.blockFlash - dt * 3.2);
      const b = this.blockFlash;
      this.root.rotation.x = -b * 0.5;
      this.root.position.y = b * 0.12;
      this.arms[0].rotation.z = 0.25 + b * 0.9;
      this.head.rotation.x = -b * 0.4;
    }
    this.syncDetailedVisual();
  }

  /**
   * Takes the enemy out of the fight.
   *
   * `reaction` chooses how the body leaves: knocked away, popped up to hang for
   * the next blow, driven into the floor, spun off, or thrown back over the
   * hero's head. The reel matches the reaction to the move that caused it,
   * which is most of what makes a staged exchange read as choreography rather
   * than as the same hit three times.
   */
  kill(fromX: number, power: number, reaction: ReactionKind = 'launch'): void {
    if (this.state === 'dying' || this.state === 'dead') return;
    const r = REACTIONS[reaction];
    const away = Math.sign(this.group.position.x - fromX) || 1;
    const dir = r.overhead ? -away : away;
    const linear = {
      x: dir * ENEMY.launchSpeed * power * r.out,
      y: ENEMY.launchSpeed * 0.62 * power * r.up,
      z: 1.6 * power * r.depth,
    };
    const spin = ENEMY.launchSpin * power * dir * r.spin;
    this.launchDeath(
      reaction,
      linear,
      { x: spin * 0.55, y: spin * 0.18, z: spin },
      power,
    );
  }

  /** Launches from the measured striking-bone impulse rather than a preset. */
  killFromContact(impulse: ContactImpulse, reaction: ReactionKind, debrisPower: number): void {
    if (this.state === 'dying' || this.state === 'dead') return;
    this.launchDeath(reaction, impulse.linear, impulse.angular, debrisPower);
  }

  private launchDeath(
    reaction: ReactionKind,
    linear: { x: number; y: number; z: number },
    angular: { x: number; y: number; z: number },
    debrisPower: number,
  ): void {
    this.state = 'dying';
    this.dieTimer = 0;
    this.reaction = reaction;
    this.deathScale.copy(this.root.scale);
    const r = REACTIONS[reaction];
    this.lingerScale = r.linger;
    this.gravityScale = r.gravity ?? 1;
    this.launch = { x: linear.x, y: linear.y, z: linear.z, spin: angular.z };

    this.body.reset({
      gravity: PHYSICS.gravity * this.gravityScale,
      restitution: PHYSICS.restitution,
      friction: PHYSICS.friction,
      angularDamping: PHYSICS.angularDamping,
      sleepSpeed: PHYSICS.sleepSpeed,
      radius: PHYSICS.bodyRadius,
    });
    this.body.launch(
      this.group.position,
      linear,
      angular,
    );
    this.body.rotation.set(this.root.rotation.x, this.root.rotation.y, this.root.rotation.z);

    // The weapon leaves the hand and becomes debris of its own.
    if (this.props && this.weapon.visible) {
      this.weapon.getWorldPosition(WORLD);
      const dir = Math.sign(linear.x) || 1;
      this.props.dropBlade(WORLD.x, WORLD.y, WORLD.z, dir, debrisPower, this.metalColor);
      this.weapon.visible = false;
    }
  }

  /** Removes this enemy from threat selection while awaiting visual contact. */
  reserveContact(): boolean {
    if (!this.isThreat) return false;
    this.state = 'contact';
    this.windupProgress = 1;
    this.telegraph = 1;
    return true;
  }

  /** World-space target on this body's centre line, scaled with its build. */
  contactPoint(localHeight: number, out: Vector3): Vector3 {
    out.set(0, localHeight, 0);
    return this.group.localToWorld(out);
  }

  /** Articulated follow-through layered beneath the rigid-body launch. */
  private updateDeathPose(dt: number): void {
    const grounded = this.body.grounded && this.launch.y === 0;
    const folds = this.reaction === 'slam' || this.reaction === 'kneel';
    const phase = this.dieTimer * (6 + Math.min(5, Math.abs(this.launch.spin) * 0.16));
    const oscillation = Math.sin(phase);
    const settle = grounded ? 1 : 0;

    dampRotation(this.arms[0], [-0.85 + oscillation * 0.28 * (1 - settle), 0, 0.9], 8, dt);
    dampRotation(this.arms[1], [-0.85 - oscillation * 0.28 * (1 - settle), 0, -0.9], 8, dt);
    dampRotation(this.forearms[0], [-0.55 - settle * 0.35, 0, 0.18], 9, dt);
    dampRotation(this.forearms[1], [-0.55 - settle * 0.35, 0, -0.18], 9, dt);

    const hipFold = folds ? 1.0 : grounded ? 0.58 : 0.24;
    const kneeFold = folds ? -1.25 : grounded ? -0.82 : -0.35;
    dampRotation(this.legs[0], [hipFold + oscillation * 0.12 * (1 - settle), 0, 0.2], 9, dt);
    dampRotation(this.legs[1], [hipFold - oscillation * 0.12 * (1 - settle), 0, -0.2], 9, dt);
    dampRotation(this.shins[0], [kneeFold, 0, 0], 10, dt);
    dampRotation(this.shins[1], [kneeFold, 0, 0], 10, dt);
    dampRotation(this.head, [grounded ? 0.38 : oscillation * 0.16, 0, oscillation * 0.18], 7, dt);
    dampRotation(this.scarf, [-1.05 + settle * 0.35, 0, -oscillation * 0.16], 6, dt);
    dampRotation(this.tail, [0.55 - settle * 0.3, oscillation * 0.22, 0], 6, dt);
  }

  /**
   * Marks this body's place in the Flow chain, and takes ownership of its
   * position: `pose()` placement is kept instead of being recomputed from a
   * schedule the chain does not use.
   */
  setFlowMark(mark: 'none' | 'target' | 'queued'): void {
    this.flowMark = mark;
    this.posed = mark !== 'none';
    const aura = this.aura.material as MeshBasicMaterial;
    if (mark === 'target') {
      this.aura.visible = true;
      aura.color.setHex(0x8affd8);
      aura.opacity = 0.42;
      this.root.scale.setScalar(1.16);
    } else if (mark === 'queued') {
      this.aura.visible = false;
      this.root.scale.setScalar(0.82);
    } else {
      this.aura.visible = this.rare;
      aura.color.setHex(0xffd35c);
      aura.opacity = 0.16;
      this.root.scale.setScalar(1);
    }
  }

  /** This body's place in the Flow chain: the lit target, queued, or neither. */
  get marked(): 'none' | 'target' | 'queued' {
    return this.flowMark;
  }

  /** Places a body directly, for the Flow chain's authored layout. */
  poseAt(x: number, z: number): void {
    this.group.position.set(x, 0, z);
    this.posed = true;
  }

  private updateFlowMark(now: number): void {
    if (this.flowMark !== 'target') return;
    // A slow breathing pulse: enough to catch the eye without competing with
    // the impact effects firing all around it.
    const pulse = 0.5 + 0.5 * Math.sin(now * 7);
    this.aura.scale.setScalar(1.06 + pulse * 0.16);
    (this.aura.material as MeshBasicMaterial).opacity = 0.34 + pulse * 0.16;
    this.root.scale.setScalar(1.14 + pulse * 0.05);
  }

  /**
   * A strike that landed on the plate instead of the body.
   *
   * The enemy is knocked back and comes again with a fresh impact time, so the
   * follow-up costs another read and another piece of timing — never a second
   * button press into the same window.
   */
  breakGuard(now: number, seconds: number, fromX: number, impulse?: ContactImpulse): void {
    this.guard = Math.max(0, this.guard - 1);
    this.blockFlash = 1;
    if (this.guard === 0) {
      // The plate does not simply switch off: it comes apart where it was hit.
      if (this.props) {
        this.plate.getWorldPosition(WORLD);
        const outward = Math.sign(this.group.position.x - fromX) || 1;
        this.props.shatter(WORLD.x, WORLD.y, WORLD.z, outward, 5, 0x8d97ae);
      }
      this.plate.visible = false;
    }

    // Re-engage from where it stands rather than from the spawn line. The same
    // contact impulse that rocks the hero now drives this short recoil phase.
    const measured = impulse ? Math.abs(impulse.linear.x) : GUARD.recoilDistance / GUARD.recoilSeconds;
    this.beginReengage(now, seconds, fromX, Math.max(3.5, measured * 0.58));
  }

  /** Resets after connecting with the hero instead of disappearing. */
  recoverAfterAttack(now: number, seconds: number, fromX: number): void {
    this.blockFlash = 0;
    this.beginReengage(now, seconds, fromX, ENEMY.retryRetreatSpeed);
  }

  private beginReengage(now: number, seconds: number, fromX: number, speed: number): void {
    const away = Math.sign(this.group.position.x - fromX) || 1;
    this.impactAt = now + seconds;
    this.reengageVelocity = away * speed;
    this.reengageUntil = now + Math.min(ENEMY.retryRetreatSeconds, seconds * 0.4);
    this.state = 'reengage';
    this.telegraph = 0;
    this.windupProgress = 0;
    this.threw = false;
  }

  private updateReengagePose(dt: number): void {
    this.blockFlash = Math.max(0, this.blockFlash - dt * 3.2);
    const b = this.blockFlash;
    dampRotation(this.root, [-b * 0.5, 0, 0], 10, dt);
    this.root.position.y = MathUtils.damp(this.root.position.y, b * 0.12, 10, dt);
    dampRotation(this.arms[0], [-0.28, 0, 0.25 + b * 0.9], 10, dt);
    dampRotation(this.arms[1], [-0.42, 0, -0.2], 10, dt);
    dampRotation(this.legs[0], [0.18, 0, 0.08], 10, dt);
    dampRotation(this.legs[1], [-0.12, 0, -0.08], 10, dt);
    dampRotation(this.head, [-b * 0.4, 0, 0], 10, dt);
    for (const m of this.plateParts) {
      (m.material as MeshStandardMaterial).emissiveIntensity = PLATE_GLOW + b * 2.4;
    }
  }

  /** True while this enemy still has a plate that must be broken first. */
  get guarded(): boolean {
    return this.guard > 0;
  }

  get guardLayers(): number {
    return this.guardMax;
  }

  /**
   * The frame of contact.
   *
   * A launch alone reads as a body being moved; a body that is COMPRESSED by
   * the blow and springs back as it leaves reads as a body being hit. The
   * squash runs on the death timer, so it is over within a few frames and never
   * fights the physics that follows it.
   */
  impactSquash(direction: number, strength: number): void {
    this.squash = strength;
    this.squashDir = direction;
  }

  /** How this body is currently leaving the fight. */
  get reactionKind(): ReactionKind {
    return this.reaction;
  }

  /** Live rigid-body state used by the arena's post-hit collision layer. */
  get deathPosition(): Vector3 {
    return this.body.position;
  }

  get deathVelocity(): Vector3 {
    return this.body.velocity;
  }

  get deathAngularVelocity(): Vector3 {
    return this.body.angular;
  }

  get deathSpeed(): number {
    return this.body.speed;
  }

  setDeathFloor(y: number): void {
    this.body.setFloorY(y);
  }

  /** Stops the ballistic body in water with strong linear and angular drag. */
  settleDeathInWater(surfaceY: number): void {
    this.body.position.y = surfaceY + PHYSICS.bodyRadius * 0.72;
    this.body.velocity.set(
      this.body.velocity.x * 0.12,
      0,
      this.body.velocity.z * 0.12,
    );
    this.body.angular.multiplyScalar(0.28);
    this.body.setFloorY(surfaceY - PHYSICS.bodyRadius * 0.28);
  }

  /** Removes the enemy without the launch, e.g. when a run ends. */
  retire(): void {
    this.state = 'dead';
    this.group.visible = false;
    this.group.position.y = 0;
    this.weapon.visible = true;
    this.pendingThrow = false;
    this.plate.visible = false;
    this.guard = 0;
    this.blockFlash = 0;
    this.flowMark = 'none';
    this.posed = false;
    this.squash = 0;
    this.root.scale.setScalar(1);
    this.root.scale.setScalar(1);
    this.resetAnimationPose();
  }

  /** Clears the transient combat pose before an instance returns to the pool. */
  private resetAnimationPose(): void {
    for (const joint of [...this.arms, ...this.forearms, ...this.legs, ...this.shins]) {
      joint.rotation.set(0, 0, 0);
    }
    this.head.rotation.set(0, 0, 0);
    this.scarf.rotation.set(-0.4, 0, 0);
    this.tail.rotation.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.position.y = 0;
  }

  get isThreat(): boolean {
    return this.state === 'approach' || this.state === 'windup' || this.state === 'reengage';
  }

  get windup(): number {
    return this.windupProgress;
  }
}

function rotationOf(object: Object3D): readonly [number, number, number] {
  return [object.rotation.x, object.rotation.y, object.rotation.z];
}

function isBelow(object: Object3D, ancestor: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampLag = (v: number) =>
  v < -PHYSICS.maxLag ? -PHYSICS.maxLag : v > PHYSICS.maxLag ? PHYSICS.maxLag : v;
const easeInQuad = (t: number) => t * t;
const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Quintic smoothstep: zero first AND second derivative at both ends. */
const smootherstep = (t: number) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

function blendRotation(target: Object3D, to: readonly [number, number, number], weight: number): void {
  target.rotation.set(
    MathUtils.lerp(target.rotation.x, to[0], weight),
    MathUtils.lerp(target.rotation.y, to[1], weight),
    MathUtils.lerp(target.rotation.z, to[2], weight),
  );
}

function dampRotation(
  target: Object3D,
  to: readonly [number, number, number],
  smoothing: number,
  dt: number,
): void {
  target.rotation.set(
    MathUtils.damp(target.rotation.x, to[0], smoothing, dt),
    MathUtils.damp(target.rotation.y, to[1], smoothing, dt),
    MathUtils.damp(target.rotation.z, to[2], smoothing, dt),
  );
}

function mirrored(
  rotation: readonly [number, number, number],
  side: number,
): readonly [number, number, number] {
  return [rotation[0], rotation[1] * side, rotation[2] * side];
}
