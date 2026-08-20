import { GameObjects, Scene } from 'phaser';
import { AIM_LIMIT, MUZZLE } from '../core/theme';

const BARREL = 30;

/**
 * The player's gun: a socketed emplacement at the bottom of the screen whose
 * barrel swings to whatever was just tapped, kicks back, and flares.
 */
export class Turret extends GameObjects.Container
{
    /** World position of the barrel mouth -- where tracers start. */
    tipX = MUZZLE.x;
    tipY = MUZZLE.y - BARREL;

    private rig: GameObjects.Container;
    private barrel: GameObjects.Container;
    private flash: GameObjects.Image;
    private heat: GameObjects.Arc;
    private glow: GameObjects.Arc;
    private aim = -Math.PI / 2;

    constructor (scene: Scene, accent: number, accent2: number)
    {
        super(scene, MUZZLE.x, MUZZLE.y);

        this.glow = scene.add.circle(0, 14, 66, accent, 0.13);

        const base = scene.add.graphics();

        //  Socket the barrel sits in.
        base.fillStyle(0x0a0f22, 0.95);
        base.fillRoundedRect(-58, -12, 116, 60, 18);
        base.fillStyle(accent, 0.12);
        base.fillRoundedRect(-58, -12, 116, 22, { tl: 18, tr: 18, bl: 0, br: 0 });
        base.lineStyle(3, accent, 0.75);
        base.strokeRoundedRect(-58, -12, 116, 60, 18);

        //  Shoulder wedges either side of the pivot.
        base.fillStyle(accent, 0.55);
        base.fillTriangle(-46, -4, -20, -14, -20, -4);
        base.fillTriangle(46, -4, 20, -14, 20, -4);

        //  Energy cell lights.
        base.fillStyle(accent2, 0.9);
        for (let i = -1; i <= 1; i++) base.fillCircle(i * 16, 16, 4);

        this.barrel = scene.add.container(0, 0);

        const gun = scene.add.graphics();
        gun.fillStyle(0x141c38, 1);
        gun.fillRoundedRect(-11, -BARREL, 22, BARREL + 10, 7);
        gun.lineStyle(2.5, accent, 0.85);
        gun.strokeRoundedRect(-11, -BARREL, 22, BARREL + 10, 7);
        gun.fillStyle(accent, 0.85);
        gun.fillRoundedRect(-6, -BARREL + 3, 12, 7, 3);
        gun.fillStyle(accent2, 0.7);
        gun.fillRect(-11, -12, 22, 3);
        this.barrel.add(gun);

        this.heat = scene.add.circle(0, -BARREL + 4, 7, accent2, 0.85);
        this.barrel.add(this.heat);

        this.flash = scene.add.image(0, -BARREL - 4, 'spark');
        this.flash.setDisplaySize(90, 90).setTint(accent).setBlendMode('ADD').setAlpha(0);
        this.barrel.add(this.flash);

        this.rig = scene.add.container(0, -6);
        this.rig.add(this.barrel);

        this.add([ this.glow, base, this.rig ]);
        this.setDepth(28);

        scene.add.existing(this);
        this.point(this.aim, false);
    }

    /** Swing to face a tap and kick. Returns the barrel mouth in world space. */
    fire (px: number, py: number): void
    {
        const raw = Math.atan2(py - (this.y - 6), px - this.x);
        const clamped = Math.max(-Math.PI / 2 - AIM_LIMIT, Math.min(-Math.PI / 2 + AIM_LIMIT, raw));

        this.point(clamped, true);

        this.flash.setAlpha(0.95).setScale(this.flash.scaleX);
        this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 110, ease: 'Quad.out' });

        this.barrel.setY(9);
        this.scene.tweens.add({ targets: this.barrel, y: 0, duration: 150, ease: 'Back.out' });

        this.heat.setScale(1.7);
        this.scene.tweens.add({ targets: this.heat, scale: 1, duration: 220, ease: 'Quad.out' });
    }

    private point (angle: number, tween: boolean): void
    {
        this.aim = angle;

        const rot = angle + Math.PI / 2;

        if (tween)
        {
            this.scene.tweens.add({ targets: this.rig, rotation: rot, duration: 70, ease: 'Quad.out' });
        }
        else
        {
            this.rig.setRotation(rot);
        }

        this.tipX = this.x + Math.cos(angle) * BARREL;
        this.tipY = this.y - 6 + Math.sin(angle) * BARREL;
    }

    /** Gentle idle breathing so the gun never looks like a dead sprite. */
    idle (time: number): void
    {
        this.glow.setScale(1 + Math.sin(time * 0.003) * 0.07);
        this.glow.setAlpha(0.1 + Math.abs(Math.sin(time * 0.0022)) * 0.08);
    }
}
