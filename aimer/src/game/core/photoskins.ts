import { Scene, Textures } from 'phaser';
import { sa } from './skinart';

/**
 * Skins that come from an image file rather than from drawing code.
 *
 * Everything else the game paints is vector art baked at boot (see core/icons
 * and core/skinart), and that is still the default -- it costs no download and
 * scales to any screen. This is the escape hatch for the one thing drawing
 * code cannot do: an actual photograph or a painted texture.
 *
 * Adding one is a two-step job and nothing else:
 *
 *   1. drop a square image in `public/skins/<id>.png` -- 256x256 is plenty,
 *      since a target is never drawn wider than about 108 design pixels;
 *   2. add a line to PHOTO_SKINS below, and a SKINS entry with `art: '<id>'`.
 *
 * The file is cropped to the target's circle at boot and registered under the
 * same texture namespace as the drawn decals, so nothing downstream needs to
 * know which kind of art it is looking at.
 *
 * Ship only images you hold the rights to. A cosmetic sold inside a game is a
 * commercial use, and photographs, character art and logos each carry their
 * own owner -- being widely reposted is not a licence.
 */

export interface PhotoSkin
{
    /** Matches the file name, the texture key and the skin's `art` field. */
    id: string;
    /**
     * How much of the source to use, 0..1. Below 1 the image is zoomed into
     * its own centre before being cropped to the circle -- the fix for a
     * subject that sits small in its frame.
     */
    zoom?: number;
}

/**
 * The files in `public/skins`. Each one is already square and already framed
 * on its subject -- see `art-src/` for the originals and the crop table that
 * produced these, and re-run that rather than re-framing at runtime: a target
 * is at most 108 design pixels across, so shipping a 1000px scene to crop a
 * face out of it costs the player a megabyte for nothing.
 */
export const PHOTO_SKINS: PhotoSkin[] = [
    { id: 'liquid' },
    { id: 'ember' },
    { id: 'capybara' },
    { id: 'doge' },
    { id: 'nyan' },
    { id: 'boots' },
    { id: 'sticky' },
    { id: 'treeman' },
    { id: 'sharky' },
    { id: 'latte' }
];

const RES = 256;

/** Queues every photo skin's file. Called from Boot's preload. */
export function preloadPhotoSkins (scene: Scene): void
{
    for (const p of PHOTO_SKINS)
    {
        if (scene.textures.exists(src(p.id))) continue;
        scene.load.image(src(p.id), `skins/${p.id}.png`);
    }
}

/** The raw loaded file, before it is cut to a circle. */
function src (id: string): string
{
    return 'photosrc:' + id;
}

/**
 * Cuts each loaded file into the round decal a target actually wears, and
 * registers it beside the drawn ones.
 *
 * A file that failed to load is skipped rather than thrown: a missing cosmetic
 * should cost the player that cosmetic, never the game.
 */
export function registerPhotoSkins (textures: Textures.TextureManager): void
{
    for (const p of PHOTO_SKINS)
    {
        const key = sa(p.id);

        if (textures.exists(key)) continue;
        if (!textures.exists(src(p.id))) continue;

        const image = textures.get(src(p.id)).getSourceImage() as CanvasImageSource;

        const canvas = document.createElement('canvas');
        canvas.width = RES;
        canvas.height = RES;

        const c = canvas.getContext('2d')!;

        c.save();
        c.beginPath();
        c.arc(RES / 2, RES / 2, RES / 2, 0, Math.PI * 2);
        c.clip();

        //  Cover-fit: the image fills the circle whatever shape it arrived in,
        //  cropped rather than squashed.
        const sw = Number((image as HTMLImageElement).width) || RES;
        const sh = Number((image as HTMLImageElement).height) || RES;
        const take = Math.min(sw, sh) * (p.zoom ?? 1);

        c.drawImage(image, (sw - take) / 2, (sh - take) / 2, take, take, 0, 0, RES, RES);

        //  A touch of vignette, so a bright photo still reads as a round
        //  object sitting on the arena rather than as a flat sticker.
        const shade = c.createRadialGradient(RES / 2, RES / 2, RES * 0.34, RES / 2, RES / 2, RES / 2);
        shade.addColorStop(0, 'rgba(0,0,0,0)');
        shade.addColorStop(1, 'rgba(0,0,0,0.38)');
        c.fillStyle = shade;
        c.fillRect(0, 0, RES, RES);

        c.restore();

        textures.addCanvas(key, canvas);
    }
}
