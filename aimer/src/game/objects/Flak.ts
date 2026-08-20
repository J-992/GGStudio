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
    private spin = 0;

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

        this.spin += dt * 9;

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

    private draw (): void
    {
        const g = this.gfx;
        g.clear();

        if (this.dead) return;

        if (!this.live)
        {
            //  The warning: a ring closing in on the muzzle it is aimed at,
            //  plus a shrinking bracket around the launch point.
            const t = 1 - Math.max(0, this.wait) / TELEGRAPH;
            const r = 34 - t * 18;

            g.lineStyle(3, this.color, 0.35 + t * 0.6);
            g.strokeCircle(this.x, this.y, r);

            g.lineStyle(2, this.color, 0.25 + t * 0.4);
            g.lineBetween(this.x, this.y, this.x + this.vx * 0.28, this.y + this.vy * 0.28);

            g.fillStyle(this.hot, 0.3 + t * 0.7);
            g.fillCircle(this.x, this.y, 4 + t * 4);

            return;
        }

        //  The tail, hottest at the head.
        for (let i = this.trail.length - 1; i > 0; i--)
        {
            const a = (1 - i / this.trail.length) * 0.5;

            g.lineStyle(3 + (1 - i / this.trail.length) * 7, this.color, a);
            g.lineBetween(this.trail[i].x, this.trail[i].y, this.trail[i - 1].x, this.trail[i - 1].y);
        }

        g.fillStyle(this.color, 0.28);
        g.fillCircle(this.x, this.y, FLAK_RADIUS + 7);

        g.fillStyle(this.color, 1);
        g.fillCircle(this.x, this.y, FLAK_RADIUS * 0.7);

        g.fillStyle(this.hot, 1);
        g.fillCircle(this.x, this.y, FLAK_RADIUS * 0.36);

        //  Three blades turning round the core -- the shape says "incoming"
        //  from any distance, which a plain dot never manages.
        g.lineStyle(3, this.hot, 0.9);

        for (let i = 0; i < 3; i++)
        {
            const a = this.spin + (i * Math.PI * 2) / 3;
            const r0 = FLAK_RADIUS * 0.75;
            const r1 = FLAK_RADIUS * 1.35;

            g.lineBetween(
                this.x + Math.cos(a) * r0, this.y + Math.sin(a) * r0,
                this.x + Math.cos(a) * r1, this.y + Math.sin(a) * r1
            );
        }
    }

    destroy (): void
    {
        this.gfx.destroy();
    }
}
