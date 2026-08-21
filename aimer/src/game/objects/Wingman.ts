import { GameObjects, Scene } from 'phaser';
import { Tier, mix } from '../core/theme';

/**
 * The bought second gun.
 *
 * It is deliberately not another copy of the player's turret: it never grows,
 * never takes an upgrade and never aims where the player tapped. It is a small
 * automated pod bolted to the corner of the arena that picks its own target
 * every second or so and takes the shot -- help, not a second player. That
 * keeps the thing the player actually buys legible from across the room: an
 * extra barrel firing on its own, off to one side of theirs.
 */

const HULL = 0x1b2549;
const HULL_LIT = 0x2d3c74;

/** Barrel length from the pivot. */
const REACH = 26;

export class Wingman extends GameObjects.Container
{
    /** Which way the pod leans when it has nothing to shoot at. */
    private readonly rest: number;

    private rig: GameObjects.Container;
    private barrel: GameObjects.Graphics;
    private flash: GameObjects.Graphics;
    private lamp: GameObjects.Graphics;

    private aimAngle: number;
    private heat = 0;

    constructor (scene: Scene, x: number, y: number, tier: Tier, facing: number)
    {
        super(scene, x, y);

        this.rest = -Math.PI / 2 + facing * 0.32;
        this.aimAngle = this.rest;

        const edge = mix(tier.accent, 0xffffff, 0.35);

        const base = scene.add.graphics();

        //  Mount: a stubby plinth clamped to the floor of the arena.
        base.fillStyle(HULL, 1);
        base.fillRoundedRect(-21, -6, 42, 22, 7);
        base.lineStyle(2.5, edge, 0.85);
        base.strokeRoundedRect(-21, -6, 42, 22, 7);

        base.fillStyle(HULL_LIT, 1);
        base.fillRoundedRect(-13, 8, 26, 10, 4);

        this.add(base);

        this.rig = scene.add.container(0, -4);
        this.add(this.rig);

        this.barrel = scene.add.graphics();

        //  Drawn pointing straight up; the rig's rotation does the aiming.
        this.barrel.fillStyle(HULL, 1);
        this.barrel.fillRoundedRect(-5, -REACH, 10, REACH + 8, 4);
        this.barrel.lineStyle(2, edge, 0.9);
        this.barrel.strokeRoundedRect(-5, -REACH, 10, REACH + 8, 4);

        this.barrel.fillStyle(tier.accent2, 0.9);
        this.barrel.fillRoundedRect(-2, -REACH + 5, 4, 9, 2);

        this.rig.add(this.barrel);

        this.flash = scene.add.graphics();
        this.flash.setAlpha(0);
        this.rig.add(this.flash);

        this.flash.fillStyle(0xffffff, 0.9);
        this.flash.fillCircle(0, -REACH - 2, 9);
        this.flash.fillStyle(tier.accent2, 0.55);
        this.flash.fillCircle(0, -REACH - 2, 15);

        //  Housing over the pivot, so the barrel comes out of something.
        const cap = scene.add.graphics();
        cap.fillStyle(HULL_LIT, 1);
        cap.fillCircle(0, 0, 12);
        cap.lineStyle(2.5, edge, 0.9);
        cap.strokeCircle(0, 0, 12);
        this.add(cap);

        this.lamp = scene.add.graphics();
        this.add(this.lamp);

        this.setDepth(7);
        this.rig.setRotation(this.aimAngle + Math.PI / 2);

        scene.add.existing(this);
    }

    /** Swings the barrel towards a point in world space. */
    aimAt (x: number, y: number): void
    {
        this.aimAngle = Math.atan2(y - this.y, x - this.x);
    }

    /** World position of the barrel mouth, wherever it is pointing now. */
    get muzzle (): { x: number; y: number }
    {
        return {
            x: this.x + Math.cos(this.aimAngle) * (REACH + 6),
            y: this.y - 4 + Math.sin(this.aimAngle) * (REACH + 6)
        };
    }

    /** The kick and the flare. The shot itself belongs to the scene. */
    fire (): void
    {
        this.heat = 1;
        this.flash.setAlpha(1);

        this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 130 });
        this.scene.tweens.add({
            targets: this.barrel,
            y: 6,
            duration: 55,
            yoyo: true,
            ease: 'Quad.out'
        });
    }

    /** Per-frame: eases the barrel round and idles the status lamp. */
    tick (dtMs: number, now: number): void
    {
        const want = this.aimAngle + Math.PI / 2;
        let d = want - this.rig.rotation;

        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;

        this.rig.rotation += d * Math.min(1, dtMs / 90);

        if (this.heat > 0) this.heat = Math.max(0, this.heat - dtMs / 700);

        const pulse = 0.45 + Math.abs(Math.sin(now * 0.004)) * 0.3;

        this.lamp.clear();
        this.lamp.fillStyle(0x6cf5c8, this.heat > 0 ? 0.35 + this.heat * 0.5 : pulse * 0.5);
        this.lamp.fillCircle(0, 0, 4.5 + this.heat * 2);
    }

    /** Drops back to its resting lean -- used when the board is empty. */
    stand (): void
    {
        this.aimAngle = this.rest;
    }
}
