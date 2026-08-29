import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
} from 'three';
import type { BoneKey } from './Rig';

/**
 * The wardrobe catalogue.
 *
 * Cosmetics are placeholder art in the honest sense: every piece is built here
 * out of the same shape vocabulary the weapons use — lacquered cloth, a metal
 * fitting, a wooden core — so the whole set reads as one clan's kit rather than
 * as a pile of borrowed props. They can be replaced with authored models one at
 * a time later without touching the mounting, the UI or the save format.
 *
 * Two rules keep this file safe to edit:
 *   1. Nothing here touches gameplay. A hat cannot change a hitbox, a reach or
 *      a timing, so a player who likes a look never pays for it.
 *   2. Nothing here draws from the seeded RNG, for the same reason the physics
 *      kernel does not: a cosmetic must never reshuffle a run.
 */

export const COSMETIC_SLOTS = ['outfit', 'head', 'back', 'feet'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export const SLOT_LABEL: Record<CosmeticSlot, string> = {
  outfit: 'OUTFIT',
  head: 'HEAD',
  back: 'BACK',
  feet: 'FEET',
};

/** One equipped item per slot. */
export type Loadout = Record<CosmeticSlot, string>;

/**
 * The clan colours an outfit hands to everything else being worn, so a hat and
 * a pair of boots picked separately still look like they came from one set.
 */
export interface Palette {
  cloth: number;
  trim: number;
  metal: number;
  accent: number;
  wood: number;
}

/**
 * How a piece is sized and placed against the body part it hangs on.
 *
 * Nothing here is in metres, and that is the point. These ninjas are chibi —
 * a head is nearly half a body — so a hat authored to fit a human skull
 * disappears inside one of them, and the next character has different
 * proportions again. The wardrobe measures the actual limb from the skinning
 * data and fits the piece to what it finds, so one entry in this table works on
 * every character, including ones that do not exist yet.
 */
export interface CosmeticFit {
  /** Item width as a multiple of the measured limb's width. */
  readonly width: number;
  /** Where the item's own box sits against the limb's box. */
  readonly place: 'top' | 'center' | 'back';
  /** Nudge after placement, in multiples of the limb's width. */
  readonly nudge?: readonly [number, number, number];
}

export interface CosmeticAnchor {
  readonly bone: BoneKey;
  /** Bones to try when the primary is missing from a rig. */
  readonly alt?: readonly BoneKey[];
  /** Fallback placement in metres, used when a rig carries no skin weights. */
  readonly offset: readonly [number, number, number];
  readonly fit?: CosmeticFit;
  readonly rotation?: readonly [number, number, number];
  /** -1 on the left-hand copy of a mirrored pair, so builders can flip detail. */
  readonly mirror?: number;
  /** How much this piece trails the body's acceleration. 0 is rigid. */
  readonly sway?: number;
}

export interface CosmeticItem {
  readonly id: string;
  readonly slot: CosmeticSlot;
  readonly name: string;
  readonly blurb: string;
  /** Two colours the UI card is drawn from, so the grid needs no renders. */
  readonly swatch: readonly [string, string];
  readonly anchors: readonly CosmeticAnchor[];
  /** Outfit slot only: the clan colours, and a tint laid over the body. */
  readonly palette?: Palette;
  readonly tint?: number;
  readonly build?: (palette: Palette, anchor: CosmeticAnchor) => Object3D;
}

// ------------------------------------------------------------ shared shapes

const GEO = {
  brim: new ConeGeometry(0.33, 0.15, 16, 1, true),
  crown: new SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  band: new TorusGeometry(0.148, 0.022, 6, 16),
  ribbon: new BoxGeometry(0.05, 0.24, 0.012),
  ear: new ConeGeometry(0.058, 0.155, 5),
  horn: new ConeGeometry(0.034, 0.19, 6),
  crest: new BoxGeometry(0.026, 0.16, 0.05),
  neckPlate: new BoxGeometry(0.26, 0.055, 0.022),
  hoodShell: new SphereGeometry(0.185, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.62),
  hoodCollar: new CylinderGeometry(0.15, 0.19, 0.11, 12, 1, true),
  cape: new BoxGeometry(0.44, 0.66, 0.016),
  capeTatter: new BoxGeometry(0.1, 0.16, 0.014),
  saya: new CylinderGeometry(0.03, 0.024, 0.74, 7),
  sayaMouth: new CylinderGeometry(0.034, 0.034, 0.05, 7),
  pole: new CylinderGeometry(0.013, 0.013, 0.66, 6),
  flag: new BoxGeometry(0.24, 0.38, 0.01),
  scrollCase: new CylinderGeometry(0.052, 0.052, 0.34, 10),
  scrollCap: new CylinderGeometry(0.058, 0.058, 0.03, 10),
  strap: new BoxGeometry(0.055, 0.02, 0.3),
  sole: new BoxGeometry(0.125, 0.032, 0.27),
  boot: new BoxGeometry(0.13, 0.13, 0.22),
  toeSplit: new BoxGeometry(0.05, 0.055, 0.07),
  tooth: new BoxGeometry(0.105, 0.075, 0.032),
  thong: new CylinderGeometry(0.008, 0.008, 0.13, 5),
  shin: new BoxGeometry(0.125, 0.19, 0.085),
  knee: new SphereGeometry(0.072, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
  wrapBand: new TorusGeometry(0.063, 0.017, 5, 10),
  sash: new BoxGeometry(0.31, 0.1, 0.24),
  sashKnot: new BoxGeometry(0.09, 0.09, 0.09),
  sashTail: new BoxGeometry(0.085, 0.32, 0.014),
  shoulderPad: new SphereGeometry(0.105, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
  collarBoss: new CylinderGeometry(0.05, 0.05, 0.03, 8),
} as const;

/** A gourd profile — the one shape here worth lathing rather than boxing. */
const GOURD: BufferGeometry = new LatheGeometry(
  [0.0, 0.06, 0.085, 0.055, 0.075, 0.03, 0.022].map(
    (r, i, all) => new Vector2(Math.max(0.004, r), (i / (all.length - 1)) * 0.26),
  ),
  9,
);

function standard(color: number, roughness = 0.72, metalness = 0.05): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function piece(
  geo: BufferGeometry,
  material: MeshStandardMaterial,
  parent: Object3D,
  pos: readonly [number, number, number],
  rot: readonly [number, number, number] = [0, 0, 0],
  scale: readonly [number, number, number] | number = 1,
): Mesh {
  const m = new Mesh(geo, material);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  if (typeof scale === 'number') m.scale.setScalar(scale);
  else m.scale.set(scale[0], scale[1], scale[2]);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

// ------------------------------------------------------------------ palettes

const PALETTES: Record<string, Palette> = {
  ash: { cloth: 0x2b2f3d, trim: 0x4c5468, metal: 0x9aa4b8, accent: 0x8d95a8, wood: 0x6b533a },
  ember: { cloth: 0x7d1f22, trim: 0xc4552c, metal: 0xd9a441, accent: 0xff8a4c, wood: 0x5a3a24 },
  jade: { cloth: 0x1d4f3c, trim: 0x2f8b62, metal: 0xbfae7a, accent: 0x4fd9a8, wood: 0x4a4028 },
  indigo: { cloth: 0x232a5c, trim: 0x3d4a9e, metal: 0xa8b6d9, accent: 0x6f8cff, wood: 0x3a3350 },
  bone: { cloth: 0xd9d3c4, trim: 0x9c948a, metal: 0xb9bec7, accent: 0xe8dcc0, wood: 0x8a7b63 },
  void: { cloth: 0x1a1424, trim: 0x3a2b57, metal: 0x8b7bc4, accent: 0xb47cff, wood: 0x2e2438 },
};

// -------------------------------------------------------------------- outfits

/** The sash every non-default outfit ties on, so a colour is never only a tint. */
function sash(palette: Palette): Object3D {
  const g = new Group();
  const cloth = standard(palette.trim, 0.86);
  const knot = standard(palette.accent, 0.8);
  piece(GEO.sash, cloth, g, [0, 0, 0]);
  piece(GEO.sashKnot, knot, g, [0.1, -0.01, 0.12], [0, 0.4, 0.2]);
  piece(GEO.sashTail, cloth, g, [0.11, -0.19, 0.13], [0.1, 0.35, 0.05]);
  piece(GEO.sashTail, cloth, g, [0.06, -0.15, 0.14], [0.12, 0.2, -0.1], [0.7, 0.8, 1]);
  return g;
}

function shoulderWrap(palette: Palette, anchor: CosmeticAnchor): Object3D {
  const g = new Group();
  const pad = standard(palette.cloth, 0.82);
  const trim = standard(palette.accent, 0.7);
  const mirror = anchor.mirror ?? 1;
  piece(GEO.shoulderPad, pad, g, [0, 0, 0], [0.18, 0, mirror * -0.22]);
  piece(GEO.wrapBand, trim, g, [0, -0.035, 0], [Math.PI * 0.5, 0, 0], [1.5, 1.5, 1]);
  return g;
}

function outfit(
  id: string,
  name: string,
  blurb: string,
  key: keyof typeof PALETTES,
  swatch: readonly [string, string],
  tint?: number,
): CosmeticItem {
  const palette = PALETTES[key];
  const dressed = id !== 'fit-ash';
  return {
    id,
    slot: 'outfit',
    name,
    blurb,
    swatch,
    palette,
    tint,
    anchors: dressed
      ? [
          {
            bone: 'hips',
            offset: [0, 0.02, 0],
            fit: { width: 1.06, place: 'center', nudge: [0, 0.06, 0] },
            sway: 0.25,
          },
          {
            bone: 'shoulderR',
            alt: ['armR'],
            offset: [0, 0, 0],
            fit: { width: 1.05, place: 'center', nudge: [0.08, 0.1, 0] },
            mirror: 1,
          },
          {
            bone: 'shoulderL',
            alt: ['armL'],
            offset: [0, 0, 0],
            fit: { width: 1.05, place: 'center', nudge: [-0.08, 0.1, 0] },
            mirror: -1,
          },
        ]
      : [],
    build: (p, anchor) => (anchor.bone === 'hips' ? sash(p) : shoulderWrap(p, anchor)),
  };
}

// ----------------------------------------------------------------- headwear

const HEAD_ANCHOR: CosmeticAnchor = {
  bone: 'head',
  offset: [0, 0.17, 0],
  fit: { width: 1.6, place: 'top', nudge: [0, -0.06, 0] },
};

const headFit = (width: number, sink: number, sway?: number): CosmeticAnchor => ({
  ...HEAD_ANCHOR,
  fit: { width, place: 'top', nudge: [0, -sink, 0] },
  ...(sway === undefined ? {} : { sway }),
});

/** For pieces that enclose the head — a hood — rather than sitting on it. */
const headWrap = (width: number, lift: number): CosmeticAnchor => ({
  ...HEAD_ANCHOR,
  fit: { width, place: 'center', nudge: [0, lift, 0] },
});

function kasa(palette: Palette): Object3D {
  const g = new Group();
  const straw = standard(0xc9a55e, 0.94);
  const cord = standard(palette.accent, 0.8);
  piece(GEO.brim, straw, g, [0, 0.02, 0], [0, 0, 0]);
  piece(GEO.crown, straw, g, [0, 0.03, 0], [0, 0, 0], [0.72, 0.5, 0.72]);
  piece(GEO.band, cord, g, [0, -0.03, 0], [Math.PI * 0.5, 0, 0], [0.95, 0.95, 0.7]);
  return g;
}

function kabuto(palette: Palette): Object3D {
  const g = new Group();
  const iron = standard(palette.metal, 0.42, 0.65);
  const gold = standard(palette.accent, 0.38, 0.7);
  const cloth = standard(palette.cloth, 0.85);
  piece(GEO.crown, iron, g, [0, -0.02, 0], [0, 0, 0], [1.06, 0.95, 1.06]);
  // Maedate: a pair of blades rising off the brow in a V, the way a real
  // kabuto wears its crest — three stacked at one point read as a plus sign.
  piece(GEO.crest, gold, g, [0.045, 0.07, 0.115], [-0.32, 0, 0.42]);
  piece(GEO.crest, gold, g, [-0.045, 0.07, 0.115], [-0.32, 0, -0.42]);
  piece(GEO.collarBoss, gold, g, [0, 0.02, 0.14], [Math.PI * 0.5, 0, 0], [0.5, 0.5, 0.5]);
  for (let i = 0; i < 3; i++) {
    piece(GEO.neckPlate, cloth, g, [0, -0.06 - i * 0.045, -0.09 - i * 0.028], [0.42, 0, 0]);
  }
  return g;
}

function hachimaki(palette: Palette): Object3D {
  const g = new Group();
  const cloth = standard(palette.accent, 0.88);
  const knot = standard(palette.trim, 0.85);
  piece(GEO.band, cloth, g, [0, -0.08, 0], [Math.PI * 0.5, 0, 0], [0.98, 0.98, 1.1]);
  piece(GEO.sashKnot, knot, g, [0, -0.08, -0.14], [0, 0, 0.4], 0.55);
  return g;
}

function spiritEars(palette: Palette): Object3D {
  const g = new Group();
  const fur = standard(palette.cloth, 0.9);
  const inner = standard(palette.accent, 0.85);
  for (const x of [-0.095, 0.095]) {
    piece(GEO.ear, fur, g, [x, 0.03, -0.01], [0, 0, x > 0 ? -0.2 : 0.2]);
    piece(GEO.ear, inner, g, [x, 0.03, 0.012], [0, 0, x > 0 ? -0.2 : 0.2], [0.6, 0.75, 0.6]);
  }
  return g;
}

function shadowHood(palette: Palette): Object3D {
  const g = new Group();
  const cloth = standard(palette.cloth, 0.93);
  const trim = standard(palette.trim, 0.88);
  piece(GEO.hoodShell, cloth, g, [0, -0.05, -0.02], [-0.12, 0, 0], [1, 1.05, 1.08]);
  piece(GEO.hoodCollar, trim, g, [0, -0.15, -0.02], [0.08, 0, 0]);
  piece(GEO.capeTatter, cloth, g, [0, -0.12, -0.19], [0.35, 0, 0], [1.4, 1.1, 1]);
  return g;
}

function oniHorns(palette: Palette): Object3D {
  const g = new Group();
  const bone = standard(0xe6dcc8, 0.7);
  const wrap = standard(palette.accent, 0.8);
  for (const x of [-0.085, 0.085]) {
    piece(GEO.horn, bone, g, [x, 0.06, -0.01], [-0.25, 0, x > 0 ? -0.35 : 0.35]);
    piece(GEO.wrapBand, wrap, g, [x, 0.0, -0.005], [Math.PI * 0.5, 0, 0], [0.5, 0.5, 0.4]);
  }
  return g;
}

// --------------------------------------------------------------- back pieces

const BACK_ANCHOR: CosmeticAnchor = {
  bone: 'upperChest',
  alt: ['chest', 'spine'],
  offset: [0, 0.04, -0.1],
  fit: { width: 1.05, place: 'back', nudge: [0, 0.12, -0.04] },
  sway: 1,
};

const backFit = (sway: number, width = 1.05): CosmeticAnchor => ({
  ...BACK_ANCHOR,
  fit: { width, place: 'back', nudge: [0, 0.12, -0.04] },
  sway,
});

function cape(palette: Palette): Object3D {
  const g = new Group();
  const cloth = standard(palette.cloth, 0.94);
  const trim = standard(palette.trim, 0.9);
  piece(GEO.cape, cloth, g, [0, -0.3, -0.02], [0.06, 0, 0]);
  piece(GEO.strap, trim, g, [0, 0.02, 0.02], [0, 0, 0], [1.4, 1, 0.5]);
  // Torn hem: three tabs of different lengths read as cloth, a straight edge
  // reads as a board.
  piece(GEO.capeTatter, cloth, g, [-0.13, -0.66, -0.02], [0.06, 0, 0.06]);
  piece(GEO.capeTatter, cloth, g, [0.02, -0.7, -0.02], [0.06, 0, -0.03], [1, 1.3, 1]);
  piece(GEO.capeTatter, cloth, g, [0.16, -0.64, -0.02], [0.06, 0, -0.08], [0.9, 0.8, 1]);
  return g;
}

function twinSaya(palette: Palette): Object3D {
  const g = new Group();
  const lacquer = standard(palette.cloth, 0.32, 0.2);
  const fitting = standard(palette.metal, 0.4, 0.6);
  const cord = standard(palette.accent, 0.85);
  for (const tilt of [0.42, -0.42]) {
    const arm = new Group();
    arm.rotation.set(0.25, 0, tilt);
    g.add(arm);
    piece(GEO.saya, lacquer, arm, [0, -0.16, -0.02]);
    piece(GEO.sayaMouth, fitting, arm, [0, 0.2, -0.02]);
    piece(GEO.sayaMouth, fitting, arm, [0, -0.52, -0.02], [0, 0, 0], [0.85, 0.6, 0.85]);
  }
  piece(GEO.strap, cord, g, [0, 0.0, 0.01], [0, 0, 0.5], [1.6, 1, 0.5]);
  return g;
}

function sashimono(palette: Palette): Object3D {
  const g = new Group();
  const wood = standard(palette.wood, 0.9);
  const flag = standard(palette.accent, 0.9);
  const mark = standard(palette.cloth, 0.85);
  piece(GEO.pole, wood, g, [0, 0.05, -0.04]);
  piece(GEO.flag, flag, g, [0.13, 0.12, -0.05]);
  piece(GEO.sashKnot, mark, g, [0.13, 0.16, -0.045], [0, 0, 0.78], 0.5);
  piece(GEO.strap, wood, g, [0, -0.24, 0.0], [0, 0, 0.5], [1.3, 1, 0.6]);
  return g;
}

function scrollCase(palette: Palette): Object3D {
  const g = new Group();
  const case_ = standard(palette.wood, 0.8);
  const cap = standard(palette.metal, 0.45, 0.55);
  const strap = standard(palette.trim, 0.9);
  piece(GEO.scrollCase, case_, g, [0, -0.18, -0.03], [0, 0, Math.PI * 0.5]);
  piece(GEO.scrollCap, cap, g, [0.17, -0.18, -0.03], [0, 0, Math.PI * 0.5]);
  piece(GEO.scrollCap, cap, g, [-0.17, -0.18, -0.03], [0, 0, Math.PI * 0.5]);
  piece(GEO.strap, strap, g, [0, -0.05, 0.0], [0, 0, 0.35], [1.2, 1, 0.6]);
  return g;
}

function gourd(palette: Palette): Object3D {
  const g = new Group();
  const shell = standard(0xb4874a, 0.85);
  const cord = standard(palette.accent, 0.9);
  const stopper = standard(palette.wood, 0.8);
  piece(GOURD, shell, g, [0.08, -0.32, -0.02], [0, 0, 0.2], 1.05);
  piece(GEO.sashKnot, stopper, g, [0.13, -0.06, -0.02], [0, 0, 0.2], 0.32);
  piece(GEO.strap, cord, g, [0, -0.02, 0.0], [0, 0, -0.4], [1.3, 1, 0.5]);
  return g;
}

// ------------------------------------------------------------------ footwear

function footAnchors(
  offset: readonly [number, number, number],
  fit: CosmeticFit,
): CosmeticAnchor[] {
  return [
    { bone: 'footR', offset, fit, mirror: 1 },
    { bone: 'footL', offset, fit, mirror: -1 },
  ];
}

function tabi(palette: Palette): Object3D {
  const g = new Group();
  const cloth = standard(palette.cloth, 0.9);
  const sole = standard(0x2a2622, 0.95);
  const tie = standard(palette.accent, 0.85);
  piece(GEO.boot, cloth, g, [0, 0.0, 0.03], [0, 0, 0], [1, 0.85, 1]);
  piece(GEO.toeSplit, cloth, g, [0, -0.03, 0.14], [0.1, 0, 0]);
  piece(GEO.sole, sole, g, [0, -0.07, 0.03]);
  piece(GEO.wrapBand, tie, g, [0, 0.07, 0.0], [Math.PI * 0.5, 0, 0], [1.15, 1.15, 0.8]);
  return g;
}

function geta(palette: Palette): Object3D {
  const g = new Group();
  const wood = standard(palette.wood, 0.88);
  const strap = standard(palette.accent, 0.85);
  piece(GEO.sole, wood, g, [0, -0.06, 0.03], [0, 0, 0], [1.05, 1.1, 1.02]);
  piece(GEO.tooth, wood, g, [0, -0.11, 0.12]);
  piece(GEO.tooth, wood, g, [0, -0.11, -0.05]);
  piece(GEO.thong, strap, g, [0, -0.01, 0.08], [0.5, 0, 0]);
  piece(GEO.thong, strap, g, [0.035, -0.005, 0.03], [0.4, 0.6, 0]);
  piece(GEO.thong, strap, g, [-0.035, -0.005, 0.03], [0.4, -0.6, 0]);
  return g;
}

function greaves(palette: Palette): Object3D {
  const g = new Group();
  const iron = standard(palette.metal, 0.4, 0.62);
  const cloth = standard(palette.trim, 0.9);
  piece(GEO.shin, iron, g, [0, -0.02, 0.015], [0.05, 0, 0]);
  piece(GEO.knee, iron, g, [0, 0.09, 0.01], [-0.2, 0, 0], [0.95, 0.8, 0.95]);
  piece(GEO.wrapBand, cloth, g, [0, -0.11, 0.0], [Math.PI * 0.5, 0, 0], [1.1, 1.1, 0.8]);
  return g;
}

function clothWraps(palette: Palette): Object3D {
  const g = new Group();
  const cloth = standard(palette.cloth, 0.94);
  const trim = standard(palette.accent, 0.9);
  for (let i = 0; i < 4; i++) {
    const m = i === 3 ? trim : cloth;
    piece(GEO.wrapBand, m, g, [0, 0.02 - i * 0.045, 0.0], [Math.PI * 0.5, 0, i * 0.3], [1.05, 1.05, 0.9]);
  }
  piece(GEO.sole, standard(0x2a2622, 0.95), g, [0, -0.16, 0.03], [0, 0, 0], [0.92, 0.7, 0.95]);
  return g;
}

const GREAVE_FIT: CosmeticFit = { width: 1.25, place: 'center', nudge: [0, -0.1, 0.05] };

// ------------------------------------------------------------------- catalog

export const COSMETICS: readonly CosmeticItem[] = [
  outfit('fit-ash', 'ASH', 'The kit you trained in.', 'ash', ['#2b2f3d', '#4c5468']),
  outfit('fit-ember', 'EMBER', 'Forge-red, cut with brass.', 'ember', ['#7d1f22', '#ff8a4c'], 0xffb9a0),
  outfit('fit-jade', 'JADE', 'Temple green and old ivory.', 'jade', ['#1d4f3c', '#4fd9a8'], 0xa8e8cf),
  outfit('fit-indigo', 'INDIGO', 'Night dye, moon fittings.', 'indigo', ['#232a5c', '#6f8cff'], 0xa9b6f0),
  outfit('fit-bone', 'BONE', 'Bleached cloth, mourning colours.', 'bone', ['#d9d3c4', '#9c948a'], 0xf0ece0),
  outfit('fit-void', 'VOID', 'Whatever the lantern light misses.', 'void', ['#1a1424', '#b47cff'], 0x9c86c8),

  { id: 'head-none', slot: 'head', name: 'BARE', blurb: 'Nothing to knock off.', swatch: ['#20242f', '#333a4a'], anchors: [] },
  { id: 'head-kasa', slot: 'head', name: 'STRAW KASA', blurb: 'Wide brim. Hides the eyes.', swatch: ['#c9a55e', '#8d6b32'], anchors: [headFit(2.1, 0.3)], build: kasa },
  { id: 'head-kabuto', slot: 'head', name: 'IRON KABUTO', blurb: 'Crested helm with a neck guard.', swatch: ['#9aa4b8', '#d9a441'], anchors: [headFit(1.2, 0.86)], build: kabuto },
  { id: 'head-band', slot: 'head', name: 'HACHIMAKI', blurb: 'Tied before every run.', swatch: ['#c4552c', '#7d1f22'], anchors: [headFit(1.16, 0.82, 0.4)], build: hachimaki },
  { id: 'head-ears', slot: 'head', name: 'SPIRIT EARS', blurb: 'Borrowed from something older.', swatch: ['#4c5468', '#ff9ddb'], anchors: [headFit(0.9, 0.06)], build: spiritEars },
  { id: 'head-hood', slot: 'head', name: 'SHADOW HOOD', blurb: 'For work after dark.', swatch: ['#1a1424', '#3a2b57'], anchors: [headWrap(1.28, 0.14)], build: shadowHood },
  { id: 'head-horns', slot: 'head', name: 'ONI HORNS', blurb: 'Play the demon, be the demon.', swatch: ['#e6dcc8', '#b47cff'], anchors: [headFit(1.05, 0.1)], build: oniHorns },

  { id: 'back-none', slot: 'back', name: 'CLEAR', blurb: 'Nothing on the back.', swatch: ['#20242f', '#333a4a'], anchors: [] },
  { id: 'back-cape', slot: 'back', name: 'TATTERED CAPE', blurb: 'Shorter than it started.', swatch: ['#2b2f3d', '#4fd9a8'], anchors: [backFit(1, 1.15)], build: cape },
  { id: 'back-saya', slot: 'back', name: 'TWIN SAYA', blurb: 'Two scabbards, crossed.', swatch: ['#232a5c', '#a8b6d9'], anchors: [backFit(0.35, 1.05)], build: twinSaya },
  { id: 'back-banner', slot: 'back', name: 'SASHIMONO', blurb: 'Your mark, flown high.', swatch: ['#7d1f22', '#d9a441'], anchors: [backFit(0.55, 0.7)], build: sashimono },
  { id: 'back-scroll', slot: 'back', name: 'SCROLL CASE', blurb: 'Orders you never read.', swatch: ['#6b533a', '#b9bec7'], anchors: [backFit(0.3, 0.85)], build: scrollCase },
  { id: 'back-gourd', slot: 'back', name: 'SAKE GOURD', blurb: 'Purely for the walk home.', swatch: ['#b4874a', '#4fd9a8'], anchors: [backFit(0.6, 0.6)], build: gourd },

  { id: 'feet-none', slot: 'feet', name: 'BAREFOOT', blurb: 'Quietest thing you own.', swatch: ['#20242f', '#333a4a'], anchors: [] },
  { id: 'feet-tabi', slot: 'feet', name: 'TABI BOOTS', blurb: 'Split toe, soft sole.', swatch: ['#2b2f3d', '#8d95a8'], anchors: footAnchors([0, -0.02, 0.03], { width: 1.12, place: 'center', nudge: [0, -0.05, 0.06] }), build: tabi },
  { id: 'feet-geta', slot: 'feet', name: 'GETA', blurb: 'Loud. Worth it.', swatch: ['#6b533a', '#c4552c'], anchors: footAnchors([0, -0.03, 0.03], { width: 1.15, place: 'center', nudge: [0, -0.3, 0.04] }), build: geta },
  { id: 'feet-greaves', slot: 'feet', name: 'IRON GREAVES', blurb: 'Shin plates over the boot.', swatch: ['#9aa4b8', '#4c5468'], anchors: [
      { bone: 'legR', alt: ['footR'], offset: [0, -0.1, 0.01], fit: GREAVE_FIT, mirror: 1 },
      { bone: 'legL', alt: ['footL'], offset: [0, -0.1, 0.01], fit: GREAVE_FIT, mirror: -1 },
    ], build: greaves },
  { id: 'feet-wraps', slot: 'feet', name: 'CLOTH WRAPS', blurb: 'Ankle bindings, nothing else.', swatch: ['#d9d3c4', '#9c948a'], anchors: footAnchors([0, 0.04, 0.01], { width: 1.05, place: 'center', nudge: [0, 0.12, 0] }), build: clothWraps },
];

const BY_ID = new Map(COSMETICS.map((c) => [c.id, c] as const));

export const DEFAULT_ITEM: Record<CosmeticSlot, string> = {
  outfit: 'fit-ash',
  head: 'head-none',
  back: 'back-none',
  feet: 'feet-none',
};

export function itemsForSlot(slot: CosmeticSlot): CosmeticItem[] {
  return COSMETICS.filter((c) => c.slot === slot);
}

export function itemById(id: string): CosmeticItem | null {
  return BY_ID.get(id) ?? null;
}

export function defaultLoadout(): Loadout {
  return { ...DEFAULT_ITEM };
}

/**
 * Turns anything at all — old saves, hand-edited storage, a slot that no longer
 * exists — into a loadout the wardrobe can wear. A cosmetic must never be able
 * to stop a player getting into a run.
 */
export function sanitizeLoadout(input: unknown): Loadout {
  const out = defaultLoadout();
  if (!input || typeof input !== 'object') return out;
  const raw = input as Record<string, unknown>;
  for (const slot of COSMETIC_SLOTS) {
    const id = raw[slot];
    if (typeof id !== 'string') continue;
    const item = BY_ID.get(id);
    if (item && item.slot === slot) out[slot] = id;
  }
  return out;
}

/** The clan colours the rest of the loadout is built from. */
export function paletteFor(loadout: Loadout): Palette {
  return itemById(loadout.outfit)?.palette ?? PALETTES.ash;
}

export function tintFor(loadout: Loadout): number | null {
  return itemById(loadout.outfit)?.tint ?? null;
}
