import { GameObjects, Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { rollOffers, UPGRADE_BY_ID, Upgrade } from '../data/upgrades';
import { run } from '../core/state';
import { FONT, FONT_UI, H, W, hex, tierFor } from '../core/theme';

const CARD_W = 462;
const CARD_H = 168;

export class UpgradeScene extends Scene
{
    private fx!: Fx;
    private picked = false;

    constructor ()
    {
        super('Upgrade');
    }

    create ()
    {
        this.picked = false;

        const tier = tierFor(run.level + 1);
        this.cameras.main.setBackgroundColor(tier.bg);
        this.cameras.main.fadeIn(150, 0, 0, 0);

        this.fx = new Fx(this, 20);

        const grid = this.add.graphics().setDepth(0);
        grid.lineStyle(1, tier.grid, 0.35);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        this.add.text(W / 2, 62, `LEVEL ${run.level}  →  ${run.level + 1}`, {
            fontFamily: FONT_UI, fontSize: 20, color: '#8d97bd'
        }).setOrigin(0.5);

        const title = this.add.text(W / 2, 108, 'CHOOSE UPGRADE', {
            fontFamily: FONT, fontSize: 38, color: hex(tier.accent), stroke: '#000000', strokeThickness: 6
        }).setOrigin(0.5).setScale(0.5);

        this.tweens.add({ targets: title, scale: 1, duration: 240, ease: 'Back.out' });

        const offers = rollOffers(run.taken, run.level, 3);

        offers.forEach((up, i) =>
        {
            const y = 258 + i * (CARD_H + 26);
            const card = this.buildCard(up, y);

            card.setX(W / 2 + (i % 2 === 0 ? 620 : -620));
            card.setAlpha(0);

            this.tweens.add({
                targets: card,
                x: W / 2,
                alpha: 1,
                duration: 380,
                delay: 90 + i * 90,
                ease: 'Back.out'
            });
        });

        this.buildLoadout();
    }

    private buildCard (up: Upgrade, y: number): GameObjects.Container
    {
        const owned = run.taken[up.id] || 0;
        const card = this.add.container(W / 2, y).setDepth(10);

        const g = this.add.graphics();
        g.fillStyle(0x0b1024, 0.94);
        g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
        g.lineStyle(4, up.color, 0.95);
        g.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
        g.fillStyle(up.color, 0.1);
        g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
        card.add(g);

        const glow = this.add.circle(-CARD_W / 2 + 84, 0, 58, up.color, 0.2);
        card.add(glow);

        this.tweens.add({ targets: glow, scale: 1.18, alpha: 0.32, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        const icon = this.add.text(-CARD_W / 2 + 84, 0, up.icon, {
            fontFamily: FONT_UI, fontSize: 62
        }).setOrigin(0.5);
        card.add(icon);

        const name = this.add.text(-CARD_W / 2 + 154, -26, up.name, {
            fontFamily: FONT, fontSize: 34, color: '#ffffff'
        }).setOrigin(0, 0.5);
        card.add(name);

        const effect = this.add.text(-CARD_W / 2 + 156, 20, up.effect, {
            fontFamily: FONT, fontSize: 24, color: hex(up.color)
        }).setOrigin(0, 0.5);
        card.add(effect);

        const badge = this.add.text(CARD_W / 2 - 24, -CARD_H / 2 + 26, owned > 0 ? `LV ${owned} → ${owned + 1}` : 'NEW', {
            fontFamily: FONT_UI, fontSize: 16, color: owned > 0 ? '#8d97bd' : hex(up.color)
        }).setOrigin(1, 0.5);
        card.add(badge);

        const stack = this.add.graphics();
        for (let i = 0; i < up.max; i++)
        {
            const px = CARD_W / 2 - 24 - (up.max - 1 - i) * 14;
            stack.fillStyle(i < owned ? up.color : 0x2a3352, 1);
            stack.fillRoundedRect(px - 9, CARD_H / 2 - 32, 9, 14, 3);
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

        this.add.text(W / 2, 828, 'YOUR BUILD', {
            fontFamily: FONT_UI, fontSize: 14, color: '#5f6a92'
        }).setOrigin(0.5);

        const perRow = 8;
        const spacing = 54;

        ids.forEach((id, i) =>
        {
            const up = UPGRADE_BY_ID[id];
            if (!up) return;

            const row = Math.floor(i / perRow);
            const inRow = Math.min(perRow, ids.length - row * perRow);
            const col = i % perRow;
            const x = W / 2 - ((inRow - 1) * spacing) / 2 + col * spacing;
            const y = 872 + row * 46;

            this.add.text(x, y, up.icon, { fontFamily: FONT_UI, fontSize: 26 }).setOrigin(0.5);
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

        this.children.each((child: GameObjects.GameObject) =>
        {
            if (child === card || !(child instanceof GameObjects.Container)) return;

            this.tweens.add({ targets: child, alpha: 0, x: child.x - 700, duration: 300, ease: 'Quad.in' });
        });

        this.tweens.add({ targets: card, scale: 1.16, duration: 140, ease: 'Quad.out', yoyo: true });
        this.tweens.add({ targets: card, alpha: 0, scale: 1.6, duration: 260, delay: 200, ease: 'Quad.in' });

        this.time.delayedCall(420, () =>
        {
            this.cameras.main.fadeOut(150, 0, 0, 0);
            this.time.delayedCall(160, () => this.scene.start('Game'));
        });
    }
}
