export interface Skin {
  id: string;
  name: string;
  /** One line of flavour, shown in the locker. */
  blurb: string;
  price: number;
  /** Chassis colour. */
  body: number;
  /** Accent and visor. Kept warm for Ignis, cool for Volta, so the pair stays
   *  tellable apart whatever they are wearing. */
  p1: number;
  p2: number;
  metalness: number;
  roughness: number;
  /** How hard the accents burn. Above 1 they bloom against the dark tunnel. */
  glow: number;
  /** Optional halo shell around the chassis — the loud ones have it. */
  rim?: boolean;
}

export const SKINS: Skin[] = [
  {
    id: "conduit", name: "CONDUIT", blurb: "standard issue maintenance units",
    price: 0, body: 0x46536b, p1: 0xff8a3d, p2: 0x35e0ff,
    metalness: 0.35, roughness: 0.5, glow: 0.45,
  },
  {
    id: "ember", name: "EMBER", blurb: "cooling metal, still warm to touch",
    price: 60, body: 0x3a2430, p1: 0xff5a3c, p2: 0xffc23d,
    metalness: 0.55, roughness: 0.4, glow: 0.9,
  },
  {
    id: "chrome", name: "CHROME", blurb: "mirror-polished, nothing to hide",
    price: 140, body: 0xd7dee8, p1: 0xff7043, p2: 0x2f9fb8,
    metalness: 1, roughness: 0.08, glow: 0.5,
  },
  {
    id: "orchid", name: "ORCHID", blurb: "grown in the dark, blooms anyway",
    price: 220, body: 0x39294f, p1: 0xff6ad5, p2: 0x9d7bff,
    metalness: 0.5, roughness: 0.35, glow: 1.4, rim: true,
  },
  {
    id: "magma", name: "MAGMA", blurb: "the core never finished cooling",
    price: 340, body: 0x2a0f0c, p1: 0xff3b12, p2: 0xffb020,
    metalness: 0.7, roughness: 0.25, glow: 2.2, rim: true,
  },
  {
    id: "spectre", name: "SPECTRE", blurb: "the conduit reports two empty suits",
    price: 480, body: 0x0d1017, p1: 0x8affe0, p2: 0x7fb0ff,
    metalness: 0.2, roughness: 0.9, glow: 2.6, rim: true,
  },
  {
    id: "circuit", name: "CIRCUIT", blurb: "wired straight into the grid",
    price: 620, body: 0x0a2f2a, p1: 0x39ff88, p2: 0x00e5ff,
    metalness: 0.85, roughness: 0.15, glow: 2.4, rim: true,
  },
  {
    id: "bullion", name: "BULLION", blurb: "worth more than the tunnel",
    price: 900, body: 0x7a5a12, p1: 0xffd75e, p2: 0xfff6cf,
    metalness: 1, roughness: 0.12, glow: 1.8, rim: true,
  },
];

export const skinById = (id: string): Skin => SKINS.find((s) => s.id === id) ?? SKINS[0];

export interface Trail {
  id: string;
  name: string;
  blurb: string;
  price: number;
  /** Ribbon colour. `null` means the robot's own accent colour. */
  color: number | null;
  life: number;
  rate: number;
  /** Drift against the surface normal, units per second. */
  rise: number;
  size: number;
}

export const TRAILS: Trail[] = [
  { id: "none", name: "NONE", blurb: "travel light", price: 0, color: null, life: 0, rate: 0, rise: 0, size: 0 },
  { id: "spark", name: "SPARK", blurb: "loose contact somewhere", price: 80, color: null, life: 0.36, rate: 34, rise: 1.1, size: 0.055 },
  { id: "flame", name: "FLAME", blurb: "leaves the floor smoking", price: 150, color: 0xff6a1a, life: 0.5, rate: 46, rise: 2.4, size: 0.085 },
  { id: "frost", name: "FROST", blurb: "a cold wake down the conduit", price: 150, color: 0x8ce6ff, life: 0.62, rate: 30, rise: 0.5, size: 0.07 },
  { id: "toxin", name: "TOXIN", blurb: "do not follow too closely", price: 260, color: 0x9dff3d, life: 0.7, rate: 38, rise: 1.6, size: 0.075 },
  { id: "void", name: "RIFT", blurb: "the dark closes in behind", price: 400, color: 0xb46bff, life: 0.85, rate: 44, rise: -0.8, size: 0.095 },
  { id: "gold", name: "COMET", blurb: "a bright line through the dark", price: 650, color: 0xffd75e, life: 0.9, rate: 54, rise: 0.9, size: 0.105 },
];

export const trailById = (id: string): Trail => TRAILS.find((t) => t.id === id) ?? TRAILS[0];
