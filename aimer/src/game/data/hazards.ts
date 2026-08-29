import { zoneFor } from './zones';
import { isBossLevel } from './bosses';

/**
 * What each zone throws at the player on top of its rule.
 *
 * A zone's *rule* (see data/zones) says how the world behaves. Its *hazard*
 * says what is trying to stop you, and unlike the rule it is not constant
 * across the zone: every level inside a zone turns the same dial a little
 * further, so level 17 is recognisably the same place as level 13 and
 * recognisably worse.
 *
 *   zone 1  range        nothing. The rules are the tutorial.
 *   zone 2  skyline      CHAINS      -- targets arrive welded into ordered
 *                                      runs that can only be broken front to
 *                                      back, and from level 5 there is glass
 *                                      hanging over the board as well.
 *   zone 3  storm        CONCRETE    -- the dark comes and goes, and from
 *                                      level 9 there are slabs in the arena
 *                                      that nothing will ever break.
 *   zone 4  cavern       GLASS       -- armoured panes slide across the arena
 *                                      and eat any shot that crosses them.
 *   zone 5  reactor      FLAK        -- the core shoots back. A bolt that
 *                                      reaches the gun costs you clock.
 *   zone 6  orbitfield   PLATES      -- the shielded targets of the zone's own
 *                                      rule, with one pane of glass for company.
 *   zone 7  crimson      ALL OF IT   -- splitting targets, glass, concrete
 *                                      and flak.
 *
 * A zone is no longer the smallest unit a threat can arrive on. Glass debuts
 * in the middle of zone 2 and concrete in the middle of zone 3, because the
 * run needs a new verb roughly every other level and it has only seven zones
 * to spend. What arrives when is the DEBUTS table at the bottom of this file.
 *
 * Everything here is data. The runtime that acts on it lives in
 * core/hazards.ts, and every field is inert at zero so a zone that wants none
 * of this simply leaves it alone.
 */

/** The one hazard a zone introduces itself with, and demonstrates on entry. */
export type Signature = 'none' | 'fall' | 'chain' | 'glass' | 'concrete' | 'flak';

export interface HazardSpec
{
    signature: Signature;

    //  --- falling targets ---
    /** Share of spawns that drop from the ceiling instead of standing still. */
    fallChance: number;
    /**
     * How long a falling target takes to cross the arena, as a fraction of the
     * lifetime a standing target on the same level would have had.
     *
     * A fall is a deadline like any other, so it is expressed against the
     * deadline the level is already tuned around rather than in pixels per
     * second -- which would have made the same level meaningfully harder on a
     * short wide screen than on a tall one purely because of the drop height.
     */
    fallTime: number;

    //  --- weather dials, read by the backdrop ---
    /** Crosswind strength multiplier. */
    gust: number;
    /** Blackout pacing: >1 means darker for longer, more often. */
    storm: number;

    //  --- ordered chains ---
    /**
     * Share of spawns that arrive as a welded run rather than as one loose
     * target, and how many links are in it.
     */
    chainChance: number;
    chainLen: number;

    //  --- armoured glass ---
    /** How many panes stand in the arena at once. */
    panes: number;
    /** Shots each pane eats before it shatters. */
    paneHp: number;
    /** Fraction of the arena width one pane covers. */
    paneSpan: number;
    /**
     * Fraction of the arena height one pane covers. A pane is a window over a
     * slab of the board, not a rail across it: the targets underneath stay in
     * plain sight and stay unshootable, which is the entire idea.
     */
    paneRise: number;
    /** Sideways drift, px/sec. */
    paneDrift: number;
    /** Milliseconds before a shattered pane is replaced. */
    paneRespawn: number;

    //  --- concrete ---
    /**
     * Slabs that cannot be broken by anything the player will ever own. They
     * take shots and vision both, and the only play against one is to shoot
     * somewhere else.
     */
    blocks: number;
    /** Fraction of the arena width and height one slab covers. */
    blockSpan: number;
    blockRise: number;
    /** Radians of swing either side of the rope. Zero means it just stands there. */
    blockSwing: number;
    /** Milliseconds for one full pass of the swing. */
    blockPeriod: number;

    //  --- incoming fire ---
    /** Milliseconds between salvos. Zero means the core holds its fire. */
    flakEvery: number;
    /** Bolts per salvo. */
    flakSalvo: number;
    /** Bolt speed, px/sec. */
    flakSpeed: number;
    /** Milliseconds of clock a bolt takes off the player when it lands. */
    flakPenalty: number;

    //  --- variations on the zone's own rule ---
    /** Halves left behind by a split kill. */
    splitCount: number;
    /** Milliseconds between repeat warps in the cavern. Zero means warp once. */
    warpEvery: number;
}

function base (): HazardSpec
{
    return {
        signature: 'none',
        fallChance: 0,
        fallTime: 1,
        gust: 1,
        storm: 1,
        chainChance: 0,
        chainLen: 2,
        panes: 0,
        paneHp: 3,
        paneSpan: 0.44,
        paneRise: 0.2,
        paneDrift: 0,
        paneRespawn: 6000,
        blocks: 0,
        blockSpan: 0.22,
        blockRise: 0.2,
        blockSwing: 0,
        blockPeriod: 3600,
        flakEvery: 0,
        flakSalvo: 1,
        flakSpeed: 240,
        flakPenalty: 1200,
        splitCount: 2,
        warpEvery: 0
    };
}

/** Linear ramp across a zone: `a` on its first level, `b` on its last. */
function ramp (t: number, a: number, b: number): number
{
    return a + (b - a) * t;
}

/** The level each new threat turns up on, whatever zone it lands in. */
export const DEBUTS: Record<number, Signature> = {
    4: 'chain',
    5: 'glass',
    9: 'concrete'
};

/**
 * How much of a level's *inherited* clutter it is allowed to run.
 *
 * A zone is a new set of rules, and a new rule can only be read on a quiet
 * board. The threats a zone did not invent -- the glass it inherited from the
 * cavern, the slabs it inherited from the storm, the chains it inherited from
 * the skyline -- are exactly the ones a player has already learned, and
 * exactly the ones drowning out the thing this zone is actually about.
 *
 * So a zone opens on its own rule and nothing else, half-loads the inherited
 * kit on its second level, and only runs the full board from its third. Its
 * own signature threat, and whatever the DEBUTS table says turns up on this
 * particular level, are never touched: a zone that muted the thing it exists
 * to teach would have got the whole idea backwards.
 */
function carried (level: number): number
{
    const zone = zoneFor(level);
    const step = level - zone.from;

    if (step <= 0) return 0;
    if (step === 1) return 0.45;
    if (step === 2) return 0.75;

    return 1;
}

/**
 * Turns the inherited dials down by `carried`, leaving the zone's own
 * signature and this level's debut at full strength.
 */
function settle (h: HazardSpec, level: number): HazardSpec
{
    const c = carried(level);

    if (c >= 1) return h;

    const debut = DEBUTS[level];
    const own = (s: Signature): boolean => s === h.signature || s === debut;

    if (!own('chain')) h.chainChance *= c;
    if (!own('fall')) h.fallChance *= c;

    if (!own('glass')) h.panes = Math.round(h.panes * c);
    if (!own('concrete')) h.blocks = Math.round(h.blocks * c);

    //  Incoming fire is a gap rather than a count, so it is thinned by
    //  stretching the gap out rather than by scaling it down.
    if (!own('flak') && h.flakEvery > 0)
    {
        h.flakEvery = c > 0 ? h.flakEvery / c : 0;
        h.flakSalvo = 1;
    }

    return h;
}

/**
 * A boss level keeps its world's *rule* and loses its world's furniture.
 *
 * The rule is what the place is -- the wind still drags, the lights still go
 * out, the field still turns -- and a fight staged without it would not be
 * that world's exam at all. The furniture is different: a slab of concrete
 * parked in front of a body the player is required to shoot is not difficulty,
 * it is a coin flip on where the boss happened to spawn, and a pane of glass
 * over a fight that already has a ring of glass around it is the same idea
 * said twice, badly.
 *
 * The boss brings its own obstacle, and it is the only one in the room.
 */
function stripForBoss (h: HazardSpec): HazardSpec
{
    h.panes = 0;
    h.blocks = 0;
    h.flakEvery = 0;
    h.chainChance = 0;
    h.fallChance = 0;

    return h;
}

export function hazardFor (level: number): HazardSpec
{
    const zone = zoneFor(level);
    const span = Math.max(1, zone.to - zone.from);
    const t = Math.min(1, Math.max(0, (level - zone.from) / span));
    const h = base();

    switch (zone.index)
    {
        //  --- 1. the range. Nothing, on purpose. ---
        case 0:
            break;

        //  --- 2. the skyline. Chains, then glass over the top of them. ---
        case 1:
            h.signature = 'chain';

            //  The headline. Falling still happens here, but it has been cut
            //  right back: a drop only changes *when* a target is available
            //  and the tap itself is unchanged, so it was never going to carry
            //  a whole zone on its own.
            h.chainChance = ramp(t, 0.35, 0.55);
            h.chainLen = level < 7 ? 2 : 3;

            //  Falling used to happen here too, and it has been taken out
            //  entirely. The first three worlds get one new idea at a time and
            //  nothing else -- a drop only changes *when* a target is
            //  available, the tap itself is unchanged, and stacked on top of a
            //  crosswind and a welded chain it read as noise rather than as a
            //  third thing to learn.
            h.gust = ramp(t, 1, 1.4);

            //  Level 5 hangs the first window over the board. One pane, two
            //  shots, and slow -- the lesson is what glass *is*, not how fast
            //  the player can clear it.
            if (level >= 5)
            {
                h.panes = 1;
                h.paneHp = level >= 7 ? 3 : 2;
                h.paneSpan = ramp(t, 0.5, 0.62);
                h.paneRise = ramp(t, 0.22, 0.3);
                h.paneDrift = ramp(t, 14, 40);
                h.paneRespawn = ramp(t, 6000, 4800);
            }
            break;

        //  --- 3. the storm. The dark closes in, and it has something in it. ---
        case 2:
            //  The storm opens on level 8 with nothing in it but the dark, so
            //  it has nothing to demonstrate until the slabs turn up. A zone
            //  that showed the player concrete a level before any concrete
            //  existed would have spent the demonstration on thin air.
            h.signature = level >= 9 ? 'concrete' : 'none';

            h.storm = ramp(t, 1, 1.8);

            h.chainChance = ramp(t, 0.2, 0.4);
            h.chainLen = 3;

            //  One pane, and not until the slabs have had a level to
            //  themselves. The dark is already doing a lot of work here.
            if (level >= 10)
            {
                h.panes = 1;
                h.paneHp = 3;
                h.paneSpan = ramp(t, 0.52, 0.6);
                h.paneRise = ramp(t, 0.22, 0.26);
                h.paneDrift = ramp(t, 26, 58);
                h.paneRespawn = 5200;
            }

            //  The first slab stands still. From level 10 it is on a rope, and
            //  what it hides it keeps handing back. It stays a single slab all
            //  the way through the storm -- the second one waits for the
            //  cavern, where there is no blackout to see around it.
            if (level >= 9)
            {
                h.blocks = 1;
                h.blockSpan = ramp(t, 0.2, 0.26);
                h.blockRise = ramp(t, 0.17, 0.23);
                h.blockSwing = level >= 10 ? ramp(t, 0.5, 0.85) : 0;
                h.blockPeriod = ramp(t, 4400, 3200);
            }
            break;

        //  --- 4. the cavern. Glass, and more of it. ---
        case 3:
            h.signature = 'glass';
            h.panes = t < 0.45 ? 1 : 2;
            h.paneHp = Math.round(ramp(t, 3, 5));
            h.paneSpan = ramp(t, 0.5, 0.62);
            h.paneRise = ramp(t, 0.24, 0.3);
            h.paneDrift = ramp(t, 18, 62);
            h.paneRespawn = ramp(t, 7000, 4200);
            h.warpEvery = t < 0.5 ? 0 : 1500;

            h.chainChance = ramp(t, 0.25, 0.4);
            h.chainLen = 3;

            h.blocks = t < 0.5 ? 1 : 2;
            h.blockSpan = 0.22;
            h.blockRise = 0.2;
            h.blockSwing = ramp(t, 0.6, 0.95);
            h.blockPeriod = ramp(t, 3800, 2900);
            break;

        //  --- 5. the reactor. It shoots back. ---
        case 4:
            h.signature = 'flak';
            h.flakEvery = ramp(t, 3200, 1750);
            h.flakSalvo = t < 0.65 ? 1 : 2;
            h.flakSpeed = ramp(t, 205, 310);
            h.flakPenalty = ramp(t, 1200, 1800);

            h.chainChance = ramp(t, 0.2, 0.35);
            h.chainLen = 3;

            //  Slabs and incoming fire together: cover you cannot shoot
            //  through, in a zone that is shooting at you.
            h.blocks = t < 0.4 ? 1 : 2;
            h.blockSpan = ramp(t, 0.2, 0.24);
            h.blockRise = 0.2;
            h.blockSwing = ramp(t, 0.7, 1);
            h.blockPeriod = ramp(t, 3600, 2700);
            break;

        //  --- 6. the orbit field. Plates, behind glass. ---
        case 5:
            h.panes = 1;
            h.paneHp = Math.round(ramp(t, 4, 6));
            h.paneSpan = ramp(t, 0.5, 0.6);
            h.paneRise = ramp(t, 0.24, 0.28);
            h.paneDrift = ramp(t, 40, 85);
            h.paneRespawn = 5200;
            h.flakEvery = t < 0.5 ? 0 : 3400;
            h.flakSpeed = 280;
            h.flakPenalty = 1500;

            h.chainChance = ramp(t, 0.2, 0.3);
            h.chainLen = 3;

            h.blocks = 1;
            h.blockSpan = 0.24;
            h.blockRise = 0.22;
            h.blockSwing = 1;
            h.blockPeriod = ramp(t, 3400, 2600);
            break;

        //  --- 7. crimson. The run cashes in every threat it taught. ---
        default:
            h.panes = t < 0.5 ? 1 : 2;
            h.paneHp = 5;
            h.paneSpan = 0.52;
            h.paneRise = 0.24;
            h.paneDrift = ramp(t, 60, 105);
            h.paneRespawn = 5000;

            h.chainChance = ramp(t, 0.3, 0.45);
            h.chainLen = t < 0.5 ? 3 : 4;

            h.blocks = 2;
            h.blockSpan = 0.22;
            h.blockRise = 0.2;
            h.blockSwing = ramp(t, 0.9, 1.15);
            h.blockPeriod = ramp(t, 3200, 2400);
            h.flakEvery = ramp(t, 2900, 1900);
            h.flakSalvo = t < 0.6 ? 1 : 2;
            h.flakSpeed = ramp(t, 280, 355);
            h.flakPenalty = ramp(t, 1500, 2000);
            h.fallChance = ramp(t, 0.15, 0.4);
            h.fallTime = ramp(t, 0.78, 0.58);
            //  Two halves, all the way through. Three was one more worthless
            //  object per kill on the board in the game's busiest world.
            h.splitCount = 2;
            break;
    }

    return isBossLevel(level) ? stripForBoss(h) : settle(h, level);
}

/**
 * The threat this level owes the player a demonstration of, if any.
 *
 * A zone start still teaches whatever its zone leads with, but the table above
 * can also put a debut in the middle of a zone -- and it wins, because a slab
 * of concrete turning up on level 9 has to explain itself on level 9 and not
 * on the level the zone happened to begin.
 */
export function teachesHazard (level: number): Signature
{
    if (DEBUTS[level]) return DEBUTS[level];

    const zone = zoneFor(level);

    return zone.from === level ? hazardFor(level).signature : 'none';
}
