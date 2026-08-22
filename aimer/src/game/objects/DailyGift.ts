import { GameObjects, Geom, Scene, Tweens } from 'phaser';
import { Sfx, unlockAudio } from '../core/audio';
import { Fx } from '../core/fx';
import { Gift, RARITY, grantGift } from '../data/gifts';
import { rollDaily } from '../data/daily';
import { claimDaily, dailyReady, dailyStreak, msToNextDaily } from '../core/state';
import { iconImage } from '../core/icons';
import { prizeFace } from './PrizeTile';
import { pill, shell } from './StoreModal';
import { FONT, FONT_UI, W, hex } from '../core/theme';

/**
 * The daily present, and the button it lives behind.
 *
 * Everything else on the menu is a thing the player has to earn on the way in.
 * This one is already theirs before they press anything, which is why it is
 * the loudest object on the screen: a gold tile with the box breaking out of
 * its own corner and light coming out from behind it. A reward that looks like
 * a button gets pressed once; a reward that looks like it is *already going
 * off* gets pressed the moment the menu loads.
 *
 * Once it is claimed the tile does not disappear -- it goes dark and starts
 * counting down to midnight, because the hole where a reward used to be is the
 * thing that brings somebody back tomorrow.
 */

const GOLD = 0xffc857;
const GOLD_LIT = 0xffe9a8;
const GOLD_DEEP = 0x8a4b00;
const DARK = 0x141a33;

const RAY_COUNT = 5;
/** Where the fan points (screen radians: up-right) and how wide it opens. */
const RAY_AIM = -Math.PI / 4;
const RAY_SPAN = Math.PI * 0.42;
/** How many bands a ray is drawn in; each one is dimmer than the last. */
const RAY_BANDS = 7;

type Pt = { x: number; y: number };

/** Sutherland-Hodgman against one half-plane a*x + b*y <= c. */
function clipHalf (poly: Pt[], a: number, b: number, c: number): Pt[]
{
    const out: Pt[] = [];

    for (let i = 0; i < poly.length; i++)
    {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const dp = a * p.x + b * p.y - c;
        const dq = a * q.x + b * q.y - c;

        if (dp <= 0) out.push(p);

        if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0))
        {
            const t = dp / (dp - dq);
            out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        }
    }

    return out;
}

/**
 * The light inside the tile: a few tapered spokes rooted just inside the
 * bottom-left corner and pointing up and to the right, drawn over the gold
 * plate and under the box, fading out along their length.
 *
 * They are cut to the plate's outline in geometry rather than with a mask --
 * each band is clipped against the square and the four corner chamfers
 * before it is drawn -- so nothing can ever leak past the tile's edge.
 */
function strobes (scene: Scene, size: number, radius: number): GameObjects.Graphics
{
    const g = scene.add.graphics();
    const half = size / 2;
    const ox = -half + 8;
    const oy = half - 8;
    const len = size * 1.25;

    //  The outline as half-planes: four edges, then a chamfer across each
    //  corner at the rounded rect's tangent, so the spokes stop where the
    //  curve starts.
    const chamfer = size - radius * (2 - Math.SQRT2);
    const planes: [number, number, number][] = [
        [ 1, 0, half ], [ -1, 0, half ], [ 0, 1, half ], [ 0, -1, half ],
        [ 1, 1, chamfer ], [ 1, -1, chamfer ], [ -1, 1, chamfer ], [ -1, -1, chamfer ]
    ];

    const clipAll = (poly: Pt[]): Pt[] =>
    {
        let out = poly;
        for (const [ a, b, c ] of planes) if (out.length) out = clipHalf(out, a, b, c);
        return out;
    };

    for (let i = 0; i < RAY_COUNT; i++)
    {
        const a = RAY_AIM - RAY_SPAN / 2 + (i / (RAY_COUNT - 1)) * RAY_SPAN;
        const w = (RAY_SPAN / RAY_COUNT / 2) * 0.55;
        const ca = Math.cos(a - w), sa = Math.sin(a - w);
        const cb = Math.cos(a + w), sb = Math.sin(a + w);

        for (let b = 0; b < RAY_BANDS; b++)
        {
            const t0 = (b / RAY_BANDS) * len;
            const t1 = ((b + 1) / RAY_BANDS) * len;
            //  Bright at the root, gone by the far end.
            const alpha = 0.34 * (1 - b / RAY_BANDS) ** 1.6;

            const quad = clipAll([
                { x: ox + ca * t0, y: oy + sa * t0 },
                { x: ox + ca * t1, y: oy + sa * t1 },
                { x: ox + cb * t1, y: oy + sb * t1 },
                { x: ox + cb * t0, y: oy + sb * t0 }
            ]);

            if (quad.length < 3) continue;

            g.fillStyle(0xffffff, alpha);
            g.beginPath();
            g.moveTo(quad[0].x, quad[0].y);
            for (let k = 1; k < quad.length; k++) g.lineTo(quad[k].x, quad[k].y);
            g.closePath();
            g.fillPath();
        }
    }

    return g;
}

/** The countdown under a spent tile, in the coarsest unit that still reads. */
function waitLabel (ms: number): string
{
    const mins = Math.max(1, Math.ceil(ms / 60000));

    if (mins >= 60) return `${Math.ceil(mins / 60)}H`;

    return `${mins}M`;
}

export interface DailyButton
{
    container: GameObjects.Container;
    /** Redraws for whatever state the save is in now. */
    refresh: () => void;
}

/**
 * The tile itself. `size` is the side of the square; the box and the light
 * both hang outside it on purpose, so the caller has to leave room.
 */
export function buildDailyButton (scene: Scene, fx: Fx, x: number, y: number, size = 76): DailyButton
{
    const half = size / 2;
    const btn = scene.add.container(x, y).setDepth(13);

    const plate = scene.add.graphics();
    btn.add(plate);

    //  The light goes on top of the plate and under everything else.
    const light = strobes(scene, size, 18);
    btn.add(light);

    const label = scene.add.text(0, half - 15, '', {
        fontFamily: FONT, fontSize: 15, color: '#06101f'
    }).setOrigin(0.5);
    btn.add(label);

    //  The box sits on the tile's centre line and breaks the top edge. Its
    //  shadow is a second copy behind it, because a white glyph on gold has
    //  nothing to sit against otherwise.
    const shade = iconImage(scene, 11, -half + 19, 'gift', { size: 60, color: GOLD_DEEP, alpha: 0.45 });
    const box = iconImage(scene, 8, -half + 16, 'gift', { size: 60, color: 0xffffff });

    shade.setAngle(-10);
    box.setAngle(-10);
    btn.add([ shade, box ]);

    btn.setSize(size, size);
    btn.setInteractive({
        hitArea: new Geom.Rectangle(0, 0, size, size),
        hitAreaCallback: Geom.Rectangle.Contains,
        useHandCursor: true
    });

    const spin: Tweens.Tween[] = [];

    const stopSpin = (): void =>
    {
        for (const t of spin) t.stop();
        spin.length = 0;
    };

    const refresh = (): void =>
    {
        const ready = dailyReady();

        stopSpin();
        plate.clear();

        if (ready)
        {
            plate.fillStyle(GOLD, 1);
            plate.fillRoundedRect(-half, -half, size, size, 18);
            plate.fillStyle(0xffffff, 0.2);
            plate.fillRoundedRect(-half, -half, size, size * 0.42, { tl: 18, tr: 18, bl: 0, br: 0 });
            plate.lineStyle(3, GOLD_LIT, 0.9);
            plate.strokeRoundedRect(-half, -half, size, size, 18);
        }
        else
        {
            plate.fillStyle(DARK, 0.94);
            plate.fillRoundedRect(-half, -half, size, size, 18);
            plate.lineStyle(2, GOLD, 0.3);
            plate.strokeRoundedRect(-half, -half, size, size, 18);
        }

        label.setText(ready ? 'DAILY' : waitLabel(msToNextDaily()));
        label.setColor(ready ? '#06101f' : '#5f6a92');
        label.setFontSize(ready ? 15 : 14);

        box.setTint(ready ? 0xffffff : 0x5f6a92).setAlpha(ready ? 1 : 0.5);
        shade.setVisible(ready);

        light.setVisible(ready);
        light.setAlpha(ready ? 0.9 : 0);
        btn.setScale(1);
        btn.setAngle(0);

        if (!ready) return;

        //  Three tweens make the strobe: the fan sweeps a few degrees either
        //  way, its brightness stutters, and the whole tile breathes so the
        //  corner of the screen is never still.
        //  The rays are cut to the tile in geometry, so sweeping them would
        //  re-cut every frame; they only flicker.
        spin.push(scene.tweens.add({ targets: light, alpha: 0.45, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.inOut' }));
        spin.push(scene.tweens.add({ targets: btn, scale: 1.06, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' }));
        spin.push(scene.tweens.add({ targets: [ box, shade ], angle: 4, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.inOut' }));
    };

    refresh();

    //  The countdown only ever moves a whole minute at a time, so it is redrawn
    //  on a slow timer rather than every frame -- and the same timer is what
    //  lights the tile back up if the player sits on the menu past midnight.
    const tick = scene.time.addEvent({
        delay: 20000,
        loop: true,
        callback: refresh
    });

    btn.once('destroy', () => tick.remove());

    btn.on('pointerdown', () =>
    {
        unlockAudio();

        if (!dailyReady())
        {
            Sfx.dry();
            fx.popup(btn.x, btn.y + 54, `BACK IN ${waitLabel(msToNextDaily())}`, GOLD, 15, 26, 800);
            return;
        }

        const streak = claimDaily();
        const prize = grantGift(rollDaily(streak));

        Sfx.upgrade();
        fx.ring(btn.x, btn.y, 190, GOLD, 5, 460);
        scene.tweens.add({ targets: btn, scale: 0.9, duration: 90, yoyo: true });

        refresh();

        openDailyGift(scene, fx, prize, streak);
    });

    return { container: btn, refresh };
}

//  ------------------------------------------------------------- the opening

/** How long the box shakes before it gives up what is inside it, in ms. */
const SHAKE = 780;

/**
 * The card the present opens into.
 *
 * The prize is already banked by the time this is on screen -- the card is a
 * receipt, not a decision -- so there is one button on it and it only says
 * COLLECT. What the card does have to do is hold the box shut for three
 * quarters of a second first, because the shake is the only part of a present
 * anybody actually remembers.
 */
export function openDailyGift (scene: Scene, fx: Fx, gift: Gift, streak = dailyStreak()): void
{
    const accent = RARITY[gift.rarity].color;
    const w = Math.min(400, W - 56);
    const h = 452;
    const top = -h / 2;

    const { card, close } = shell(scene, { w, h, accent }, 0.88);

    card.add(scene.add.text(0, top + 36, 'DAILY REWARD', {
        fontFamily: FONT, fontSize: 30, color: hex(GOLD)
    }).setOrigin(0.5));

    card.add(scene.add.text(0, top + 64, `DAY ${streak}${streak >= 7 ? '  ·  ON A ROLL' : ''}`, {
        fontFamily: FONT_UI, fontSize: 13, color: '#8d97bd'
    }).setOrigin(0.5));

    const stage = top + 176;

    const box = iconImage(scene, 0, stage, 'gift', { size: 132, color: GOLD });
    card.add(box);

    const face = prizeFace(scene, gift, 140);
    face.setPosition(0, stage).setScale(0).setAngle(-30);
    card.add(face);

    const name = scene.add.text(0, top + 278, gift.name, {
        fontFamily: FONT, fontSize: 28, color: hex(gift.color), align: 'center',
        wordWrap: { width: w - 48 }
    }).setOrigin(0.5).setAlpha(0);
    card.add(name);

    const sub = scene.add.text(0, top + 310, gift.sub, {
        fontFamily: FONT_UI, fontSize: 13, color: '#8d97bd', align: 'center',
        wordWrap: { width: w - 48 }
    }).setOrigin(0.5).setAlpha(0);
    card.add(sub);

    const rarity = scene.add.text(0, top + 336, RARITY[gift.rarity].label, {
        fontFamily: FONT, fontSize: 15, color: hex(accent)
    }).setOrigin(0.5).setAlpha(0);
    card.add(rarity);

    const shake = scene.tweens.add({
        targets: box, angle: 12, duration: 90, yoyo: true, repeat: -1, ease: 'Sine.inOut'
    });

    scene.tweens.add({ targets: box, scale: 1.12, duration: SHAKE, ease: 'Quad.in' });

    let opened = false;

    const open = (): void =>
    {
        if (opened || !card.active) return;

        opened = true;
        shake.stop();

        Sfx.jackpot();

        scene.tweens.add({
            targets: box, scale: 1.6, alpha: 0, duration: 240, ease: 'Quad.out',
            onComplete: () => box.destroy()
        });

        scene.tweens.add({ targets: face, scale: 1, angle: 0, duration: 560, ease: 'Back.out' });
        scene.tweens.add({ targets: [ name, sub, rarity ], alpha: 1, duration: 260, delay: 180 });

        fx.burst(card.x, card.y + stage, accent, 26, 'gold');
        fx.ring(card.x, card.y + stage, 220, GOLD, 5, 480);

        scene.time.delayedCall(320, () =>
        {
            if (!card.active) return;

            //  One way out, and it is the word for what already happened --
            //  the prize was banked before the card was ever built.
            const take = pill(scene, card, h / 2 - 62, w - 96, 68, 'COLLECT', GOLD, 27, () => close());

            take.setScale(0.3);
            scene.tweens.add({ targets: take, scale: 1, duration: 340, ease: 'Back.out' });
        });
    };

    //  A tap anywhere cuts the shake short. The box is opening either way.
    scene.input.once('pointerdown', open);
    scene.time.delayedCall(SHAKE, open);
}
