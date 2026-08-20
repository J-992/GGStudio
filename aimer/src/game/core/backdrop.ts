import { GameObjects, Scene } from 'phaser';
import type { Zone } from '../data/zones';
import { H, PLAY, W, mix } from './theme';

/**
 * The world behind the targets.
 *
 * Each zone gets a place, not a palette swap: a training range, a city at
 * dusk, a storm, a magma cavern, a reactor, high orbit, and whatever is on
 * fire at the end. The player should be able to tell, at a glance and with the
 * sound off, that they are somewhere they have not been.
 *
 * Two of the values the art is already animating are also the law of the zone,
 * and are read straight off this object by the play scene rather than being
 * simulated twice:
 *
 *   `wind`  the crosswind the skyline is leaning into, in px/sec.
 *   `spin`  how fast the reactor is turning, in radians/sec.
 *
 * So the streaks blowing left are the same fact as the targets sliding left.
 */

const AREA_H = PLAY.bottom - PLAY.top;

function ay (t: number): number
{
    return PLAY.top + AREA_H * t;
}

interface Slab { x: number; w: number; h: number; }
interface Speck { x: number; y: number; r: number; s: number; }
interface Streak { x: number; y: number; len: number; s: number; }

export class Backdrop
{
    /** Crosswind, px/sec. Non-zero only where the zone's rule says so. */
    wind = 0;
    /** Field rotation, radians/sec. */
    spin = 0;

    /**
     * Weather dials, set by the scene from the level's hazard spec. The art and
     * the rule are the same number: a stronger gust is both a harder level and
     * a visibly windier city, and there is no way to tune one without the other.
     */
    gust = 1;
    /** >1 blacks the storm out sooner and holds it there longer. */
    storm = 1;

    private zone: Zone;
    private dyn: GameObjects.Graphics;
    private shroudGfx: GameObjects.Graphics;
    private owned: GameObjects.GameObject[] = [];

    private t = 0;
    private scroll = 0;

    private far: Slab[] = [];
    private near: Slab[] = [];
    private specks: Speck[] = [];
    private streaks: Streak[] = [];

    constructor (scene: Scene, zone: Zone)
    {
        this.zone = zone;

        const statics = scene.add.graphics().setDepth(0);
        this.owned.push(statics);

        this.dyn = scene.add.graphics().setDepth(1);
        this.owned.push(this.dyn);

        //  The blackout curtain hangs between the world and the targets, so a
        //  blacked-out arena still shows every target lit up in it.
        this.shroudGfx = scene.add.graphics().setDepth(8);
        this.owned.push(this.shroudGfx);

        this.build(statics);
    }

    destroy (): void
    {
        for (const o of this.owned) o.destroy();
        this.owned = [];
    }

    update (dtMs: number): void
    {
        this.t += dtMs;
        this.scroll += dtMs;

        const g = this.dyn;
        g.clear();

        switch (this.zone.backdrop)
        {
            case 'range':      this.drawRange(g); break;
            case 'skyline':    this.drawSkyline(g); break;
            case 'storm':      this.drawStorm(g, dtMs); break;
            case 'cavern':     this.drawCavern(g); break;
            case 'reactor':    this.drawReactor(g); break;
            case 'orbitfield': this.drawOrbitfield(g); break;
            case 'crimson':    this.drawCrimson(g, dtMs); break;
        }
    }

    //  ------------------------------------------------------------- shared

    /** The scrolling floor grid every zone keeps, so the arena stays readable. */
    private grid (g: GameObjects.Graphics, alpha: number, step = 58): void
    {
        const off = (this.scroll * 0.022) % step;

        g.lineStyle(1, this.zone.palette.grid, alpha);

        for (let x = 0; x <= W; x += step) g.lineBetween(x, PLAY.top - 10, x, H);
        for (let y = PLAY.top - 10 + off; y <= H; y += step) g.lineBetween(0, y, W, y);
    }

    private horizon (g: GameObjects.Graphics, color: number, alpha = 0.35): void
    {
        g.lineStyle(2, color, alpha);
        g.lineBetween(0, PLAY.top - 10, W, PLAY.top - 10);
    }

    private build (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        switch (this.zone.backdrop)
        {
            case 'range': this.buildRange(g); break;
            case 'skyline': this.buildSkyline(g); break;
            case 'storm': this.buildStorm(g); break;
            case 'cavern': this.buildCavern(g); break;
            case 'reactor': this.buildReactor(g); break;
            case 'orbitfield': this.buildOrbitfield(g); break;
            case 'crimson': this.buildCrimson(g); break;
        }

        //  Every place is lit from its own accent, faintly, at the top.
        g.fillStyle(z.accent, 0.05);
        g.fillRect(0, 0, W, PLAY.top);
    }

    //  -------------------------------------------------------------- range

    private buildRange (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;
        const vx = W / 2;
        const vy = PLAY.top - 60;

        //  Lane markings running away to a vanishing point: a shooting range,
        //  and the flattest, calmest thing the run will ever show.
        g.lineStyle(2, z.grid, 0.5);
        for (let i = -4; i <= 4; i++) g.lineBetween(vx + i * 150, H, vx + i * 26, vy);

        //  Paper targets pinned along the back wall.
        for (let i = -1; i <= 1; i++)
        {
            const x = vx + i * 150;
            const y = PLAY.top + 34;

            for (let r = 4; r >= 1; r--)
            {
                g.fillStyle(r % 2 ? 0x121a33 : z.grid, 0.55);
                g.fillCircle(x, y, r * 7);
            }
        }

        g.fillStyle(z.grid, 0.25);
        g.fillRect(0, PLAY.top - 10, W, 6);
    }

    private drawRange (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        this.grid(g, 0.3);
        this.horizon(g, z.accent, 0.35);

        //  A single calibration sweep drifting down the range.
        const y = PLAY.top + ((this.t * 0.06) % (AREA_H + 120)) - 60;

        g.fillStyle(z.accent, 0.05);
        g.fillRect(0, y, W, 44);
        g.lineStyle(1.5, z.accent, 0.22);
        g.lineBetween(0, y, W, y);
    }

    //  ------------------------------------------------------------ skyline

    private buildSkyline (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        //  Dusk gradient, faked with stacked bands.
        for (let i = 0; i < 12; i++)
        {
            g.fillStyle(mix(z.bg, z.accent, 0.10 - i * 0.008), 1);
            g.fillRect(0, (PLAY.top / 12) * i, W, PLAY.top / 12 + 1);
        }

        for (let i = 0; i < 46; i++)
        {
            g.fillStyle(0xffffff, 0.1 + Math.random() * 0.4);
            g.fillCircle(Math.random() * W, Math.random() * (PLAY.top + 60), Math.random() * 1.4 + 0.4);
        }

        const row = (out: Slab[], minH: number, maxH: number) =>
        {
            let x = -140;
            while (x < W + 200)
            {
                const w = 40 + Math.random() * 70;
                out.push({ x, w, h: minH + Math.random() * (maxH - minH) });
                x += w + 12 + Math.random() * 26;
            }
        };

        row(this.far, 90, 210);
        row(this.near, 140, 300);
    }

    private drawSkyline (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        //  The wind is a slow swing, and it is the zone's whole rule: whatever
        //  the city is leaning into, the targets are being dragged into too.
        this.wind = Math.sin(this.t * 0.00022) * 62 * this.gust;

        const baseY = ay(0.72);
        const drift = this.t * 0.001 * this.wind;

        const band = (slabs: Slab[], depth: number, color: number, alpha: number, lit: number) =>
        {
            const spanW = W + 340;

            for (const s of slabs)
            {
                let x = s.x - drift * depth;
                x = ((x + 140) % spanW + spanW) % spanW - 140;

                g.fillStyle(color, alpha);
                g.fillRect(x, baseY - s.h, s.w, s.h + 200);

                //  Lit windows, a deterministic scatter so they do not crawl.
                g.fillStyle(z.accent2, lit);
                for (let wy = baseY - s.h + 14; wy < baseY - 12; wy += 22)
                {
                    for (let wx = x + 8; wx < x + s.w - 8; wx += 18)
                    {
                        if (((wx * 7 + wy * 13) | 0) % 5 < 2) g.fillRect(wx, wy, 6, 9);
                    }
                }
            }
        };

        band(this.far, 0.4, mix(z.bg, z.grid, 0.7), 0.85, 0.09);
        band(this.near, 1, mix(z.bg, 0x000000, 0.45), 0.95, 0.16);

        this.grid(g, 0.22);
        this.horizon(g, z.accent, 0.3);

        //  Wind streaks, blowing the way the wind blows.
        const dir = Math.sign(this.wind) || 1;

        for (let i = 0; i < 14; i++)
        {
            const phase = (this.t * 0.0006 * Math.abs(this.wind) * 0.06 + i * 0.137) % 1;
            const x = dir > 0 ? phase * (W + 200) - 100 : W + 100 - phase * (W + 200);
            const y = PLAY.top + ((i * 97) % AREA_H);
            const len = 26 + Math.abs(this.wind) * 0.55;

            g.lineStyle(2, z.dust, 0.1 + Math.abs(this.wind) / 62 * 0.16);
            g.lineBetween(x, y, x - dir * len, y);
        }
    }

    //  -------------------------------------------------------------- storm

    private buildStorm (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        for (let i = 0; i < 7; i++)
        {
            const y = 20 + i * 26;
            g.fillStyle(mix(z.bg, z.grid, 0.5 + i * 0.05), 0.8);
            g.fillEllipse(W * (i % 2 ? 0.3 : 0.7), y, W * (0.7 + (i % 3) * 0.2), 70);
        }

        //  A drowned skyline, barely there, so the rain has something to fall on.
        g.fillStyle(0x000000, 0.5);
        for (let x = -40; x < W + 60; x += 54)
        {
            g.fillRect(x, ay(0.78) - 40 - ((x * 13) % 90), 44, 300);
        }

        for (let i = 0; i < 90; i++)
        {
            this.streaks.push({
                x: Math.random() * (W + 200) - 100,
                y: Math.random() * H,
                len: 16 + Math.random() * 26,
                s: 620 + Math.random() * 460
            });
        }
    }

    /** 0 while the storm is clear, 1 at the blackest moment of a blackout. */
    private blackout (): { dark: number; flash: number }
    {
        //  One cycle: a stretch of clear-ish sky, then the light goes, then a
        //  lightning strike puts it back. Never long enough to feel unfair --
        //  but the deeper into the storm the level sits, the shorter the clear
        //  stretch and the longer the dark one.
        const clear = 5000 / this.storm;
        const hold = 1600 * this.storm;
        const period = clear + 700 + hold + 900;
        const p = this.t % period;

        if (p < clear) return { dark: 0, flash: 0 };
        if (p < clear + 700) return { dark: (p - clear) / 700, flash: 0 };
        if (p < clear + 700 + hold) return { dark: 1, flash: 0 };

        const out = (p - clear - 700 - hold) / 900;

        return { dark: 1 - out, flash: out < 0.22 ? 1 - out / 0.22 : 0 };
    }

    private drawStorm (g: GameObjects.Graphics, dtMs: number): void
    {
        const z = this.zone.palette;
        const { dark, flash } = this.blackout();

        this.grid(g, 0.2 * (1 - dark));
        this.horizon(g, z.accent, 0.3);

        for (const s of this.streaks)
        {
            s.y += s.s * (dtMs / 1000);
            s.x -= s.s * 0.18 * (dtMs / 1000);

            if (s.y > H) { s.y = -30; s.x = Math.random() * (W + 200) - 60; }
            if (s.x < -80) s.x = W + 60;

            g.lineStyle(1.4, z.accent2, 0.10 + 0.2 * (1 - dark));
            g.lineBetween(s.x, s.y, s.x + s.len * 0.18, s.y - s.len);
        }

        const sg = this.shroudGfx;
        sg.clear();

        if (dark > 0.001)
        {
            sg.fillStyle(0x000410, 0.86 * dark);
            sg.fillRect(0, 0, W, H);
        }

        if (flash > 0.001)
        {
            //  The strike that ends the blackout, drawn as a fork down the sky.
            g.lineStyle(3 + flash * 4, 0xffffff, flash);
            let x = W * (0.2 + ((this.t / 8200) | 0) % 5 * 0.15);
            let y = 0;
            for (let i = 0; i < 6; i++)
            {
                const nx = x + (((i * 37) % 7) - 3) * 16;
                const ny = y + PLAY.top / 5;
                g.lineBetween(x, y, nx, ny);
                x = nx; y = ny;
            }

            g.fillStyle(0xffffff, flash * 0.25);
            g.fillRect(0, 0, W, H);
        }
    }

    //  ------------------------------------------------------------- cavern

    private buildCavern (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        //  Magma glow rising from the floor.
        for (let i = 0; i < 10; i++)
        {
            g.fillStyle(mix(z.bg, z.accent, 0.02 + i * 0.012), 1);
            g.fillRect(0, H - (i + 1) * 26, W, 27);
        }

        const teeth = (fromTop: boolean) =>
        {
            let x = -30;
            while (x < W + 40)
            {
                const w = 26 + Math.random() * 46;
                const h = 40 + Math.random() * 120;
                const base = fromTop ? PLAY.top - 14 : H;
                const tip = fromTop ? base + h : base - h;

                g.fillStyle(0x0d0704, 1);
                g.fillTriangle(x, base, x + w, base, x + w / 2, tip);
                g.lineStyle(2, z.accent, 0.18);
                g.lineBetween(x + w / 2, tip, x + w * (fromTop ? 0.1 : 0.9), base);

                x += w * 0.8;
            }
        };

        teeth(true);
        teeth(false);

        //  Crystal clusters, the only friendly light down here.
        for (let i = 0; i < 7; i++)
        {
            const x = 40 + Math.random() * (W - 80);
            const y = ay(0.2 + Math.random() * 0.7);
            const r = 8 + Math.random() * 12;

            this.specks.push({ x, y, r, s: 0.4 + Math.random() });

            g.fillStyle(z.accent2, 0.5);
            g.fillTriangle(x - r * 0.5, y + r, x + r * 0.5, y + r, x, y - r);
        }
    }

    private drawCavern (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        this.grid(g, 0.18);
        this.horizon(g, z.accent, 0.3);

        for (const c of this.specks)
        {
            const pulse = 0.2 + Math.abs(Math.sin(this.t * 0.0016 * c.s)) * 0.3;
            g.fillStyle(z.accent2, pulse);
            g.fillCircle(c.x, c.y, c.r * 2.2);
        }

        //  Embers, drifting up out of the floor.
        for (let i = 0; i < 22; i++)
        {
            const life = (this.t * 0.00016 + i * 0.0453) % 1;
            const x = ((i * 613) % W) + Math.sin(this.t * 0.001 + i) * 16;
            const y = H - life * (H - PLAY.top + 60);

            g.fillStyle(z.dust, (1 - life) * 0.55);
            g.fillCircle(x, y, 1.6 + (1 - life) * 2.2);
        }
    }

    //  ------------------------------------------------------------ reactor

    private buildReactor (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        //  Pipework down both walls.
        for (const side of [ 0, 1 ])
        {
            const x = side ? W - 34 : 34;

            g.fillStyle(0x07130d, 1);
            g.fillRect(x - 16, 0, 32, H);
            g.lineStyle(3, z.grid, 0.9);
            g.strokeRect(x - 16, 0, 32, H);

            for (let y = 40; y < H; y += 86)
            {
                g.fillStyle(z.grid, 1);
                g.fillRect(x - 22, y, 44, 12);
            }
        }

        //  Containment ring around the arena centre.
        const cy = ay(0.5);

        g.lineStyle(20, 0x06231a, 1);
        g.strokeCircle(W / 2, cy, Math.min(W, AREA_H) * 0.42);
        g.lineStyle(3, z.grid, 0.9);
        g.strokeCircle(W / 2, cy, Math.min(W, AREA_H) * 0.42);
    }

    private drawReactor (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        //  The core's rotation is the zone's rule -- the field turns with it.
        this.spin = 0.22;

        this.grid(g, 0.2);
        this.horizon(g, z.accent, 0.3);

        const cy = ay(0.5);
        const r = Math.min(W, AREA_H) * 0.42;
        const a = this.t * 0.001 * this.spin;

        //  Spokes: what makes the rotation legible before a target ever moves.
        for (let i = 0; i < 6; i++)
        {
            const th = a + (i * Math.PI) / 3;
            g.lineStyle(3, z.accent, 0.16);
            g.lineBetween(
                W / 2 + Math.cos(th) * 40, cy + Math.sin(th) * 40,
                W / 2 + Math.cos(th) * r, cy + Math.sin(th) * r
            );
        }

        const beat = 0.5 + Math.abs(Math.sin(this.t * 0.0018)) * 0.5;

        g.fillStyle(z.accent, 0.05 + beat * 0.06);
        g.fillCircle(W / 2, cy, 70 + beat * 22);
        g.lineStyle(4, z.accent2, 0.3 + beat * 0.4);
        g.strokeCircle(W / 2, cy, 46 + beat * 8);

        //  Coolant running down the pipes.
        for (const side of [ 0, 1 ])
        {
            const x = side ? W - 34 : 34;

            for (let i = 0; i < 5; i++)
            {
                const y = ((this.t * 0.24 + i * 200 + side * 100) % (H + 80)) - 40;
                g.fillStyle(z.accent2, 0.7);
                g.fillRect(x - 5, y, 10, 26);
            }
        }
    }

    //  --------------------------------------------------------- orbitfield

    private buildOrbitfield (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        for (let i = 0; i < 130; i++)
        {
            this.specks.push({
                x: Math.random() * W,
                y: Math.random() * H,
                r: Math.random() * 1.5 + 0.4,
                s: 0.3 + Math.random() * 1.6
            });
        }

        //  Nebula, a few soft overlapping washes.
        for (let i = 0; i < 5; i++)
        {
            g.fillStyle(i % 2 ? z.accent : z.accent2, 0.05);
            g.fillEllipse(Math.random() * W, ay(Math.random()), 260 + Math.random() * 300, 180 + Math.random() * 200);
        }

        //  The planet's limb, cutting off the bottom of the world.
        g.fillStyle(mix(z.bg, z.accent, 0.18), 1);
        g.fillCircle(W / 2, H + W * 0.9, W);
        g.lineStyle(4, z.accent2, 0.5);
        g.strokeCircle(W / 2, H + W * 0.9, W);
    }

    private drawOrbitfield (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        for (const s of this.specks)
        {
            g.fillStyle(0xffffff, 0.25 + Math.abs(Math.sin(this.t * 0.001 * s.s)) * 0.55);
            g.fillCircle(s.x, s.y, s.r);
        }

        this.grid(g, 0.12);
        this.horizon(g, z.accent, 0.25);

        //  Orbital tracks, tilted and turning -- the shape of the shields the
        //  targets are about to start wearing.
        const cy = ay(0.46);

        for (let i = 0; i < 3; i++)
        {
            const rot = this.t * 0.00018 * (i + 1);

            g.lineStyle(2, i % 2 ? z.accent : z.accent2, 0.22);
            g.save();
            g.translateCanvas(W / 2, cy);
            g.rotateCanvas(rot);
            g.strokeEllipse(0, 0, 340 + i * 130, 150 + i * 48);
            g.restore();

            //  A satellite riding that track, placed on the ellipse and then
            //  turned with it so it never drifts off the line it belongs to.
            const a = rot * 7 + i;
            const ex = Math.cos(a) * (170 + i * 65);
            const ey = Math.sin(a) * (75 + i * 24);

            g.fillStyle(0xffffff, 0.8);
            g.fillCircle(
                W / 2 + ex * Math.cos(rot) - ey * Math.sin(rot),
                cy + ex * Math.sin(rot) + ey * Math.cos(rot),
                2.5
            );
        }
    }

    //  ------------------------------------------------------------ crimson

    private buildCrimson (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        //  A dying sun, most of the way below the horizon.
        for (let i = 8; i >= 1; i--)
        {
            g.fillStyle(mix(z.bg, z.accent2, 0.08 * (9 - i)), 1);
            g.fillCircle(W / 2, ay(0.36), 40 + i * 26);
        }

        //  Spires, close and black.
        let x = -60;
        while (x < W + 80)
        {
            const w = 40 + Math.random() * 80;
            const h = 160 + Math.random() * 320;

            g.fillStyle(0x090003, 1);
            g.fillTriangle(x, H, x + w, H, x + w * (0.3 + Math.random() * 0.4), H - h);
            x += w * 0.62;
        }

        for (let i = 0; i < 70; i++)
        {
            this.specks.push({
                x: Math.random() * W,
                y: Math.random() * H,
                r: 0.8 + Math.random() * 1.8,
                s: 0.3 + Math.random() * 0.9
            });
        }
    }

    private drawCrimson (g: GameObjects.Graphics, dtMs: number): void
    {
        const z = this.zone.palette;
        const beat = Math.abs(Math.sin(this.t * 0.0012));

        g.fillStyle(z.accent2, 0.05 + beat * 0.05);
        g.fillCircle(W / 2, ay(0.36), 120 + beat * 30);

        this.grid(g, 0.2);
        this.horizon(g, z.accent, 0.4);

        //  Ash on the updraft.
        for (const s of this.specks)
        {
            s.y -= s.s * 14 * (dtMs / 1000);
            s.x += Math.sin(this.t * 0.0008 + s.r * 9) * 0.4;

            if (s.y < -10) { s.y = H + 10; s.x = Math.random() * W; }

            g.fillStyle(z.dust, 0.2 + s.s * 0.3);
            g.fillCircle(s.x, s.y, s.r);
        }
    }
}
