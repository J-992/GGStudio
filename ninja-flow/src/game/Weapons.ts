import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
} from 'three';

/**
 * The weapon library.
 *
 * Every weapon is built from the same small vocabulary of shapes so the whole
 * armoury reads as one set: a lacquered grip with a cord wrap, a metal fitting
 * at each end, and a blade or head with a bevel rather than a flat slab. What
 * separates them is silhouette — length, curve, where the mass sits — because
 * at this camera distance silhouette is all the player actually reads.
 *
 * A weapon is more than a mesh. Each one declares how it is held, how far it
 * reaches, which attacks suit it, and what it looks like once it has been
 * knocked out of a hand, so equipping one changes how its owner fights rather
 * than only how they look.
 */

/**
 * Weapons backed by a real model, built by tools/build-weapons.mjs from the
 * CC-BY packs credited in ASSET_LICENSES.md. Every one is normalised by that
 * pipeline: grip at the origin, blade along +Y, sized in metres — so a single
 * hold transform works for all of them and nothing needs correcting here.
 */
export const MODEL_WEAPONS = [
  'katana',
  'katana-ornate',
  'katana-worn',
  'katana-scifi',
  'wakizashi',
  'wakizashi-serrated',
  'ninjato',
  'ninjato-gold',
  'nagamaki',
  'tanto',
  'tanto-hooked',
  'tanto-broad',
] as const;

export type ModelWeaponId = (typeof MODEL_WEAPONS)[number];

export type WeaponId =
  | ModelWeaponId
  | 'kama'
  | 'kusarigama'
  | 'naginata'
  | 'bo'
  | 'tessen'
  | 'tonfa';

export type GripStyle = 'oneHand' | 'twoHand' | 'reverse';

export interface WeaponDef {
  readonly id: WeaponId;
  readonly name: string;
  /** True when a real model is streamed for this weapon; `build` is the fallback. */
  readonly model?: boolean;
  /** Builds a fresh instance. Materials are supplied so it takes a clan palette. */
  readonly build: (metal: Material, wrap: Material, accent: Material) => Group;
  readonly grip: GripStyle;
  /** Local offset and rotation in the holder's hand. */
  readonly hold: {
    position: readonly [number, number, number];
    rotation: readonly [number, number, number];
  };
  /** Multiplier on how far its owner can strike from. */
  readonly reach: number;
  /** Enemy attack ids this weapon suits — see EnemyMoves. */
  readonly attacks: readonly string[];
  /** Shape the physics prop takes when the weapon is knocked loose. */
  readonly debris: 'blade' | 'pole' | 'compact';
  /** Roughly how heavy it should read, 0..1. Drives windup weight. */
  readonly heft: number;
}

// ------------------------------------------------------------- shared parts

const GEO = {
  gripCore: new CylinderGeometry(0.028, 0.032, 0.3, 8),
  wrapBand: new BoxGeometry(0.072, 0.026, 0.072),
  collar: new CylinderGeometry(0.045, 0.045, 0.035, 10),
  discGuard: new CylinderGeometry(0.1, 0.1, 0.018, 14),
  squareGuard: new BoxGeometry(0.17, 0.022, 0.17),
  pommel: new SphereGeometry(0.042, 10, 8),
  pole: new CylinderGeometry(0.03, 0.034, 1, 9),
  chainLink: new TorusGeometry(0.028, 0.009, 4, 7),
  weight: new OctahedronGeometry(0.075),
  fanRib: new BoxGeometry(0.016, 0.42, 0.012),
} as const;

/** A blade profile: bevelled edge, spine, and a point rather than a flat box. */
function bladeGeometry(length: number, width: number, curve: number): BufferGeometry {
  const half = width * 0.5;
  const points: Vector2[] = [];
  const segments = 9;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Taper toward the tip, with the widest point a third of the way up.
    const taper = t < 0.12 ? 0.72 + t * 2.2 : 1 - Math.pow((t - 0.12) / 0.88, 2.1) * 0.92;
    points.push(new Vector2(Math.max(0.004, half * taper), t * length + curve * t * t * 0.0));
  }
  // Lathed on a 4-sided profile: a diamond cross-section, which is what gives
  // the edge its highlight instead of a flat card.
  return new LatheGeometry(points, 4, Math.PI * 0.25, Math.PI * 2);
}

const BLADE = {
  katana: bladeGeometry(0.86, 0.075, 0),
  wakizashi: bladeGeometry(0.58, 0.07, 0),
  nodachi: bladeGeometry(1.24, 0.09, 0),
  tanto: bladeGeometry(0.34, 0.062, 0),
  naginata: bladeGeometry(0.46, 0.085, 0),
  kama: bladeGeometry(0.3, 0.07, 0),
} as const;

function part(geometry: BufferGeometry, material: Material, parent: Group): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** The wrapped handle every bladed weapon shares. */
function buildGrip(parent: Group, wrap: Material, metal: Material, length: number): void {
  const core = part(GEO.gripCore, wrap, parent);
  core.scale.y = length / 0.3;
  core.position.y = -length * 0.5;
  // Cord wrap: alternating bands, the detail that stops the handle reading as
  // a plain cylinder at any distance.
  const bands = Math.max(2, Math.round(length / 0.075));
  for (let i = 0; i < bands; i++) {
    const band = part(GEO.wrapBand, metal, parent);
    band.position.y = -length * (0.1 + (i / bands) * 0.82);
    band.rotation.y = i * 0.4;
    band.scale.setScalar(0.92 - (i % 2) * 0.08);
  }
  const cap = part(GEO.pommel, metal, parent);
  cap.position.y = -length - 0.01;
}

// ------------------------------------------------------------ the armoury

function sword(blade: BufferGeometry, gripLength: number, guard: 'disc' | 'square' | 'none') {
  return (metal: Material, wrap: Material, accent: Material): Group => {
    const g = new Group();
    part(blade, metal, g).position.y = 0.02;
    if (guard !== 'none') {
      const guardMesh = part(guard === 'disc' ? GEO.discGuard : GEO.squareGuard, accent, g);
      guardMesh.position.y = 0.005;
    }
    const collar = part(GEO.collar, accent, g);
    collar.position.y = -0.02;
    buildGrip(g, wrap, accent, gripLength);
    return g;
  };
}

function polearm(head: BufferGeometry | null, length: number, capped: boolean) {
  return (metal: Material, wrap: Material, accent: Material): Group => {
    const g = new Group();
    const shaft = part(GEO.pole, wrap, g);
    shaft.scale.y = length;
    shaft.position.y = -length * 0.42;
    // Grip bindings at the balance points.
    for (const y of [-length * 0.12, -length * 0.55, -length * 0.82]) {
      const band = part(GEO.collar, accent, g);
      band.position.y = y;
      band.scale.setScalar(0.78);
    }
    if (head) {
      const blade = part(head, metal, g);
      blade.position.y = length * 0.1;
      blade.rotation.z = -0.16;
      const collar = part(GEO.collar, accent, g);
      collar.position.y = length * 0.08;
    }
    if (capped) {
      const cap = part(GEO.collar, metal, g);
      cap.position.y = -length * 0.92;
      cap.scale.setScalar(0.9);
    }
    return g;
  };
}

/**
 * The armoury.
 *
 * Model-backed weapons carry `model: true` and are streamed from public/weapons;
 * the rest are built procedurally here so the set still covers shapes the packs
 * do not include (sickles, chains, staves, fans, batons) and so every enemy has
 * something to hold before the models finish streaming.
 *
 * A weapon is more than a mesh: it decides which attacks its owner uses, how far
 * they strike from, and how heavy the windup reads.
 */
export const WEAPONS: readonly WeaponDef[] = [
  // --- model-backed steel ------------------------------------------------
  {
    id: 'katana', name: 'Katana', model: true, build: sword(BLADE.katana, 0.22, 'disc'),
    grip: 'oneHand', hold: { position: [0, -0.06, 0.03], rotation: [0.24, 0, 0.3] },
    reach: 1, attacks: ['chop', 'sideCut', 'doubleSlash'], debris: 'blade', heft: 0.5,
  },
  {
    id: 'katana-ornate', name: 'Ornate katana', model: true, build: sword(BLADE.katana, 0.22, 'disc'),
    grip: 'oneHand', hold: { position: [0, -0.06, 0.03], rotation: [0.24, 0, 0.3] },
    reach: 1, attacks: ['chop', 'spinCut', 'sideCut'], debris: 'blade', heft: 0.55,
  },
  {
    id: 'katana-worn', name: 'Worn katana', model: true, build: sword(BLADE.katana, 0.22, 'disc'),
    grip: 'oneHand', hold: { position: [0, -0.06, 0.03], rotation: [0.24, 0, 0.3] },
    reach: 1, attacks: ['chop', 'sideCut'], debris: 'blade', heft: 0.5,
  },
  {
    id: 'katana-scifi', name: 'Sci-fi katana', model: true, build: sword(BLADE.katana, 0.22, 'disc'),
    grip: 'oneHand', hold: { position: [0, -0.06, 0.03], rotation: [0.24, 0, 0.3] },
    reach: 1.02, attacks: ['sideCut', 'doubleSlash'], debris: 'blade', heft: 0.45,
  },
  {
    id: 'wakizashi', name: 'Wakizashi', model: true, build: sword(BLADE.wakizashi, 0.17, 'disc'),
    grip: 'oneHand', hold: { position: [0, -0.05, 0.03], rotation: [0.2, 0, 0.28] },
    reach: 0.88, attacks: ['doubleSlash', 'lunge', 'sideCut'], debris: 'blade', heft: 0.34,
  },
  {
    id: 'wakizashi-serrated', name: 'Serrated wakizashi', model: true,
    build: sword(BLADE.wakizashi, 0.17, 'disc'), grip: 'oneHand',
    hold: { position: [0, -0.05, 0.03], rotation: [0.2, 0, 0.28] },
    reach: 0.88, attacks: ['doubleSlash', 'lunge'], debris: 'blade', heft: 0.36,
  },
  {
    id: 'ninjato', name: 'Ninjato', model: true, build: sword(BLADE.katana, 0.2, 'square'),
    grip: 'oneHand', hold: { position: [0, -0.06, 0.03], rotation: [0.22, 0, 0.3] },
    reach: 0.94, attacks: ['lunge', 'sideCut', 'doubleSlash'], debris: 'blade', heft: 0.42,
  },
  {
    id: 'ninjato-gold', name: 'Gilded ninjato', model: true, build: sword(BLADE.katana, 0.2, 'square'),
    grip: 'oneHand', hold: { position: [0, -0.06, 0.03], rotation: [0.22, 0, 0.3] },
    reach: 0.94, attacks: ['spinCut', 'sideCut'], debris: 'blade', heft: 0.44,
  },
  {
    id: 'nagamaki', name: 'Nagamaki', model: true, build: polearm(BLADE.naginata, 1.15, true),
    grip: 'twoHand', hold: { position: [0, -0.02, 0.04], rotation: [0.32, 0, 0.16] },
    reach: 1.32, attacks: ['sweep', 'lunge', 'spinCut'], debris: 'pole', heft: 0.85,
  },
  {
    id: 'tanto', name: 'Tanto', model: true, build: sword(BLADE.tanto, 0.14, 'none'),
    grip: 'oneHand', hold: { position: [0, -0.04, 0.03], rotation: [0.16, 0, 0.26] },
    reach: 0.72, attacks: ['lunge', 'doubleSlash'], debris: 'compact', heft: 0.2,
  },
  {
    id: 'tanto-hooked', name: 'Hooked tanto', model: true, build: sword(BLADE.tanto, 0.14, 'none'),
    grip: 'oneHand', hold: { position: [0, -0.04, 0.03], rotation: [0.16, 0, 0.26] },
    reach: 0.74, attacks: ['sweep', 'lunge'], debris: 'compact', heft: 0.22,
  },
  {
    id: 'tanto-broad', name: 'Broad tanto', model: true, build: sword(BLADE.tanto, 0.14, 'none'),
    grip: 'oneHand', hold: { position: [0, -0.04, 0.03], rotation: [0.16, 0, 0.26] },
    reach: 0.76, attacks: ['chop', 'doubleSlash'], debris: 'compact', heft: 0.26,
  },

  // --- procedural, covering shapes the packs do not include ---------------
  {
    id: 'kama',
    name: 'Kama',
    build: (metal, wrap, accent) => {
      const g = new Group();
      const blade = part(BLADE.kama, metal, g);
      blade.rotation.z = -1.42;
      blade.position.set(0.05, 0.03, 0);
      const collar = part(GEO.collar, accent, g);
      collar.position.y = -0.01;
      buildGrip(g, wrap, accent, 0.24);
      return g;
    },
    grip: 'oneHand',
    hold: { position: [0, -0.18, 0.04], rotation: [0.2, 0, 0.3] },
    reach: 0.82,
    attacks: ['sweep', 'sideCut'],
    debris: 'compact',
    heft: 0.36,
  },
  {
    id: 'kusarigama',
    name: 'Kusarigama',
    build: (metal, wrap, accent) => {
      const g = new Group();
      const blade = part(BLADE.kama, metal, g);
      blade.rotation.z = -1.42;
      blade.position.set(0.05, 0.03, 0);
      buildGrip(g, wrap, accent, 0.22);
      const chain = new Group();
      chain.position.y = -0.24;
      g.add(chain);
      for (let i = 0; i < 7; i++) {
        const link = part(GEO.chainLink, metal, chain);
        link.position.y = -i * 0.055;
        link.rotation.y = (i % 2) * Math.PI * 0.5;
        link.rotation.x = Math.PI * 0.5;
      }
      const weight = part(GEO.weight, accent, chain);
      weight.position.y = -0.4;
      return g;
    },
    grip: 'oneHand',
    hold: { position: [0, -0.18, 0.04], rotation: [0.2, 0, 0.34] },
    reach: 0.95,
    attacks: ['spinCut', 'sweep'],
    debris: 'compact',
    heft: 0.55,
  },
  {
    id: 'naginata',
    name: 'Naginata',
    build: polearm(BLADE.naginata, 1.15, true),
    grip: 'twoHand',
    hold: { position: [0, -0.1, 0.05], rotation: [0.34, 0, 0.16] },
    reach: 1.35,
    attacks: ['sweep', 'lunge', 'spinCut'],
    debris: 'pole',
    heft: 0.8,
  },
  {
    id: 'bo',
    name: 'Bo staff',
    build: polearm(null, 1.5, true),
    grip: 'twoHand',
    hold: { position: [0, -0.02, 0.05], rotation: [0.4, 0, 0.1] },
    reach: 1.3,
    attacks: ['sweep', 'spinCut', 'doubleSlash'],
    debris: 'pole',
    heft: 0.62,
  },
  {
    id: 'tessen',
    name: 'War fan',
    build: (metal, wrap, accent) => {
      const g = new Group();
      for (let i = 0; i < 7; i++) {
        const rib = part(GEO.fanRib, i % 2 === 0 ? metal : accent, g);
        const angle = (i / 6 - 0.5) * 1.15;
        rib.rotation.z = angle;
        rib.position.set(Math.sin(angle) * 0.2, Math.cos(angle) * 0.2 + 0.02, 0);
      }
      const pivot = part(GEO.pommel, accent, g);
      pivot.scale.setScalar(0.8);
      buildGrip(g, wrap, accent, 0.1);
      return g;
    },
    grip: 'oneHand',
    hold: { position: [0, -0.14, 0.05], rotation: [0.1, 0, 0.5] },
    reach: 0.78,
    attacks: ['chop', 'sideCut'],
    debris: 'compact',
    heft: 0.3,
  },
  {
    id: 'tonfa',
    name: 'Tonfa',
    build: (metal, wrap, accent) => {
      const g = new Group();
      const shaft = part(GEO.pole, wrap, g);
      shaft.scale.set(0.85, 0.62, 0.85);
      shaft.position.y = 0.06;
      const handle = part(GEO.gripCore, accent, g);
      handle.rotation.z = Math.PI * 0.5;
      handle.position.set(0.1, -0.16, 0);
      handle.scale.set(0.9, 0.62, 0.9);
      const cap = part(GEO.collar, metal, g);
      cap.position.y = 0.37;
      cap.scale.setScalar(0.82);
      return g;
    },
    grip: 'oneHand',
    hold: { position: [0, -0.16, 0.06], rotation: [0.16, 0, 0.22] },
    reach: 0.74,
    attacks: ['doubleSlash', 'sweep'],
    debris: 'compact',
    heft: 0.34,
  },
];

const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

/**
 * Where streamed weapon models come from.
 *
 * Set once by the game after the armoury finishes loading. Kept as an injected
 * supplier rather than an import so this module stays free of asset plumbing
 * and can be tested without a loader.
 */
let modelSupplier: ((id: string) => Group | null) | null = null;

export function setWeaponModelSupplier(supplier: (id: string) => Group | null): void {
  modelSupplier = supplier;
}

/** A fresh instance of a streamed weapon model, or null if it has not landed. */
export function weaponModel(id: WeaponId): Group | null {
  return modelSupplier ? modelSupplier(id) : null;
}

export function weaponById(id: WeaponId): WeaponDef {
  return BY_ID.get(id) ?? WEAPONS[0];
}

/** Weapons that suit a given enemy attack, for picking a matching move. */
export function weaponsForAttack(attack: string): readonly WeaponDef[] {
  return WEAPONS.filter((w) => w.attacks.includes(attack));
}

/**
 * Builds a weapon with materials mixed for one clan.
 *
 * Materials are passed in rather than created here so a weapon inherits the
 * palette of whoever carries it — the same katana looks like navy-and-gold
 * clan steel in one hand and plum-and-violet in another.
 */
export function buildWeapon(
  id: WeaponId,
  colors: { metal: number; wrap: number; accent: number; glow?: number },
): Group {
  const def = weaponById(id);
  const metal = new MeshStandardMaterial({
    color: colors.metal,
    metalness: 0.78,
    roughness: 0.24,
    emissive: colors.glow ?? 0x000000,
    emissiveIntensity: colors.glow ? 0.7 : 0,
  });
  const wrap = new MeshStandardMaterial({ color: colors.wrap, metalness: 0.05, roughness: 0.92 });
  const accent = new MeshStandardMaterial({ color: colors.accent, metalness: 0.6, roughness: 0.35 });
  const group = def.build(metal, wrap, accent);
  group.position.set(def.hold.position[0], def.hold.position[1], def.hold.position[2]);
  group.rotation.set(def.hold.rotation[0], def.hold.rotation[1], def.hold.rotation[2]);
  return group;
}

/** Cone used for a spear-like debris silhouette, shared by pole weapons. */
export const DEBRIS_SHAPES = {
  blade: new BoxGeometry(0.06, 0.8, 0.12),
  pole: new CylinderGeometry(0.03, 0.03, 1.1, 7),
  compact: new ConeGeometry(0.07, 0.3, 6),
} as const;
