import { GameObjects, Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { bankCoins, meta, run, saveMeta } from '../core/state';
import { FINAL_LEVEL } from '../data/levels';
import { IconLabel } from '../core/icons';
import { rewardButton } from '../core/adButton';
import { offerInterstitial } from '../core/ads';
import { setGameplayActive } from '../core/lifecycle';
import { reportPlatformHappyTime } from '../platform/platform';
import { zoneFor } from '../data/zones';
import { CX, FONT, FONT_UI, H, LANDSCAPE, W, fmt, hex } from '../core/theme';

/**
 * One column of card, tightened up when the screen is wide and short. The
 * offer, when there is one, pushes everything below it down by `shift`.
 */
const L = LANDSCAPE
    ? {
        headY: 96,
        subY: 138,
        scoreLabelY: 196,
        scoreY: 248,
        bestY: 296,
        statY: 350,
        popY: 410,
        offerY: 434,
        primaryY: 500,
        menuY: 588,
        footerY: 646,
        shift: 46
    }
    : {
        headY: 200,
        subY: 252,
        scoreLabelY: 340,
        scoreY: 396,
        bestY: 446,
        statY: 520,
        popY: 560,
        offerY: 622,
        primaryY: 660,
        menuY: 786,
        footerY: 886,
        shift: 66
    };

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
    private footer!: IconLabel;
    private coinsStat!: GameObjects.Text;
    private leaving = false;

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
        const tier = zoneFor(run.level).palette;

        this.leaving = false;

        //  Whatever the run did, the player is reading a card now, not playing.
        setGameplayActive(false);

        this.cameras.main.setBackgroundColor(win ? 0x1f1203 : 0x140812);
        this.cameras.main.fadeIn(200, 0, 0, 0);

        this.fx = new Fx(this, 20);

        const grid = this.add.graphics().setDepth(0);
        grid.lineStyle(1, win ? 0x6b3f08 : 0x3a1024, 0.5);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        const headline = win ? 'RUN COMPLETE' : "TIME'S UP";
        const headColor = win ? 0xffd23f : 0xff4d5e;

        const head = this.add.text(CX, L.headY, headline, {
            fontFamily: FONT, fontSize: win ? 58 : 64, color: hex(headColor), stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setScale(0.4).setDepth(10);

        this.tweens.add({ targets: head, scale: 1, duration: 320, ease: 'Back.out' });

        this.add.text(CX, L.subY, win ? `ALL ${FINAL_LEVEL} LEVELS CLEARED` : `REACHED LEVEL ${run.level}`, {
            fontFamily: FONT_UI, fontSize: 17, color: '#8d97bd'
        }).setOrigin(0.5).setDepth(10);

        const total = run.score + this.result.levelScore;

        this.add.text(CX, L.scoreLabelY, 'SCORE', {
            fontFamily: FONT_UI, fontSize: 16, color: '#5f6a92'
        }).setOrigin(0.5).setDepth(10);

        const scoreText = this.add.text(CX, L.scoreY, '0', {
            fontFamily: FONT, fontSize: 66, color: '#ffffff', stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setDepth(10);

        this.tweens.addCounter({
            from: 0, to: total, duration: 620, ease: 'Cubic.out',
            onUpdate: (tw: any) => scoreText.setText(fmt(tw.getValue() as number))
        });

        if (win) void reportPlatformHappyTime(1);

        if (total >= meta.best && total > 0)
        {
            if (!win) void reportPlatformHappyTime(0.85);

            const nb = this.add.text(CX, L.bestY, 'NEW BEST!', {
                fontFamily: FONT, fontSize: 24, color: '#6cf5c8'
            }).setOrigin(0.5).setDepth(10);

            this.tweens.add({ targets: nb, scale: 1.14, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        }

        const stat = (slot: number, label: string, value: string, color: number) =>
        {
            const x = CX + slot * 160;

            const text = this.add.text(x, L.statY, value, {
                fontFamily: FONT, fontSize: 30, color: hex(color)
            }).setOrigin(0.5).setDepth(10);

            this.add.text(x, L.statY + 30, label, {
                fontFamily: FONT_UI, fontSize: 12, color: '#5f6a92'
            }).setOrigin(0.5).setDepth(10);

            return text;
        };

        stat(-1, 'BEST COMBO', `x${Math.max(run.bestCombo, this.result.bestCombo)}`, 0xff5ce0);
        this.coinsStat = stat(0, 'COINS EARNED', fmt(run.coinsEarned), 0xffc857);
        stat(1, 'UPGRADES', String(run.picks), 0x3fe0ff);

        //  The whole run's coins are the reward, so the offer only exists when
        //  there is something to double. Everything below it slides down to
        //  make room, and slides back up on a build with no ads at all.
        const doubled = Math.round(run.coinsEarned);
        const offer = doubled > 0
            ? rewardButton(this, CX, L.offerY, {
                label: `DOUBLE ${fmt(doubled)} COINS`,
                color: 0xffc857,
                onReward: () => this.grantDoubleCoins(doubled)
            })
            : null;

        const shift = offer ? L.shift : 0;
        const primaryLabel = win ? 'PLAY AGAIN' : 'TRY AGAIN';

        this.button(CX, L.primaryY + shift, 340, 96, primaryLabel, win ? 0xffd23f : 0x6cf5c8, 40, () =>
        {
            if (win) run.reset();
            this.leave('Game');
        });

        this.button(CX, L.menuY + shift, 240, 62, 'MENU', 0x2a3352, 26, () =>
        {
            run.reset();
            this.leave('MainMenu');
        }, '#ffffff');

        this.footer = new IconLabel(this, CX, L.footerY + shift, 'gem', this.footerText(), {
            fontFamily: FONT_UI, fontSize: 16, iconSize: 16, color: '#7d88b0'
        });
        this.footer.setDepth(10);

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

    private footerText (): string
    {
        return `${fmt(meta.coins)}   ·   RANK ${fmt(meta.rank)}`;
    }

    /**
     * Pays the rewarded video out. The run's coins were banked as they were
     * earned, so doubling means banking the same amount a second time -- the
     * player keeps everything either way, and declining costs them nothing.
     */
    private grantDoubleCoins (amount: number): void
    {
        bankCoins(amount);
        run.coinsEarned += amount;
        saveMeta();

        this.coinsStat.setText(fmt(run.coinsEarned));
        this.footer.setValue(this.footerText());
        this.footer.setScale(1.25);
        this.tweens.add({ targets: this.footer, scale: 1, duration: 200, ease: 'Back.out' });

        const pop = this.add.text(CX, L.popY, `+${fmt(amount)}`, {
            fontFamily: FONT, fontSize: 42, color: '#ffc857', stroke: '#000000', strokeThickness: 7
        }).setOrigin(0.5).setDepth(20);

        this.tweens.add({
            targets: pop, y: L.popY - 52, alpha: 0, duration: 900, ease: 'Quad.out',
            onComplete: () => pop.destroy()
        });

        this.fx.burst(CX, L.popY, 0xffc857, 26, 'gold');
        void reportPlatformHappyTime(0.7);
    }

    private confetti (color: number): void
    {
        for (let i = 0; i < 8; i++)
        {
            this.time.delayedCall(i * 150, () =>
            {
                const x = 60 + Math.random() * (W - 120);
                this.fx.burst(x, 90 + Math.random() * 160, i % 2 === 0 ? 0xffd23f : color, 24, 'gold');
                this.fx.ring(x, 130, 120, 0xffd23f, 4, 400);
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

    /**
     * The end of a run is the break Poki actually wants: the player has stopped,
     * the screen is already fading to black and nothing is mid-animation behind
     * it. `offerInterstitial` resolves immediately when its own pacing rules say
     * no, so the usual path is still a straight cut to the next scene.
     */
    private leave (scene: string): void
    {
        if (this.leaving) return;

        this.leaving = true;
        this.cameras.main.fadeOut(180, 0, 0, 0);

        this.time.delayedCall(190, () =>
        {
            void offerInterstitial().then(() => this.scene.start(scene));
        });
    }

    update (_time: number, delta: number): void
    {
        this.fx.update(Math.min(50, delta));
    }
}
