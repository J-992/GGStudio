import { GunLook } from '../data/gunkit';
import { mix } from './theme';

/**
 * What the gun looks like, as data.
 *
 * The weapon is the scoreboard, so it grows from a bare frame to a slab of
 * hardware most of a screen wide -- and the whole risk of a gun like that is
 * that it ends up a pile of stickers. Keeping the *plan* separate from the
 * Phaser objects that draw it is what stops that: the shape of the gun is one
 * pure function of the parts list, so it can be rendered headless and looked
 * at (see `scripts/gun-preview.ts`) rather than guessed at.
 *
 * `objects/Turret` turns this plan into containers and graphics and owns
 * everything that moves. Nothing here knows about Phaser.
 *
 * ---------------------------------------------------------------------------
 * The rules that keep twenty parts looking like one machine
 * ---------------------------------------------------------------------------
 *
 *  1. One material. Every part is the same dark plate with the same 2.5px
 *     accent edge. Colour only ever appears as a small emissive slot set into
 *     a plate -- never as a whole shape.
 *  2. Three signature lights, not fifteen: `heat` for anything to do with
 *     firing, `tech` for anything to do with aiming and handling, `gold` for
 *     money. The core crystal is the single hero light on the gun.
 *  3. Every attachment is bolted flush to a section of the chassis -- deck,
 *     breech, shroud, or muzzle brake -- and continues that section's outline.
 *     Nothing floats, nothing is stuck on at its own angle.
 *  4. Each section owns its own upgrades, so two parts never fight over the
 *     same square of gun. See the zone map on `planGun`.
 */

/** One drawing instruction, in the local space of the part that owns it. */
export type Op =
    /** A piece of hull: dark plate, accent edge. The gun's only vocabulary. */
    | { k: 'plate'; x: number; y: number; w: number; h: number; r: number; lit?: boolean }
    /** Hull cut to a shape rather than a box -- blades, flares, spikes. */
    | { k: 'poly'; pts: number[]; lit?: boolean }
    /** An emissive slot set into a plate. The only place colour is allowed. */
    | { k: 'slot'; x: number; y: number; w: number; h: number; c: number; a?: number }
    /** A flat light strip -- no plate under it, no edge on it. */
    | { k: 'bar'; x: number; y: number; w: number; h: number; r: number; c: number; a: number }
    /** A stroked polyline. Struts and horns are two of these, hull then edge. */
    | { k: 'stroke'; pts: number[]; w: number; c: number; a: number }
    | { k: 'dot'; x: number; y: number; r: number; c: number; a: number };

/**
 * A named sub-assembly. The name is the `GunLook` key that installed it, which
 * is what lets an upgrade pop exactly the part it just bought.
 */
export interface Part
{
    name: string;
    x: number;
    y: number;
    ops: Op[];
    /** Drawn behind its siblings -- struts and pods that tuck under the body. */
    back?: boolean;
}

export interface GunPalette
{
    hull: number;
    hullLit: number;
    edge: number;
    /** Firing: cooling, launchers, spikes, arcs. */
    heat: number;
    /** Handling: optics, collars, collectors, cells. */
    tech: number;
    gold: number;
    /** The core crystal -- the one hero light on the gun. */
    core: number;
    /** The tier's own second colour. The charge cells, and nothing else. */
    cell: number;
    /** The sight line, and nothing else. */
    aim: number;
}

export interface GunPlan
{
    pal: GunPalette;
    /** Radius of the soft under-glow. */
    glowR: number;
    glowA: number;
    /** Static half of the gun: deck, feet, tags. */
    frame: Part[];
    /** Rotating half: breech, shroud, barrels, brake and everything on them. */
    bank: Part[];
    /** Barrel mouths, in bank space. `len` is where the tracer starts. */
    barrels: { x: number; wHalf: number; len: number; muzzle: number }[];
    /** Charge cells on the breech face, filled in per frame. */
    cells: { x: number; y: number }[];
    /** Where the core crystal breathes, if there is one. */
    gem: { x: number; y: number } | null;
    /** Arc posts on the brake: half-span and the line the lightning rides. */
    coils: { reach: number; y: number } | null;
    /** Gyro collar around the shroud. */
    chrono: { rx: number; ry: number; y: number } | null;
    /** Parts that must be drawn over the barrels, in order. */
    top: string[];
}

/** The shroud's four measurements. Every attachment on it is placed off these. */
interface Shroud
{
    /** Half-width of the heavy rear section. */
    half: number;
    /** How far forward the shroud reaches, as -y. */
    top: number;
    /** The y of the step between the two sections. Always negative. */
    step: number;
    /** Half-width of the narrow front section. */
    front: number;
}

const HULL = 0x1b2549;
const HULL_LIT = 0x2d3c74;
const GOLD = 0xffc857;

/** The three signature lights, plus the two hero ones. */
const HEAT = 0xff8a3d;
const CORE = 0x9b6cff;
const AIM = 0xff5470;

//  ------------------------------------------------------------------ pen

function plate (ops: Op[], x: number, y: number, w: number, h: number, r: number, lit = false): void
{
    ops.push({ k: 'plate', x, y, w, h, r, lit });
}

function poly (ops: Op[], pts: number[], lit = false): void
{
    ops.push({ k: 'poly', pts, lit });
}

function slot (ops: Op[], x: number, y: number, w: number, h: number, c: number, a = 0.95): void
{
    ops.push({ k: 'slot', x, y, w, h, c, a });
}

function bar (ops: Op[], x: number, y: number, w: number, h: number, r: number, c: number, a: number): void
{
    ops.push({ k: 'bar', x, y, w, h, r, c, a });
}

function stroke (ops: Op[], pts: number[], w: number, c: number, a: number): void
{
    ops.push({ k: 'stroke', pts, w, c, a });
}

function dot (ops: Op[], x: number, y: number, r: number, c: number, a: number): void
{
    ops.push({ k: 'dot', x, y, r, c, a });
}

/** A strut: hull core with an edge light down it, the same as every plate. */
function strut (ops: Op[], pts: number[], w: number, pal: GunPalette): void
{
    stroke(ops, pts, w, pal.hullLit, 1);
    stroke(ops, pts, 2.5, pal.edge, 0.8);
}

//  ----------------------------------------------------------------- plan

/**
 * Lay out the whole gun for a parts list.
 *
 * The chassis is four sections stacked along the barrel line, and every
 * upgrade modifies one of them:
 *
 *   deck    the static plate on the floor      -- steady, lucky, greed
 *   breech  the rotating block over the pivot  -- xp, combo, magnet
 *   shroud  the housing the barrels run through -- damage, rate, boom, blast,
 *                                                  crit, slow, perfect
 *   brake   the block every muzzle passes through -- pierce, chain
 *
 * Because each section owns its own upgrades, no two parts ever land on the
 * same square of gun, and every part is flush against the body it grew from.
 */
export function planGun (look: GunLook, accent: number, accent2 = accent): GunPlan
{
    const L = look;

    //  Gold is a change of material, not a bag of new shapes: the same plates,
    //  cast in a different metal. It darkens the plate rather than lightening
    //  it -- the edge light is what should read as gold, not a flat wash.
    const goldT = Math.min(0.7, L.gold * 0.075);

    const pal: GunPalette = {
        hull: mix(HULL, 0x2c2008, goldT * 0.85),
        hullLit: mix(HULL_LIT, 0x4a3a0e, goldT * 0.85),
        edge: mix(accent, GOLD, goldT),
        heat: HEAT,
        tech: mix(accent, 0xffffff, 0.45),
        gold: GOLD,
        core: CORE,
        cell: accent2,
        aim: AIM
    };

    //  Barrel field. Everything the gun is wide is measured off this.
    const n = L.barrels;
    const wHalf = 8 + Math.min(3, L.power * 0.28);
    const spread = wHalf * 2 + 4;
    const flank = ((n - 1) / 2) * spread + wHalf;

    //  Barrel mouth, and the brake sitting around it.
    const len = 76 + Math.min(32, L.power * 3) + L.bulk * 22;
    const brakeH = 15 + Math.min(6, L.power * 0.4);
    const brakeTop = -len - 5;

    /**
     * The shroud: the single housing the barrels run through, and the reason a
     * six-barrel bank reads as one gun instead of six loose tubes. It is cut in
     * two steps -- a heavy rear section and a narrower front one -- because the
     * step is what gives every bolt-on a shoulder to sit against, and because a
     * single tapering box is the difference between a weapon and a bollard.
     * The last third of each barrel is left bare, so the gun still has barrels.
     */
    const shroudHalf = Math.max(21, flank + 8 + Math.min(6, L.power * 0.5));
    //  A fixed-length stretch of bare barrel before the muzzle, rather than a
    //  proportion of it: the gun should read as one body with a barrel coming
    //  out of it at every length, never as a body with a neck and a head.
    const shroudTop = len - 22 - Math.min(10, L.power);
    const shroudStep = -shroudTop * 0.46;
    const frontHalf = shroudHalf * 0.78;

    const brakeHalf = Math.max(frontHalf + 2, flank + 6 + Math.min(4, L.power * 0.3));
    const recHalf = shroudHalf + 10 + L.bulk * 7;

    const plan: GunPlan = {
        pal,
        glowR: 58 + L.bulk * 70,
        glowA: 0.04 + L.bulk * 0.09,
        frame: [],
        bank: [],
        barrels: [],
        cells: [],
        gem: null,
        coils: null,
        chrono: null,
        top: []
    };

    const frame = (name: string, x = 0, y = 0, back = false): Op[] =>
    {
        const ops: Op[] = [];
        plan.frame.push({ name, x, y, ops, back });
        return ops;
    };

    const bank = (name: string, x = 0, y = 0, back = false): Op[] =>
    {
        const ops: Op[] = [];
        plan.bank.push({ name, x, y, ops, back });
        return ops;
    };

    const S: Shroud = { half: shroudHalf, top: shroudTop, step: shroudStep, front: frontHalf };

    buildDeck(frame, L, pal, recHalf, goldT);
    buildBarrels(plan, bank, n, wHalf, spread, len, brakeTop);
    buildBody(bank, L, pal, recHalf, S);
    buildShroudMods(plan, bank, L, pal, S);
    buildBreechMods(plan, bank, L, pal, recHalf);
    buildBrake(plan, bank, L, pal, n, wHalf, spread, brakeTop, brakeH, brakeHalf);

    //  Anything bolted to a barrel has to be drawn over it.
    plan.top = [ 'power', 'vents', 'drum', 'blast', 'chrono', 'scope', 'laser', 'brake', 'lance', 'magnet', 'coils' ];

    return plan;
}

//  ---------------------------------------------------------------- sections

/**
 * The deck: the static plate the whole weapon stands on, and the pedestal the
 * rotating half turns in. Stock, this is a plate, a pedestal and a light strip
 * and nothing else -- deliberately plain, so the first bolt-on is obvious.
 */
function buildDeck (
    frame: (n: string, x?: number, y?: number, back?: boolean) => Op[],
    L: GunLook,
    pal: GunPalette,
    recHalf: number,
    goldT: number
): void
{
    //  Wider than the block turning on top of it, or the gun looks like it is
    //  about to fall over -- but only just. A deck twice the width of the
    //  weapon reads as a table with a gun on it.
    const half = Math.max(52, recHalf + 16) + L.bulk * 8;

    const g = frame('deck');

    //  Pedestal first: a chamfered riser from the deck up to the pivot, so the
    //  breech is turning *in* something instead of floating over it.
    const pw = recHalf * 0.86;
    poly(g, [ -pw, 10, pw, 10, pw * 0.72, -26, -pw * 0.72, -26 ], true);

    //  A chamfered plinth rather than a rounded box: the deck is the one part
    //  of the gun that never moves, so it is the part that has to look bolted
    //  to the floor.
    poly(g, [ -half, 52, -half, 2, -half + 18, -14, half - 18, -14, half, 2, half, 52 ]);

    //  One short light strip, centred. The stock gun is a plinth, a body and a
    //  barrel -- every other mark on it was bought.
    bar(g, -half * 0.4, -10, half * 0.8, 6, 3, pal.edge, 0.8);

    //  Gold inlay: chevrons cut into the deck once the greed build has really
    //  committed. Still hull-coloured plate underneath.
    if (goldT > 0.4)
    {
        const c = frame('gold');

        for (let i = 0; i < 3; i++)
        {
            const x = half - 16 - i * 13;

            stroke(c, [ -x, 2, -x + 7, 10, -x, 18 ], 3, pal.gold, 0.9);
            stroke(c, [ x, 2, x - 7, 10, x, 18 ], 3, pal.gold, 0.9);
        }
    }

    //  Outriggers: the deck simply continues sideways into a pair of feet,
    //  chamfered the same way, rather than sprouting legs.
    if (L.brace > 0)
    {
        const b = frame('brace', 0, 0, true);
        const reach = 12 + L.brace * 6;

        for (const side of [ -1, 1 ])
        {
            const x0 = side * (half - 12);
            const x1 = side * (half + reach);

            //  The deck's own lower edge, carried on out into a foot.
            poly(b, [ x0, 8, x1, 22, x1, 48, x0, 48 ], true);
            slot(b, x1 - side * 11 - 3, 28, 6, 3, pal.tech, 0.7);
        }
    }

    //  Luck tag: a chamfered plate let into the deck's left shoulder.
    if (L.charms > 0)
    {
        const c = frame('charms', -(half - 20), 12);
        const pips = Math.min(5, 1 + Math.round(L.charms * 0.6));

        plate(c, -10, -10, 20, 20, 5, true);

        for (let i = 0; i < pips; i++)
        {
            const a = -Math.PI / 2 + (i / pips) * Math.PI * 2;
            dot(c, Math.cos(a) * 5, Math.sin(a) * 5, 1.8, pal.gold, 0.95);
        }
    }
}

/** The barrels themselves. Most of their length lives inside the shroud. */
function buildBarrels (
    plan: GunPlan,
    bank: (n: string, x?: number, y?: number, back?: boolean) => Op[],
    n: number,
    wHalf: number,
    spread: number,
    len: number,
    brakeTop: number
): void
{
    const g = bank('barrels', 0, 0, true);

    for (let i = 0; i < n; i++)
    {
        const x = (i - (n - 1) / 2) * spread;

        //  Plugged deep into the breech at one end and through the brake at
        //  the other: a barrel is never a free-floating tube.
        plate(g, x - wHalf, -len, wHalf * 2, len + 24, 5);

        plan.barrels.push({ x, wHalf, len: -brakeTop, muzzle: len });
    }
}

/** Breech and shroud: the one body everything else is bolted to. */
function buildBody (
    bank: (n: string, x?: number, y?: number, back?: boolean) => Op[],
    L: GunLook,
    pal: GunPalette,
    recHalf: number,
    S: Shroud
): void
{
    const g = bank('body');

    //  Front section, rear section, breech -- drawn back to front so the two
    //  steps read as one casting with shoulders in it, not as three boxes.
    plate(g, -S.front, -S.top, S.front * 2, -S.step + S.top + 10, 7);
    plate(g, -S.half, S.step, S.half * 2, 16 - S.step, 9);
    plate(g, -recHalf, -28, recHalf * 2, 48, 12);

    //  An inset deck once the breech is big enough that a bare plate would
    //  read as a blank box.
    if (L.bulk > 0.2) plate(g, -recHalf + 9, -23, (recHalf - 9) * 2, 24, 8, true);

    //  The seams. One line each, and the thing that makes the body look
    //  machined rather than drawn.
    bar(g, -S.half + 6, -13, (S.half - 6) * 2, 3, 1.5, pal.edge, 0.45);
    bar(g, -S.front + 5, S.step + 2, (S.front - 5) * 2, 2.5, 1.2, pal.edge, 0.35);

    //  Reinforcement banding up the shroud. Damage's second job, after length:
    //  it is what makes the gun read as dense rather than merely long.
    if (L.power > 2)
    {
        const c = bank('power');
        const bands = Math.min(3, Math.floor(L.power / 3));

        for (let i = 0; i < bands; i++)
        {
            //  Banding hugs whichever section it lands on, so a band is never
            //  wider or narrower than the body under it.
            const y = S.step * (0.55 - i * 0.55) - i * 6;
            const on = y < S.step ? S.front : S.half;
            const w = on * 0.98;

            plate(c, -w, y, w * 2, 9, 4, true);
            bar(c, -w * 0.6, y + 3, w * 1.2, 3, 1.5, pal.edge, 0.5);
        }
    }
}

/**
 * Everything that mounts on the shroud: launchers on the heavy rear section,
 * cooling on the narrow front one, the gyro collar on the step between them,
 * and the sight up the spine. Each part has a band of the shroud to itself, so
 * no two attachments ever land on the same square of gun.
 */
function buildShroudMods (
    plan: GunPlan,
    bank: (n: string, x?: number, y?: number, back?: boolean) => Op[],
    L: GunLook,
    pal: GunPalette,
    S: Shroud
): void
{
    //  Launcher pods, flush against the rear section's flanks and no taller
    //  than it -- they fill the shoulder the step leaves rather than hanging
    //  off the side of the gun.
    if (L.drum > 0)
    {
        const d = bank('drum', 0, 0, true);
        const pw = 15 + Math.min(11, L.drum * 1.7);
        const mouth = Math.min(5, 3.2 + L.drum * 0.25);
        const top = S.step + 4;

        for (const side of [ -1, 1 ])
        {
            const x = side * (S.half + pw / 2 - 4);

            plate(d, x - pw / 2, top, pw, 16 - top, 6, true);

            //  A launch tube reads as a tube because you can see down it.
            dot(d, x, top + 9, mouth + 2.5, pal.heat, 0.25);
            dot(d, x, top + 9, mouth, pal.heat, 0.9);

            const rounds = Math.min(3, 1 + Math.floor(L.drum / 3));

            for (let p = 0; p < rounds; p++)
            {
                slot(d, x - 4, top + 21 + p * 8, 8, 3, pal.heat, 0.85);
            }
        }

        //  Blast opens the tubes up: a flared lip and vent slits across it. It
        //  never adds a part of its own -- it is the pods, breathing harder.
        if (L.blast > 0)
        {
            const b = bank('blast', 0, 0, true);
            const flare = 2 + Math.min(5, L.blast * 0.8);
            const lip = 5 + Math.min(6, L.blast * 0.8);

            for (const side of [ -1, 1 ])
            {
                const x = side * (S.half + pw / 2 - 4);

                poly(b, [
                    x - pw / 2, top + 6,
                    x + pw / 2, top + 6,
                    x + pw / 2 + flare, top - lip,
                    x - pw / 2 - flare, top - lip
                ], true);

                for (let p = 0; p < 3; p++)
                {
                    const sw = (pw + flare * 2 - 12) / 3;
                    slot(b, x - pw / 2 - flare + 5 + p * (sw + 1.5), top - lip + 3, sw - 1.5, 2, pal.heat, 0.8);
                }
            }
        }
    }

    //  Cooling louvres, cut through the front section's walls. They straddle
    //  the wall rather than sitting beside it, so ten stacks of fire rate
    //  thicken the gun instead of growing a hedge off the side of it.
    if (L.vents > 0)
    {
        const v = bank('vents');
        const fins = Math.min(6, 1 + Math.round(L.vents * 0.6));
        const gap = 8;
        const run = S.step - 6 - fins * gap;

        //  Heavy cooling gets a raised ledge down the run: the silhouette
        //  growing as one body rather than sprouting parts.
        if (L.vents > 3)
        {
            for (const side of [ -1, 1 ])
            {
                const x = side > 0 ? S.front - 4 : -S.front - 5;
                plate(v, x, run - 5, 9, fins * gap + 12, 4, true);
            }
        }

        for (const side of [ -1, 1 ])
        {
            for (let f = 0; f < fins; f++)
            {
                const fy = run + f * gap;
                const x = side > 0 ? S.front - 7 : -S.front - 6;

                plate(v, x, fy, 13, 5, 2, true);
                slot(v, x + 3, fy + 1.5, 7, 2, pal.heat, 0.9);
            }
        }
    }

    //  Gyro collar: a band right around the step, where the shroud already
    //  changes width. The dashes riding it are drawn per frame.
    if (L.chrono > 0)
    {
        const rx = S.half + 4;
        plan.chrono = { rx, ry: rx * 0.26, y: S.step };
    }

    //  Crit's silhouette is a rangefinder: one bar straight across the front
    //  section with a lens on each end, and a sight block up the spine behind
    //  it. Bars and blocks are what the rest of the gun is made of, so crit
    //  widens the weapon instead of growing wings off it.
    if (L.scope > 0)
    {
        const s = bank('scope');
        const reach = 10 + Math.min(26, L.scope * 3);
        const barHalf = S.front + reach;
        const y = -S.top * 0.82;

        plate(s, -barHalf, y - 7, barHalf * 2, 15, 6, true);

        for (const side of [ -1, 1 ])
        {
            slot(s, side * (barHalf - 9) - 3.5, y - 3.5, 7, 7, pal.tech);
        }

        bar(s, -barHalf * 0.55, y + 5, barHalf * 1.1, 2.5, 1.2, pal.edge, 0.45);

        //  And the sight itself, up the spine between the collar and the bar:
        //  one raised block with a lens slot down it.
        const g = bank('scope');
        const h = 16 + Math.min(10, L.scope * 1.2);
        const sy = (S.step + y) / 2 + 2;

        plate(g, -8.5, sy - h / 2, 17, h, 5, true);
        slot(g, -3, sy - h / 2 + 4, 6, h - 8, pal.tech, 0.9);
    }

    //  Perfect's emitter caps the spine. It mounts on the shroud, not on the
    //  vanes, so it is there whether or not crit was ever taken.
    if (L.laser > 0)
    {
        const e = bank('laser');
        const y = -S.top + 4;

        plate(e, -7.5, y - 11, 15, 13, 4, true);
        slot(e, -3, y - 8, 6, 3, pal.aim);
    }
}

/** Breech-face readouts, and the collector horns off the breech flanks. */
function buildBreechMods (
    plan: GunPlan,
    bank: (n: string, x?: number, y?: number, back?: boolean) => Op[],
    L: GunLook,
    pal: GunPalette,
    recHalf: number
): void
{
    //  The breech's lower face is the one strip of the gun the barrels never
    //  cover, so it is where the readouts live.
    const faceY = 6;

    if (L.gem > 0)
    {
        const g = bank('gem', 0, faceY);
        const w = 14 + Math.min(20, L.gem * 2.2);

        plate(g, -w / 2, -9, w, 18, 5, true);
        bar(g, -w / 2 + 3, -6, w - 6, 12, 6, pal.core, 0.35);
        bar(g, -w / 2 + 5, -4, w - 10, 8, 4, mix(pal.core, 0x6cf5c8, Math.min(0.5, L.gem * 0.06)), 0.95);

        plan.gem = { x: 0, y: faceY };
    }

    if (L.cells > 0)
    {
        const count = Math.min(12, 2 + Math.round(L.cells * 0.8));
        const inner = 12 + Math.min(24, L.gem * 2.4);

        for (let i = 0; i < count; i++)
        {
            const side = i % 2 === 0 ? -1 : 1;
            const step = Math.floor(i / 2);

            plan.cells.push({ x: side * Math.min(recHalf - 8, inner + 5 + step * 9), y: faceY });
        }
    }

    //  Collector funnels: the breech's own flanks carried out and forward into
    //  two wedges, with a light down each inner face. They live low, where the
    //  shroud's parts never reach, and they never leave the body's outline.
    if (L.magnet > 0)
    {
        const m = bank('magnet', 0, 0, true);
        const reach = 10 + Math.min(16, L.magnet * 2.4);

        for (const side of [ -1, 1 ])
        {
            const x = side * (recHalf - 8);
            const outX = x + side * reach;

            poly(m, [ x, 16, x, -14, outX, -26, outX, -4 ], true);
            slot(m, x + side * 4 - (side > 0 ? 0 : 3), -12, 3, 18, pal.tech, 0.75);
        }
    }
}

/**
 * The muzzle brake: the block every barrel passes through. It is the piece
 * that stops a six-barrel bank ending in six unrelated dots, and pierce and
 * chain both modify it rather than adding anything of their own.
 */
function buildBrake (
    plan: GunPlan,
    bank: (n: string, x?: number, y?: number, back?: boolean) => Op[],
    L: GunLook,
    pal: GunPalette,
    n: number,
    wHalf: number,
    spread: number,
    brakeTop: number,
    brakeH: number,
    brakeHalf: number
): void
{
    const g = bank('brake');

    plate(g, -brakeHalf, brakeTop, brakeHalf * 2, brakeH, 5);

    //  Ports, one per barrel, and a light band across the whole face so the
    //  brake reads as a single machined block.
    for (let i = 0; i < n; i++)
    {
        const x = (i - (n - 1) / 2) * spread;
        plate(g, x - wHalf + 1, brakeTop + 2, (wHalf - 1) * 2, brakeH - 4, 3, true);
    }

    bar(g, -brakeHalf + 5, brakeTop + brakeH - 4, (brakeHalf - 5) * 2, 2.5, 1.2, pal.edge, 0.6);

    //  Pierce chamfers every port into a lance point -- same plate, same edge,
    //  just a sharper end on the block that was already there.
    if (L.lance > 0)
    {
        const s = bank('lance');
        const reach = 9 + Math.min(18, L.lance * 3.6);

        for (let i = 0; i < n; i++)
        {
            const x = (i - (n - 1) / 2) * spread;
            const base = wHalf * 0.85;

            poly(s, [ x - base, brakeTop + 3, x + base, brakeTop + 3, x, brakeTop - reach ], true);
            slot(s, x - 1.5, brakeTop - reach * 0.45, 3, 4, pal.heat);
        }
    }

    //  Arc posts on the ends of the brake. The lightning between them is
    //  redrawn every frame, so the gun crackles between shots.
    if (L.coils > 0)
    {
        const c = bank('coils');
        const reach = brakeHalf + 6 + Math.min(16, L.coils * 2.2);
        const y = brakeTop + brakeH * 0.4;

        for (const side of [ -1, 1 ])
        {
            const x = side * reach;

            //  Bracketed back to the brake, never floating beside it.
            strut(c, [ side * brakeHalf, y, x, y ], 7, pal);
            plate(c, x - 6, y - 13, 12, 24, 4, true);
            dot(c, x, y - 6, 7, pal.heat, 0.3);
            dot(c, x, y - 6, 4, pal.heat, 1);
        }

        plan.coils = { reach, y: y - 6 };
    }
}
