/**
 * The thing standing in the door at the end of every world.
 *
 * A zone used to end the way it began: on another level of the same board,
 * with the same spawn table, and the only sign the player had finished a place
 * was that the next set of doors opened onto a different colour. Three of the
 * forty levels had a boss on them, they were all the same boss, and all three
 * were the same fight -- a very large circle that took a very large number of
 * identical taps.
 *
 * Every world now ends on one, and no two of them are killed the same way.
 * That is the whole design rule here: a boss is the *exam* for the world it
 * closes, so it asks for the verb that world spent four or five levels
 * teaching, and it asks for it with nothing else on the board.
 *
 *   3   THE BRUTE      range     nothing but health. The range taught tapping,
 *                                so the range's exam is tapping -- but a lot of
 *                                it, at one thing, which is the first time the
 *                                game has asked the player to stay on a target
 *                                instead of answering the board.
 *   7   THE SERPENT    skyline   the zone's welded chains, grown into one long
 *                                snake that swims. Head to tail, in order, on a
 *                                body that will not hold still.
 *   12  THE BUNKER     storm     a core inside a turning ring of concrete and
 *                                glass. Concrete never opens; glass opens if you
 *                                spend shots on it; the gaps come round on their
 *                                own. Aiming *around* cover is the storm's verb.
 *   19  THE PHANTOM    magma     it will not be where you left it. Every band of
 *                                health it loses, it goes somewhere else, and it
 *                                cannot be touched while it is in the air.
 *   27  THE CORE       reactor   shutters that only open between its own salvos.
 *                                It shoots first and is vulnerable second, so the
 *                                fight is fought on its clock and not yours.
 *   33  THE AEGIS      orbit     two plates turning opposite ways around one
 *                                body. There is always a gap and it is never in
 *                                the same place twice.
 *   40  THE HYDRA      crimson   it splits, exactly as its world does. Break it
 *                                and you have two problems, break those and you
 *                                have four, and all of them have to go.
 *
 * The numbers here are in *units* rather than in damage, for the same reason
 * the rest of the game is (see `unitHp` in data/levels): a unit is one tap
 * from a stock gun at any level of the run, so `units` reads directly as "how
 * many taps is this fight" and stays honest as the player's gun grows.
 */

export type BossMech = 'brute' | 'serpent' | 'bunker' | 'phantom' | 'core' | 'aegis' | 'hydra';

/** One arc of a turning ring: steel never opens, glass opens if you pay. */
export interface RingSpec
{
    /** How many arcs, spread evenly, and how much of the circle each covers. */
    count: number;
    /** Arc width as a fraction of the gap between arc centres. Under 1 leaves gaps. */
    cover: number;
    /** Radians per second. Sign is direction. */
    spin: number;
    /** Ring radius as a multiple of the boss's own radius. */
    reach: number;
    /**
     * How many of the arcs are glass rather than steel, spread evenly around
     * the ring. Steel never opens and glass opens if the player spends shots
     * on it, so this number is the fight's "can I make my own luck" dial: at
     * zero the ring is a rhythm to be waited out, and above zero waiting is
     * only ever one of the two answers.
     */
    glass: number;
    /** Shots one glass arc eats before it shatters. */
    hp: number;
    /** Milliseconds before a shattered arc comes back. */
    respawn: number;
    /** A second ring, turning the other way. */
    counter?: RingSpec;
}

export interface BossSpec
{
    /** The level this fight closes a world on. */
    level: number;
    mech: BossMech;
    /** Shown on the warning card, and over its head when it lands. */
    name: string;
    /** One line, under the name: what the player is supposed to *do*. */
    tell: string;
    /** Health in units -- one unit is one tap from a stock gun. See above. */
    units: number;
    /** Body size, as a multiple of the level's normal target radius. */
    size: number;
    /** Pixels per second the body moves, if its mechanic moves it. */
    speed: number;
    /**
     * Wear the board's own paint instead of the boss red.
     *
     * Six of the seven are objects the world has never shown the player before
     * and the red says so. The brute is the opposite: it is the range's exam,
     * and the range has taught exactly one thing -- tap the target -- so its
     * boss is deliberately *the target*, in the zone's colour and the player's
     * equipped skin, at four times the size. Painting the first boss in the
     * run a colour nothing else on the board has ever been would have made it
     * look like a new rule, and it is emphatically not a new rule.
     */
    skinned?: boolean;
    /** Coins paid for the kill, on top of everything the kill scores. */
    bounty: number;

    //  --- per-mechanic dials. Every one of these is inert when unused. ---

    /** serpent: how many links the snake is made of. */
    links?: number;
    /** bunker, core, aegis: the ring standing between the gun and the body. */
    ring?: RingSpec;
    /** phantom: how many bands of health it survives, and how long a blink takes. */
    bands?: number;
    blinkMs?: number;
    /**
     * brute: how much of its build size is left when it is nearly dead, and the
     * share of health at which it stops standing there and starts running.
     */
    shrinkTo?: number;
    runsAt?: number;
    /** core: the shutter's rhythm -- shut for this long, then open for this long. */
    shutMs?: number;
    openMs?: number;
    /** core: what it fires while it is shut. */
    salvo?: number;
    /** hydra: how many heads each break leaves, and how many times it may split. */
    heads?: number;
    generations?: number;
}

/**
 * A ring of steel with gaps in it, turning slowly. The storm's exam.
 *
 * Five arcs at 62% cover leaves five gaps of about twenty degrees each, which
 * is narrow enough that the player has to wait for one and wide enough that
 * waiting is never long. Two of the five are glass, so a player who does not
 * want to wait can buy a gap instead -- which is the choice the whole fight is
 * about.
 */
const BUNKER_RING: RingSpec = {
    count: 5, cover: 0.62, spin: 0.55, reach: 2.05, glass: 2, hp: 4, respawn: 5200
};

export const BOSSES: BossSpec[] = [
    {
        //  It comes apart as it goes: every single hit takes a bite out of it,
        //  so the player can see the whole fight's progress in the *shape* of
        //  the thing rather than only in the number on its face -- and the
        //  bite is the reward for the one thing this fight asks, which is
        //  another tap. Halfway down it stops being a wall and starts being a
        //  target: small, quick, and suddenly worth aiming at.
        level: 3, mech: 'brute', name: 'THE BRUTE', tell: 'IT ONLY UNDERSTANDS VOLUME.',
        units: 44, size: 2.6, speed: 132, bounty: 200,
        skinned: true, shrinkTo: 0.3, runsAt: 0.5
    },
    {
        //  Quick enough to cross the board. At the crawl it started on it
        //  toured about a third of the arena in a fight and spent most of that
        //  in one half of it, which is a snake the player waits for rather than
        //  one they have to keep up with.
        level: 7, mech: 'serpent', name: 'THE SERPENT', tell: 'HEAD FIRST. IT WILL NOT WAIT.',
        units: 0, size: 1.0, speed: 240, bounty: 240, links: 9
    },
    {
        level: 12, mech: 'bunker', name: 'THE BUNKER', tell: 'SHOOT THE GAPS, OR MAKE ONE.',
        //  It walks, slowly. The gun never moves, so the angle a shot arrives
        //  at is decided entirely by where the *boss* is -- a bunker that stood
        //  still would have turned the fight into one fixed bearing and a
        //  metronome, with nothing for the player to do but time it.
        units: 52, size: 2.2, speed: 38, bounty: 380, ring: BUNKER_RING
    },
    {
        level: 19, mech: 'phantom', name: 'THE PHANTOM', tell: 'IT WILL NOT BE WHERE YOU LEFT IT.',
        units: 46, size: 2.0, speed: 54, bounty: 540, bands: 5, blinkMs: 620
    },
    {
        level: 27, mech: 'core', name: 'THE CORE', tell: 'IT IS ONLY OPEN AFTER IT FIRES.',
        units: 54, size: 2.3, speed: 0, bounty: 760,
        shutMs: 2600, openMs: 1700, salvo: 3,
        //  A cover above 1 is a ring with no gaps at all: while the core is
        //  shut there is no angle that reaches it, and the shutters pulling
        //  back are the only thing that ever lets a shot in.
        ring: { count: 4, cover: 1.02, spin: 0.5, reach: 1.95, glass: 0, hp: 0, respawn: 0 }
    },
    {
        level: 33, mech: 'aegis', name: 'THE AEGIS', tell: 'TWO PLATES. ONE GAP. KEEP MOVING.',
        units: 58, size: 2.2, speed: 44, bounty: 980,
        //  Two plates each, not three, and each ring left open a little over
        //  half the time: a shot has to find a gap in *both* at once, so the
        //  openness the player actually feels is the product of the two. Wider
        //  plates than this multiply out to a fight that is shut more often
        //  than it is open, which reads as a broken boss rather than a hard one.
        ring: {
            count: 2, cover: 0.46, spin: 0.85, reach: 1.9, glass: 0, hp: 0, respawn: 0,
            counter: { count: 2, cover: 0.44, spin: -1.35, reach: 2.35, glass: 0, hp: 0, respawn: 0 }
        }
    },
    {
        level: 40, mech: 'hydra', name: 'THE HYDRA', tell: 'BREAKING IT IS NOT KILLING IT.',
        units: 34, size: 2.4, speed: 60, bounty: 1500, heads: 2, generations: 2
    }
];

const BY_LEVEL: Record<number, BossSpec> = {};
for (const b of BOSSES) BY_LEVEL[b.level] = b;

export function bossFor (level: number): BossSpec | null
{
    return BY_LEVEL[level] || null;
}

export function isBossLevel (level: number): boolean
{
    return !!BY_LEVEL[level];
}
