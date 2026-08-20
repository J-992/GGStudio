import { DENSITY } from '../core/theme';

export type TargetKind =
    'normal' | 'small' | 'fast' | 'armored' | 'golden' | 'bomb' | 'time' | 'coin' | 'multi' | 'boss' |
    /** Cash-round money. These never appear in a level's spawn table. */
    'cash' | 'stack' | 'vault';

export interface KindDef
{
    score: number;
    coins: number;
    xp: number;
    /** Health in "units". One unit scales with the level (see unitHp). */
    units: number;
    sizeMult: number;
    speedMult: number;
    /** How much this kill counts towards the level goal. */
    progress: number;
    color: number;
    /** Icon texture name (see core/icons), or '' for a plain target. */
    icon: string;
    ring: number;
}

export const KINDS: Record<TargetKind, KindDef> = {
    normal:  { score: 100,  coins: 3,   xp: 10,  units: 1,  sizeMult: 1.00, speedMult: 1.0, progress: 1,  color: 0x3fe0ff, icon: '',          ring: 0xffffff },
    small:   { score: 260,  coins: 5,   xp: 20,  units: 1,  sizeMult: 0.60, speedMult: 1.3, progress: 1,  color: 0x7dff6b, icon: '',          ring: 0xffffff },
    fast:    { score: 220,  coins: 4,   xp: 18,  units: 1,  sizeMult: 0.86, speedMult: 2.4, progress: 1,  color: 0xff7ae0, icon: 'chevrons',  ring: 0xffffff },
    armored: { score: 460,  coins: 9,   xp: 34,  units: 3,  sizeMult: 1.16, speedMult: 0.7, progress: 2,  color: 0xa8b4d0, icon: '',          ring: 0xe8f0ff },
    golden:  { score: 1500, coins: 45,  xp: 90,  units: 1,  sizeMult: 0.78, speedMult: 2.2, progress: 2,  color: 0xffd23f, icon: 'star',      ring: 0xfff3b0 },
    bomb:    { score: 0,    coins: 0,   xp: 0,   units: 1,  sizeMult: 1.00, speedMult: 1.1, progress: 0,  color: 0xff3b45, icon: 'skull',     ring: 0xff9aa0 },
    time:    { score: 90,   coins: 2,   xp: 12,  units: 1,  sizeMult: 0.80, speedMult: 1.7, progress: 1,  color: 0x62ffb8, icon: 'stopwatch', ring: 0xd6fff0 },
    coin:    { score: 70,   coins: 30,  xp: 10,  units: 1,  sizeMult: 0.76, speedMult: 1.8, progress: 1,  color: 0xffc857, icon: 'dollar',    ring: 0xfff0c9 },
    multi:   { score: 180,  coins: 7,   xp: 22,  units: 1,  sizeMult: 0.76, speedMult: 1.8, progress: 1,  color: 0xb388ff, icon: 'mult',      ring: 0xe3d4ff },
    boss:    { score: 9000, coins: 300, xp: 600, units: 16, sizeMult: 2.60, speedMult: 0.5, progress: 22, color: 0xff2d55, icon: 'trefoil',   ring: 0xffb3c0 },

    //  --- the cash round. Money only, one tap each, no goal to speak of. ---
    cash:    { score: 60,   coins: 18,  xp: 4,   units: 1,  sizeMult: 0.84, speedMult: 1.1, progress: 1,  color: 0x5fe08a, icon: 'dollar',    ring: 0xcdffdd },
    stack:   { score: 140,  coins: 45,  xp: 8,   units: 1,  sizeMult: 1.06, speedMult: 0.8, progress: 1,  color: 0xffc857, icon: 'coins',     ring: 0xfff0c9 },
    vault:   { score: 520,  coins: 120, xp: 18,  units: 1,  sizeMult: 1.30, speedMult: 0.5, progress: 1,  color: 0xffd23f, icon: 'gem',       ring: 0xfff3b0 }
};

export interface LevelConfig
{
    level: number;
    /** Seconds on the clock. */
    duration: number;
    /** Kill progress required to clear the level. */
    goal: number;
    /** Milliseconds between spawns. */
    spawnRate: number;
    /** Hard cap on simultaneous targets. */
    maxActive: number;
    /** Radius of a "normal" target in pixels. */
    size: number;
    /** Milliseconds before a target expires on its own. */
    lifetime: number;
    /** Base movement speed in px/sec. */
    speed: number;
    /** Chance a spawned target moves at all. */
    moveChance: number;
    weights: Partial<Record<TargetKind, number>>;
    /** Boss levels spawn their boss the moment the level starts. */
    boss?: boolean;
}

/**
 * The kinds that are a prize rather than a chore. They are smaller and quicker
 * than the rank and file, and they never stand still even on a level where
 * nothing else moves -- a bonus you can take at your leisure is not a bonus,
 * it is a delay.
 */
export const POWERUPS: TargetKind[] = [ 'coin', 'golden', 'time', 'multi' ];

export function isPowerup (kind: TargetKind): boolean
{
    return POWERUPS.indexOf(kind) !== -1;
}

/** Floor speed for a power-up, so it drifts even on a static level. */
export const POWERUP_SPEED = 74;

/** Health of one "unit" at a given level. Normal targets always die to one shot. */
export function unitHp (level: number): number
{
    return 10 + level * 3;
}

export const LEVELS: LevelConfig[] = [
    { level: 1,  duration: 12, goal: 8,  spawnRate: 820, maxActive: 4,  size: 54, lifetime: 3400, speed: 0,   moveChance: 0.00, weights: { normal: 10 } },
    { level: 2,  duration: 12, goal: 10, spawnRate: 760, maxActive: 4,  size: 51, lifetime: 3250, speed: 0,   moveChance: 0.00, weights: { normal: 10, coin: 2 } },
    { level: 3,  duration: 12, goal: 12, spawnRate: 700, maxActive: 5,  size: 49, lifetime: 3100, speed: 45,  moveChance: 0.15, weights: { normal: 10, coin: 2, small: 2 } },
    { level: 4,  duration: 13, goal: 14, spawnRate: 645, maxActive: 5,  size: 47, lifetime: 3000, speed: 58,  moveChance: 0.22, weights: { normal: 10, small: 3, coin: 2, time: 1 } },
    { level: 5,  duration: 13, goal: 16, spawnRate: 600, maxActive: 6,  size: 45, lifetime: 2900, speed: 70,  moveChance: 0.28, weights: { normal: 10, small: 3, coin: 2, time: 1, golden: 1 } },
    { level: 6,  duration: 13, goal: 18, spawnRate: 560, maxActive: 6,  size: 43, lifetime: 2750, speed: 84,  moveChance: 0.34, weights: { normal: 10, small: 4, fast: 2, coin: 2, golden: 1 } },
    { level: 7,  duration: 14, goal: 20, spawnRate: 525, maxActive: 7,  size: 42, lifetime: 2650, speed: 95,  moveChance: 0.40, weights: { normal: 10, small: 4, fast: 3, bomb: 2, coin: 2, golden: 1 } },
    { level: 8,  duration: 14, goal: 22, spawnRate: 495, maxActive: 7,  size: 41, lifetime: 2550, speed: 105, moveChance: 0.45, weights: { normal: 10, small: 5, fast: 3, bomb: 2, coin: 2, time: 1, golden: 1 } },
    { level: 9,  duration: 14, goal: 24, spawnRate: 465, maxActive: 8,  size: 40, lifetime: 2450, speed: 115, moveChance: 0.50, weights: { normal: 10, small: 5, fast: 4, bomb: 2, coin: 2, multi: 1, golden: 1 } },
    { level: 10, duration: 15, goal: 27, spawnRate: 440, maxActive: 8,  size: 39, lifetime: 2350, speed: 125, moveChance: 0.55, weights: { normal: 9,  small: 6, fast: 4, bomb: 3, coin: 2, multi: 1, time: 1, golden: 1 } },
    { level: 11, duration: 15, goal: 30, spawnRate: 415, maxActive: 9,  size: 38, lifetime: 2250, speed: 134, moveChance: 0.60, weights: { normal: 9,  small: 6, fast: 4, armored: 2, bomb: 3, coin: 2, golden: 1 } },
    { level: 12, duration: 15, goal: 33, spawnRate: 395, maxActive: 9,  size: 37, lifetime: 2200, speed: 143, moveChance: 0.65, weights: { normal: 8,  small: 6, fast: 5, armored: 3, bomb: 3, coin: 2, multi: 1, golden: 1 } },
    { level: 13, duration: 16, goal: 36, spawnRate: 375, maxActive: 10, size: 36, lifetime: 2150, speed: 152, moveChance: 0.70, weights: { normal: 8,  small: 7, fast: 5, armored: 3, bomb: 3, coin: 2, multi: 1, time: 1, golden: 1 } },
    { level: 14, duration: 16, goal: 39, spawnRate: 355, maxActive: 10, size: 35, lifetime: 2100, speed: 161, moveChance: 0.75, weights: { normal: 8,  small: 7, fast: 6, armored: 3, bomb: 4, coin: 2, multi: 1, golden: 1 } },
    { level: 15, duration: 16, goal: 42, spawnRate: 335, maxActive: 11, size: 34, lifetime: 2050, speed: 170, moveChance: 0.80, weights: { normal: 7,  small: 8, fast: 6, armored: 4, bomb: 4, coin: 2, multi: 1, time: 1, golden: 2 } },
    { level: 16, duration: 17, goal: 46, spawnRate: 318, maxActive: 11, size: 33, lifetime: 2000, speed: 179, moveChance: 0.85, weights: { normal: 7,  small: 8, fast: 7, armored: 4, bomb: 4, coin: 2, multi: 1, golden: 2 } },
    { level: 17, duration: 17, goal: 50, spawnRate: 302, maxActive: 12, size: 32, lifetime: 1950, speed: 188, moveChance: 0.90, weights: { normal: 6,  small: 9, fast: 7, armored: 5, bomb: 5, coin: 2, multi: 1, time: 1, golden: 2 } },
    { level: 18, duration: 17, goal: 54, spawnRate: 288, maxActive: 12, size: 31, lifetime: 1900, speed: 197, moveChance: 0.95, weights: { normal: 6,  small: 9, fast: 8, armored: 5, bomb: 5, coin: 2, multi: 1, golden: 2 } },
    { level: 19, duration: 18, goal: 58, spawnRate: 274, maxActive: 13, size: 30, lifetime: 1850, speed: 206, moveChance: 1.00, weights: { normal: 5,  small: 10, fast: 8, armored: 6, bomb: 5, coin: 2, multi: 1, time: 1, golden: 2 } },
    { level: 20, duration: 22, goal: 78, spawnRate: 260, maxActive: 14, size: 30, lifetime: 1800, speed: 215, moveChance: 1.00, weights: { normal: 5,  small: 10, fast: 9, armored: 6, bomb: 6, coin: 2, multi: 1, time: 1, golden: 3 }, boss: true },
    { level: 21, duration: 18, goal: 60,  spawnRate: 266, maxActive: 13, size: 30, lifetime: 1800, speed: 220, moveChance: 1.00, weights: { normal: 5,  small: 10, fast: 9,  armored: 6, bomb: 6, coin: 2, multi: 1, golden: 3 } },
    { level: 22, duration: 18, goal: 63,  spawnRate: 258, maxActive: 14, size: 30, lifetime: 1780, speed: 228, moveChance: 1.00, weights: { normal: 5,  small: 10, fast: 9,  armored: 7, bomb: 6, coin: 2, multi: 1, time: 1, golden: 3 } },
    { level: 23, duration: 18, goal: 65,  spawnRate: 250, maxActive: 14, size: 29, lifetime: 1750, speed: 236, moveChance: 1.00, weights: { normal: 4,  small: 11, fast: 10, armored: 7, bomb: 7, coin: 2, multi: 1, golden: 3 } },
    { level: 24, duration: 19, goal: 70,  spawnRate: 242, maxActive: 14, size: 29, lifetime: 1720, speed: 244, moveChance: 1.00, weights: { normal: 4,  small: 11, fast: 10, armored: 8, bomb: 7, coin: 2, multi: 1, time: 1, golden: 3 } },
    { level: 25, duration: 19, goal: 73,  spawnRate: 234, maxActive: 15, size: 29, lifetime: 1690, speed: 252, moveChance: 1.00, weights: { normal: 4,  small: 12, fast: 11, armored: 8, bomb: 7, coin: 2, multi: 2, golden: 4 } },
    { level: 26, duration: 19, goal: 75,  spawnRate: 227, maxActive: 15, size: 28, lifetime: 1660, speed: 260, moveChance: 1.00, weights: { normal: 3,  small: 12, fast: 11, armored: 9, bomb: 8, coin: 2, multi: 2, time: 1, golden: 4 } },
    { level: 27, duration: 20, goal: 81,  spawnRate: 220, maxActive: 15, size: 28, lifetime: 1630, speed: 268, moveChance: 1.00, weights: { normal: 3,  small: 13, fast: 12, armored: 9, bomb: 8, coin: 2, multi: 2, golden: 4 } },
    { level: 28, duration: 20, goal: 84,  spawnRate: 213, maxActive: 16, size: 28, lifetime: 1600, speed: 276, moveChance: 1.00, weights: { normal: 3,  small: 13, fast: 12, armored: 10, bomb: 8, coin: 2, multi: 2, time: 1, golden: 4 } },
    { level: 29, duration: 20, goal: 86,  spawnRate: 206, maxActive: 16, size: 27, lifetime: 1570, speed: 284, moveChance: 1.00, weights: { normal: 2,  small: 14, fast: 13, armored: 10, bomb: 9, coin: 2, multi: 2, golden: 4 } },
    { level: 30, duration: 26, goal: 116, spawnRate: 200, maxActive: 17, size: 27, lifetime: 1540, speed: 292, moveChance: 1.00, weights: { normal: 2,  small: 14, fast: 13, armored: 11, bomb: 9, coin: 3, multi: 2, time: 2, golden: 5 }, boss: true },
    { level: 31, duration: 20, goal: 91,  spawnRate: 196, maxActive: 16, size: 27, lifetime: 1520, speed: 296, moveChance: 1.00, weights: { normal: 2,  small: 15, fast: 14, armored: 11, bomb: 9, coin: 2, multi: 2, golden: 5 } },
    { level: 32, duration: 21, goal: 96,  spawnRate: 192, maxActive: 17, size: 26, lifetime: 1500, speed: 302, moveChance: 1.00, weights: { normal: 2,  small: 15, fast: 14, armored: 12, bomb: 10, coin: 2, multi: 2, time: 1, golden: 5 } },
    { level: 33, duration: 21, goal: 99,  spawnRate: 188, maxActive: 17, size: 26, lifetime: 1480, speed: 308, moveChance: 1.00, weights: { normal: 2,  small: 16, fast: 15, armored: 12, bomb: 10, coin: 2, multi: 2, golden: 5 } },
    { level: 34, duration: 21, goal: 102, spawnRate: 184, maxActive: 17, size: 26, lifetime: 1460, speed: 314, moveChance: 1.00, weights: { normal: 2,  small: 16, fast: 15, armored: 13, bomb: 10, coin: 2, multi: 2, time: 1, golden: 5 } },
    { level: 35, duration: 22, goal: 108, spawnRate: 180, maxActive: 18, size: 26, lifetime: 1440, speed: 320, moveChance: 1.00, weights: { normal: 1,  small: 17, fast: 16, armored: 13, bomb: 11, coin: 2, multi: 3, golden: 6 } },
    { level: 36, duration: 22, goal: 111, spawnRate: 176, maxActive: 18, size: 25, lifetime: 1420, speed: 326, moveChance: 1.00, weights: { normal: 1,  small: 17, fast: 16, armored: 14, bomb: 11, coin: 2, multi: 3, time: 1, golden: 6 } },
    { level: 37, duration: 22, goal: 114, spawnRate: 172, maxActive: 18, size: 25, lifetime: 1400, speed: 332, moveChance: 1.00, weights: { normal: 1,  small: 18, fast: 17, armored: 14, bomb: 12, coin: 2, multi: 3, golden: 6 } },
    { level: 38, duration: 23, goal: 121, spawnRate: 168, maxActive: 19, size: 25, lifetime: 1390, speed: 338, moveChance: 1.00, weights: { normal: 1,  small: 18, fast: 17, armored: 15, bomb: 12, coin: 2, multi: 3, time: 1, golden: 6 } },
    { level: 39, duration: 23, goal: 124, spawnRate: 164, maxActive: 19, size: 25, lifetime: 1380, speed: 344, moveChance: 1.00, weights: { normal: 1,  small: 19, fast: 18, armored: 15, bomb: 13, coin: 2, multi: 3, golden: 7 } },
    { level: 40, duration: 30, goal: 166, spawnRate: 160, maxActive: 20, size: 25, lifetime: 1370, speed: 350, moveChance: 1.00, weights: { normal: 1,  small: 19, fast: 18, armored: 16, bomb: 13, coin: 3, multi: 3, time: 2, golden: 8 }, boss: true }
];

export const FINAL_LEVEL = LEVELS.length;

export function levelConfig (level: number): LevelConfig
{
    const cfg = LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1];

    if (DENSITY <= 1.001) return cfg;

    //  A wide arena holds proportionally more without feeling busier: the same
    //  level on a desktop screen would otherwise be a near-empty field with a
    //  lot of mouse travel between targets.
    return {
        ...cfg,
        maxActive: Math.round(cfg.maxActive * DENSITY),
        spawnRate: Math.round(cfg.spawnRate / DENSITY)
    };
}

/** Weighted pick from a level's spawn table. */
export function pickKind (weights: Partial<Record<TargetKind, number>>): TargetKind
{
    let total = 0;
    for (const k in weights) total += weights[k as TargetKind] || 0;

    let roll = Math.random() * total;

    for (const k in weights)
    {
        roll -= weights[k as TargetKind] || 0;
        if (roll <= 0) return k as TargetKind;
    }

    return 'normal';
}
