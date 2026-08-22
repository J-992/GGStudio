import { GameObjects, Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { iconImage } from '../core/icons';
import { meta } from '../core/state';
import { FINAL_LEVEL } from '../data/levels';
import { ZONES, ZoneProgress, currentZone, worldProgress } from '../data/zones';
import { dismiss, shell } from './StoreModal';
import { FONT, FONT_UI, LANDSCAPE, W, hex, mix } from '../core/theme';

/**
 * The run, on the menu, as a place the player is somewhere inside of.
 *
 * The menu already knew how far they had got -- it said so, as "BEST LEVEL
 * 24/40", which is a number nobody has any feeling about. A run is not forty
 * numbered levels, it is seven *places* (see data/zones), and a player who has
 * fought their way into the reactor should be looking at a reactor they have
 * lit up and two dark worlds past it they have never seen.
 *
 * So the same save number is drawn instead as a route: seven stops, the ones
 * behind them burning in their own world's colour, the one they are working on
 * pulsing, and the ones ahead named but dark. The dark stops are the whole
 * point -- CRIMSON END sitting there unlit is a better reason to press PLAY
 * than any number could be.
 *
 * The rail is a summary and stays a summary. Everything it cannot say -- what
 * each place *does* to you, how many levels are left in it, what clearing the
 * next one unlocks -- is one tap away on the full map.
 */

const DIM_NODE = 0x2a3352;
const DIM_TEXT = '#3c4569';
const RAIL_DARK = 0x1a2138;

export interface TrailLayout
{
    /** Centre line of the column the rail lives in. */
    x: number;
    /** The caption line above the rail. */
    headY: number;
    /** The rail itself. */
    railY: number;
    /** World names, under the stops. */
    nameY: number;
    /** How wide the whole route is drawn. */
    width: number;
}

/**
 * How far along the rail the lit part reaches, in stops.
 *
 * Whole numbers land exactly on a stop; the fraction is how much of the
 * current world is behind them, so the line creeps forward every level rather
 * than jumping once per world and then sitting still for seven of them.
 */
function railPos (progress: ZoneProgress[]): number
{
    const here = currentZone(meta.bestLevel).index;
    return Math.min(ZONES.length - 1, here + progress[here].frac);
}

/** The colour a world is drawn in, given how far into it the player is. */
function tone (p: ZoneProgress): number
{
    if (p.cleared) return mix(p.zone.palette.accent, 0xffffff, 0.25);
    if (p.reached) return p.zone.palette.accent;
    return DIM_NODE;
}

/**
 * The route, drawn once. Nothing on it changes while the menu is up -- the
 * save it reads from cannot move until a run has been played -- so it is built
 * and left alone rather than kept around behind an object.
 */
export function buildWorldTrail (scene: Scene, fx: Fx, layout: TrailLayout): void
{
    const progress = worldProgress(meta.bestLevel);
    const here = currentZone(meta.bestLevel).index;
    const beaten = meta.bestLevel >= FINAL_LEVEL;

    const span = layout.width;
    const gap = span / (ZONES.length - 1);
    const x0 = layout.x - span / 2;
    const pos = railPos(progress);

    //  Where they are and how much of it is left, in the world's own colour.
    const p = progress[here];

    scene.add.text(x0, layout.headY, beaten ? 'RUN COMPLETE' : `${p.zone.name}  ${p.done}/${p.total}`, {
        fontFamily: FONT, fontSize: 13, color: hex(beaten ? 0xffd23f : p.zone.palette.accent)
    }).setOrigin(0, 0.5).setDepth(10);

    scene.add.text(x0 + span, layout.headY, 'WORLD MAP  ›', {
        fontFamily: FONT_UI, fontSize: 11, color: '#5f6a92'
    }).setOrigin(1, 0.5).setDepth(10);

    const g = scene.add.graphics().setDepth(10);

    g.lineStyle(4, RAIL_DARK, 1);
    g.lineBetween(x0, layout.railY, x0 + span, layout.railY);

    //  The lit run, drawn one leg at a time so each leg wears the colour of the
    //  world it leads *out of* -- the rail changes colour under the player
    //  exactly where the game did.
    for (let i = 0; i < ZONES.length - 1 && pos > i; i++)
    {
        const t = Math.min(1, pos - i);

        g.lineStyle(4, ZONES[i].palette.accent, 0.9);
        g.lineBetween(x0 + i * gap, layout.railY, x0 + (i + t) * gap, layout.railY);
    }

    const nameSize = span >= 400 ? 10 : 9;

    progress.forEach((q, i) =>
    {
        const x = x0 + i * gap;
        const color = tone(q);

        //  A stop the player has finished is filled solid; the one they are
        //  standing in is a bigger ring with a hole in it, because an empty
        //  middle reads as unfinished business at any size.
        if (q.cleared)
        {
            g.fillStyle(color, 1);
            g.fillCircle(x, layout.railY, 7);
        }
        else if (q.reached)
        {
            g.fillStyle(0x080b1c, 1);
            g.fillCircle(x, layout.railY, 8);
            g.lineStyle(3, color, 1);
            g.strokeCircle(x, layout.railY, 8);
        }
        else
        {
            g.fillStyle(DIM_NODE, 1);
            g.fillCircle(x, layout.railY, 5);
        }

        if (i === here && !beaten) pulse(scene, x, layout.railY, q.zone.palette.accent);

        scene.add.text(x, layout.nameY, q.zone.short, {
            fontFamily: FONT_UI, fontSize: nameSize,
            color: q.reached ? hex(mix(color, 0xffffff, 0.35)) : DIM_TEXT
        }).setOrigin(0.5).setDepth(10);
    });

    buildHit(scene, fx, layout, span);
}

/** The travelling halo on the stop the player is actually standing in. */
function pulse (scene: Scene, x: number, y: number, color: number): void
{
    const halo = scene.add.circle(x, y, 13, color, 0).setDepth(9);

    halo.setStrokeStyle(2, color, 0.9);

    //  1.5 puts the widest it ever gets just under the caption line above the
    //  rail. Anything larger swings a ring through the world's name.
    scene.tweens.add({ targets: halo, scale: 1.5, alpha: 0, duration: 1200, repeat: -1 });
}

/**
 * One hit box over the whole strip rather than seven over the stops. A
 * six-pixel dot is not a tap target, and every stop leads to the same screen
 * anyway.
 */
function buildHit (scene: Scene, fx: Fx, layout: TrailLayout, span: number): void
{
    const top = layout.headY - 14;
    const bottom = layout.nameY + 12;
    const w = span + 44;
    const h = bottom - top;

    const hit = scene.add.rectangle(layout.x, (top + bottom) / 2, w, h, 0x000000, 0).setDepth(11);

    hit.setInteractive({
        hitArea: new Geom.Rectangle(0, 0, w, h),
        hitAreaCallback: Geom.Rectangle.Contains,
        useHandCursor: true
    });

    hit.on('pointerdown', () =>
    {
        unlockAudio();
        Sfx.ui();
        fx.ring(layout.x, layout.railY, span * 0.7, currentZone(meta.bestLevel).palette.accent, 4, 380);
        openWorldMap(scene);
    });
}

//  ------------------------------------------------------------- the full map

interface RowMetrics
{
    rowH: number;
    badgeY: number;
    badgeR: number;
    rangeY: number;
    nameY: number;
    subY: number;
    barY: number;
    nameSize: number;
    statusSize: number;
    barH: number;
}

const M: RowMetrics = LANDSCAPE
    ? { rowH: 66, badgeY: -10, badgeR: 15, rangeY: 12, nameY: -16, subY: 4, barY: 21, nameSize: 18, statusSize: 13, barH: 5 }
    : { rowH: 78, badgeY: -12, badgeR: 17, rangeY: 14, nameY: -19, subY: 2, barY: 22, nameSize: 19, statusSize: 14, barH: 6 };

const HEAD_H = LANDSCAPE ? 110 : 142;
const FOOT_H = LANDSCAPE ? 54 : 70;

/**
 * Text that is never allowed to run into what is beside it.
 *
 * The rule sentences come out of the zone table and are as long as they need
 * to be to say what a place does -- the longest is fifty-three characters, and
 * the row it has to fit in is a different width in every layout the game runs
 * in. Rather than pick a font size that happens to work for today's table and
 * hope, the size steps down until the line measures short enough to fit.
 */
function fitText (text: GameObjects.Text, width: number, size: number, min = 8): GameObjects.Text
{
    let px = size;

    while (px > min && text.width > width)
    {
        px -= 1;
        text.setFontSize(px);
    }

    return text;
}

/**
 * The whole run, one world per row: what each place is called, what it does to
 * you, and how much of it is behind you.
 *
 * The locked rows are written out in as much detail as the cleared ones except
 * for the one sentence that would spoil them -- a player can read that HIGH
 * ORBIT is called SHIELD and starts at level 28, and has to go there to find
 * out what that means. A row that said nothing at all would be a row nobody
 * wants.
 */
export function openWorldMap (scene: Scene): void
{
    const progress = worldProgress(meta.bestLevel);
    const here = currentZone(meta.bestLevel).index;
    const beaten = meta.bestLevel >= FINAL_LEVEL;

    const w = LANDSCAPE ? Math.min(680, W - 80) : Math.min(496, W - 28);
    const h = HEAD_H + ZONES.length * M.rowH + FOOT_H;
    const top = -h / 2;
    const accent = beaten ? 0xffd23f : ZONES[here].palette.accent;

    const { card, close } = shell(scene, { w, h, accent }, 0.9, true);

    card.add(scene.add.text(0, top + (LANDSCAPE ? 38 : 46), 'WORLD MAP', {
        fontFamily: FONT, fontSize: LANDSCAPE ? 30 : 34, color: '#ffffff'
    }).setOrigin(0.5));

    card.add(scene.add.text(0, top + (LANDSCAPE ? 66 : 78), `${meta.bestLevel} OF ${FINAL_LEVEL} LEVELS CLEARED`, {
        fontFamily: FONT_UI, fontSize: 12, color: '#8d97bd'
    }).setOrigin(0.5));

    //  One bar for the whole run, above the seven that break it down. It is the
    //  old "BEST LEVEL 24/40" stat, finally drawn as a distance.
    const barW = w - 72;
    const barY = top + (LANDSCAPE ? 90 : 104);
    const overall = scene.add.graphics();

    overall.fillStyle(RAIL_DARK, 1);
    overall.fillRoundedRect(-barW / 2, barY, barW, 8, 4);

    //  Nothing cleared draws nothing at all -- a rounded nub of gold at the
    //  left end would tell a player who has never finished a level that they
    //  are already on their way.
    if (meta.bestLevel > 0)
    {
        overall.fillStyle(accent, 0.95);
        overall.fillRoundedRect(-barW / 2, barY, Math.max(8, barW * (meta.bestLevel / FINAL_LEVEL)), 8, 4);
    }

    card.add(overall);

    const y0 = top + HEAD_H + M.rowH / 2;

    progress.forEach((p, i) => card.add(worldRow(scene, p, w, y0 + i * M.rowH, i === here && !beaten)));

    dismiss(scene, card, h / 2 - (LANDSCAPE ? 26 : 34), 'CLOSE', () => close());
}

function worldRow (scene: Scene, p: ZoneProgress, w: number, y: number, now: boolean): GameObjects.Container
{
    const z = p.zone;
    const row = scene.add.container(0, y);
    const color = tone(p);
    const rw = w - 32;
    const rh = M.rowH - 8;
    const left = -rw / 2;
    const right = rw / 2;

    const g = scene.add.graphics();
    g.fillStyle(p.reached ? 0x0d1428 : 0x080c1a, 0.85);
    g.fillRoundedRect(left, -rh / 2, rw, rh, 14);

    if (now)
    {
        g.fillStyle(color, 0.1);
        g.fillRoundedRect(left, -rh / 2, rw, rh, 14);
    }

    g.lineStyle(2, p.reached ? color : 0x232b45, now ? 1 : 0.55);
    g.strokeRoundedRect(left, -rh / 2, rw, rh, 14);
    row.add(g);

    //  The badge says which of the three states this world is in without a
    //  word: a tick behind you, a number under your feet, a padlock ahead.
    const bx = left + 18 + M.badgeR;

    g.fillStyle(color, p.reached ? 0.18 : 0.1);
    g.fillCircle(bx, M.badgeY, M.badgeR);
    g.lineStyle(2, color, p.reached ? 0.95 : 0.5);
    g.strokeCircle(bx, M.badgeY, M.badgeR);

    if (p.cleared)
    {
        row.add(iconImage(scene, bx, M.badgeY, 'check', { size: M.badgeR * 1.25, color }));
    }
    else if (p.reached)
    {
        row.add(scene.add.text(bx, M.badgeY, `${z.index + 1}`, {
            fontFamily: FONT, fontSize: M.badgeR + 3, color: hex(color)
        }).setOrigin(0.5));
    }
    else
    {
        row.add(iconImage(scene, bx, M.badgeY, 'lock', { size: M.badgeR * 1.2, color: 0x4a5478 }));
    }

    row.add(scene.add.text(bx, M.rangeY, `L${z.from}-${z.to}`, {
        fontFamily: FONT_UI, fontSize: 9, color: p.reached ? '#7d88b0' : DIM_TEXT
    }).setOrigin(0.5));

    //  Everything but the badge lives in one column that runs to the right edge
    //  of the row. The status is the only thing that shares a line with the
    //  name, so the rule underneath gets the full width to itself.
    const tx = bx + M.badgeR + 14;
    const tw = right - 18 - tx;

    const status = p.cleared ? 'CLEARED' : (p.reached ? `${p.done} / ${p.total}` : 'LOCKED');

    const statusText = scene.add.text(right - 18, M.nameY, status, {
        fontFamily: FONT, fontSize: M.statusSize,
        color: hex(p.cleared ? 0x6cf5c8 : (p.reached ? color : 0x4a5478))
    }).setOrigin(1, 0.5);

    row.add(statusText);

    row.add(fitText(scene.add.text(tx, M.nameY, z.name, {
        fontFamily: FONT, fontSize: M.nameSize, color: hex(p.reached ? color : 0x4a5478)
    }).setOrigin(0, 0.5), tw - statusText.width - 12, M.nameSize, 12));

    //  What the place does, in the words the gate uses -- but only once they
    //  have been there. Ahead of that they get the name of the rule and the
    //  level it starts at, which is the tease, not the answer.
    const sub = p.reached ? `${z.rule}  ·  ${z.ruleText}` : `${z.rule}  ·  REACH LEVEL ${z.from} TO UNLOCK`;

    row.add(fitText(scene.add.text(tx, M.subY, sub, {
        fontFamily: FONT_UI, fontSize: 11, color: p.reached ? '#8d97bd' : '#5a6386'
    }).setOrigin(0, 0.5), tw, 11));

    //  The row's own progress, as an underline the whole width of it. Seven of
    //  these stacked up is the same picture the rail on the menu draws, with
    //  the numbers filled in.
    const bar = scene.add.graphics();

    bar.fillStyle(RAIL_DARK, 1);
    bar.fillRoundedRect(tx, M.barY, tw, M.barH, M.barH / 2);

    if (p.done > 0)
    {
        bar.fillStyle(color, 0.95);
        bar.fillRoundedRect(tx, M.barY, Math.max(M.barH, tw * p.frac), M.barH, M.barH / 2);
    }

    row.add(bar);

    //  The same travelling halo the rail uses, on the badge of the world the
    //  player is actually in -- the two readouts have to agree at a glance.
    if (now)
    {
        const halo = scene.add.circle(bx, M.badgeY, M.badgeR + 4, color, 0);

        halo.setStrokeStyle(2, color, 0.9);
        row.add(halo);

        scene.tweens.add({ targets: halo, scale: 1.35, alpha: 0, duration: 1200, repeat: -1 });
    }

    return row;
}
