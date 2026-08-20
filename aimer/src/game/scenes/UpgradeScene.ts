import { GameObjects, Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { rollOffers, UPGRADE_BY_ID, Upgrade } from '../data/upgrades';
import { run } from '../core/state';
import { iconImage } from '../core/icons';
import { rewardButton } from '../core/adButton';
import { offerInterstitial } from '../core/ads';
import { setGameplayActive } from '../core/lifecycle';
import { Doors } from '../objects/Doors';
import { zoneFor } from '../data/zones';
import { CX, CY, FONT, FONT_UI, H, LANDSCAPE, W, hex } from '../core/theme';

/**
 * Portrait deals the three offers as a stack of wide rows; a wide screen deals
 * them as a hand -- three tall cards side by side, which is both the shape the
 * space wants and the shape the genre reads fastest.
 */
const L = LANDSCAPE
    ? {
        cardW: 380,
        cardH: 236,
        /** Stacked: icon over name over effect, all centred. */
        stacked: true,
        headerY: 54,
        titleY: 104,
        titleSize: 42,
        cardsY: 330,
        rerollY: 512,
        buildLabelY: 596,
        buildY: 640,
        perRow: 12
    }
    : {
        cardW: 462,
        cardH: 168,
        stacked: false,
        headerY: 62,
        titleY: 108,
        titleSize: 38,
        cardsY: 258,
        rerollY: 788,
        buildLabelY: 828,
        buildY: 872,
        perRow: 8
    };

const CARD_W = L.cardW;
const CARD_H = L.cardH;

export class UpgradeScene extends Scene
{
    private fx!: Fx;
    private doors!: Doors;
    private picked = false;
    private cards: GameObjects.Container[] = [];

    constructor ()
    {
        super('Upgrade');
    }

    create ()
    {
        this.picked = false;
        this.cards = [];

        //  Reading three cards is not playing, and Poki counts it as such.
        setGameplayActive(false);

        //  This screen is the corridor between two levels, so it is dressed in
        //  the colours of the place the player is walking into, not the one
        //  they just left.
        const zone = zoneFor(run.level + 1);
        const tier = zone.palette;

        this.cameras.main.setBackgroundColor(tier.bg);

        this.fx = new Fx(this, 20);

        const grid = this.add.graphics().setDepth(0);
        grid.lineStyle(1, tier.grid, 0.35);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        this.add.text(CX - 16, L.headerY, `LEVEL ${run.level}`, {
            fontFamily: FONT_UI, fontSize: 20, color: '#8d97bd'
        }).setOrigin(1, 0.5);

        iconImage(this, CX, L.headerY, 'arrowRight', { size: 18, color: 0x8d97bd });

        this.add.text(CX + 16, L.headerY, `${run.level + 1}`, {
            fontFamily: FONT_UI, fontSize: 20, color: '#8d97bd'
        }).setOrigin(0, 0.5);

        const title = this.add.text(CX, L.titleY, 'CHOOSE UPGRADE', {
            fontFamily: FONT, fontSize: L.titleSize, color: hex(tier.accent), stroke: '#000000', strokeThickness: 6
        }).setOrigin(0.5).setScale(0.5);

        this.tweens.add({ targets: title, scale: 1, duration: 240, ease: 'Back.out' });

        this.dealOffers(true);

        //  Reroll as often as the player is willing to watch for: the three
        //  cards on the table only change once a video has actually played, so
        //  declining leaves the choice exactly as it was. Sits in the gap under
        //  the last card, clear of the build strip.
        rewardButton(this, CX, L.rerollY, {
            width: 214,
            height: 58,
            label: 'REROLL',
            icon: 'videoDice',
            compact: true,
            color: 0x9b6cff,
            repeat: true,
            onReward: () => this.reroll()
        });

        this.buildLoadout();

        //  The doors are already shut when this scene builds: they closed over
        //  the level that just ended, in the scene before this one. The player
        //  never sees black between the two.
        this.doors = new Doors(this);

        void this.doors.open(300);
    }

    /** Deals a fresh set of three, replacing whatever is on the table. */
    private dealOffers (first: boolean): void
    {
        for (const card of this.cards) card.destroy();

        const offers = rollOffers(run.taken, run.level, 3);
        const gap = LANDSCAPE ? 30 : 26;

        this.cards = offers.map((up, i) =>
        {
            const home = LANDSCAPE
                ? { x: CX + (i - (offers.length - 1) / 2) * (CARD_W + gap), y: L.cardsY }
                : { x: CX, y: L.cardsY + i * (CARD_H + gap) };

            const card = this.buildCard(up, home.x, home.y);

            //  Cards fly in from off screen: sideways in portrait, up from
            //  under the table in landscape, where sideways would have them
            //  crossing each other.
            if (LANDSCAPE) card.setY(home.y + 260);
            else card.setX(home.x + (i % 2 === 0 ? 620 : -620));

            card.setAlpha(0);

            this.tweens.add({
                targets: card,
                x: home.x,
                y: home.y,
                alpha: 1,
                duration: 320,
                delay: (first ? 0 : 40) + i * 70,
                ease: 'Back.out'
            });

            return card;
        });
    }

    private reroll (): void
    {
        if (this.picked) return;

        this.cameras.main.flash(140, 155, 108, 255);
        this.fx.ring(CX, CY, 260, 0x9b6cff, 6, 460);
        Sfx.upgrade();

        this.dealOffers(false);
    }

    private buildCard (up: Upgrade, x: number, y: number): GameObjects.Container
    {
        const owned = run.taken[up.id] || 0;
        const card = this.add.container(x, y).setDepth(10);

        const g = this.add.graphics();
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

        const glow = this.add.circle(art.x, art.y, art.glow, up.color, 0.2);
        card.add(glow);

        this.tweens.add({ targets: glow, scale: 1.18, alpha: 0.32, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        const icon = iconImage(this, art.x, art.y, up.icon, { size: art.size, color: up.color });
        card.add(icon);

        const name = this.add.text(
            L.stacked ? 0 : -CARD_W / 2 + 154,
            L.stacked ? CARD_H / 2 - 76 : -26,
            up.name,
            { fontFamily: FONT, fontSize: L.stacked ? 30 : 34, color: '#ffffff' }
        ).setOrigin(L.stacked ? 0.5 : 0, 0.5);
        card.add(name);

        const effect = this.add.text(
            L.stacked ? 0 : -CARD_W / 2 + 156,
            L.stacked ? CARD_H / 2 - 40 : 20,
            up.effect,
            { fontFamily: FONT, fontSize: L.stacked ? 21 : 24, color: hex(up.color) }
        ).setOrigin(L.stacked ? 0.5 : 0, 0.5);
        card.add(effect);

        const badgeY = -CARD_H / 2 + 26;

        if (owned > 0)
        {
            const to = this.add.text(CARD_W / 2 - 24, badgeY, String(owned + 1), {
                fontFamily: FONT_UI, fontSize: 16, color: '#8d97bd'
            }).setOrigin(1, 0.5);

            const arrow = iconImage(this, to.x - to.width - 10, badgeY, 'arrowRight', { size: 13, color: 0x8d97bd });

            const from = this.add.text(arrow.x - 10, badgeY, `LV ${owned}`, {
                fontFamily: FONT_UI, fontSize: 16, color: '#8d97bd'
            }).setOrigin(1, 0.5);

            card.add([ from, arrow, to ]);
        }
        else
        {
            card.add(this.add.text(CARD_W / 2 - 24, badgeY, 'NEW', {
                fontFamily: FONT_UI, fontSize: 16, color: hex(up.color)
            }).setOrigin(1, 0.5));
        }

        //  Stack pips, tucked under the effect line on a tall card and beside
        //  it on a wide one.
        const stack = this.add.graphics();
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

        card.on('pointerdown', () =>
        {
            unlockAudio();
            this.pick(up, card);
        });

        return card;
    }

    private buildLoadout (): void
    {
        const ids = Object.keys(run.taken);

        if (ids.length === 0) return;

        this.add.text(CX, L.buildLabelY, 'YOUR BUILD', {
            fontFamily: FONT_UI, fontSize: 14, color: '#5f6a92'
        }).setOrigin(0.5);

        const perRow = L.perRow;
        const spacing = 54;

        ids.forEach((id, i) =>
        {
            const up = UPGRADE_BY_ID[id];
            if (!up) return;

            const row = Math.floor(i / perRow);
            const inRow = Math.min(perRow, ids.length - row * perRow);
            const col = i % perRow;
            const x = CX - ((inRow - 1) * spacing) / 2 + col * spacing;
            const y = L.buildY + row * 44;

            iconImage(this, x, y, up.icon, { size: 26, color: up.color });
            this.add.text(x + 17, y + 12, String(run.taken[id]), {
                fontFamily: FONT, fontSize: 15, color: hex(up.color)
            }).setOrigin(0.5);
        });
    }

    private pick (up: Upgrade, card: GameObjects.Container): void
    {
        if (this.picked) return;

        this.picked = true;
        run.take(up.id);
        run.level += 1;

        Sfx.upgrade();
        this.cameras.main.flash(180, (up.color >> 16) & 0xff, (up.color >> 8) & 0xff, up.color & 0xff);
        this.cameras.main.shake(160, 0.008);

        this.fx.burst(card.x, card.y, up.color, 40, 'big');
        this.fx.ring(card.x, card.y, 300, up.color, 8, 520);

        for (const other of this.cards)
        {
            if (other === card) continue;

            this.tweens.add({ targets: other, alpha: 0, x: other.x - 700, duration: 260, ease: 'Quad.in' });
        }

        this.tweens.add({ targets: card, scale: 1.16, duration: 140, ease: 'Quad.out', yoyo: true });
        this.tweens.add({ targets: card, alpha: 0, scale: 1.6, duration: 260, delay: 200, ease: 'Quad.in' });

        this.time.delayedCall(260, () =>
        {
            //  Behind shut doors is the only mid-run moment an ad interrupts
            //  nothing. The pacing rules in core/ads decide whether it is
            //  actually taken, and the next level opens the same doors.
            void this.doors.close(260)
                .then(() => offerInterstitial())
                .then(() => this.scene.start('Game'));
        });
    }
}
