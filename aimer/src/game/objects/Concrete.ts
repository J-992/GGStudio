import { GameObjects, Scene } from 'phaser';
import { PLAY, Tier, mix } from '../core/theme';

/**
 * A slab of concrete, hanging in the arena.
 *
 * Glass is a toll: it costs shots and then it is gone. Concrete is a *fact*.
 * Nothing the player owns will ever break it -- not the biggest gun, not a
 * wingman, not a lucky crit -- and the only answer to it is to stop shooting
 * through it and shoot somewhere else. That is the whole reason it exists:
 * up to now every problem on the board has been solved by aiming at it, and
 * this one is solved by aiming *around* it.
 *
 * It is solid, opaque and drawn over everything, so it takes vision as well as
 * shots. A target that walks behind a slab is genuinely gone for as long as it
 * is back there, which is why the swinging ones matter: a static block asks
 * the player to remember what is behind it, and a swinging one keeps handing
 * back what it just took away.
 */

/** Which way a slab moves, if it moves. */
export type BlockMotion = 'static' | 'swing';

export class Concrete
{
    x: number;
    y: number;
    readonly w: number;
    readonly h: number;

    private gfx: GameObjects.Graphics;
    private body: number;
    private lip: number;
    private stripe: number;

    private motion: BlockMotion;
    /** Where it hangs from, how far each pass carries it, and how long that takes. */
    private pivotX: number;
    private pivotY: number;
    private sweep: number;
    private period: number;
    private clock: number;

    private born = 0;
    private shake = 0;
    private gone = false;

    constructor (scene: Scene, tier: Tier, x: number, y: number, w: number, h: number,
        motion: BlockMotion, swing: number, period: number)
    {
        this.w = w;
        this.h = h;
        this.x = x;
        this.y = y;

        this.motion = motion;
        this.period = Math.max(800, period);

        //  It hangs from the roof of the arena on a cable, and it swings along
        //  its own band rather than on a true arc.
        //
        //  A real pendulum rises at the ends of its stroke, and a slab hung
        //  near the top of the board would either climb into the HUD or have
        //  to be given an arc so short it read as static. Trading the rise for
        //  a flat sweep costs nothing anybody can see -- the cable still leans,
        //  which is the part that says "this is hanging" -- and buys a slab
        //  that stays exactly where the level put it.
        this.pivotX = x;
        this.pivotY = PLAY.top + 6;

        //  How far it carries, capped so it never reaches a wall: a slab
        //  parked against the edge of the arena is scenery, not an obstacle.
        const room = ((PLAY.right - PLAY.left) - w) / 2;

        this.sweep = Math.min(room * 0.9, Math.sin(Math.min(1.2, swing)) * Math.max(60, y - this.pivotY));

        //  Started somewhere random in its arc, so two slabs never march in
        //  step and the board does not develop a rhythm the player can learn
        //  once and stop looking at.
        this.clock = Math.random() * this.period;

        //  Concrete is the one thing in the arena that is not lit from within.
        //  It borrows the zone's palette only enough not to look pasted on.
        this.body = mix(0x161b2b, tier.grid, 0.32);
        this.lip = mix(this.body, 0xffffff, 0.28);
        this.stripe = mix(tier.accent, 0xffe08a, 0.45);

        this.gfx = scene.add.graphics().setDepth(13);

        scene.tweens.add({ targets: this, born: 1, duration: 460, ease: 'Back.out' });

        if (motion === 'swing') this.place();
    }

    private place (): void
    {
        //  Sine, not a linear sweep: it slows at the ends of the stroke, which
        //  is what makes it read as weight on a cable rather than as a box on
        //  a conveyor -- and it is also where it lingers long enough to be a
        //  real problem for whatever is behind it.
        const phase = Math.sin((this.clock / this.period) * Math.PI * 2);
        const half = this.w / 2;

        this.x = Math.max(PLAY.left + half, Math.min(PLAY.right - half, this.pivotX + phase * this.sweep));
    }

    update (dtMs: number): void
    {
        if (this.motion === 'swing')
        {
            this.clock = (this.clock + dtMs) % this.period;
            this.place();
        }

        if (this.shake > 0) this.shake = Math.max(0, this.shake - dtMs / 200);

        this.draw();
    }

    /** True once the slab has finished dropping in and actually stops shots. */
    get live (): boolean
    {
        return this.born > 0.55;
    }

    /**
     * Where a shot from (x1,y1) to (x2,y2) first meets the slab.
     *
     * Same clip as the glass, and deliberately so -- an obstacle is an
     * obstacle, and the only difference between these two is what happens
     * afterwards.
     */
    crossing (x1: number, y1: number, x2: number, y2: number): { x: number; y: number } | null
    {
        if (!this.live) return null;

        const left = this.x - this.w / 2;
        const right = this.x + this.w / 2;
        const top = this.y - this.h / 2;
        const bottom = this.y + this.h / 2;

        const dx = x2 - x1;
        const dy = y2 - y1;

        let t0 = 0;
        let t1 = 1;

        const clip = (p: number, q: number): boolean =>
        {
            if (p === 0) return q >= 0;

            const r = q / p;

            if (p < 0)
            {
                if (r > t1) return false;
                if (r > t0) t0 = r;
            }
            else
            {
                if (r < t0) return false;
                if (r < t1) t1 = r;
            }

            return true;
        };

        if (!clip(-dx, x1 - left)) return null;
        if (!clip(dx, right - x1)) return null;
        if (!clip(-dy, y1 - top)) return null;
        if (!clip(dy, bottom - y1)) return null;

        return { x: x1 + dx * t0, y: y1 + dy * t0 };
    }

    /** A shot that went into it. Nothing happens to the slab; it just rings. */
    struck (): void
    {
        this.shake = 1;
    }

    private draw (): void
    {
        const g = this.gfx;
        g.clear();

        const t = this.born;
        const w = this.w;
        const h = this.h * t;
        const jx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 3 : 0;
        const jy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 3 : 0;
        const x = this.x + jx - w / 2;
        const y = this.y + jy - h / 2;

        //  The rope, drawn first so the slab hangs off it rather than in front
        //  of it. A slab you can see is held up is a slab you expect to move.
        if (this.motion === 'swing')
        {
            g.lineStyle(4, mix(this.body, 0xffffff, 0.35), 0.55 * t);
            g.lineBetween(this.pivotX, this.pivotY, this.x + jx, y);

            g.fillStyle(this.lip, 0.9 * t);
            g.fillCircle(this.pivotX, this.pivotY, 7);
        }

        //  Solid. No alpha anywhere on the body: this is the one object in the
        //  arena that is allowed to hide the game.
        g.fillStyle(0x05070f, 0.55 * t);
        g.fillRoundedRect(x + 3, y + 5, w, h, 6);

        g.fillStyle(this.body, t);
        g.fillRoundedRect(x, y, w, h, 6);

        //  Hazard stripes across the face, so it reads as "do not shoot here"
        //  in the same language every other yellow-and-black thing does.
        const band = Math.max(16, h * 0.26);

        for (let i = -1; i * band < w + h; i++)
        {
            const sx = x + i * band * 2;

            g.fillStyle(this.stripe, 0.16 * t);
            g.beginPath();
            g.moveTo(Math.max(x, sx), y);
            g.lineTo(Math.max(x, Math.min(x + w, sx + band)), y);
            g.lineTo(Math.max(x, Math.min(x + w, sx + band - h)), y + h);
            g.lineTo(Math.max(x, Math.min(x + w, sx - h)), y + h);
            g.closePath();
            g.fillPath();
        }

        //  A lit top edge and a dark bottom one: the whole reason a flat grey
        //  box reads as a heavy object.
        g.fillStyle(this.lip, 0.85 * t);
        g.fillRoundedRect(x, y, w, Math.max(4, h * 0.09), 4);

        g.fillStyle(0x000000, 0.3 * t);
        g.fillRoundedRect(x, y + h - Math.max(4, h * 0.08), w, Math.max(4, h * 0.08), 4);

        g.lineStyle(3, mix(this.body, 0x000000, 0.45), 0.9 * t);
        g.strokeRoundedRect(x, y, w, h, 6);

        //  Rivets down both sides.
        const rows = Math.max(2, Math.round(h / 34));

        for (let i = 0; i < rows; i++)
        {
            const ry = y + h * ((i + 0.5) / rows);

            for (const rx of [ x + 10, x + w - 10 ])
            {
                g.fillStyle(0x000000, 0.4 * t);
                g.fillCircle(rx, ry + 1.5, 3.4);
                g.fillStyle(this.lip, 0.75 * t);
                g.fillCircle(rx, ry, 3.2);
            }
        }
    }

    destroy (): void
    {
        if (this.gone) return;

        this.gone = true;
        this.gfx.destroy();
    }
}
