import { Scene } from 'phaser';
import { registerIcons } from '../core/icons';

function canvas (size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement
{
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    draw(c.getContext('2d')!, size);
    return c;
}

/**
 * Generates every texture the game needs at runtime -- no external art assets.
 */
export class Boot extends Scene
{
    constructor ()
    {
        super('Boot');
    }

    create ()
    {
        if (!this.textures.exists('spark'))
        {
            this.textures.addCanvas('spark', canvas(32, (ctx, s) =>
            {
                const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
                g.addColorStop(0, 'rgba(255,255,255,1)');
                g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
                g.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, s, s);
            }));

            this.textures.addCanvas('dust', canvas(16, (ctx, s) =>
            {
                const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
                g.addColorStop(0, 'rgba(255,255,255,0.9)');
                g.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, s, s);
            }));
        }

        registerIcons(this.textures);

        this.scene.start('MainMenu');
    }
}
