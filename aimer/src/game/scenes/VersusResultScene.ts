import { Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { setGameplayActive } from '../core/lifecycle';
import { offerInterstitial } from '../core/ads';
import { iconImage } from '../core/icons';
import { CX, FONT, FONT_UI, H, LANDSCAPE, W, fmt, hex, mix } from '../core/theme';
import {
    CPU_COLOR, CpuTier, MatchOutcome, YOU_COLOR, ladderRows, recordMatch, versus
} from '../data/versus';

interface ResultData
{
    you: number;
    cpu: number;
    cpuName: string;
    tier: CpuTier;
    stats: { hits: number; misses: number; bulls: number; bestStreak: number; cpuHits: number; cpuMisses: number };
}

/**
 * The card after a match: the verdict, the two scores side by side, and the
 * ladder the result just moved the player on.
 *
 * Landscape puts the verdict and scores in a left column with the ladder
 * filling the right; portrait stacks them with the ladder underneath.
 */
const L = LANDSCAPE
    ? {
        colX: W * 0.27,
        verdictY: 86,
        subY: 132,
        scoreY: 224,
        scoreW: 180,
        statY: 330,
        rematchY: 452,
        menuY: 540,
        boardX: W * 0.71,
        boardY: 58,
        boardW: Math.min(460, W * 0.44),
        rowH: 44,
        rows: 10
    }
    : {
        colX: CX,
        verdictY: 84,
        subY: 128,
        scoreY: 214,
        scoreW: 190,
        statY: 306,
        rematchY: H - 136,
        menuY: H - 60,
        boardX: CX,
        boardY: 350,
        boardW: W - 60,
        rowH: 40,
        rows: 9
    };

export class VersusResultScene extends Scene
{
    private fx!: Fx;
    private out!: MatchOutcome;
    private match!: ResultData;
    private leaving = false;

    constructor ()
    {
        super('VersusResult');
    }

    init (data: ResultData)
    {
        this.match = data;
    }

    create ()
    {
        setGameplayActive(false);
        this.leaving = false;

        this.out = recordMatch(this.match.you, this.match.cpu, this.match.cpuName, this.match.tier);

        const tone = this.out.draw ? 0xffc857 : this.out.won ? YOU_COLOR : CPU_COLOR;

        this.cameras.main.setBackgroundColor(mix(0x080b1c, tone, 0.06));
        this.cameras.main.fadeIn(220, 0, 0, 0);
        this.fx = new Fx(this, 20);

        const grid = this.add.graphics().setDepth(0);
        grid.lineStyle(1, mix(0x1b2a5e, tone, 0.25), 0.35);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        this.buildVerdict(tone);
        this.buildScores();
        this.buildStats();
        this.buildBoard();
        this.buildButtons();

        this.time.delayedCall(250, () =>
        {
            if (this.out.won)
            {
                Sfx.jackpot();
                for (let i = 0; i < 4; i++)
                {
                    this.time.delayedCall(i * 160, () =>
                        this.fx.burst(L.colX + (Math.random() - 0.5) * 300, L.verdictY + Math.random() * 60, i % 2 ? 0xffc857 : YOU_COLOR, 14, 'gold'));
                }
            }
            else if (this.out.draw) Sfx.milestone(1);
            else Sfx.expire();
        });
    }

    private buildVerdict (tone: number): void
    {
        const word = this.out.draw ? 'DRAW' : this.out.won ? 'VICTORY' : 'DEFEAT';

        const t = this.add.text(L.colX, L.verdictY, word, {
            fontFamily: FONT, fontSize: LANDSCAPE ? 62 : 70, color: '#ffffff', stroke: hex(tone), strokeThickness: 8
        }).setOrigin(0.5).setDepth(10).setScale(0.4);

        this.tweens.add({ targets: t, scale: 1, duration: 320, ease: 'Back.out' });

        if (this.out.won)
        {
            this.tweens.add({ targets: t, scale: 1.04, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: 320 });
        }

        const delta = this.out.ratingDelta;
        const deltaStr = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`;
        const sub = `${this.out.tier.name} opponent  ·  rating ${deltaStr}  →  ${versus.rating}`;

        this.add.text(L.colX, L.subY, sub, {
            fontFamily: FONT_UI, fontSize: 14, color: '#aab4d8'
        }).setOrigin(0.5).setDepth(10);

        if (versus.streak >= 2)
        {
            const pill = this.add.container(L.colX, L.subY + 30).setDepth(10);
            const g = this.add.graphics();
            g.fillStyle(0xffc857, 0.18);
            g.fillRoundedRect(-76, -13, 152, 26, 13);
            g.lineStyle(1.5, 0xffc857, 0.8);
            g.strokeRoundedRect(-76, -13, 152, 26, 13);
            pill.add(g);
            pill.add(this.add.text(0, 0, `${versus.streak} WIN STREAK`, {
                fontFamily: FONT, fontSize: 13, color: '#ffc857'
            }).setOrigin(0.5));
        }
    }

    /** The two scores as plates, winner brighter and slightly larger. */
    private buildScores (): void
    {
        const plate = (dx: number, label: string, score: number, color: number, winner: boolean) =>
        {
            const w = L.scoreW;
            const h = 88;
            const c = this.add.container(L.colX + dx, L.scoreY).setDepth(10);
            const g = this.add.graphics();
            g.fillStyle(color, winner ? 0.26 : 0.1);
            g.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
            g.lineStyle(winner ? 3 : 1.5, color, winner ? 1 : 0.5);
            g.strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
            c.add(g);
            c.add(this.add.text(0, -24, label, {
                fontFamily: FONT, fontSize: label.length > 11 ? 12 : 14, color: hex(color)
            }).setOrigin(0.5));
            const s = this.add.text(0, 12, '0', {
                fontFamily: FONT, fontSize: winner ? 36 : 30, color: winner ? '#ffffff' : '#aab4d8'
            }).setOrigin(0.5);
            c.add(s);

            //  Counts up, because a number that arrives is a number that is read.
            const tick = { v: 0 };
            this.tweens.add({
                targets: tick, v: score, duration: 900, ease: 'Cubic.out', delay: 200,
                onUpdate: () => s.setText(fmt(tick.v))
            });

            if (winner) c.setScale(1.06);

            return c;
        };

        const dx = L.scoreW / 2 + 12;
        plate(-dx, 'YOU', this.out.you, YOU_COLOR, this.out.won);
        plate(dx, this.out.cpuName.toUpperCase(), this.out.cpu, CPU_COLOR, !this.out.won && !this.out.draw);

        this.add.text(L.colX, L.scoreY, 'VS', {
            fontFamily: FONT, fontSize: 18, color: '#5f6a92'
        }).setOrigin(0.5).setDepth(11);

        if (this.out.newBest)
        {
            const nb = this.add.text(L.colX - dx, L.scoreY - 58, 'NEW BEST!', {
                fontFamily: FONT, fontSize: 14, color: '#ffc857', stroke: '#000000', strokeThickness: 3
            }).setOrigin(0.5).setDepth(12).setAngle(-6);
            this.tweens.add({ targets: nb, scale: 1.12, duration: 500, yoyo: true, repeat: -1 });
        }
    }

    private buildStats (): void
    {
        const s = this.match.stats;
        const shots = s.hits + s.misses;
        const acc = shots === 0 ? 0 : Math.round((s.hits / shots) * 100);

        const items: [string, string, number][] = [
            [ 'HITS', String(s.hits), 0xffffff ],
            [ 'ACCURACY', `${acc}%`, 0x6cf5c8 ],
            [ 'BEST COMBO', `${s.bestStreak}x`, 0xff8c42 ],
            [ 'BULLSEYES', String(s.bulls), 0xffc857 ],
            [ 'RECORD', `${versus.wins}-${versus.losses}`, 0x9b6cff ]
        ];

        const step = LANDSCAPE ? 92 : 100;
        const x0 = L.colX - step * 2;

        items.forEach(([ label, value, color ], i) =>
        {
            this.add.text(x0 + i * step, L.statY, value, {
                fontFamily: FONT, fontSize: 22, color: hex(color)
            }).setOrigin(0.5).setDepth(10);
            this.add.text(x0 + i * step, L.statY + 24, label, {
                fontFamily: FONT_UI, fontSize: 11, color: '#5f6a92'
            }).setOrigin(0.5).setDepth(10);
        });
    }

    /**
     * The ladder. Rank, name, score; the player's row glows blue and the
     * opponent they just met is marked red, so the two rows that matter
     * tonight can be found without reading the rest.
     */
    private buildBoard (): void
    {
        const rows = ladderRows();
        const youIdx = rows.findIndex(r => r.you);
        const w = L.boardW;
        const x = L.boardX;
        const top = L.boardY;
        const headH = 50;

        //  Show the top N; if the player is below the fold, cut one row and
        //  pin theirs at the bottom with an ellipsis so their rank is visible.
        let shown = rows.slice(0, L.rows);
        let pinned = false;

        if (youIdx >= L.rows)
        {
            shown = rows.slice(0, L.rows - 1);
            pinned = true;
        }

        const totalH = headH + (shown.length + (pinned ? 1 : 0)) * L.rowH + 16;

        const panel = this.add.container(x, top).setDepth(8);
        const bg = this.add.graphics();
        bg.fillStyle(0x0b1024, 0.94);
        bg.fillRoundedRect(-w / 2, 0, w, totalH, 20);
        bg.lineStyle(2, 0x2a3352, 1);
        bg.strokeRoundedRect(-w / 2, 0, w, totalH, 20);
        bg.fillStyle(0x131a36, 1);
        bg.fillRoundedRect(-w / 2, 0, w, headH, { tl: 20, tr: 20, bl: 0, br: 0 });
        panel.add(bg);

        panel.add(iconImage(this, -w / 2 + 30, headH / 2, 'chart', { size: 22, color: 0xffc857 }));
        panel.add(this.add.text(-w / 2 + 52, headH / 2, 'LEADERBOARD', {
            fontFamily: FONT, fontSize: 17, color: '#ffffff'
        }).setOrigin(0, 0.5).setLetterSpacing(2));
        panel.add(this.add.text(w / 2 - 22, headH / 2, 'BEST SCORE', {
            fontFamily: FONT_UI, fontSize: 11, color: '#5f6a92'
        }).setOrigin(1, 0.5));

        const drawRow = (entry: typeof rows[number], rank: number, slot: number, delay: number) =>
        {
            const y = headH + 8 + slot * L.rowH + L.rowH / 2;
            const row = this.add.container(0, y).setAlpha(0);
            const rw = w - 24;
            const color = entry.you ? YOU_COLOR : entry.recent ? CPU_COLOR : 0;

            const g = this.add.graphics();

            if (color)
            {
                g.fillStyle(color, entry.you ? 0.22 : 0.14);
                g.fillRoundedRect(-rw / 2, -L.rowH / 2 + 3, rw, L.rowH - 6, 10);
                g.lineStyle(1.5, color, entry.you ? 1 : 0.6);
                g.strokeRoundedRect(-rw / 2, -L.rowH / 2 + 3, rw, L.rowH - 6, 10);
            }
            else if (slot % 2 === 1)
            {
                g.fillStyle(0xffffff, 0.025);
                g.fillRoundedRect(-rw / 2, -L.rowH / 2 + 3, rw, L.rowH - 6, 10);
            }

            row.add(g);

            //  Medal colours for the podium, plain numerals below it.
            const medal = rank === 1 ? 0xffc857 : rank === 2 ? 0xc9d2e8 : rank === 3 ? 0xd58a4a : 0;

            if (medal)
            {
                const m = this.add.graphics();
                m.fillStyle(medal, 1);
                m.fillCircle(-rw / 2 + 24, 0, 13);
                row.add(m);
                row.add(this.add.text(-rw / 2 + 24, 0, String(rank), {
                    fontFamily: FONT, fontSize: 14, color: '#06101f'
                }).setOrigin(0.5));
            }
            else
            {
                row.add(this.add.text(-rw / 2 + 24, 0, `#${rank}`, {
                    fontFamily: FONT, fontSize: 14, color: '#5f6a92'
                }).setOrigin(0.5));
            }

            const nameColor = entry.you ? hex(YOU_COLOR) : entry.recent ? hex(CPU_COLOR) : '#e4e8f5';

            row.add(this.add.text(-rw / 2 + 50, 0, entry.name, {
                fontFamily: entry.you ? FONT : FONT_UI, fontSize: 16, color: nameColor
            }).setOrigin(0, 0.5));

            if (entry.recent && !entry.you)
            {
                const nx = -rw / 2 + 58 + entry.name.length * 9.2;
                const pg = this.add.graphics();
                pg.fillStyle(CPU_COLOR, 0.9);
                pg.fillRoundedRect(nx, -9, 62, 18, 6);
                row.add(pg);
                row.add(this.add.text(nx + 31, 0, 'JUST MET', {
                    fontFamily: FONT, fontSize: 9, color: '#ffffff'
                }).setOrigin(0.5));
            }

            row.add(this.add.text(rw / 2 - 10, 0, fmt(entry.score), {
                fontFamily: FONT, fontSize: 17, color: entry.you ? '#ffffff' : '#aab4d8'
            }).setOrigin(1, 0.5));

            panel.add(row);

            this.tweens.add({ targets: row, alpha: 1, x: { from: -24, to: 0 }, duration: 220, delay, ease: 'Quad.out' });

            return row;
        };

        shown.forEach((e, i) => drawRow(e, i + 1, i, 300 + i * 55));

        if (pinned)
        {
            const slot = shown.length;
            panel.add(this.add.text(0, headH + 8 + slot * L.rowH - 4, '· · ·', {
                fontFamily: FONT, fontSize: 12, color: '#3c4569'
            }).setOrigin(0.5));
            drawRow(rows[youIdx], youIdx + 1, slot, 300 + slot * 55);
        }

        //  The player's row gets a ring once it has landed.
        const rowY = top + headH + 8 + (pinned ? shown.length : youIdx) * L.rowH + L.rowH / 2;
        this.time.delayedCall(300 + (pinned ? shown.length : youIdx) * 55 + 240, () =>
            this.fx.ring(x, rowY, w * 0.55, YOU_COLOR, 3, 460));
    }

    private buildButtons (): void
    {
        const w = LANDSCAPE ? 300 : 340;
        const h = 78;
        const btn = this.add.container(L.colX, L.rematchY).setDepth(12);
        const g = this.add.graphics();
        g.fillStyle(CPU_COLOR, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 22);
        g.fillStyle(0xffffff, 0.18);
        g.fillRoundedRect(-w / 2, -h / 2, w, 34, { tl: 22, tr: 22, bl: 0, br: 0 });
        btn.add(g);
        btn.add(this.add.text(0, 0, 'FIND NEW MATCH', {
            fontFamily: FONT, fontSize: 28, color: '#ffffff', stroke: '#4a0f1a', strokeThickness: 4
        }).setOrigin(0.5));

        btn.setSize(w, h);
        btn.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, w, h),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });
        this.tweens.add({ targets: btn, scale: 1.03, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        btn.on('pointerdown', () =>
        {
            unlockAudio();
            Sfx.upgrade();
            this.fx.ring(btn.x, btn.y, 200, CPU_COLOR, 5, 400);
            this.leave('VersusQueue');
        });

        const menu = this.add.text(L.colX, L.menuY, 'BACK TO MENU', {
            fontFamily: FONT, fontSize: 20, color: '#7d88b0'
        }).setOrigin(0.5).setDepth(12).setInteractive({ useHandCursor: true });

        menu.on('pointerdown', () =>
        {
            unlockAudio();
            Sfx.ui();
            this.leave('MainMenu');
        });
    }

    private leave (scene: string): void
    {
        if (this.leaving) return;

        this.leaving = true;
        this.cameras.main.fadeOut(180, 0, 0, 0);
        this.time.delayedCall(190, () => void offerInterstitial().then(() => this.scene.start(scene)));
    }

    update (_t: number, delta: number): void
    {
        this.fx.update(Math.min(50, delta));
    }
}
