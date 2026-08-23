import { DENSITY } from '../core/theme';

export type TargetKind =
    'normal' | 'tough' | 'small' | 'fast' | 'armored' | 'golden' | 'bomb' | 'time' | 'coin' | 'multi' | 'boss' | 'spam' |
    /** Cash-round money. These never appear in a level's spawn table. */
    'cash' | 'stack' | 'vault' |
    /** The ability orb (see core/abilities). Scheduled, never rolled. */
    'ability';

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

/**
 * The board.
 *
 * Every kind on the board asks the player for exactly one thing, and the run is
 * built by changing which question the board is mostly asking:
 *
 *   normal    nothing. A free tap. It is the *tutorial* target and it is gone
 *             from the spawn tables entirely by the fourth world.
 *   tough     two units of health -- two taps on a stock gun, one on a gun
 *             that has taken POWER even once. The gentle version of the
 *             question the armoured target asks.
 *   armored   four units and three progress: a bad trade for a stock gun (four
 *             taps for three) and the best trade on the board for a heavy one.
 *   small     precision, asked by making the whole thing tiny.
 *   fast      precision again, asked by making it run.
 *
 * Health is not only a question for the gun, because a dead-centre hit does
 * double damage (see BULLSEYE in GameScene). So a two-unit target is one tap
 * for a player who can hit the middle of it, one tap for a player who bought
 * POWER, and two taps for everybody else -- one target, asking two completely
 * different builds the same question and taking either answer.
 *
 * From the skyline onwards the free target is the minority and one of those
 * demands is the majority, which is what stops the middle of the run from
 * being a rhythm game played on a wall of identical circles.
 */
export const KINDS: Record<TargetKind, KindDef> = {
    normal:  { score: 100,  coins: 3,   xp: 10,  units: 1,  sizeMult: 1.00, speedMult: 1.0, progress: 1,  color: 0x3fe0ff, icon: '',          ring: 0xffffff },
    tough:   { score: 300,  coins: 6,   xp: 24,  units: 2,  sizeMult: 1.06, speedMult: 0.85, progress: 1, color: 0x6c8cff, icon: '',          ring: 0xcdd8ff },
    small:   { score: 260,  coins: 5,   xp: 20,  units: 1,  sizeMult: 0.60, speedMult: 1.3, progress: 1,  color: 0x7dff6b, icon: '',          ring: 0xffffff },
    fast:    { score: 220,  coins: 4,   xp: 18,  units: 1,  sizeMult: 0.86, speedMult: 2.4, progress: 1,  color: 0xff7ae0, icon: 'chevrons',  ring: 0xffffff },
    armored: { score: 620,  coins: 11,  xp: 44,  units: 4,  sizeMult: 1.16, speedMult: 0.7, progress: 3,  color: 0xa8b4d0, icon: '',          ring: 0xe8f0ff },
    golden:  { score: 1500, coins: 45,  xp: 90,  units: 1,  sizeMult: 0.78, speedMult: 2.2, progress: 2,  color: 0xffd23f, icon: 'star',      ring: 0xfff3b0 },
    bomb:    { score: 0,    coins: 0,   xp: 0,   units: 1,  sizeMult: 1.00, speedMult: 1.1, progress: 0,  color: 0xff3b45, icon: 'skull',     ring: 0xff9aa0 },
    time:    { score: 90,   coins: 2,   xp: 12,  units: 1,  sizeMult: 0.80, speedMult: 1.7, progress: 1,  color: 0x62ffb8, icon: 'stopwatch', ring: 0xd6fff0 },
    coin:    { score: 70,   coins: 30,  xp: 10,  units: 1,  sizeMult: 0.76, speedMult: 1.8, progress: 1,  color: 0xffc857, icon: 'dollar',    ring: 0xfff0c9 },
    multi:   { score: 180,  coins: 7,   xp: 22,  units: 1,  sizeMult: 0.76, speedMult: 1.8, progress: 1,  color: 0xb388ff, icon: 'mult',      ring: 0xe3d4ff },
    //  No glyph. A boss is the one target in the game that always carries a
    //  number on its face, and a trefoil the size of the whole body sat
    //  directly under it -- two marks fighting for the same middle, on the one
    //  target where the number is the only thing the player needs to read.
    boss:    { score: 16000, coins: 480, xp: 950, units: 48, sizeMult: 2.60, speedMult: 0.5, progress: 34, color: 0xff2d55, icon: '',          ring: 0xffb3c0 },
    //  The drum. It has no health at all, because nothing is ever supposed to
    //  kill it -- see the SPAM ROUND in GameScene.
    spam:    { score: 120,  coins: 2,   xp: 6,   units: 1,  sizeMult: 2.30, speedMult: 0.0, progress: 0,  color: 0xffd23f, icon: 'burst',     ring: 0xfff3b0 },

    //  --- the cash round. Money only, one tap each, no goal to speak of. ---
    cash:    { score: 60,   coins: 18,  xp: 4,   units: 1,  sizeMult: 0.84, speedMult: 1.1, progress: 1,  color: 0x5fe08a, icon: 'dollar',    ring: 0xcdffdd },
    stack:   { score: 140,  coins: 45,  xp: 8,   units: 1,  sizeMult: 1.06, speedMult: 0.8, progress: 1,  color: 0xffc857, icon: 'coins',     ring: 0xfff0c9 },
    vault:   { score: 520,  coins: 120, xp: 18,  units: 1,  sizeMult: 1.30, speedMult: 0.5, progress: 1,  color: 0xffd23f, icon: 'gem',       ring: 0xfff3b0 },

    //  The ability orb. Two shots whatever the gun (see applyShot), and the
    //  prize is the weapon it hands over, so it pays little in anything else.
    ability: { score: 400,  coins: 10,  xp: 30,  units: 2,  sizeMult: 0.92, speedMult: 1.5, progress: 0,  color: 0xffffff, icon: '',          ring: 0xffd23f }
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
    /**
     * Seconds of the SPAM ROUND before the clock starts.
     *
     * A drum the size of the arena, on its own, that cannot be killed and pays
     * for every single tap. It is the one moment in the run with no aim test,
     * no order to read and no way to lose -- pure hand speed for points -- and
     * it is spent as a reward rather than as a level: it runs in the beat
     * between the doors opening and the level's own clock starting, so nothing
     * it gives away is taken out of the level it arrived on.
     */
    spam?: number;
    /**
     * The last level of a world, and the fight that closes it.
     *
     * Which boss it is, what it is called, how it has to be killed and what it
     * pays all live in data/bosses, keyed off the level number -- this flag
     * only says that this level *has* one, because that is the one thing the
     * level table itself has to know: a boss level runs a longer clock, a
     * thinner spawn table and a goal that is the boss rather than a headcount.
     */
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

/**
 * How many targets' worth of health one shot deletes -- and the only honest
 * way to talk about the gun.
 *
 * Raw damage is a meaningless number here, because target health is pinned to
 * the level (see `unitHp` above): 40 damage is a massacre on level 1 and a
 * scratch on level 40. Punch says the same thing in the one unit the player
 * can feel. 1.0 is exactly enough to kill a plain target and not a drop more,
 * which is where a stock gun sits -- and which is precisely why POWER used to
 * look like it did nothing at all. Everything past 1.0 is surplus, and the
 * surplus now has somewhere to go: through the shield plate, through the
 * glass, and out the far side of the thing it just killed.
 */
export function punchOf (damage: number, level: number): number
{
    return damage / unitHp(level);
}

/**
 * XP for a kill, at the level it happened on.
 *
 * XP used to be flat: a plain target was worth ten of it on level 1 and ten of
 * it on level 40, while the price of a rank went up by half again every rung.
 * Score has always scaled with the level and XP never did, so the back half of
 * a run quietly starved -- and it starves harder now that the late levels
 * deliberately put fewer targets on the board (see the table below). This is
 * the same ramp score uses, at a fifth of its slope: enough that a rank keeps
 * costing about the same number of *minutes* all the way up.
 */
export function xpWorth (xp: number, level: number): number
{
    return xp * (1 + level * 0.02);
}

/**
 * The forty levels, and the shape of the whole run.
 *
 * Three dials say more about how a level *feels* than anything else in this
 * file, and they used to all point the same way as the level number: more
 * targets, faster, on a shorter clock. That made the back half of the run a
 * wall of confetti -- twenty targets on the board at once, a new one every
 * sixth of a second, and no reason to care about any particular one of them,
 * because another was already on its way.
 *
 * They now point in opposite directions, and that is the point:
 *
 *   duration    grows all the way to the end. A late level is a two-thirds of
 *               a minute *engagement*, not a twenty-second sprint.
 *   spawnRate   slows down as the run goes on. Level 39 spawns roughly half as
 *               often as it used to, so a target on the board is a resource
 *               rather than a nuisance -- letting one expire actually costs.
 *   maxActive   comes down with it. The board stays legible; what gets harder
 *               is the *rule* the zone is playing by, not the headcount.
 *
 * The goals are set against the spawn budget rather than pulled out of the
 * air: a level asks for two thirds to four fifths of everything it will ever
 * put on the board, and the share it asks for rises the deeper in the run it
 * is. Late on, nearly every target has to be taken.
 *
 * The first level of each zone is deliberately the quietest one in it: a short
 * spawn table, a low cap, and (see data/hazards) none of the inherited kit --
 * so the one new thing that zone is *about* has the board to itself. The level
 * after it adds a kind back, and the zone is running its full board by the
 * third.
 */
export const LEVELS: LevelConfig[] = [
    { level: 1,  duration: 16, goal: 10,  spawnRate: 760, maxActive: 2,  size: 54, lifetime: 3400, speed: 0,   moveChance: 0.00, weights: { normal: 10 } },
    { level: 2,  duration: 17, goal: 13,  spawnRate: 720, maxActive: 2,  size: 52, lifetime: 3300, speed: 0,   moveChance: 0.00, weights: { normal: 10, coin: 2 } },
    { level: 3,  duration: 30, goal: 44,  spawnRate: 900, maxActive: 2,  size: 50, lifetime: 3200, speed: 45,  moveChance: 0.15, weights: { normal: 10, small: 3, coin: 2 }, boss: true },
    { level: 4,  duration: 18, goal: 20,  spawnRate: 700, maxActive: 4,  size: 47, lifetime: 3150, speed: 58,  moveChance: 0.22, weights: { normal: 8, tough: 4, coin: 2 } },
    { level: 5,  duration: 19, goal: 25,  spawnRate: 670, maxActive: 5,  size: 45, lifetime: 3050, speed: 68,  moveChance: 0.28, weights: { normal: 5, tough: 6, small: 4, coin: 2 } },
    { level: 6,  duration: 20, goal: 29,  spawnRate: 640, maxActive: 5,  size: 43, lifetime: 2950, speed: 80,  moveChance: 0.34, weights: { normal: 3, tough: 8, small: 6, coin: 2, golden: 1 } },
    { level: 7,  duration: 30, goal: 18,  spawnRate: 900, maxActive: 5,  size: 42, lifetime: 2850, speed: 92,  moveChance: 0.40, weights: { normal: 2, tough: 9, small: 7, coin: 2, golden: 1 }, boss: true },
    { level: 8,  duration: 21, goal: 32,  spawnRate: 640, maxActive: 5,  size: 43, lifetime: 2950, speed: 86,  moveChance: 0.32, weights: { normal: 2, tough: 9, small: 7, coin: 2 }, spam: 7 },
    { level: 9,  duration: 22, goal: 36,  spawnRate: 615, maxActive: 5,  size: 42, lifetime: 2850, speed: 95,  moveChance: 0.38, weights: { normal: 2, tough: 9, small: 7, armored: 2, coin: 2 } },
    { level: 10, duration: 22, goal: 34,  spawnRate: 590, maxActive: 6,  size: 44, lifetime: 2750, speed: 104, moveChance: 0.46, weights: { normal: 1, tough: 9, small: 8, armored: 3, coin: 2 } },
    { level: 11, duration: 23, goal: 36,  spawnRate: 565, maxActive: 6,  size: 43, lifetime: 2650, speed: 114, moveChance: 0.54, weights: { normal: 1, tough: 9, small: 8, armored: 4, bomb: 3, coin: 2 } },
    { level: 12, duration: 36, goal: 52,  spawnRate: 860, maxActive: 5,  size: 42, lifetime: 2550, speed: 124, moveChance: 0.60, weights: { tough: 9, small: 9, coin: 2, golden: 1 }, boss: true },
    { level: 13, duration: 23, goal: 35,  spawnRate: 570, maxActive: 6,  size: 44, lifetime: 2700, speed: 112, moveChance: 0.50, weights: { tough: 10, small: 7, armored: 3, coin: 2 } },
    { level: 14, duration: 24, goal: 42,  spawnRate: 550, maxActive: 7,  size: 43, lifetime: 2600, speed: 122, moveChance: 0.56, weights: { tough: 10, small: 8, fast: 3, armored: 4, coin: 2, golden: 1 } },
    { level: 15, duration: 25, goal: 41,  spawnRate: 530, maxActive: 7,  size: 42, lifetime: 2500, speed: 132, moveChance: 0.62, weights: { tough: 10, small: 8, fast: 4, armored: 5, bomb: 3, coin: 2, time: 1 } },
    { level: 16, duration: 26, goal: 37,  spawnRate: 512, maxActive: 8,  size: 41, lifetime: 2450, speed: 142, moveChance: 0.68, weights: { tough: 10, small: 9, fast: 4, armored: 6, bomb: 3, coin: 2, golden: 2 } },
    { level: 17, duration: 27, goal: 38,  spawnRate: 496, maxActive: 8,  size: 40, lifetime: 2400, speed: 152, moveChance: 0.74, weights: { tough: 9, small: 9, fast: 5, armored: 7, bomb: 4, coin: 2, multi: 1 } },
    { level: 18, duration: 28, goal: 42,  spawnRate: 480, maxActive: 9,  size: 39, lifetime: 2350, speed: 162, moveChance: 0.80, weights: { tough: 9, small: 10, fast: 5, armored: 8, bomb: 4, coin: 2, golden: 2 } },
    { level: 19, duration: 38, goal: 46,  spawnRate: 820, maxActive: 6,  size: 38, lifetime: 2300, speed: 172, moveChance: 0.86, weights: { tough: 9, small: 10, fast: 6, coin: 2, time: 1 }, boss: true },
    { level: 20, duration: 28, goal: 48,  spawnRate: 500, maxActive: 8,  size: 39, lifetime: 2400, speed: 168, moveChance: 0.90, weights: { tough: 9, small: 8, fast: 5, armored: 7, coin: 2, golden: 2 } },
    { level: 21, duration: 27, goal: 56,  spawnRate: 455, maxActive: 9,  size: 38, lifetime: 2300, speed: 178, moveChance: 0.92, weights: { tough: 9, small: 9, fast: 6, armored: 8, coin: 2, golden: 2 } },
    { level: 22, duration: 28, goal: 77,  spawnRate: 444, maxActive: 9,  size: 37, lifetime: 2250, speed: 186, moveChance: 0.96, weights: { tough: 8, small: 10, fast: 7, armored: 9, coin: 2, time: 1, golden: 3 } },
    { level: 23, duration: 29, goal: 77,  spawnRate: 434, maxActive: 10, size: 37, lifetime: 2200, speed: 194, moveChance: 1.00, weights: { tough: 8, small: 10, fast: 7, armored: 10, bomb: 4, coin: 2, golden: 3 } },
    { level: 24, duration: 30, goal: 80,  spawnRate: 424, maxActive: 10, size: 36, lifetime: 2150, speed: 202, moveChance: 1.00, weights: { tough: 8, small: 11, fast: 8, armored: 11, bomb: 4, coin: 2, multi: 1, golden: 3 } },
    { level: 25, duration: 31, goal: 82,  spawnRate: 414, maxActive: 11, size: 36, lifetime: 2100, speed: 210, moveChance: 1.00, weights: { tough: 7, small: 11, fast: 8, armored: 12, bomb: 5, coin: 2, time: 1, golden: 3 } },
    { level: 26, duration: 32, goal: 87,  spawnRate: 405, maxActive: 11, size: 35, lifetime: 2050, speed: 218, moveChance: 1.00, weights: { tough: 7, small: 12, fast: 9, armored: 13, bomb: 5, coin: 2, multi: 1, golden: 4 } },
    { level: 27, duration: 42, goal: 54,  spawnRate: 780, maxActive: 6,  size: 35, lifetime: 2000, speed: 226, moveChance: 1.00, weights: { tough: 6, small: 12, fast: 9, coin: 2, time: 1, golden: 4 }, boss: true },
    { level: 28, duration: 30, goal: 76,  spawnRate: 430, maxActive: 9,  size: 37, lifetime: 2200, speed: 204, moveChance: 1.00, weights: { tough: 9, small: 10, fast: 6, armored: 9, coin: 2, golden: 3 } },
    { level: 29, duration: 32, goal: 91,  spawnRate: 415, maxActive: 10, size: 36, lifetime: 2150, speed: 212, moveChance: 1.00, weights: { tough: 8, small: 11, fast: 8, armored: 11, coin: 2, golden: 3 } },
    { level: 30, duration: 33, goal: 82,  spawnRate: 430, maxActive: 10, size: 36, lifetime: 2100, speed: 220, moveChance: 1.00, weights: { tough: 7, small: 11, fast: 8, armored: 13, bomb: 5, coin: 2, time: 1, golden: 4 } },
    { level: 31, duration: 33, goal: 74,  spawnRate: 400, maxActive: 11, size: 35, lifetime: 2050, speed: 228, moveChance: 1.00, weights: { tough: 7, small: 12, fast: 9, armored: 13, bomb: 5, coin: 2, golden: 4 } },
    { level: 32, duration: 34, goal: 75,  spawnRate: 392, maxActive: 11, size: 34, lifetime: 2000, speed: 236, moveChance: 1.00, weights: { tough: 6, small: 12, fast: 10, armored: 15, bomb: 6, coin: 2, multi: 1, golden: 4 } },
    { level: 33, duration: 44, goal: 58,  spawnRate: 760, maxActive: 6,  size: 34, lifetime: 1950, speed: 244, moveChance: 1.00, weights: { tough: 6, small: 13, fast: 10, coin: 2, time: 1, golden: 5 }, boss: true },
    { level: 34, duration: 31, goal: 94,  spawnRate: 415, maxActive: 9,  size: 36, lifetime: 2100, speed: 232, moveChance: 1.00, weights: { tough: 7, small: 12, fast: 8, armored: 10, coin: 2, golden: 4 } },
    { level: 35, duration: 33, goal: 100, spawnRate: 400, maxActive: 10, size: 35, lifetime: 2050, speed: 240, moveChance: 1.00, weights: { tough: 6, small: 13, fast: 10, armored: 13, coin: 2, multi: 1, golden: 4 } },
    { level: 36, duration: 35, goal: 90,  spawnRate: 392, maxActive: 11, size: 34, lifetime: 2000, speed: 248, moveChance: 1.00, weights: { tough: 6, small: 13, fast: 10, armored: 15, bomb: 6, coin: 2, golden: 5 } },
    { level: 37, duration: 36, goal: 91,  spawnRate: 384, maxActive: 11, size: 34, lifetime: 1950, speed: 256, moveChance: 1.00, weights: { tough: 5, small: 14, fast: 11, armored: 17, bomb: 6, coin: 2, time: 1, golden: 5 } },
    { level: 38, duration: 37, goal: 96,  spawnRate: 376, maxActive: 12, size: 33, lifetime: 1900, speed: 264, moveChance: 1.00, weights: { tough: 5, small: 14, fast: 11, armored: 18, bomb: 7, coin: 2, multi: 1, golden: 5 } },
    { level: 39, duration: 38, goal: 100, spawnRate: 368, maxActive: 12, size: 33, lifetime: 1880, speed: 272, moveChance: 1.00, weights: { tough: 4, small: 15, fast: 12, armored: 19, bomb: 7, coin: 2, time: 1, golden: 6 } },
    { level: 40, duration: 55, goal: 128, spawnRate: 740, maxActive: 7,  size: 33, lifetime: 1850, speed: 280, moveChance: 1.00, weights: { tough: 4, small: 15, fast: 12, coin: 3, multi: 1, time: 1, golden: 6 }, boss: true }
];

export const FINAL_LEVEL = LEVELS.length;

export function levelConfig (level: number): LevelConfig
{
    const cfg = LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1];

    if (DENSITY <= 1.001) return cfg;

    //  A level that deliberately shows two things at once means two, on every
    //  screen. The density dial exists so a wide arena does not read as empty,
    //  and the training range is the one place in the run where an empty-
    //  looking board is the entire point: three targets and a lot of space is
    //  a lesson, and four targets and less space is clutter.
    if (cfg.maxActive <= 2) return { ...cfg, spawnRate: Math.round(cfg.spawnRate / DENSITY) };

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
