import { GameObjects, Scene, Textures } from 'phaser';
import { FONT } from './theme';

/**
 * Every icon in the game is a vector drawing baked into a texture at boot --
 * no emoji, no font glyphs, no external art. Each one is authored on a 64x64
 * grid in solid white so it can be tinted to any colour at use time.
 */

const RES = 128;
const GRID = 64;

type Ctx = CanvasRenderingContext2D;
type Draw = (c: Ctx) => void;

const TAU = Math.PI * 2;

function stroke (c: Ctx, w = 6): void
{
    c.strokeStyle = '#ffffff';
    c.lineWidth = w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
}

function poly (c: Ctx, pts: number[][]): void
{
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
}

/** Rounded rectangle path (hand-rolled -- ctx.roundRect is not universal). */
function rr (c: Ctx, x: number, y: number, w: number, h: number, r: number): void
{
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

function starPath (c: Ctx, cx: number, cy: number, points: number, outer: number, inner: number): void
{
    c.beginPath();
    for (let i = 0; i < points * 2; i++)
    {
        const r = i % 2 ? inner : outer;
        const a = -Math.PI / 2 + (i * Math.PI) / points;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath();
}

/** Four-point "sparkle" diamond with concave sides. */
function sparkPath (c: Ctx, cx: number, cy: number, r: number): void
{
    const k = r * 0.2;
    c.beginPath();
    c.moveTo(cx, cy - r);
    c.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
    c.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
    c.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
    c.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
    c.closePath();
}

/** The dollar glyph: an S of two half-bowls with a bar driven through it. */
function dollarPath (c: Ctx, cx: number, cy: number, scale: number): void
{
    c.save();
    c.translate(cx, cy);
    c.scale(scale, scale);

    stroke(c, 7);
    c.beginPath();
    c.arc(0, -11, 12, 0, Math.PI, true);
    c.lineTo(12, 11);
    c.arc(0, 11, 12, 0, Math.PI, false);
    c.stroke();

    stroke(c, 6);
    c.beginPath();
    c.moveTo(0, -28); c.lineTo(0, 28);
    c.stroke();

    c.restore();
}

/** Everything drawn while this is active punches holes instead of adding ink. */
function cut (c: Ctx, draw: () => void): void
{
    c.globalCompositeOperation = 'destination-out';
    draw();
    c.globalCompositeOperation = 'source-over';
}

const ICONS: Record<string, Draw> = {
    //  --- offence -------------------------------------------------------
    bullet: c =>
    {
        c.fillStyle = '#fff';
        c.beginPath();
        c.moveTo(24, 20); c.lineTo(40, 20);
        c.quadraticCurveTo(58, 32, 40, 44);
        c.lineTo(24, 44); c.closePath(); c.fill();

        stroke(c, 5);
        c.beginPath();
        c.moveTo(4, 32); c.lineTo(17, 32);
        c.moveTo(9, 20); c.lineTo(17, 20);
        c.moveTo(9, 44); c.lineTo(17, 44);
        c.stroke();
    },
    damage: c =>
    {
        stroke(c, 8);
        c.beginPath();
        c.moveTo(13, 31); c.lineTo(32, 13); c.lineTo(51, 31);
        c.moveTo(13, 51); c.lineTo(32, 33); c.lineTo(51, 51);
        c.stroke();
    },
    crosshair: c =>
    {
        stroke(c, 5);
        c.beginPath(); c.arc(32, 32, 17, 0, TAU); c.stroke();
        c.beginPath();
        c.moveTo(32, 3); c.lineTo(32, 13);
        c.moveTo(32, 51); c.lineTo(32, 61);
        c.moveTo(3, 32); c.lineTo(13, 32);
        c.moveTo(51, 32); c.lineTo(61, 32);
        c.stroke();
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(32, 32, 5, 0, TAU); c.fill();
    },
    burst: c =>
    {
        c.fillStyle = '#fff';
        starPath(c, 32, 32, 8, 29, 11);
        c.fill();
    },
    trident: c =>
    {
        stroke(c, 6);
        c.beginPath();
        c.moveTo(32, 58); c.lineTo(32, 10);
        c.moveTo(23, 20); c.lineTo(32, 9); c.lineTo(41, 20);
        c.moveTo(11, 58); c.lineTo(11, 25);
        c.moveTo(4, 33); c.lineTo(11, 24); c.lineTo(18, 33);
        c.moveTo(53, 58); c.lineTo(53, 25);
        c.moveTo(46, 33); c.lineTo(53, 24); c.lineTo(60, 33);
        c.stroke();
    },
    arrow: c =>
    {
        stroke(c, 6);
        c.beginPath();
        c.moveTo(7, 57); c.lineTo(51, 13);
        c.moveTo(34, 11); c.lineTo(53, 11); c.lineTo(53, 30);
        c.moveTo(9, 43); c.lineTo(21, 55);
        c.moveTo(17, 35); c.lineTo(29, 47);
        c.stroke();
    },
    bomb: c =>
    {
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(28, 40, 19, 0, TAU); c.fill();
        stroke(c, 5);
        c.beginPath(); c.moveTo(39, 25); c.quadraticCurveTo(51, 21, 51, 11); c.stroke();
        starPath(c, 53, 8, 4, 9, 3); c.fill();
    },
    wave: c =>
    {
        stroke(c, 5);
        for (const r of [ 14, 25, 36 ])
        {
            c.beginPath(); c.arc(11, 32, r, -1.05, 1.05); c.stroke();
        }
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(9, 32, 5, 0, TAU); c.fill();
    },
    bolt: c =>
    {
        c.fillStyle = '#fff';
        poly(c, [ [ 38, 4 ], [ 15, 36 ], [ 29, 36 ], [ 24, 60 ], [ 49, 26 ], [ 34, 26 ] ]);
        c.fill();
    },

    //  --- economy -------------------------------------------------------
    dollar: c =>
    {
        dollarPath(c, 32, 32, 1.05);
    },
    coins: c =>
    {
        //  A coin behind, and a coin in front with the $ punched clean through.
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(43, 22, 14, 0, TAU); c.fill();
        cut(c, () =>
        {
            c.beginPath(); c.arc(43, 22, 7, 0, TAU); c.fill();
            c.beginPath(); c.arc(24, 40, 23, 0, TAU); c.fill();
        });
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(24, 40, 19, 0, TAU); c.fill();
        cut(c, () => dollarPath(c, 24, 40, 0.5));
    },
    coinplus: c =>
    {
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(26, 38, 22, 0, TAU); c.fill();
        cut(c, () => dollarPath(c, 26, 38, 0.58));
        stroke(c, 7);
        c.beginPath();
        c.moveTo(51, 7); c.lineTo(51, 27);
        c.moveTo(41, 17); c.lineTo(61, 17);
        c.stroke();
    },
    gem: c =>
    {
        c.fillStyle = '#fff';
        poly(c, [ [ 32, 4 ], [ 56, 32 ], [ 32, 60 ], [ 8, 32 ] ]);
        c.fill();
        cut(c, () =>
        {
            stroke(c, 3);
            c.beginPath();
            c.moveTo(8, 32); c.lineTo(56, 32);
            c.moveTo(32, 4); c.lineTo(21, 32); c.lineTo(32, 60);
            c.moveTo(32, 4); c.lineTo(43, 32); c.lineTo(32, 60);
            c.stroke();
        });
    },
    star: c =>
    {
        c.fillStyle = '#fff';
        starPath(c, 32, 34, 5, 28, 12);
        c.fill();
    },
    chart: c =>
    {
        c.fillStyle = '#fff';
        rr(c, 8, 40, 12, 18, 3); c.fill();
        rr(c, 26, 28, 12, 30, 3); c.fill();
        rr(c, 44, 14, 12, 44, 3); c.fill();
    },

    //  --- tempo ---------------------------------------------------------
    hourglass: c =>
    {
        stroke(c, 6);
        c.beginPath();
        c.moveTo(14, 8); c.lineTo(50, 8);
        c.moveTo(14, 56); c.lineTo(50, 56);
        c.moveTo(19, 11); c.lineTo(32, 32); c.lineTo(19, 53);
        c.moveTo(45, 11); c.lineTo(32, 32); c.lineTo(45, 53);
        c.stroke();
        c.fillStyle = '#fff';
        poly(c, [ [ 24, 16 ], [ 40, 16 ], [ 32, 29 ] ]);
        c.fill();
    },
    clock: c =>
    {
        stroke(c, 5);
        c.beginPath(); c.arc(32, 32, 23, 0, TAU); c.stroke();
        stroke(c, 6);
        c.beginPath();
        c.moveTo(32, 32); c.lineTo(32, 16);
        c.moveTo(32, 32); c.lineTo(45, 39);
        c.stroke();
    },
    stopwatch: c =>
    {
        stroke(c, 5);
        c.beginPath(); c.arc(32, 38, 20, 0, TAU); c.stroke();
        c.fillStyle = '#fff';
        rr(c, 25, 6, 14, 9, 3); c.fill();
        stroke(c, 5);
        c.beginPath();
        c.moveTo(49, 20); c.lineTo(55, 14);
        c.moveTo(32, 38); c.lineTo(32, 25);
        c.moveTo(32, 38); c.lineTo(42, 44);
        c.stroke();
    },
    link: c =>
    {
        c.save();
        c.translate(32, 32);
        c.rotate(-Math.PI / 4);
        stroke(c, 6);
        rr(c, -25, -11, 27, 22, 11); c.stroke();
        rr(c, -2, -11, 27, 22, 11); c.stroke();
        c.restore();
    },
    rocket: c =>
    {
        c.fillStyle = '#fff';
        c.beginPath();
        c.moveTo(32, 3);
        c.quadraticCurveTo(45, 19, 45, 35);
        c.lineTo(45, 45); c.lineTo(19, 45); c.lineTo(19, 35);
        c.quadraticCurveTo(19, 19, 32, 3);
        c.fill();
        poly(c, [ [ 19, 33 ], [ 7, 51 ], [ 19, 47 ] ]); c.fill();
        poly(c, [ [ 45, 33 ], [ 57, 51 ], [ 45, 47 ] ]); c.fill();
        poly(c, [ [ 25, 47 ], [ 39, 47 ], [ 32, 62 ] ]); c.fill();
        cut(c, () =>
        {
            c.beginPath(); c.arc(32, 24, 7, 0, TAU); c.fill();
        });
    },

    //  --- utility -------------------------------------------------------
    magnet: c =>
    {
        stroke(c, 11);
        c.beginPath(); c.arc(32, 33, 17, Math.PI, 0); c.stroke();
        c.beginPath();
        c.moveTo(15, 33); c.lineTo(15, 51);
        c.moveTo(49, 33); c.lineTo(49, 51);
        c.stroke();
        cut(c, () =>
        {
            c.fillStyle = '#000';
            c.fillRect(9, 42, 12, 3);
            c.fillRect(43, 42, 12, 3);
        });
    },
    dice: c =>
    {
        stroke(c, 5);
        rr(c, 11, 11, 42, 42, 11); c.stroke();
        c.fillStyle = '#fff';
        for (const p of [ [ 21, 21 ], [ 43, 21 ], [ 32, 32 ], [ 21, 43 ], [ 43, 43 ] ])
        {
            c.beginPath(); c.arc(p[0], p[1], 4, 0, TAU); c.fill();
        }
    },
    sparkle: c =>
    {
        c.fillStyle = '#fff';
        sparkPath(c, 27, 28, 25); c.fill();
        sparkPath(c, 51, 51, 12); c.fill();
    },
    shield: c =>
    {
        stroke(c, 6);
        c.beginPath();
        c.moveTo(32, 5); c.lineTo(53, 14); c.lineTo(53, 31);
        c.quadraticCurveTo(53, 50, 32, 59);
        c.quadraticCurveTo(11, 50, 11, 31);
        c.lineTo(11, 14); c.closePath();
        c.stroke();
    },
    flag: c =>
    {
        stroke(c, 6);
        c.beginPath(); c.moveTo(16, 7); c.lineTo(16, 58); c.stroke();
        c.fillStyle = '#fff';
        poly(c, [ [ 20, 10 ], [ 53, 21 ], [ 20, 33 ] ]);
        c.fill();
    },

    //  --- chrome --------------------------------------------------------
    soundOn: c =>
    {
        c.fillStyle = '#fff';
        poly(c, [ [ 6, 24 ], [ 18, 24 ], [ 32, 9 ], [ 32, 55 ], [ 18, 40 ], [ 6, 40 ] ]);
        c.fill();
        stroke(c, 5);
        c.beginPath(); c.arc(36, 32, 10, -0.95, 0.95); c.stroke();
        c.beginPath(); c.arc(36, 32, 20, -0.95, 0.95); c.stroke();
    },
    soundOff: c =>
    {
        c.fillStyle = '#fff';
        poly(c, [ [ 6, 24 ], [ 18, 24 ], [ 32, 9 ], [ 32, 55 ], [ 18, 40 ], [ 6, 40 ] ]);
        c.fill();
        stroke(c, 6);
        c.beginPath();
        c.moveTo(41, 23); c.lineTo(58, 41);
        c.moveTo(58, 23); c.lineTo(41, 41);
        c.stroke();
    },
    arrowRight: c =>
    {
        stroke(c, 7);
        c.beginPath();
        c.moveTo(7, 32); c.lineTo(48, 32);
        c.moveTo(34, 17); c.lineTo(50, 32); c.lineTo(34, 47);
        c.stroke();
    },
    chevrons: c =>
    {
        stroke(c, 8);
        c.beginPath();
        c.moveTo(15, 14); c.lineTo(31, 32); c.lineTo(15, 50);
        c.moveTo(33, 14); c.lineTo(49, 32); c.lineTo(33, 50);
        c.stroke();
    },

    //  --- target marks --------------------------------------------------
    skull: c =>
    {
        c.fillStyle = '#fff';
        c.beginPath();
        c.moveTo(11, 30);
        c.quadraticCurveTo(11, 6, 32, 6);
        c.quadraticCurveTo(53, 6, 53, 30);
        c.quadraticCurveTo(53, 43, 45, 47);
        c.lineTo(45, 56); c.lineTo(19, 56); c.lineTo(19, 47);
        c.quadraticCurveTo(11, 43, 11, 30);
        c.fill();
        cut(c, () =>
        {
            c.fillStyle = '#000';
            c.beginPath(); c.arc(23, 30, 7.5, 0, TAU); c.fill();
            c.beginPath(); c.arc(41, 30, 7.5, 0, TAU); c.fill();
            poly(c, [ [ 32, 36 ], [ 26, 46 ], [ 38, 46 ] ]); c.fill();
            c.fillRect(25, 48, 4, 9);
            c.fillRect(35, 48, 4, 9);
        });
    },
    trefoil: c =>
    {
        c.fillStyle = '#fff';
        for (let i = 0; i < 3; i++)
        {
            const a = -Math.PI / 2 + (i * TAU) / 3;
            c.beginPath();
            c.moveTo(32, 32);
            c.arc(32, 32, 28, a - 0.52, a + 0.52);
            c.closePath();
            c.fill();
        }
        cut(c, () =>
        {
            c.beginPath(); c.arc(32, 32, 12, 0, TAU); c.fill();
        });
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(32, 32, 6.5, 0, TAU); c.fill();
    },
    mult: c =>
    {
        stroke(c, 10);
        c.beginPath();
        c.moveTo(16, 16); c.lineTo(48, 48);
        c.moveTo(48, 16); c.lineTo(16, 48);
        c.stroke();
    },

    //  --- platform ------------------------------------------------------
    //  The same clip body as `video`, but the play triangle is swapped for a
    //  die face: one glyph that says "watch a video" and "reroll these cards"
    //  at once, so the button needs no second line of text.
    videoDice: c =>
    {
        stroke(c, 5);
        rr(c, 4, 15, 42, 34, 9);
        c.stroke();

        c.fillStyle = '#fff';
        c.beginPath();
        c.moveTo(46, 26); c.lineTo(59, 18); c.lineTo(59, 46); c.lineTo(46, 38);
        c.closePath(); c.fill();

        for (const [ x, y ] of [ [ 16, 41 ], [ 25, 32 ], [ 34, 23 ] ])
        {
            c.beginPath(); c.arc(x, y, 4.2, 0, TAU); c.fill();
        }
    },

    //  A screen with a play triangle: the only honest way to say "this button
    //  starts a video" without words the player has to read.
    video: c =>
    {
        stroke(c, 5);
        rr(c, 5, 14, 44, 36, 7);
        c.stroke();

        c.fillStyle = '#fff';
        poly(c, [ [ 22, 24 ], [ 36, 32 ], [ 22, 40 ] ]);
        c.fill();

        c.beginPath();
        c.moveTo(49, 27); c.lineTo(60, 19); c.lineTo(60, 45); c.lineTo(49, 37);
        c.closePath(); c.fill();
    }
};

/** Texture key for an icon name. */
export function ic (name: string): string
{
    return 'ic:' + name;
}

/** Bakes every icon into a texture. Called once, from Boot. */
export function registerIcons (textures: Textures.TextureManager): void
{
    const scale = RES / GRID;

    for (const name in ICONS)
    {
        const key = ic(name);
        if (textures.exists(key)) continue;

        const canvas = document.createElement('canvas');
        canvas.width = RES;
        canvas.height = RES;

        const c = canvas.getContext('2d')!;
        c.scale(scale, scale);
        ICONS[name](c);

        textures.addCanvas(key, canvas);
    }
}

export interface IconOpts
{
    size?: number;
    color?: number;
    alpha?: number;
}

/** A tinted icon image, square, sized in pixels. */
export function iconImage (scene: Scene, x: number, y: number, name: string, opts: IconOpts = {}): GameObjects.Image
{
    const img = scene.add.image(x, y, ic(name));
    const size = opts.size ?? 28;

    img.setDisplaySize(size, size);
    if (opts.color !== undefined) img.setTint(opts.color);
    if (opts.alpha !== undefined) img.setAlpha(opts.alpha);

    return img;
}

export type LabelAlign = 'left' | 'center' | 'right';

export interface IconLabelOpts
{
    iconSize?: number;
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    iconColor?: number;
    gap?: number;
    align?: LabelAlign;
}

/**
 * An icon paired with a value, kept laid out as the value changes -- used
 * everywhere a currency or stat used to be prefixed with a glyph.
 */
export class IconLabel extends GameObjects.Container
{
    readonly icon: GameObjects.Image;
    readonly text: GameObjects.Text;

    private gap: number;
    private iconSize: number;
    private align: LabelAlign;

    constructor (scene: Scene, x: number, y: number, name: string, value: string, opts: IconLabelOpts = {})
    {
        super(scene, x, y);

        this.gap = opts.gap ?? 8;
        this.iconSize = opts.iconSize ?? 24;
        this.align = opts.align ?? 'center';

        this.icon = iconImage(scene, 0, 0, name, {
            size: this.iconSize,
            color: opts.iconColor ?? 0xffc857
        });

        this.text = scene.add.text(0, 0, value, {
            fontFamily: opts.fontFamily ?? FONT,
            fontSize: opts.fontSize ?? 24,
            color: opts.color ?? '#ffc857'
        }).setOrigin(0, 0.5);

        this.add([ this.icon, this.text ]);
        this.layout();

        scene.add.existing(this);
    }

    setValue (value: string, showIcon = true): this
    {
        this.text.setText(value);
        this.icon.setVisible(showIcon);
        this.layout();
        return this;
    }

    private layout (): void
    {
        const iconW = this.icon.visible ? this.iconSize + this.gap : 0;
        const total = iconW + this.text.width;
        const left = this.align === 'center' ? -total / 2 : (this.align === 'right' ? -total : 0);

        this.icon.setX(left + this.iconSize / 2);
        this.text.setX(left + iconW);
    }
}
