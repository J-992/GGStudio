import { GameObjects, Scene } from 'phaser';
import { FONT, hex } from './theme';

type BurstSize = 'hit' | 'big' | 'gold';

interface Line
{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: number;
    width: number;
    age: number;
    life: number;
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

    /** A fading laser line, used for every shot the player fires. */
    tracer (x1: number, y1: number, x2: number, y2: number, color: number, width = 4, life = 140): void
    {
        this.lines.push({ x1, y1, x2, y2, color, width, age: 0, life });
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

            this.gfx.lineStyle(l.width * t + 1, l.color, t * 0.9);
            this.gfx.lineBetween(l.x1, l.y1, l.x2, l.y2);
            this.gfx.lineStyle(Math.max(1, l.width * t * 0.35), 0xffffff, t * 0.85);
            this.gfx.lineBetween(l.x1, l.y1, l.x2, l.y2);
        }
    }
}
