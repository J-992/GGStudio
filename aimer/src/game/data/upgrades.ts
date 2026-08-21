export interface Stats
{
    /** Damage per shot before crit. */
    damage: number;
    /** Milliseconds between shots. */
    fireRate: number;
    crit: number;
    critMult: number;
    /** Extra auto-aimed tracers per tap. */
    multishot: number;
    /** Extra targets hit along the beam line. */
    pierce: number;
    explodeChance: number;
    explodeRadius: number;
    /** Lightning jumps after a kill. */
    chain: number;
    coinMult: number;
    flatCoins: number;
    xpMult: number;
    scoreMult: number;
    /** Milliseconds a combo survives without a hit. */
    comboWindow: number;
    /** Multiplier applied to streak bonuses. */
    comboMult: number;
    comboStart: number;
    /** Tap forgiveness -- multiplier on target radius. */
    hitRadius: number;
    /** Multiplier on target movement speed. */
    slow: number;
    /** Extra seconds added to every level. */
    timeBonus: number;
    /** Chance of double coins/xp on a kill. */
    lucky: number;
    /** Bonus score multiplier for dead-centre hits. */
    perfect: number;
    /** 0..1 -- how much of the combo loss on a miss is cancelled. */
    steady: number;
}

export function baseStats (): Stats
{
    return {
        damage: 16,
        fireRate: 150,
        crit: 0.05,
        critMult: 2,
        multishot: 0,
        pierce: 0,
        explodeChance: 0,
        explodeRadius: 92,
        chain: 0,
        coinMult: 1,
        flatCoins: 0,
        xpMult: 1,
        scoreMult: 1,
        comboWindow: 1850,
        comboMult: 1,
        comboStart: 0,
        hitRadius: 1.18,
        slow: 1,
        timeBonus: 0,
        lucky: 0,
        perfect: 0,
        steady: 0
    };
}

export interface Upgrade
{
    id: string;
    name: string;
    /** Icon texture name (see core/icons). */
    icon: string;
    effect: string;
    color: number;
    max: number;
    weight: number;
    /** Only appears from this level onwards. */
    from?: number;
    apply: (s: Stats) => void;
}

/**
 * The cards.
 *
 * MULTI SHOT and CHAIN are deliberately the two shortest ladders on the board.
 * Both of them kill things the player did not aim at, and a stack of five of
 * either turned a tap into a clear -- at which point the game is no longer an
 * aim trainer, it is a cursor being dragged over a field of confetti. Three is
 * enough for the upgrade to be a build; five was enough for it to be the only
 * build. Neither of them may touch a welded chain at all: see GameScene, where
 * that rule is enforced.
 */
export const UPGRADES: Upgrade[] = [
    { id: 'rapid',   name: 'RAPID FIRE',  icon: 'bullet',    effect: '-15% FIRE DELAY', color: 0xff8a3d, max: 8, weight: 10, apply: s => { s.fireRate *= 0.85; } },
    { id: 'power',   name: 'POWER',       icon: 'damage',    effect: '+30% DAMAGE',     color: 0xff5470, max: 9, weight: 10, apply: s => { s.damage *= 1.30; } },
    { id: 'crit',    name: 'CRIT',        icon: 'crosshair', effect: '+12% CRIT',       color: 0xffd23f, max: 7, weight: 9,  apply: s => { s.crit += 0.12; } },
    { id: 'critdmg', name: 'CRIT DMG',    icon: 'burst',     effect: '+70% CRIT DMG',   color: 0xff7a3d, max: 8, weight: 8,  from: 3, apply: s => { s.critMult += 0.7; } },
    { id: 'multi',   name: 'MULTI SHOT',  icon: 'trident',   effect: '+1 EXTRA SHOT',   color: 0x3fe0ff, max: 3, weight: 5,  from: 3, apply: s => { s.multishot += 1; } },
    { id: 'pierce',  name: 'PIERCE',      icon: 'arrow',     effect: '+1 PIERCE',       color: 0x7dff6b, max: 5, weight: 6,  from: 4, apply: s => { s.pierce += 1; } },
    { id: 'boom',    name: 'BOOM',        icon: 'bomb',      effect: '+22% EXPLODE',    color: 0xff4d3d, max: 5, weight: 7,  from: 3, apply: s => { s.explodeChance += 0.22; } },
    { id: 'blast',   name: 'BLAST',       icon: 'wave',      effect: '+35 BLAST SIZE',  color: 0x4fd6ff, max: 6, weight: 5,  from: 5, apply: s => { s.explodeRadius += 35; } },
    { id: 'chain',   name: 'CHAIN',       icon: 'bolt',      effect: '+1 CHAIN JUMP',   color: 0xfff05c, max: 3, weight: 5,  from: 5, apply: s => { s.chain += 1; } },
    { id: 'greed',   name: 'GREED',       icon: 'coins',     effect: '+35% COINS',      color: 0xffc857, max: 8, weight: 8,  apply: s => { s.coinMult += 0.35; } },
    { id: 'payout',  name: 'PAYOUT',      icon: 'coinplus',  effect: '+3 COINS / KILL', color: 0xffb020, max: 8, weight: 7,  apply: s => { s.flatCoins += 3; } },
    { id: 'xp',      name: 'XP BOOST',    icon: 'star',      effect: '+50% XP',         color: 0x9b6cff, max: 8, weight: 11, apply: s => { s.xpMult += 0.5; } },
    { id: 'score',   name: 'SCORE',       icon: 'chart',     effect: '+25% SCORE',      color: 0x6cf5c8, max: 9, weight: 9,  apply: s => { s.scoreMult += 0.25; } },
    { id: 'window',  name: 'COMBO TIME',  icon: 'hourglass', effect: '+25% COMBO TIME', color: 0x62ffb8, max: 6, weight: 8,  apply: s => { s.comboWindow *= 1.25; } },
    { id: 'combo',   name: 'COMBO POWER', icon: 'link',      effect: '+30% STREAK BONUS', color: 0xff5ce0, max: 8, weight: 9, from: 2, apply: s => { s.comboMult += 0.3; } },
    { id: 'start',   name: 'HEAD START',  icon: 'rocket',    effect: '+3 START COMBO',  color: 0xb388ff, max: 6, weight: 6,  from: 3, apply: s => { s.comboStart += 3; } },
    { id: 'magnet',  name: 'MAGNET',      icon: 'magnet',    effect: '+18% TAP SIZE',   color: 0xff7ae0, max: 5, weight: 8,  apply: s => { s.hitRadius += 0.18; } },
    { id: 'slow',    name: 'SLOW MO',     icon: 'clock',     effect: '-18% TARGET SPEED', color: 0x8fd3ff, max: 5, weight: 6, from: 4, apply: s => { s.slow *= 0.82; } },
    { id: 'time',    name: 'OVERTIME',    icon: 'stopwatch', effect: '+1.5s PER LEVEL', color: 0x62ffb8, max: 6, weight: 7,  apply: s => { s.timeBonus += 1.5; } },
    { id: 'lucky',   name: 'LUCKY',       icon: 'dice',      effect: '+18% DOUBLE LOOT', color: 0x7dff6b, max: 5, weight: 6, from: 4, apply: s => { s.lucky += 0.18; } },
    { id: 'perfect', name: 'PERFECT',     icon: 'sparkle',   effect: '+35% BULLSEYE',   color: 0xfff3b0, max: 6, weight: 6,  from: 3, apply: s => { s.perfect += 0.35; } },
    { id: 'steady',  name: 'STEADY',      icon: 'shield',    effect: '-50% COMBO LOSS', color: 0xa8b4d0, max: 2, weight: 5,  from: 3, apply: s => { s.steady = Math.min(1, s.steady + 0.5); } }
];

export const UPGRADE_BY_ID: Record<string, Upgrade> =
    Object.fromEntries(UPGRADES.map(u => [ u.id, u ]));

/** Three distinct offers, weighted, respecting max stacks and unlock levels. */
export function rollOffers (taken: Record<string, number>, level: number, count = 3): Upgrade[]
{
    const picks: Upgrade[] = [];
    const bag = UPGRADES.filter(u => (taken[u.id] || 0) < u.max && level >= (u.from || 1));

    while (picks.length < count && bag.length > 0)
    {
        let total = 0;
        for (const u of bag) total += u.weight;

        let roll = Math.random() * total;
        let idx = bag.length - 1;

        for (let i = 0; i < bag.length; i++)
        {
            roll -= bag[i].weight;
            if (roll <= 0) { idx = i; break; }
        }

        picks.push(bag[idx]);
        bag.splice(idx, 1);
    }

    return picks;
}
