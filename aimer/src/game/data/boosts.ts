import { Stats } from './upgrades';

/**
 * A boost is a one-run consumable, bought with the same coins as a permanent
 * perk and spent the moment it is used up. Perks are the ladder the player
 * climbs over a hundred runs; boosts are the shove they buy for *this* one.
 *
 *   'run'  -- armed in the store and spent when PLAY is pressed. It lasts the
 *             whole run, and the loadout strip under PLAY says so.
 *   'held' -- sits in the bag until the game asks for it: the extra life when
 *             the clock runs out, the skip on the way into a level.
 */
export type BoostUse = 'run' | 'held';

export interface Boost
{
    id: string;
    name: string;
    /** Icon texture name (see core/icons). */
    icon: string;
    /** What it does, in the player's words. */
    blurb: string;
    color: number;
    cost: number;
    use: BoostUse;
    /** How many of them the bag holds. */
    max: number;
    /** Stat effect, for the run boosts that are a number rather than a thing. */
    apply?: (s: Stats) => void;
}

export const BOOSTS: Boost[] = [
    {
        id: 'wingman',
        name: 'WINGMAN',
        icon: 'trident',
        blurb: 'A 2ND TURRET FIRES ALL RUN',
        color: 0x4fd6ff,
        cost: 1500,
        use: 'run',
        max: 9
    },
    {
        id: 'rush',
        name: 'COIN RUSH',
        icon: 'coins',
        blurb: 'DOUBLE COINS ALL RUN',
        color: 0xffc857,
        cost: 800,
        use: 'run',
        max: 9,
        apply: s => { s.coinMult += 1; }
    },
    {
        id: 'slowmo',
        name: 'SLOW MO',
        icon: 'clock',
        blurb: '-30% TARGET SPEED ALL RUN',
        color: 0x8fd3ff,
        cost: 900,
        use: 'run',
        max: 9,
        apply: s => { s.slow *= 0.7; }
    },
    {
        id: 'magnet',
        name: 'BIG TAPS',
        icon: 'magnet',
        blurb: '+40% TAP SIZE ALL RUN',
        color: 0xff7ae0,
        cost: 750,
        use: 'run',
        max: 9,
        apply: s => { s.hitRadius += 0.4; }
    },
    {
        id: 'life',
        name: 'EXTRA LIFE',
        icon: 'shield',
        blurb: 'CARRY ON WHEN TIME RUNS OUT',
        color: 0x6cf5c8,
        cost: 1200,
        use: 'held',
        max: 9
    },
    {
        id: 'skip',
        name: 'LEVEL SKIP',
        icon: 'rocket',
        blurb: 'JUMP STRAIGHT PAST A LEVEL',
        color: 0x9b6cff,
        cost: 1700,
        use: 'held',
        max: 9
    }
];

export const BOOST_BY_ID: Record<string, Boost> =
    Object.fromEntries(BOOSTS.map(b => [ b.id, b ]));

/** The ones that are armed before a run rather than spent during one. */
export const RUN_BOOSTS: Boost[] = BOOSTS.filter(b => b.use === 'run');
