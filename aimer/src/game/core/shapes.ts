import type { GameObjects } from 'phaser';

/**
 * The silhouettes a target can be cut in.
 *
 * A skin is allowed to change what the rank and file are *shaped* like, not
 * just what colour they are -- a bought skin that only swapped a hue would be
 * invisible from a metre away, which is the distance most of this game is
 * played at. Every shape is authored around the same radius the hit test uses,
 * so nothing here ever changes how hard a target is to tap.
 */
export type BodyShape = 'circle' | 'hex' | 'diamond' | 'star' | 'chip';

const TAU = Math.PI * 2;

/**
 * How much bigger a shape is drawn so it reads at the same weight as a disc.
 *
 * Capped just under the life ring at 1.22r: the ring is where a target visibly
 * ends, and a body drawn past it would look bigger than the circle the tap
 * test actually uses -- a target that lies about its own size.
 */
const BULK: Record<BodyShape, number> = {
    circle: 1,
    hex: 1.06,
    diamond: 1.18,
    star: 1.18,
    chip: 1.05
};

/**
 * How much of the radius a glyph drawn on top of the body can use.
 *
 * A circle can carry an icon out to its edge; a star cannot -- the corners of
 * the glyph would hang off the arms and sit on the background. Each shape
 * reports the largest square that actually fits inside it.
 */
export const MARK_FIT: Record<BodyShape, number> = {
    circle: 1,
    hex: 0.94,
    diamond: 0.74,
    star: 0.58,
    chip: 0.96
};

/** Traces the outline into the graphics' current path. */
function path (g: GameObjects.Graphics, shape: BodyShape, r: number, rot: number): void
{
    const R = r * BULK[shape];

    if (shape === 'star')
    {
        g.beginPath();

        for (let i = 0; i < 10; i++)
        {
            const rad = i % 2 ? R * 0.46 : R;
            const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
            const x = Math.cos(a) * rad;
            const y = Math.sin(a) * rad;

            i ? g.lineTo(x, y) : g.moveTo(x, y);
        }

        g.closePath();
        return;
    }

    const sides = shape === 'diamond' ? 4 : (shape === 'chip' ? 8 : 6);
    const spin = rot + (shape === 'diamond' ? 0 : Math.PI / sides);

    g.beginPath();

    for (let i = 0; i < sides; i++)
    {
        const a = spin - Math.PI / 2 + (i * TAU) / sides;
        const x = Math.cos(a) * R;
        const y = Math.sin(a) * R;

        i ? g.lineTo(x, y) : g.moveTo(x, y);
    }

    g.closePath();
}

/** Fills the body at the graphics' origin. Colour is set by the caller. */
export function fillBody (g: GameObjects.Graphics, shape: BodyShape, r: number, rot = 0): void
{
    if (shape === 'circle')
    {
        g.fillCircle(0, 0, r);
        return;
    }

    path(g, shape, r, rot);
    g.fillPath();
}

/** Strokes the same outline. Line style is set by the caller. */
export function strokeBody (g: GameObjects.Graphics, shape: BodyShape, r: number, rot = 0): void
{
    if (shape === 'circle')
    {
        g.strokeCircle(0, 0, r);
        return;
    }

    path(g, shape, r, rot);
    g.strokePath();
}
