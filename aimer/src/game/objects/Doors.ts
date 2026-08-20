import { GameObjects, Scene } from 'phaser';
import { CX, CY, H, W } from '../core/theme';
import { Sfx } from '../core/audio';

/**
 * The blast doors, and the only thing standing between two levels.
 *
 * They replace every fade-to-black in the run loop. A level ends by the doors
 * slamming shut over it; the next scene is built behind doors that are already
 * closed and simply opens them. The scene swap happens in the dark behind a
 * solid object, so the seam between two levels is a door, not a stall -- and
 * because the door is doing something the whole time, the same wall clock reads
 * as far less waiting than a black screen ever did.
 *
 * Nothing is drawn on their face. A slab of steel that is also a progress
 * readout is neither, and the run's progress is already on the rail in the play
 * HUD where it can be read while playing rather than only between levels.
 */

/** Half the screen plus a little overlap, so the shut seam never shows a gap. */
const PANEL_W = Math.ceil(CX) + 8;

/**
 * The doors are the same doors everywhere -- steel and hazard amber, never the
 * zone's colour. Two scenes hand the transition to each other mid-slam, and a
 * door that changed colour on that frame would read as a glitch rather than as
 * arriving somewhere. Zone colour lives on the rail, and behind the doors.
 */
const STEEL = 0x080b16;
const PLATE = 0x111a30;
const TRIM = 0xffb020;

export class Doors
{
    private scene: Scene;
    private left: GameObjects.Container;
    private right: GameObjects.Container;
    /** The blade of light at the seam: the part the eye actually reads. */
    private seam: GameObjects.Rectangle;

    private shut = true;

    constructor (scene: Scene, depth = 60)
    {
        this.scene = scene;

        this.left = this.panel(false).setDepth(depth);
        this.right = this.panel(true).setDepth(depth);

        this.seam = scene.add.rectangle(CX, CY, 4, H, 0xffffff, 0).setDepth(depth + 1);

        this.left.setX(0);
        this.right.setX(W - PANEL_W);
    }

    /** True while the doors are covering the screen. */
    get closed (): boolean
    {
        return this.shut;
    }

    //  ---------------------------------------------------------------- art

    private panel (mirror: boolean): GameObjects.Container
    {
        const scene = this.scene;
        const c = scene.add.container(0, 0);
        const g = scene.add.graphics();

        //  Local x, measured from the panel's outer edge. Mirroring the maths
        //  rather than the container keeps every position in real pixels.
        const px = (x: number) => (mirror ? PANEL_W - x : x);
        const band = (x: number, w: number, color: number, alpha: number) =>
        {
            g.fillStyle(color, alpha);
            g.fillRect(mirror ? PANEL_W - x - w : x, 0, w, H);
        };

        g.fillStyle(STEEL, 1);
        g.fillRect(0, 0, PANEL_W, H);

        //  Brushed plating: broad vertical bands, subtly different in value.
        for (let i = 0; i < 7; i++)
        {
            band(i * (PANEL_W / 7), PANEL_W / 7 - 2, PLATE, i % 2 ? 0.55 : 0.3);
        }

        //  Horizontal ribs across the whole slab.
        g.fillStyle(0x000000, 0.35);
        for (let y = 60; y < H; y += 96) g.fillRect(0, y, PANEL_W, 10);

        g.lineStyle(2, TRIM, 0.12);
        for (let y = 60; y < H; y += 96) g.lineBetween(0, y, PANEL_W, y);

        //  Inner edge: a hot accent strip, then hazard chevrons pointing back
        //  the way the panel will travel when it opens.
        band(PANEL_W - 10, 10, TRIM, 0.85);
        band(PANEL_W - 26, 14, TRIM, 0.16);

        g.lineStyle(5, TRIM, 0.5);

        for (let y = 40; y < H; y += 64)
        {
            const tipX = px(PANEL_W - 34);
            const backX = px(PANEL_W - 60);

            g.beginPath();
            g.moveTo(backX, y - 15);
            g.lineTo(tipX, y);
            g.lineTo(backX, y + 15);
            g.strokePath();
        }

        //  Rivets down the outer edge.
        g.fillStyle(TRIM, 0.4);
        for (let y = 30; y < H; y += 44) g.fillCircle(px(20), y, 3);

        c.add(g);

        return c;
    }

    //  --------------------------------------------------------------- moves

    close (duration = 280): Promise<void>
    {
        if (this.shut) return Promise.resolve();

        this.shut = true;

        Sfx.door(false);

        return new Promise(resolve =>
        {
            this.scene.tweens.add({
                targets: this.left, x: 0, duration, ease: 'Quart.in'
            });

            this.scene.tweens.add({
                targets: this.right, x: W - PANEL_W, duration, ease: 'Quart.in',
                onComplete: () =>
                {
                    this.scene.cameras.main.shake(140, 0.007);

                    //  The two halves meeting, felt as a line of light along
                    //  the seam rather than as a flash over the whole screen.
                    this.seam.setFillStyle(0xffffff, 0.9).setDisplaySize(54, H).setAlpha(1);
                    this.scene.tweens.add({
                        targets: this.seam, displayWidth: 4, alpha: 0, duration: 200, ease: 'Quad.out',
                        onComplete: () => this.seam.setFillStyle(0xffffff, 0)
                    });

                    resolve();
                }
            });
        });
    }

    open (duration = 320): Promise<void>
    {
        if (!this.shut) return Promise.resolve();

        this.shut = false;

        Sfx.door(true);

        //  A blade of light between the panels that widens with them, so the
        //  eye is pulled through the gap instead of at the doors leaving.
        this.seam.setFillStyle(0xffffff, 0.55).setDisplaySize(6, H).setAlpha(1);

        this.scene.tweens.add({
            targets: this.seam,
            displayWidth: W * 0.5,
            alpha: 0,
            duration: duration * 0.8,
            ease: 'Quad.out',
            onComplete: () => this.seam.setFillStyle(0xffffff, 0)
        });

        return new Promise(resolve =>
        {
            this.scene.tweens.add({
                targets: this.left, x: -PANEL_W, duration, ease: 'Quint.out'
            });

            this.scene.tweens.add({
                targets: this.right, x: W, duration, ease: 'Quint.out',
                onComplete: () => resolve()
            });
        });
    }

    destroy (): void
    {
        this.left.destroy();
        this.right.destroy();
        this.seam.destroy();
    }
}
