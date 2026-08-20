export type TargetKind =
    'normal' | 'small' | 'fast' | 'armored' | 'golden' | 'bomb' | 'time' | 'coin' | 'multi' | 'boss';

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
    icon: string;
    ring: number;
}

export const KINDS: Record<TargetKind, KindDef> = {
    normal:  { score: 100,  coins: 3,   xp: 10,  units: 1,  sizeMult: 1.00, speedMult: 1.0, progress: 1,  color: 0x3fe0ff, icon: '',   ring: 0xffffff },
    small:   { score: 260,  coins: 5,   xp: 20,  units: 1,  sizeMult: 0.60, speedMult: 1.3, progress: 1,  color: 0x7dff6b, icon: '',   ring: 0xffffff },
    fast:    { score: 220,  coins: 4,   xp: 18,  units: 1,  sizeMult: 0.86, speedMult: 2.4, progress: 1,  color: 0xff7ae0, icon: '»',  ring: 0xffffff },
    armored: { score: 460,  coins: 9,   xp: 34,  units: 3,  sizeMult: 1.16, speedMult: 0.7, progress: 2,  color: 0xa8b4d0, icon: '',   ring: 0xe8f0ff },
    golden:  { score: 1500, coins: 45,  xp: 90,  units: 1,  sizeMult: 0.92, speedMult: 1.6, progress: 2,  color: 0xffd23f, icon: '★',  ring: 0xfff3b0 },
    bomb:    { score: 0,    coins: 0,   xp: 0,   units: 1,  sizeMult: 1.00, speedMult: 1.1, progress: 0,  color: 0xff3b45, icon: '☠',  ring: 0xff9aa0 },
    time:    { score: 90,   coins: 2,   xp: 12,  units: 1,  sizeMult: 0.94, speedMult: 1.1, progress: 1,  color: 0x62ffb8, icon: '+',  ring: 0xd6fff0 },
    coin:    { score: 70,   coins: 30,  xp: 10,  units: 1,  sizeMult: 0.90, speedMult: 1.2, progress: 1,  color: 0xffc857, icon: '$',  ring: 0xfff0c9 },
    multi:   { score: 180,  coins: 7,   xp: 22,  units: 1,  sizeMult: 0.90, speedMult: 1.2, progress: 1,  color: 0xb388ff, icon: 'x2', ring: 0xe3d4ff },
    boss:    { score: 9000, coins: 300, xp: 600, units: 16, sizeMult: 2.60, speedMult: 0.5, progress: 22, color: 0xff2d55, icon: '☢',  ring: 0xffb3c0 }
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
    /** Level 20 spawns a boss the moment the level starts. */
    boss?: boolean;
}

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
    { level: 20, duration: 22, goal: 78, spawnRate: 260, maxActive: 14, size: 30, lifetime: 1800, speed: 215, moveChance: 1.00, weights: { normal: 5,  small: 10, fast: 9, armored: 6, bomb: 6, coin: 2, multi: 1, time: 1, golden: 3 }, boss: true }
];

export const FINAL_LEVEL = LEVELS.length;

export function levelConfig (level: number): LevelConfig
{
    return LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1];
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
