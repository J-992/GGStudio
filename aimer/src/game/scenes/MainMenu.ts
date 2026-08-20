import { Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, isMuted, toggleMute, unlockAudio } from '../core/audio';
import { meta, PERKS, perkCost, run, saveMeta } from '../core/state';
import { FINAL_LEVEL } from '../data/levels';
import { IconLabel, ic, iconImage } from '../core/icons';
import { FONT, FONT_UI, H, W, fmt, hex } from '../core/theme';

const DEMO_COLORS = [ 0x3fe0ff, 0xff5ce0, 0x7dff6b, 0xffd23f, 0x9b6cff ];

export class MainMenu extends Scene
{
    private fx!: Fx;
    private coinLabel!: IconLabel;
    private perkRows: { redraw: () => void }[] = [];

    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        this.perkRows = [];
        this.cameras.main.setBackgroundColor(0x080b1c);
        this.cameras.main.fadeIn(200, 0, 0, 0);

        this.fx = new Fx(this, 20);

        const grid = this.add.graphics().setDepth(0);
        grid.lineStyle(1, 0x1b2a5e, 0.4);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        this.spawnDemoTargets();

        const title = this.add.text(W / 2, 112, 'AIMER', {
            fontFamily: FONT, fontSize: 92, color: '#ffffff', stroke: '#3fe0ff', strokeThickness: 8
        }).setOrigin(0.5).setDepth(10);

        this.tweens.add({ targets: title, scale: 1.04, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        this.add.text(W / 2, 170, 'TAP TARGETS  ·  BUILD COMBOS  ·  GET STRONG', {
            fontFamily: FONT_UI, fontSize: 15, color: '#7d88b0'
        }).setOrigin(0.5).setDepth(10);

        this.buildPlayButton();
        this.buildStats();
        this.buildShop();

        //  Restore the saved mute preference on first boot.
        if (meta.muted && !isMuted())
        {
            unlockAudio();
            toggleMute();
        }

        const mute = iconImage(this, W - 30, 926, isMuted() ? 'soundOff' : 'soundOn', {
            size: 22, color: 0xffffff, alpha: 0.55
        });

        mute.setDepth(12).setInteractive({ useHandCursor: true });

        mute.on('pointerdown', () =>
        {
            unlockAudio();
            meta.muted = toggleMute();
            saveMeta();
            mute.setTexture(ic(meta.muted ? 'soundOff' : 'soundOn'));
        });

    }

    private spawnDemoTargets (): void
    {
        for (let i = 0; i < 5; i++)
        {
            this.time.delayedCall(i * 260, () => this.demoTarget());
        }

        this.time.addEvent({ delay: 900, loop: true, callback: () => this.demoTarget() });
    }

    private demoTarget (): void
    {
        const color = DEMO_COLORS[Math.floor(Math.random() * DEMO_COLORS.length)];
        const r = 18 + Math.random() * 14;
        const x = 40 + Math.random() * (W - 80);
        const y = 210 + Math.random() * (H - 340);

        const dot = this.add.circle(x, y, r, color, 0.24).setDepth(1);
        dot.setStrokeStyle(3, color, 0.55);
        dot.setScale(0.1);
        dot.setInteractive({
            hitArea: new Geom.Circle(r, r, r * 1.4),
            hitAreaCallback: Geom.Circle.Contains,
            useHandCursor: true
        });

        this.tweens.add({ targets: dot, scale: 1, duration: 240, ease: 'Back.out' });

        const kill = () =>
        {
            if (!dot.active) return;
            this.fx.burst(dot.x, dot.y, color, 10, 'hit');
            dot.destroy();
        };

        dot.on('pointerdown', () =>
        {
            unlockAudio();
            Sfx.hit(3);
            kill();
        });

        this.tweens.add({
            targets: dot, alpha: 0, scale: 0.4, duration: 700, delay: 2400 + Math.random() * 1600,
            onComplete: () => dot.destroy()
        });
    }

    private buildPlayButton (): void
    {
        const btn = this.add.container(W / 2, 268).setDepth(11);

        const g = this.add.graphics();
        g.fillStyle(0x3fe0ff, 1);
        g.fillRoundedRect(-160, -46, 320, 92, 26);
        g.fillStyle(0xffffff, 0.18);
        g.fillRoundedRect(-160, -46, 320, 40, { tl: 26, tr: 26, bl: 0, br: 0 });
        btn.add(g);

        const label = this.add.text(0, 0, 'PLAY', {
            fontFamily: FONT, fontSize: 46, color: '#06101f'
        }).setOrigin(0.5);
        btn.add(label);

        btn.setSize(320, 92);
        btn.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, 320, 92),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        this.tweens.add({ targets: btn, scale: 1.035, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        btn.on('pointerdown', () =>
        {
            unlockAudio();
            Sfx.upgrade();
            this.tweens.add({ targets: btn, scale: 0.92, duration: 90, yoyo: true });
            this.fx.ring(btn.x, btn.y, 220, 0x3fe0ff, 6, 420);

            run.reset();

            this.cameras.main.fadeOut(190, 0, 0, 0);
            this.time.delayedCall(200, () => this.scene.start('Game'));
        });
    }

    private buildStats (): void
    {
        const stat = (x: number, label: string, value: string, color: number) =>
        {
            this.add.text(x, 348, value, {
                fontFamily: FONT, fontSize: 26, color: hex(color)
            }).setOrigin(0.5).setDepth(10);

            this.add.text(x, 374, label, {
                fontFamily: FONT_UI, fontSize: 12, color: '#5f6a92'
            }).setOrigin(0.5).setDepth(10);
        };

        stat(110, 'BEST SCORE', fmt(meta.best), 0xffffff);
        stat(270, 'BEST LEVEL', `${meta.bestLevel}/${FINAL_LEVEL}`, 0x6cf5c8);
        stat(430, 'RANK XP', fmt(meta.rank), 0x9b6cff);
    }

    private buildShop (): void
    {
        this.add.text(W / 2, 424, 'PERMANENT UPGRADES', {
            fontFamily: FONT, fontSize: 20, color: '#5f6a92'
        }).setOrigin(0.5).setDepth(10);

        this.coinLabel = new IconLabel(this, W / 2, 890, 'gem', fmt(meta.coins), {
            fontSize: 34, iconSize: 30
        });
        this.coinLabel.setDepth(11);

        PERKS.forEach((perk, i) =>
        {
            const y = 476 + i * 74;
            const row = this.add.container(W / 2, y).setDepth(10);

            const g = this.add.graphics();
            row.add(g);

            const icon = iconImage(this, -208, 0, perk.icon, { size: 30, color: 0xffffff, alpha: 0.9 });
            row.add(icon);

            const name = this.add.text(-176, -12, perk.name, {
                fontFamily: FONT, fontSize: 20, color: '#ffffff'
            }).setOrigin(0, 0.5);
            row.add(name);

            const effect = this.add.text(-176, 12, perk.effect, {
                fontFamily: FONT_UI, fontSize: 14, color: '#7d88b0'
            }).setOrigin(0, 0.5);
            row.add(effect);

            const price = new IconLabel(this, 196, 0, 'gem', '', {
                align: 'right', fontSize: 20, iconSize: 18
            });
            row.add(price);

            const redraw = () =>
            {
                const lvl = meta.perks[perk.id] || 0;
                const maxed = lvl >= perk.max;
                const cost = perkCost(perk, lvl);
                const afford = !maxed && meta.coins >= cost;

                g.clear();
                g.fillStyle(0x0b1024, 0.9);
                g.fillRoundedRect(-232, -32, 464, 64, 16);
                g.lineStyle(2, maxed ? 0x6cf5c8 : (afford ? 0xffc857 : 0x2a3352), maxed || afford ? 0.9 : 0.7);
                g.strokeRoundedRect(-232, -32, 464, 64, 16);

                for (let p = 0; p < perk.max; p++)
                {
                    g.fillStyle(p < lvl ? 0x6cf5c8 : 0x2a3352, 1);
                    g.fillRect(-176 + p * 12, 22, 8, 4);
                }

                const tone = maxed ? 0x6cf5c8 : (afford ? 0xffc857 : 0x4c5578);

                price.setValue(maxed ? 'MAX' : fmt(cost), !maxed);
                price.text.setColor(hex(tone));
                price.icon.setTint(tone);
            };

            redraw();
            this.perkRows.push({ redraw });

            row.setSize(464, 64);
            row.setInteractive({
                hitArea: new Geom.Rectangle(0, 0, 464, 64),
                hitAreaCallback: Geom.Rectangle.Contains,
                useHandCursor: true
            });

            row.on('pointerdown', () =>
            {
                unlockAudio();

                const lvl = meta.perks[perk.id] || 0;

                if (lvl >= perk.max) { Sfx.dry(); return; }

                const cost = perkCost(perk, lvl);

                if (meta.coins < cost)
                {
                    Sfx.miss();
                    this.tweens.add({ targets: row, x: W / 2 + 8, duration: 55, yoyo: true, repeat: 2 });
                    return;
                }

                meta.coins -= cost;
                meta.perks[perk.id] = lvl + 1;
                saveMeta();

                Sfx.upgrade();
                this.fx.burst(row.x, row.y, 0x6cf5c8, 18, 'hit');
                this.tweens.add({ targets: row, scale: 1.05, duration: 110, yoyo: true, ease: 'Quad.out' });

                this.refreshShop();
            });
        });
    }

    private refreshShop (): void
    {
        this.coinLabel.setValue(fmt(meta.coins));
        this.coinLabel.setScale(1.2);
        this.tweens.add({ targets: this.coinLabel, scale: 1, duration: 160, ease: 'Quad.out' });

        for (const r of this.perkRows) r.redraw();
    }

    update (_time: number, delta: number): void
    {
        this.fx.update(Math.min(50, delta));
    }
}
