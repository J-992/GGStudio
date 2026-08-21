import { GameObjects } from 'phaser';
import { W } from './theme';

/**
 * A one-point perspective camera, and the reason the worlds now have a floor
 * you could walk down.
 *
 * Every backdrop in the game used to be drawn straight onto the screen: a flat
 * grid, a row of rectangles, a wash of colour. It read as wallpaper, because
 * that is what it was. Nothing in it told the player they were anywhere, and
 * nothing in it changed when they got further in.
 *
 * This is the smallest machine that fixes that. World space is three numbers --
 * `wx` across, `wy` up off the ground, `wz` away from the eye -- and a point
 * lands on screen at
 *
 *     k = focal / wz
 *     x = CX + (wx - cam.x) * k
 *     y = horizon + (cam.height - wy) * k
 *
 * which is the whole of it. Everything else here is convenience built on that
 * one divide: quads for the faces of a building, bilinear cells for the windows
 * in those faces, and a receding floor grid.
 *
 * The pay-off is that foreshortening stops being something the art has to fake
 * and becomes something it gets for free. A window row on the side of a tower
 * bunches up towards the vanishing point because the four corners it is
 * interpolated between were projected honestly, not because someone tuned a
 * spacing constant. Move the camera sideways and the near buildings slide
 * further than the far ones, because they do.
 */

export interface Cam
{
    /** Eye position across the world. Sliding it is a parallax pan. */
    x: number;
    /** Eye height above the ground plane, in world units. */
    height: number;
    /** Bigger is a longer lens: less spread, more compression. */
    focal: number;
    /** Screen y the vanishing point sits on. */
    horizon: number;
    /**
     * How far the world has travelled towards the eye. Kept on the camera
     * rather than on every object so a whole city can be scrolled with one
     * number and wrapped with one modulo.
     */
    z: number;
}

export interface P { x: number; y: number; }

/** A projected face: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [ P, P, P, P ];

/** Closer than this and a point is behind the eye; the maths stops meaning anything. */
const NEAR = 6;

export function project (cam: Cam, wx: number, wy: number, wz: number): P
{
    const k = cam.focal / Math.max(NEAR, wz);

    return {
        x: W / 2 + (wx - cam.x) * k,
        y: cam.horizon + (cam.height - wy) * k
    };
}

/** How much a thing at this depth shrinks. Handy for line widths and alpha. */
export function scaleAt (cam: Cam, wz: number): number
{
    return cam.focal / Math.max(NEAR, wz);
}

export function lerpP (a: P, b: P, t: number): P
{
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A point inside a quad, in its own 0..1 across / 0..1 down coordinates. */
export function inQuad (q: Quad, u: number, v: number): P
{
    const top = lerpP(q[0], q[1], u);
    const bottom = lerpP(q[3], q[2], u);

    return lerpP(top, bottom, v);
}

export function fillQuad (g: GameObjects.Graphics, q: Quad, color: number, alpha: number): void
{
    if (alpha <= 0.002) return;

    g.fillStyle(color, alpha);
    g.fillPoints([ q[0], q[1], q[2], q[3] ] as unknown as Phaser.Math.Vector2[], true);
}

export function strokeQuad (g: GameObjects.Graphics, q: Quad, width: number, color: number, alpha: number): void
{
    if (alpha <= 0.002) return;

    g.lineStyle(width, color, alpha);
    g.strokePoints([ q[0], q[1], q[2], q[3], q[0] ] as unknown as Phaser.Math.Vector2[], true);
}

/**
 * One cell of a quad, in the quad's own coordinates -- this is what makes a
 * window on a receding wall a *foreshortened* window rather than a rectangle
 * pasted onto one.
 */
export function fillCell (
    g: GameObjects.Graphics, q: Quad,
    u0: number, u1: number, v0: number, v1: number,
    color: number, alpha: number
): void
{
    if (alpha <= 0.002) return;

    fillQuad(g, [
        inQuad(q, u0, v0), inQuad(q, u1, v0), inQuad(q, u1, v1), inQuad(q, u0, v1)
    ], color, alpha);
}

/** True when a quad is worth the draw call at all. */
export function quadVisible (q: Quad, w: number, h: number): boolean
{
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const p of q)
    {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    if (maxX < -60 || minX > w + 60 || maxY < -60 || minY > h + 60) return false;

    //  Sub-pixel slivers cost the same as a tower and show up as nothing.
    return (maxX - minX) > 0.7 && (maxY - minY) > 0.7;
}

/**
 * An axis-aligned box on the ground, as the two faces of it the eye can
 * actually see. The near face always; the side face only when the box is off
 * to one side, which is exactly when there is a side to see.
 */
export interface Box
{
    /** Left and right edges across the world. */
    x0: number;
    x1: number;
    /** Near and far edges in depth. */
    z0: number;
    z1: number;
    /** Height off the ground. */
    h: number;
}

export interface BoxFaces
{
    front: Quad;
    /** Null when the box is dead ahead and presents no side. */
    side: Quad | null;
    /** Null when the box is taller than the eye -- you cannot see its roof. */
    roof: Quad | null;
    /** Depth of the near face, for sorting and fogging. */
    depth: number;
}

export function boxFaces (cam: Cam, b: Box): BoxFaces
{
    const front: Quad = [
        project(cam, b.x0, b.h, b.z0),
        project(cam, b.x1, b.h, b.z0),
        project(cam, b.x1, 0, b.z0),
        project(cam, b.x0, 0, b.z0)
    ];

    //  The eye sees the left flank of anything to its right, and vice versa.
    let side: Quad | null = null;

    if (b.x0 > cam.x)
    {
        side = [
            project(cam, b.x0, b.h, b.z1),
            project(cam, b.x0, b.h, b.z0),
            project(cam, b.x0, 0, b.z0),
            project(cam, b.x0, 0, b.z1)
        ];
    }
    else if (b.x1 < cam.x)
    {
        side = [
            project(cam, b.x1, b.h, b.z0),
            project(cam, b.x1, b.h, b.z1),
            project(cam, b.x1, 0, b.z1),
            project(cam, b.x1, 0, b.z0)
        ];
    }

    const roof: Quad | null = b.h < cam.height
        ? [
            project(cam, b.x0, b.h, b.z1),
            project(cam, b.x1, b.h, b.z1),
            project(cam, b.x1, b.h, b.z0),
            project(cam, b.x0, b.h, b.z0)
        ]
        : null;

    return { front, side, roof, depth: b.z0 };
}

/**
 * The floor, running away to the vanishing point.
 *
 * The rungs are placed at fixed world depths and scrolled by the camera, so
 * they bunch up towards the horizon on their own and the whole plane reads as
 * moving *through* rather than *past*. This one function is most of the reason
 * the arena now has a floor instead of a graph-paper background.
 */
export function floorGrid (
    g: GameObjects.Graphics, cam: Cam,
    opts: {
        /** Half-width of the marked floor, in world units. */
        half: number;
        /** World gap between rungs. */
        step: number;
        /** How far back the floor is drawn. */
        far: number;
        color: number;
        alpha: number;
        /** Number of lines running away from the eye. */
        rails?: number;
        /** Screen height, so a rung below the frame can be skipped. */
        height: number;
    }
): void
{
    const { half, step, far, color, alpha, height } = opts;
    const rails = opts.rails ?? 5;

    //  Rails: straight lines in world space, so they converge on their own.
    for (let i = 0; i <= rails; i++)
    {
        const wx = -half + (2 * half * i) / rails;
        const a = project(cam, wx, 0, step);
        const b = project(cam, wx, 0, far);

        g.lineStyle(1.5, color, alpha * 0.8);
        g.lineBetween(a.x, a.y, b.x, b.y);
    }

    //  Rungs, scrolled towards the eye and wrapped.
    const off = ((cam.z % step) + step) % step;

    for (let z = step - off; z < far; z += step)
    {
        const a = project(cam, -half, 0, z);
        const b = project(cam, half, 0, z);

        if (a.y > height + 40) continue;

        //  Fade with depth, so the far end dissolves rather than stopping.
        const fade = 1 - z / far;

        g.lineStyle(1 + fade * 1.6, color, alpha * (0.15 + fade * 0.85));
        g.lineBetween(a.x, a.y, b.x, b.y);
    }
}
