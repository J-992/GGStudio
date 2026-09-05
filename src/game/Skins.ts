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
