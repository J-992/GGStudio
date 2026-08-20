import { GameObjects, Geom, Scene } from 'phaser';
import { Sfx, unlockAudio } from './audio';
import { adsAvailable, watchRewarded } from './ads';
import { iconImage } from './icons';
import { FONT, FONT_UI } from './theme';

/**
 * The one button shape every rewarded video in the game uses.
 *
 * Poki is strict about rewarded ads, and the rules are the same ones that make
 * a rewarded ad worth having: the player has to choose it, has to know a video
 * is what they are choosing, and has to be no worse off for declining. So the
 * button says what it gives *and* shows a video icon, it never appears on its
 * own timer, and every failure path -- declined, no fill, ad blocker, SDK never
 * loaded -- lands the player exactly where they already were.
 *
 * Returns null when the build has no ads at all, so a caller can lay its screen
 * out around the absence instead of drawing a button that could never work.
 */

/** Dark ink for text sitting on a bright fill. */
const INK = '#0b1024';
const INK_HEX = 0x0b1024;

export interface RewardButtonOpts
{
    width?: number;
    height?: number;
    /** What the player gets, in their words: 'DOUBLE COINS'. */
    label: string;
    color: number;
    /** Icon texture name. Defaults to the plain video clip. */
    icon?: string;
    /**
     * Drop the 'WATCH A SHORT VIDEO' line and centre the label. For a button
     * whose icon already says video on its own.
     */
    compact?: boolean;
    /**
     * Offer the button again after a successful reward instead of settling on
     * CLAIMED. For rewards the player can sensibly take more than once -- a
     * reroll, but never an extra life.
     */
    repeat?: boolean;
    /** Runs only after a video the player actually watched through. */
    onReward: () => void;
}

export function rewardButton (
    scene: Scene,
    x: number,
    y: number,
    opts: RewardButtonOpts
): GameObjects.Container | null
{
    if (!adsAvailable()) return null;

    const w = opts.width ?? 340;
    const h = opts.height ?? 76;
    const compact = opts.compact === true;
    //  With no second line under it, the glyph has to carry more of the button,
    //  so it grows to sit level with the label rather than beside it.
    const iconSize = compact ? 34 : 28;

    const btn = scene.add.container(x, y).setDepth(12);

    const g = scene.add.graphics();
    btn.add(g);

    const icon = iconImage(scene, 0, 0, opts.icon ?? 'video', { size: iconSize, color: INK_HEX });
    btn.add(icon);

    const text = scene.add.text(0, compact ? 0 : -7, opts.label, {
        fontFamily: FONT, fontSize: 26, color: INK
    }).setOrigin(0, 0.5);
    btn.add(text);

    const note = scene.add.text(0, 17, 'WATCH A SHORT VIDEO', {
        fontFamily: FONT_UI, fontSize: 11, color: INK
    }).setOrigin(0, 0.5).setAlpha(0.55).setVisible(!compact);
    btn.add(note);

    //  The icon and the two lines are laid out as one block so the pair stays
    //  centred whatever the label says.
    const layout = (): void =>
    {
        const block = iconSize + 12 + (compact ? text.width : Math.max(text.width, note.width));
        const left = -block / 2;

        icon.setX(left + iconSize / 2);
        text.setX(left + iconSize + 12);
        note.setX(left + iconSize + 12);
    };

    /**
     * One solid pill, no outline. The fill carries the colour, which is what
     * makes the offer read as a thing to press rather than a framed notice.
     */
    const dress = (fill: number, ink: string, tint: number): void =>
    {
        g.clear();
        g.fillStyle(fill, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);

        icon.setTint(tint);
        text.setColor(ink);
        note.setColor(ink);
        layout();
    };

    dress(opts.color, INK, INK_HEX);

    //  A slow breathe rather than a pulsing edge: same "there is something here"
    //  signal the PLAY button uses, and it costs the design nothing.
    const pulse = scene.tweens.add({
        targets: btn, scale: 1.03, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut'
    });

    let spent = false;

    /** Back to the idle offer, for a reward the player may take again. */
    const rearm = (): void =>
    {
        spent = false;
        text.setText(opts.label);
        note.setVisible(!compact);
        dress(opts.color, INK, INK_HEX);
        pulse.restart();
        btn.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, w, h),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });
    };

    const settle = (message: string, fill: number, ink: string, tint: number): void =>
    {
        pulse.stop();
        btn.setScale(1);
        text.setText(message);
        note.setVisible(false);
        dress(fill, ink, tint);
    };

    btn.setSize(w, h);
    btn.setInteractive({
        hitArea: new Geom.Rectangle(0, 0, w, h),
        hitAreaCallback: Geom.Rectangle.Contains,
        useHandCursor: true
    });

    btn.on('pointerdown', () =>
    {
        if (spent) return;

        spent = true;
        unlockAudio();
        Sfx.ui();

        settle('LOADING…', 0x2a3352, '#8d97bd', 0x8d97bd);
        btn.disableInteractive();

        void watchRewarded().then((earned) =>
        {
            //  The ad outlives the screen it was started from if the player
            //  navigated away mid-video; the reward is theirs either way, but
            //  the button is not there to be updated.
            if (!btn.active || !scene.scene.isActive())
            {
                if (earned) opts.onReward();
                return;
            }

            if (!earned)
            {
                settle('NOT AVAILABLE', 0x2a3352, '#7d88b0', 0x7d88b0);
                return;
            }

            Sfx.golden();
            opts.onReward();

            //  Paying out can tear the screen down -- the extra life destroys
            //  the panel this button lives on -- so there may be nothing left
            //  to update by the time control comes back.
            if (!btn.active) return;

            if (opts.repeat) rearm();
            else settle('CLAIMED', 0x6cf5c8, INK, INK_HEX);
        });
    });

    return btn;
}
