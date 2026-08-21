/**
 * Design space, and everything the look of the game is measured against.
 *
 * The game is authored against a fixed design box and FIT-scaled into whatever
 * the host gives it. There are two such boxes:
 *
 *   portrait   540 x 960  -- phones, and the shape the game was designed in.
 *   landscape  720 tall, as wide as the host is -- desktop and the portal's
 *              desktop iframe (836 x 470), where a 9:16 column would leave the
 *              arena a 264px sliver between two black bars.
 *
 * The choice is made once, at load, and never re-made: every scene bakes the
 * layout into object positions at create time, so a live re-flow would be a far
 * bigger machine than the problem it solves. Phaser's FIT mode already absorbs
 * the rest -- a resized window, a rotated phone, the portal changing its iframe.
 *
 * A touch device always gets the portrait box however it is held at that
 * moment, because it can be turned and a desktop window cannot; a phone in
 * landscape gets the rotate prompt instead (see public/style.css).
 */

const PORTRAIT_W = 540;
const PORTRAIT_H = 960;

/** Design height in landscape. 720 puts a 16:9 host at a 1.0-ish scale factor. */
const LANDSCAPE_H = 720;
const LANDSCAPE_MIN_W = 900;
const LANDSCAPE_MAX_W = 1560;

/** Below this the host box is close enough to square that portrait wins. */
const LANDSCAPE_ASPECT = 1.05;

function hostBox (): { w: number; h: number }
{
    if (typeof window === 'undefined') return { w: PORTRAIT_W, h: PORTRAIT_H };

    const el = document.getElementById('game-container');
    const rect = el ? el.getBoundingClientRect() : null;

    //  The container is laid out by flexbox and can still measure 0 at this
    //  point; the window is the honest fallback.
    const w = rect && rect.width > 40 ? rect.width : window.innerWidth;
    const h = rect && rect.height > 40 ? rect.height : window.innerHeight;

    return { w: w || PORTRAIT_W, h: h || PORTRAIT_H };
}

function touchFirst (): boolean
{
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(pointer: coarse)').matches;
}

function pickViewport (): { landscape: boolean; w: number; h: number }
{
    const box = hostBox();
    const aspect = box.w / Math.max(1, box.h);

    if (touchFirst() || aspect < LANDSCAPE_ASPECT)
    {
        return { landscape: false, w: PORTRAIT_W, h: PORTRAIT_H };
    }

    const w = Math.round(Math.min(LANDSCAPE_MAX_W, Math.max(LANDSCAPE_MIN_W, LANDSCAPE_H * aspect)));

    return { landscape: true, w, h: LANDSCAPE_H };
}

const VIEW = pickViewport();

/** True when the game is laid out for a wide screen. */
export const LANDSCAPE = VIEW.landscape;

export const W = VIEW.w;
export const H = VIEW.h;

export const CX = W / 2;
export const CY = H / 2;

/**
 * Top of the HUD label line -- the countdown time and the goal counter. Every
 * other band in the top strip is measured off it, so the whole strip moves as
 * one when landscape tightens it up.
 */
const LABEL_Y = LANDSCAPE ? 78 : 92;

/** Gap from the label line down to the top of the arena. */
const PLAY_GAP = LANDSCAPE ? 124 : 126;

/**
 * The top strip of the play screen.
 *
 * It used to carry five separate progress readouts stacked on top of each
 * other -- rank bar, zone route rail, countdown bar, goal bar, and a six-gem
 * streak track with its own caption -- and they ran into each other. Three of
 * them are gone:
 *
 *   the route rail  -- world progress is the whole point of the gate screen
 *                      between worlds, and it was a 40px stub here.
 *   the goal bar    -- the goal is a small whole number. "6 / 18" says it
 *                      better than nine pixels of fill ever did.
 *   the streak gems -- the combo readout in the middle of the strip was
 *                      already saying the same thing, louder.
 *
 * What is left is two bars that mean two different things: the rank bar on the
 * very top edge, which fills all run, and the countdown, which empties every
 * level. Everything else in the strip is a number.
 */
export const HUD = {
    margin: LANDSCAPE ? 40 : 30,
    /**
     * The rank bar, pinned to the very top edge of the frame and running the
     * whole width of it. It is the one readout that is filling at all times, so
     * it gets the one place on screen nothing else wants.
     */
    xpY: 0,
    xpH: LANDSCAPE ? 8 : 9,
    /** Rank chip, top left. Coins sit opposite it. */
    rankY: LANDSCAPE ? 26 : 30,
    levelY: LANDSCAPE ? 26 : 30,
    scoreY: LANDSCAPE ? 52 : 62,
    scoreSize: LANDSCAPE ? 46 : 54,
    labelY: LABEL_Y,
    /** Countdown bar: top edge and height. The only bar in the strip. */
    barY: LABEL_Y + 14,
    barH: 22,
    /** The combo readout, and the streak caption under it. */
    comboY: LABEL_Y + 64,
    streakTextY: LABEL_Y + 104,
    /** Right edge of the bar, and of the stopwatch cap that ends it. */
    barRight: W - (LANDSCAPE ? 68 : 58),
    /** Bottom line -- only the mute button and the skip pill. */
    footerY: H - 46
};

/** Safe playfield rectangle. Targets never spawn outside of this. */
export const PLAY = {
    left: LANDSCAPE ? 60 : 46,
    right: W - (LANDSCAPE ? 60 : 46),
    /** Clear of the combo readout that now ends the top strip. */
    top: LABEL_Y + PLAY_GAP,
    bottom: H - 94
};

/** Where shots originate from -- the turret's barrel pivot. */
export const MUZZLE = { x: W / 2, y: H - 6 };

/**
 * How far off vertical the barrel may swing. A wide arena puts its bottom
 * corners almost level with the muzzle, and a barrel that stops short of where
 * the tracer goes reads as a bug.
 */
export const AIM_LIMIT = LANDSCAPE ? 1.4 : 1.15;

/**
 * How big the gun is drawn. The weapon is authored in portrait units; the
 * landscape box is 240 design pixels shorter, so the identical gun would eat a
 * third more of the arena there.
 */
export const GUN_SCALE = LANDSCAPE ? 0.82 : 1;

/**
 * How much more room the arena has than the portrait one it was balanced in.
 * Spawn counts scale by this so a wide screen is not a near-empty field.
 */
export const DENSITY = Math.min(1.5, Math.max(1,
    ((PLAY.right - PLAY.left) * (PLAY.bottom - PLAY.top)) /
    ((PORTRAIT_W - 92) * (PORTRAIT_H - 94 - (92 + 126)))
));

export const FONT = '"Arial Black", "Arial Bold", Arial, sans-serif';
export const FONT_UI = 'Arial, Helvetica, sans-serif';

/**
 * A world's colour set. The table of them lives in `data/zones`, next to the
 * rule that ships with each one -- look and law change together or not at all.
 */
export interface Tier
{
    bg: number;
    grid: number;
    accent: number;
    accent2: number;
    dust: number;
}

/** 0xrrggbb -> '#rrggbb' (Phaser text colours want strings). */
export function hex (c: number): string
{
    return '#' + c.toString(16).padStart(6, '0');
}

export function fmt (n: number): string
{
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Short form for very large numbers (score can get silly late in a run). */
export function fmtShort (n: number): string
{
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M';
    return fmt(n);
}

export function mix (a: number, b: number, t: number): number
{
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    return ((ar + (br - ar) * t) << 16 | (ag + (bg - ag) * t) << 8 | (ab + (bb - ab) * t)) & 0xffffff;
}
