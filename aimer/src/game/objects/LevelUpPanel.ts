import { GameObjects, Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { Upgrade, rollOffers } from '../data/upgrades';
import { run } from '../core/state';
import { punchOf } from '../data/levels';
import { rankTitle } from '../data/rank';
import { iconImage } from '../core/icons';
import { rewardButton } from '../core/adButton';
import { CX, CY, FONT, FONT_UI, H, LANDSCAPE, MUZZLE, Tier, W, hex } from '../core/theme';
import { BuildStrip } from './BuildStrip';

/**
 * The rank-up hand, dealt over the arena rather than on a screen of its own.
 *
 * The run used to stop dead between every level, fade to a menu, deal three
 * cards on a table and fade back. This does the same job, in the same shape and
 * at the same size -- the spacing below is the old upgrade screen's, because it
 * was right -- without ever leaving the level. The clock freezes, the arena
 * dims, three cards deal in, one gets picked, and the level carries on
 * underneath from exactly where it stopped.
 *
 * What that buys: the reward lands where the player earned it, on the kill that
 * topped the bar out, instead of two screens later; and nothing is torn down
 * and rebuilt to show it.
 */

const L = LANDSCAPE
    ? {
        cardW: 380,
        cardH: 236,
        /** Stacked: icon over name over effect, all centred. */
        stacked: true,
        gap: 30,
        headerY: 54,
        titleY: 104,
        titleSize: 42,
        cardsY: 330,
        rerollY: 512,
        buildY: 626
    }
    : {
        cardW: 462,
        cardH: 168,
        stacked: false,
        gap: 26,
        headerY: 62,
        titleY: 108,
        titleSize: 38,
        cardsY: 258,
        rerollY: 788,
        buildY: 884
    };

/** Matches the rank bar in the play HUD -- same number, same colour. */
const RANK_COLOR = 0xb388ff;

const CARD_W = L.cardW;
const CARD_H = L.cardH;

export class LevelUpPanel
{
    private scene: Scene;
    private fx: Fx;
    private tier: Tier;
    private onDone: (picked: Upgrade) => void;

    private root: GameObjects.Container;
    private scrim: GameObjects.Graphics;
    private cards: GameObjects.Container[] = [];
    private loadout: BuildStrip | null = null;
    private taken = false;

    constructor (scene: Scene, tier: Tier, fx: Fx, offers: Upgrade[], onDone: (picked: Upgrade) => void)
    {
        this.scene = scene;
        this.fx = fx;
        this.tier = tier;
        this.onDone = onDone;

        //  Dim the arena, but never black it out: the level the player is
        //  standing in the middle of stays visible behind the cards, which is
        //  the whole difference between a pause and a scene change.
        this.scrim = scene.add.graphics().setDepth(44);
        this.scrim.fillStyle(0x03050f, 0.86);
        this.scrim.fillRect(0, 0, W, H);
        this.scrim.setAlpha(0);

        scene.tweens.add({ targets: this.scrim, alpha: 1, duration: 150 });

        this.root = scene.add.container(0, 0).setDepth(45);

        this.header();
        this.deal(offers, true);
        this.buildReroll();

        //  What the card being chosen is going to join. The old upgrade screen
        //  had this line along its bottom edge and it went missing with the
        //  screen; a hand of three offers is a much easier read when the eight
        //  parts already on the gun are sitting under it.
        this.loadout = new BuildStrip(scene, CX, L.buildY, {
            iconSize: 26,
            spacing: 44,
            maxWidth: W - 120,
            label: 'YOUR BUILD'
        });

        this.root.add(this.loadout.root);
    }

    destroy (): void
    {
        //  The cards and the scrim are all mid-tween when a pick lands, and a
        //  tween still pointing at a destroyed object is the classic way to
        //  take the whole scene down a frame later.
        this.scene.tweens.killTweensOf(this.scrim);

        for (const child of this.root.list) this.scene.tweens.killTweensOf(child);

        this.scrim.destroy();
        this.root.destroy();
        this.cards = [];
        this.loadout = null;
    }

    /** RANK N, the title that comes with it, and the instruction. */
    private header (): void
    {
        const s = this.scene;

        const rank = s.add.text(CX, L.headerY, `RANK ${run.rank}`, {
            fontFamily: FONT, fontSize: 22, color: hex(RANK_COLOR)
        }).setOrigin(0.5).setScale(0.5);

        this.root.add(rank);
        s.tweens.add({ targets: rank, scale: 1, duration: 240, ease: 'Back.out' });

        //  "Upgrades increase XP gained" is the load-bearing half of the loop,
        //  and until it is written down it is invisible: the parts do it, the
        //  ranks do it, and a streak does it hardest of all.
        //
        //  Punch is here for the same reason. It is the gun's real number --
        //  targets deleted per shot, 1.00 being a stock gun with nothing to
        //  spare -- and a player deciding whether to take POWER again deserves
        //  to see what the last one actually bought them.
        const stats = run.stats();
        const sub = s.add.text(
            CX, L.headerY + 22,
            `${rankTitle(run.rank)}   ·   PUNCH x${punchOf(stats.damage, run.level).toFixed(2)}   ·   XP GAIN x${stats.xpMult.toFixed(2)}`,
            { fontFamily: FONT_UI, fontSize: 13, color: '#8d97bd' }
        ).setOrigin(0.5).setAlpha(0);

        this.root.add(sub);
        s.tweens.add({ targets: sub, alpha: 1, duration: 260, delay: 120 });

        const title = s.add.text(CX, L.titleY, 'CHOOSE UPGRADE', {
            fontFamily: FONT, fontSize: L.titleSize,
            color: hex(this.tier.accent), stroke: '#000000', strokeThickness: 6
        }).setOrigin(0.5).setScale(0.5);

        this.root.add(title);
        s.tweens.add({ targets: title, scale: 1, duration: 240, ease: 'Back.out' });

        //  Another rank arrived in the same breath -- say so, because the
        //  player is about to be handed another hand and should know why.
        if (run.owed > 1)
        {
            const queue = s.add.text(CX, L.titleY + 30, `x${run.owed} PENDING`, {
                fontFamily: FONT, fontSize: 16, color: '#ffd23f'
            }).setOrigin(0.5);

            this.root.add(queue);
            s.tweens.add({ targets: queue, alpha: 0.4, duration: 460, yoyo: true, repeat: -1 });
        }
    }

    /** Deals a fresh set of three, replacing whatever is on the table. */
    private deal (offers: Upgrade[], first: boolean): void
    {
        for (const card of this.cards)
        {
            this.scene.tweens.killTweensOf(card);
            card.destroy();
        }

        this.cards = offers.map((up, i) =>
        {
            const home = LANDSCAPE
                ? { x: CX + (i - (offers.length - 1) / 2) * (CARD_W + L.gap), y: L.cardsY }
                : { x: CX, y: L.cardsY + i * (CARD_H + L.gap) };

            const card = this.build(up, home.x, home.y);

            //  Cards fly in from off screen: sideways in portrait, up from
            //  under the table in landscape, where sideways would have them
            //  crossing each other.
            if (LANDSCAPE) card.setY(home.y + 260);
            else card.setX(home.x + (i % 2 === 0 ? 620 : -620));

            card.setAlpha(0);

            this.scene.tweens.add({
                targets: card,
                x: home.x, y: home.y, alpha: 1,
                duration: 320,
                delay: (first ? 0 : 40) + i * 70,
                ease: 'Back.out'
            });

            return card;
        });
    }

    /**
     * Reroll, as often as the player is willing to watch for. The three cards
     * only change once a video has actually played, so declining leaves the
     * choice exactly as it was.
     */
    private buildReroll (): void
    {
        const btn = rewardButton(this.scene, CX, L.rerollY, {
            width: 214,
            height: 58,
            label: 'REROLL',
            icon: 'videoDice',
            compact: true,
            color: 0x9b6cff,
            repeat: true,
            onReward: () => this.reroll()
        });

        //  Null on a build with no ads at all -- then there is simply no button.
        if (btn) this.root.add(btn);
    }

    private reroll (): void
    {
        if (this.taken) return;

        this.scene.cameras.main.flash(140, 155, 108, 255);
        this.fx.ring(CX, CY, 260, 0x9b6cff, 6, 460);
        Sfx.upgrade();

        this.deal(rollOffers(run.taken, run.level, 3), false);
    }

    private build (up: Upgrade, x: number, y: number): GameObjects.Container
    {
        const s = this.scene;
        const owned = run.taken[up.id] || 0;
        const card = s.add.container(x, y);

        this.root.add(card);

        const g = s.add.graphics();
        g.fillStyle(0x0b1024, 0.94);
        g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
        g.lineStyle(4, up.color, 0.95);
        g.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
        g.fillStyle(up.color, 0.1);
        g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
        card.add(g);

        const art = L.stacked
            ? { x: 0, y: -CARD_H / 2 + 74, size: 66, glow: 62 }
            : { x: -CARD_W / 2 + 84, y: 0, size: 60, glow: 58 };

        const glow = s.add.circle(art.x, art.y, art.glow, up.color, 0.2);
        card.add(glow);

        s.tweens.add({ targets: glow, scale: 1.18, alpha: 0.32, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        card.add(iconImage(s, art.x, art.y, up.icon, { size: art.size, color: up.color }));

        card.add(s.add.text(
            L.stacked ? 0 : -CARD_W / 2 + 154,
            L.stacked ? CARD_H / 2 - 76 : -26,
            up.name,
            { fontFamily: FONT, fontSize: L.stacked ? 30 : 34, color: '#ffffff' }
        ).setOrigin(L.stacked ? 0.5 : 0, 0.5));

        card.add(s.add.text(
            L.stacked ? 0 : -CARD_W / 2 + 156,
            L.stacked ? CARD_H / 2 - 40 : 20,
            up.effect,
            { fontFamily: FONT, fontSize: L.stacked ? 21 : 24, color: hex(up.color) }
        ).setOrigin(L.stacked ? 0.5 : 0, 0.5));

        const badgeY = -CARD_H / 2 + 26;

        if (owned > 0)
        {
            const to = s.add.text(CARD_W / 2 - 24, badgeY, String(owned + 1), {
                fontFamily: FONT_UI, fontSize: 16, color: '#8d97bd'
            }).setOrigin(1, 0.5);

            const arrow = iconImage(s, to.x - to.width - 10, badgeY, 'arrowRight', { size: 13, color: 0x8d97bd });

            const from = s.add.text(arrow.x - 10, badgeY, `LV ${owned}`, {
                fontFamily: FONT_UI, fontSize: 16, color: '#8d97bd'
            }).setOrigin(1, 0.5);

            card.add([ from, arrow, to ]);
        }
        else
        {
            card.add(s.add.text(CARD_W / 2 - 24, badgeY, 'NEW', {
                fontFamily: FONT_UI, fontSize: 16, color: hex(up.color)
            }).setOrigin(1, 0.5));
        }

        //  Stack pips, tucked under the effect line on a tall card and beside
        //  it on a wide one.
        const stack = s.add.graphics();
        const pipY = L.stacked ? CARD_H / 2 - 22 : CARD_H / 2 - 32;

        for (let i = 0; i < up.max; i++)
        {
            const px = CARD_W / 2 - 24 - (up.max - 1 - i) * 14;

            stack.fillStyle(i < owned ? up.color : 0x2a3352, 1);
            stack.fillRoundedRect(px - 9, pipY, 9, 14, 3);
        }
        card.add(stack);

        card.setSize(CARD_W, CARD_H);
        card.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, CARD_W, CARD_H),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        card.on('pointerdown', (_p: unknown, _lx: unknown, _ly: unknown, e: any) =>
        {
            if (e && e.stopPropagation) e.stopPropagation();
            unlockAudio();
            this.pick(up, card);
        });

        return card;
    }

    /**
     * Taking a card is a shot, not a click: a tracer goes from the muzzle to
     * the card and the part lands on the gun. It costs nothing extra and keeps
     * the player's hands doing what they were doing a second ago.
     */
    private pick (up: Upgrade, card: GameObjects.Container): void
    {
        if (this.taken) return;

        this.taken = true;

        this.fx.tracer(MUZZLE.x, MUZZLE.y - 40, card.x, card.y, up.color, 5, 180);
        this.fx.burst(card.x, card.y, up.color, 40, 'big');
        this.fx.ring(card.x, card.y, 300, up.color, 8, 520);

        Sfx.upgrade();

        const cam = this.scene.cameras.main;

        cam.flash(180, (up.color >> 16) & 0xff, (up.color >> 8) & 0xff, up.color & 0xff);
        cam.shake(160, 0.008);

        for (const other of this.cards)
        {
            if (other === card) continue;

            other.disableInteractive();
            this.scene.tweens.add({ targets: other, alpha: 0, x: other.x - 700, duration: 260, ease: 'Quad.in' });
        }

        card.disableInteractive();

        this.scene.tweens.add({ targets: card, scale: 1.16, duration: 140, ease: 'Quad.out', yoyo: true });
        this.scene.tweens.add({ targets: card, alpha: 0, scale: 1.6, duration: 260, delay: 140, ease: 'Quad.in' });
        this.scene.tweens.add({ targets: this.scrim, alpha: 0, duration: 260, delay: 140 });

        this.scene.time.delayedCall(340, () => this.onDone(up));
    }
}
