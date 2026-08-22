import { baseStats, Stats, UPGRADE_BY_ID } from '../data/upgrades';
import { pickXpBonus, rankXpBonus, xpForRank } from '../data/rank';
import { unitHp } from '../data/levels';
import { BOOST_BY_ID, BOOSTS, Boost } from '../data/boosts';
import { DEFAULT_SKIN, SKINS, SKIN_BY_ID, SkinGroup, TargetSkin } from '../data/skins';

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
    /** Runs finished, ever. The mystery present is paced off this. */
    runs: number;
    /** Presents earned and not yet opened. */
    gifts: number;
    /** Presents opened, ever. The first one is the guaranteed face. */
    opened: number;
    /** Local day index the daily present was last claimed on. -1 = never. */
    dailyDay: number;
    /** Days claimed back to back, including today's. */
    dailyStreak: number;
}

const SAVE_KEY = 'aimer.save.v1';

function emptyMeta (): Meta
{
    return {
        coins: 0, rank: 0, best: 0, bestLevel: 0, perks: {}, muted: false,
        boosts: {}, armed: {}, skins: [ DEFAULT_SKIN.id ], skin: DEFAULT_SKIN.id,
        runs: 0, gifts: 0, opened: 0, dailyDay: -1, dailyStreak: 0
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
            skin,
            //  A save from before presents existed has finished runs it was
            //  never paid for. It keeps them -- the counter is what paces the
            //  next present, not a debt -- and gets its first one at the end
            //  of the very next run it plays.
            runs: Math.max(0, Math.floor(Number(parsed.runs)) || 0),
            gifts: Math.max(0, Math.floor(Number(parsed.gifts)) || 0),
            opened: Math.max(0, Math.floor(Number(parsed.opened)) || 0),
            //  A save from before the daily present has never claimed one, so
            //  it is owed one the moment it next opens the menu.
            dailyDay: Number.isFinite(Number(parsed.dailyDay)) ? Math.floor(Number(parsed.dailyDay)) : -1,
            dailyStreak: Math.max(0, Math.floor(Number(parsed.dailyStreak)) || 0)
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

//  ------------------------------------------------------------------ gifts

/**
 * How often a mystery present turns up after the first one.
 *
 * The first present is the point of the whole machine: a player who has just
 * finished one run has seen the loop and nothing they own, and the thing that
 * brings them back is a face on the board that is *theirs*. So run one always
 * pays, and after that a present is three runs away -- close enough that the
 * counter under PLAY is worth watching, far enough that the box stays an event.
 */
export const GIFT_EVERY = 3;

/**
 * Books a finished run and says whether it earned a present. Called once, by
 * the results card, which is the one screen every run ends on.
 */
export function noteRunEnded (): boolean
{
    meta.runs += 1;

    const earned = meta.runs === 1 || (meta.runs - 1) % GIFT_EVERY === 0;

    if (earned) meta.gifts += 1;

    saveMeta();

    return earned;
}

export function giftsPending (): number
{
    return meta.gifts;
}

/** Runs left before the next present. Zero while one is already waiting. */
export function runsToNextGift (): number
{
    if (meta.gifts > 0) return 0;
    if (meta.runs < 1) return 1;

    return GIFT_EVERY - ((meta.runs - 1) % GIFT_EVERY);
}

/** True the first time a present is opened -- the guaranteed face. */
export function isFirstGift (): boolean
{
    return meta.opened === 0;
}

/** Spends one present. False when there was none waiting. */
export function takeGift (): boolean
{
    if (meta.gifts <= 0) return false;

    meta.gifts -= 1;
    meta.opened += 1;
    saveMeta();

    return true;
}

/** Books an extra present -- what the rewarded video on the reel pays out. */
export function addGift (n = 1): void
{
    meta.gifts += n;
    saveMeta();
}

/**
 * Puts a skin in the wardrobe and wears it. Nothing is charged: this is the
 * present's doing, not the store's, and a gift the player has to go and equip
 * is a gift they never see.
 */
export function grantSkin (id: string): boolean
{
    if (!SKIN_BY_ID[id] || ownsSkin(id)) return false;

    meta.skins.push(id);
    meta.skin = id;
    saveMeta();

    return true;
}

/** Drops boosts in the bag, up to what it holds. Returns how many fitted. */
export function grantBoost (id: string, n: number): number
{
    const boost = BOOST_BY_ID[id];

    if (!boost || n <= 0) return 0;

    const before = boostCount(id);
    const after = Math.min(boost.max, before + n);

    if (after === before) return 0;

    meta.boosts[id] = after;

    //  Same courtesy the store does: the first one a player owns arms itself,
    //  so a gifted run boost is in the next run without a second decision.
    if (boost.use === 'run' && before === 0) meta.armed[id] = true;

    saveMeta();

    return after - before;
}

/** Skins the player does not own yet, optionally from one shelf. */
export function unownedSkins (group?: SkinGroup): TargetSkin[]
{
    return SKINS.filter(s => s.cost > 0 && !ownsSkin(s.id) && (!group || s.group === group));
}

//  ------------------------------------------------------------- daily gift

/**
 * The present that is paid for in days rather than runs.
 *
 * The mystery box asks for three runs; this one asks for nothing at all except
 * that the player come back tomorrow. That is the whole point of it -- it is
 * the only reward in the game that is waiting *before* the first shot, so the
 * menu always has something on it worth opening the app for.
 *
 * The day is the player's own local day, not twenty-four hours from the last
 * claim: a rolling timer punishes somebody who plays at eight one evening and
 * seven the next, and midnight is the boundary everybody already understands.
 */

const DAY_MS = 86400000;

/** Which local day it is, as a whole number of days since the epoch. */
function dayIndex (at = Date.now()): number
{
    return Math.floor((at - new Date(at).getTimezoneOffset() * 60000) / DAY_MS);
}

/** True when today's present has not been opened yet. */
export function dailyReady (): boolean
{
    return meta.dailyDay !== dayIndex();
}

/** Milliseconds until the next local midnight, when the next one lands. */
export function msToNextDaily (): number
{
    if (dailyReady()) return 0;

    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

    return Math.max(0, midnight - now.getTime());
}

/**
 * Books today's present and returns the streak it lands on, counting today.
 *
 * A day missed drops the streak back to one rather than to zero: the player
 * who comes back after a week away is on day one of a new run of days, not
 * on nothing, and the button says so.
 */
export function claimDaily (): number
{
    const today = dayIndex();

    if (meta.dailyDay === today) return meta.dailyStreak;

    meta.dailyStreak = meta.dailyDay === today - 1 ? meta.dailyStreak + 1 : 1;
    meta.dailyDay = today;
    saveMeta();

    return meta.dailyStreak;
}

/** Days claimed back to back. Zero before the first one is ever opened. */
export function dailyStreak (): number
{
    return meta.dailyStreak;
}

//  ------------------------------------------------------------------ perks

export function perkLevel (id: string): number
{
    return meta.perks[id] || 0;
}

/** Permanent upgrades with a level still to give. */
export function upgradablePerks (): Perk[]
{
    return PERKS.filter(p => perkLevel(p.id) < p.max);
}

/**
 * Hands over levels of a permanent upgrade, free, up to its ceiling. Returns
 * how many actually went on, so a present can say what it really paid.
 */
export function grantPerk (id: string, n = 1): number
{
    const perk = PERKS.find(p => p.id === id);

    if (!perk || n <= 0) return 0;

    const before = perkLevel(id);
    const after = Math.min(perk.max, before + n);

    if (after === before) return 0;

    meta.perks[id] = after;
    saveMeta();

    return after - before;
}
