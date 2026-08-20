import { GameObjects, Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { meta, run } from '../core/state';
import { FONT, FONT_UI, H, W, fmt, hex, tierFor } from '../core/theme';

interface ResultData
{
    mode: 'fail' | 'victory';
    levelScore: number;
    bestCombo: number;
}

export class ResultScene extends Scene
{
    private result!: ResultData;
    private fx!: Fx;

    constructor ()
    {
        super('Result');
    }

    init (data: ResultData)
    {
        this.result = { mode: data?.mode || 'fail', levelScore: data?.levelScore || 0, bestCombo: data?.bestCombo || 0 };
    }

    create ()
    {
        const win = this.result.mode === 'victory';
        const tier = tierFor(run.level);

        this.cameras.main.setBackgroundColor(win ? 0x1f1203 : 0x140812);
        this.cameras.main.fadeIn(200, 0, 0, 0);

        this.fx = new Fx(this, 20);

        const grid = this.add.graphics().setDepth(0);
        grid.lineStyle(1, win ? 0x6b3f08 : 0x3a1024, 0.5);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        const headline = win ? 'RUN COMPLETE' : "TIME'S UP";
        const headColor = win ? 0xffd23f : 0xff4d5e;

        const head = this.add.text(W / 2, 200, headline, {
            fontFamily: FONT, fontSize: win ? 58 : 64, color: hex(headColor), stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setScale(0.4).setDepth(10);

        this.tweens.add({ targets: head, scale: 1, duration: 320, ease: 'Back.out' });

        this.add.text(W / 2, 252, win ? 'ALL 20 LEVELS CLEARED' : `REACHED LEVEL ${run.level}`, {
            fontFamily: FONT_UI, fontSize: 17, color: '#8d97bd'
        }).setOrigin(0.5).setDepth(10);

        const total = run.score + this.result.levelScore;

        this.add.text(W / 2, 340, 'SCORE', {
            fontFamily: FONT_UI, fontSize: 16, color: '#5f6a92'
        }).setOrigin(0.5).setDepth(10);

        const scoreText = this.add.text(W / 2, 396, '0', {
            fontFamily: FONT, fontSize: 66, color: '#ffffff', stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setDepth(10);

        this.tweens.addCounter({
            from: 0, to: total, duration: 620, ease: 'Cubic.out',
            onUpdate: (tw: any) => scoreText.setText(fmt(tw.getValue() as number))
        });

        if (total >= meta.best && total > 0)
        {
            const nb = this.add.text(W / 2, 446, 'NEW BEST!', {
                fontFamily: FONT, fontSize: 24, color: '#6cf5c8'
            }).setOrigin(0.5).setDepth(10);

            this.tweens.add({ targets: nb, scale: 1.14, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        }

        const stat = (x: number, label: string, value: string, color: number) =>
        {
            this.add.text(x, 520, value, {
                fontFamily: FONT, fontSize: 30, color: hex(color)
            }).setOrigin(0.5).setDepth(10);

            this.add.text(x, 550, label, {
                fontFamily: FONT_UI, fontSize: 12, color: '#5f6a92'
            }).setOrigin(0.5).setDepth(10);
        };

        stat(110, 'BEST COMBO', `x${Math.max(run.bestCombo, this.result.bestCombo)}`, 0xff5ce0);
        stat(270, 'COINS EARNED', fmt(run.coinsEarned), 0xffc857);
        stat(430, 'UPGRADES', String(run.picks), 0x3fe0ff);

        const primaryLabel = win ? 'PLAY AGAIN' : 'TRY AGAIN';

        this.button(W / 2, 660, 340, 96, primaryLabel, win ? 0xffd23f : 0x6cf5c8, 40, () =>
        {
            if (win) run.reset();
            this.leave('Game');
        });

        this.button(W / 2, 786, 240, 68, 'MENU', 0x2a3352, 26, () =>
        {
            run.reset();
            this.leave('MainMenu');
        }, '#ffffff');

        this.add.text(W / 2, 880, `◆ ${fmt(meta.coins)}   ·   RANK ${fmt(meta.rank)}`, {
            fontFamily: FONT_UI, fontSize: 16, color: '#7d88b0'
        }).setOrigin(0.5).setDepth(10);

        if (win)
        {
            Sfx.victory();
            this.confetti(tier.accent);
        }

        //  Keyboard shortcut so desktop testing stays fast.
        this.input.keyboard?.once('keydown-SPACE', () =>
        {
            if (win) run.reset();
            this.leave('Game');
        });
    }

    private confetti (color: number): void
    {
        for (let i = 0; i < 8; i++)
        {
            this.time.delayedCall(i * 150, () =>
            {
                const x = 60 + Math.random() * (W - 120);
                this.fx.burst(x, 120 + Math.random() * 160, i % 2 === 0 ? 0xffd23f : color, 24, 'gold');
                this.fx.ring(x, 160, 120, 0xffd23f, 4, 400);
            });
        }
    }

    private button (x: number, y: number, w: number, h: number, label: string, color: number, size: number, onTap: () => void, textColor = '#06101f'): GameObjects.Container
    {
        const btn = this.add.container(x, y).setDepth(11);

        const g = this.add.graphics();
        g.fillStyle(color, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 22);
        g.fillStyle(0xffffff, 0.16);
        g.fillRoundedRect(-w / 2, -h / 2, w, h * 0.42, { tl: 22, tr: 22, bl: 0, br: 0 });
        btn.add(g);

        const t = this.add.text(0, 0, label, { fontFamily: FONT, fontSize: size, color: textColor }).setOrigin(0.5);
        btn.add(t);

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
            this.tweens.add({ targets: btn, scale: 0.92, duration: 80, yoyo: true, onComplete: onTap });
        });

        return btn;
    }

    private leave (scene: string): void
    {
        this.cameras.main.fadeOut(180, 0, 0, 0);
        this.time.delayedCall(190, () => this.scene.start(scene));
    }

    update (_time: number, delta: number): void
    {
        this.fx.update(Math.min(50, delta));
    }
}
