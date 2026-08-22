import { GameObjects, Scene } from 'phaser';
import { BeamLook } from '../data/gunkit';
import { FONT, hex } from './theme';

type BurstSize = 'hit' | 'big' | 'gold';

interface Line
{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: number;
    /** Hot inner colour. Defaults to white. */
    core: number;
    width: number;
    age: number;
    life: number;
    /** Soft passes drawn either side of the sheath. */
    glow: number;
    /**
     * Pre-baked lightning displacement, as offsets perpendicular to the line.
     * Empty for a straight bolt -- the common case, and the cheap one.
     */
    kinks: number[];
    /** Spearhead length drawn at the impact end. */
    head: number;
}

/**
 * All of the "juice" in one place: particle bursts, tracers, floating numbers
 * and expanding shockwave rings.
 */
export class Fx
{
    private scene: Scene;
    private emitters = new Map<string, GameObjects.Particles.ParticleEmitter>();
    private gfx: GameObjects.Graphics;
    private lines: Line[] = [];
    private depth: number;

    constructor (scene: Scene, depth: number)
    {
        this.scene = scene;
        this.depth = depth;
        this.gfx = scene.add.graphics().setDepth(depth + 1);
    }

    private emitter (color: number, size: BurstSize): GameObjects.Particles.ParticleEmitter
    {
        const key = `${color}_${size}`;
        let e = this.emitters.get(key);

        if (e) return e;

        const cfg: any = {
            tint: color,
            emitting: false,
            blendMode: 'ADD'
        };

        if (size === 'hit')
        {
            cfg.speed = { min: 70, max: 280 };
            cfg.lifespan = { min: 200, max: 380 };
            cfg.scale = { start: 0.55, end: 0, ease: 'Quad.out' };
            cfg.alpha = { start: 1, end: 0.2 };
        }
        else if (size === 'big')
        {
            cfg.speed = { min: 120, max: 560 };
            cfg.lifespan = { min: 280, max: 620 };
            cfg.scale = { start: 0.95, end: 0, ease: 'Quad.out' };
            cfg.alpha = { start: 1, end: 0.1 };
        }
        else
        {
            cfg.speed = { min: 140, max: 700 };
            cfg.lifespan = { min: 420, max: 900 };
            cfg.scale = { start: 0.85, end: 0, ease: 'Quad.out' };
            cfg.alpha = { start: 1, end: 0.1 };
            cfg.gravityY = 520;
        }

        e = this.scene.add.particles(0, 0, 'spark', cfg);
        e.setDepth(this.depth);
        this.emitters.set(key, e);

        return e;
    }

    burst (x: number, y: number, color: number, count: number, size: BurstSize = 'hit'): void
    {
        this.emitter(color, size).explode(count, x, y);
    }

    /** A plain fading laser line. */
    tracer (x1: number, y1: number, x2: number, y2: number, color: number, width = 4, life = 140): void
    {
        this.lines.push({
            x1, y1, x2, y2, color, core: 0xffffff, width, age: 0, life, glow: 0, kinks: [], head: 0
        });
    }

    /**
     * The player's shot. Everything about how it looks comes off the build --
     * width, colour, how many soft passes bloom around it, whether it forks
     * like lightning, whether it ends in a spearhead. A late-run bolt should
     * not be mistakable for a level-one one.
     */
    beam (x1: number, y1: number, x2: number, y2: number, look: BeamLook, scale = 1): void
    {
        const kinks: number[] = [];

        if (look.wobble > 0.5)
        {
            //  Baked once, not per frame: the bolt is on screen for a sixth of
            //  a second and a re-rolled zigzag every frame just reads as noise.
            const segs = 6;
            for (let i = 1; i < segs; i++) kinks.push((Math.random() * 2 - 1) * look.wobble);
        }

        this.lines.push({
            x1, y1, x2, y2,
            color: look.color,
            core: look.core,
            width: look.width * scale,
            age: 0,
            life: look.life,
            glow: look.glow,
            kinks,
            head: look.head * scale
        });

        if (look.sparks > 0)
        {
            //  Sparks shed off the impact end, along the line of travel.
            this.burst(x2, y2, look.core, look.sparks, 'hit');
        }

        if (look.bloom > 1.15)
        {
            const flash = this.scene.add.image(x1, y1, 'spark');
            flash.setDisplaySize(70 * look.bloom, 70 * look.bloom)
                .setTint(look.color).setBlendMode('ADD').setDepth(this.depth + 1);

            this.scene.tweens.add({
                targets: flash, alpha: 0, scale: flash.scaleX * 1.5,
                duration: 140, ease: 'Quad.out', onComplete: () => flash.destroy()
            });
        }

        //  Only the main bolt gets a muzzle shockwave; every barrel in a
        //  six-gun volley throwing one would be a wall of rings.
        if (look.shock > 0 && scale >= 1)
        {
            this.ring(x1, y1, 40 + look.shock * 60, look.color, 2 + look.shock * 3, 260);
        }
    }

    /** Expanding shockwave. */
    ring (x: number, y: number, radius: number, color: number, width = 5, duration = 340): void
    {
        const arc = this.scene.add.circle(x, y, radius, color, 0);
        arc.setStrokeStyle(width, color, 1);
        arc.setDepth(this.depth);
        arc.setScale(0.2);

        this.scene.tweens.add({
            targets: arc,
            scale: 1,
            alpha: 0,
            duration,
            ease: 'Cubic.out',
            onComplete: () => arc.destroy()
        });
    }

    /** Floating number / word that pops upward. */
    popup (x: number, y: number, text: string, color: number, size = 26, rise = 62, duration = 620): GameObjects.Text
    {
        const t = this.scene.add.text(x, y, text, {
            fontFamily: FONT,
            fontSize: size,
            color: hex(color),
            stroke: '#000000',
            strokeThickness: Math.max(3, size * 0.16)
        }).setOrigin(0.5).setDepth(this.depth + 2);

        t.setScale(0.4);

        this.scene.tweens.add({ targets: t, scale: 1, duration: 150, ease: 'Back.out' });
        this.scene.tweens.add({
            targets: t,
            y: y - rise,
            alpha: 0,
            duration,
            delay: 90,
            ease: 'Quad.out',
            onComplete: () => t.destroy()
        });

        return t;
    }

    /** A coin that flies to the currency counter. */
    fly (x: number, y: number, toX: number, toY: number, color: number, onArrive?: () => void): void
    {
        const c = this.scene.add.circle(x, y, 7, color, 1).setDepth(this.depth + 3);
        const midX = x + (toX - x) * 0.4 + (Math.random() - 0.5) * 120;
        const midY = y - 90 - Math.random() * 60;

        this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 320 + Math.random() * 120,
            ease: 'Quad.in',
            onUpdate: (tw: any) =>
            {
                const t = tw.getValue() as number;
                const it = 1 - t;
                c.x = it * it * x + 2 * it * t * midX + t * t * toX;
                c.y = it * it * y + 2 * it * t * midY + t * t * toY;
                c.setScale(1 - t * 0.4);
            },
            onComplete: () =>
            {
                c.destroy();
                if (onArrive) onArrive();
            }
        });
    }

    /** A bolt's points -- two for a straight line, more once it forks. */
    private path (l: Line): number[][]
    {
        if (l.kinks.length === 0) return [ [ l.x1, l.y1 ], [ l.x2, l.y2 ] ];

        const dx = l.x2 - l.x1;
        const dy = l.y2 - l.y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const segs = l.kinks.length + 1;
        const pts: number[][] = [ [ l.x1, l.y1 ] ];

        for (let i = 1; i < segs; i++)
        {
            const f = i / segs;
            const k = l.kinks[i - 1];
            pts.push([ l.x1 + dx * f + nx * k, l.y1 + dy * f + ny * k ]);
        }

        pts.push([ l.x2, l.y2 ]);

        return pts;
    }

    private stroke (pts: number[][]): void
    {
        this.gfx.beginPath();
        this.gfx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) this.gfx.lineTo(pts[i][0], pts[i][1]);
        this.gfx.strokePath();
    }

    update (dtMs: number): void
    {
        this.gfx.clear();

        for (let i = this.lines.length - 1; i >= 0; i--)
        {
            const l = this.lines[i];
            l.age += dtMs;

            if (l.age >= l.life)
            {
                this.lines.splice(i, 1);
                continue;
            }

            const t = 1 - l.age / l.life;

            const pts = this.path(l);

            //  Outer bloom first, then the sheath, then the white-hot core --
            //  three passes is what makes a line read as energy and not ink.
            for (let g = l.glow; g > 0; g--)
            {
                this.gfx.lineStyle(l.width * t * (1 + g * 0.7) + 2, l.color, t * 0.12);
                this.stroke(pts);
            }

            this.gfx.lineStyle(l.width * t + 1, l.color, t * 0.9);
            this.stroke(pts);
            this.gfx.lineStyle(Math.max(1, l.width * t * 0.35), l.core, t * 0.85);
            this.stroke(pts);

            if (l.head > 0)
            {
                const dx = l.x2 - l.x1;
                const dy = l.y2 - l.y1;
                const len = Math.hypot(dx, dy) || 1;
                const ux = dx / len;
                const uy = dy / len;
                const w = (l.width * t + 2) * 0.9;

                this.gfx.fillStyle(l.core, t * 0.9);
                this.gfx.fillTriangle(
                    l.x2 + ux * l.head * t, l.y2 + uy * l.head * t,
                    l.x2 - ux * l.head * 0.4 - uy * w, l.y2 - uy * l.head * 0.4 + ux * w,
                    l.x2 - ux * l.head * 0.4 + uy * w, l.y2 - uy * l.head * 0.4 - ux * w
                );
            }
        }
    }
}
