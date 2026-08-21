import { GameObjects, Geom, Scene, Tweens } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { addGift, isFirstGift, meta, runsToNextGift, takeGift } from '../core/state';
import { Gift, RARITY, grantGift, reelFor, rollGift } from '../data/gifts';
import { prizeTile, rarityText } from '../objects/PrizeTile';
import { rewardButton } from '../core/adButton';
import { setGameplayActive } from '../core/lifecycle';
import { reportPlatformHappyTime } from '../platform/platform';
import { CX, FONT, FONT_UI, H, LANDSCAPE, W, hex } from '../core/theme';

/**
 * The mystery present.
 *
 * This screen exists for one number: how long a new player stays. A first run
 * that ends on a card of statistics ends the session -- there is nothing on it
 * the player owns and nothing on it they want next. A first run that ends on a
 * wrapped box hands them a face, and the face is on the board for every run
 * after it.
 *
 * So the shape is deliberately the shape of a loot box, and every part of it
 * is doing a job:
 *
 *   the box     -- one tap, made by the player, before anything is revealed.
 *                  The tap is what turns a payout into a prize.
 *   the reel    -- the other prizes go past at speed, on their way to the one
 *                  that stopped. It is the only place the game ever shows the
 *                  player what they do not have yet.
 *   the card    -- lands, names itself, and is already equipped.
 *
 * What comes out is decided in data/gifts, not here, and it is paid out the
 * moment it is rolled -- a player who closes the tab mid-spin still owns it.
 */

const L = LANDSCAPE
    ? {
        headY: 62,
        subY: 102,
        boxY: 300,
        reelY: 300,
        tileW: 108,
        tileH: 128,
        step: 122,
        windowW: Math.min(820, W - 140),
        cardY: 262,
        cardW: 190,
        cardH: 190,
        rarityY: 386,
        nameY: 424,
        blurbY: 462,
        offerY: 528,
        claimY: 630,
        hintY: 690
    }
    : {
        headY: 128,
        subY: 176,
        boxY: 424,
        reelY: 424,
        tileW: 112,
        tileH: 134,
        step: 126,
        windowW: W - 56,
        cardY: 390,
        cardW: 210,
        cardH: 210,
        rarityY: 530,
        nameY: 572,
        blurbY: 614,
        offerY: 692,
        claimY: 818,
        hintY: 902
    };

interface GiftData
{
    /** Scene to return to when the card is claimed. */
    back?: string;
    /** True on a box opened by the rewarded video, so it does not offer again. */
    bonus?: boolean;
}

export class GiftScene extends Scene
{
    private fx!: Fx;
    private back = 'MainMenu';
    private bonus = false;
    private prize!: Gift;
    private leaving = false;

    private head!: GameObjects.Text;
    private sub!: GameObjects.Text;
    private spin?: Tweens.Tween;

    constructor ()
    {
        super('Gift');
    }

    init (data: GiftData)
    {
        this.back = data?.back || 'MainMenu';
        this.bonus = data?.bonus === true;
    }

    create ()
    {
        setGameplayActive(false);

        this.leaving = false;
        this.spin = undefined;

        this.cameras.main.setBackgroundColor(0x0a0718);
        this.cameras.main.fadeIn(220, 0, 0, 0);

        this.fx = new Fx(this, 30);

        this.backdrop();

        //  The present is spent and paid out before a single pixel of it moves.
        //  Everything after this point is theatre over a prize the player
        //  already owns, which is the only way an animation can be skipped,
        //  interrupted or closed without costing them anything.
        const first = isFirstGift();

        //  Nothing to open. Only reachable by a hand-typed scene start, but a
        //  dead-end screen with no way off it would be the worse bug.
        if (!takeGift()) { this.scene.start(this.back); return; }

        this.prize = grantGift(rollGift(first));

        this.head = this.add.text(CX, L.headY, first ? 'YOUR FIRST PRESENT' : 'MYSTERY PRESENT', {
            fontFamily: FONT, fontSize: LANDSCAPE ? 40 : 42, color: '#ffffff',
            stroke: '#000000', strokeThickness: 7
        }).setOrigin(0.5).setDepth(10).setScale(0.5);

        this.tweens.add({ targets: this.head, scale: 1, duration: 340, ease: 'Back.out' });

        this.sub = this.add.text(CX, L.subY, LANDSCAPE ? 'CLICK TO OPEN' : 'TAP TO OPEN', {
            fontFamily: FONT_UI, fontSize: 17, color: '#8d97bd'
        }).setOrigin(0.5).setDepth(10);

        this.tweens.add({ targets: this.sub, alpha: 0.35, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        this.buildPresent();
    }

    /** Grid and a slow drift of light, so the box is not floating on flat black. */
    private backdrop (): void
    {
        const grid = this.add.graphics().setDepth(0);
        grid.lineStyle(1, 0x2a1a4a, 0.45);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        const glow = this.add.graphics().setDepth(1);
        glow.fillStyle(0xffc857, 0.05);
        glow.fillCircle(CX, L.boxY, 250);
        glow.fillStyle(0xffc857, 0.05);
        glow.fillCircle(CX, L.boxY, 160);

        this.tweens.add({ targets: glow, alpha: 0.4, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    //  ------------------------------------------------------------- the box

    private buildPresent (): void
    {
        const box = this.add.container(CX, L.boxY).setDepth(12);

        const BW = 190;
        const BH = 150;
        const LID_H = 42;
        const RIB = 34;
        const top = -(BH + LID_H) / 2;

        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.35);
        shadow.fillEllipse(0, BH / 2 + 26, BW * 1.1, 26);
        box.add(shadow);

        const body = this.add.graphics();
        body.fillStyle(0xff4d6d, 1);
        body.fillRoundedRect(-BW / 2, top + LID_H, BW, BH, 12);
        body.fillStyle(0xffffff, 0.13);
        body.fillRoundedRect(-BW / 2, top + LID_H, BW, BH * 0.34, { tl: 12, tr: 12, bl: 0, br: 0 });
        body.fillStyle(0xffc857, 1);
        body.fillRect(-RIB / 2, top + LID_H, RIB, BH);
        body.lineStyle(3, 0x8f1a33, 0.55);
        body.strokeRoundedRect(-BW / 2, top + LID_H, BW, BH, 12);
        box.add(body);

        //  The lid is its own object because it has somewhere to be later.
        const lid = this.add.container(0, top + LID_H / 2);
        const lidG = this.add.graphics();
        lidG.fillStyle(0xff6b86, 1);
        lidG.fillRoundedRect(-BW / 2 - 10, -LID_H / 2, BW + 20, LID_H, 10);
        lidG.fillStyle(0xffc857, 1);
        lidG.fillRect(-RIB / 2, -LID_H / 2, RIB, LID_H);

        //  Bow: two loops and a knot. Drawn rather than an asset, like the rest
        //  of the game -- see the note at the top of core/icons.
        lidG.fillStyle(0xffc857, 1);
        lidG.fillEllipse(-27, -LID_H / 2 - 18, 48, 34);
        lidG.fillEllipse(27, -LID_H / 2 - 18, 48, 34);
        lidG.fillStyle(0xff4d6d, 1);
        lidG.fillEllipse(-27, -LID_H / 2 - 18, 17, 12);
        lidG.fillEllipse(27, -LID_H / 2 - 18, 17, 12);
        lidG.fillStyle(0xffdd8a, 1);
        lidG.fillCircle(0, -LID_H / 2 - 14, 14);
        lid.add(lidG);
        box.add(lid);

        box.setSize(BW + 60, BH + LID_H + 60);
        box.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, BW + 60, BH + LID_H + 60),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        //  Impatient on its own: bobbing, and shivering every couple of
        //  seconds as though something inside it wants out.
        this.tweens.add({ targets: box, y: L.boxY - 14, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        const shiver = this.time.addEvent({
            delay: 1900,
            loop: true,
            callback: () =>
            {
                this.tweens.add({
                    targets: box, angle: 5, duration: 60, yoyo: true, repeat: 3, ease: 'Sine.inOut',
                    onComplete: () => box.setAngle(0)
                });
                Sfx.chip();
            }
        });

        box.once('pointerdown', () =>
        {
            unlockAudio();
            shiver.remove();
            this.openPresent(box, lid);
        });
    }

    /** The tap: shake, lid off, light out, and the reel takes the screen. */
    private openPresent (box: GameObjects.Container, lid: GameObjects.Container): void
    {
        box.disableInteractive();
        this.tweens.killTweensOf(box);
        this.tweens.killTweensOf(this.sub);

        this.sub.setText('');
        Sfx.launch();

        this.tweens.add({
            targets: box, angle: 9, duration: 52, yoyo: true, repeat: 6, ease: 'Sine.inOut',
            onComplete: () =>
            {
                box.setAngle(0);
                this.burstOpen(box, lid);
            }
        });

        this.tweens.add({ targets: box, scale: 1.16, duration: 420, ease: 'Quad.in' });
    }

    private burstOpen (box: GameObjects.Container, lid: GameObjects.Container): void
    {
        const y = box.y;

        Sfx.unlock();
        Sfx.golden();

        //  The lid leaves first, and the light comes out of the hole it left.
        this.tweens.add({
            targets: lid, y: lid.y - 190, angle: -38, alpha: 0, duration: 620, ease: 'Quad.out'
        });

        const beam = this.add.graphics().setDepth(11);
        beam.fillStyle(0xffe9a8, 0.5);
        beam.fillRect(-70, -420, 140, 420);
        beam.setPosition(CX, y - 30).setScale(0.2, 0.1);

        this.tweens.add({
            targets: beam, scaleX: 1.5, scaleY: 1, alpha: 0, duration: 620, ease: 'Quad.out',
            onComplete: () => beam.destroy()
        });

        this.fx.ring(CX, y - 30, 300, 0xffc857, 7, 520);
        this.fx.burst(CX, y - 30, 0xffc857, 34, 'gold');
        this.fx.burst(CX, y - 30, 0xff4d6d, 22, 'hit');

        this.cameras.main.shake(180, 0.006);

        this.tweens.add({
            targets: box, scale: 0.2, alpha: 0, y: y + 40, duration: 340, delay: 180, ease: 'Back.in',
            onComplete: () => box.destroy()
        });

        this.time.delayedCall(420, () => this.buildReel());
    }

    //  ------------------------------------------------------------ the reel

    private buildReel (): void
    {
        this.head.setText('WHAT IS IN IT');
        this.sub.setText(LANDSCAPE ? 'CLICK TO HURRY' : 'TAP TO HURRY');
        this.sub.setAlpha(0.7);

        const { items, win } = reelFor(this.prize);
        const step = L.step;
        const half = L.windowW / 2;

        const wrap = this.add.container(CX, L.reelY).setDepth(12);
        const strip = this.add.container(0, 0);
        wrap.add(strip);

        items.forEach((gift, i) =>
        {
            const tile = prizeTile(this, gift, L.tileW, L.tileH);
            tile.setPosition(i * step, 0);
            strip.add(tile);
        });

        //  The window the strip runs behind, and the frame around it.
        const frame = this.add.graphics().setDepth(13);
        frame.lineStyle(2, 0x2a3352, 1);
        frame.strokeRoundedRect(CX - half, L.reelY - L.tileH / 2 - 16, L.windowW, L.tileH + 32, 18);

        const maskG = this.make.graphics({ x: 0, y: 0 });
        maskG.fillStyle(0xffffff);
        maskG.fillRoundedRect(CX - half, L.reelY - L.tileH / 2 - 10, L.windowW, L.tileH + 20, 14);
        wrap.setMask(maskG.createGeometryMask());

        //  The marker: the reel stops under this, and it is the only thing on
        //  screen the player has to watch.
        const marker = this.add.graphics().setDepth(14);
        marker.fillStyle(0xffc857, 1);
        marker.fillTriangle(CX - 13, L.reelY - L.tileH / 2 - 26, CX + 13, L.reelY - L.tileH / 2 - 26, CX, L.reelY - L.tileH / 2 - 6);
        marker.fillTriangle(CX - 13, L.reelY + L.tileH / 2 + 26, CX + 13, L.reelY + L.tileH / 2 + 26, CX, L.reelY + L.tileH / 2 + 6);

        //  Never dead centre: a reel that always lands on the middle of a tile
        //  looks decided rather than spun.
        const jitter = (Math.random() * 2 - 1) * step * 0.26;
        const target = -(win * step) + jitter;

        let lastTile = 0;
        let lastTickAt = 0;

        this.spin = this.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 3600,
            ease: 'Quint.out',
            onUpdate: (tw: any) =>
            {
                const v = tw.getValue() as number;

                strip.x = target * v;

                const tile = Math.floor(-strip.x / step);

                //  One click per tile, but never more than one every 55ms: at
                //  full speed the strip crosses several tiles a frame, and an
                //  unthrottled tick is a buzz rather than a reel.
                if (tile !== lastTile)
                {
                    lastTile = tile;

                    if (this.time.now - lastTickAt >= 55)
                    {
                        lastTickAt = this.time.now;
                        Sfx.chip();
                    }
                }
            },
            onComplete: () =>
            {
                this.spin = undefined;

                //  A short settle, so it stops like a wheel rather than like a
                //  variable being assigned.
                this.tweens.add({
                    targets: strip, x: strip.x + 7, duration: 130, yoyo: true, ease: 'Sine.inOut',
                    onComplete: () => this.reveal(wrap, frame, marker)
                });
            }
        });

        //  Impatience is a feature: tapping speeds the reel up rather than
        //  skipping it, so the player who wants the prize now still sees one.
        this.input.on('pointerdown', () =>
        {
            if (this.spin) this.spin.timeScale = 3.2;
        });
    }

    //  ---------------------------------------------------------- the reveal

    private reveal (wrap: GameObjects.Container, frame: GameObjects.Graphics, marker: GameObjects.Graphics): void
    {
        this.input.off('pointerdown');

        const gift = this.prize;
        const tone = RARITY[gift.rarity].color;

        this.tweens.add({
            targets: [ wrap, frame, marker ], alpha: 0, duration: 260, ease: 'Quad.out',
            onComplete: () => { wrap.destroy(); frame.destroy(); marker.destroy(); }
        });

        this.head.setText('YOU GOT');
        this.sub.setText('');

        this.time.delayedCall(220, () =>
        {
            const card = prizeTile(this, gift, L.cardW, L.cardH, { bare: true });
            card.setPosition(CX, L.cardY).setDepth(14).setScale(0.2);

            this.tweens.add({ targets: card, scale: 1, duration: 420, ease: 'Back.out' });
            this.tweens.add({
                targets: card, angle: 2, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: 420
            });

            rarityText(this, CX, L.rarityY, gift, 18).setDepth(14);

            const name = this.add.text(CX, L.nameY, gift.name, {
                fontFamily: FONT, fontSize: LANDSCAPE ? 34 : 38, color: hex(gift.color),
                stroke: '#000000', strokeThickness: 6, align: 'center',
                wordWrap: { width: W - 80 }
            }).setOrigin(0.5).setDepth(14).setScale(0.6);

            this.tweens.add({ targets: name, scale: 1, duration: 300, ease: 'Back.out' });

            this.add.text(CX, L.blurbY, this.footnote(gift), {
                fontFamily: FONT_UI, fontSize: 15, color: '#8d97bd', align: 'center',
                wordWrap: { width: W - 90 }
            }).setOrigin(0.5).setDepth(14);

            this.celebrate(tone, gift.rarity === 'legendary');
            this.buildFooter();

            void reportPlatformHappyTime(gift.rarity === 'legendary' ? 1 : 0.75);
        });
    }

    /** The line under it -- and, for a skin, the fact that it is already on. */
    private footnote (gift: Gift): string
    {
        if (gift.kind === 'skin') return `${gift.sub}  ·  NOW ON YOUR TARGETS`;
        if (gift.kind === 'boost') return `${gift.sub}  ·  IN YOUR BAG`;

        return gift.sub;
    }

    private celebrate (tone: number, big: boolean): void
    {
        if (big) Sfx.jackpot();
        else Sfx.milestone(2);

        const rounds = big ? 7 : 4;

        for (let i = 0; i < rounds; i++)
        {
            this.time.delayedCall(i * 140, () =>
            {
                const x = 60 + Math.random() * (W - 120);
                const y = L.cardY - 90 + Math.random() * 150;

                this.fx.burst(x, y, i % 2 === 0 ? tone : 0xffd23f, big ? 26 : 18, 'gold');
            });
        }

        this.fx.ring(CX, L.cardY, 320, tone, 6, 520);
    }

    //  ---------------------------------------------------------- the footer

    private buildFooter (): void
    {
        //  One more box, for a video, and only ever one: an unlimited supply of
        //  presents would be a better shop than the shop. Declining costs the
        //  player nothing, which is the whole rule for a rewarded ad.
        const offer = this.bonus ? null : rewardButton(this, CX, L.offerY, {
            label: 'OPEN ANOTHER',
            color: 0xb388ff,
            icon: 'videoDice',
            onReward: () =>
            {
                addGift(1);
                this.cameras.main.fadeOut(160, 0, 0, 0);
                this.time.delayedCall(180, () => this.scene.restart({ back: this.back, bonus: true }));
            }
        });

        const claimY = offer ? L.claimY : L.offerY + 40;

        this.claimButton(CX, claimY);

        this.add.text(CX, L.hintY, this.nextLine(), {
            fontFamily: FONT_UI, fontSize: 14, color: '#5f6a92'
        }).setOrigin(0.5).setDepth(14);
    }

    /**
     * The hook. A present the player has just opened is worth far more as a
     * promise of the next one, so the card never closes without saying how
     * many runs away that is.
     */
    private nextLine (): string
    {
        if (meta.gifts > 0) return `${meta.gifts} MORE PRESENT${meta.gifts === 1 ? '' : 'S'} WAITING`;

        const runs = runsToNextGift();

        return `NEXT PRESENT IN ${runs} RUN${runs === 1 ? '' : 'S'}`;
    }

    private claimButton (x: number, y: number): void
    {
        const w = 320;
        const h = 92;
        const btn = this.add.container(x, y).setDepth(15);

        const g = this.add.graphics();
        g.fillStyle(0x6cf5c8, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 24);
        g.fillStyle(0xffffff, 0.18);
        g.fillRoundedRect(-w / 2, -h / 2, w, h * 0.42, { tl: 24, tr: 24, bl: 0, br: 0 });
        btn.add(g);

        btn.add(this.add.text(0, 0, 'AWESOME', {
            fontFamily: FONT, fontSize: 40, color: '#06101f'
        }).setOrigin(0.5));

        btn.setSize(w, h);
        btn.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, w, h),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        btn.setScale(0.2);
        this.tweens.add({ targets: btn, scale: 1, duration: 320, ease: 'Back.out' });

        btn.on('pointerdown', () =>
        {
            unlockAudio();
            Sfx.ui();
            this.tweens.add({ targets: btn, scale: 0.92, duration: 80, yoyo: true, onComplete: () => this.leave() });
        });
    }

    private leave (): void
    {
        if (this.leaving) return;

        this.leaving = true;
        this.cameras.main.fadeOut(180, 0, 0, 0);
        this.time.delayedCall(190, () => this.scene.start(this.back));
    }

    update (_time: number, delta: number): void
    {
        this.fx.update(Math.min(50, delta));
    }
}
