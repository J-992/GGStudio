import { Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, isMuted, toggleMute, unlockAudio } from '../core/audio';
import {
    armRun, boostCount, equippedSkin, giftsPending, isArmed, meta, run, runsToNextGift, saveMeta, toggleArmed
} from '../core/state';
import { setGameplayActive } from '../core/lifecycle';
import { FINAL_LEVEL } from '../data/levels';
import { RUN_BOOSTS } from '../data/boosts';
import { fillBody, strokeBody } from '../core/shapes';
import { ic, iconImage } from '../core/icons';
import { StorePanel } from '../objects/StorePanel';
import { CX, FONT, FONT_UI, H, LANDSCAPE, W, fmt, hex, mix } from '../core/theme';

const DEMO_COLORS = [ 0x3fe0ff, 0xff5ce0, 0x7dff6b, 0xffd23f, 0x9b6cff ];

/**
 * Portrait stacks the menu; a wide screen splits it in two -- the game on the
 * left, the store on the right -- rather than stretching one narrow column
 * across a screen three times wider than it needs.
 */
const L = LANDSCAPE
    ? {
        gameX: W * 0.28,
        storeX: W * 0.72,
        titleY: 168,
        taglineY: 222,
        playY: 318,
        statY: 428,
        loadoutY: 534,
        storeHeaderY: 92,
        tabsY: 146,
        rowY0: 210,
        rowStep: 74,
        rowW: 440,
        rowH: 62,
        listBottom: H - 62,
        muteX: W - 34,
        muteY: H - 34
    }
    : {
        gameX: CX,
        storeX: CX,
        titleY: 92,
        taglineY: 142,
        playY: 216,
        statY: 286,
        loadoutY: 380,
        storeHeaderY: 432,
        tabsY: 474,
        rowY0: 534,
        rowStep: 70,
        rowW: 464,
        rowH: 60,
        listBottom: H - 34,
        muteX: W - 30,
        muteY: H - 34
    };

export class MainMenu extends Scene
{
    private fx!: Fx;
    private store!: StorePanel;
    private chips: { redraw: () => void }[] = [];

    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        //  The menu is where a run ends as often as it starts, so the report is
        //  made here rather than trusting every exit path to have made it.
        setGameplayActive(false);

        this.chips = [];
        this.cameras.main.setBackgroundColor(0x080b1c);
        this.cameras.main.fadeIn(200, 0, 0, 0);

        this.fx = new Fx(this, 20);

        const grid = this.add.graphics().setDepth(0);
        grid.lineStyle(1, 0x1b2a5e, 0.4);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        this.spawnDemoTargets();

        const title = this.add.text(L.gameX, L.titleY, 'AIMER', {
            fontFamily: FONT, fontSize: 92, color: '#ffffff', stroke: '#3fe0ff', strokeThickness: 8
        }).setOrigin(0.5).setDepth(10);

        this.tweens.add({ targets: title, scale: 1.04, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        this.add.text(L.gameX, L.taglineY, `${LANDSCAPE ? 'CLICK' : 'TAP'} TARGETS  ·  BUILD COMBOS  ·  GET STRONG`, {
            fontFamily: FONT_UI, fontSize: 15, color: '#7d88b0'
        }).setOrigin(0.5).setDepth(10);

        this.buildPlayButton();
        this.buildStats();
        this.buildLoadout();
        this.buildGiftBadge();

        this.store = new StorePanel(this, this.fx, {
            x: L.storeX,
            headerY: L.storeHeaderY,
            tabsY: L.tabsY,
            rowY0: L.rowY0,
            rowStep: L.rowStep,
            rowW: L.rowW,
            rowH: L.rowH,
            listBottom: L.listBottom
        }, () => this.refreshLoadout(), () => this.startRun());

        //  Restore the saved mute preference on first boot.
        if (meta.muted && !isMuted())
        {
            unlockAudio();
            toggleMute();
        }

        const mute = iconImage(this, L.muteX, L.muteY, isMuted() ? 'soundOff' : 'soundOn', {
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

    /**
     * The drifting targets behind the menu wear whatever skin the player is
     * wearing -- the shop window for the thing they just bought is the screen
     * they bought it on.
     */
    private demoTarget (): void
    {
        const skin = equippedSkin();
        const base = DEMO_COLORS[Math.floor(Math.random() * DEMO_COLORS.length)];
        const paint = skin.tint ? skin.tint({ color: base, ring: 0xffffff }) : { color: base, ring: mix(base, 0xffffff, 0.6) };
        const r = 18 + Math.random() * 14;
        const x = 40 + Math.random() * (W - 80);
        const y = 210 + Math.random() * (H - 340);

        const dot = this.add.container(x, y).setDepth(1);
        const g = this.add.graphics();

        g.fillStyle(paint.color, 0.24 * skin.glow);
        fillBody(g, skin.shape, r, 0);
        g.lineStyle(3, paint.ring, 0.55);
        strokeBody(g, skin.shape, r, 0);

        dot.add(g);
        dot.setScale(0.1);

        dot.setInteractive({
            hitArea: new Geom.Circle(0, 0, r * 1.4),
            hitAreaCallback: Geom.Circle.Contains,
            useHandCursor: true
        });

        this.tweens.add({ targets: dot, scale: 1, duration: 240, ease: 'Back.out' });

        if (skin.spin !== 0)
        {
            this.tweens.add({
                targets: dot,
                rotation: dot.rotation + Math.PI * 2 * Math.sign(skin.spin),
                duration: Math.max(1200, (Math.PI * 2 / Math.abs(skin.spin)) * 1000),
                repeat: -1
            });
        }

        dot.on('pointerdown', () =>
        {
            unlockAudio();
            Sfx.hit(3);

            if (!dot.active) return;

            this.fx.burst(dot.x, dot.y, paint.color, 10, 'hit');
            dot.destroy();
        });

        this.tweens.add({
            targets: dot, alpha: 0, scale: 0.4, duration: 700, delay: 2400 + Math.random() * 1600,
            onComplete: () => dot.destroy()
        });
    }

    private buildPlayButton (): void
    {
        const btn = this.add.container(L.gameX, L.playY).setDepth(11);

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

            this.startRun();
        });
    }

    /**
     * The one way into a run. The PLAY button uses it, and so does the button
     * on the card a bought skin puts up -- a player who has just been told to
     * go and try something out must land in exactly the run PLAY would have
     * given them, loadout and all.
     */
    private startRun (): void
    {
        run.reset();

        //  The armed boosts are spent here and nowhere else: a player who
        //  opens the store and walks away has lost nothing.
        armRun();

        this.cameras.main.fadeOut(190, 0, 0, 0);
        this.time.delayedCall(200, () => this.scene.start('Game'));
    }

    private buildStats (): void
    {
        const stat = (slot: number, label: string, value: string, color: number) =>
        {
            const x = L.gameX + slot * 160;

            this.add.text(x, L.statY, value, {
                fontFamily: FONT, fontSize: 26, color: hex(color)
            }).setOrigin(0.5).setDepth(10);

            this.add.text(x, L.statY + 26, label, {
                fontFamily: FONT_UI, fontSize: 12, color: '#5f6a92'
            }).setOrigin(0.5).setDepth(10);
        };

        stat(-1, 'BEST SCORE', fmt(meta.best), 0xffffff);
        stat(0, 'BEST LEVEL', `${meta.bestLevel}/${FINAL_LEVEL}`, 0x6cf5c8);
        stat(1, 'TOTAL XP', fmt(meta.rank), 0x9b6cff);
    }

    /**
     * The loadout: one chip per run boost, sitting directly under PLAY where
     * the player is already looking. A chip they own is a switch -- armed goes
     * into the next run and is spent by it; a chip they do not own is still
     * drawn, dim, because an empty shelf sells nothing.
     */
    private buildLoadout (): void
    {
        const y = L.loadoutY;
        const w = 64;
        const gap = 10;
        const total = RUN_BOOSTS.length * w + (RUN_BOOSTS.length - 1) * gap;
        const x0 = L.gameX - total / 2 + w / 2;

        this.add.text(L.gameX, y - 44, 'RUN BOOSTS', {
            fontFamily: FONT_UI, fontSize: 12, color: '#5f6a92'
        }).setOrigin(0.5).setDepth(10);

        RUN_BOOSTS.forEach((boost, i) =>
        {
            const cx = x0 + i * (w + gap);
            const chip = this.add.container(cx, y).setDepth(11);

            const g = this.add.graphics();
            chip.add(g);

            const icon = iconImage(this, 0, -6, boost.icon, { size: 26, color: boost.color });
            chip.add(icon);

            const count = this.add.text(0, 17, '', {
                fontFamily: FONT, fontSize: 14, color: '#ffffff'
            }).setOrigin(0.5);
            chip.add(count);

            const redraw = () =>
            {
                const n = boostCount(boost.id);
                const armed = isArmed(boost.id);

                g.clear();
                g.fillStyle(0x0b1024, 0.92);
                g.fillRoundedRect(-w / 2, -28, w, 56, 14);

                if (armed)
                {
                    g.fillStyle(boost.color, 0.22);
                    g.fillRoundedRect(-w / 2, -28, w, 56, 14);
                }

                g.lineStyle(2, n > 0 ? boost.color : 0x2a3352, armed ? 1 : 0.6);
                g.strokeRoundedRect(-w / 2, -28, w, 56, 14);

                icon.setAlpha(n > 0 ? 1 : 0.3);
                count.setText(n > 0 ? (armed ? `ARMED x${n}` : `x${n}`) : 'NONE');
                count.setFontSize(n > 0 && armed ? 10 : 13);
                count.setColor(armed ? hex(boost.color) : (n > 0 ? '#8d97bd' : '#3c4569'));
            };

            redraw();
            this.chips.push({ redraw });

            chip.setSize(w, 56);
            chip.setInteractive({
                hitArea: new Geom.Rectangle(0, 0, w, 56),
                hitAreaCallback: Geom.Rectangle.Contains,
                useHandCursor: true
            });

            chip.on('pointerdown', () =>
            {
                unlockAudio();

                if (boostCount(boost.id) <= 0)
                {
                    //  Nothing to arm -- so the tap goes where the player can
                    //  do something about it, and says which row to look at.
                    Sfx.dry();
                    this.fx.popup(chip.x, chip.y - 42, 'BUY IN STORE', boost.color, 15, 30, 700);
                    return;
                }

                const on = toggleArmed(boost.id);

                Sfx.ui();
                redraw();

                this.tweens.add({ targets: chip, scale: on ? 1.12 : 0.94, duration: 110, yoyo: true, ease: 'Quad.out' });

                if (on) this.fx.ring(chip.x, chip.y, 90, boost.color, 4, 340);
            });
        });
    }

    private refreshLoadout (): void
    {
        for (const chip of this.chips) chip.redraw();
    }

    /**
     * The present, in the corner, at all times.
     *
     * Waiting or not, it is on the menu -- a reward the player cannot see
     * coming is a reward that does not pull anybody back into a second run.
     * So when there is nothing to open the badge still says how many runs
     * away the next one is, and the counter is the hook.
     */
    private buildGiftBadge (): void
    {
        const x = 60;
        const y = LANDSCAPE ? 52 : 58;
        const w = 98;
        const h = 70;
        const ready = giftsPending() > 0;
        const left = runsToNextGift();
        const tone = ready ? 0xffc857 : 0x2a3352;

        const chip = this.add.container(x, y).setDepth(13);

        const g = this.add.graphics();
        g.fillStyle(0x0b1024, 0.92);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);

        if (ready)
        {
            g.fillStyle(0xffc857, 0.18);
            g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
        }

        g.lineStyle(2, tone, ready ? 1 : 0.7);
        g.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
        chip.add(g);

        const icon = iconImage(this, 0, -9, 'gift', {
            size: 30, color: ready ? 0xffc857 : 0x5f6a92, alpha: ready ? 1 : 0.55
        });
        chip.add(icon);

        chip.add(this.add.text(0, 20, ready ? 'OPEN!' : `IN ${left}`, {
            fontFamily: FONT, fontSize: ready ? 15 : 14, color: ready ? '#ffc857' : '#5f6a92'
        }).setOrigin(0.5));

        chip.setSize(w, h);
        chip.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, w, h),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        if (ready)
        {
            this.tweens.add({ targets: chip, scale: 1.07, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
            this.tweens.add({ targets: icon, angle: 8, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

            this.time.addEvent({
                delay: 1700,
                loop: true,
                callback: () => this.fx.ring(chip.x, chip.y, 150, 0xffc857, 4, 460)
            });
        }

        chip.on('pointerdown', () =>
        {
            unlockAudio();

            if (!ready)
            {
                //  Nothing to open, so the tap answers the only question the
                //  badge raises rather than doing nothing at all.
                Sfx.dry();
                this.fx.popup(chip.x, chip.y + 54, `${left} RUN${left === 1 ? '' : 'S'} TO GO`, 0xffc857, 15, 26, 800);
                return;
            }

            Sfx.upgrade();
            this.cameras.main.fadeOut(180, 0, 0, 0);
            this.time.delayedCall(190, () => this.scene.start('Gift'));
        });
    }

    update (_time: number, delta: number): void
    {
        const dt = Math.min(50, delta);

        this.fx.update(dt);
        this.store.tick(dt);
    }
}
