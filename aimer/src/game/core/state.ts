import { baseStats, Stats, UPGRADE_BY_ID } from '../data/upgrades';
import { unitHp } from '../data/levels';

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
    { id: 'power',    name: 'GUN POWER',   icon: 'damage',    effect: '+7% DAMAGE',     max: 10, cost: 220, growth: 1.55, apply: (s, l) => { s.damage *= 1 + 0.07 * l; } },
    { id: 'fortune',  name: 'COIN BONUS',  icon: 'coins',     effect: '+10% COINS',     max: 10, cost: 200, growth: 1.5,  apply: (s, l) => { s.coinMult += 0.1 * l; } },
    { id: 'warmup',   name: 'START COMBO', icon: 'rocket',    effect: '+1 START COMBO', max: 8,  cost: 260, growth: 1.5,  apply: (s, l) => { s.comboStart += l; } },
    { id: 'overtime', name: 'START TIME',  icon: 'stopwatch', effect: '+0.5s TIME',     max: 8,  cost: 300, growth: 1.55, apply: (s, l) => { s.timeBonus += 0.5 * l; } },
    { id: 'reflex',   name: 'TRIGGER',     icon: 'chevrons',  effect: '-5% FIRE DELAY', max: 6,  cost: 340, growth: 1.6,  apply: (s, l) => { s.fireRate *= Math.pow(0.95, l); } }
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
}

const SAVE_KEY = 'aimer.save.v1';

function emptyMeta (): Meta
{
    return { coins: 0, rank: 0, best: 0, bestLevel: 0, perks: {}, muted: false };
}

function load (): Meta
{
    try
    {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return emptyMeta();

        const parsed = JSON.parse(raw) as Partial<Meta>;

        return {
            coins: Number(parsed.coins) || 0,
            rank: Number(parsed.rank) || 0,
            best: Number(parsed.best) || 0,
            bestLevel: Number(parsed.bestLevel) || 0,
            perks: parsed.perks && typeof parsed.perks === 'object' ? parsed.perks : {},
            muted: !!parsed.muted
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
    taken: Record<string, number> = {};

    reset (): void
    {
        this.level = 1;
        this.score = 0;
        this.coinsEarned = 0;
        this.xpEarned = 0;
        this.bestCombo = 0;
        this.kills = 0;
        this.taken = {};
    }

    take (id: string): void
    {
        this.taken[id] = (this.taken[id] || 0) + 1;
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

        for (const id in this.taken)
        {
            const up = UPGRADE_BY_ID[id];
            if (!up) continue;
            for (let i = 0; i < this.taken[id]; i++) up.apply(s);
        }

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
