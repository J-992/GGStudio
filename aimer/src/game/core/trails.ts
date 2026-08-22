import { GameObjects, Scene } from 'phaser';

/**
 * The wake a skinned target drags behind it.
 *
 * A trail is the loudest thing a cosmetic can do, so it is also the most
 * carefully rationed: only a handful of skins carry one, they are emitted from
 * a small fixed pool of shared emitters rather than one per target, and every
 * one of them is drawn *behind* the board. A cosmetic that made a target
 * harder to see would be a cosmetic that costs the player the run.
 */

export type TrailId = 'smoke' | 'sparkle' | 'toxic' | 'bubbles' | 'embers' | 'sparks' | 'stars' | 'steam';

interface TrailSpec
{
    texture: 'spark' | 'dust';
    tint: number | number[];
    /** ADD reads as light; NORMAL is the only way to draw something dark. */
    additive: boolean;
    speed: { min: number; max: number };
    lifespan: { min: number; max: number };
    scale: { start: number; end: number };
    alpha: { start: number; end: number };
    gravityY: number;
    /** Milliseconds between puffs, per target. */
    every: number;
    /** Particles per puff. */
    count: number;
}

const SPECS: Record<TrailId, TrailSpec> = {
    //  Black smoke. The one effect that cannot use additive blending -- adding
    //  darkness to a dark arena produces nothing at all.
    smoke: {
        texture: 'dust',
        tint: [ 0x0a0a12, 0x1a1a26, 0x2b2b3a ],
        additive: false,
        speed: { min: 8, max: 34 },
        lifespan: { min: 420, max: 820 },
        scale: { start: 0.7, end: 2.1 },
        alpha: { start: 0.5, end: 0 },
        gravityY: -26,
        every: 90,
        count: 1
    },
    sparkle: {
        texture: 'spark',
        tint: [ 0xffd23f, 0xffc857, 0xfff3b0 ],
        additive: true,
        speed: { min: 10, max: 46 },
        lifespan: { min: 280, max: 560 },
        scale: { start: 0.42, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: 42,
        every: 80,
        count: 1
    },
    toxic: {
        texture: 'dust',
        tint: [ 0x7dff6b, 0x4ecb3a, 0xd6ffcb ],
        additive: true,
        speed: { min: 6, max: 30 },
        lifespan: { min: 380, max: 700 },
        scale: { start: 0.55, end: 1.5 },
        alpha: { start: 0.55, end: 0 },
        gravityY: -14,
        every: 95,
        count: 1
    },
    bubbles: {
        texture: 'spark',
        tint: [ 0x8fd3ff, 0xd6f4ff, 0x4fd6ff ],
        additive: true,
        speed: { min: 8, max: 30 },
        lifespan: { min: 420, max: 800 },
        scale: { start: 0.3, end: 0.05 },
        alpha: { start: 0.85, end: 0 },
        gravityY: -60,
        every: 110,
        count: 1
    },
    embers: {
        texture: 'spark',
        tint: [ 0xff8a3d, 0xff4d3d, 0xffd23f ],
        additive: true,
        speed: { min: 12, max: 52 },
        lifespan: { min: 300, max: 620 },
        scale: { start: 0.4, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: -40,
        every: 85,
        count: 1
    },
    sparks: {
        texture: 'spark',
        tint: [ 0x3fe0ff, 0xffffff, 0x62ffb8 ],
        additive: true,
        speed: { min: 30, max: 130 },
        lifespan: { min: 160, max: 340 },
        scale: { start: 0.34, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: 180,
        every: 130,
        count: 2
    },
    steam: {
        texture: 'dust',
        tint: [ 0xfff4e2, 0xffffff, 0xffe0c0 ],
        additive: true,
        speed: { min: 5, max: 24 },
        lifespan: { min: 460, max: 880 },
        scale: { start: 0.4, end: 1.6 },
        alpha: { start: 0.42, end: 0 },
        gravityY: -70,
        every: 100,
        count: 1
    },
    stars: {
        texture: 'spark',
        tint: [ 0xb388ff, 0xff7ae0, 0xffffff ],
        additive: true,
        speed: { min: 6, max: 26 },
        lifespan: { min: 460, max: 900 },
        scale: { start: 0.36, end: 0 },
        alpha: { start: 0.95, end: 0 },
        gravityY: 0,
        every: 100,
        count: 1
    }
};

/** How often a target carrying this trail should ask for a puff, in ms. */
export function trailInterval (id: TrailId): number
{
    return SPECS[id].every;
}

/**
 * The pool. One emitter per trail actually in use, made on first demand -- a
 * run only ever wears one skin, so in practice this holds exactly one.
 */
export class Trails
{
    private scene: Scene;
    private depth: number;
    private pool = new Map<TrailId, GameObjects.Particles.ParticleEmitter>();

    constructor (scene: Scene, depth: number)
    {
        this.scene = scene;
        this.depth = depth;
    }

    private emitter (id: TrailId): GameObjects.Particles.ParticleEmitter
    {
        const found = this.pool.get(id);

        if (found) return found;

        const spec = SPECS[id];

        const e = this.scene.add.particles(0, 0, spec.texture, {
            tint: spec.tint,
            emitting: false,
            blendMode: spec.additive ? 'ADD' : 'NORMAL',
            speed: spec.speed,
            lifespan: spec.lifespan,
            scale: { start: spec.scale.start, end: spec.scale.end, ease: 'Quad.out' },
            alpha: { start: spec.alpha.start, end: spec.alpha.end },
            gravityY: spec.gravityY
        } as object);

        e.setDepth(this.depth);
        this.pool.set(id, e);

        return e;
    }

    /** One puff at a target's position. */
    puff (id: TrailId, x: number, y: number): void
    {
        this.emitter(id).explode(SPECS[id].count, x, y);
    }

    destroy (): void
    {
        for (const e of this.pool.values()) e.destroy();
        this.pool.clear();
    }
}
