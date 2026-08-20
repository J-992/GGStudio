import { GameObjects, Math as PMath, Scene } from 'phaser';
import { Target } from '../objects/Target';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio, isMuted, toggleMute } from '../core/audio';
import { FINAL_LEVEL, KINDS, LevelConfig, POWERUP_SPEED, isPowerup, levelConfig, pickKind } from '../data/levels';
import { Stats, UPGRADE_BY_ID } from '../data/upgrades';
import { BeamLook, GunLook, beamLook, gunLook, kickOf, partFor } from '../data/gunkit';
import { bankCoins, meta, run, saveMeta } from '../core/state';
import { setGameplayActive } from '../core/lifecycle';
import { adsAvailable, noteLevelCleared } from '../core/ads';
import { rewardButton } from '../core/adButton';
import { reportPlatformHappyTime } from '../platform/platform';
import { IconLabel, ic, iconImage } from '../core/icons';
import { Turret } from '../objects/Turret';
import { Doors } from '../objects/Doors';
import { Backdrop } from '../core/backdrop';
import { aheadAccent, isZoneStart, skinFor, Zone, zoneFor } from '../data/zones';
import { gimmickIntro, seedTarget, tickGimmick } from '../core/gimmicks';
import { Hazards, hazardIntro } from '../core/hazards';
import { HazardSpec, hazardFor, teachesHazard } from '../data/hazards';
import { isBonusAfter } from '../data/bonus';
import { CX, CY, FONT, FONT_UI, H, HUD, MUZZLE, PLAY, Tier, W, fmt, fmtShort, hex } from '../core/theme';

interface Streak { n: number; bonus: number; label: string; }

const STREAKS: Streak[] = [
    { n: 5,  bonus: 0.10, label: 'NICE!' },
    { n: 10, bonus: 0.25, label: 'ON FIRE!' },
    { n: 20, bonus: 0.50, label: 'UNSTOPPABLE!' },
    { n: 30, bonus: 1.00, label: 'GODLIKE!' },
    { n: 50, bonus: 2.00, label: 'LEGENDARY!' },
    { n: 80, bonus: 3.50, label: 'INSANE!!!' }
];

/** Where flying coins land: the gem readout in the top right. */
const COIN_HUD = { x: W - HUD.margin - 14, y: HUD.levelY };

/** Seconds an extra life puts back on the clock. */
const REVIVE_SECONDS = 10;

/** Streak milestone colours -- shared by the pips, the banner and the combo ramp. */
const STREAK_COLORS = [ 0x6cf5c8, 0x3fe0ff, 0xb388ff, 0xff5ce0, 0xffb020, 0xff4d3d ];

/** The combo display escalates one step every 5 kills. */
const COMBO_STEP = 5;
const COMBO_MAX_TIER = 8;
const COMBO_RAMP = [
    0x9fe8ff, 0x6cf5c8, 0x62ffb8, 0xb388ff, 0xff7ae0, 0xff5ce0, 0xffb020, 0xff7a3d, 0xff3b45
];

const COMBO_Y = HUD.comboY;
const STREAK_Y = HUD.streakY;
const BAR_RIGHT = HUD.barRight;

/** A fraction of the way down the arena, whatever shape the arena is. */
function arenaY (t: number): number
{
    return PLAY.top + (PLAY.bottom - PLAY.top) * t;
}

interface ComboWing { img: GameObjects.Image; side: number; slot: number; }

function distToSegment (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number
{
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = dx * dx + dy * dy;
    let t = len === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

export class GameScene extends Scene
{
    private cfg!: LevelConfig;
    private hazard!: HazardSpec;
    private hazards!: Hazards;
    private stats!: Stats;
    private tier!: Tier;
    private zone!: Zone;
    private fx!: Fx;
    private backdrop!: Backdrop;
    private doors!: Doors;

    private targets: Target[] = [];
    /** `intro` is the beat between the doors opening and the clock starting. */
    private state: 'intro' | 'play' | 'done' = 'intro';
    /** True when this level owes the player a first look at its zone's rule. */
    private teaching = false;
    private revived = false;

    private timeLeft = 0;
    private timeTotal = 0;
    private spawnTimer = 0;
    private nextShot = 0;
    private pending: { x: number; y: number; at: number } | null = null;

    private combo = 0;
    private comboTimer = 0;
    private bestCombo = 0;
    private milestoneIdx = -1;

    private progress = 0;
    private levelScore = 0;
    private levelCoins = 0;
    private levelXp = 0;
    private misses = 0;
    private expiredCount = 0;
    private coinsDisplay = 0;

    private tempMult = 1;
    private tempMultTimer = 0;

    //  HUD
    private hudGfx!: GameObjects.Graphics;
    private coinLabel!: IconLabel;
    private scoreText!: GameObjects.Text;
    private comboText!: GameObjects.Text;
    private comboAura!: GameObjects.Graphics;
    private comboWings: ComboWing[] = [];
    private comboTier = 0;
    private timeText!: GameObjects.Text;
    private timeIcon!: GameObjects.Image;
    private timeIconScale = 1;
    private goalText!: GameObjects.Text;
    private streakText!: GameObjects.Text;
    private streakKey = '';
    private multText!: GameObjects.Text;
    private muteBtn!: GameObjects.Image;
    private turret!: Turret;
    private look!: GunLook;
    private beam!: BeamLook;
    private beam2!: BeamLook;

    constructor ()
    {
        super('Game');
    }

    create ()
    {
        this.cfg = levelConfig(run.level);
        this.hazard = hazardFor(run.level);
        this.stats = run.stats();
        this.look = gunLook(run.taken, meta.perks);
        this.zone = zoneFor(run.level);
        this.tier = this.zone.palette;
        this.beam = beamLook(this.look, this.tier);
        this.beam2 = beamLook(this.look, this.tier, true);

        this.targets = [];
        this.state = 'intro';
        this.revived = false;
        this.timeTotal = (this.cfg.duration + this.stats.timeBonus) * 1000;
        this.timeLeft = this.timeTotal;
        this.spawnTimer = 260;
        this.nextShot = 0;
        this.pending = null;
        this.combo = this.stats.comboStart;
        this.comboTimer = this.stats.comboWindow;
        this.bestCombo = this.combo;
        this.milestoneIdx = -1;
        this.progress = 0;
        this.levelScore = 0;
        this.levelCoins = 0;
        this.levelXp = 0;
        this.misses = 0;
        this.expiredCount = 0;
        this.coinsDisplay = meta.coins;
        this.tempMult = 1;
        this.tempMultTimer = 0;
        this.comboWings = [];
        this.comboTier = 0;
        this.streakKey = '';

        this.teaching = isZoneStart(run.level) && !run.zonesSeen[this.zone.index];

        this.cameras.main.setBackgroundColor(this.tier.bg);

        this.backdrop = new Backdrop(this, this.zone);

        //  The weather is the level's difficulty made visible: the same numbers
        //  drive the art and the rule.
        this.backdrop.gust = this.hazard.gust;
        this.backdrop.storm = this.hazard.storm;

        this.fx = new Fx(this, 20);
        this.hazards = new Hazards(this, this.hazard, this.tier, this.fx, {
            onLanded: (ms: number) => this.boltLanded(ms)
        });

        this.buildHud();

        if (this.cfg.boss)
        {
            this.spawnBoss();
        }
        else if (!this.teaching)
        {
            //  A few targets are already standing when the doors part. An empty
            //  arena on the reveal wastes the best frame of the whole level --
            //  except on the level that opens a zone, where the empty field is
            //  the point: the rule has to demonstrate itself with nothing else
            //  moving, and only then does the level fill up.
            this.openingTargets();
        }

        this.input.on('pointerdown', (p: Phaser.Input.Pointer) =>
        {
            unlockAudio();
            if (this.state !== 'play') return;
            if (p.y < PLAY.top - 16 || p.y > PLAY.bottom + 6) return;
            this.requestShot(p.x, p.y);
        });

        this.doors = new Doors(this);

        this.enter();

        //  This scene is the only place the player is actually playing; every
        //  other screen is a menu as far as the portal is concerned.
        this.events.once('shutdown', () =>
        {
            setGameplayActive(false);
            this.hazards.destroy();
        });
    }

    /**
     * The doors part, and -- the first time the player sets foot in a zone --
     * its rule performs itself once on the empty field before the clock starts.
     * Nothing here is written down; the zone shows the player what it does.
     */
    private enter (): void
    {
        void this.doors.open(320).then(() =>
        {
            if (!this.teaching)
            {
                this.beginPlay();
                return;
            }

            run.zonesSeen[this.zone.index] = true;

            //  A zone can owe the player two demonstrations: how the world
            //  behaves, and what is trying to stop them. They play back to
            //  back, in that order, and only ever the first time in.
            const rule = Math.max(1, gimmickIntro(this, this.zone, this.fx));
            const signature = teachesHazard(run.level);

            this.time.delayedCall(rule, () =>
            {
                const shown = hazardIntro(this, signature, this.tier, this.fx);

                if (shown <= 0)
                {
                    this.beginPlay();
                    return;
                }

                this.time.delayedCall(shown, () => this.beginPlay());
            });
        });
    }

    /** The handful of targets that are already up when the doors part. */
    private openingTargets (): void
    {
        //  Standing, never falling: the crowd behind the doors is a tableau,
        //  and a target that dropped through the floor before the clock
        //  started would be a free miss the player never had a shot at.
        for (let i = 0; i < Math.min(3, this.cfg.maxActive); i++) this.spawn(true);
    }

    private beginPlay (): void
    {
        if (this.state !== 'intro') return;

        this.state = 'play';

        if (this.teaching && !this.cfg.boss) this.openingTargets();

        //  The targets that were standing behind the doors have been ageing on
        //  screen; the clock starting is the first moment their timer is real.
        for (const t of this.targets) t.setLifetime(t.maxLife);

        setGameplayActive(true);

        //  The glass goes up and the core arms itself with the clock, not with
        //  the scene -- nothing shoots at a player who is still watching a door.
        this.hazards.start();

        this.installPick();
    }

    /**
     * The upgrade chosen on the way in gets bolted onto the gun in front of the
     * player. It plays over the opening beat of the level rather than before
     * it, so the payoff costs nobody any clock.
     */
    private installPick (): void
    {
        const id = run.claimPick();

        if (!id) return;

        const up = UPGRADE_BY_ID[id];

        if (!up) return;

        this.turret.install(partFor(id));

        Sfx.upgrade();
        this.fx.ring(MUZZLE.x, MUZZLE.y - 40, 170, up.color, 6, 520);
        this.fx.burst(MUZZLE.x, MUZZLE.y - 40, up.color, 18, 'hit');
        this.cameras.main.shake(180, 0.006);

        const tag = this.fx.popup(MUZZLE.x, MUZZLE.y - 118, up.name, up.color, 24, 34, 980);
        tag.setDepth(40);
    }

    //  ---------------------------------------------------------------- setup

    private buildHud (): void
    {
        this.hudGfx = this.add.graphics().setDepth(30);

        this.coinLabel = new IconLabel(this, W - HUD.margin, COIN_HUD.y, 'gem', fmt(meta.coins), {
            align: 'right', fontSize: 24, iconSize: 22
        });
        this.coinLabel.setDepth(31);

        this.scoreText = this.add.text(CX, HUD.scoreY, '0', {
            fontFamily: FONT, fontSize: HUD.scoreSize, color: '#ffffff', stroke: '#000000', strokeThickness: 6
        }).setOrigin(0.5).setDepth(31);

        this.comboAura = this.add.graphics().setDepth(30);

        this.comboText = this.add.text(CX, COMBO_Y, '', {
            fontFamily: FONT, fontSize: 28, color: hex(COMBO_RAMP[0])
        }).setOrigin(0.5).setDepth(31);

        this.applyComboTier(0);

        this.timeText = this.add.text(HUD.margin, HUD.labelY, '0.0', {
            fontFamily: FONT, fontSize: 20, color: '#ffffff'
        }).setOrigin(0, 0.5).setDepth(32);

        //  Stopwatch cap on the end of the bar -- makes it read as a countdown.
        this.timeIcon = iconImage(this, BAR_RIGHT + 20, HUD.barY + HUD.barH / 2, 'stopwatch', { size: 20, color: this.tier.accent });
        this.timeIcon.setDepth(32);
        this.timeIconScale = this.timeIcon.scaleX;

        this.goalText = this.add.text(BAR_RIGHT, HUD.labelY, '0 / 0', {
            fontFamily: FONT, fontSize: 20, color: hex(this.tier.accent)
        }).setOrigin(1, 0.5).setDepth(32);

        //  On a wide screen the caption sits to the right of the gem track; in
        //  portrait there is no room beside it, so it stacks underneath.
        const gemSpan = (STREAKS.length - 1) * HUD.streakGap;

        this.streakText = this.add.text(
            HUD.streakInline ? CX + gemSpan / 2 + 34 : CX,
            HUD.streakTextY,
            '',
            { fontFamily: FONT, fontSize: 15, color: '#7d88b0' }
        ).setOrigin(HUD.streakInline ? 0 : 0.5, 0.5).setDepth(31);

        this.multText = this.add.text(
            HUD.streakInline ? CX - gemSpan / 2 - 34 : HUD.margin - 2,
            HUD.streakTextY,
            '',
            { fontFamily: FONT, fontSize: 20, color: '#b388ff' }
        ).setOrigin(HUD.streakInline ? 1 : 0, 0.5).setDepth(31).setAlpha(0);

        this.muteBtn = iconImage(this, W - HUD.margin + 4, HUD.footerY, isMuted() ? 'soundOff' : 'soundOn', {
            size: 20, color: 0xffffff, alpha: 0.45
        });
        this.muteBtn.setDepth(32).setInteractive({ useHandCursor: true });

        this.muteBtn.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: any) =>
        {
            if (e && e.stopPropagation) e.stopPropagation();
            unlockAudio();
            meta.muted = toggleMute();
            saveMeta();
            this.muteBtn.setTexture(ic(meta.muted ? 'soundOff' : 'soundOn'));
        });

        this.turret = new Turret(this, this.tier, this.look);
    }

    //  ------------------------------------------------------------- spawning

    private freeSpot (radius: number): { x: number; y: number }
    {
        let best = { x: 0, y: 0 };
        let bestDist = -1;

        for (let attempt = 0; attempt < 14; attempt++)
        {
            const x = PLAY.left + radius + Math.random() * Math.max(1, (PLAY.right - PLAY.left) - radius * 2);
            const y = PLAY.top + radius + Math.random() * Math.max(1, (PLAY.bottom - PLAY.top) - radius * 2);

            let min = 99999;

            for (const t of this.targets)
            {
                min = Math.min(min, t.distanceTo(x, y) - t.radius - radius);
            }

            if (min > bestDist) { bestDist = min; best = { x, y }; }
            if (min > 26) break;
        }

        return best;
    }

    private spawn (standing = false): void
    {
        const kind = pickKind(this.cfg.weights);
        const def = KINDS[kind];
        const radius = this.cfg.size * def.sizeMult;
        const power = isPowerup(kind);
        const falling = !standing && this.hazard.fallChance > 0 && Math.random() < this.hazard.fallChance;

        //  A prize is never a sitting duck: power-ups carry their own floor
        //  speed, so they drift even on a level where nothing else does.
        const speed = power ? Math.max(this.cfg.speed, POWERUP_SPEED) : this.cfg.speed;
        const moveChance = power ? Math.max(0.85, this.cfg.moveChance) : this.cfg.moveChance;
        const moving = !falling && Math.random() < moveChance;

        const spot = falling
            ? { x: PLAY.left + radius + Math.random() * Math.max(1, (PLAY.right - PLAY.left) - radius * 2), y: PLAY.top + radius }
            : this.freeSpot(radius);

        const t = new Target(this, spot.x, spot.y, kind, this.cfg.size, run.level, speed, moving, skinFor(this.zone, kind));

        if (falling)
        {
            //  The drop *is* the timer: the fall is timed against the lifetime
            //  this level would have given a standing target, so its life ring
            //  winds down exactly as it reaches the floor. The ring and the
            //  floor say the same thing, and the player reads whichever is
            //  nearer to hand.
            const drop = (PLAY.bottom + radius) - t.y;
            const quick = Math.min(1.6, Math.max(0.7, def.speedMult));
            const ms = Math.max(700, (this.cfg.lifetime * this.hazard.fallTime) / quick);
            const vy = (drop / ms) * 1000;

            t.falling = true;
            t.vy = vy;
            t.vx = (Math.random() - 0.5) * vy * 0.4;
            t.setLifetime(ms);
        }
        else
        {
            t.setLifetime(this.cfg.lifetime * (kind === 'bomb' ? 0.85 : 1));
        }

        t.setDepth(10);

        seedTarget(this.zone.gimmick, t, run.level, this.hazard);

        this.targets.push(t);
    }

    /**
     * The two halves a split leaves behind. They are smaller, briefer and
     * cannot split again, so the rule reads as a bonus rather than a spiral.
     */
    private splitInto (x: number, y: number, radius: number): void
    {
        if (this.state !== 'play') return;

        //  Late in the zone a kill comes apart into three, not two.
        const pieces = this.hazard.splitCount;

        for (let i = 0; i < pieces; i++)
        {
            if (this.targets.length >= this.cfg.maxActive + 4) return;

            const side = pieces === 2 ? (i === 0 ? -1 : 1) : i - 1;
            const size = Math.max(14, radius * (pieces > 2 ? 0.54 : 0.62));
            const px = Math.max(PLAY.left + size, Math.min(PLAY.right - size, x + side * radius * 0.9));
            const py = Math.max(PLAY.top + size, Math.min(PLAY.bottom - size, y));

            const t = new Target(this, px, py, 'small', size / KINDS.small.sizeMult, run.level, this.cfg.speed, true, skinFor(this.zone, 'small'));
            t.setLifetime(this.cfg.lifetime * 0.7);
            t.setDepth(10);
            t.noSplit = true;
            t.progressWorth = 0;

            this.targets.push(t);
        }
    }

    private spawnBoss (): void
    {
        const t = new Target(this, CX, arenaY(0.28), 'boss', this.cfg.size, run.level, this.cfg.speed, true);
        t.setLifetime(999999);
        t.setDepth(9);
        this.targets.push(t);

        this.time.delayedCall(320, () =>
        {
            this.fx.popup(CX, arenaY(0.14), 'BOSS', 0xff2d55, 46, 40, 900);
            Sfx.bomb();
            this.cameras.main.shake(300, 0.012);
        });
    }

    //  -------------------------------------------------------------- combat

    /**
     * Taps that land during the fire-rate cooldown are buffered rather than
     * dropped, so rapid tapping never feels like lost input.
     */
    private requestShot (px: number, py: number): void
    {
        if (this.time.now < this.nextShot)
        {
            this.pending = { x: px, y: py, at: this.time.now };
            return;
        }

        this.shoot(px, py);
    }

    private shoot (px: number, py: number, buffered = false): void
    {
        const now = this.time.now;

        this.nextShot = now + this.stats.fireRate;

        //  Anything standing between the gun and the tap gets the shot first.
        if (this.hitObstacle(px, py)) return;

        const hit = new Set<Target>();
        const primary = this.pickTarget(px, py);

        /**
         * Everything past the first bolt is a bonus on a hit, not an aimbot.
         * A tap that lands on empty space fires one barrel into empty space
         * and that is the whole shot -- no extra guns, no lance, no free kills
         * off a miss. Aim is still the game.
         */
        const volley = primary ? 1 + this.stats.multishot : 1;

        this.turret.fire(px, py, volley);

        const muzzle = this.turret.tipFor(0);

        this.fx.beam(muzzle.x, muzzle.y, px, py, this.beam);

        const kick = kickOf(this.look);

        if (kick > 0) this.cameras.main.shake(50, kick);

        if (primary)
        {
            hit.add(primary);
            this.applyShot(primary, px, py, true);
        }
        else if (!buffered)
        {
            //  A buffered tap aimed at a target that has since died is not
            //  punished -- only a live mis-tap breaks the combo.
            this.onMiss(px, py);
        }

        if (!primary) return;

        if (this.stats.pierce > 0)
        {
            const along = this.targets
                .filter(t => !t.dead && !hit.has(t) && t.kind !== 'bomb' &&
                    distToSegment(t.x, t.y, MUZZLE.x, MUZZLE.y, px, py) < t.radius + 10)
                .sort((a, b) => a.distanceTo(px, py) - b.distanceTo(px, py))
                .slice(0, this.stats.pierce);

            //  The lance carries on past the first target: one long bolt out
            //  to the furthest thing it skewered.
            const far = along[along.length - 1];

            if (far)
            {
                this.fx.beam(muzzle.x, muzzle.y, far.x, far.y, this.beam, 0.9);
            }

            for (const t of along)
            {
                hit.add(t);
                this.applyShot(t, t.x, t.y, false);
            }
        }

        if (this.stats.multishot > 0)
        {
            const others = this.targets
                .filter(t => !t.dead && !hit.has(t) && t.kind !== 'bomb')
                .sort((a, b) => a.distanceTo(px, py) - b.distanceTo(px, py))
                .slice(0, this.stats.multishot);

            others.forEach((t, i) =>
            {
                hit.add(t);

                //  Each extra shot leaves the barrel that actually flared for
                //  it -- the fan of tracers is the multi-shot upgrade made
                //  visible, not a stat hidden behind one line.
                const m = this.turret.tipFor(i + 1);

                this.fx.beam(m.x, m.y, t.x, t.y, this.beam2, 0.85);
                this.applyShot(t, t.x, t.y, false);
            });
        }
    }

    /**
     * The obstacle layer's claim on a shot.
     *
     * Glass eats anything that crosses it, whatever was behind it -- that is
     * the entire point of a pane. A bolt in the open air is shot out of the
     * sky. Neither counts as a miss: the player aimed at exactly the thing
     * they hit, and the cost is the shot itself, not their combo.
     *
     * True when the shot was spent here and the targets never saw it.
     */
    private hitObstacle (px: number, py: number): boolean
    {
        const bolt = this.hazards.flakAt(px, py, this.stats.hitRadius);
        const glass = this.hazards.paneOn(MUZZLE.x, MUZZLE.y, px, py);

        //  Whichever of the two the shot reaches first.
        const glassFirst = glass && (!bolt ||
            Math.hypot(glass.x - MUZZLE.x, glass.y - MUZZLE.y) < Math.hypot(bolt.x - MUZZLE.x, bolt.y - MUZZLE.y));

        if (glass && glassFirst)
        {
            this.turret.fire(glass.x, glass.y, 1);

            const m = this.turret.tipFor(0);

            this.fx.beam(m.x, m.y, glass.x, glass.y, this.beam);

            if (this.hazards.hitPane(glass.pane, glass.x, glass.y)) this.paneDown(glass.pane.x, glass.pane.y);

            return true;
        }

        if (bolt)
        {
            this.turret.fire(bolt.x, bolt.y, 1);

            const m = this.turret.tipFor(0);

            this.fx.beam(m.x, m.y, bolt.x, bolt.y, this.beam);

            const x = bolt.x;
            const y = bolt.y;

            this.hazards.killFlak(bolt);
            this.boltDown(x, y);

            return true;
        }

        return false;
    }

    /** Breaking the glass pays, so clearing a lane is a play and not a tax. */
    private paneDown (x: number, y: number): void
    {
        const gain = Math.round(400 * (1 + run.level * 0.12) * this.stats.scoreMult * (1 + this.streakBonus()));

        this.levelScore += gain;

        this.fx.popup(x, y - 34, 'SHATTERED', 0xd8e4ff, 26, 52, 620);
        this.fx.popup(x, y + 8, fmtShort(gain), 0xffffff, 30, 62);

        this.updateScoreText();
    }

    /** Shooting a bolt down is worth more than the seconds it would have cost. */
    private boltDown (x: number, y: number): void
    {
        const gain = Math.round(320 * (1 + run.level * 0.12) * this.stats.scoreMult * (1 + this.streakBonus()));

        this.levelScore += gain;

        this.fx.popup(x, y - 30, 'INTERCEPT', 0xffb020, 24, 50, 600);
        this.fx.popup(x, y + 10, fmtShort(gain), 0xffffff, 28, 60);

        this.updateScoreText();
    }

    /**
     * A bolt got through to the gun. It costs clock and nothing else: the
     * combo the player has been building survives, because losing both at once
     * turns one mistake into the end of the run.
     */
    private boltLanded (ms: number): void
    {
        if (this.state !== 'play') return;

        this.timeLeft = Math.max(0, this.timeLeft - ms);

        this.fx.popup(MUZZLE.x, PLAY.bottom - 30, `-${(ms / 1000).toFixed(1)}s`, 0xff4d5e, 44, 86, 820);
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

    private applyShot (t: Target, hx: number, hy: number, direct: boolean): void
    {
        if (t.kind === 'bomb')
        {
            this.hitBomb(t);
            return;
        }

        //  Every tracer leaves the muzzle, so "which side was it hit from" is
        //  always the same question: where the gun is, relative to the target.
        if (t.shieldArc > 0)
        {
            const from = Math.atan2(MUZZLE.y - t.y, MUZZLE.x - t.x);

            if (t.shielded(from))
            {
                const p = t.plateAt(from);

                t.clang(from);
                this.fx.burst(p.x, p.y, 0xd8e4ff, 8, 'hit');
                this.fx.ring(p.x, p.y, t.radius * 1.9, 0xd8e4ff, 3, 260);
                Sfx.chip();
                return;
            }
        }

        const crit = Math.random() < this.stats.crit;
        const perfect = direct && this.stats.perfect > 0 && t.distanceTo(hx, hy) <= t.radius * 0.4;
        const dmg = this.stats.damage * (crit ? this.stats.critMult : 1);

        if (t.damage(dmg))
        {
            this.killTarget(t, crit, perfect, 0);
        }
        else
        {
            this.fx.burst(hx, hy, 0xffffff, 5, 'hit');
            Sfx.chip();
            this.cameras.main.shake(50, 0.002);
        }
    }

    private killTarget (t: Target, crit: boolean, perfect: boolean, depth: number): void
    {
        const idx = this.targets.indexOf(t);
        if (idx === -1) return;

        this.targets.splice(idx, 1);

        const def = t.def;
        const kind = t.kind;
        const color = t.color;
        const radius = t.radius;
        const splittable = !t.noSplit;
        const worth = t.progressWorth;
        const x = t.x;
        const y = t.y;

        t.destroy();

        //  --- combo ---
        this.combo += 1;
        this.comboTimer = this.stats.comboWindow;
        if (this.combo > this.bestCombo) this.bestCombo = this.combo;

        const streak = this.streakBonus();

        //  --- score ---
        const base = def.score * (1 + run.level * 0.12);
        let mult = this.stats.scoreMult * (1 + streak) * this.tempMult;
        if (crit) mult *= this.stats.critMult;
        if (perfect) mult *= 1 + this.stats.perfect;

        const gain = Math.round(base * mult);
        this.levelScore += gain;

        //  --- coins & xp ---
        const lucky = Math.random() < this.stats.lucky;
        let coins = (def.coins + this.stats.flatCoins) * this.stats.coinMult * (1 + streak * 0.5);
        if (lucky) coins *= 2;
        coins = Math.round(coins);

        const xp = Math.round(def.xp * this.stats.xpMult * (1 + streak * 0.5));

        this.levelCoins += coins;
        this.levelXp += xp;
        bankCoins(coins);

        this.progress += worth;
        run.kills += 1;

        //  --- feedback ---
        const big = crit || def.units > 1 || kind === 'golden' || kind === 'boss';

        this.fx.burst(x, y, color, big ? 26 : 14, kind === 'golden' || kind === 'boss' ? 'gold' : (big ? 'big' : 'hit'));
        this.fx.ring(x, y, radius * (big ? 3.4 : 2.2), color, big ? 6 : 3, big ? 420 : 280);

        const popColor = crit ? 0xffb020 : (kind === 'golden' ? 0xffd23f : 0xffffff);
        const popSize = crit ? 40 : (big ? 34 : 26);

        this.fx.popup(x, y - radius * 0.4, fmtShort(gain), popColor, popSize, big ? 84 : 60);

        if (crit) this.fx.popup(x, y + radius * 0.55, 'CRIT', 0xff7a3d, 22, 44, 500);
        if (perfect) this.fx.popup(x - 4, y - radius - 22, 'BULLSEYE', 0xfff3b0, 18, 40, 520);

        if (kind === 'coin' || kind === 'golden' || kind === 'boss' || lucky || this.combo % 3 === 0)
        {
            const n = kind === 'golden' || kind === 'boss' ? 8 : (kind === 'coin' ? 5 : 2);
            for (let i = 0; i < n; i++)
            {
                this.time.delayedCall(i * 45, () => this.fx.fly(x, y, COIN_HUD.x - 14, COIN_HUD.y, 0xffc857, () => this.bumpCoins()));
            }
        }

        this.cameras.main.shake(big ? 110 : 60, big ? 0.009 : 0.0035);

        if (kind === 'golden' || kind === 'boss') Sfx.golden();
        else if (crit) Sfx.crit();
        else if (kind === 'coin') Sfx.coin();
        else Sfx.hit(this.combo);

        //  --- special kinds ---
        if (kind === 'time')
        {
            this.timeLeft = Math.min(this.timeTotal, this.timeLeft + 2000);
            this.fx.popup(x, y - 40, '+2.0s', 0x62ffb8, 30, 70);
        }
        else if (kind === 'multi')
        {
            this.tempMult = Math.min(4, this.tempMult + 1);
            this.tempMultTimer = 5000;
            this.showMult();
        }
        else if (kind === 'boss')
        {
            this.cameras.main.flash(240, 255, 90, 120);
            this.fx.popup(CX, arenaY(0.21), 'BOSS DOWN', 0xff2d55, 44, 50, 900);
        }

        //  --- the zone's parting gift ---
        if (this.zone.gimmick === 'split' && splittable && def.progress > 0 && radius > 20)
        {
            this.splitInto(x, y, radius);
        }

        //  --- chain reactions ---
        if (depth < 2 && this.stats.explodeChance > 0 && Math.random() < this.stats.explodeChance)
        {
            this.explode(x, y, depth);
        }

        if (depth === 0 && this.stats.chain > 0)
        {
            this.chain(x, y, depth);
        }

        this.checkMilestone();
        this.updateScoreText();

        if (this.progress >= this.cfg.goal && this.state === 'play')
        {
            this.levelComplete();
        }
    }

    private explode (x: number, y: number, depth: number): void
    {
        const r = this.stats.explodeRadius;

        this.fx.ring(x, y, r, 0xff7a3d, 7, 380);
        this.fx.burst(x, y, 0xff9d3d, 22, 'big');
        this.cameras.main.shake(120, 0.01);
        Sfx.boom();

        const caught = this.targets.filter(t => !t.dead && t.kind !== 'bomb' && t.distanceTo(x, y) <= r + t.radius);

        for (const t of caught)
        {
            if (t.damage(this.stats.damage * 0.95))
            {
                this.killTarget(t, false, false, depth + 1);
            }
        }
    }

    private chain (x: number, y: number, depth: number): void
    {
        let fromX = x;
        let fromY = y;
        const used = new Set<Target>();

        for (let i = 0; i < this.stats.chain; i++)
        {
            let best: Target | null = null;
            let bestDist = 300;

            for (const t of this.targets)
            {
                if (t.dead || used.has(t) || t.kind === 'bomb') continue;

                const d = t.distanceTo(fromX, fromY);
                if (d < bestDist) { bestDist = d; best = t; }
            }

            if (!best) break;

            used.add(best);
            this.fx.beam(fromX, fromY, best.x, best.y, {
                ...this.beam2,
                color: 0xfff05c,
                core: 0xffffff,
                width: 4 + this.stats.chain,
                life: 220,
                wobble: 8 + this.stats.chain * 2,
                bloom: 1,
                shock: 0,
                head: 0
            });
            this.fx.burst(best.x, best.y, 0xfff05c, 8, 'hit');

            fromX = best.x;
            fromY = best.y;

            if (best.damage(this.stats.damage * 0.75))
            {
                this.killTarget(best, false, false, depth + 1);
            }
        }
    }

    private hitBomb (t: Target): void
    {
        const idx = this.targets.indexOf(t);
        if (idx === -1) return;

        this.targets.splice(idx, 1);

        const x = t.x;
        const y = t.y;
        t.destroy();

        this.combo = 0;
        this.comboTimer = this.stats.comboWindow;
        this.milestoneIdx = -1;
        this.timeLeft = Math.max(0, this.timeLeft - 800);

        this.fx.burst(x, y, 0xff3b45, 30, 'big');
        this.fx.ring(x, y, 130, 0xff3b45, 8, 420);
        this.fx.popup(x, y - 30, 'COMBO LOST', 0xff3b45, 26, 60, 700);
        this.cameras.main.shake(280, 0.016);
        this.cameras.main.flash(200, 120, 0, 20);
        Sfx.bomb();
    }

    private onMiss (px: number, py: number): void
    {
        this.misses += 1;

        const keep = this.stats.steady;
        const lost = Math.floor(this.combo * 0.5 * (1 - keep));

        if (lost > 0)
        {
            this.combo -= lost;
            this.recalcMilestone();
        }

        this.fx.ring(px, py, 34, 0x7d88b0, 3, 260);
        Sfx.miss();
    }

    private expireTarget (t: Target): void
    {
        const idx = this.targets.indexOf(t);
        if (idx === -1) return;

        this.targets.splice(idx, 1);

        const x = t.x;
        const y = t.y;
        const harmless = t.kind === 'bomb';

        t.destroy();

        if (harmless)
        {
            this.fx.burst(x, y, 0x556080, 6, 'hit');
            return;
        }

        this.expiredCount += 1;

        const keep = this.stats.steady;
        const lost = Math.floor(this.combo * 0.4 * (1 - keep));

        if (lost > 0)
        {
            this.combo -= lost;
            this.recalcMilestone();
        }

        //  A target that fell through the floor died just below the arena;
        //  the splash belongs on the floor, where the player was looking.
        const fy = Math.min(y, PLAY.bottom);

        this.fx.burst(x, fy, 0xff4d5e, 8, 'hit');
        this.fx.ring(x, fy, 40, 0xff4d5e, 3, 240);
        Sfx.expire();
    }

    //  -------------------------------------------------------------- streaks

    private streakBonus (): number
    {
        let bonus = 0;

        for (const s of STREAKS)
        {
            if (this.combo >= s.n) bonus = s.bonus;
        }

        return bonus * this.stats.comboMult;
    }

    private currentMilestone (): number
    {
        let idx = -1;
        for (let i = 0; i < STREAKS.length; i++)
        {
            if (this.combo >= STREAKS[i].n) idx = i;
        }
        return idx;
    }

    private recalcMilestone (): void
    {
        this.milestoneIdx = Math.min(this.milestoneIdx, this.currentMilestone());
    }

    private checkMilestone (): void
    {
        const idx = this.currentMilestone();

        if (idx <= this.milestoneIdx) return;

        this.milestoneIdx = idx;

        const s = STREAKS[idx];
        const color = STREAK_COLORS[Math.min(idx, STREAK_COLORS.length - 1)];

        const t = this.add.text(CX, arenaY(0.38), s.label, {
            fontFamily: FONT, fontSize: 52 + idx * 5, color: hex(color), stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setDepth(34).setScale(0.3);

        this.tweens.add({ targets: t, scale: 1.1, duration: 200, ease: 'Back.out' });
        this.tweens.add({
            targets: t, scale: 1.6, alpha: 0, duration: 420, delay: 340, ease: 'Quad.in',
            onComplete: () => t.destroy()
        });

        this.fx.ring(CX, arenaY(0.38), 240, color, 6, 520);
        this.cameras.main.shake(180, 0.008);
        this.cameras.main.flash(120, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff);
        Sfx.milestone(idx);

        //  The portal wants to know where the good parts are, and a streak
        //  milestone is the clearest "this is going well" the game has. The
        //  first one is routine, so the scale starts low and only the late
        //  streaks read as a genuine high.
        void reportPlatformHappyTime((idx + 1) / STREAKS.length);
    }

    //  ---------------------------------------------------------- combo ramp

    /**
     * The combo readout gains a whole design step every COMBO_STEP kills:
     * bigger, hotter, framed by chevrons and finally shaking and orbited by
     * sparks -- so the ramp is felt, not just counted.
     */
    private applyComboTier (tier: number): void
    {
        this.comboTier = tier;

        const color = COMBO_RAMP[Math.min(tier, COMBO_RAMP.length - 1)];

        this.comboText.setStyle({
            fontFamily: FONT,
            fontSize: Math.min(44, 28 + tier * 2),
            color: hex(color),
            stroke: '#000000',
            strokeThickness: 4 + Math.min(7, tier)
        });

        for (const w of this.comboWings) w.img.destroy();
        this.comboWings = [];

        const pairs = Math.max(0, Math.min(3, tier - 1));

        for (let slot = 0; slot < pairs; slot++)
        {
            for (const side of [ -1, 1 ])
            {
                const img = iconImage(this, CX, COMBO_Y, 'chevrons', {
                    size: 18 + tier, color
                });

                img.setDepth(31).setFlipX(side < 0);
                this.comboWings.push({ img, side, slot });
            }
        }
    }

    private checkComboTier (): void
    {
        const tier = this.combo < 2 ? 0 : Math.min(COMBO_MAX_TIER, Math.floor(this.combo / COMBO_STEP));

        if (tier === this.comboTier) return;

        const up = tier > this.comboTier;
        this.applyComboTier(tier);

        if (!up || tier === 0) return;

        const color = COMBO_RAMP[Math.min(tier, COMBO_RAMP.length - 1)];

        this.comboText.setScale(1.55);
        this.fx.ring(CX, COMBO_Y, 90 + tier * 24, color, 3 + tier * 0.5, 420);

        if (tier >= 3) this.fx.burst(CX, COMBO_Y, color, 6 + tier * 3, 'hit');
        if (tier >= 5) this.cameras.main.shake(90, 0.003);
    }

    private drawCombo (): void
    {
        const g = this.comboAura;
        g.clear();

        if (this.combo < 2)
        {
            this.comboText.setText('').setPosition(CX, COMBO_Y).setScale(1);
            for (const w of this.comboWings) w.img.setVisible(false);
            return;
        }

        this.comboText.setText(`COMBO x${this.combo}`);

        const tier = this.comboTier;
        const color = COMBO_RAMP[Math.min(tier, COMBO_RAMP.length - 1)];
        const t = this.time.now;
        const beat = Math.sin(t * (0.008 + tier * 0.0014));
        const half = this.comboText.displayWidth / 2;

        //  Breathing, then a hard jitter once the ramp gets serious.
        const jitter = tier >= 4 ? (tier - 3) * 1.1 : 0;

        this.comboText.setPosition(
            CX + (Math.random() - 0.5) * jitter,
            COMBO_Y + (Math.random() - 0.5) * jitter
        );

        if (!this.tweens.isTweening(this.comboText))
        {
            this.comboText.setScale(1 + beat * (0.018 + tier * 0.012));
        }

        if (tier >= 1)
        {
            g.fillStyle(color, 0.05 + tier * 0.016);
            g.fillEllipse(CX, COMBO_Y, half * 2 + 70 + tier * 10, 36 + tier * 2);
        }

        if (tier >= 3)
        {
            g.lineStyle(1.5 + tier * 0.3, color, 0.2 + Math.abs(beat) * 0.25);
            g.strokeEllipse(CX, COMBO_Y, half * 2 + 56 + tier * 8, 42 + tier * 2);
        }

        if (tier >= 6)
        {
            for (let i = 0; i < 3; i++)
            {
                const a = t * 0.004 + (i * Math.PI * 2) / 3;
                g.fillStyle(color, 0.75);
                g.fillCircle(
                    CX + Math.cos(a) * (half + 44),
                    COMBO_Y + Math.sin(a) * (18 + tier),
                    3 + tier * 0.4
                );
            }
        }

        //  Combo window, drawn as an underline that closes in from both ends.
        const cf = Math.max(0, this.comboTimer / this.stats.comboWindow);
        const under = Math.max(6, (half + 10) * cf);

        g.fillStyle(color, 0.75);
        g.fillRoundedRect(CX - under, COMBO_Y + 26, under * 2, 4, 2);

        for (const w of this.comboWings)
        {
            const off = half + 26 + w.slot * 24;

            w.img.setVisible(true);
            w.img.setPosition(CX + w.side * off, COMBO_Y);
            w.img.setAlpha(0.9 - w.slot * 0.24 + beat * 0.12);
        }
    }

    //  -------------------------------------------------------- streak track

    private diamond (g: GameObjects.Graphics, x: number, y: number, r: number, outline = false): void
    {
        const pts = [
            new PMath.Vector2(x, y - r),
            new PMath.Vector2(x + r, y),
            new PMath.Vector2(x, y + r),
            new PMath.Vector2(x - r, y)
        ];

        if (outline) g.strokePoints(pts, true, true);
        else g.fillPoints(pts, true);
    }

    /**
     * Streak progress as a row of milestone gems rather than another bar --
     * one gem per tier, lit as it is claimed, the next one pulsing.
     */
    private drawStreak (g: GameObjects.Graphics): void
    {
        const spacing = HUD.streakGap;
        const x0 = CX - ((STREAKS.length - 1) * spacing) / 2;
        const t = this.time.now;

        for (let i = 0; i < STREAKS.length; i++)
        {
            const x = x0 + i * spacing;
            const color = STREAK_COLORS[i];
            const reached = this.combo >= STREAKS[i].n;
            const next = !reached && (i === 0 || this.combo >= STREAKS[i - 1].n);

            if (i > 0)
            {
                const linked = this.combo >= STREAKS[i - 1].n;
                g.lineStyle(3, linked ? STREAK_COLORS[i - 1] : 0x232b47, linked ? 0.6 : 0.55);
                g.lineBetween(x - spacing + 14, STREAK_Y, x - 14, STREAK_Y);
            }

            if (reached)
            {
                g.fillStyle(color, 0.16 + Math.abs(Math.sin(t * 0.004 + i)) * 0.1);
                this.diamond(g, x, STREAK_Y, 21);
                g.fillStyle(color, 1);
                this.diamond(g, x, STREAK_Y, 11);
            }
            else if (next)
            {
                g.lineStyle(3, color, 0.4 + Math.abs(Math.sin(t * 0.006)) * 0.45);
                this.diamond(g, x, STREAK_Y, 11, true);
            }
            else
            {
                g.fillStyle(0x2a3352, 1);
                this.diamond(g, x, STREAK_Y, 5);
            }
        }
    }

    private updateStreakText (): void
    {
        const active = this.milestoneIdx >= 0 ? STREAKS[this.milestoneIdx] : null;
        const next = STREAKS.find(s => this.combo < s.n);
        const pct = (s: Streak) => Math.round(s.bonus * this.stats.comboMult * 100);

        let label: string;
        let color: string;

        if (active)
        {
            label = `${active.label}   +${pct(active)}% SCORE`;
            color = hex(STREAK_COLORS[Math.min(this.milestoneIdx, STREAK_COLORS.length - 1)]);
        }
        else if (next)
        {
            label = `${next.n - this.combo} MORE FOR +${pct(next)}% SCORE`;
            color = '#7d88b0';
        }
        else
        {
            label = 'MAX STREAK';
            color = hex(STREAK_COLORS[STREAK_COLORS.length - 1]);
        }

        if (label === this.streakKey) return;

        this.streakKey = label;
        this.streakText.setText(label);
        this.streakText.setColor(color);
    }

    private showMult (): void
    {
        this.multText.setText(`SCORE x${this.tempMult}`);
        this.multText.setAlpha(1).setScale(1.6);
        this.tweens.add({ targets: this.multText, scale: 1, duration: 220, ease: 'Back.out' });
    }

    private bumpCoins (): void
    {
        this.coinLabel.setScale(1.28);
        this.tweens.add({ targets: this.coinLabel, scale: 1, duration: 160, ease: 'Quad.out' });
        Sfx.reward();
    }

    //  ----------------------------------------------------------------- HUD

    private updateScoreText (): void
    {
        this.scoreText.setText(fmt(run.score + this.levelScore));
        this.scoreText.setScale(1.18);
        this.tweens.add({ targets: this.scoreText, scale: 1, duration: 130, ease: 'Quad.out' });
    }

    private drawHud (): void
    {
        const g = this.hudGfx;
        g.clear();

        //  countdown bar
        const tf = Math.max(0, this.timeLeft / this.timeTotal);
        const low = this.timeLeft < 3200;
        const pulse = low ? 0.7 + Math.abs(Math.sin(this.time.now * 0.012)) * 0.3 : 0.95;
        const barColor = low ? 0xff4d5e : this.tier.accent;

        const left = HUD.margin - 4;
        const span = BAR_RIGHT - left;

        g.fillStyle(0x000000, 0.45);
        g.fillRoundedRect(left, HUD.barY, span, HUD.barH, HUD.barH / 2);
        if (tf > 0.001)
        {
            g.fillStyle(barColor, pulse);
            g.fillRoundedRect(left + 2, HUD.barY + 2, Math.max(20, (span - 4) * tf), HUD.barH - 4, 9);
        }

        //  stopwatch cap at the end of the countdown
        const capX = BAR_RIGHT + 20;
        const capY = HUD.barY + HUD.barH / 2;

        g.fillStyle(0x000000, 0.55);
        g.fillCircle(capX, capY, 17);
        g.lineStyle(2.5, barColor, low ? 0.95 : 0.7);
        g.strokeCircle(capX, capY, 17);

        this.timeIcon.setTint(barColor);
        this.timeIcon.setScale(this.timeIconScale * (low ? 1 + Math.abs(Math.sin(this.time.now * 0.012)) * 0.2 : 1));

        //  goal bar
        const gf = Math.min(1, this.progress / this.cfg.goal);
        g.fillStyle(0x000000, 0.45);
        g.fillRoundedRect(left, HUD.goalY, span, HUD.goalH, 4);
        if (gf > 0.001)
        {
            g.fillStyle(this.tier.accent2, 0.95);
            g.fillRoundedRect(left + 2, HUD.goalY + 1, Math.max(8, (span - 4) * gf), HUD.goalH - 2, 3);
        }

        this.drawStreak(g);
        this.drawRoute(g);

        //  low-time vignette
        if (low && this.state === 'play')
        {
            const a = 0.06 + Math.abs(Math.sin(this.time.now * 0.01)) * 0.1;
            g.fillStyle(0xff0033, a);
            g.fillRect(0, 0, W, H);
        }
    }

    /**
     * The same rail the blast doors carry, shrunk into the top strip: one stop
     * per level of this zone and a gate at the end in the colour of whatever is
     * behind it. It is the only thing on screen that answers "how much further"
     * -- and it answers it without a number.
     */
    private drawRoute (g: GameObjects.Graphics): void
    {
        const stops = this.zone.to - this.zone.from + 1;
        const here = run.level - this.zone.from;
        const y = HUD.levelY;
        const x0 = HUD.margin + 4;
        const gap = Math.min(22, (BAR_RIGHT - x0 - 40) / stops);

        g.lineStyle(3, 0x1a2138, 1);
        g.lineBetween(x0, y, x0 + stops * gap, y);

        g.lineStyle(3, this.tier.accent, 0.9);
        g.lineBetween(x0, y, x0 + here * gap, y);

        for (let i = 0; i < stops; i++)
        {
            const x = x0 + i * gap;

            if (i < here)
            {
                g.fillStyle(this.tier.accent, 1);
                g.fillCircle(x, y, 4);
            }
            else if (i === here)
            {
                g.fillStyle(this.tier.accent, 1);
                g.fillCircle(x, y, 3);
                g.lineStyle(2, this.tier.accent, 0.5 + Math.abs(Math.sin(this.time.now * 0.005)) * 0.5);
                g.strokeCircle(x, y, 7);
            }
            else
            {
                g.fillStyle(0x2a3352, 1);
                g.fillCircle(x, y, 2.5);
            }
        }

        //  The gate, tinted with the next zone -- a colour the player has not
        //  seen yet, sitting a countable number of stops away.
        const gx = x0 + stops * gap;
        const gate = aheadAccent(run.level);

        g.lineStyle(2.5, gate, 0.8);
        g.strokeRect(gx - 5, y - 8, 10, 16);
        g.fillStyle(gate, 0.25);
        g.fillRect(gx - 5, y - 8, 10, 16);
    }

    //  --------------------------------------------------------------- loop

    update (_time: number, delta: number): void
    {
        const dt = Math.min(50, delta);

        this.fx.update(dt);
        this.backdrop.update(dt);
        this.hazards.update(dt, this.state === 'play');

        if (this.state === 'play')
        {
            this.timeLeft -= dt;

            if (this.tempMultTimer > 0)
            {
                this.tempMultTimer -= dt;
                if (this.tempMultTimer <= 0)
                {
                    this.tempMult = 1;
                    this.tweens.add({ targets: this.multText, alpha: 0, duration: 200 });
                }
            }

            if (this.combo > 0)
            {
                this.comboTimer -= dt;
                if (this.comboTimer <= 0)
                {
                    this.combo = 0;
                    this.milestoneIdx = -1;
                    this.comboTimer = this.stats.comboWindow;
                }
            }

            //  spawning
            this.spawnTimer -= dt;

            const alive = this.targets.length;
            const floor = Math.max(2, Math.ceil(this.cfg.maxActive * 0.5));

            if ((this.spawnTimer <= 0 || alive < floor) && alive < this.cfg.maxActive)
            {
                this.spawn();
                this.spawnTimer = this.cfg.spawnRate;
            }

            if (this.pending)
            {
                if (this.time.now - this.pending.at > 220)
                {
                    this.pending = null;
                }
                else if (this.time.now >= this.nextShot)
                {
                    const p = this.pending;
                    this.pending = null;
                    this.shoot(p.x, p.y, true);
                }
            }

            if (this.timeLeft <= 0)
            {
                this.timeLeft = 0;
                this.fail();
            }
        }

        for (let i = this.targets.length - 1; i >= 0; i--)
        {
            const t = this.targets[i];
            t.update(dt, this.stats.slow);

            //  A falling target dies by reaching the floor; a standing one by
            //  running out of life. Both are the same miss.
            if ((t.life <= 0 || t.gone) && this.state === 'play')
            {
                this.expireTarget(t);
            }
        }

        if (this.state === 'play')
        {
            //  The zone's rule, applied to the field. Wind and rotation come
            //  straight off the art that is already showing them.
            tickGimmick(this.zone.gimmick, {
                targets: this.targets,
                wind: this.backdrop.wind,
                spin: this.backdrop.spin,
                freeSpot: (r: number) => this.freeSpot(r)
            }, dt);
        }

        //  HUD text
        this.timeText.setText((this.timeLeft / 1000).toFixed(2));
        this.goalText.setText(`${Math.min(this.progress, this.cfg.goal)} / ${this.cfg.goal}`);

        this.checkComboTier();
        this.drawCombo();
        this.updateStreakText();
        this.turret.idle(this.time.now);

        if (this.coinsDisplay !== meta.coins)
        {
            this.coinsDisplay += Math.max(1, Math.ceil((meta.coins - this.coinsDisplay) * 0.25));
            if (this.coinsDisplay > meta.coins) this.coinsDisplay = meta.coins;
            this.coinLabel.setValue(fmt(this.coinsDisplay));
        }

        this.drawHud();
    }

    //  --------------------------------------------------------------- flow

    /**
     * The clock ran out. Before the run is written off, the player is offered
     * one extra life for a video -- the board, the combo and the level score are
     * all still standing at this point, which is the whole reason the offer is
     * worth anything. Declining costs nothing: retrying was always free.
     */
    private fail (): void
    {
        if (this.state === 'done') return;

        this.state = 'done';
        setGameplayActive(false);

        Sfx.fail();
        this.cameras.main.shake(320, 0.014);

        if (!this.revived && adsAvailable())
        {
            this.offerRevive();
            return;
        }

        this.endRun();
    }

    private offerRevive (): void
    {
        const panel = this.add.container(0, 0).setDepth(45);

        panel.add(this.add.rectangle(CX, CY, W, H, 0x05070f, 0.78));

        //  Laid out down the screen rather than at fixed pixels: the same card
        //  has to sit right in a 960-tall portrait box and a 720-tall wide one.
        const title = this.add.text(CX, H * 0.365, "OUT OF TIME", {
            fontFamily: FONT, fontSize: 54, color: '#ff4d5e', stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setScale(0.4);
        panel.add(title);

        this.tweens.add({ targets: title, scale: 1, duration: 260, ease: 'Back.out' });

        panel.add(this.add.text(CX, H * 0.42, `KEEP YOUR ${fmt(this.levelScore)} POINTS`, {
            fontFamily: FONT_UI, fontSize: 17, color: '#8d97bd'
        }).setOrigin(0.5));

        const life = rewardButton(this, CX, H * 0.52, {
            width: 360,
            height: 84,
            label: `EXTRA LIFE  +${REVIVE_SECONDS}s`,
            color: 0x6cf5c8,
            onReward: () => this.revive(panel)
        });

        if (life) panel.add(life);

        const quit = this.add.text(CX, H * 0.63, 'GIVE UP', {
            fontFamily: FONT, fontSize: 26, color: '#7d88b0'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        quit.on('pointerdown', () =>
        {
            Sfx.ui();
            panel.destroy();
            this.endRun();
        });

        panel.add(quit);
    }

    private revive (panel: GameObjects.Container): void
    {
        this.revived = true;
        panel.destroy();

        this.timeLeft = REVIVE_SECONDS * 1000;
        this.state = 'play';
        setGameplayActive(true);

        Sfx.upgrade();
        this.cameras.main.flash(200, 108, 245, 200);
        this.fx.ring(MUZZLE.x, MUZZLE.y - 60, 340, 0x6cf5c8, 8, 520);
    }

    private endRun (): void
    {
        this.hazards.clear();

        //  A failed attempt does not bank its score into the run -- retrying
        //  replays the same level from the same total.
        run.bestCombo = Math.max(run.bestCombo, this.bestCombo);
        run.coinsEarned += this.levelCoins;
        run.xpEarned += this.levelXp;

        meta.rank += this.levelXp;
        meta.best = Math.max(meta.best, run.score + this.levelScore);
        meta.bestLevel = Math.max(meta.bestLevel, run.level - 1);
        saveMeta();

        this.time.delayedCall(340, () =>
        {
            this.cameras.main.fadeOut(180, 0, 0, 0);
            this.time.delayedCall(190, () => this.scene.start('Result', { mode: 'fail', levelScore: this.levelScore, bestCombo: this.bestCombo }));
        });
    }

    /**
     * A level ends the way a level should end: the board clears itself, the
     * winnings fly to the counter that has been on screen the whole time, and
     * the blast doors come down over it.
     *
     * There used to be a panel here that spent two and a half seconds counting
     * four numbers up from zero, and it was the single most skipped moment in
     * the game. Everything it said is already visible -- the score in the HUD,
     * the coins in the top right -- so it says it in flight instead, in about a
     * quarter of the time, and the player is through the door before the old
     * version had finished its first row.
     */
    private levelComplete (): void
    {
        this.state = 'done';
        setGameplayActive(false);
        noteLevelCleared();

        //  Whatever was in the way when the level ended leaves for free.
        this.hazards.clear();

        run.bestCombo = Math.max(run.bestCombo, this.bestCombo);
        Sfx.levelClear();
        this.cameras.main.flash(200, 255, 255, 255);

        //  Sweep the board -- every remaining target pops for free.
        const left = this.targets.slice();
        this.targets = [];

        left.forEach((t, i) =>
        {
            this.time.delayedCall(i * 28, () =>
            {
                this.fx.burst(t.x, t.y, t.color, 12, 'hit');
                t.destroy();
            });
        });

        const comboBonus = Math.round(this.bestCombo * (12 + run.level * 2));
        const perfect = this.misses === 0 && this.expiredCount === 0;
        const perfectBonus = perfect ? 250 + run.level * 60 : 0;

        bankCoins(comboBonus + perfectBonus);

        run.score += this.levelScore;
        run.coinsEarned += this.levelCoins + comboBonus + perfectBonus;
        run.xpEarned += this.levelXp;

        meta.rank += this.levelXp;
        meta.best = Math.max(meta.best, run.score);
        meta.bestLevel = Math.max(meta.bestLevel, run.level);
        saveMeta();

        void reportPlatformHappyTime(perfect ? 1 : 0.6);

        this.payout(comboBonus + perfectBonus, perfect);

        this.time.delayedCall(380, () =>
        {
            void this.doors.close(260).then(() =>
            {
                if (run.level >= FINAL_LEVEL)
                {
                    this.scene.start('Result', { mode: 'victory', levelScore: this.levelScore, bestCombo: this.bestCombo });
                }
                else if (isBonusAfter(run.level))
                {
                    //  Every fifth level, the doors open onto the vault instead
                    //  of the upgrade table. The table is still waiting on the
                    //  far side of it, with more coins on the counter.
                    this.scene.start('Bonus');
                }
                else
                {
                    this.scene.start('Upgrade');
                }
            });
        });
    }

    /**
     * The winnings, paid in flight rather than in a table. A clean level pays
     * in gold and rings instead of the word PERFECT.
     */
    private payout (bonus: number, perfect: boolean): void
    {
        //  One clean shockwave over the arena the player just emptied.
        this.fx.ring(CX, arenaY(0.45), Math.max(W, H) * 0.6, this.tier.accent2, 6, 460);

        const coins = Math.min(14, 5 + Math.round(bonus / 90));

        for (let i = 0; i < coins; i++)
        {
            this.time.delayedCall(i * 34, () =>
            {
                this.fx.fly(
                    CX + (Math.random() - 0.5) * 220,
                    arenaY(0.45) + (Math.random() - 0.5) * 160,
                    COIN_HUD.x - 14, COIN_HUD.y,
                    perfect ? 0xffd23f : 0xffc857,
                    () => this.bumpCoins()
                );
            });
        }

        if (!perfect) return;

        //  A flawless level: three gold rings out of the muzzle, and the whole
        //  arena washed once in gold. No caption, and none needed.
        this.cameras.main.flash(260, 255, 214, 90);

        for (let i = 0; i < 3; i++)
        {
            this.time.delayedCall(i * 110, () =>
                this.fx.ring(CX, arenaY(0.45), 200 + i * 130, 0xffd23f, 7 - i * 1.5, 520));
        }

        Sfx.golden();
    }
}
