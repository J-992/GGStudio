import { Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx } from '../core/audio';
import { setGameplayActive } from '../core/lifecycle';
import { iconImage } from '../core/icons';
import { CX, CY, FONT, FONT_UI, H, LANDSCAPE, W, hex } from '../core/theme';
import {
    CPU_COLOR, CpuTier, YOU_COLOR, generateName, isPlacement, pickTier, randomHint, versus
} from '../data/versus';

/**
 * The matchmaking queue. Nobody is being matched -- the opponent is a table
 * lookup -- but a few seconds of "searching" with a live player count and a
 * tip is what turns a button press into a match the player cares about.
 *
 * Search, then FOUND, then the two name plates slam into a VS card, then the
 * match. The whole thing is about four seconds.
 */
export class VersusQueueScene extends Scene
{
    private fx!: Fx;
    private cpuName = '';
    private tier!: CpuTier;
    /** True while matchmaking is still holding the player back to easy bots. */
    private placement = false;

    constructor ()
    {
        super('VersusQueue');
    }

    create ()
    {
        setGameplayActive(false);

        this.cameras.main.setBackgroundColor(0x070a18);
        this.cameras.main.fadeIn(160, 0, 0, 0);
        this.fx = new Fx(this, 20);

        this.cpuName = generateName();
        this.tier = pickTier(versus.wins, versus.played);
        this.placement = isPlacement(versus.wins, versus.played);

        const grid = this.add.graphics().setDepth(0);
        grid.lineStyle(1, 0x1b2a5e, 0.35);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        //  Blue wash on the left/top half, red on the other: the split the
        //  player is about to play in, already on screen.
        const wash = this.add.graphics().setDepth(0);
        wash.fillGradientStyle(YOU_COLOR, CPU_COLOR, YOU_COLOR, CPU_COLOR, 0.08, 0.08, 0.08, 0.08);
        wash.fillRect(0, 0, W, H);

        const top = LANDSCAPE ? 150 : 230;

        this.add.text(CX, top - 70, 'COMPETITIVE', {
            fontFamily: FONT, fontSize: 22, color: '#ff4a5c', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5).setDepth(10).setLetterSpacing(6);

        const status = this.add.text(CX, top, 'SEARCHING FOR OPPONENT', {
            fontFamily: FONT, fontSize: LANDSCAPE ? 34 : 30, color: '#ffffff'
        }).setOrigin(0.5).setDepth(10);

        //  Spinner: three chasing arcs.
        const spin = this.add.container(CX, top + 110).setDepth(10);

        for (let i = 0; i < 3; i++)
        {
            const g = this.add.graphics();
            g.lineStyle(6 - i * 1.5, i === 1 ? CPU_COLOR : YOU_COLOR, 0.9 - i * 0.25);
            g.beginPath();
            g.arc(0, 0, 52 - i * 14, 0, Math.PI * 1.35, false);
            g.strokePath();
            spin.add(g);

            this.tweens.add({
                targets: g, angle: (i % 2 === 0 ? 360 : -360), duration: 1100 + i * 300, repeat: -1
            });
        }

        const dots = this.add.text(CX, top + 110, '', {
            fontFamily: FONT, fontSize: 30, color: '#ffffff'
        }).setOrigin(0.5).setDepth(11);

        let tick = 0;
        const dotTimer = this.time.addEvent({
            delay: 330, loop: true, callback: () =>
            {
                tick += 1;
                dots.setText('.'.repeat(1 + (tick % 3)));
            }
        });

        //  Online count that jitters like a real lobby does.
        let online = 1200 + Math.floor(Math.random() * 900);
        const onlineText = this.add.text(CX, top + 200, '', {
            fontFamily: FONT_UI, fontSize: 15, color: '#7d88b0'
        }).setOrigin(0.5).setDepth(10);

        const showOnline = () => onlineText.setText(`${online.toLocaleString()} players online  ·  region auto`);
        showOnline();

        const onlineTimer = this.time.addEvent({
            delay: 700, loop: true, callback: () =>
            {
                online += Math.floor(Math.random() * 21) - 10;
                showOnline();
            }
        });

        //  The tip card.
        const tipY = LANDSCAPE ? H - 130 : H - 250;
        const tipW = Math.min(460, W - 60);
        const card = this.add.container(CX, tipY).setDepth(10);
        const cg = this.add.graphics();
        cg.fillStyle(0x0b1024, 0.92);
        cg.fillRoundedRect(-tipW / 2, -50, tipW, 100, 18);
        cg.lineStyle(2, 0xffc857, 0.6);
        cg.strokeRoundedRect(-tipW / 2, -50, tipW, 100, 18);
        card.add(cg);
        card.add(iconImage(this, -tipW / 2 + 34, 0, 'sparkle', { size: 26, color: 0xffc857 }));
        card.add(this.add.text(-tipW / 2 + 62, -30, 'TIP', {
            fontFamily: FONT, fontSize: 13, color: '#ffc857'
        }).setOrigin(0, 0).setLetterSpacing(3));
        card.add(this.add.text(-tipW / 2 + 62, 12, randomHint(), {
            fontFamily: FONT_UI, fontSize: 17, color: '#ffffff', wordWrap: { width: tipW - 84 }
        }).setOrigin(0, 0.5));

        this.tweens.add({ targets: card, y: tipY - 6, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        //  Cancel: a queue with no way out is a trap, even a fake one.
        const cancel = this.add.text(CX, H - 60, 'CANCEL', {
            fontFamily: FONT, fontSize: 18, color: '#5f6a92'
        }).setOrigin(0.5).setDepth(10).setInteractive({ useHandCursor: true });

        let cancelled = false;

        cancel.on('pointerdown', () =>
        {
            if (cancelled) return;
            cancelled = true;
            Sfx.ui();
            this.cameras.main.fadeOut(150, 0, 0, 0);
            this.time.delayedCall(160, () => this.scene.start('MainMenu'));
        });

        //  Found!
        const wait = 2600 + Math.random() * 1900;

        this.time.delayedCall(wait, () =>
        {
            if (cancelled) return;

            cancelled = true;
            cancel.destroy();
            dotTimer.remove();
            onlineTimer.remove();
            dots.destroy();
            spin.destroy();
            onlineText.destroy();

            Sfx.milestone(2);
            status.setText('OPPONENT FOUND').setColor(hex(0x6cf5c8));
            this.tweens.add({ targets: status, scale: 1.12, duration: 120, yoyo: true });
            this.fx.ring(CX, top, 260, 0x6cf5c8, 5, 480);

            this.time.delayedCall(500, () => this.vsCard(card));
        });
    }

    /** Two plates slide in from either side and meet at the VS. */
    private vsCard (tip: Phaser.GameObjects.Container): void
    {
        const y = CY - (LANDSCAPE ? 0 : 30);
        const vertical = !LANDSCAPE;
        const plateW = vertical ? Math.min(380, W - 80) : Math.min(360, W * 0.34);
        const plateH = 104;
        const off = vertical ? 130 : plateW / 2 + 70;

        const plate = (name: string, sub: string, color: number, dx: number, dy: number, from: number) =>
        {
            const c = this.add.container(CX + dx * (vertical ? 0 : 1) + (vertical ? 0 : 0), y + dy)
                .setDepth(12).setAlpha(0);
            const g = this.add.graphics();
            g.fillStyle(color, 0.18);
            g.fillRoundedRect(-plateW / 2, -plateH / 2, plateW, plateH, 20);
            g.lineStyle(3, color, 1);
            g.strokeRoundedRect(-plateW / 2, -plateH / 2, plateW, plateH, 20);
            c.add(g);
            c.add(this.add.text(0, -14, name, {
                fontFamily: FONT, fontSize: name.length > 12 ? 24 : 30, color: hex(color)
            }).setOrigin(0.5));
            c.add(this.add.text(0, 24, sub, {
                fontFamily: FONT_UI, fontSize: 14, color: '#aab4d8'
            }).setOrigin(0.5));

            if (vertical) { c.x = CX + from; }
            else { c.x = CX + dx + from; }

            this.tweens.add({
                targets: c, x: vertical ? CX : CX + dx, alpha: 1, duration: 380, ease: 'Back.out'
            });

            return c;
        };

        const record = this.placement
            ? 'PLACEMENT MATCH'
            : `${versus.wins}W  ${versus.losses}L  ·  rating ${versus.rating}`;

        plate('YOU', record, YOU_COLOR, -off, vertical ? -off : 0, -W);
        plate(this.cpuName, `${this.tier.name}  ·  rating ${this.cpuRating()}`, CPU_COLOR, off, vertical ? off : 0, W);

        const vs = this.add.text(CX, y, 'VS', {
            fontFamily: FONT, fontSize: 72, color: '#ffffff', stroke: '#000000', strokeThickness: 10
        }).setOrigin(0.5).setDepth(13).setScale(0);

        this.time.delayedCall(360, () =>
        {
            Sfx.launch();
            this.tweens.add({ targets: vs, scale: 1, duration: 260, ease: 'Back.out' });
            this.fx.ring(CX, y, 200, 0xffffff, 4, 460);
            this.cameras.main.shake(120, 0.008);
        });

        this.tweens.add({ targets: tip, alpha: 0, duration: 300 });

        this.time.delayedCall(1900, () =>
        {
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.time.delayedCall(210, () => this.scene.start('Versus', {
                cpuName: this.cpuName, tier: this.tier
            }));
        });
    }

    /** A rating for the name plate that looks like it earned the tier. */
    private cpuRating (): number
    {
        return 700 + this.tier.level * 130 + Math.floor(Math.random() * 90);
    }

    update (_t: number, delta: number): void
    {
        this.fx.update(Math.min(50, delta));
    }
}
