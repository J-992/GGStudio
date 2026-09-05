export interface Skin {
  id: string;
  name: string;
  /** Coins to unlock. The first one is free. */
  price: number;
  /** Chassis colour, shared by both robots. */
  body: number;
  /** Accent and visor, kept warm for Ignis and cool for Volta so the pair stays
   *  tellable apart at a glance no matter which skin is worn. */
  p1: number;
  p2: number;
}

export const SKINS: Skin[] = [
  { id: "conduit", name: "CONDUIT", price: 0, body: 0x46536b, p1: 0xff8a3d, p2: 0x35e0ff },
  { id: "ember", name: "EMBER", price: 60, body: 0x3a2430, p1: 0xff5a3c, p2: 0xffc23d },
  { id: "moss", name: "MOSS", price: 120, body: 0x27412f, p1: 0xc8ff5a, p2: 0x3dffb0 },
  { id: "orchid", name: "ORCHID", price: 200, body: 0x39294f, p1: 0xff6ad5, p2: 0x9d7bff },
  { id: "bone", name: "BONE", price: 320, body: 0xd8d2c4, p1: 0xff7043, p2: 0x2f9fb8 },
  { id: "void", name: "VOID", price: 500, body: 0x14161d, p1: 0xff2e63, p2: 0x00f5d4 },
  { id: "gold", name: "BULLION", price: 800, body: 0x6b5420, p1: 0xffd75e, p2: 0xfff3c4 },
];

export const skinById = (id: string): Skin => SKINS.find((s) => s.id === id) ?? SKINS[0];

export interface Trail {
  id: string;
  name: string;
  price: number;
  /** Ribbon colour. `null` means the robot's own accent colour. */
  color: number | null;
  /** Seconds a puff lives. Longer reads as a heavier tail. */
  life: number;
  /** Puffs per second. */
  rate: number;
  /** How much a puff drifts against gravity, in units per second. */
  rise: number;
  size: number;
}

export const TRAILS: Trail[] = [
  { id: "none", name: "NONE", price: 0, color: null, life: 0, rate: 0, rise: 0, size: 0 },
  { id: "spark", name: "SPARK", price: 80, color: null, life: 0.36, rate: 34, rise: 1.1, size: 0.055 },
  { id: "flame", name: "FLAME", price: 150, color: 0xff6a1a, life: 0.5, rate: 46, rise: 2.4, size: 0.085 },
  { id: "frost", name: "FROST", price: 150, color: 0x8ce6ff, life: 0.62, rate: 30, rise: 0.5, size: 0.07 },
  { id: "toxin", name: "TOXIN", price: 260, color: 0x9dff3d, life: 0.7, rate: 38, rise: 1.6, size: 0.075 },
  { id: "void", name: "RIFT", price: 400, color: 0xb46bff, life: 0.85, rate: 44, rise: -0.8, size: 0.095 },
  { id: "gold", name: "COMET", price: 650, color: 0xffd75e, life: 0.9, rate: 54, rise: 0.9, size: 0.105 },
];

export const trailById = (id: string): Trail => TRAILS.find((t) => t.id === id) ?? TRAILS[0];
