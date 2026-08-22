import { GameObjects, Scene } from 'phaser';
import { Gift, RARITY } from '../data/gifts';
import { sa } from '../core/skinart';
import { iconImage } from '../core/icons';
import { BodyShape, fillBody, strokeBody } from '../core/shapes';
import { FONT, FONT_UI, hex, mix } from '../core/theme';

/**
 * One prize, drawn the same way wherever it is shown -- flying past on the
 * reel, and again three times the size on the card that lands.
 *
 * A face is the baked decal the target itself wears, so what the player sees
 * spinning is exactly what turns up on the board afterwards. Everything else
 * borrows the glyph the store already sells it under, for the same reason.
 */

/**
 * Everything needed to draw a thing the game gives away: a decal, a glyph, or
 * a silhouette and a colour. `Gift` satisfies it, and so does a skin or a
 * boost handed over straight from its own table.
 */
export interface PrizeLook
{
    color: number;
    /** Icon texture name (see core/icons). */
    icon?: string;
    /** Skin decal name (see core/skinart and core/photoskins). */
    art?: string;
    shape?: BodyShape;
}

/** The picture on a prize: the real decal, the store glyph, or the silhouette. */
export function prizeFace (scene: Scene, look: PrizeLook, size: number): GameObjects.Image | GameObjects.Graphics
{
    if (look.art && scene.textures.exists(sa(look.art)))
    {
        const img = scene.add.image(0, 0, sa(look.art));
        img.setDisplaySize(size, size);
        return img;
    }

    if (look.icon)
    {
        return iconImage(scene, 0, 0, look.icon, { size: size * 0.8, color: look.color });
    }

    //  A skin with no decal is sold on its shape and its paint, so that is
    //  what the tile shows -- the same body the store's own preview draws.
    const g = scene.add.graphics();
    const r = size * 0.42;

    g.fillStyle(look.color, 0.2);
    g.fillCircle(0, 0, r * 1.6);
    g.fillStyle(look.color, 1);
    fillBody(g, look.shape ?? 'circle', r, 0);
    g.lineStyle(2, mix(look.color, 0xffffff, 0.6), 0.8);
    strokeBody(g, look.shape ?? 'circle', r, 0);

    return g;
}

export interface TileOpts
{
    /** Drop the name strip -- for the big card, which spells it out below. */
    bare?: boolean;
}

/**
 * A prize in a box, lit in its rarity's colour. Sized by the caller so the
 * reel and the reveal can be the same object at two scales.
 */
export function prizeTile (scene: Scene, gift: Gift, w: number, h: number, opts: TileOpts = {}): GameObjects.Container
{
    const tile = scene.add.container(0, 0);
    const edge = RARITY[gift.rarity].color;
    const bare = opts.bare === true;

    const g = scene.add.graphics();

    g.fillStyle(0x0b1024, 0.94);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
    g.fillStyle(edge, 0.12);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);

    //  A bar of the rarity's colour along the bottom, which is how the eye
    //  sorts a strip of tiles moving too fast to read.
    g.fillStyle(edge, 0.9);
    g.fillRoundedRect(-w / 2 + 10, h / 2 - 9, w - 20, 5, 3);

    g.lineStyle(2, edge, 0.85);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);

    tile.add(g);

    const face = prizeFace(scene, gift, Math.min(w, h) * (bare ? 0.72 : 0.56));
    face.setPosition(0, bare ? 0 : -h * 0.12);

    tile.add(face);

    if (!bare)
    {
        const label = scene.add.text(0, h / 2 - 26, gift.name, {
            fontFamily: FONT_UI, fontSize: 12, color: '#c8d2f0', align: 'center',
            wordWrap: { width: w - 14 }
        }).setOrigin(0.5);

        tile.add(label);
    }

    tile.setSize(w, h);

    return tile;
}

/** The rarity's own word, in the rarity's own colour. */
export function rarityText (scene: Scene, x: number, y: number, gift: Gift, size = 18): GameObjects.Text
{
    return scene.add.text(x, y, RARITY[gift.rarity].label, {
        fontFamily: FONT, fontSize: size, color: hex(RARITY[gift.rarity].color)
    }).setOrigin(0.5);
}
