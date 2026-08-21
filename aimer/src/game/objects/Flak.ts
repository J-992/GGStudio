import { GameObjects, Scene } from 'phaser';
import { MUZZLE, PLAY, mix } from '../core/theme';

/**
 * A bolt on its way to the gun.
 *
 * It is the only thing in the run that attacks the player rather than the
 * clock directly, and it is deliberately slow, loud and telegraphed: a warning
 * marker sits on the rim for most of a second before anything is fired, and
 * the bolt itself trails a tail the length of half the arena. Everything about
 * it says "there is time to shoot this down", because there always is.
 *
 * Shoot it and it pops for score. Ignore it and it takes seconds off the
 * clock, which in a game whose only fail state is the clock is the same thing
 * as damage -- without ever taking the run out of the player's hands.
 */

/** How long the warning marker sits on the rim before the bolt launches. */
const TELEGRAPH = 620;

/** Tap radius. Generous: this is a threat, not a precision test. */
export const FLAK_RADIUS = 19;

export class Flak
{
    x: number;
    y: number;
    dead = false;
    /** True once the warning has run out and the bolt is actually moving. */
    live = false;

    private vx = 0;
    private vy = 0;
    private wait = TELEGRAPH;
    private gfx: GameObjects.Graphics;
    private color: number;
    private hot: number;
    private trail: { x: number; y: number }[] = [];

    constructor (scene: Scene, accent: number, speed: number)
    {
        this.color = mix(accent, 0xff3b45, 0.55);
        this.hot = mix(this.color, 0xffffff, 0.6);

        //  Launched from the rim of the arena, never from behind the gun.
        const side = Math.random();

        if (side < 0.5)
        {
            this.x = PLAY.left + 20 + Math.random() * (PLAY.right - PLAY.left - 40);
            this.y = PLAY.top + 8;
        }
        else
        {
            this.x = side < 0.75 ? PLAY.left + 8 : PLAY.right - 8;
            this.y = PLAY.top + 20 + Math.random() * (PLAY.bottom - PLAY.top) * 0.45;
        }

        //  Aimed at the gun, with a little scatter so a salvo fans out.
        const a = Math.atan2(MUZZLE.y - 40 - this.y, MUZZLE.x - this.x) + (Math.random() - 0.5) * 0.22;

        this.vx = Math.cos(a) * speed;
        this.vy = Math.sin(a) * speed;

        this.gfx = scene.add.graphics().setDepth(13);
    }

    /** Returns true when the bolt has just reached the gun. */
    update (dtMs: number): boolean
    {
        const dt = dtMs / 1000;

        if (!this.live)
        {
            this.wait -= dtMs;

            if (this.wait <= 0) this.live = true;

            this.draw();
            return false;
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;

        this.trail.unshift({ x: this.x, y: this.y });
        if (this.trail.length > 9) this.trail.pop();

        this.draw();

        //  It only ever lands on the gun. Anything that sails past the bottom
        //  of the arena has missed, and misses cost the player nothing.
        if (this.y >= MUZZLE.y - 46) return true;

        return this.x < PLAY.left - 120 || this.x > PLAY.right + 120 || this.y > MUZZLE.y;
    }

    /** True when the bolt is close enough to the gun to count as a hit. */
    get landed (): boolean
    {
        return this.y >= MUZZLE.y - 46;
    }

    contains (px: number, py: number, forgiveness: number): boolean
    {
        const r = FLAK_RADIUS * forgiveness + 6;
        const dx = px - this.x;
        const dy = py - this.y;

        return dx * dx + dy * dy <= r * r;
    }

    /**
     * The bolt's silhouette: a dart, nose forward along its own flight path.
     *
     * It used to be a disc with three blades turning around it, and a disc is
     * the one shape this game already uses for everything the player is
     * supposed to *shoot* -- so the thing shooting back read as one more
     * target. A dart cannot be mistaken for one: it is all point, it is the
     * only thing on screen with a direction, and the direction it has is the
     * answer to the only question the player is asking about it.
     *
     * The back edge is notched rather than flat, which is what stops it
     * reading as a plain triangle and starts it reading as an arrowhead.
     */
    private dart (fwd: number): { x: number; y: number }[]
    {
        const a = Math.atan2(this.vy, this.vx);
        const cos = Math.cos(a);
        const sin = Math.sin(a);

        const at = (along: number, across: number) => ({
            x: this.x + cos * along - sin * across,
            y: this.y + sin * along + cos * across
        });

        return [
            at(FLAK_RADIUS * 2.0 * fwd, 0),                             // nose
            at(-FLAK_RADIUS * 0.95 * fwd, FLAK_RADIUS * 0.92 * fwd),    // barb
            at(-FLAK_RADIUS * 0.28 * fwd, 0),                           // notch
            at(-FLAK_RADIUS * 0.95 * fwd, -FLAK_RADIUS * 0.92 * fwd)    // barb
        ];
    }

    /** Two triangles rather than one concave path, so the fill never folds. */
    private fillDart (g: GameObjects.Graphics, p: { x: number; y: number }[], color: number, alpha: number): void
    {
        g.fillStyle(color, alpha);
        g.fillTriangle(p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y);
        g.fillTriangle(p[0].x, p[0].y, p[2].x, p[2].y, p[3].x, p[3].y);
    }

    private draw (): void
    {
        const g = this.gfx;
        g.clear();

        if (this.dead) return;

        if (!this.live)
        {
            //  The warning: a ring closing on the launch point, a line along
            //  the path the bolt is about to take, and the dart itself already
            //  sitting there, small, growing into the real one.
            const t = 1 - Math.max(0, this.wait) / TELEGRAPH;
            const r = 34 - t * 18;

            g.lineStyle(3, this.color, 0.35 + t * 0.6);
            g.strokeCircle(this.x, this.y, r);

            g.lineStyle(2, this.color, 0.25 + t * 0.4);
            g.lineBetween(this.x, this.y, this.x + this.vx * 0.28, this.y + this.vy * 0.28);

            //  The warning already points where the bolt is going to go: the
            //  same dart, small and hollow, growing into the real one.
            const p = this.dart(0.35 + t * 0.3);

            this.fillDart(g, p, this.hot, 0.3 + t * 0.7);

            return;
        }

        //  The tail, hottest at the head.
        for (let i = this.trail.length - 1; i > 0; i--)
        {
            const a = (1 - i / this.trail.length) * 0.5;

            g.lineStyle(3 + (1 - i / this.trail.length) * 7, this.color, a);
            g.lineBetween(this.trail[i].x, this.trail[i].y, this.trail[i - 1].x, this.trail[i - 1].y);
        }

        const body = this.dart(1);

        //  A soft wash the shape of the dart itself, so the glow has the same
        //  point the bolt does rather than blurring it back into a blob.
        this.fillDart(g, this.dart(1.22), this.color, 0.26);
        this.fillDart(g, body, this.color, 1);

        //  The hot inner blade, set back from the nose so the point stays the
        //  darker, harder colour and reads as an edge.
        this.fillDart(g, this.dart(0.62), this.hot, 1);

        g.lineStyle(2.5, this.hot, 0.95);
        g.beginPath();
        g.moveTo(body[0].x, body[0].y);
        for (let i = 1; i < body.length; i++) g.lineTo(body[i].x, body[i].y);
        g.closePath();
        g.strokePath();
    }

    destroy (): void
    {
        this.gfx.destroy();
    }
}
