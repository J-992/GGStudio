import { GameObjects, Scene } from 'phaser';
import { Target } from '../objects/Target';
import { Fx } from './fx';
import { Sfx } from './audio';
import type { GimmickId, Zone } from '../data/zones';
import type { HazardSpec } from '../data/hazards';
import { MUZZLE, PLAY, W } from './theme';

/**
 * The rule that ships with each zone.
 *
 * Three hooks, all of them no-ops on the training range:
 *
 *   `seedTarget`   stamps a freshly spawned target with whatever the zone does
 *                  to targets -- a warp booked for later, a shield plate.
 *   `tickGimmick`  moves the world, once a frame, the way the zone moves it.
 *   `gimmickIntro` performs the rule once, slowly, with nothing else on screen,
 *                  the first time the player walks into the zone.
 *
 * That last one is the whole teaching budget. There is no tutorial text
 * anywhere in this game and there is not going to be: a rule you have watched
 * happen once, in isolation, on an empty field, is a rule you know.
 */

const CENTER_X = W / 2;
const ARENA_MID = PLAY.top + (PLAY.bottom - PLAY.top) * 0.5;

export interface GimmickCtx
{
    targets: Target[];
    /** Crosswind and field rotation, read straight off the backdrop. */
    wind: number;
    spin: number;
    freeSpot: (radius: number) => { x: number; y: number };
}

/** Kinds that never carry a zone modifier -- they already say something else. */
function plain (t: Target): boolean
{
    return t.kind !== 'bomb' && t.kind !== 'boss';
}

export function seedTarget (gimmick: GimmickId, t: Target, level: number, spec?: HazardSpec): void
{
    if (!plain(t)) return;

    if (gimmick === 'blink' && t.maxLife > 1200)
    {
        t.warpAt = t.maxLife * (0.42 + Math.random() * 0.2);

        //  Deeper in the cavern one warp is not enough: the target keeps
        //  jumping until somebody catches it.
        if (spec && spec.warpEvery > 0) t.warpEvery = spec.warpEvery;
    }
    else if (gimmick === 'shield')
    {
        //  A plate covering a third of the target, turning about once a
        //  second: long enough to wait out, short enough that waiting hurts.
        //  It widens as the zone goes on, until most of the target is armour.
        const grown = Math.min(0.4, Math.max(0, (level - 28) * 0.055));

        t.shieldArc = 0.5 + grown + Math.random() * 0.35;
        t.shieldAngle = Math.random() * Math.PI * 2;
        t.shieldSpin = (Math.random() < 0.5 ? -1 : 1) * (1.1 + level * 0.015);
    }
}

export function tickGimmick (gimmick: GimmickId, ctx: GimmickCtx, dtMs: number): void
{
    const dt = dtMs / 1000;

    if (gimmick === 'drift' && ctx.wind !== 0)
    {
        for (const t of ctx.targets)
        {
            if (t.warded) continue;

            t.x += ctx.wind * dt;

            //  The wind pushes them against the wall, it does not bounce them
            //  off it -- a target pinned to the edge is the wind being visible.
            const r = t.radius;
            if (t.x < PLAY.left + r) t.x = PLAY.left + r;
            else if (t.x > PLAY.right - r) t.x = PLAY.right - r;
        }
    }
    else if (gimmick === 'orbit' && ctx.spin !== 0)
    {
        const a = ctx.spin * dt;
        const cos = Math.cos(a);
        const sin = Math.sin(a);

        for (const t of ctx.targets)
        {
            if (t.warded) continue;

            const dx = t.x - CENTER_X;
            const dy = t.y - ARENA_MID;

            let x = CENTER_X + dx * cos - dy * sin;
            let y = ARENA_MID + dx * sin + dy * cos;

            const r = t.radius;
            x = Math.max(PLAY.left + r, Math.min(PLAY.right - r, x));
            y = Math.max(PLAY.top + r, Math.min(PLAY.bottom - r, y));

            t.setPosition(x, y);
        }
    }
    else if (gimmick === 'blink')
    {
        for (const t of ctx.targets)
        {
            if (t.warded) continue;
            if (t.warpAt < 0 || t.life > t.warpAt) continue;

            const spot = ctx.freeSpot(t.radius);
            t.warp(spot.x, spot.y);
        }
    }
}

//  ------------------------------------------------------------------ intro

function ghost (scene: Scene, x: number, y: number, r: number, color: number): GameObjects.Arc
{
    const c = scene.add.circle(x, y, r, color, 0.85).setDepth(12);
    c.setStrokeStyle(Math.max(2, r * 0.09), 0xffffff, 0.7);
    return c;
}

function arrow (scene: Scene, x: number, y: number, dir: number, color: number): GameObjects.Graphics
{
    const g = scene.add.graphics().setDepth(12);

    g.lineStyle(7, color, 0.8);
    g.beginPath();
    g.moveTo(x - dir * 26, y - 20);
    g.lineTo(x + dir * 26, y);
    g.lineTo(x - dir * 26, y + 20);
    g.strokePath();

    return g;
}

/**
 * Shows the zone's rule happening, once, before the clock starts. Returns how
 * long the scene should wait before handing control back.
 */
export function gimmickIntro (scene: Scene, zone: Zone, fx: Fx): number
{
    const a = zone.palette.accent;
    const a2 = zone.palette.accent2;
    const gone: GameObjects.GameObject[] = [];
    const bin = (...o: GameObjects.GameObject[]) => gone.push(...o);
    const clear = (after: number) => scene.time.delayedCall(after, () => gone.forEach(o => o.destroy()));

    switch (zone.gimmick)
    {
        case 'drift':
        {
            //  A target, and the wind taking it. Three arrows say which way.
            const g = ghost(scene, CENTER_X - 120, ARENA_MID, 34, a);
            bin(g);

            for (let i = 0; i < 3; i++)
            {
                const ar = arrow(scene, CENTER_X - 150 + i * 60, ARENA_MID - 92, 1, a2);
                ar.setAlpha(0);
                bin(ar);
                scene.tweens.add({ targets: ar, alpha: 1, x: 90, duration: 420, delay: i * 90, ease: 'Quad.out' });
                scene.tweens.add({ targets: ar, alpha: 0, duration: 200, delay: 460 + i * 90 });
            }

            scene.tweens.add({
                targets: g, x: CENTER_X + 150, duration: 620, delay: 120, ease: 'Sine.inOut'
            });

            Sfx.chip();
            clear(900);
            return 900;
        }

        case 'blackout':
        {
            //  The lights go, the target does not.
            const shroud = scene.add.rectangle(CENTER_X, PLAY.top + (PLAY.bottom - PLAY.top) / 2,
                W, PLAY.bottom - PLAY.top, 0x000410, 0).setDepth(11);
            const g = ghost(scene, CENTER_X, ARENA_MID, 36, a);
            bin(shroud, g);

            scene.tweens.add({ targets: shroud, fillAlpha: 0.88, duration: 320, ease: 'Quad.in' });
            scene.tweens.add({ targets: g, scale: 1.15, duration: 300, yoyo: true, repeat: 1, ease: 'Sine.inOut' });
            scene.tweens.add({ targets: shroud, fillAlpha: 0, duration: 260, delay: 620, ease: 'Quad.out' });

            scene.time.delayedCall(620, () =>
            {
                scene.cameras.main.flash(180, 220, 235, 255);
                Sfx.bomb();
            });

            clear(1000);
            return 1000;
        }

        case 'blink':
        {
            const g = ghost(scene, CENTER_X - 130, ARENA_MID, 34, a);
            bin(g);

            scene.time.delayedCall(320, () =>
            {
                fx.ring(g.x, g.y, 110, a2, 5, 380);
                g.setPosition(CENTER_X + 130, ARENA_MID);
                fx.ring(g.x, g.y, 110, a2, 5, 380);
                g.setScale(0.15, 1.35);
                scene.tweens.add({ targets: g, scaleX: 1, scaleY: 1, duration: 220, ease: 'Back.out' });
                Sfx.golden();
            });

            clear(900);
            return 900;
        }

        case 'orbit':
        {
            //  The track, then something riding it.
            const track = scene.add.graphics().setDepth(11);
            const radius = Math.min(W, PLAY.bottom - PLAY.top) * 0.3;

            track.lineStyle(4, a2, 0.55);
            track.strokeCircle(CENTER_X, ARENA_MID, radius);

            const g = ghost(scene, CENTER_X + radius, ARENA_MID, 32, a);
            bin(track, g);

            scene.tweens.addCounter({
                from: 0, to: Math.PI * 1.35, duration: 780, delay: 140, ease: 'Sine.inOut',
                onUpdate: (tw: any) =>
                {
                    const th = tw.getValue() as number;
                    g.setPosition(CENTER_X + Math.cos(th) * radius, ARENA_MID + Math.sin(th) * radius);
                }
            });

            Sfx.milestone(1);
            clear(1050);
            return 1050;
        }

        case 'shield':
        {
            //  Two shots: one the plate eats, one that lands once it has turned.
            const g = ghost(scene, CENTER_X, ARENA_MID, 38, a);
            const plate = scene.add.graphics().setDepth(13);
            bin(g, plate);

            let angle = Math.atan2(MUZZLE.y - ARENA_MID, MUZZLE.x - CENTER_X);

            const paint = () =>
            {
                plate.clear();
                plate.lineStyle(11, 0xd8e4ff, 0.95);
                plate.beginPath();
                plate.arc(CENTER_X, ARENA_MID, 54, angle - 0.7, angle + 0.7);
                plate.strokePath();
            };

            paint();

            //  Shot one, straight into the plate.
            scene.time.delayedCall(240, () =>
            {
                fx.tracer(MUZZLE.x, MUZZLE.y - 30, CENTER_X, ARENA_MID + 40, a, 7, 160);
                const p = { x: CENTER_X + Math.cos(angle) * 54, y: ARENA_MID + Math.sin(angle) * 54 };
                fx.burst(p.x, p.y, 0xd8e4ff, 12, 'hit');
                fx.ring(p.x, p.y, 70, 0xd8e4ff, 4, 300);
                Sfx.chip();
            });

            //  The plate turns away.
            scene.tweens.addCounter({
                from: 0, to: Math.PI * 1.15, duration: 520, delay: 360, ease: 'Sine.inOut',
                onUpdate: (tw: any) => { angle = Math.atan2(MUZZLE.y - ARENA_MID, MUZZLE.x - CENTER_X) + (tw.getValue() as number); paint(); }
            });

            //  Shot two, into the gap.
            scene.time.delayedCall(940, () =>
            {
                fx.tracer(MUZZLE.x, MUZZLE.y - 30, CENTER_X, ARENA_MID, a, 7, 160);
                fx.burst(CENTER_X, ARENA_MID, a, 24, 'big');
                fx.ring(CENTER_X, ARENA_MID, 150, a, 6, 400);
                g.setVisible(false);
                plate.setVisible(false);
                Sfx.crit();
            });

            clear(1300);
            return 1300;
        }

        case 'split':
        {
            const g = ghost(scene, CENTER_X, ARENA_MID, 44, a);
            bin(g);

            scene.time.delayedCall(300, () =>
            {
                g.setVisible(false);
                fx.burst(CENTER_X, ARENA_MID, a, 22, 'big');
                Sfx.boom();

                for (const side of [ -1, 1 ])
                {
                    const half = ghost(scene, CENTER_X, ARENA_MID, 26, a2);
                    bin(half);
                    scene.tweens.add({
                        targets: half, x: CENTER_X + side * 120, duration: 420, ease: 'Back.out'
                    });
                }
            });

            clear(1000);
            return 1000;
        }

        default:
            return 0;
    }
}
