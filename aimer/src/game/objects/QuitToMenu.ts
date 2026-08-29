import { GameObjects, Geom, Scene } from 'phaser';
import { Sfx, unlockAudio } from '../core/audio';
import { iconImage } from '../core/icons';
import { dismiss, pill, shell } from './StoreModal';
import { FONT, FONT_UI, W, hex } from '../core/theme';

/**
 * The way out of a level, and the question it asks first.
 *
 * Both playable modes are a full-screen tap target, so the way out cannot be a
 * button anywhere the player is shooting: it is a small plate parked in the one
 * band of each screen that is not part of the arena, it swallows its own tap so
 * the shot underneath never happens, and it never leaves on the first press.
 *
 * The card that comes up is modal on purpose -- the scene holds its clock while
 * it is open, so reading the question costs nothing, and cancelling puts the
 * player back exactly where they were.
 */

const BTN_W = 92;
const BTN_H = 32;

export interface QuitOpts
{
    /** The line under the question: what quitting costs, in this mode's words. */
    cost: string;
    /** False while the mode is in no state to be interrupted. */
    enabled?: () => boolean;
    /** Hold the clock, and start it again. Called around the card being open. */
    hold?: () => void;
    resume?: () => void;
    /** The player said yes. */
    quit: () => void;
}

/** The MENU plate, and the confirm card behind it. */
export function quitButton (scene: Scene, x: number, y: number, opts: QuitOpts): GameObjects.Container
{
    const btn = scene.add.container(x, y).setAlpha(0.6);

    const g = scene.add.graphics();
    g.fillStyle(0x0b1024, 0.85);
    g.fillRoundedRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, 11);
    g.lineStyle(2, 0x3d4a78, 0.8);
    g.strokeRoundedRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, 11);
    btn.add(g);

    const arrow = iconImage(scene, -BTN_W / 2 + 20, 0, 'chevrons', { size: 15, color: 0x8d97bd });
    arrow.setAngle(180);
    btn.add(arrow);

    btn.add(scene.add.text(-BTN_W / 2 + 34, 0, 'MENU', {
        fontFamily: FONT, fontSize: 14, color: '#c8d2f0'
    }).setOrigin(0, 0.5));

    btn.setSize(BTN_W, BTN_H);
    btn.setInteractive({
        hitArea: new Geom.Rectangle(0, 0, BTN_W, BTN_H),
        hitAreaCallback: Geom.Rectangle.Contains,
        useHandCursor: true
    });

    btn.on('pointerover', () => btn.setAlpha(1));
    btn.on('pointerout', () => btn.setAlpha(0.6));

    let open = false;

    btn.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: any) =>
    {
        //  The shot this tap would otherwise have fired never happens.
        if (e && e.stopPropagation) e.stopPropagation();

        unlockAudio();

        if (open) return;

        if (opts.enabled && !opts.enabled())
        {
            Sfx.dry();
            return;
        }

        open = true;
        Sfx.ui();
        opts.hold?.();
        confirm(scene, opts, () => { open = false; });
    });

    return btn;
}

/** The question itself. Staying is the button; leaving is the quiet line. */
function confirm (scene: Scene, opts: QuitOpts, done: () => void): void
{
    const w = Math.min(392, W - 48);
    const h = 268;
    const { card, close } = shell(scene, { w, h, accent: 0xff4a5c });

    card.add(scene.add.text(0, -84, 'QUIT TO MENU?', {
        fontFamily: FONT, fontSize: 30, color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5));

    card.add(scene.add.text(0, -26, opts.cost, {
        fontFamily: FONT_UI, fontSize: 16, color: hex(0x8d97bd),
        align: 'center', wordWrap: { width: w - 72 }
    }).setOrigin(0.5));

    pill(scene, card, 46, w - 72, 62, 'KEEP PLAYING', 0x6cf5c8, 24, () =>
    {
        close(() => { done(); opts.resume?.(); });
    });

    dismiss(scene, card, 108, 'QUIT TO MENU', () =>
    {
        close(() => { done(); opts.quit(); });
    });
}
