import { GameObjects, Scene } from 'phaser';
import { Target } from '../objects/Target';
import { Turret } from '../objects/Turret';
import { Doors } from '../objects/Doors';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { KINDS, TargetKind } from '../data/levels';
import { Stats } from '../data/upgrades';
import { BeamLook, GunLook, beamLook, gunLook, kickOf } from '../data/gunkit';
import { bankCoins, equippedSkin, meta, run, saveMeta } from '../core/state';
import { setGameplayActive } from '../core/lifecycle';
import { reportPlatformHappyTime } from '../platform/platform';
import { IconLabel, iconImage } from '../core/icons';
import { BonusConfig, bonusConfig, cashMult, cashScale, pickMoney } from '../data/bonus';
import { styleOf } from '../data/skins';
import { isZoneStart } from '../data/zones';
import { CX, FONT, FONT_UI, H, HUD, PLAY, Tier, W, fmt, hex } from '../core/theme';
import { Wingman } from '../objects/Wingman';
import {
    ABILITIES, AbilityBanner, AbilityId, BOMB_RADIUS, BOMB_RATE, Bolts, MAYHEM_BOLTS, MAYHEM_RATE, SENTRY_RATE, bombImpact, drawLaser, laserPath, lobShell,
    sprayDirs
} from '../core/abilities';

function distToSegment (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number
{
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = dx * dx + dy * dy;
    let t = len === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/**
 * The vault: a few seconds of pure money between two levels.
 *
 * It is deliberately not a level. There is no goal bar, no way to lose the run
 * and no bomb to punish a wild tap -- everything the play HUD spends its space
 * on is about risk, and there is none of that here. What is on screen instead
 * is the one number the round is about, as large as it will go, climbing.
 *
 * What there *is* is a clock, and it is the whole round: money you shoot is
 * yours the instant you shoot it, and money still standing when the clock
 * stops is gone. Nothing is cashed out at the end -- a round that paid for the
 * shots you did not take would have no reason to be played fast.
 */

/** Gold on green. The one place in the run that is neither a zone nor a menu. */
const VAULT: Tier = {
    bg: 0x04140c,
    grid: 0x0d5230,
    accent: 0xffd23f,
    accent2: 0x5fe08a,
    dust: 0xffd23f
};

/** Where flying coins land -- the same counter the play HUD uses. */
const COIN_HUD = { x: W - HUD.margin - 14, y: HUD.levelY };

/** Milliseconds between each unshot bill blowing away when time runs out. */
const SWEEP_STAGGER = 55;

interface Bill
{
    img: GameObjects.Image;
    vy: number;
    spin: number;
    sway: number;
    phase: number;
}

function arenaY (t: number): number
{
    return PLAY.top + (PLAY.bottom - PLAY.top) * t;
}

export class BonusScene extends Scene
{
    private cfg!: BonusConfig;
    private stats!: Stats;
    private look!: GunLook;
    private beam!: BeamLook;
    private beam2!: BeamLook;

    private fx!: Fx;
    private doors!: Doors;
    private turret!: Turret;

    private targets: Target[] = [];
    private state: 'intro' | 'play' | 'done' = 'intro';

    private timeLeft = 0;
    private timeTotal = 0;
    private spawnTimer = 0;
    private nextShot = 0;

    private kills = 0;
    private mult = 1;
    /**
     * A weapon carried in from the level before. It finishes its clock here
     * -- money is the best thing in the game to point a machine gun at.
     */
    private ability: AbilityId | null = null;
    private abilityLeft = 0;
    private abilityBanner!: AbilityBanner;
    private laserGfx!: GameObjects.Graphics;
    private bolts!: Bolts;
    private sentries: Wingman[] = [];
    private sentryTimer = 0;
    private earned = 0;
    private earnedShown = 0;
    private coinsDisplay = 0;

    //  Dressing
    private rays!: GameObjects.Graphics;
    private raySpin = 0;
    private bills: Bill[] = [];

    //  HUD
    private hudGfx!: GameObjects.Graphics;
    private coinLabel!: IconLabel;
    private totalText!: GameObjects.Text;
    private multText!: GameObjects.Text;

    constructor ()
    {
        super('Bonus');
    }

    create ()
    {
        this.cfg = bonusConfig(run.level);
        this.stats = run.stats();
        this.look = gunLook(run.taken, meta.perks);
        this.beam = beamLook(this.look, VAULT);
        this.beam2 = beamLook(this.look, VAULT, true);

        this.targets = [];
        this.state = 'intro';
        this.timeTotal = this.cfg.duration * 1000;
        this.timeLeft = this.timeTotal;
        this.spawnTimer = 0;
        this.nextShot = 0;
        this.kills = 0;
        this.mult = 1;
        this.earned = 0;
        this.earnedShown = 0;
        this.coinsDisplay = meta.coins;
        this.bills = [];
        this.raySpin = 0;
        this.ability = null;
        this.abilityLeft = 0;
        this.sentries = [];
        this.sentryTimer = 0;

        this.cameras.main.setBackgroundColor(VAULT.bg);

        this.buildVault();
        this.fx = new Fx(this, 20);
        this.buildHud();

        this.laserGfx = this.add.graphics().setDepth(26).setBlendMode('ADD');
        this.bolts = new Bolts(this, 26);
        this.abilityBanner = new AbilityBanner(this);

        if (run.ability)
        {
            this.resumeAbility(run.ability.id, run.ability.left);
            run.ability = null;
        }

        //  Money is already standing when the doors part. An empty vault on the
        //  reveal would waste the best frame of the round.
        for (let i = 0; i < Math.min(4, this.cfg.maxActive); i++) this.spawn();

        this.input.on('pointerdown', (p: Phaser.Input.Pointer) =>
        {
            unlockAudio();
            if (this.state !== 'play') return;
            if (p.y < PLAY.top - 16 || p.y > PLAY.bottom + 6) return;
            this.shoot(p.x, p.y);
        });

        //  The doors are already shut: they closed over the level that just
        //  ended, in the scene before this one.
        this.doors = new Doors(this);

        void this.doors.open(320).then(() => this.announce());

        this.events.once('shutdown', () => setGameplayActive(false));
    }

    //  ---------------------------------------------------------------- intro

    /** The vault names itself once, over money that is already on the table. */
    private announce (): void
    {
        Sfx.jackpot();
        this.cameras.main.flash(280, 255, 210, 90);
        this.fx.ring(CX, arenaY(0.42), Math.max(W, H) * 0.55, 0xffd23f, 8, 620);

        const title = this.add.text(CX, arenaY(0.34), 'CASH ROUND', {
            fontFamily: FONT, fontSize: 62, color: hex(0xffd23f), stroke: '#000000', strokeThickness: 9
        }).setOrigin(0.5).setDepth(36).setScale(0.3);

        const sub = this.add.text(CX, arenaY(0.44), 'SHOOT THE MONEY', {
            fontFamily: FONT, fontSize: 24, color: hex(0x5fe08a)
        }).setOrigin(0.5).setDepth(36).setAlpha(0);

        this.tweens.add({ targets: title, scale: 1.05, duration: 260, ease: 'Back.out' });
        this.tweens.add({ targets: sub, alpha: 1, duration: 200, delay: 160 });

        this.tweens.add({
            targets: [ title, sub ],
            alpha: 0,
            scale: 1.5,
            duration: 300,
            delay: 620,
            ease: 'Quad.in',
            onComplete: () => { title.destroy(); sub.destroy(); }
        });

        //  A shower of bills off the top on the reveal, so the round opens with
        //  money falling before a single shot is fired.
        for (let i = 0; i < 18; i++) this.dropBill(true);

        this.time.delayedCall(760, () => this.begin());
    }

    private begin (): void
    {
        if (this.state !== 'intro') return;

        this.state = 'play';

        //  The money behind the doors has been ageing on screen; the clock
        //  starting is the first moment its timer is real.
        for (const t of this.targets) t.setLifetime(t.maxLife);

        setGameplayActive(true);

        void reportPlatformHappyTime(0.85);
    }

    //  ------------------------------------------------------------- dressing

    /**
     * The vault, in three cheap layers: a grid, a slow gold star of light
     * behind everything, and bills falling through it the whole time.
     */
    private buildVault (): void
    {
        const grid = this.add.graphics().setDepth(0);

        grid.lineStyle(1, VAULT.grid, 0.4);
        for (let x = 0; x <= W; x += 58) grid.lineBetween(x, 0, x, H);
        for (let y = 0; y <= H; y += 58) grid.lineBetween(0, y, W, y);

        this.rays = this.add.graphics().setDepth(1);
    }

    private drawRays (dt: number): void
    {
        this.raySpin += dt * 0.00016;

        const g = this.rays;
        const cx = CX;
        const cy = arenaY(0.42);
        const reach = Math.max(W, H);

        g.clear();

        for (let i = 0; i < 12; i++)
        {
            const a = this.raySpin + (i * Math.PI * 2) / 12;
            const w = 0.09 + Math.sin(this.time.now * 0.001 + i) * 0.02;

            g.fillStyle(0xffd23f, 0.045);
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(cx + Math.cos(a - w) * reach, cy + Math.sin(a - w) * reach);
            g.lineTo(cx + Math.cos(a + w) * reach, cy + Math.sin(a + w) * reach);
            g.closePath();
            g.fillPath();
        }

        //  A pool of light on the floor of the vault, breathing with the ramp.
        g.fillStyle(0x5fe08a, 0.05 + this.mult * 0.012);
        g.fillEllipse(cx, cy, W * 0.9, (PLAY.bottom - PLAY.top) * 0.8);
    }

    /** One falling bill. `seeded` scatters it down the screen instead of above it. */
    private dropBill (seeded = false): void
    {
        const gold = Math.random() < 0.45;
        const size = 16 + Math.random() * 20;

        const img = iconImage(this, PLAY.left + Math.random() * (PLAY.right - PLAY.left), 0, gold ? 'coins' : 'dollar', {
            size,
            color: gold ? 0xffd23f : 0x5fe08a,
            alpha: 0.16 + Math.random() * 0.24
        });

        img.setDepth(2);
        img.setY(seeded ? Math.random() * H : -30 - Math.random() * 200);
        img.setAngle(Math.random() * 360);

        this.bills.push({
            img,
            vy: 40 + Math.random() * 120,
            spin: (Math.random() - 0.5) * 120,
            sway: 8 + Math.random() * 26,
            phase: Math.random() * Math.PI * 2
        });
    }

    private updateBills (dt: number): void
    {
        //  The rain thickens as the multiplier climbs -- the screen itself is
        //  part of the payout readout.
        const want = 14 + this.mult * 6;

        if (this.bills.length < want && Math.random() < 0.4) this.dropBill();

        for (let i = this.bills.length - 1; i >= 0; i--)
        {
            const b = this.bills[i];

            b.img.y += b.vy * (dt / 1000);
            b.img.angle += b.spin * (dt / 1000);
            b.img.x += Math.sin(this.time.now * 0.002 + b.phase) * b.sway * (dt / 1000);

            if (b.img.y > H + 40)
            {
                if (this.bills.length > want)
                {
                    b.img.destroy();
                    this.bills.splice(i, 1);
                }
                else
                {
                    b.img.setY(-30 - Math.random() * 120);
                    b.img.setX(PLAY.left + Math.random() * (PLAY.right - PLAY.left));
                }
            }
        }
    }

    //  ------------------------------------------------------------------ HUD

    private buildHud (): void
    {
        this.hudGfx = this.add.graphics().setDepth(30);

        this.coinLabel = new IconLabel(this, W - HUD.margin, COIN_HUD.y, 'gem', fmt(meta.coins), {
            align: 'right', fontSize: 24, iconSize: 22
        });
        this.coinLabel.setDepth(31);

        this.add.text(HUD.margin - 4, COIN_HUD.y, 'CASH ROUND', {
            fontFamily: FONT_UI, fontSize: 16, color: hex(0x5fe08a)
        }).setOrigin(0, 0.5).setDepth(31);

        //  The only number this round is about, in the slot the score usually
        //  occupies and twice as loud.
        this.totalText = this.add.text(CX, HUD.scoreY, '$0', {
            fontFamily: FONT, fontSize: HUD.scoreSize + 6, color: hex(0xffd23f), stroke: '#000000', strokeThickness: 7
        }).setOrigin(0.5).setDepth(31);

        this.multText = this.add.text(CX, HUD.comboY, '', {
            fontFamily: FONT, fontSize: 30, color: hex(0x5fe08a), stroke: '#000000', strokeThickness: 5
        }).setOrigin(0.5).setDepth(31);

        this.turret = new Turret(this, VAULT, this.look);
    }

    private drawHud (): void
    {
        const g = this.hudGfx;
        g.clear();

        const tf = Math.max(0, this.timeLeft / this.timeTotal);
        const low = this.timeLeft < 2200 && this.state === 'play';
        const pulse = low ? 0.7 + Math.abs(Math.sin(this.time.now * 0.014)) * 0.3 : 0.95;

        const left = HUD.margin - 4;
        const span = HUD.barRight - left;

        g.fillStyle(0x000000, 0.45);
        g.fillRoundedRect(left, HUD.barY, span, HUD.barH, HUD.barH / 2);

        if (tf > 0.001)
        {
            g.fillStyle(low ? 0xff9d3d : 0xffd23f, pulse);
            g.fillRoundedRect(left + 2, HUD.barY + 2, Math.max(20, (span - 4) * tf), HUD.barH - 4, 9);
        }

        //  A gold wash over the whole arena as the last seconds burn -- the
        //  opposite signal to the red one a level ending gives.
        if (low)
        {
            g.fillStyle(0xffd23f, 0.04 + Math.abs(Math.sin(this.time.now * 0.012)) * 0.06);
            g.fillRect(0, 0, W, H);
        }
    }

    //  ------------------------------------------------------------- spawning

    private freeSpot (radius: number): { x: number; y: number }
    {
        let best = { x: CX, y: arenaY(0.5) };
        let bestDist = -1;

        for (let attempt = 0; attempt < 12; attempt++)
        {
            const x = PLAY.left + radius + Math.random() * Math.max(1, (PLAY.right - PLAY.left) - radius * 2);
            const y = PLAY.top + radius + Math.random() * Math.max(1, (PLAY.bottom - PLAY.top) - radius * 2);

            let min = 99999;

            for (const t of this.targets) min = Math.min(min, t.distanceTo(x, y) - t.radius - radius);

            if (min > bestDist) { bestDist = min; best = { x, y }; }
            if (min > 24) break;
        }

        return best;
    }

    private spawn (): void
    {
        const kind: TargetKind = pickMoney(this.cfg.weights);
        const def = KINDS[kind];
        const radius = this.cfg.size * def.sizeMult;
        const spot = this.freeSpot(radius);
        const moving = Math.random() < this.cfg.moveChance;

        //  The money keeps its own colours and its own glyph -- it has to read
        //  as money -- but it is cut in the shape the player paid for.
        const t = new Target(this, spot.x, spot.y, kind, this.cfg.size, run.level, this.cfg.speed, moving,
            undefined, styleOf(equippedSkin(), false));

        t.setLifetime(this.cfg.lifetime);
        t.setDepth(10);

        this.targets.push(t);

        //  Money arrives the way money should: dropped in, with a coin ring.
        this.fx.ring(spot.x, spot.y, radius * 2.2, def.color, 2, 240);
    }

    //  --------------------------------------------------------------- combat

    private shoot (px: number, py: number): void
    {
        if (this.time.now < this.nextShot) return;

        this.nextShot = this.time.now + this.fireRate;

        if (this.ability === 'laser') return;
        if (this.ability === 'mayhem') { this.shootMayhem(px, py); return; }
        if (this.ability === 'bomb') { this.shootBomb(px, py); return; }

        const primary = this.pickTarget(px, py);
        const volley = primary ? 1 + this.stats.multishot : 1;

        this.turret.fire(px, py, volley);

        const muzzle = this.turret.tipFor(0);

        this.fx.beam(muzzle.x, muzzle.y, px, py, this.beam);

        const kick = kickOf(this.look);

        if (kick > 0) this.cameras.main.shake(50, kick);

        if (!primary)
        {
            //  Nothing is lost for missing here. There is nothing to lose.
            this.fx.ring(px, py, 30, 0x5fe08a, 2, 240);
            Sfx.miss();
            return;
        }

        const hit = new Set<Target>([ primary ]);

        this.cashIn(primary);

        //  The gun the player built still works exactly as it does in a level;
        //  a multi-shot build simply cashes several bills per tap.
        if (this.stats.multishot > 0)
        {
            const others = this.targets
                .filter(t => !t.dead && !hit.has(t))
                .sort((a, b) => a.distanceTo(px, py) - b.distanceTo(px, py))
                .slice(0, this.stats.multishot);

            others.forEach((t, i) =>
            {
                hit.add(t);

                const m = this.turret.tipFor(i + 1);

                this.fx.beam(m.x, m.y, t.x, t.y, this.beam2, 0.85);
                this.cashIn(t);
            });
        }
    }

    private pickTarget (px: number, py: number): Target | null
    {
        let best: Target | null = null;
        let bestDist = Infinity;

        for (const t of this.targets)
        {
            if (t.dead) continue;
            if (!t.contains(px, py, this.stats.hitRadius)) continue;

            const d = t.distanceTo(px, py);

            if (d < bestDist) { bestDist = d; best = t; }
        }

        return best;
    }

    /** What one piece of money is actually worth once everything is applied. */
    private valueOf (kind: TargetKind): number
    {
        const def = KINDS[kind];
        const lucky = Math.random() < this.stats.lucky;
        const raw = (def.coins + this.stats.flatCoins) * this.stats.coinMult * cashScale(run.level) * this.mult;

        return Math.max(1, Math.round(raw * (lucky ? 2 : 1)));
    }

    /**
     * A piece of money, taken. Everything here is turned up: the number is big,
     * gold, and it is followed by an actual handful of coins flying across the
     * screen into the counter that is about to be bigger.
     */
    private cashIn (t: Target): void
    {
        const idx = this.targets.indexOf(t);
        if (idx === -1) return;

        this.targets.splice(idx, 1);

        const kind = t.kind;
        const def = t.def;
        const radius = t.radius;
        const x = t.x;
        const y = t.y;

        t.destroy();

        const gain = this.valueOf(kind);
        const jackpot = kind === 'vault';

        this.earned += gain;
        bankCoins(gain);

        this.kills += 1;

        //  --- the payout, in flight ---
        this.fx.burst(x, y, def.color, jackpot ? 30 : 16, jackpot ? 'gold' : 'hit');
        this.fx.ring(x, y, radius * (jackpot ? 3.6 : 2.4), def.color, jackpot ? 7 : 3, jackpot ? 460 : 300);

        this.fx.popup(x, y - radius * 0.5, `+$${fmt(gain)}`, jackpot ? 0xffd23f : 0xcdffdd, jackpot ? 44 : 30, jackpot ? 90 : 66);

        const coins = jackpot ? 9 : (kind === 'stack' ? 5 : 3);

        for (let i = 0; i < coins; i++)
        {
            this.time.delayedCall(i * 40, () =>
                this.fx.fly(x, y, COIN_HUD.x - 14, COIN_HUD.y, jackpot ? 0xffd23f : 0xffc857, () => this.bumpCoins()));
        }

        this.cameras.main.shake(jackpot ? 140 : 60, jackpot ? 0.011 : 0.0035);

        if (jackpot)
        {
            this.cameras.main.flash(180, 255, 210, 90);
            this.fx.popup(CX, arenaY(0.2), 'JACKPOT', 0xffd23f, 46, 46, 780);
            Sfx.jackpot();
        }
        else
        {
            Sfx.cash(this.kills);
        }

        this.bumpTotal();
        this.checkMult();
    }

    private bumpTotal (): void
    {
        this.totalText.setScale(1.22);
        this.tweens.add({ targets: this.totalText, scale: 1, duration: 150, ease: 'Quad.out' });
    }

    private bumpCoins (): void
    {
        this.coinLabel.setScale(1.28);
        this.tweens.add({ targets: this.coinLabel, scale: 1, duration: 160, ease: 'Quad.out' });
        Sfx.reward();
    }

    /**
     * The multiplier only ever goes up, so the round gets louder the further
     * into it the player is and there is never a reason to stop shooting.
     */
    private checkMult (): void
    {
        const next = cashMult(this.kills);

        if (next === this.mult) return;

        this.mult = next;

        this.multText.setText(`CASH x${this.mult}`).setScale(2);
        this.tweens.add({ targets: this.multText, scale: 1, duration: 260, ease: 'Back.out' });

        this.fx.ring(CX, HUD.comboY, 120 + this.mult * 30, 0xffd23f, 5, 440);
        this.cameras.main.flash(120, 255, 210, 90);
        this.cameras.main.shake(120, 0.005);

        //  Every step thickens the rain immediately rather than waiting for it
        //  to trickle in.
        for (let i = 0; i < 6; i++) this.dropBill();

        Sfx.milestone(this.mult);
    }

    //  ----------------------------------------------------------------- loop

    update (_time: number, delta: number): void
    {
        const dt = Math.min(50, delta);

        this.fx.update(dt);
        this.drawRays(dt);
        this.updateBills(dt);

        if (this.state === 'play')
        {
            this.timeLeft -= dt;
            this.spawnTimer -= dt;

            const alive = this.targets.length;
            const floor = Math.max(3, Math.ceil(this.cfg.maxActive * 0.6));

            if ((this.spawnTimer <= 0 || alive < floor) && alive < this.cfg.maxActive)
            {
                this.spawn();
                this.spawnTimer = this.cfg.spawnRate;
            }

            this.tickAbility(dt);

            if (this.timeLeft <= 0)
            {
                this.timeLeft = 0;
                this.timeUp();
            }
        }

        const def = ABILITIES.mayhem;

        this.bolts.update(this.state === 'play' ? dt : 0, this.targets, t =>
        {
            if (this.state === 'play') this.cashIn(t);
            return false;
        }, (x, y) => this.fx.burst(x, y, def.glow, 3, 'hit'));

        for (const w of this.sentries)
        {
            const mark = this.nearestTo(w.x, w.y);

            if (mark) w.aimAt(mark.x, mark.y);
            else w.stand();

            w.tick(dt, this.time.now);
        }

        for (let i = this.targets.length - 1; i >= 0; i--)
        {
            const t = this.targets[i];

            t.update(dt, this.stats.slow);

            if (t.life <= 0 && this.state === 'play') this.expire(t);
        }

        //  The total counts up rather than jumping, so a big hit is still
        //  climbing while the coins from it are still in the air.
        if (this.earnedShown !== this.earned)
        {
            this.earnedShown += Math.max(1, Math.ceil((this.earned - this.earnedShown) * 0.3));
            if (this.earnedShown > this.earned) this.earnedShown = this.earned;
            this.totalText.setText(`$${fmt(this.earnedShown)}`);
        }

        if (this.coinsDisplay !== meta.coins)
        {
            this.coinsDisplay += Math.max(1, Math.ceil((meta.coins - this.coinsDisplay) * 0.25));
            if (this.coinsDisplay > meta.coins) this.coinsDisplay = meta.coins;
            this.coinLabel.setValue(fmt(this.coinsDisplay));
        }

        this.turret.idle(this.time.now);
        this.drawHud();
    }

    /** Money that timed out. It leaves quietly -- nothing here is a punishment. */
    private expire (t: Target): void
    {
        const idx = this.targets.indexOf(t);
        if (idx === -1) return;

        this.targets.splice(idx, 1);

        this.fx.burst(t.x, t.y, 0x2f6b4a, 6, 'hit');
        t.destroy();
    }

    //  ------------------------------------------------------------ abilities

    private get fireRate (): number
    {
        if (this.ability === 'mayhem') return MAYHEM_RATE;
        if (this.ability === 'bomb') return BOMB_RATE;

        return this.stats.fireRate;
    }

    private resumeAbility (id: AbilityId, left: number): void
    {
        const def = ABILITIES[id];

        this.ability = id;
        this.abilityLeft = left;
        this.turret.charge(id);
        this.abilityBanner.show(def);
        this.abilityBanner.set(left / def.duration);

        if (id === 'sentry')
        {
            const y = arenaY(0.52);
            const l = new Wingman(this, PLAY.left - 60, y, VAULT, -1);
            const r = new Wingman(this, PLAY.right + 60, y, VAULT, 1);

            this.tweens.add({ targets: l, x: PLAY.left - 6, duration: 380, ease: 'Back.out' });
            this.tweens.add({ targets: r, x: PLAY.right + 6, duration: 380, ease: 'Back.out' });
            this.sentries = [ l, r ];
            this.sentryTimer = 500;
        }
    }

    private endAbility (): void
    {
        if (!this.ability) return;

        this.ability = null;
        this.abilityLeft = 0;
        this.laserGfx.clear();
        this.turret.charge(null);
        this.abilityBanner.hide();

        for (const w of this.sentries)
        {
            const out = w.x < CX ? PLAY.left - 60 : PLAY.right + 60;
            this.tweens.add({ targets: w, x: out, alpha: 0, duration: 300, ease: 'Quad.in', onComplete: () => w.destroy() });
        }

        this.sentries = [];
        this.fx.popup(this.turret.tipX, this.turret.tipY - 30, 'POWER DOWN', 0x9fb0d0, 20, 40, 520);
    }

    private tickAbility (dt: number): void
    {
        if (!this.ability) return;

        this.abilityLeft -= dt;
        this.abilityBanner.set(Math.max(0, this.abilityLeft / ABILITIES[this.ability].duration));

        if (this.abilityLeft <= 0)
        {
            this.endAbility();
            return;
        }

        const p = this.input.activePointer;
        const onBoard = p.y >= PLAY.top - 16 && p.y <= PLAY.bottom + 6;

        if (this.ability === 'mayhem')
        {
            if (p.isDown && onBoard) this.shoot(p.x, p.y);
        }
        else if (this.ability === 'laser')
        {
            this.turret.aimAt(p.x, p.y);

            const m = this.turret.tipFor(0);
            const legs = laserPath(m.x, m.y, p.x, p.y);

            drawLaser(this.laserGfx, legs, this.time.now);

            for (let i = this.targets.length - 1; i >= 0; i--)
            {
                const t = this.targets[i];

                if (!t.dead && legs.some(l => distToSegment(t.x, t.y, l.x1, l.y1, l.x2, l.y2) <= t.radius + 7)) this.cashIn(t);
            }
        }
        else if (this.ability === 'sentry')
        {
            this.sentryTimer -= dt;

            if (this.sentryTimer <= 0)
            {
                this.sentryTimer = SENTRY_RATE;

                for (const w of this.sentries)
                {
                    const mark = this.nearestTo(w.x, w.y);

                    if (!mark) continue;

                    w.aimAt(mark.x, mark.y);
                    w.fire();

                    const m = w.muzzle;

                    this.fx.beam(m.x, m.y, mark.x, mark.y, this.beam2, 0.8);
                    this.cashIn(mark);
                }
            }
        }
    }

    private nearestTo (x: number, y: number): Target | null
    {
        let best: Target | null = null;
        let bestDist = Infinity;

        for (const t of this.targets)
        {
            if (t.dead) continue;

            const d = Math.hypot(t.x - x, t.y - y);

            if (d < bestDist) { bestDist = d; best = t; }
        }

        return best;
    }

    private shootMayhem (px: number, py: number): void
    {
        this.turret.fire(px, py, 1);

        const m = this.turret.tipFor(0);

        this.cameras.main.shake(60, 0.004);
        this.fx.burst(m.x, m.y, ABILITIES.mayhem.glow, 6, 'hit');

        for (const dir of sprayDirs(m.x, m.y, px, py, MAYHEM_BOLTS))
        {
            this.bolts.fire(m.x, m.y, dir.dx, dir.dy);
        }
    }

    private shootBomb (px: number, py: number): void
    {
        this.turret.fire(px, py, 1);

        const def = ABILITIES.bomb;
        const m = this.turret.tipFor(0);

        this.fx.beam(m.x, m.y, m.x + (px - m.x) * 0.12, m.y + (py - m.y) * 0.12, { ...this.beam, color: def.color, width: 10, life: 120, head: 0 });
        this.cameras.main.shake(80, 0.006);
        Sfx.launch();

        lobShell(this, m.x, m.y, px, py, () =>
        {
            if (this.state !== 'play') return;

            bombImpact(this, this.fx, px, py);
            Sfx.boom();

            const caught = this.targets.filter(t => !t.dead && t.distanceTo(px, py) <= BOMB_RADIUS + t.radius);

            for (const t of caught) this.cashIn(t);
        });
    }

    //  ----------------------------------------------------------------- flow

    /**
     * Time is up, and the vault keeps whatever is still standing.
     *
     * There is no cash-out. Money you did not shoot is money you did not get:
     * the bills left on the board blow away one after another, in the dull
     * green of something that was worth something a second ago, and the round
     * closes on the number the player actually earned. A bonus that pays for
     * the shots you failed to take is not a bonus round, it is a cutscene --
     * and it would quietly remove the only reason to hurry.
     */
    private timeUp (): void
    {
        if (this.state === 'done') return;

        this.state = 'done';
        setGameplayActive(false);

        //  Whatever is left of the weapon rides on into the next level.
        run.ability = this.ability && this.abilityLeft > 0 ? { id: this.ability, left: this.abilityLeft } : null;
        this.laserGfx.clear();
        this.bolts.clear();

        const left = this.targets.slice();

        this.targets = [];

        left.forEach((t, i) => this.time.delayedCall(i * SWEEP_STAGGER, () =>
        {
            //  Gone, not banked. It leaves the way expired money should: no
            //  number, no coins in flight, no sound worth celebrating.
            this.fx.burst(t.x, t.y, 0x2f6b4a, 8, 'hit');
            this.fx.ring(t.x, t.y, t.radius * 1.8, 0x2f6b4a, 2, 240);
            t.destroy();
        }));

        if (left.length > 0) Sfx.expire();

        this.time.delayedCall(left.length * SWEEP_STAGGER + 240, () => this.finish());
    }

    private finish (): void
    {
        //  The coins themselves were banked as they were shot; this is the
        //  run's own tally, which the results screen reads back at the end.
        run.coinsEarned += this.earned;
        saveMeta();

        //  The total the player actually took, as big as the screen will take
        //  it. The coins were banked as they were shot -- this is the receipt,
        //  not the payment.
        Sfx.jackpot();
        this.cameras.main.flash(320, 255, 214, 90);
        this.cameras.main.shake(260, 0.008);

        for (let i = 0; i < 3; i++)
        {
            this.time.delayedCall(i * 110, () =>
                this.fx.ring(CX, arenaY(0.42), 220 + i * 150, 0xffd23f, 8 - i * 1.6, 560));
        }

        const label = this.add.text(CX, arenaY(0.34), 'YOU TOOK', {
            fontFamily: FONT, fontSize: 30, color: hex(0x5fe08a)
        }).setOrigin(0.5).setDepth(36).setAlpha(0);

        const total = this.add.text(CX, arenaY(0.44), `$${fmt(this.earned)}`, {
            fontFamily: FONT, fontSize: 78, color: hex(0xffd23f), stroke: '#000000', strokeThickness: 10
        }).setOrigin(0.5).setDepth(36).setScale(0.3);

        this.tweens.add({ targets: label, alpha: 1, duration: 200 });
        this.tweens.add({ targets: total, scale: 1, duration: 320, ease: 'Back.out' });

        //  The counter is holding the same number the total is showing, so the
        //  headline retires rather than lingering next to its own duplicate.
        this.totalText.setAlpha(0.35);

        this.time.delayedCall(1150, () =>
        {
            //  The vault used to open onto the upgrade table. There is no
            //  table any more -- upgrades come off the rank ladder mid-level --
            //  so it opens onto the next level, or onto the gate when the next
            //  level happens to start a new world.
            void this.doors.close(280).then(() =>
                this.scene.start(isZoneStart(run.level) ? 'World' : 'Game'));
        });
    }
}
