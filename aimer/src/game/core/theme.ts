export const W = 540;
export const H = 960;

/** Safe playfield rectangle. Targets never spawn outside of this. */
export const PLAY = { left: 46, right: W - 46, top: 214, bottom: 866 };

/** Where shots originate from -- the turret's barrel pivot. */
export const MUZZLE = { x: W / 2, y: H - 6 };

export const FONT = '"Arial Black", "Arial Bold", Arial, sans-serif';
export const FONT_UI = 'Arial, Helvetica, sans-serif';

export interface Tier
{
    bg: number;
    grid: number;
    accent: number;
    accent2: number;
    dust: number;
}

/** Eight visual tiers -- one per five levels. The world gets hotter as the run goes on. */
export const TIERS: Tier[] = [
    { bg: 0x080b1c, grid: 0x1b2a5e, accent: 0x3fe0ff, accent2: 0x6cf5c8, dust: 0x3fe0ff },
    { bg: 0x0c0824, grid: 0x2e2070, accent: 0x9b6cff, accent2: 0x4fd6ff, dust: 0x9b6cff },
    { bg: 0x15061f, grid: 0x4d1560, accent: 0xff5ce0, accent2: 0xb06cff, dust: 0xff5ce0 },
    { bg: 0x1c0612, grid: 0x66152f, accent: 0xff5470, accent2: 0xffa23f, dust: 0xff5470 },
    { bg: 0x1f1203, grid: 0x6b3f08, accent: 0xffb020, accent2: 0xff4d3d, dust: 0xffd166 },
    { bg: 0x03170f, grid: 0x0c5c37, accent: 0x2fffa0, accent2: 0xd8ff4d, dust: 0x2fffa0 },
    { bg: 0x1a0007, grid: 0x6e0020, accent: 0xff2d55, accent2: 0xff8a00, dust: 0xff5470 },
    { bg: 0x0a0014, grid: 0x3c0a78, accent: 0xf2f6ff, accent2: 0xb388ff, dust: 0xd8c8ff }
];

export function tierFor (level: number): Tier
{
    return TIERS[Math.min(TIERS.length - 1, Math.floor((level - 1) / 5))];
}

/** 0xrrggbb -> '#rrggbb' (Phaser text colours want strings). */
export function hex (c: number): string
{
    return '#' + c.toString(16).padStart(6, '0');
}

export function fmt (n: number): string
{
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Short form for very large numbers (score can get silly late in a run). */
export function fmtShort (n: number): string
{
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M';
    return fmt(n);
}

export function mix (a: number, b: number, t: number): number
{
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    return ((ar + (br - ar) * t) << 16 | (ag + (bg - ag) * t) << 8 | (ab + (bb - ab) * t)) & 0xffffff;
}
