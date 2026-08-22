import { GameObjects, Scene } from 'phaser';
import { PLAY, Tier, mix } from '../core/theme';

/**
 * A pane of armoured glass, hung across the arena.
 *
 * It is the first thing in the game that is not a target and not scenery: it
 * stands between the gun and whatever is behind it, and the only way through
 * is to spend shots on the glass itself. Every hit it eats is a hit that was
 * not spent on the clock, which is the whole cost of it -- it never damages
 * the player, it only wastes them.
 *
 * It covers a slab of the board rather than a line across it, and it is
 * deliberately see-through: the targets keep moving underneath, in plain
 * sight, and the player watches the shot they want to take go by while they
 * are still breaking the window. A pane you cannot see through would be a
 * wall, and a wall is a lesser thing -- it hides the cost instead of showing
 * it. It is drawn above the board for the same reason: whatever is behind the
 * glass is *behind the glass*, with no depth puzzle about which is which.
 */

export class Glass
{
    x: number;
    y: number;
    readonly w: number;
    readonly h: number;

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

    constructor (scene: Scene, tier: Tier, y: number, width: number, height: number, hp: number, drift: number)
    {
        this.w = width;
        this.h = height;
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

    /**
     * Where a shot from (x1,y1) to (x2,y2) first meets the glass.
     *
     * The pane is a solid rectangle, so this is the honest test rather than
     * the two-edges shortcut a thin rail could get away with: the shot is
     * clipped against all four sides and the answer is the point where it
     * enters. Tapping a target that is standing under the pane is the ordinary
     * case, and it resolves to the top edge above that target -- the shot
     * stops at the window, not at the thing behind it.
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

    /**
     * True when this hit finished it off.
     *
     * `bite` is how many of the pane's shots one hit is worth, and it is the
     * gun's punch (see data/levels): armoured glass is the most legible place
     * in the game to feel that a heavier gun is a heavier gun, because the
     * player watches the same window come apart in two shots instead of five.
     */
    damage (bite = 1): boolean
    {
        const hits = Math.max(1, Math.round(bite));

        this.hp -= hits;
        this.shake = 1;

        //  A fresh crack, spidering out from a new random point -- one cluster
        //  per shot's worth of damage, so a heavy hit visibly does more. A
        //  pane this size needs the damage spread over it or the last shot
        //  lands on a window that still looks untouched.
        for (let n = 0; n < Math.min(3, hits); n++)
        {
            const spread = Math.PI * 2 * Math.random();
            const px = (Math.random() - 0.5) * this.w * 0.7;
            const py = (Math.random() - 0.5) * this.h * 0.7;

            for (let i = 0; i < 5; i++)
            {
                const a = spread + i * 1.28 + Math.random() * 0.5;
                const len = 16 + Math.random() * Math.min(this.w, this.h) * 0.4;

                this.cracks.push({ x: px, y: py, dx: Math.cos(a) * len, dy: Math.sin(a) * len });
            }
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
        const h = this.h * t;
        const jx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 6 : 0;
        const x = this.x + jx - w / 2;
        const y = this.y - h / 2;

        //  Frosted body, brighter as it takes damage -- stressed glass. Kept
        //  faint on purpose: everything under the pane has to stay readable,
        //  because watching it is the punishment.
        const stress = 1 - this.hp / this.maxHp;

        g.fillStyle(this.tint, (0.09 + stress * 0.07) * t);
        g.fillRoundedRect(x, y, w, h, 10);

        g.lineStyle(4, this.edge, (0.6 + stress * 0.3) * t);
        g.strokeRoundedRect(x, y, w, h, 10);

        //  Mullions. Two lines in each direction are enough to say "pane"
        //  rather than "tinted rectangle", and they read at a glance.
        g.lineStyle(1.6, this.edge, 0.28 * t);

        for (let i = 1; i < 3; i++)
        {
            const mx = x + (w * i) / 3;
            const my = y + (h * i) / 3;

            g.lineBetween(mx, y + 4, mx, y + h - 4);
            g.lineBetween(x + 4, my, x + w - 4, my);
        }

        //  Two sheens running across it, so the surface catches light and the
        //  player can tell there is something there before they shoot into it.
        g.fillStyle(0xffffff, 0.07 * t);
        g.fillRect(x + w * 0.08, y, w * 0.16, h);
        g.fillRect(x + w * 0.36, y, w * 0.07, h);

        //  Bolted into whatever is holding it up, one at each corner.
        for (const bx of [ x + 11, x + w - 11 ])
        {
            for (const by of [ y + 11, y + h - 11 ])
            {
                g.fillStyle(this.edge, 0.85 * t);
                g.fillCircle(bx, by, 4);
            }
        }

        //  How many shots are left in it, along the top edge. The cracks say
        //  "damaged"; the pips say "one more".
        const pipW = 12;
        const pipGap = 6;
        const total = this.maxHp * pipW + (this.maxHp - 1) * pipGap;

        for (let i = 0; i < this.maxHp; i++)
        {
            const px = this.x + jx - total / 2 + i * (pipW + pipGap);

            g.fillStyle(i < this.hp ? this.edge : 0x000000, (i < this.hp ? 0.9 : 0.35) * t);
            g.fillRoundedRect(px, y - 9, pipW, 5, 2.5);
        }

        if (this.cracks.length === 0) return;

        g.lineStyle(1.8, 0xffffff, 0.7 * t);

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
