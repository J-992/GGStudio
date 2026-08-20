import { mix, Tier } from '../core/theme';

/**
 * The gun is the scoreboard.
 *
 * Every upgrade the player takes bolts something onto the weapon at the bottom
 * of the screen, so a build is legible at a glance and a finished run ends with
 * a ridiculous slab of hardware that the player assembled themselves. This
 * module is the translation layer: run state in, a parts list and a beam
 * profile out. Nothing here draws -- `objects/Turret` reads the parts list and
 * `core/fx` reads the beam profile.
 */

/** How many of each attachment the gun is wearing. */
export interface GunLook
{
    /** Barrel length / girth -- damage. */
    power: number;
    /** Cooling fins down the barrel -- fire rate. */
    vents: number;
    /** Optic on the receiver -- crit and crit damage. */
    scope: number;
    /** Actual barrel count. Multi shot literally adds guns. */
    barrels: number;
    /** Needle spike past the muzzle -- pierce. */
    lance: number;
    /** Under-barrel grenade drum -- explode chance. */
    drum: number;
    /** Splitter prongs on the drum -- blast radius. */
    blast: number;
    /** Tesla prongs either side of the muzzle -- chain. */
    coils: number;
    /** Gold plating over the receiver -- coin upgrades. */
    gold: number;
    /** Power crystal in the breech -- xp and score. */
    gem: number;
    /** Energy cells in the socket -- combo upgrades. */
    cells: number;
    /** Collector horns at the muzzle -- tap size. */
    magnet: number;
    /** Spinning chrono ring around the barrel -- slow and overtime. */
    chrono: number;
    /** Dice charm swinging off the receiver -- lucky. */
    charms: number;
    /** Laser sight, drawn up the screen -- perfect. */
    laser: number;
    /** Bipod legs off the socket -- steady. */
    brace: number;
    /** Total picks, and 0..1 across a full run -- overall bulk and glow. */
    picks: number;
    bulk: number;
}

/** Which visible part each upgrade id feeds, and how hard. */
const PART_OF: Record<string, [ keyof GunLook, number ]> = {
    power:   [ 'power', 1 ],
    rapid:   [ 'vents', 1 ],
    crit:    [ 'scope', 1 ],
    critdmg: [ 'scope', 0.8 ],
    multi:   [ 'barrels', 1 ],
    pierce:  [ 'lance', 1 ],
    boom:    [ 'drum', 1 ],
    blast:   [ 'blast', 1 ],
    chain:   [ 'coils', 1 ],
    greed:   [ 'gold', 1 ],
    payout:  [ 'gold', 1 ],
    xp:      [ 'gem', 1 ],
    score:   [ 'gem', 0.7 ],
    window:  [ 'cells', 0.7 ],
    combo:   [ 'cells', 1 ],
    start:   [ 'cells', 0.7 ],
    magnet:  [ 'magnet', 1 ],
    slow:    [ 'chrono', 1 ],
    time:    [ 'chrono', 0.7 ],
    lucky:   [ 'charms', 1 ],
    perfect: [ 'laser', 1 ],
    steady:  [ 'brace', 1 ]
};

/**
 * Permanent perks show up on the gun too, so a player who has been spending
 * coins starts the run holding something visibly better than a stock frame.
 */
const PART_OF_PERK: Record<string, [ keyof GunLook, number ]> = {
    power:    [ 'power', 0.5 ],
    reflex:   [ 'vents', 0.6 ],
    fortune:  [ 'gold', 0.6 ],
    warmup:   [ 'cells', 0.5 ],
    overtime: [ 'chrono', 0.5 ]
};

/** The part group an upgrade id installs -- used to pop it when it is taken. */
export function partFor (id: string): keyof GunLook | null
{
    const p = PART_OF[id];
    return p ? p[0] : null;
}

function emptyLook (): GunLook
{
    return {
        power: 0, vents: 0, scope: 0, barrels: 1, lance: 0, drum: 0, blast: 0,
        coils: 0, gold: 0, gem: 0, cells: 0, magnet: 0, chrono: 0, charms: 0,
        laser: 0, brace: 0, picks: 0, bulk: 0
    };
}

/**
 * The pick count `bulk` treats as a finished gun. A full run hands out more
 * than this -- the frame tops out around two thirds of the way in and the
 * individual attachments carry the growth from there.
 */
const FULL_BUILD = 26;

export function gunLook (taken: Record<string, number>, perks: Record<string, number> = {}): GunLook
{
    const look = emptyLook();

    for (const id in taken)
    {
        const n = taken[id] || 0;
        const part = PART_OF[id];

        if (!n || !part) continue;

        look.picks += n;
        (look[part[0]] as number) += n * part[1];
    }

    for (const id in perks)
    {
        const n = perks[id] || 0;
        const part = PART_OF_PERK[id];

        if (!n || !part) continue;

        (look[part[0]] as number) += n * part[1];
    }

    //  `multi` counts *extra* shots, so the field starts at one gun.
    look.barrels = Math.min(6, 1 + Math.round(look.barrels - 1));
    look.bulk = Math.min(1, look.picks / FULL_BUILD);

    return look;
}

/** How the shot itself looks leaving the muzzle. */
export interface BeamLook
{
    /** Outer sheath colour. */
    color: number;
    /** Hot inner core colour. */
    core: number;
    width: number;
    life: number;
    /** Extra soft passes either side of the sheath. */
    glow: number;
    /** Lightning displacement, in pixels, from chain stacks. */
    wobble: number;
    /** Sparks thrown off along the line on impact. */
    sparks: number;
    /** Muzzle flash scale. */
    bloom: number;
    /** Spearhead drawn at the impact end, from pierce. */
    head: number;
    /** Shockwave ring at the muzzle, from blast. */
    shock: number;
}

/**
 * The beam reads the same build the gun does, so a heavy weapon never fires a
 * starter pea. `hot` is the colour the gun's own accents run at.
 */
export function beamLook (look: GunLook, tier: Tier, secondary = false): BeamLook
{
    const base = secondary ? tier.accent2 : tier.accent;

    //  Crit pushes the bolt gold, boom pushes it red-hot, chain pushes it
    //  electric. Whichever the player leaned into is the colour they see.
    let color = base;
    color = mix(color, 0xffd23f, Math.min(0.55, look.scope * 0.09));
    color = mix(color, 0xff4d3d, Math.min(0.5, look.drum * 0.11));
    color = mix(color, 0xfff05c, Math.min(0.45, look.coils * 0.12));

    const core = mix(0xffffff, color, Math.min(0.45, look.bulk * 0.45));

    return {
        color,
        core,
        width: (secondary ? 4 : 6) + look.power * 0.6 + look.bulk * 3.5,
        //  Late bolts linger a little, but not so long that six of them at
        //  once sit on top of the targets the player still has to read.
        life: (secondary ? 120 : 145) + look.bulk * 60,
        glow: Math.min(2, Math.floor(look.bulk * 2.6)),
        wobble: Math.min(14, look.coils * 3.4),
        sparks: Math.round(look.bulk * 5),
        bloom: 1 + look.power * 0.06 + look.bulk * 0.5,
        head: Math.min(22, look.lance * 4.5),
        shock: Math.min(1, look.blast * 0.18)
    };
}

/**
 * Screen shake per shot. Zero for a stock frame -- a pea-shooter that rattles
 * the camera every 150ms is motion sickness, not feedback -- and it only turns
 * on once the gun has grown into something with weight behind it.
 */
export function kickOf (look: GunLook): number
{
    if (look.power < 2 && look.bulk < 0.3) return 0;

    return Math.min(0.006, 0.001 + look.power * 0.0005 + look.bulk * 0.002);
}
