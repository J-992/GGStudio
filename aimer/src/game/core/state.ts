import { baseStats, Stats, UPGRADE_BY_ID } from '../data/upgrades';
import { pickXpBonus, rankXpBonus, xpForRank } from '../data/rank';
import { unitHp } from '../data/levels';
import { BOOST_BY_ID, BOOSTS, Boost } from '../data/boosts';
import { DEFAULT_SKIN, SKIN_BY_ID, TargetSkin } from '../data/skins';

export interface Perk
{
    id: string;
    name: string;
    /** Icon texture name (see core/icons). */
    icon: string;
    effect: string;
    max: number;
    cost: number;
    growth: number;
    apply: (s: Stats, level: number) => void;
}

/** Permanent, coin-bought upgrades that persist between runs. */
export const PERKS: Perk[] = [
    { id: 'power',    name: 'GUN POWER',   icon: 'damage',    effect: '+7% DAMAGE',     max: 10, cost: 520,  growth: 1.62, apply: (s, l) => { s.damage *= 1 + 0.07 * l; } },
    { id: 'fortune',  name: 'COIN BONUS',  icon: 'coins',     effect: '+10% COINS',     max: 10, cost: 480,  growth: 1.58, apply: (s, l) => { s.coinMult += 0.1 * l; } },
    { id: 'warmup',   name: 'START COMBO', icon: 'rocket',    effect: '+1 START COMBO', max: 8,  cost: 620,  growth: 1.6,  apply: (s, l) => { s.comboStart += l; } },
    { id: 'overtime', name: 'START TIME',  icon: 'stopwatch', effect: '+0.5s TIME',     max: 8,  cost: 760,  growth: 1.64, apply: (s, l) => { s.timeBonus += 0.5 * l; } },
    { id: 'reflex',   name: 'TRIGGER',     icon: 'chevrons',  effect: '-5% FIRE DELAY', max: 6,  cost: 900,  growth: 1.7,  apply: (s, l) => { s.fireRate *= Math.pow(0.95, l); } }
];

export function perkCost (perk: Perk, level: number): number
{
    return Math.round(perk.cost * Math.pow(perk.growth, level));
}

export interface Meta
{
    coins: number;
    rank: number;
    best: number;
    bestLevel: number;
    perks: Record<string, number>;
    muted: boolean;
    /** Consumables in the bag, by boost id. */
    boosts: Record<string, number>;
    /** Which run boosts go into the next run. Emptied as they are spent. */
    armed: Record<string, boolean>;
    /** Target skins bought. The standard one is never not owned. */
    skins: string[];
    /** The skin currently on the board. */
    skin: string;
}

const SAVE_KEY = 'aimer.save.v1';

function emptyMeta (): Meta
{
    return {
        coins: 0, rank: 0, best: 0, bestLevel: 0, perks: {}, muted: false,
        boosts: {}, armed: {}, skins: [ DEFAULT_SKIN.id ], skin: DEFAULT_SKIN.id
    };
}

/**
 * Keeps a saved bag honest: no negatives, no strings, no NaN, and nothing for
 * an id this build does not sell. A boost that is retired stops taking up room
 * in the save the next time the game loads rather than riding along for ever.
 */
function counts (raw: unknown): Record<string, number>
{
    const out: Record<string, number> = {};

    if (!raw || typeof raw !== 'object') return out;

    for (const [ id, n ] of Object.entries(raw as Record<string, unknown>))
    {
        if (!BOOST_BY_ID[id]) continue;

        const v = Math.min(BOOST_BY_ID[id].max, Math.floor(Number(n)));

        if (v > 0) out[id] = v;
    }

    return out;
}

function load (): Meta
{
    try
    {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return emptyMeta();

        const parsed = JSON.parse(raw) as Partial<Meta>;

        //  A save written before skins and boosts existed is still a save: the
        //  new shelves simply start empty, and the standard skin is the one
        //  every player already owns.
        const owned = Array.isArray(parsed.skins) ? parsed.skins.filter(id => !!SKIN_BY_ID[id]) : [];

        if (owned.indexOf(DEFAULT_SKIN.id) === -1) owned.unshift(DEFAULT_SKIN.id);

        const skin = parsed.skin && owned.indexOf(parsed.skin) !== -1 ? parsed.skin : DEFAULT_SKIN.id;

        const armed: Record<string, boolean> = {};

        if (parsed.armed && typeof parsed.armed === 'object')
        {
            for (const id in parsed.armed) if (BOOST_BY_ID[id]) armed[id] = !!parsed.armed[id];
        }

        return {
            coins: Number(parsed.coins) || 0,
            rank: Number(parsed.rank) || 0,
            best: Number(parsed.best) || 0,
            bestLevel: Number(parsed.bestLevel) || 0,
            perks: parsed.perks && typeof parsed.perks === 'object' ? parsed.perks : {},
            muted: !!parsed.muted,
            boosts: counts(parsed.boosts),
            armed,
            skins: owned,
            skin
        };
    }
    catch
    {
        return emptyMeta();
    }
}

export const meta: Meta = load();

export function saveMeta (): void
{
    try
    {
        localStorage.setItem(SAVE_KEY, JSON.stringify(meta));
    }
    catch
    {
        //  Private browsing / storage disabled -- the game still plays fine.
    }
}

/** State for the current run. Reset when a new run starts. */
export class Run
{
    level = 1;
    score = 0;
    coinsEarned = 0;
    xpEarned = 0;
    bestCombo = 0;
    kills = 0;
    /**
     * The rank ladder, and the only thing that hands out upgrades now. XP is
     * banked towards `xpNeed`; every time it tops out the run owes the player
     * a card, which the play scene deals the next frame it is safe to.
     */
    rank = 1;
    xp = 0;
    /** Ranks earned whose card has not been shot yet. Survives a level end. */
    owed = 0;
    /** Ranks gained since the last card, purely so the banner can say "x2". */
    burst = 0;
    taken: Record<string, number> = {};
    /**
     * The consumables spent on this run, and in force until it ends. Filled in
     * from the armed shelf of the store the moment PLAY is pressed.
     */
    boosts: string[] = [];
    /**
     * Zones whose rule has already introduced itself this run. A player who
     * dies on the first level of a zone and retries has already watched the
     * demonstration; making them watch it again is the exact friction the
     * intro exists to remove.
     */
    zonesSeen: Record<number, boolean> = {};
    /**
     * Hazards already demonstrated this run, by signature. Kept apart from the
     * zones because a hazard no longer arrives with a zone -- glass turns up
     * halfway through the skyline and concrete halfway through the storm --
     * and because the same threat is reused by later zones, which must not
     * stop to explain it a second time.
     */
    hazardsSeen: Record<string, boolean> = {};

    reset (): void
    {
        this.level = 1;
        this.score = 0;
        this.coinsEarned = 0;
        this.xpEarned = 0;
        this.bestCombo = 0;
        this.kills = 0;
        this.rank = 1;
        this.xp = 0;
        this.owed = 0;
        this.burst = 0;
        this.taken = {};
        this.zonesSeen = {};
        this.hazardsSeen = {};
        this.boosts = [];
    }

    /** True when a boost was paid for on the way into this run. */
    has (id: string): boolean
    {
        return this.boosts.indexOf(id) !== -1;
    }

    take (id: string): void
    {
        this.taken[id] = (this.taken[id] || 0) + 1;
    }

    /** XP to leave the current rank. */
    get xpNeed (): number
    {
        return xpForRank(this.rank);
    }

    /** How far along the current rank is, 0..1. */
    get xpFrac (): number
    {
        return Math.min(1, this.xp / Math.max(1, this.xpNeed));
    }

    /**
     * Banks XP and cashes in every rank it paid for. Returns how many ranks
     * came out of it, so the caller can make as much noise as it deserves.
     *
     * The loop is deliberate rather than a single divide: a boss kill can be
     * worth two ranks at once late on, and each of them has to cost the price
     * of *its* rank, not the price of the one the player started the kill at.
     */
    addXp (n: number): number
    {
        if (n <= 0) return 0;

        this.xp += n;
        this.xpEarned += n;

        let gained = 0;

        while (this.xp >= this.xpNeed)
        {
            this.xp -= this.xpNeed;
            this.rank += 1;
            this.owed += 1;
            gained += 1;
        }

        this.burst += gained;

        return gained;
    }

    /** Number of upgrade picks made so far. */
    get picks (): number
    {
        let n = 0;
        for (const id in this.taken) n += this.taken[id];
        return n;
    }

    stats (): Stats
    {
        const s = baseStats();

        for (const p of PERKS)
        {
            const lvl = meta.perks[p.id] || 0;
            if (lvl > 0) p.apply(s, lvl);
        }

        for (const id of this.boosts)
        {
            const boost = BOOST_BY_ID[id];
            if (boost && boost.apply) boost.apply(s);
        }

        for (const id in this.taken)
        {
            const up = UPGRADE_BY_ID[id];
            if (!up) continue;
            for (let i = 0; i < this.taken[id]; i++) up.apply(s);
        }

        //  The ladder compounds: the rank itself and every part already bolted
        //  on push XP up a little, so a run that is going well keeps ranking
        //  up at the same rate even as the levels get twice as long.
        s.xpMult += rankXpBonus(this.rank) + pickXpBonus(this.picks);

        //  Safety rail: base damage always tracks target health, so a plain
        //  target is always a one-tap kill and upgrades are pure upside.
        s.damage *= unitHp(this.level) / unitHp(1);
        s.fireRate = Math.max(55, s.fireRate);
        s.crit = Math.min(1, s.crit);

        return s;
    }
}

export const run = new Run();

export function bankCoins (n: number): void
{
    meta.coins = Math.max(0, Math.round(meta.coins + n));
}

//  ------------------------------------------------------------------ store

/** How many of a consumable are in the bag. */
export function boostCount (id: string): number
{
    return meta.boosts[id] || 0;
}

/** Buys one, if it can be paid for and the bag has room. Saves on success. */
export function buyBoost (boost: Boost): boolean
{
    if (boostCount(boost.id) >= boost.max) return false;
    if (meta.coins < boost.cost) return false;

    meta.coins -= boost.cost;
    meta.boosts[boost.id] = boostCount(boost.id) + 1;

    //  A boost is bought to be used, so the first one bought arms itself. The
    //  player who wants to bank it can still switch it off.
    if (boost.use === 'run' && meta.boosts[boost.id] === 1) meta.armed[boost.id] = true;

    saveMeta();
    return true;
}

/** Spends one out of the bag. False when there was none to spend. */
export function spendBoost (id: string): boolean
{
    const n = boostCount(id);

    if (n <= 0) return false;

    if (n === 1) delete meta.boosts[id];
    else meta.boosts[id] = n - 1;

    if (!meta.boosts[id]) delete meta.armed[id];

    saveMeta();
    return true;
}

export function isArmed (id: string): boolean
{
    return !!meta.armed[id] && boostCount(id) > 0;
}

/** Flips a run boost in or out of the next run's loadout. */
export function toggleArmed (id: string): boolean
{
    const on = !isArmed(id) && boostCount(id) > 0;

    if (on) meta.armed[id] = true;
    else delete meta.armed[id];

    saveMeta();
    return on;
}

/** The armed run boosts, in store order. */
export function armedBoosts (): Boost[]
{
    return BOOSTS.filter(b => b.use === 'run' && isArmed(b.id));
}

/**
 * Pays for the loadout and hands it to the run. Called once, by PLAY -- the
 * coins were spent in the store, but the consumable itself is spent here, so
 * backing out of the menu never costs a player anything.
 */
export function armRun (): void
{
    run.boosts = [];

    for (const boost of armedBoosts())
    {
        if (spendBoost(boost.id)) run.boosts.push(boost.id);
    }
}

export function ownsSkin (id: string): boolean
{
    return meta.skins.indexOf(id) !== -1;
}

/** Buys a skin and wears it immediately. Nobody buys a skin to look at it. */
export function buySkin (skin: TargetSkin): boolean
{
    if (ownsSkin(skin.id)) return false;
    if (meta.coins < skin.cost) return false;

    meta.coins -= skin.cost;
    meta.skins.push(skin.id);
    meta.skin = skin.id;
    saveMeta();

    return true;
}

export function equipSkin (id: string): boolean
{
    if (!ownsSkin(id) || meta.skin === id) return false;

    meta.skin = id;
    saveMeta();

    return true;
}

/** The skin the board is wearing right now. */
export function equippedSkin (): TargetSkin
{
    return SKIN_BY_ID[meta.skin] || DEFAULT_SKIN;
}
