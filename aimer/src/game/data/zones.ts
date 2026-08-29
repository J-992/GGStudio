import { Tier, mix } from '../core/theme';
import type { TargetKind } from './levels';

/**
 * The run is a journey through seven places, not forty numbered levels.
 *
 * Levels 1-3 are the training range: no weather, no tricks, nothing moving.
 * Everything after that is a new place with its own look *and* its own rule,
 * and the two always arrive together -- so a change of scenery is never
 * decoration, it is the game telling the player the rules just moved.
 *
 * Nothing here is ever spelled out in words. A zone announces itself by the
 * blast doors opening onto somewhere else, and its rule announces itself by
 * doing the thing once, slowly, before the clock starts.
 */

export type GimmickId =
    /** Training range -- the rules are the tutorial. */
    'none' |
    /** A crosswind drags every target sideways, and reverses. */
    'drift' |
    /** The storm blacks the arena out; only the targets stay lit. */
    'blackout' |
    /** Targets warp once, part way through their life. */
    'blink' |
    /** The whole field turns slowly around the reactor core. */
    'orbit' |
    /** Targets carry a spinning shield plate that eats a shot from its side. */
    'shield' |
    /** Killing a target splits it into two smaller ones. */
    'split';

export type BackdropId =
    'range' | 'skyline' | 'storm' | 'cavern' | 'reactor' | 'orbitfield' | 'crimson';

export interface Zone
{
    /** 0-based, so it can index into arrays of per-zone art. */
    index: number;
    /** The place, on the gate the player walks through to get into it. */
    name: string;
    /** The same place, for a rail seven stops wide. See the seeds below. */
    short: string;
    /** What the place does to you, in two or three words. */
    rule: string;
    /** The rule again, as a sentence, under the name on the gate. */
    ruleText: string;
    /** Icon texture name (see core/icons) for the rule. */
    icon: string;
    /** First level of the zone. */
    from: number;
    /** Last level of the zone (filled in below from the next zone's start). */
    to: number;
    palette: Tier;
    backdrop: BackdropId;
    gimmick: GimmickId;
}

/** The last level of the run. Kept here so a zone table can be checked against it. */
const LAST_LEVEL = 40;

interface ZoneSeed
{
    from: number;
    name: string;
    short: string;
    rule: string;
    ruleText: string;
    icon: string;
    palette: Tier;
    backdrop: BackdropId;
    gimmick: GimmickId;
}

const SEEDS: ZoneSeed[] = [
    {
        from: 1,
        name: 'THE RANGE',
        short: 'RANGE',
        rule: 'CALIBRATION',
        ruleText: 'NOTHING MOVES. LEARN THE GUN.',
        icon: 'crosshair',
        backdrop: 'range',
        gimmick: 'none',
        palette: { bg: 0x080b1c, grid: 0x1b2a5e, accent: 0x3fe0ff, accent2: 0x6cf5c8, dust: 0x3fe0ff }
    },
    {
        from: 4,
        name: 'NEON SKYLINE',
        short: 'SKYLINE',
        rule: 'CROSSWIND',
        ruleText: 'THE WIND DRAGS EVERY TARGET SIDEWAYS.',
        icon: 'chevrons',
        backdrop: 'skyline',
        gimmick: 'drift',
        palette: { bg: 0x0c0824, grid: 0x2e2070, accent: 0x9b6cff, accent2: 0x4fd6ff, dust: 0x9b6cff }
    },
    {
        from: 8,
        name: 'THE STORM',
        short: 'STORM',
        rule: 'BLACKOUT',
        ruleText: 'THE LIGHTS GO OUT. THE TARGETS DO NOT.',
        icon: 'bolt',
        backdrop: 'storm',
        gimmick: 'blackout',
        palette: { bg: 0x080d18, grid: 0x24325c, accent: 0x8fb4ff, accent2: 0xe4ecff, dust: 0xb8ccff }
    },
    {
        from: 13,
        name: 'MAGMA DEEP',
        short: 'MAGMA',
        rule: 'WARP',
        ruleText: 'TARGETS JUMP ONCE, WITHOUT WARNING.',
        icon: 'sparkle',
        backdrop: 'cavern',
        gimmick: 'blink',
        palette: { bg: 0x150a06, grid: 0x5a2a12, accent: 0xff8a3d, accent2: 0xffd166, dust: 0xff9d3d }
    },
    {
        from: 20,
        name: 'THE REACTOR',
        short: 'REACTOR',
        rule: 'SPIN',
        ruleText: 'THE WHOLE FIELD TURNS AROUND THE CORE.',
        icon: 'trefoil',
        backdrop: 'reactor',
        gimmick: 'orbit',
        palette: { bg: 0x03170f, grid: 0x0c5c37, accent: 0x2fffa0, accent2: 0xd8ff4d, dust: 0x2fffa0 }
    },
    {
        from: 28,
        name: 'HIGH ORBIT',
        short: 'ORBIT',
        rule: 'SHIELD',
        ruleText: 'A SPINNING PLATE EATS SHOTS FROM ITS SIDE.',
        icon: 'shield',
        backdrop: 'orbitfield',
        gimmick: 'shield',
        palette: { bg: 0x0a0014, grid: 0x3c0a78, accent: 0xd08cff, accent2: 0x4fd6ff, dust: 0xd8c8ff }
    },
    {
        from: 34,
        name: 'CRIMSON END',
        short: 'CRIMSON',
        rule: 'SPLIT',
        ruleText: 'EVERY KILL BREAKS INTO TWO SMALLER ONES.',
        icon: 'trident',
        backdrop: 'crimson',
        gimmick: 'split',
        palette: { bg: 0x1a0007, grid: 0x6e0020, accent: 0xff2d55, accent2: 0xff8a00, dust: 0xff5470 }
    }
];

export const ZONES: Zone[] = SEEDS.map((s, i) => ({
    index: i,
    name: s.name,
    short: s.short,
    rule: s.rule,
    ruleText: s.ruleText,
    icon: s.icon,
    from: s.from,
    to: (i + 1 < SEEDS.length ? SEEDS[i + 1].from - 1 : LAST_LEVEL),
    palette: s.palette,
    backdrop: s.backdrop,
    gimmick: s.gimmick
}));

export function zoneFor (level: number): Zone
{
    let z = ZONES[0];
    for (const zone of ZONES) if (level >= zone.from) z = zone;
    return z;
}

/** The zone the player is about to walk into, or null on the last one. */
export function nextZone (level: number): Zone | null
{
    const z = zoneFor(level);
    return ZONES[z.index + 1] || null;
}

/** True on the first level of a zone -- the level that gets the grand entrance. */
export function isZoneStart (level: number): boolean
{
    return zoneFor(level).from === level;
}

/**
 * Accent of whatever comes next, used to tint the far end of the route rail so
 * the player can see a different colour waiting before they get there.
 */
export function aheadAccent (level: number): number
{
    const n = nextZone(level);
    return n ? n.palette.accent : 0xffffff;
}

/**
 * The paint the rank and file wear in a given zone.
 *
 * A target is the most-looked-at object on the screen, and until now it was
 * the one object that never changed when the world did -- the same cyan circle
 * and the same green pip in every place the run visits. Now the board is
 * painted out of the zone's own palette, so walking through a door changes the
 * colour of everything, and "where am I" is answered by the targets as loudly
 * as by the sky behind them.
 *
 * The specials are deliberately left alone. A bomb has to read as a bomb and a
 * coin has to read as money from the corner of the eye, in every zone, or the
 * player is being punished for learning the game.
 */
export function skinFor (zone: Zone, kind: TargetKind): { color: number; ring: number } | undefined
{
    const p = zone.palette;
    let color: number;

    switch (kind)
    {
        case 'normal':  color = p.accent; break;
        //  Full strength, and deliberately so: a two-shot target that was
        //  darkened to mark it out read as one the player could not shoot.
        //  The plating ring drawn inside its edge (see objects/Target) and the
        //  number on its face are what say "this one takes two".
        case 'tough':   color = mix(p.accent, 0xffffff, 0.15); break;
        case 'small':   color = p.accent2; break;
        case 'fast':    color = mix(p.accent2, 0xffffff, 0.42); break;
        case 'armored': color = mix(p.accent, 0xa8b4d0, 0.62); break;
        default:        return undefined;
    }

    //  Enough white in the life ring that it still reads against the body it
    //  is drawn around, whatever colour that body turned out to be.
    return { color, ring: mix(color, 0xffffff, 0.62) };
}

//  ------------------------------------------------------- lifetime progress

/**
 * How far into one world the player has ever got.
 *
 * The save carries a single number -- the deepest level ever cleared -- and
 * that is deliberately all it carries: the run is linear, so one number is the
 * whole history. Everything the map on the menu draws is worked back out of it
 * here rather than in the drawing code, so the rule for "have I finished this
 * place" is written down once.
 */
export interface ZoneProgress
{
    zone: Zone;
    /** Levels in this world. */
    total: number;
    /** How many of them are behind the player, 0..total. */
    done: number;
    /** `done / total`, for a bar or a fill. */
    frac: number;
    /**
     * The player has stood in this place. True the moment the level *before*
     * it is cleared -- walking through the gate is arriving, not clearing.
     */
    reached: boolean;
    /** Every level in it is behind them. */
    cleared: boolean;
}

export function zoneProgress (zone: Zone, bestLevel: number): ZoneProgress
{
    const total = zone.to - zone.from + 1;
    const done = Math.max(0, Math.min(total, bestLevel - zone.from + 1));

    return {
        zone,
        total,
        done,
        frac: done / total,
        reached: bestLevel >= zone.from - 1,
        cleared: done >= total
    };
}

/** The whole run's worth, in order. */
export function worldProgress (bestLevel: number): ZoneProgress[]
{
    return ZONES.map(z => zoneProgress(z, bestLevel));
}

/**
 * The world the player is working on: the first one they have not finished.
 * Once the run has been beaten there is no such world, so the last one stands
 * in -- a finished map should read as finished, not as back at the start.
 */
export function currentZone (bestLevel: number): Zone
{
    for (const zone of ZONES) if (bestLevel < zone.to) return zone;
    return ZONES[ZONES.length - 1];
}
