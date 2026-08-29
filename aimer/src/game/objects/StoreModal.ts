import { GameObjects, Geom, Scene } from 'phaser';
import { Sfx, unlockAudio } from '../core/audio';
import { rewardButton } from '../core/adButton';
import { adsAvailable } from '../core/ads';
import { IconLabel, iconImage } from '../core/icons';
import { Fx } from '../core/fx';
import { PrizeLook, prizeFace } from './PrizeTile';
import { TargetSkin } from '../data/skins';
import { meta } from '../core/state';
import { CX, CY, FONT, FONT_UI, H, W, fmt, hex, mix } from '../core/theme';

/**
 * The two things the store stops the player for.
 *
 * A shelf is a wall of prices, and a price the player cannot pay is the end of
 * the conversation -- the row shakes, and that is all the game ever says about
 * it. Both of these turn one of those dead ends into a screen:
 *
 *   the offer  -- tapping something you cannot afford is the clearest possible
 *                 statement of what you want. It is the only moment a video is
 *                 worth putting in front of somebody, so that is where it is.
 *   the unlock -- a skin bought and then still sitting in a grid of thirty
 *                 others is a purchase the player never sees. The screen goes
 *                 dark, the face fills it, and the only bright thing on it is
 *                 a button that takes them into a run wearing it.
 *
 * Both are modal on purpose: the scrim swallows every tap, so nothing behind
 * can be bought by accident while one of these is up.
 */

const SCRIM_DEPTH = 44;
const CARD_DEPTH = 45;

const INK = '#06101f';

export interface Shell
{
    card: GameObjects.Container;
    close: (then?: () => void) => void;
}

/** The framed plate a modal can sit on. Omitted by one that is its own shape. */
export interface Plate
{
    w: number;
    h: number;
    accent: number;
}

/**
 * Scrim, centred plate, and the way out. The caller fills the card in local
 * coordinates measured from its middle.
 *
 * `tapOut` lets the scrim itself close the card. It is off by default and has
 * to stay off for anything that asks the player a question -- a card offering
 * a video must not be dismissed by the thumb that was aiming at it. A card
 * that only tells them something is a different case: there, a tap anywhere is
 * what everybody already expects to work.
 */
export function shell (scene: Scene, plate: Plate | null, dark = 0.86, tapOut = false): Shell
{
    const scrim = scene.add.graphics().setDepth(SCRIM_DEPTH);
    scrim.fillStyle(0x03050f, dark);
    scrim.fillRect(0, 0, W, H);
    scrim.setAlpha(0);

    //  Nothing behind this is reachable while it is up. A store row half under
    //  a modal is a row that can still be bought by a thumb aiming at a button.
    scrim.setInteractive(new Geom.Rectangle(0, 0, W, H), Geom.Rectangle.Contains);

    //  A plated modal is a card in the middle of the screen and lays itself
    //  out from its own centre; a plateless one *is* the screen, so it keeps
    //  screen coordinates and sits at the origin.
    const card = scene.add.container(plate ? CX : 0, plate ? CY : 0).setDepth(CARD_DEPTH);

    scene.tweens.add({ targets: scrim, alpha: 1, duration: 170, ease: 'Quad.out' });

    if (plate)
    {
        const g = scene.add.graphics();
        g.fillStyle(0x0b1024, 0.98);
        g.fillRoundedRect(-plate.w / 2, -plate.h / 2, plate.w, plate.h, 26);
        g.fillStyle(plate.accent, 0.09);
        g.fillRoundedRect(-plate.w / 2, -plate.h / 2, plate.w, plate.h, 26);
        g.lineStyle(2, plate.accent, 0.85);
        g.strokeRoundedRect(-plate.w / 2, -plate.h / 2, plate.w, plate.h, 26);
        card.add(g);

        card.setScale(0.86).setAlpha(0);

        scene.tweens.add({ targets: card, alpha: 1, duration: 170 });
        scene.tweens.add({ targets: card, scale: 1, duration: 300, ease: 'Back.out' });
    }

    let closed = false;

    const close = (then?: () => void): void =>
    {
        if (closed) return;

        closed = true;
        scrim.disableInteractive();

        scene.tweens.add({ targets: scrim, alpha: 0, duration: 160, ease: 'Quad.in' });

        //  A plated card shrinks away from its own middle. A plateless one is
        //  anchored at the origin, where a scale tween would drag the whole
        //  composition into the top-left corner -- so it only fades.
        scene.tweens.add({
            targets: card, alpha: 0, scale: plate ? 0.9 : 1, duration: 160, ease: 'Quad.in',
            onComplete: () =>
            {
                card.destroy();
                scrim.destroy();
                if (then) then();
            }
        });
    };

    if (tapOut) scrim.on('pointerdown', () => close());

    return { card, close };
}

/** A solid pill with a label on it, laid into a card's local space. */
export function pill (
    scene: Scene, card: GameObjects.Container,
    y: number, w: number, h: number, label: string, color: number, size: number,
    onTap: () => void, ink = INK
): GameObjects.Container
{
    const btn = scene.add.container(0, y);

    const g = scene.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 22);
    g.fillStyle(0xffffff, 0.18);
    g.fillRoundedRect(-w / 2, -h / 2, w, h * 0.42, { tl: 22, tr: 22, bl: 0, br: 0 });
    btn.add(g);

    btn.add(scene.add.text(0, 0, label, {
        fontFamily: FONT, fontSize: size, color: ink
    }).setOrigin(0.5));

    btn.setSize(w, h);
    btn.setInteractive({
        hitArea: new Geom.Rectangle(0, 0, w, h),
        hitAreaCallback: Geom.Rectangle.Contains,
        useHandCursor: true
    });

    btn.on('pointerdown', () =>
    {
        unlockAudio();
        Sfx.ui();
        scene.tweens.add({ targets: btn, scale: 0.93, duration: 80, yoyo: true, onComplete: onTap });
    });

    card.add(btn);

    return btn;
}

/** The quiet way out of a modal: a word, not a button. */
export function dismiss (
    scene: Scene, card: GameObjects.Container, y: number, label: string, onTap: () => void
): GameObjects.Text
{
    const text = scene.add.text(0, y, label, {
        fontFamily: FONT_UI, fontSize: 15, color: '#7d88b0'
    }).setOrigin(0.5);

    text.setInteractive({ useHandCursor: true });
    text.on('pointerover', () => text.setColor('#c8d2f0'));
    text.on('pointerout', () => text.setColor('#7d88b0'));
    text.on('pointerdown', () =>
    {
        unlockAudio();
        Sfx.ui();
        onTap();
    });

    card.add(text);

    return text;
}

//  --------------------------------------------------------------- the offer

export interface UnlockOffer
{
    /** What the player just tried to buy. */
    name: string;
    blurb: string;
    /** Its price, so the card can say how far off they are. */
    cost: number;
    /** The colour the thing is sold in. */
    color: number;
    look: PrizeLook;
    /** What the video buys, in the player's words: 'UNLOCK FREE'. */
    action: string;
    /** Paid out once the break is over, whether or not Poki confirmed it. */
    onUnlock: () => void;
    /**
     * The other way in: go and earn the coins. Starts a run. Without it the
     * card can only offer the video, and a build with no ads has no card.
     */
    onPlay?: () => void;
}

/** Gold is what every rewarded video in the game is painted; cyan is PLAY. */
const AD_GOLD = 0xffc857;
const PLAY_CYAN = 0x3fe0ff;

/** How far the spokes behind the face reach, measured from the stage centre. */
const STAGE_RAY = 104;

/**
 * The lit stage the locked thing stands on: a pool of its own colour, a slow
 * wheel of spokes, and the face itself. The same light the unlock screen
 * throws, at card scale -- so the card promises exactly what the unlock pays.
 */
function stage (scene: Scene, card: GameObjects.Container, y: number, w: number, h: number, look: PrizeLook, size: number)
{
    const root = scene.add.container(0, y);
    card.add(root);

    const pool = scene.add.graphics();
    pool.fillStyle(look.color, 0.12);
    pool.fillRoundedRect(-w / 2, -h / 2, w, h, { tl: 24, tr: 24, bl: 0, br: 0 });
    root.add(pool);

    //  A wheel of spokes behind the face, kept to a disc that fits inside
    //  the stage so the light stays on the plate rather than spilling down
    //  over the buttons -- the same sunburst the unlock screen throws, as a
    //  medallion.
    const spokes = scene.add.graphics();
    spokes.fillStyle(look.color, 0.16);

    const count = 14;
    for (let i = 0; i < count; i++)
    {
        const a = (i / count) * Math.PI * 2;
        const half = (Math.PI / count) * 0.42;

        spokes.beginPath();
        spokes.moveTo(0, 0);
        spokes.lineTo(Math.cos(a - half) * STAGE_RAY, Math.sin(a - half) * STAGE_RAY);
        spokes.lineTo(Math.cos(a + half) * STAGE_RAY, Math.sin(a + half) * STAGE_RAY);
        spokes.closePath();
        spokes.fillPath();
    }
    root.add(spokes);

    scene.tweens.add({ targets: spokes, rotation: Math.PI * 2, duration: 30000, repeat: -1 });

    //  The glow: three soft discs, brightest at the face.
    const glow = scene.add.graphics();
    glow.fillStyle(look.color, 0.10);
    glow.fillCircle(0, 0, size * 0.92);
    glow.fillStyle(look.color, 0.16);
    glow.fillCircle(0, 0, size * 0.70);
    glow.fillStyle(mix(look.color, 0xffffff, 0.5), 0.22);
    glow.fillCircle(0, 0, size * 0.50);
    root.add(glow);

    scene.tweens.add({ targets: glow, scale: 1.08, alpha: 0.8, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    const face = prizeFace(scene, look, size);
    root.add(face);

    //  A slow hover, so the thing on the stage reads as alive rather than
    //  as a picture of it.
    scene.tweens.add({ targets: face, y: -5, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    //  The tag: a small lock in the corner, so the state is read before the
    //  name is.
    const tag = scene.add.container(-w / 2 + 16, -h / 2 + 16);
    const tagBg = scene.add.graphics();
    tagBg.fillStyle(0x06101f, 0.85);
    tagBg.fillRoundedRect(0, 0, 88, 26, 13);
    tagBg.lineStyle(1, look.color, 0.6);
    tagBg.strokeRoundedRect(0, 0, 88, 26, 13);
    tag.add(tagBg);
    tag.add(new IconLabel(scene, 44, 13, 'lock', 'LOCKED', {
        fontSize: 12, iconSize: 12, gap: 5, color: hex(look.color), iconColor: look.color
    }));
    root.add(tag);

    return root;
}

/**
 * A pill with a glyph, a word, and a smaller word under it -- the shape the
 * rewarded-video button has, so the two choices on the card are twins.
 */
function actionPill (
    scene: Scene, x: number, y: number, w: number, h: number,
    icon: string, label: string, note: string, color: number, fontSize: number,
    onTap: () => void
): GameObjects.Container
{
    const btn = scene.add.container(x, y);

    const g = scene.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    btn.add(g);

    const iconSize = 24;
    const gap = 9;
    const glyph = iconImage(scene, 0, 0, icon, { size: iconSize, color: 0x0b1024 });
    const text = scene.add.text(0, -7, label, { fontFamily: FONT, fontSize, color: INK }).setOrigin(0, 0.5);
    const sub = scene.add.text(0, 16, note, { fontFamily: FONT_UI, fontSize: 10, color: INK }).setOrigin(0, 0.5).setAlpha(0.55);

    //  A label that would run past the pill shrinks to fit it, so a long
    //  skin name or a wide font never pokes out of the rounded end.
    const room = w - 28 - iconSize - gap;
    if (text.width > room) text.setFontSize(Math.max(12, fontSize * room / text.width));

    const block = iconSize + gap + Math.max(text.width, sub.width);
    const left = -block / 2;
    glyph.setX(left + iconSize / 2);
    text.setX(left + iconSize + gap);
    sub.setX(left + iconSize + gap);

    btn.add([ glyph, text, sub ]);

    btn.setSize(w, h);
    btn.setInteractive({
        hitArea: new Geom.Rectangle(0, 0, w, h),
        hitAreaCallback: Geom.Rectangle.Contains,
        useHandCursor: true
    });

    scene.tweens.add({ targets: btn, scale: 1.03, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    btn.on('pointerdown', () =>
    {
        unlockAudio();
        Sfx.ui();
        scene.tweens.add({ targets: btn, scale: 0.93, duration: 80, yoyo: true, onComplete: onTap });
    });

    return btn;
}

const OFFER_H = 520;
const STAGE_H = 224;

/**
 * "You cannot afford this yet -- watch a video for it, or go and earn it?"
 *
 * Only ever raised by the player's own tap on the thing itself, which is what
 * makes it an offer rather than an interruption. The two ways in sit side by
 * side as equals, and neither is the default. Returns false only when there
 * is nothing to offer at all -- no ads and no run to start -- so the caller
 * can fall back to the plain refusal it always had.
 */
export function offerUnlock (scene: Scene, offer: UnlockOffer): boolean
{
    const ads = adsAvailable();

    //  Checked before anything is built, so a build with neither path never
    //  flashes a card on its way to the refusal it was always going to show.
    if (!ads && !offer.onPlay) return false;

    const w = Math.min(430, W - 56);
    const h = OFFER_H;
    const top = -h / 2;

    //  A tap anywhere off the card is the same answer as NOT NOW. The two
    //  buttons are well inside the plate, so a thumb aiming at either cannot
    //  land on the scrim by accident.
    const { card, close } = shell(scene, { w, h, accent: offer.color }, 0.86, true);

    //  The stage is drawn inside the plate's own rounding, one pixel in, so
    //  the plate's stroke stays the outer edge.
    stage(scene, card, top + STAGE_H / 2 + 1, w - 2, STAGE_H - 1, offer.look, 140);

    //  A hairline where the stage ends, so the words start on their own ground.
    const rule = scene.add.graphics();
    rule.fillStyle(offer.color, 0.35);
    rule.fillRect(-w / 2 + 1, top + STAGE_H, w - 2, 2);
    card.add(rule);

    card.add(scene.add.text(0, top + STAGE_H + 34, offer.name, {
        fontFamily: FONT, fontSize: 30, color: hex(offer.color), align: 'center',
        wordWrap: { width: w - 40 }
    }).setOrigin(0.5));

    card.add(scene.add.text(0, top + STAGE_H + 66, offer.blurb, {
        fontFamily: FONT_UI, fontSize: 13, color: '#8d97bd', align: 'center',
        wordWrap: { width: w - 48 }
    }).setOrigin(0.5));

    //  The price, and how far off it is. The coin path is still the real one,
    //  so the card says so in numbers rather than pretending the video is the
    //  only way in.
    const short = Math.max(0, offer.cost - meta.coins);

    const price = new IconLabel(scene, 0, top + STAGE_H + 108, 'gem', fmt(offer.cost), {
        fontSize: 24, iconSize: 22, color: '#ffffff', iconColor: AD_GOLD
    });
    card.add(price);

    card.add(scene.add.text(0, top + STAGE_H + 134, `YOU HAVE ${fmt(meta.coins)}  ·  ${fmt(short)} TO GO`, {
        fontFamily: FONT_UI, fontSize: 12, color: '#7d88b0'
    }).setOrigin(0.5));

    //  The two ways in, side by side. With only one of them on this build it
    //  takes the whole row, so the card never shows a gap where a choice was.
    const rowY = top + STAGE_H + 200;
    const rowH = 80;
    const gap = 10;
    const both = ads && !!offer.onPlay;
    const pillW = both ? (w - 40 - gap) / 2 : w - 56;
    const leftX = both ? -(pillW + gap) / 2 : 0;
    const rightX = both ? (pillW + gap) / 2 : 0;

    if (ads)
    {
        const video = rewardButton(scene, both ? leftX : 0, rowY, {
            label: 'WATCH AD',
            color: AD_GOLD,
            width: pillW,
            height: rowH,
            fontSize: both ? 17 : 26,
            onReward: () => close(offer.onUnlock)
        });

        if (video) card.add(video);
    }

    if (offer.onPlay)
    {
        const play = offer.onPlay;

        card.add(actionPill(
            scene, both ? rightX : 0, rowY, pillW, rowH,
            'coins', 'PLAY TO EARN', 'COINS FROM RUNS', PLAY_CYAN, both ? 17 : 26,
            () => close(play)
        ));
    }

    dismiss(scene, card, h / 2 - 30, 'NOT NOW', () => close());

    Sfx.locked();

    return true;
}

//  -------------------------------------------------------------- the unlock

//  -------------------------------------------------------------- the unlock

/** Where the light comes from, and where the face lands, relative to centre. */
const FACE_DY = -170;
const FACE_SIZE = 220;

/** How long the screen spends winding up before the skin lands, in ms. */
const BUILD = 2000;

/** Long enough to leave the frame from the middle of it, on any viewport. */
const RAY_SPAN = Math.hypot(W, H);

/**
 * A wheel of tapered spokes, drawn once and then turned by whoever owns it.
 * Two of these at different counts and speeds is the whole sunburst.
 */
function rays (scene: Scene, x: number, y: number, count: number, color: number, alpha: number, spread: number)
{
    const g = scene.add.graphics().setPosition(x, y);

    g.fillStyle(color, alpha);

    for (let i = 0; i < count; i++)
    {
        const a = (i / count) * Math.PI * 2;
        const half = (Math.PI / count) * spread;

        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a - half) * RAY_SPAN, Math.sin(a - half) * RAY_SPAN);
        g.lineTo(Math.cos(a + half) * RAY_SPAN, Math.sin(a + half) * RAY_SPAN);
        g.closePath();
        g.fillPath();
    }

    return g;
}

/**
 * The congratulation.
 *
 * There is no card, because a skin bought to be looked at should not arrive
 * inside a box: the screen goes dark and the thing itself is the screen. Two
 * seconds of wind-up do the work a card would have done -- yellow spokes
 * spinning up out of a point of light, rings falling inwards, a rising tone --
 * and then it lands, all at once, and the only words on the screen are what it
 * is and the one thing worth doing about it.
 *
 * The wind-up is skippable by a tap. It plays on every skin the player ever
 * buys, and the tenth one does not deserve to be as slow as the first.
 */
export function skinUnlocked (scene: Scene, fx: Fx, skin: TargetSkin, onPlay: () => void): void
{
    const { card, close } = shell(scene, null, 0.9);

    const lightX = CX;
    const lightY = CY + FACE_DY;

    //  Two wheels, counter-turning, so the light reads as moving rather than
    //  as a pattern someone drew.
    const far = rays(scene, lightX, lightY, 18, 0xffd23f, 0.22, 0.44);
    const near = rays(scene, lightX, lightY, 11, 0xffc857, 0.36, 0.26);

    card.add([ far, near ]);
    far.setScale(0.12).setAlpha(0);
    near.setScale(0.12).setAlpha(0);

    //  The point everything is coming out of.
    const core = scene.add.circle(lightX, lightY, 26, 0xfff3c4, 0.9).setScale(0.2);
    card.add(core);

    const face = prizeFace(scene, { color: skin.accent, art: skin.art, shape: skin.shape }, FACE_SIZE);
    face.setPosition(lightX, lightY).setScale(0).setAngle(-40);
    card.add(face);

    const head = scene.add.text(CX, CY + 12, 'SKIN UNLOCKED', {
        fontFamily: FONT, fontSize: 42, color: '#ffd23f', stroke: '#000000', strokeThickness: 8
    }).setOrigin(0.5).setAlpha(0).setScale(0.6);
    card.add(head);

    const name = scene.add.text(CX, CY + 64, skin.name, {
        fontFamily: FONT, fontSize: 30, color: hex(skin.accent), stroke: '#000000', strokeThickness: 6,
        align: 'center', wordWrap: { width: W - 70 }
    }).setOrigin(0.5).setAlpha(0);
    card.add(name);

    //  --------------------------------------------------------- the wind-up

    Sfx.riser(BUILD / 1000);

    const climb = [
        scene.tweens.add({ targets: [ far, near ], scale: 1, duration: BUILD, ease: 'Quart.in' }),
        scene.tweens.add({ targets: far, alpha: 0.22, duration: BUILD * 0.55, ease: 'Quad.in' }),
        scene.tweens.add({ targets: near, alpha: 0.36, duration: BUILD * 0.55, ease: 'Quad.in' }),
        scene.tweens.add({ targets: far, rotation: 2.6, duration: BUILD, ease: 'Quad.in' }),
        scene.tweens.add({ targets: near, rotation: -3.4, duration: BUILD, ease: 'Quad.in' }),
        scene.tweens.add({ targets: core, scale: 2.4, duration: BUILD, ease: 'Quint.in' })
    ];

    //  Rings falling inwards rather than blowing outwards: everything on
    //  screen is being gathered into the point the skin comes out of.
    const gather = scene.time.addEvent({
        delay: 260,
        loop: true,
        callback: () =>
        {
            const ring = scene.add.circle(lightX, lightY, 190, 0xffd23f, 0).setDepth(CARD_DEPTH);
            ring.setStrokeStyle(4, 0xffd23f, 0.7);
            card.add(ring);

            scene.tweens.add({
                targets: ring, scale: 0.12, alpha: 0, duration: 620, ease: 'Quad.in',
                onComplete: () => ring.destroy()
            });
        }
    });

    let landed = false;

    const land = (): void =>
    {
        if (landed) return;

        landed = true;
        gather.remove();
        for (const t of climb) t.stop();

        far.setScale(1).setAlpha(0.22);
        near.setScale(1).setAlpha(0.36);

        Sfx.jackpot();
        scene.cameras.main.shake(240, 0.008);

        //  The flash is what the wind-up was for: one frame of white, and the
        //  skin is simply there on the other side of it.
        const flash = scene.add.rectangle(CX, CY, W, H, 0xffffff, 1).setDepth(CARD_DEPTH + 2).setAlpha(0);
        scene.tweens.add({
            targets: flash, alpha: 0.9, duration: 60, yoyo: true, hold: 40, ease: 'Quad.out',
            onComplete: () => { scene.tweens.add({ targets: flash, alpha: 0, duration: 260, onComplete: () => flash.destroy() }); }
        });

        scene.tweens.add({
            targets: core, scale: 7, alpha: 0, duration: 420, ease: 'Quad.out',
            onComplete: () => core.destroy()
        });

        //  The spokes take the hit too, so the whole screen kicks at once.
        scene.tweens.add({ targets: [ far, near ], scale: 1.22, duration: 150, yoyo: true, ease: 'Quad.out' });
        scene.tweens.add({ targets: far, alpha: 0.4, duration: 150, yoyo: true });
        scene.tweens.add({ targets: near, alpha: 0.6, duration: 150, yoyo: true });

        scene.tweens.add({ targets: face, scale: 1, angle: 0, duration: 620, ease: 'Back.out' });

        //  From here the wheels just turn, slowly and for ever.
        scene.tweens.add({ targets: far, rotation: far.rotation + Math.PI * 2, duration: 26000, repeat: -1 });
        scene.tweens.add({ targets: near, rotation: near.rotation - Math.PI * 2, duration: 18000, repeat: -1 });

        scene.time.delayedCall(700, () =>
        {
            if (!face.active) return;

            scene.tweens.add({
                targets: face, scale: 1.05, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut'
            });
        });

        for (let i = 0; i < 6; i++)
        {
            scene.time.delayedCall(i * 110, () =>
            {
                const x = CX - 170 + Math.random() * 340;

                fx.burst(x, lightY - 60 + Math.random() * 190, i % 2 === 0 ? skin.accent : 0xffd23f, 26, 'gold');
            });
        }

        fx.ring(lightX, lightY, 360, 0xffd23f, 6, 560);

        //  Words last, and only two of them, once there is something to name.
        scene.tweens.add({ targets: head, alpha: 1, scale: 1, duration: 320, delay: 160, ease: 'Back.out' });
        scene.tweens.add({ targets: name, alpha: 1, duration: 260, delay: 300 });

        scene.time.delayedCall(420, () =>
        {
            if (!card.active) return;

            const play = pill(scene, card, 0, 330, 92, 'TRY IT IN GAME', 0xffd23f, 33, () => close(onPlay));

            play.setPosition(CX, CY + 168).setScale(0.2);

            scene.tweens.add({
                targets: play, scale: 1, duration: 380, ease: 'Back.out',
                onComplete: () =>
                {
                    scene.tweens.add({
                        targets: play, scale: 1.04, duration: 780, yoyo: true, repeat: -1, ease: 'Sine.inOut'
                    });
                }
            });

            const out = dismiss(scene, card, CY + 258, 'KEEP SHOPPING', () => close());

            out.setX(CX).setAlpha(0);
            scene.tweens.add({ targets: out, alpha: 1, duration: 260, delay: 220 });
        });
    };

    //  Tapping anywhere cuts the wind-up short. The scrim is the only thing on
    //  screen that can be hit, and it is already swallowing everything.
    scene.input.once('pointerdown', () =>
    {
        unlockAudio();
        land();
    });

    scene.time.delayedCall(BUILD, land);
}
