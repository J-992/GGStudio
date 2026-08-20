import { GameObjects, Scene } from 'phaser';
import { PLAY, Tier, mix } from '../core/theme';

/**
 * A pane of armoured glass, parked across the arena.
 *
 * It is the first thing in the game that is not a target and not scenery: it
 * stands between the gun and whatever is behind it, and the only way through
 * is to spend shots on the glass itself. Every hit it eats is a hit that was
 * not spent on the clock, which is the whole cost of it -- it never damages
 * the player, it only wastes them.
 *
 * It is drawn above the targets on purpose. A pane that a target could be
 * "in front of" would be a depth puzzle; a pane that covers everything behind
 * it is a wall, and a wall is read instantly.
 */

const HEIGHT = 26;

export class Glass
{
    x: number;
    y: number;
    readonly w: number;
    readonly h = HEIGHT;

    hp: number;
    readonly maxHp: number;
    dead = false;

    /** Sideways drift, px/sec. Reverses at the arena walls. */
    private vx: number;
    private gfx: GameObjects.Graphics;
    private tint: number;
    private edge: number;
    /** 0..1 of the slide-in animation. Nothing blocks until it has landed. */
    private born = 0;
    /** Guards a second destroy: a shattered pane is taken down twice. */
    private gone = false;
    private shake = 0;
    /** Fixed crack geometry, so the damage does not crawl frame to frame. */
    private cracks: { x: number; y: number; dx: number; dy: number }[] = [];

    constructor (scene: Scene, tier: Tier, y: number, width: number, hp: number, drift: number)
    {
        this.w = width;
        this.y = y;
        this.hp = hp;
        this.maxHp = hp;

        const from = Math.random() < 0.5 ? -1 : 1;

        this.x = from < 0 ? PLAY.left + width / 2 : PLAY.right - width / 2;
        this.vx = drift * (from < 0 ? 1 : -1);

        this.tint = mix(tier.accent2, 0xffffff, 0.35);
        this.edge = mix(tier.accent, 0xffffff, 0.55);

        this.gfx = scene.add.graphics().setDepth(12);

        //  Slides in from the wall it is standing against.
        scene.tweens.add({
            targets: this,
            born: 1,
            duration: 420,
            ease: 'Quad.out'
        });
    }

    update (dtMs: number): void
    {
        const dt = dtMs / 1000;

        if (this.vx !== 0)
        {
            this.x += this.vx * dt;

            const half = this.w / 2;

            if (this.x < PLAY.left + half) { this.x = PLAY.left + half; this.vx = Math.abs(this.vx); }
            else if (this.x > PLAY.right - half) { this.x = PLAY.right - half; this.vx = -Math.abs(this.vx); }
        }

        if (this.shake > 0) this.shake = Math.max(0, this.shake - dtMs / 180);

        this.draw();
    }

    /** True once the pane has finished sliding in and actually stops shots. */
    get live (): boolean
    {
        return !this.dead && this.born > 0.7;
    }

    /** Where a shot from (x1,y1) to (x2,y2) meets the glass, if it does. */
    crossing (x1: number, y1: number, x2: number, y2: number): { x: number; y: number } | null
    {
        if (!this.live) return null;

        const top = this.y - this.h / 2;
        const bottom = this.y + this.h / 2;
        const left = this.x - this.w / 2;
        const right = this.x + this.w / 2;

        //  The beam is very nearly vertical in practice, so the honest test is
        //  the two horizontal edges: whichever the shot reaches first wins.
        let best: { x: number; y: number } | null = null;
        let bestT = Infinity;

        for (const edgeY of [ top, bottom ])
        {
            if ((y1 - edgeY) * (y2 - edgeY) > 0) continue;

            const t = (edgeY - y1) / (y2 - y1 || 0.0001);

            if (t < 0 || t > 1 || t >= bestT) continue;

            const x = x1 + (x2 - x1) * t;

            if (x < left || x > right) continue;

            bestT = t;
            best = { x, y: edgeY };
        }

        //  A shot that starts or ends inside the slab still counts as a hit on
        //  it -- tapping a target standing behind the glass is the common case.
        if (!best && x2 >= left && x2 <= right && y2 >= top && y2 <= bottom)
        {
            best = { x: x2, y: y2 };
        }

        return best;
    }

    /** True when this hit finished it off. */
    damage (): boolean
    {
        this.hp -= 1;
        this.shake = 1;

        //  A fresh crack, spidering out from a new random point.
        const spread = Math.PI * 2 * Math.random();
        const px = (Math.random() - 0.5) * this.w * 0.8;

        for (let i = 0; i < 3; i++)
        {
            const a = spread + i * 2.1 + Math.random();
            const len = 10 + Math.random() * 26;

            this.cracks.push({ x: px, y: (Math.random() - 0.5) * this.h * 0.5, dx: Math.cos(a) * len, dy: Math.sin(a) * len * 0.35 });
        }

        if (this.hp <= 0)
        {
            this.dead = true;
            return true;
        }

        return false;
    }

    private draw (): void
    {
        const g = this.gfx;
        g.clear();

        if (this.dead) return;

        const t = this.born;
        const w = this.w * t;
        const h = this.h;
        const jx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 5 : 0;
        const x = this.x + jx - w / 2;
        const y = this.y - h / 2;

        //  Frosted body, brighter as it takes damage -- stressed glass.
        const stress = 1 - this.hp / this.maxHp;

        g.fillStyle(this.tint, (0.13 + stress * 0.1) * t);
        g.fillRoundedRect(x, y, w, h, 7);

        g.lineStyle(3, this.edge, (0.55 + stress * 0.35) * t);
        g.strokeRoundedRect(x, y, w, h, 7);

        //  A highlight running the length of it, so it reads as a surface
        //  rather than as an empty box.
        g.fillStyle(0xffffff, 0.14 * t);
        g.fillRoundedRect(x + 4, y + 3, Math.max(0, w - 8), 5, 2.5);

        //  Bolted into whatever is holding it up.
        for (const bx of [ x + 7, x + w - 7 ])
        {
            g.fillStyle(this.edge, 0.85 * t);
            g.fillCircle(bx, this.y, 3.4);
        }

        if (this.cracks.length === 0) return;

        g.lineStyle(1.8, 0xffffff, 0.75 * t);

        for (const c of this.cracks)
        {
            const cx = this.x + jx + c.x;
            const cy = this.y + c.y;

            g.lineBetween(cx, cy, cx + c.dx, cy + c.dy);
        }
    }

    destroy (): void
    {
        if (this.gone) return;

        this.gone = true;
        this.gfx.destroy();
    }
}
