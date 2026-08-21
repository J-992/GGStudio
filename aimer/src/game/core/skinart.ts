import { Textures } from 'phaser';

/**
 * The faces and flags a target can be painted with.
 *
 * Same rule as core/icons: every one of these is a vector drawing baked into a
 * texture at boot -- no downloaded art, no photographs, no external files. That
 * keeps the whole wardrobe inside a build that is measured in kilobytes, and it
 * keeps every design in the game something this repository actually owns.
 *
 * Each decal is authored on a 64x64 grid and drawn to fill the circle inscribed
 * in it, because that circle is exactly the target it will be painted onto.
 */

const RES = 128;
const GRID = 64;
const C = 32;
const R = 32;

type Ctx = CanvasRenderingContext2D;
type Draw = (c: Ctx) => void;

const TAU = Math.PI * 2;

//  ---------------------------------------------------------------- helpers

/** Everything drawn inside stays within the target's circle. */
function disc (c: Ctx, draw: () => void): void
{
    c.save();
    c.beginPath();
    c.arc(C, C, R, 0, TAU);
    c.clip();
    draw();
    c.restore();
}

function fill (c: Ctx, color: string): void
{
    c.fillStyle = color;
    c.fillRect(0, 0, GRID, GRID);
}

/** Vertical bands, left to right. Weights default to equal widths. */
function vbands (c: Ctx, colors: string[], weights?: number[]): void
{
    const ws = weights || colors.map(() => 1);
    const total = ws.reduce((a, b) => a + b, 0);
    let x = 0;

    colors.forEach((col, i) =>
    {
        const w = (ws[i] / total) * GRID;
        c.fillStyle = col;
        c.fillRect(x, 0, w + 0.5, GRID);
        x += w;
    });
}

/** Horizontal bands, top to bottom. Weights default to equal. */
function hbands (c: Ctx, colors: string[], weights?: number[]): void
{
    const ws = weights || colors.map(() => 1);
    const total = ws.reduce((a, b) => a + b, 0);
    let y = 0;

    colors.forEach((col, i) =>
    {
        const h = (ws[i] / total) * GRID;
        c.fillStyle = col;
        c.fillRect(0, y, GRID, h + 0.5);
        y += h;
    });
}

function circle (c: Ctx, x: number, y: number, r: number, color: string): void
{
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
}

function ellipse (c: Ctx, x: number, y: number, rx: number, ry: number, color: string, rot = 0): void
{
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(0, 0, rx, ry, 0, 0, TAU);
    c.fill();
    c.restore();
}

function poly (c: Ctx, pts: number[][], color: string): void
{
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    c.fill();
}

function line (c: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, w: number): void
{
    c.strokeStyle = color;
    c.lineWidth = w;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
}

function star (c: Ctx, x: number, y: number, r: number, color: string, points = 5): void
{
    c.fillStyle = color;
    c.beginPath();

    for (let i = 0; i < points * 2; i++)
    {
        const rad = i % 2 ? r * 0.45 : r;
        const a = -Math.PI / 2 + (i * Math.PI) / points;
        const px = x + Math.cos(a) * rad;
        const py = y + Math.sin(a) * rad;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
    }

    c.closePath();
    c.fill();
}

/** A pair of eyes, the one thing every face in here has in common. */
function eyes (c: Ctx, x: number, y: number, r: number, gap: number, pupil = '#101828', white = '#ffffff'): void
{
    for (const side of [ -1, 1 ])
    {
        circle(c, x + side * gap, y, r, white);
        circle(c, x + side * gap + side * r * 0.16, y + r * 0.12, r * 0.52, pupil);
        circle(c, x + side * gap - side * r * 0.24, y - r * 0.3, r * 0.2, '#ffffff');
    }
}

//  ------------------------------------------------------------------ faces

const FACES: Record<string, Draw> = {
    frog: c => disc(c, () =>
    {
        fill(c, '#5fbf3f');
        ellipse(c, C, 46, 30, 20, '#7ad657');

        //  Eye bulges sit proud of the head -- the whole reason a frog reads
        //  as a frog at fifteen pixels across.
        circle(c, 18, 17, 12, '#5fbf3f');
        circle(c, 46, 17, 12, '#5fbf3f');
        eyes(c, C, 16, 8, 14);

        line(c, 14, 42, C, 47, '#2f7a1e', 3.5);
        line(c, C, 47, 50, 42, '#2f7a1e', 3.5);
        circle(c, 26, 34, 1.8, '#2f7a1e');
        circle(c, 38, 34, 1.8, '#2f7a1e');
    }),

    tiger: c => disc(c, () =>
    {
        fill(c, '#f59027');

        //  Stripes first, so the muzzle and eyes sit on top of them.
        for (const s of [ [ 6, 2, 14, 16 ], [ 52, 2, 46, 16 ], [ 2, 22, 13, 26 ], [ 56, 22, 47, 26 ] ])
        {
            line(c, s[0], s[1], s[2], s[3], '#241a12', 4.5);
        }

        line(c, 24, 1, 26, 12, '#241a12', 4);
        line(c, 40, 1, 38, 12, '#241a12', 4);

        ellipse(c, C, 44, 17, 12, '#ffe7c9');
        eyes(c, C, 26, 7.5, 12, '#241a12', '#fff6e6');

        poly(c, [ [ 27, 39 ], [ 37, 39 ], [ C, 45 ] ], '#c2543a');
        line(c, C, 45, C, 50, '#241a12', 2.5);
        line(c, C, 50, 24, 53, '#241a12', 2.5);
        line(c, C, 50, 40, 53, '#241a12', 2.5);
    }),

    panda: c => disc(c, () =>
    {
        fill(c, '#f7f4ef');
        circle(c, 12, 8, 10, '#1b1b1f');
        circle(c, 52, 8, 10, '#1b1b1f');

        ellipse(c, 21, 30, 10, 12, '#1b1b1f', -0.3);
        ellipse(c, 43, 30, 10, 12, '#1b1b1f', 0.3);

        circle(c, 21, 30, 4.4, '#ffffff');
        circle(c, 43, 30, 4.4, '#ffffff');
        circle(c, 22, 31, 2.4, '#141418');
        circle(c, 42, 31, 2.4, '#141418');

        ellipse(c, C, 44, 6, 4.5, '#1b1b1f');
        line(c, C, 48, 26, 53, '#1b1b1f', 2.5);
        line(c, C, 48, 38, 53, '#1b1b1f', 2.5);
    }),

    fox: c => disc(c, () =>
    {
        fill(c, '#ef7c30');
        poly(c, [ [ 4, 22 ], [ 12, 0 ], [ 26, 12 ] ], '#d2601c');
        poly(c, [ [ 60, 22 ], [ 52, 0 ], [ 38, 12 ] ], '#d2601c');

        ellipse(c, C, 46, 19, 15, '#fdf3e6');
        poly(c, [ [ 8, 34 ], [ 24, 30 ], [ 16, 48 ] ], '#fdf3e6');
        poly(c, [ [ 56, 34 ], [ 40, 30 ], [ 48, 48 ] ], '#fdf3e6');

        eyes(c, C, 28, 6.5, 11, '#2a1a12', '#ffffff');
        ellipse(c, C, 43, 5, 4, '#2a1a12');
        line(c, C, 46, C, 50, '#8a5a3a', 2);
    }),

    shark: c => disc(c, () =>
    {
        fill(c, '#5f7d99');
        ellipse(c, C, 56, 34, 18, '#e8f0f6');
        poly(c, [ [ 22, 2 ], [ C, -12 ], [ 42, 2 ] ], '#4a6478');

        //  A row of teeth along the jaw line does more for "shark" than the
        //  body colour ever will.
        c.fillStyle = '#ffffff';
        for (let i = 0; i < 9; i++)
        {
            const x = 6 + i * 6.5;
            poly(c, [ [ x, 38 ], [ x + 6, 38 ], [ x + 3, 47 ] ], '#ffffff');
        }

        c.fillStyle = '#3a4d5e';
        c.fillRect(0, 34, GRID, 4);

        circle(c, 20, 22, 6, '#101820');
        circle(c, 44, 22, 6, '#101820');
        circle(c, 18, 20, 2, '#ffffff');
        circle(c, 42, 20, 2, '#ffffff');
    }),

    cat: c => disc(c, () =>
    {
        fill(c, '#9aa3b2');
        poly(c, [ [ 6, 20 ], [ 14, 0 ], [ 28, 10 ] ], '#7f8899');
        poly(c, [ [ 58, 20 ], [ 50, 0 ], [ 36, 10 ] ], '#7f8899');
        poly(c, [ [ 12, 16 ], [ 16, 4 ], [ 24, 11 ] ], '#f0b6c4');
        poly(c, [ [ 52, 16 ], [ 48, 4 ], [ 40, 11 ] ], '#f0b6c4');

        for (const side of [ -1, 1 ])
        {
            ellipse(c, C + side * 11, 30, 7, 8.5, '#f7e04a');
            ellipse(c, C + side * 11, 30, 2, 7.5, '#1a1a20');
        }

        poly(c, [ [ 28, 40 ], [ 36, 40 ], [ C, 45 ] ], '#f0b6c4');
        line(c, C, 45, 27, 50, '#3a3f4a', 2);
        line(c, C, 45, 37, 50, '#3a3f4a', 2);

        for (const side of [ -1, 1 ])
        {
            line(c, C + side * 12, 44, C + side * 30, 40, '#e8ecf2', 1.6);
            line(c, C + side * 12, 47, C + side * 30, 49, '#e8ecf2', 1.6);
        }
    }),

    //  ------------------------------------------------------------ characters

    ninja: c => disc(c, () =>
    {
        fill(c, '#232a3d');
        c.fillStyle = '#161b2a';
        c.fillRect(0, 0, GRID, 20);
        c.fillRect(0, 40, GRID, 24);

        c.fillStyle = '#c8342f';
        c.fillRect(0, 14, GRID, 7);
        poly(c, [ [ 52, 18 ], [ 64, 12 ], [ 64, 30 ], [ 52, 24 ] ], '#c8342f');

        for (const side of [ -1, 1 ])
        {
            poly(c, [
                [ C + side * 6, 28 ], [ C + side * 20, 25 ],
                [ C + side * 20, 34 ], [ C + side * 6, 35 ]
            ], '#ffffff');

            circle(c, C + side * 14, 30, 3.4, '#1a1f2e');
        }
    }),

    robot: c => disc(c, () =>
    {
        fill(c, '#8e9bb0');
        c.fillStyle = '#6e7b90';
        c.fillRect(0, 0, GRID, 12);

        line(c, C, 12, C, 2, '#4c586b', 3);
        circle(c, C, 2, 4, '#ff5470');

        //  One visor rather than two eyes: it is the single cheapest shape
        //  that says machine.
        c.fillStyle = '#161d2b';
        c.fillRect(9, 22, 46, 18);
        c.fillStyle = '#3fe0ff';
        c.fillRect(15, 28, 11, 7);
        c.fillRect(38, 28, 11, 7);

        c.fillStyle = '#5a6678';
        for (let i = 0; i < 5; i++) c.fillRect(18 + i * 7, 46, 5, 5);

        circle(c, 7, 32, 3, '#5a6678');
        circle(c, 57, 32, 3, '#5a6678');
    }),

    alien: c => disc(c, () =>
    {
        fill(c, '#6fdc8c');
        ellipse(c, C, 20, 26, 18, '#8ff0a6');

        //  Big black almonds, angled inwards. Nothing else needed.
        ellipse(c, 20, 28, 10, 6.5, '#0d1b12', -0.5);
        ellipse(c, 44, 28, 10, 6.5, '#0d1b12', 0.5);
        ellipse(c, 17, 26, 3, 2, '#ffffff', -0.5);
        ellipse(c, 41, 26, 3, 2, '#ffffff', 0.5);

        line(c, 26, 46, 38, 46, '#2f7a4a', 3);
        circle(c, 28, 39, 1.5, '#2f7a4a');
        circle(c, 36, 39, 1.5, '#2f7a4a');
    }),

    skull: c => disc(c, () =>
    {
        fill(c, '#ece7dc');
        ellipse(c, C, 26, 26, 22, '#f7f3ea');

        circle(c, 21, 27, 9, '#14141a');
        circle(c, 43, 27, 9, '#14141a');
        circle(c, 21, 27, 3, '#ff4d5e');
        circle(c, 43, 27, 3, '#ff4d5e');

        poly(c, [ [ 28, 40 ], [ 36, 40 ], [ C, 47 ] ], '#14141a');

        c.fillStyle = '#14141a';
        for (let i = 0; i < 5; i++) c.fillRect(17 + i * 7, 51, 2.5, 9);
        c.fillRect(15, 49, 34, 3);
    }),

    clown: c => disc(c, () =>
    {
        fill(c, '#fce6d8');
        circle(c, 8, 14, 12, '#ff4d5e');
        circle(c, 56, 14, 12, '#3fe0ff');
        circle(c, C, 2, 11, '#ffd23f');

        eyes(c, C, 27, 7, 12);
        line(c, 18, 18, 26, 22, '#3a2a24', 2.4);
        line(c, 46, 18, 38, 22, '#3a2a24', 2.4);

        c.strokeStyle = '#d63a4c';
        c.lineWidth = 3.5;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(C, 40, 14, 0.2 * Math.PI, 0.8 * Math.PI);
        c.stroke();

        circle(c, C, 39, 7, '#ff3b45');
        circle(c, 30, 37, 2.4, '#ff8a95');
    })
};

//  ------------------------------------------------------------------ flags

/**
 * National flags, drawn as roundels.
 *
 * A flag is a rectangle and a target is not, so each one is redrawn as the
 * circular badge version of itself rather than squashed into the circle -- the
 * same thing an airline tail or a sports crest does with the identical problem.
 * The designs themselves are national emblems and free of copyright; what is
 * drawn here is this repository's own rendering of them.
 */
const FLAGS: Record<string, Draw> = {
    usa: c => disc(c, () =>
    {
        const stripe = GRID / 13;

        for (let i = 0; i < 13; i++)
        {
            c.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff';
            c.fillRect(0, i * stripe, GRID, stripe + 0.5);
        }

        c.fillStyle = '#3c3b6e';
        c.fillRect(0, 0, 32, stripe * 7);

        for (let row = 0; row < 4; row++)
        {
            for (let col = 0; col < 4; col++)
            {
                star(c, 5 + col * 8 + (row % 2 ? 4 : 0), 5 + row * 8, 2.6, '#ffffff');
            }
        }
    }),

    uk: c => disc(c, () =>
    {
        fill(c, '#012169');

        c.lineCap = 'butt';
        line(c, 0, 0, GRID, GRID, '#ffffff', 14);
        line(c, GRID, 0, 0, GRID, '#ffffff', 14);
        line(c, 0, 0, GRID, GRID, '#c8102e', 7);
        line(c, GRID, 0, 0, GRID, '#c8102e', 7);

        c.fillStyle = '#ffffff';
        c.fillRect(0, C - 11, GRID, 22);
        c.fillRect(C - 11, 0, 22, GRID);

        c.fillStyle = '#c8102e';
        c.fillRect(0, C - 6, GRID, 12);
        c.fillRect(C - 6, 0, 12, GRID);
    }),

    japan: c => disc(c, () =>
    {
        fill(c, '#ffffff');
        circle(c, C, C, 19, '#bc002d');
    }),

    brazil: c => disc(c, () =>
    {
        fill(c, '#009c3b');
        poly(c, [ [ C, 6 ], [ 58, C ], [ C, 58 ], [ 6, C ] ], '#ffdf00');
        circle(c, C, C, 14, '#002776');

        c.strokeStyle = '#ffffff';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(C, C + 14, 18, Math.PI * 1.18, Math.PI * 1.82);
        c.stroke();

        for (const p of [ [ 26, 26 ], [ 38, 30 ], [ 30, 36 ], [ 40, 22 ] ])
        {
            star(c, p[0], p[1], 1.8, '#ffffff');
        }
    }),

    france: c => disc(c, () => vbands(c, [ '#002395', '#ffffff', '#ed2939' ])),
    italy:  c => disc(c, () => vbands(c, [ '#008c45', '#f4f5f0', '#cd212a' ])),
    nigeria: c => disc(c, () => vbands(c, [ '#008751', '#ffffff', '#008751' ])),
    germany: c => disc(c, () => hbands(c, [ '#000000', '#dd0000', '#ffce00' ])),

    spain: c => disc(c, () =>
    {
        hbands(c, [ '#aa151b', '#f1bf00', '#aa151b' ], [ 1, 2, 1 ]);

        //  The arms, reduced to the shield-and-crown silhouette that survives
        //  being drawn a dozen pixels tall.
        poly(c, [ [ 16, 25 ], [ 28, 25 ], [ 28, 36 ], [ 22, 41 ], [ 16, 36 ] ], '#c8102e');
        c.fillStyle = '#f1bf00';
        c.fillRect(21, 25, 2, 16);
        c.fillRect(16, 31, 12, 2);
        poly(c, [ [ 16, 24 ], [ 19, 20 ], [ 22, 24 ], [ 25, 20 ], [ 28, 24 ] ], '#e8c33a');
    }),

    mexico: c => disc(c, () =>
    {
        vbands(c, [ '#006847', '#ffffff', '#ce1126' ]);

        //  The eagle on the cactus is a lost cause twenty pixels wide, so the
        //  emblem is drawn the way a small flag actually reads it: a dark
        //  device inside a laurel.
        c.strokeStyle = '#2f6b34';
        c.lineWidth = 2.2;
        c.beginPath();
        c.arc(C, C + 2, 9, Math.PI * 0.15, Math.PI * 0.85);
        c.stroke();

        poly(c, [ [ 25, C - 3 ], [ C, C - 6 ], [ 39, C - 3 ], [ C, C + 5 ] ], '#6b4a2a');
        circle(c, C, C - 4, 2.6, '#6b4a2a');
        line(c, C, C + 4, C, C + 9, '#2f6b34', 2);
    }),

    canada: c => disc(c, () =>
    {
        vbands(c, [ '#d80621', '#ffffff', '#d80621' ], [ 1, 2, 1 ]);

        //  The maple leaf, kept at its eleven points but with every notch cut
        //  wide -- the real proportions close up to mush at this size.
        poly(c, [
            [ 32, 9 ], [ 35, 21 ], [ 44, 18 ], [ 42, 27 ],
            [ 52, 25 ], [ 50, 31 ], [ 59, 34 ], [ 50, 39 ],
            [ 52, 44 ], [ 42, 42 ], [ 43, 48 ], [ 35, 45 ],
            [ 34, 57 ], [ 30, 57 ], [ 29, 45 ], [ 21, 48 ],
            [ 22, 42 ], [ 12, 44 ], [ 14, 39 ], [ 5, 34 ],
            [ 14, 31 ], [ 12, 25 ], [ 22, 27 ], [ 20, 18 ],
            [ 29, 21 ]
        ], '#d80621');
    }),

    india: c => disc(c, () =>
    {
        hbands(c, [ '#ff9933', '#ffffff', '#138808' ]);

        c.strokeStyle = '#000080';
        c.lineWidth = 1.6;
        c.beginPath();
        c.arc(C, C, 8, 0, TAU);
        c.stroke();

        for (let i = 0; i < 12; i++)
        {
            const a = (i / 12) * TAU;
            line(c, C + Math.cos(a) * 2, C + Math.sin(a) * 2,
                C + Math.cos(a) * 8, C + Math.sin(a) * 8, '#000080', 1);
        }

        circle(c, C, C, 2, '#000080');
    }),

    argentina: c => disc(c, () =>
    {
        hbands(c, [ '#75aadb', '#ffffff', '#75aadb' ]);
        circle(c, C, C, 7, '#f6b40e');

        for (let i = 0; i < 12; i++)
        {
            const a = (i / 12) * TAU;
            line(c, C + Math.cos(a) * 7, C + Math.sin(a) * 7,
                C + Math.cos(a) * 10.5, C + Math.sin(a) * 10.5, '#f6b40e', 1.6);
        }

        circle(c, C, C, 4.5, '#e8a90c');
    }),

    southKorea: c => disc(c, () =>
    {
        fill(c, '#ffffff');

        //  The taegeuk: two interlocking commas, drawn as one disc split by
        //  two half-circles.
        c.save();
        c.translate(C, C);
        c.rotate(-Math.PI / 4);

        c.fillStyle = '#cd2e3a';
        c.beginPath();
        c.arc(0, 0, 15, 0, Math.PI);
        c.fill();

        c.fillStyle = '#0047a0';
        c.beginPath();
        c.arc(0, 0, 15, Math.PI, TAU);
        c.fill();

        circle(c, -7.5, 0, 7.5, '#cd2e3a');
        circle(c, 7.5, 0, 7.5, '#0047a0');
        c.restore();

        //  One trigram in each corner, abbreviated to three bars.
        const bars = [ [ 10, 10, -0.8 ], [ 54, 10, 0.8 ], [ 10, 54, 0.8 ], [ 54, 54, -0.8 ] ];

        for (const b of bars)
        {
            c.save();
            c.translate(b[0], b[1]);
            c.rotate(b[2]);
            c.fillStyle = '#0d0d0d';
            for (let i = 0; i < 3; i++) c.fillRect(-6, -4 + i * 3.5, 12, 2);
            c.restore();
        }
    })
};

const ART: Record<string, Draw> = { ...FACES, ...FLAGS };

/** Texture key for a decal name. */
export function sa (name: string): string
{
    return 'sa:' + name;
}

/** True when this name is one the wardrobe can actually draw. */
export function hasArt (name: string): boolean
{
    return !!ART[name];
}

/** Bakes every decal into a texture. Called once, from Boot. */
export function registerSkinArt (textures: Textures.TextureManager): void
{
    const scale = RES / GRID;

    for (const name in ART)
    {
        const key = sa(name);
        if (textures.exists(key)) continue;

        const canvas = document.createElement('canvas');
        canvas.width = RES;
        canvas.height = RES;

        const c = canvas.getContext('2d')!;
        c.scale(scale, scale);
        ART[name](c);

        textures.addCanvas(key, canvas);
    }
}
