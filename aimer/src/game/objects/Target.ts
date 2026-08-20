import { GameObjects, Scene } from 'phaser';
import { KINDS, KindDef, TargetKind, unitHp } from '../data/levels';
import { PLAY, FONT } from '../core/theme';

const TAU = Math.PI * 2;

export class Target extends GameObjects.Container
{
    kind: TargetKind;
    def: KindDef;
    radius: number;
    hp: number;
    maxHp: number;
    vx = 0;
    vy = 0;
    life: number;
    maxLife: number;
    dead = false;
    expired = false;

    private core: GameObjects.Arc;
    private glow: GameObjects.Arc;
    private inner: GameObjects.Arc;
    private flash: GameObjects.Arc;
    private label: GameObjects.Text;
    private ring: GameObjects.Graphics;
    private phase: number;
    private flashAmount = 0;

    constructor (scene: Scene, x: number, y: number, kind: TargetKind, baseSize: number, level: number, speed: number, moving: boolean)
    {
        super(scene, x, y);

        this.kind = kind;
        this.def = KINDS[kind];
        this.radius = baseSize * this.def.sizeMult;
        this.maxHp = unitHp(level) * this.def.units;
        this.hp = this.maxHp;
        this.phase = Math.random() * TAU;

        this.maxLife = 0;
        this.life = 0;

        const r = this.radius;
        const c = this.def.color;

        this.glow = scene.add.circle(0, 0, r * 1.55, c, 0.16);
        this.core = scene.add.circle(0, 0, r, c, 1);
        this.core.setStrokeStyle(Math.max(2, r * 0.09), 0xffffff, 0.65);
        this.inner = scene.add.circle(0, 0, r * 0.46, 0x000000, 0.28);
        this.flash = scene.add.circle(0, 0, r, 0xffffff, 1);
        this.flash.setAlpha(0);
        this.ring = scene.add.graphics();

        this.label = scene.add.text(0, 0, this.def.icon, {
            fontFamily: FONT,
            fontSize: Math.round(r * 0.9),
            color: '#0b0f22'
        }).setOrigin(0.5);

        this.updateLabel();

        this.add([ this.glow, this.core, this.inner, this.flash, this.label, this.ring ]);

        if (moving && speed > 0)
        {
            const a = Math.random() * TAU;
            const s = speed * this.def.speedMult;
            this.vx = Math.cos(a) * s;
            this.vy = Math.sin(a) * s;
        }

        this.setScale(0.1);
        scene.tweens.add({ targets: this, scale: 1, duration: 190, ease: 'Back.out' });
        scene.add.existing(this);
    }

    setLifetime (ms: number): this
    {
        this.maxLife = ms;
        this.life = ms;
        return this;
    }

    /** True when the target died from this hit. */
    damage (amount: number): boolean
    {
        this.hp -= amount;
        this.flashAmount = 1;

        if (this.hp <= 0)
        {
            this.dead = true;
            return true;
        }

        this.updateLabel();
        this.scene.tweens.add({ targets: this, scaleX: 0.84, scaleY: 0.84, duration: 60, yoyo: true, ease: 'Quad.out' });

        return false;
    }

    private updateLabel (): void
    {
        if (this.def.units > 1)
        {
            this.label.setText(String(Math.max(1, Math.ceil(this.hp / (this.maxHp / this.def.units)))));
        }
    }

    update (dtMs: number, slow: number): void
    {
        const dt = dtMs / 1000;

        if (this.vx !== 0 || this.vy !== 0)
        {
            this.x += this.vx * slow * dt;
            this.y += this.vy * slow * dt;

            const r = this.radius;

            if (this.x < PLAY.left + r) { this.x = PLAY.left + r; this.vx = Math.abs(this.vx); }
            else if (this.x > PLAY.right - r) { this.x = PLAY.right - r; this.vx = -Math.abs(this.vx); }

            if (this.y < PLAY.top + r) { this.y = PLAY.top + r; this.vy = Math.abs(this.vy); }
            else if (this.y > PLAY.bottom - r) { this.y = PLAY.bottom - r; this.vy = -Math.abs(this.vy); }
        }

        this.life -= dtMs;

        const t = this.scene.time.now;
        const pulse = 1 + Math.sin(t * 0.006 + this.phase) * 0.055;
        this.core.setScale(pulse);
        this.glow.setScale(pulse * (1 + Math.sin(t * 0.004 + this.phase) * 0.08));

        if (this.flashAmount > 0)
        {
            this.flashAmount = Math.max(0, this.flashAmount - dtMs / 130);
            this.flash.setAlpha(this.flashAmount * 0.85);
        }

        const frac = this.maxLife > 0 ? Math.max(0, this.life / this.maxLife) : 1;
        const urgent = frac < 0.32;

        this.ring.clear();
        this.ring.lineStyle(Math.max(3, this.radius * 0.13), urgent ? 0xff4d5e : this.def.ring, urgent ? 0.95 : 0.55);
        this.ring.beginPath();
        this.ring.arc(0, 0, this.radius + Math.max(6, this.radius * 0.22), -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        this.ring.strokePath();

        if (urgent)
        {
            this.glow.setAlpha(0.16 + Math.abs(Math.sin(t * 0.02)) * 0.28);
        }
    }

    /** Squared distance test against a tap, with the player's tap-forgiveness applied. */
    contains (px: number, py: number, forgiveness: number): boolean
    {
        const r = this.radius * forgiveness + 6;
        const dx = px - this.x;
        const dy = py - this.y;
        return dx * dx + dy * dy <= r * r;
    }

    distanceTo (px: number, py: number): number
    {
        return Math.hypot(px - this.x, py - this.y);
    }
}
