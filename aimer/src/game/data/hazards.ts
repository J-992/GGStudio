import { zoneFor } from './zones';

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
 *   zone 2  skyline      MONSOON     -- targets fall out of the sky, and the
 *                                      crosswind that already drags them
 *                                      sideways gets stronger every level.
 *   zone 3  storm        BLACKOUT    -- the dark comes more often and stays
 *                                      longer the deeper you go.
 *   zone 4  cavern       GLASS       -- armoured panes slide across the arena
 *                                      and eat any shot that crosses them.
 *   zone 5  reactor      FLAK        -- the core shoots back. A bolt that
 *                                      reaches the gun costs you clock.
 *   zone 6  orbitfield   PLATES      -- the shielded targets of the zone's own
 *                                      rule, with one pane of glass for company.
 *   zone 7  crimson      ALL OF IT   -- splitting targets, glass and flak.
 *
 * Everything here is data. The runtime that acts on it lives in
 * core/hazards.ts, and every field is inert at zero so a zone that wants none
 * of this simply leaves it alone.
 */

/** The one hazard a zone introduces itself with, and demonstrates on entry. */
export type Signature = 'none' | 'fall' | 'glass' | 'flak';

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

    //  --- armoured glass ---
    /** How many panes stand in the arena at once. */
    panes: number;
    /** Shots each pane eats before it shatters. */
    paneHp: number;
    /** Fraction of the arena width one pane covers. */
    paneSpan: number;
    /** Sideways drift, px/sec. */
    paneDrift: number;
    /** Milliseconds before a shattered pane is replaced. */
    paneRespawn: number;

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
        panes: 0,
        paneHp: 3,
        paneSpan: 0.44,
        paneDrift: 0,
        paneRespawn: 6000,
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

        //  --- 2. the skyline. Everything falls, and the wind picks up. ---
        case 1:
            h.signature = 'fall';
            h.fallChance = ramp(t, 0.35, 0.85);
            h.fallTime = ramp(t, 1.05, 0.68);
            h.gust = ramp(t, 1, 1.55);
            break;

        //  --- 3. the storm. The dark closes in. ---
        case 2:
            h.storm = ramp(t, 1, 1.8);
            h.fallChance = ramp(t, 0, 0.2);
            h.fallTime = 0.82;
            break;

        //  --- 4. the cavern. Glass, and more of it. ---
        case 3:
            h.signature = 'glass';
            h.panes = t < 0.4 ? 1 : (t < 0.8 ? 2 : 3);
            h.paneHp = Math.round(ramp(t, 3, 5));
            h.paneSpan = ramp(t, 0.38, 0.5);
            h.paneDrift = ramp(t, 18, 62);
            h.paneRespawn = ramp(t, 7000, 4200);
            h.warpEvery = t < 0.5 ? 0 : 1500;
            break;

        //  --- 5. the reactor. It shoots back. ---
        case 4:
            h.signature = 'flak';
            h.flakEvery = ramp(t, 3200, 1750);
            h.flakSalvo = t < 0.65 ? 1 : 2;
            h.flakSpeed = ramp(t, 205, 310);
            h.flakPenalty = ramp(t, 1200, 1800);
            break;

        //  --- 6. the orbit field. Plates, behind glass. ---
        case 5:
            h.panes = 1;
            h.paneHp = Math.round(ramp(t, 4, 6));
            h.paneSpan = ramp(t, 0.42, 0.54);
            h.paneDrift = ramp(t, 40, 85);
            h.paneRespawn = 5200;
            h.flakEvery = t < 0.5 ? 0 : 3400;
            h.flakSpeed = 280;
            h.flakPenalty = 1500;
            break;

        //  --- 7. crimson. The run cashes in every threat it taught. ---
        default:
            h.panes = t < 0.5 ? 1 : 2;
            h.paneHp = 5;
            h.paneSpan = 0.46;
            h.paneDrift = ramp(t, 60, 105);
            h.paneRespawn = 5000;
            h.flakEvery = ramp(t, 2900, 1900);
            h.flakSalvo = t < 0.6 ? 1 : 2;
            h.flakSpeed = ramp(t, 280, 355);
            h.flakPenalty = ramp(t, 1500, 2000);
            h.fallChance = ramp(t, 0.15, 0.4);
            h.fallTime = ramp(t, 0.78, 0.58);
            h.splitCount = t < 0.5 ? 2 : 3;
            break;
    }

    return h;
}

/** True when this level is where its zone's signature hazard debuts. */
export function teachesHazard (level: number): Signature
{
    const zone = zoneFor(level);
    return zone.from === level ? hazardFor(level).signature : 'none';
}
