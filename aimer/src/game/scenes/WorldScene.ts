import { Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { boostCount, run, spendBoost } from '../core/state';
import { BOOST_BY_ID } from '../data/boosts';
import { FINAL_LEVEL } from '../data/levels';
import { iconImage } from '../core/icons';
import { offerInterstitial } from '../core/ads';
import { setGameplayActive } from '../core/lifecycle';
import { Doors } from '../objects/Doors';
import { Backdrop } from '../core/backdrop';
import { ZONES, zoneFor } from '../data/zones';
import { rankTitle } from '../data/rank';
import { CX, FONT, FONT_UI, H, LANDSCAPE, PLAY, W, hex, mix } from '../core/theme';

/**
 * The gate between two worlds.
 *
 * There used to be a screen between every single level -- forty stops in a
 * forty level run, each one a fade to a menu, three cards and a fade back.
 * Upgrades come off the rank ladder now, mid-fight, so that screen has nothing
 * left to sell and the run flows straight through from one level into the next.
 *
 * Six times per run, though, the player leaves a place and arrives somewhere
 * else, and *that* is worth stopping for. This is the only stop left, and it is
 * built to be the one the run is remembered by: the new world painted
 * full-screen behind the name of it, the rule that comes with it stated once in
 * plain words, and the seven-stop map of the whole run with the player's
 * position moving along it.
 *
 * Because it is the only stop, it is also the only place an interstitial can
 * land without interrupting anything -- which works out to about one per world
 * rather than one per level, on top of whatever the portal's own pacing allows.
 */

const L = LANDSCAPE
    ? { chapterY: 96, nameY: 142, ruleY: 214, mapY: 322, statY: 400, goY: 500, goW: 300, goH: 74 }
    : { chapterY: 210, nameY: 272, ruleY: 372, mapY: 520, statY: 620, goY: 762, goW: 320, goH: 84 };

export class WorldScene extends Scene
{
    private fx!: Fx;
    private doors!: Doors;
    private backdrop!: Backdrop;
    private going = false;

    constructor ()
    {
        super('World');
    }

    create ()
    {
        this.going = false;

        //  Reading a sign is not playing, and the portal counts it as such.
        setGameplayActive(false);

        const zone = zoneFor(run.level);
        const tier = zone.palette;

        this.cameras.main.setBackgroundColor(tier.bg);

        //  The world itself, running live behind its own name. Nothing else
        //  could say "you are somewhere new" as directly as the place saying it.
        this.backdrop = new Backdrop(this, zone);

        this.fx = new Fx(this, 20);

        //  A scrim, so the sign stays readable over whatever the world is
        //  doing. Above the storm's blackout curtain (depth 8), or the gate to
        //  the storm would black its own name out every few seconds.
        const scrim = this.add.graphics().setDepth(9);
        scrim.fillStyle(tier.bg, 0.62);
        scrim.fillRect(0, 0, W, H);

        this.buildSign(zone.index, zone.name, zone.rule, zone.ruleText, zone.icon, tier.accent, tier.accent2);
        this.buildMap(tier.accent);
        this.buildStats(tier.accent2);
        this.buildGo(tier.accent);
        this.buildSkip(tier.accent);

        //  The doors are already shut when this scene builds: they closed over
        //  the level that just ended, in the scene before this one.
        this.doors = new Doors(this);

        //  The one moment in a run where an ad interrupts nothing at all: the
        //  player is behind a shut door, reading a sign, between two worlds.
        void offerInterstitial()
            .then(() => this.doors.open(340))
            .then(() => this.autoAdvance(tier.accent));
    }

    private buildSign (
        index: number, name: string, rule: string, ruleText: string,
        icon: string, accent: number, accent2: number
    ): void
    {
        const chapter = this.add.text(CX, L.chapterY, `WORLD ${index + 1} OF ${ZONES.length}`, {
            fontFamily: FONT_UI, fontSize: 15, color: '#8d97bd'
        }).setOrigin(0.5).setDepth(10).setAlpha(0);

        this.tweens.add({ targets: chapter, alpha: 1, duration: 300, delay: 120 });

        const title = this.add.text(CX, L.nameY, name, {
            fontFamily: FONT, fontSize: LANDSCAPE ? 52 : 56,
            color: hex(accent), stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setDepth(10).setScale(0.55).setAlpha(0);

        this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 420, ease: 'Back.out' });

        //  The rule, in a plate of its own. A zone still demonstrates itself on
        //  the empty field of its first level -- this is the caption for the
        //  demonstration the player is about to watch, not a replacement for it.
        const plateW = LANDSCAPE ? 460 : 452;
        const plateH = LANDSCAPE ? 84 : 96;
        const plate = this.add.container(CX, L.ruleY).setDepth(10).setAlpha(0);

        const g = this.add.graphics();
        g.fillStyle(0x080c1a, 0.8);
        g.fillRoundedRect(-plateW / 2, -plateH / 2, plateW, plateH, 18);
        g.lineStyle(2, accent2, 0.55);
        g.strokeRoundedRect(-plateW / 2, -plateH / 2, plateW, plateH, 18);
        plate.add(g);

        plate.add(iconImage(this, -plateW / 2 + 46, 0, icon, { size: 34, color: accent2 }));

        plate.add(this.add.text(-plateW / 2 + 82, -14, rule, {
            fontFamily: FONT, fontSize: 24, color: hex(accent2)
        }).setOrigin(0, 0.5));

        plate.add(this.add.text(-plateW / 2 + 82, 16, ruleText, {
            fontFamily: FONT_UI, fontSize: 13, color: '#a8b4d0'
        }).setOrigin(0, 0.5));

        this.tweens.add({ targets: plate, alpha: 1, y: L.ruleY, duration: 340, delay: 220, ease: 'Quad.out' });

        plate.setY(L.ruleY + 26);
    }

    /**
     * The whole run on one line: seven stops, the ones behind lit, the one
     * ahead pulsing, and every one of them in its own world's colour. It is the
     * only place the player ever sees how far a run actually goes.
     */
    private buildMap (accent: number): void
    {
        const y = L.mapY;
        const span = Math.min(W - 100, 430);
        const gap = span / (ZONES.length - 1);
        const x0 = CX - span / 2;

        const g = this.add.graphics().setDepth(10);
        const here = zoneFor(run.level).index;

        g.lineStyle(3, 0x1a2138, 1);
        g.lineBetween(x0, y, x0 + span, y);

        g.lineStyle(3, accent, 0.85);
        g.lineBetween(x0, y, x0 + gap * here, y);

        ZONES.forEach((z, i) =>
        {
            const x = x0 + i * gap;
            const done = i < here;
            const now = i === here;

            g.fillStyle(done || now ? z.palette.accent : 0x2a3352, 1);
            g.fillCircle(x, y, now ? 9 : 6);

            if (now)
            {
                const halo = this.add.circle(x, y, 15, z.palette.accent, 0).setDepth(9);
                halo.setStrokeStyle(2, z.palette.accent, 0.9);
                this.tweens.add({ targets: halo, scale: 1.5, alpha: 0, duration: 1100, repeat: -1 });
            }

            this.add.text(x, y + 22, `${z.from}`, {
                fontFamily: FONT_UI, fontSize: 11,
                color: done || now ? hex(mix(z.palette.accent, 0xffffff, 0.3)) : '#4a5478'
            }).setOrigin(0.5).setDepth(10);
        });
    }

    /** What the player is walking in with: rank, build size, level. */
    private buildStats (accent2: number): void
    {
        const cell = (slot: number, label: string, value: string, color: number) =>
        {
            const x = CX + (slot - 1) * (LANDSCAPE ? 150 : 148);

            this.add.text(x, L.statY, value, {
                fontFamily: FONT, fontSize: 26, color: hex(color)
            }).setOrigin(0.5).setDepth(10);

            this.add.text(x, L.statY + 24, label, {
                fontFamily: FONT_UI, fontSize: 11, color: '#5f6a92'
            }).setOrigin(0.5).setDepth(10);
        };

        cell(0, rankTitle(run.rank), `RANK ${run.rank}`, 0xb388ff);
        cell(1, 'PARTS ON THE GUN', `${run.picks}`, accent2);
        cell(2, 'LEVEL', `${run.level}`, 0xffffff);
    }

    /** The way in. It also goes on its own after a beat, so nothing stalls. */
    private buildGo (accent: number): void
    {
        const btn = this.add.container(CX, L.goY).setDepth(12);
        const g = this.add.graphics();

        g.fillStyle(accent, 0.16);
        g.fillRoundedRect(-L.goW / 2, -L.goH / 2, L.goW, L.goH, 22);
        g.lineStyle(3, accent, 0.95);
        g.strokeRoundedRect(-L.goW / 2, -L.goH / 2, L.goW, L.goH, 22);
        btn.add(g);

        btn.add(this.add.text(0, 0, 'GO IN', {
            fontFamily: FONT, fontSize: 34, color: hex(accent)
        }).setOrigin(0.5));

        btn.setSize(L.goW, L.goH);
        btn.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, L.goW, L.goH),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        this.tweens.add({ targets: btn, scale: 1.035, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        btn.on('pointerdown', () =>
        {
            unlockAudio();
            this.go(accent);
        });

    }

    /**
     * A sign nobody dismissed is still a sign that has been read. Waiting for a
     * tap that may never come is how a gate becomes a wall -- but the count
     * only starts once the doors are actually open, or an ad break would eat
     * the whole reveal before the player ever saw it.
     */
    private autoAdvance (accent: number): void
    {
        this.time.delayedCall(5600, () => this.go(accent));
    }

    /**
     * The level skip, on the one screen where skipping still means something.
     * Pressing it spends one out of the bag and walks straight past the first
     * level of the world -- which is also the one that teaches its rule, so it
     * is deliberately never offered on any other screen.
     */
    private buildSkip (accent: number): void
    {
        const boost = BOOST_BY_ID.skip;

        if (boostCount(boost.id) <= 0 || run.level + 1 >= FINAL_LEVEL) return;

        const w = 186;
        const h = 52;
        const pill = this.add.container(W - w / 2 - 24, LANDSCAPE ? 40 : 52).setDepth(12);
        const g = this.add.graphics();
        pill.add(g);

        const redraw = () =>
        {
            g.clear();
            g.fillStyle(0x0b1024, 0.92);
            g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
            g.lineStyle(2, boost.color, 0.85);
            g.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
        };

        redraw();

        pill.add(iconImage(this, -w / 2 + 30, 0, boost.icon, { size: 24, color: boost.color }));

        const label = this.add.text(-w / 2 + 52, 0, `SKIP x${boostCount(boost.id)}`, {
            fontFamily: FONT, fontSize: 20, color: hex(boost.color)
        }).setOrigin(0, 0.5);

        pill.add(label);

        pill.setSize(w, h);
        pill.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, w, h),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        pill.on('pointerdown', () =>
        {
            unlockAudio();

            if (this.going || run.level + 1 >= FINAL_LEVEL || !spendBoost(boost.id))
            {
                Sfx.dry();
                return;
            }

            run.level += 1;

            Sfx.upgrade();
            this.fx.burst(pill.x, pill.y, boost.color, 22, 'hit');
            this.fx.ring(pill.x, pill.y, 200, boost.color, 5, 420);

            //  Skipping past the first level of a world means skipping the
            //  demonstration of its rule, so the rule is not marked as seen and
            //  the next level in still shows it.
            this.go(accent);
        });
    }

    private go (accent: number): void
    {
        if (this.going) return;

        this.going = true;

        Sfx.levelClear();
        this.cameras.main.flash(180, (accent >> 16) & 0xff, (accent >> 8) & 0xff, accent & 0xff);
        this.fx.ring(CX, (PLAY.top + PLAY.bottom) / 2, 340, accent, 7, 480);

        this.time.delayedCall(160, () =>
        {
            void this.doors.close(260).then(() => this.scene.start('Game'));
        });
    }

    update (_time: number, delta: number): void
    {
        this.fx.update(delta);
        this.backdrop.update(Math.min(50, delta));
    }
}
