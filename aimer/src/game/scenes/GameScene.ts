import { GameObjects, Geom, Scene } from 'phaser';
import { Target } from '../objects/Target';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio, isMuted, toggleMute } from '../core/audio';
import { FINAL_LEVEL, KINDS, LevelConfig, POWERUP_SPEED, TargetKind, isPowerup, levelConfig, pickKind, punchOf, unitHp, xpWorth } from '../data/levels';
import { Stats, Upgrade, baseStats, rollOffers } from '../data/upgrades';
import { BeamLook, GunLook, beamLook, gunLook, kickOf, partFor } from '../data/gunkit';
import { bankCoins, boostCount, equippedSkin, meta, run, saveMeta, spendBoost } from '../core/state';
import { setGameplayActive } from '../core/lifecycle';
import { adsAvailable, noteLevelCleared } from '../core/ads';
import { rewardButton } from '../core/adButton';
import { reportPlatformHappyTime } from '../platform/platform';
import { IconLabel, ic, iconImage } from '../core/icons';
import { Turret } from '../objects/Turret';
import { Wingman } from '../objects/Wingman';
import { Doors } from '../objects/Doors';
import { Backdrop } from '../core/backdrop';
import { Trails } from '../core/trails';
import { isZoneStart, skinFor, Zone, zoneFor } from '../data/zones';
import { LevelUpPanel } from '../objects/LevelUpPanel';
import { endOfRun } from './GiftScene';
import { quitButton } from '../objects/QuitToMenu';
import { BuildStrip } from '../objects/BuildStrip';
import { BOOST_BY_ID } from '../data/boosts';
import { Skin, TargetSkin, TargetStyle, paintOf, styleOf } from '../data/skins';
import { gimmickIntro, seedTarget, tickGimmick } from '../core/gimmicks';
import { Hazards, hazardIntro } from '../core/hazards';
import { HazardSpec, hazardFor, teachesHazard } from '../data/hazards';
import { Chain } from '../core/chain';
import { BossFight, GuardHit } from '../core/bossfight';
import {
    ABILITIES, AbilityBanner, AbilityId, BOMB_DAMAGE, BOMB_RADIUS, BOMB_RATE, LASER_DPS, LASER_WIDTH,
    Bolts, MAYHEM_BOLTS, MAYHEM_DAMAGE, MAYHEM_RATE, SENTRY_RATE, abilityPlan, dressAbilityTarget, drawLaser, bombImpact, laserPath, lobShell,
    sprayDirs
} from '../core/abilities';
import { bossFor } from '../data/bosses';
import { isBonusAfter } from '../data/bonus';
import { CX, CY, FONT, FONT_UI, H, HUD, MUZZLE, PLAY, Tier, W, fmt, fmtShort, hex, mix } from '../core/theme';

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

/** Milliseconds between the bought second turret's shots. */
const WINGMAN_DELAY = 1150;

/**
 * What POWER buys, in punch (see data/levels).
 *
 * Damage used to be the one upgrade on the board that a player could stack all
 * run and never see: target health is pinned to the level, the gun's base
 * damage is pinned to target health, and so a plain target died to exactly one
 * tap whether the player had taken POWER nine times or never. The stat was
 * real and completely invisible.
 *
 * These are the three places the surplus now goes, in the order the player
 * meets them:
 *
 *   PLATE   a shot heavy enough tears the shield plate off its mount instead
 *           of being eaten by it -- the one hard "no" in the game, answered.
 *   GLASS   a pane loses a shot's worth of health per *unit of punch*, so a
 *           heavy gun goes through a window in one or two rather than five.
 *   BLAST   whatever is left over after the kill comes out the other side as
 *           a shockwave, and takes the neighbours with it.
 */
const PLATE_BREAK = 2.5;

/** Surplus punch below this is a scratch; a shockwave needs a whole spare kill. */
const BLAST_MIN = 1;

/** Ceiling on how many neighbours one shot's leftovers may take. */
const BLAST_MAX = 6;

/**
 * A dead-centre hit, and what it is worth.
 *
 * The bullseye used to be a score bonus and nothing else, and it was gated
 * behind the PERFECT upgrade -- so for most of a run the middle of a target
 * was worth exactly as much as its edge, and aiming carefully bought nothing
 * at all. It now doubles the damage of the shot, always, from level 1 and with
 * no upgrade taken.
 *
 * That is the whole reason a two-unit target is interesting: it is one tap for
 * a player who hits the middle, one tap for a player who bought POWER, and two
 * taps for everybody else. PERFECT then stacks on top of the doubling rather
 * than switching it on, which turns it from a score trinket into the other
 * half of a precision build.
 */
const BULLSEYE_SPOT = 0.4;
const BULLSEYE_DAMAGE = 2;
const BULLSEYE_SCORE = 1.25;

/**
 * The spam round's payout curve.
 *
 * Every tap is worth more than the last, up to a ceiling. The ramp is what
 * makes the round feel like it is building instead of like a chore, and the
 * ceiling is what stops seven seconds on level four from being worth more than
 * the ten levels after it -- a treat has to be a treat and not a strategy.
 */
const SPAM_RAMP = 0.045;
const SPAM_CAP = 4;

/** Paid per tap again at the end, so the last second is the loudest one. */
const SPAM_BONUS = 90;

/**
 * What the lightning is worth.
 *
 * It used to jump 300px for three quarters of a full shot, four times over --
 * which on a busy board cleared half of it off one tap and asked nothing of
 * the player's aim. Half damage over a shorter reach makes it a finisher on a
 * cluster rather than a substitute for shooting.
 */
const CHAIN_DAMAGE = 0.5;
const CHAIN_REACH = 230;

/**
 * The rank bar's colour. Deliberately not the zone accent: everything else on
 * screen changes when the world does, and the one readout that is *the
 * player's own progress* should look the same in all seven places.
 */
const RANK_COLOR = 0xb388ff;
const RANK_GOLD = 0xffd23f;

/** Streak milestone colours -- shared by the caption and the combo ramp. */
const STREAK_COLORS = [ 0x6cf5c8, 0x3fe0ff, 0xb388ff, 0xff5ce0, 0xffb020, 0xff4d3d ];

/** The combo display escalates one step every 5 kills. */
const COMBO_STEP = 5;
const COMBO_MAX_TIER = 8;
const COMBO_RAMP = [
    0x9fe8ff, 0x6cf5c8, 0x62ffb8, 0xb388ff, 0xff7ae0, 0xff5ce0, 0xffb020, 0xff7a3d, 0xff3b45
];

const COMBO_Y = HUD.comboY;
const BAR_RIGHT = HUD.barRight;

/** A fraction of the way down the arena, whatever shape the arena is. */
function arenaY (t: number): number
{
    return PLAY.top + (PLAY.bottom - PLAY.top) * t;
}

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
    private trails!: Trails;
    private backdrop!: Backdrop;
    private doors!: Doors;

    private targets: Target[] = [];
    /**
     * `intro` is the beat between the doors opening and the clock starting;
     * `rank` is the frozen moment a rank-up hand is on the table.
     */
    private state: 'intro' | 'spam' | 'play' | 'rank' | 'menu' | 'done' = 'intro';
    /** The hand currently being dealt, if any. */
    private levelUp: LevelUpPanel | null = null;
    /** True when this level owes the player a first look at its zone's rule. */
    private teaching = false;
    private showRule = false;
    private showHazard = false;
    private revived = false;
    /** True when the level was bought past rather than cleared. */
    private skipped = false;

    private timeLeft = 0;
    private timeTotal = 0;
    private spawnTimer = 0;
    /** Ordered runs currently on the board. Emptied as each finishes. */
    private chains: Chain[] = [];
    /** The fight that closes this world, on the levels that have one. */
    private boss: BossFight | null = null;
    /** Taps landed on the drum this spam round, and what the next one pays. */
    private spamTaps = 0;
    private spamLeft = 0;
    private drum: Target | null = null;
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
    private comboTier = 0;
    private timeText!: GameObjects.Text;
    private timeIcon!: GameObjects.Image;
    private timeIconScale = 1;
    private goalText!: GameObjects.Text;
    private rankText!: GameObjects.Text;
    /** Eased fill of the rank bar, so a big kill sweeps rather than snaps. */
    private xpShown = 0;
    private xpFlash = 0;
    private streakText!: GameObjects.Text;
    private streakKey = '';
    private multText!: GameObjects.Text;
    /**
     * The three bought multipliers -- XP, SCORE and COINS -- each riding on
     * the readout it multiplies.
     *
     * They are the only cards on the board whose effect is invisible at the
     * moment it is taken: POWER kills faster, MAGNET widens the tap, but XP
     * BOOST only makes a bar that was already moving move slightly faster.
     * Stamping the running total next to the number it acts on turns three
     * cards the player had to take on trust into three numbers that visibly
     * go up every time they are taken.
     */
    private xpMultText!: GameObjects.Text;
    private scoreMultText!: GameObjects.Text;
    private coinMultText!: GameObjects.Text;
    /**
     * COMBO TIME's chip, which is not one of the three: the window is a
     * duration, not a multiplier, and it hangs off a readout that already says
     * "COMBO x12" -- a second `x1.25` next to that would read as part of the
     * combo count. It shows the window itself, in seconds.
     */
    private comboWindowChip!: IconLabel;
    /** Last value each chip showed, so only a chip that moved gets bumped. */
    private multShown: Record<string, number> = { xp: 0, score: 0, coin: 0, window: 0 };
    private muteBtn!: GameObjects.Image;
    /** The parts on the gun, as a rail up the left margin. */
    private build!: BuildStrip;
    private turret!: Turret;
    /** The bought second gun, when the run paid for one. */
    private wingmen: Wingman[] = [];
    private wingTimer = 0;
    /**
     * The ability currently running the gun, and what is left of it.
     *
     * See core/abilities. The orb that hands it over is scheduled on the
     * level's clock (`orbAt`, in ms of `timeLeft`) rather than rolled from the
     * spawn table, so the level that owes the player one always pays.
     */
    private ability: AbilityId | null = null;
    private abilityLeft = 0;
    private abilityBanner!: AbilityBanner;
    private orbAt = -1;
    private orbId: AbilityId = 'mayhem';
    /** The temporary pods the SENTRY ability brings in. */
    private sentries: Wingman[] = [];
    private sentryTimer = 0;
    /** The STATIC LASER beam, redrawn every frame it is on. */
    private laserGfx!: GameObjects.Graphics;
    private laserSpark = 0;
    /** MAYHEM's bolts in flight. */
    private bolts!: Bolts;
    /** Damage scale on the shot in flight -- the ability weapons hit harder. */
    private shotMult = 1;
    /** A blast does not care which link is next: set while a bomb lands. */
    private shotIgnoresLock = false;
    private skin!: TargetSkin;
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

        this.skin = equippedSkin();

        this.targets = [];
        this.chains = [];
        this.boss = null;
        this.drum = null;
        this.spamTaps = 0;
        this.spamLeft = 0;
        this.wingmen = [];
        this.wingTimer = WINGMAN_DELAY;
        this.sentries = [];
        this.sentryTimer = 0;
        this.ability = null;
        this.abilityLeft = 0;
        this.shotMult = 1;
        this.laserSpark = 0;
        this.state = 'intro';
        this.revived = false;
        this.skipped = false;
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
        this.comboTier = 0;
        this.streakKey = '';
        this.levelUp = null;
        this.xpShown = run.xpFrac;
        this.xpFlash = 0;

        //  Two separate debts, and either one buys the level its empty field:
        //  the zone's rule, owed once per zone, and the level's new threat,
        //  owed once per threat. Glass arriving mid-zone has to be allowed to
        //  stop the board just as a zone opening does.
        this.showRule = isZoneStart(run.level) && !run.zonesSeen[this.zone.index];
        this.showHazard = teachesHazard(run.level) !== 'none' && !run.hazardsSeen[teachesHazard(run.level)];
        this.teaching = this.showRule || this.showHazard;

        this.cameras.main.setBackgroundColor(this.tier.bg);

        this.backdrop = new Backdrop(this, this.zone);

        //  The weather is the level's difficulty made visible: the same numbers
        //  drive the art and the rule.
        this.backdrop.gust = this.hazard.gust;
        this.backdrop.storm = this.hazard.storm;

        this.fx = new Fx(this, 20);

        //  Behind the board, never over it: a wake is allowed to be seen and
        //  never allowed to hide the thing it is trailing from.
        this.trails = new Trails(this, 9);

        this.hazards = new Hazards(this, this.hazard, this.tier, this.fx, {
            onLanded: (ms: number) => this.boltLanded(ms)
        });

        this.buildHud();

        //  The orb is booked against the clock, so the levels that owe one
        //  always deliver it, and at the moment on the level it was meant for.
        const plan = abilityPlan(run.level, !!this.cfg.boss);

        this.orbAt = plan ? this.timeTotal * (1 - plan.at) : -1;
        this.orbId = plan ? plan.id : 'mayhem';

        this.laserGfx = this.add.graphics().setDepth(26).setBlendMode('ADD');
        this.bolts = new Bolts(this, 26);
        this.abilityBanner = new AbilityBanner(this);

        //  A weapon still on its clock from the last screen picks up here.
        if (run.ability)
        {
            this.activateAbility(run.ability.id, this.turret.tipX, this.turret.tipY, run.ability.left);
            run.ability = null;
        }

        if (!this.cfg.boss && !this.cfg.spam && !this.teaching)
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
            if (this.state !== 'play' && this.state !== 'spam') return;
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
                //  Straight to the beats that are not demonstrations -- the
                //  boss warning and the spam round. A level with neither falls
                //  through those and starts its clock, which is every ordinary
                //  level in the run.
                this.afterDemos();
                return;
            }

            //  A level can owe the player two demonstrations: how the world
            //  behaves, and what is trying to stop them. They play back to
            //  back, in that order, and each is only ever paid once -- the
            //  rule per zone, the threat per threat.
            const signature = teachesHazard(run.level);

            let rule = 1;

            if (this.showRule)
            {
                run.zonesSeen[this.zone.index] = true;
                rule = Math.max(1, gimmickIntro(this, this.zone, this.fx));
            }

            this.time.delayedCall(rule, () =>
            {
                if (!this.showHazard)
                {
                    this.afterDemos();
                    return;
                }

                run.hazardsSeen[signature] = true;

                const shown = hazardIntro(this, signature, this.tier, this.fx);

                this.time.delayedCall(Math.max(1, shown), () => this.afterDemos());
            });
        });
    }

    /**
     * Everything a level owes the player before its clock is allowed to start.
     *
     * The zone rule and the threat demo have already had their turn by the
     * time this runs. Two things can still be waiting: the warning card on a
     * boss level, and the spam round. Both are paid for out of the same
     * budget -- the beat between the doors opening and the countdown starting
     * -- because both are things being *given* to the player, and charging a
     * gift to the clock the player is about to be judged on is how a reward
     * turns into a tax.
     */
    private afterDemos (): void
    {
        if (this.cfg.boss)
        {
            const wait = this.warnOfBoss();
            this.time.delayedCall(wait, () => this.openSpam());
            return;
        }

        this.openSpam();
    }

    /**
     * THE WARNING.
     *
     * A boss is the only thing in the run that can take a whole level off the
     * player in one object, so it is the only thing that gets told to them in
     * words before it arrives. Two lines: what it is called, and the one thing
     * they have to do about it -- and then a beat of empty arena to read them
     * in, because a warning delivered over a board that is already moving is
     * not a warning.
     */
    private warnOfBoss (): number
    {
        const spec = bossFor(run.level);

        if (!spec) return 1;

        const mid = arenaY(0.42);

        this.cameras.main.shake(420, 0.006);
        Sfx.launch();

        const bar = this.add.rectangle(CX, mid, W, 132, 0x000000, 0.55).setDepth(39);
        bar.setScale(1, 0);

        const name = this.add.text(CX, mid - 22, spec.name, {
            fontFamily: FONT, fontSize: 54, color: '#ff2d55', stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setDepth(40).setAlpha(0);

        const tell = this.add.text(CX, mid + 34, spec.tell, {
            fontFamily: FONT_UI, fontSize: 19, color: '#ffd7de'
        }).setOrigin(0.5).setDepth(40).setAlpha(0);

        this.tweens.add({ targets: bar, scaleY: 1, duration: 180, ease: 'Quad.out' });
        this.tweens.add({ targets: [ name, tell ], alpha: 1, duration: 200, delay: 120 });
        this.tweens.add({ targets: name, scale: { from: 1.35, to: 1 }, duration: 340, delay: 120, ease: 'Back.out' });

        this.time.delayedCall(1500, () =>
        {
            this.tweens.add({
                targets: [ bar, name, tell ],
                alpha: 0,
                duration: 220,
                onComplete: () => { bar.destroy(); name.destroy(); tell.destroy(); }
            });
        });

        return 1780;
    }

    /**
     * THE SPAM ROUND.
     *
     * A drum the size of the arena, alone on an empty field, that cannot be
     * killed and pays for every single tap. There is no aim test -- it is
     * enormous and it does not move -- no order to read, no bomb to avoid and
     * no way at all to lose: for seven seconds the only variable in the game
     * is how fast the player's hand is, and every one of those taps is worth
     * points that go straight onto the level's score.
     *
     * It is spent on the doorway into the third world: the skyline's boss has
     * just been beaten and the storm has not started yet, which is the loudest
     * the player is ever going to feel between two levels. Landing it earlier
     * put it a level after the first vault, where it was the second treat in a
     * row and the run had handed out two gifts before it had asked for
     * anything -- this way it reads as what the world they just finished was
     * worth.
     *
     * It runs before the level's clock starts for the same reason the vault
     * has no goal: a gift charged to the countdown the player is about to be
     * judged on is not a gift.
     */
    private openSpam (): void
    {
        const secs = this.cfg.spam || 0;

        if (secs <= 0 || this.state !== 'intro')
        {
            this.beginPlay();
            return;
        }

        this.state = 'spam';
        this.spamTaps = 0;
        this.spamLeft = secs * 1000;

        const t = new Target(this, CX, arenaY(0.42), 'spam', this.cfg.size, run.level, 0, false);

        t.endless = true;
        t.setLifetime(this.spamLeft);
        t.setDepth(10);

        this.drum = t;
        this.targets.push(t);

        this.fx.popup(CX, arenaY(0.1), 'SPAM ROUND', 0xffd23f, 46, 44, 1100);
        this.fx.popup(CX, arenaY(0.17), 'HIT IT AS FAST AS YOU CAN', 0xfff3b0, 20, 30, 1100);
        this.fx.ring(CX, arenaY(0.42), t.radius * 2.6, 0xffd23f, 7, 520);
        Sfx.jackpot();
    }

    /**
     * One tap on the drum.
     *
     * The payout climbs with the count rather than being flat, because a flat
     * one turns the round into a test of whether the player can be bothered.
     * It is capped, so the round is worth about the same to a fast hand as a
     * good level is -- generous, and not a way to farm the whole run out of
     * seven seconds on level four.
     */
    private spamHit (px: number, py: number): void
    {
        const t = this.drum;

        if (!t) return;

        this.spamTaps += 1;

        const step = Math.min(SPAM_CAP, 1 + this.spamTaps * SPAM_RAMP);
        const gain = Math.round(KINDS.spam.score * step * (1 + run.level * 0.12) * this.stats.scoreMult);

        this.levelScore += gain;
        this.levelCoins += KINDS.spam.coins;
        bankCoins(KINDS.spam.coins);

        this.gainXp(Math.round(xpWorth(KINDS.spam.xp, run.level) * this.stats.xpMult), t.x, t.y);

        //  Every tap lands where the player actually tapped, so a fast hand
        //  paints the drum rather than stacking one popup on the middle of it.
        this.fx.burst(px, py, 0xffd23f, 9, 'gold');
        this.fx.popup(px, py - 18, fmtShort(gain), 0xffffff, 22 + Math.min(14, this.spamTaps * 0.3), 46, 420);

        //  It bulges instead of flinching. Nothing here is being hurt.
        this.tweens.killTweensOf(t);
        t.setScale(1.09);
        this.tweens.add({ targets: t, scale: 1, duration: 110, ease: 'Quad.out' });

        if (this.spamTaps % 10 === 0)
        {
            this.fx.ring(t.x, t.y, t.radius * 2.2, 0xffd23f, 5, 320);
            this.fx.popup(t.x, t.y - t.radius - 30, `x${this.spamTaps}`, 0xffd23f, 30, 54, 560);
            this.fx.fly(t.x, t.y, COIN_HUD.x - 14, COIN_HUD.y, 0xffc857, () => this.bumpCoins());
            Sfx.milestone(Math.min(3, Math.floor(this.spamTaps / 20)));
        }
        else
        {
            Sfx.cash(this.spamTaps);
        }

        this.updateScoreText();
    }

    /** The drum's clock has run out. It pays for the whole run of taps and goes. */
    private closeSpam (): void
    {
        const t = this.drum;

        this.drum = null;

        if (t)
        {
            const i = this.targets.indexOf(t);
            if (i !== -1) this.targets.splice(i, 1);

            this.fx.burst(t.x, t.y, 0xffd23f, 40, 'gold');
            this.fx.ring(t.x, t.y, t.radius * 4, 0xffd23f, 8, 560);
            t.destroy();
        }

        const bonus = Math.round(this.spamTaps * SPAM_BONUS * (1 + run.level * 0.12) * this.stats.scoreMult);

        this.levelScore += bonus;
        this.cameras.main.flash(200, 255, 220, 120);
        this.cameras.main.shake(240, 0.01);

        this.fx.popup(CX, arenaY(0.3), `${this.spamTaps} HITS`, 0xffd23f, 44, 52, 1000);
        this.fx.popup(CX, arenaY(0.38), fmtShort(bonus), 0xffffff, 40, 60, 1000);

        Sfx.jackpot();
        this.updateScoreText();

        this.time.delayedCall(820, () =>
        {
            this.state = 'intro';
            this.beginPlay();
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

        if (this.cfg.boss) this.spawnBoss();
        else if (this.teaching || this.cfg.spam) this.openingTargets();

        //  The targets that were standing behind the doors have been ageing on
        //  screen; the clock starting is the first moment their timer is real.
        for (const t of this.targets) t.setLifetime(t.maxLife);

        setGameplayActive(true);

        //  The glass goes up and the core arms itself with the clock, not with
        //  the scene -- nothing shoots at a player who is still watching a door.
        this.hazards.start();
    }

    //  ---------------------------------------------------------------- setup

    /**
     * The build, as a rail up the left margin.
     *
     * It used to be a row along the footer, and the footer turned out to be
     * the one line of the screen it could not have: the gun swings almost flat
     * and is most of a screen wide by the end of a run, so a row down there is
     * a row lying across the barrels. The left margin is the opposite -- the
     * arena is inset from it, the gun never reaches it, and it is the one band
     * of the screen with nothing else in it.
     *
     * It grows upward off a fixed point rather than centring, so taking a part
     * adds a chip on the end instead of shifting every chip the player had
     * already learned the position of.
     */
    private buildStrip (): void
    {
        const foot = PLAY.bottom - 26;

        this.build = new BuildStrip(this, HUD.margin - 8, foot, {
            iconSize: 22,
            spacing: 30,
            maxWidth: foot - (PLAY.top + 8),
            vertical: true,
            plate: true,
            alpha: 0.9
        }).setDepth(33);
    }

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

        //  The rank chip: the label for the bar pinned above it, sitting in the
        //  strip of margin the route rail was moved sideways to leave free.
        this.rankText = this.add.text(HUD.margin, HUD.rankY, `RANK ${run.rank}`, {
            fontFamily: FONT, fontSize: 18, color: hex(RANK_COLOR)
        }).setOrigin(0, 0.5).setDepth(32);

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

        //  One line under the combo: what the streak is worth next. The
        //  six-gem track that used to say the same thing is gone.
        this.streakText = this.add.text(CX, HUD.streakTextY, '', {
            fontFamily: FONT, fontSize: 15, color: '#7d88b0'
        }).setOrigin(0.5, 0.5).setDepth(31);

        this.multText = this.add.text(HUD.margin - 2, HUD.streakTextY, '', {
            fontFamily: FONT, fontSize: 20, color: '#b388ff'
        }).setOrigin(0, 0.5).setDepth(31).setAlpha(0);

        //  Colours are the cards': the XP chip is the purple of XP BOOST and of
        //  the rank bar it sits on, SCORE is the mint of its own card, COINS is
        //  the gold of the gem it hangs off.
        this.xpMultText = this.multChip(RANK_COLOR, 0);
        this.scoreMultText = this.multChip(0x6cf5c8, 0);
        this.coinMultText = this.multChip(0xffc857, 1);

        this.comboWindowChip = new IconLabel(this, CX, COMBO_Y, 'hourglass', '', {
            align: 'left', fontSize: 15, iconSize: 14, gap: 5,
            color: hex(0x62ffb8), iconColor: 0x62ffb8
        });
        this.comboWindowChip.setDepth(31).setVisible(false);

        this.refreshMultChips();

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

        this.buildSkipPill();
        this.buildQuitButton();
        this.buildStrip();

        this.turret = new Turret(this, this.tier, this.look);

        //  The bought gun stands off to the side of the player's own, low and
        //  out of the arena, where it can never hide a target.
        if (run.has('wingman'))
        {
            const y = Math.min(H - 34, PLAY.bottom + 52);

            this.wingmen.push(new Wingman(this, PLAY.left - 8, y, this.tier, -1));
            this.wingmen.push(new Wingman(this, PLAY.right + 8, y, this.tier, 1));
        }
    }

    private multChip (color: number, originX: number): GameObjects.Text
    {
        return this.add.text(0, 0, '', {
            fontFamily: FONT, fontSize: 17, color: hex(color), stroke: '#000000', strokeThickness: 4
        }).setOrigin(originX, 0.5).setDepth(32).setVisible(false);
    }

    /**
     * Re-reads the chips off the current build. Called once on open and again
     * on every pick, with the id of the card that was just taken.
     *
     * Only that card's own chip pops. The XP number is nudged by *every* pick
     * -- see `pickXpBonus` in core/state, where a part on the gun is worth
     * +1.2% XP whatever the part does -- and popping the rank bar for a card
     * that has nothing to do with XP claims a link that is not there. The
     * creep still shows in the number, because the number is what XP the
     * player is actually earning; it just no longer takes a bow for it.
     */
    private refreshMultChips (from = ''): void
    {
        this.setMultChip(this.xpMultText, 'xp', this.stats.xpMult, from === 'xp');
        this.setMultChip(this.scoreMultText, 'score', this.stats.scoreMult, from === 'score');
        this.setMultChip(this.coinMultText, 'coin', this.stats.coinMult, from === 'greed');
        this.setComboWindowChip(from === 'window');
        this.layoutMultChips();
    }

    private setMultChip (t: GameObjects.Text, key: string, value: number, bump: boolean): void
    {
        //  Below a percent the chip would read "x1.00", which is a number
        //  saying nothing. It stays off the screen until something buys it.
        if (value <= 1.005)
        {
            t.setVisible(false);
            this.multShown[key] = value;
            return;
        }

        t.setText(`x${value.toFixed(2)}`).setVisible(true);

        if (bump && value > this.multShown[key] + 0.001) this.popChip(t);

        this.multShown[key] = value;
    }

    /** The window, in seconds, and only once something has lengthened it. */
    private setComboWindowChip (bump: boolean): void
    {
        const ms = this.stats.comboWindow;
        const on = ms > baseStats().comboWindow + 1;

        this.comboWindowChip.setVisible(on);

        if (on)
        {
            this.comboWindowChip.setValue(`${(ms / 1000).toFixed(1)}s`);
            if (bump && ms > this.multShown.window + 1) this.popChip(this.comboWindowChip);
        }

        this.multShown.window = ms;
    }

    private popChip (t: GameObjects.Text | IconLabel): void
    {
        t.setScale(1.7);
        this.tweens.add({ targets: t, scale: 1, duration: 280, ease: 'Back.out' });
    }

    /**
     * Each chip is parked off the edge of the readout it belongs to, and the
     * readouts all change width as the run goes -- the rank number grows a
     * digit, the score grows four -- so this runs with the rest of the HUD
     * rather than once at build time.
     */
    private layoutMultChips (): void
    {
        this.xpMultText.setPosition(this.rankText.x + this.rankText.width + 8, this.rankText.y);

        //  Score is centred and unbounded, so the chip rides its right edge and
        //  is stopped at the margin rather than being allowed off screen.
        //  Off the *displayed* width, so the pop each readout does when it
        //  gains nudges its chip aside instead of being drawn over it.
        const scoreX = Math.min(
            W - HUD.margin - this.scoreMultText.width,
            CX + this.scoreText.displayWidth / 2 + 10
        );

        this.scoreMultText.setPosition(scoreX, HUD.scoreY + 2);

        //  The gem readout is right-aligned, so the chip goes on its far side.
        const coinInset = this.coinLabel.icon.x - this.coinLabel.icon.displayWidth / 2;
        const coinLeft = this.coinLabel.x + coinInset * this.coinLabel.scaleX;

        this.coinMultText.setPosition(coinLeft - 10, COIN_HUD.y);

        //  Off CX and the combo readout's unscaled width, so the chip neither
        //  breathes with the combo text nor catches its jitter at high tiers.
        //  The floor keeps it in the same place on the line while there is no
        //  combo up and the readout is empty.
        const comboHalf = Math.max(this.comboText.width / 2, 46);

        this.comboWindowChip.setPosition(CX + comboHalf + 12, COMBO_Y);
    }

    /**
     * The way out of a run, on the footer line beside the mute icon -- below
     * the arena, where no target ever spawns and no shot is ever aimed.
     */
    private buildQuitButton (): void
    {
        quitButton(this, W - HUD.margin - 62, HUD.footerY, {
            cost: 'Your run ends here. Coins you have already collected are kept.',
            enabled: () => this.state === 'play',
            hold: () =>
            {
                this.state = 'menu';
                setGameplayActive(false);
            },
            resume: () =>
            {
                if (this.state !== 'menu') return;

                this.state = 'play';
                setGameplayActive(true);
            },
            quit: () => this.quitToMenu()
        }).setDepth(32);
    }

    /**
     * LEVEL SKIP, in the bottom-left corner and only when one is in the bag.
     *
     * It used to live on the upgrade screen, which no longer exists. Putting it
     * in the play HUD is a better home than the one it lost: the player can now
     * spend it the moment a level turns out to be the one they do not want,
     * rather than having to have guessed that from the level number on a menu.
     */
    private buildSkipPill (): void
    {
        const boost = BOOST_BY_ID.skip;

        if (boostCount(boost.id) <= 0 || run.level >= FINAL_LEVEL) return;

        const w = 128;
        const h = 40;
        const pill = this.add.container(HUD.margin + w / 2 - 4, HUD.footerY).setDepth(32).setAlpha(0.75);

        const g = this.add.graphics();
        g.fillStyle(0x0b1024, 0.85);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 13);
        g.lineStyle(2, boost.color, 0.7);
        g.strokeRoundedRect(-w / 2, -h / 2, w, h, 13);
        pill.add(g);

        pill.add(iconImage(this, -w / 2 + 22, 0, boost.icon, { size: 18, color: boost.color }));

        const label = this.add.text(-w / 2 + 38, 0, `SKIP x${boostCount(boost.id)}`, {
            fontFamily: FONT, fontSize: 15, color: hex(boost.color)
        }).setOrigin(0, 0.5);

        pill.add(label);

        pill.setSize(w, h);
        pill.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, w, h),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        pill.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: any) =>
        {
            if (e && e.stopPropagation) e.stopPropagation();
            unlockAudio();

            if (this.state !== 'play' || run.level >= FINAL_LEVEL || !spendBoost(boost.id))
            {
                Sfx.dry();
                return;
            }

            pill.destroy();

            //  A level bought past is cleared, not played: the goal bar fills
            //  so the exit reads the way every other exit does, and the clean
            //  sweep bonus is withheld because nothing was swept.
            this.skipped = true;
            this.progress = this.cfg.goal;

            this.fx.burst(pill.x, pill.y, boost.color, 22, 'hit');
            this.levelComplete();
        });
    }

    /**
     * The paint and the silhouette a target is dressed in.
     *
     * Colour and shape are two separate permissions. The rank and file get
     * both: the zone picks their colours and the skin paints over them. A
     * power-up keeps its own colour -- money has to read as money from the
     * corner of the eye, in every zone and under every skin -- but still takes
     * the shape, so a bought skin is visible on the whole board rather than on
     * two thirds of it.
     *
     * The bomb and the boss get neither. Those two are the only targets where
     * mistaking one for something else costs the player the run, and a skin is
     * never allowed to make that mistake easier.
     */
    private dress (kind: TargetKind): { skin?: Skin; style?: TargetStyle }
    {
        if (kind === 'bomb' || kind === 'boss') return {};

        const base = skinFor(this.zone, kind);

        //  Only the rank and file wear the face; a power-up takes the
        //  silhouette and the wake and keeps its own glyph unobstructed.
        return base
            ? { skin: paintOf(this.skin, base), style: styleOf(this.skin) }
            : { style: styleOf(this.skin, false) };
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
        //  A chain takes several slots at once, so it is decided before the
        //  kind is rolled and only when there is actually room for the whole
        //  run. Half a chain would be a chain the player cannot finish.
        if (!standing && this.hazard.chainChance > 0 && Math.random() < this.hazard.chainChance)
        {
            const len = this.hazard.chainLen;

            if (this.targets.length + len <= this.cfg.maxActive + 1)
            {
                this.spawnChain(len);
                return;
            }
        }

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

        const dress = this.dress(kind);
        const t = new Target(this, spot.x, spot.y, kind, this.cfg.size, run.level, speed, moving, dress.skin, dress.style);

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

        //  The goal counter on a boss level is the boss's health (see the
        //  update loop), so an add that carried progress would be writing into
        //  a readout that means something else entirely.
        if (this.boss) t.progressWorth = 0;

        seedTarget(this.zone.gimmick, t, run.level, this.hazard);

        this.targets.push(t);
    }

    /**
     * A kind fit to be welded into a chain.
     *
     * Bombs are out: a link the player is *made* to shoot, that costs them
     * their combo for shooting it, is a trap rather than a puzzle. Power-ups
     * are out too, for the opposite reason -- a prize locked behind two other
     * targets stops being a prize and starts being homework.
     */
    private chainKind (): TargetKind
    {
        for (let i = 0; i < 8; i++)
        {
            const kind = pickKind(this.cfg.weights);

            if (kind !== 'bomb' && !isPowerup(kind)) return kind;
        }

        return 'normal';
    }

    /**
     * An ordered run, laid out along a line.
     *
     * The links are placed nose to tail with a gap between them and the whole
     * line is dropped somewhere it fits, so the rope reads as a rope rather
     * than as three targets that happen to be near each other. They are given
     * a longer clock than a loose target because they cannot all be taken at
     * once -- the last link has to wait its turn, and charging it for the wait
     * would make the rule unfair rather than hard.
     */
    private spawnChain (len: number): void
    {
        const size = this.cfg.size;
        const step = size * 2.9;
        const reach = (step * (len - 1)) / 2;

        //  Kept off the walls by the length of the whole run, so the far links
        //  never end up clamped on top of each other in a corner.
        const anchor = this.freeSpot(size + reach * 0.5);
        const angle = Math.random() * Math.PI * 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        const members: Target[] = [];
        const moving = Math.random() < this.cfg.moveChance * 0.6;

        for (let i = 0; i < len; i++)
        {
            const kind = this.chainKind();
            const radius = size * KINDS[kind].sizeMult;
            const off = (i - (len - 1) / 2) * step;

            const x = Math.max(PLAY.left + radius, Math.min(PLAY.right - radius, anchor.x + dx * off));
            const y = Math.max(PLAY.top + radius, Math.min(PLAY.bottom - radius, anchor.y + dy * off));

            const dress = this.dress(kind);
            const t = new Target(this, x, y, kind, size, run.level, this.cfg.speed * 0.7, moving, dress.skin, dress.style);

            t.setLifetime(this.cfg.lifetime * (1 + 0.4 * len));
            t.setDepth(10);

            seedTarget(this.zone.gimmick, t, run.level, this.hazard);

            members.push(t);
            this.targets.push(t);
        }

        this.chains.push(new Chain(this, this.tier, members));
    }

    /**
     * A link left the board, however it left. The chain closes up behind it,
     * and a chain that ran out of links pays for having been finished.
     *
     * The bonus is the reason a chain is a play and not a tax: taking one in
     * order is slower than taking three loose targets, and it has to be worth
     * more or the correct move would be to ignore chains and let them expire.
     */
    private releaseChain (t: Target, killed: boolean): void
    {
        const chain = t.chain;

        if (!chain) return;

        const last = chain.members.length === 1;

        chain.release(t);

        if (!chain.done) return;

        const i = this.chains.indexOf(chain);

        if (i !== -1) this.chains.splice(i, 1);

        const len = chain.length;

        chain.destroy();

        //  Only a chain the player actually broke pays. One that fell apart on
        //  its own timer was never completed.
        if (!killed || !last) return;

        const gain = Math.round(500 * len * (1 + run.level * 0.12) * this.stats.scoreMult * (1 + this.streakBonus()));

        this.levelScore += gain;

        this.fx.popup(t.x, t.y - 54, `CHAIN x${len}`, 0xffd23f, 30, 58, 720);
        this.fx.popup(t.x, t.y - 14, fmtShort(gain), 0xffffff, 32, 66);
        this.fx.ring(t.x, t.y, 170, 0xffd23f, 6, 460);

        Sfx.milestone(Math.min(3, len - 1));
        this.updateScoreText();
    }

    /** Every chain torn down at once, when the level stops. */
    private clearChains (): void
    {
        for (const c of this.chains) c.destroy();

        this.chains = [];

        //  The fight's rings are drawn on graphics of its own, and a level
        //  that ended some other way -- the clock, a quit, a skip -- would
        //  otherwise leave them turning over the next one.
        this.boss?.destroy();
        this.boss = null;
    }

    /**
     * The two halves a split leaves behind. They are smaller, briefer and
     * cannot split again, so the rule reads as a bonus rather than a spiral.
     *
     * They are also on a short fuse and a tight cap, and both of those numbers
     * are load-bearing. A half is worth score and coins but nothing at all
     * towards the goal, so a board carrying a dozen of them is a board the
     * player cannot make progress on -- which is exactly what the last world
     * turned into when they hung around for a full lifetime and were allowed
     * to overflow the cap by four.
     */
    private splitInto (x: number, y: number, radius: number): void
    {
        if (this.state !== 'play') return;

        //  Late in the zone a kill comes apart into three, not two.
        const pieces = this.hazard.splitCount;

        for (let i = 0; i < pieces; i++)
        {
            if (this.targets.length >= this.cfg.maxActive + 2) return;

            const side = pieces === 2 ? (i === 0 ? -1 : 1) : i - 1;
            const size = Math.max(14, radius * (pieces > 2 ? 0.54 : 0.62));
            const px = Math.max(PLAY.left + size, Math.min(PLAY.right - size, x + side * radius * 0.9));
            const py = Math.max(PLAY.top + size, Math.min(PLAY.bottom - size, y));

            const dress = this.dress('small');
            const t = new Target(this, px, py, 'small', size / KINDS.small.sizeMult, run.level, this.cfg.speed, true, dress.skin, dress.style);
            t.setLifetime(this.cfg.lifetime * 0.45);
            t.setDepth(10);
            t.noSplit = true;
            t.progressWorth = 0;

            this.targets.push(t);
        }
    }

    /**
     * The fight itself, stood up the moment the warning card clears.
     *
     * Everything about *how* it is killed lives in core/bossfight; the scene's
     * whole side of the deal is four hooks -- put a body on the board, weld a
     * run of them together, find somewhere to blink to, and fire the flak --
     * plus one question asked on every shot (see `applyShot`). No mechanic
     * gets a branch anywhere else in this file, which is the only reason seven
     * of them fit.
     */
    private spawnBoss (): void
    {
        const spec = bossFor(run.level);

        if (!spec) return;

        this.boss = new BossFight(this, spec, this.tier, run.level, this.cfg.size, this.fx, {
            add: (t: Target) => this.targets.push(t),
            dress: () => this.dress('normal'),
            weld: (c: Chain) => this.chains.push(c),
            freeSpot: (r: number) => this.freeSpot(r),
            salvo: (n: number) => this.hazards.salvo(n)
        });

        this.fx.popup(CX, arenaY(0.12), spec.name, 0xff2d55, 40, 40, 900);
        Sfx.bomb();
        this.cameras.main.shake(300, 0.012);
    }

    /**
     * The fight is over.
     *
     * The bounty is paid here rather than through the kill that ended it,
     * because on three of the seven the kill that ends it is the smallest one
     * in the fight -- the hydra's last quarter-sized head is worth a fraction
     * of the body it came out of, and paying the world's exam out of *that*
     * would have made finishing the hardest fight in a zone feel like popping
     * a stray target.
     */
    private bossDown (): void
    {
        const spec = bossFor(run.level);
        const spot = this.boss ? this.boss.focus : { x: CX, y: arenaY(0.35) };

        this.boss?.destroy();
        this.boss = null;

        if (!spec) return;

        const gain = Math.round(spec.units * 420 * (1 + run.level * 0.12) * this.stats.scoreMult * (1 + this.streakBonus()));
        const coins = Math.round(spec.bounty * this.stats.coinMult);

        this.levelScore += gain;
        this.levelCoins += coins;
        bankCoins(coins);
        this.gainXp(Math.round(xpWorth(spec.units * 26, run.level) * this.stats.xpMult), spot.x, spot.y);

        this.cameras.main.flash(300, 255, 90, 120);
        this.cameras.main.shake(420, 0.016);

        this.fx.burst(spot.x, spot.y, 0xff2d55, 44, 'gold');
        this.fx.ring(spot.x, spot.y, 300, 0xff2d55, 9, 620);
        this.fx.popup(CX, arenaY(0.24), `${spec.name} DOWN`, 0xff2d55, 44, 46, 1000);
        this.fx.popup(CX, arenaY(0.33), fmtShort(gain), 0xffffff, 40, 58, 1000);

        for (let i = 0; i < 14; i++)
        {
            this.time.delayedCall(i * 45, () => this.fx.fly(spot.x, spot.y, COIN_HUD.x - 14, COIN_HUD.y, 0xffc857, () => this.bumpCoins()));
        }

        Sfx.jackpot();
        this.updateScoreText();

        //  The goal *is* the boss on a boss level, so finishing it finishes
        //  the level -- there is never a tail of stragglers to mop up after
        //  the thing the level was about is already dead.
        this.progress = this.cfg.goal;

        if (this.state === 'play') this.levelComplete();
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

        this.nextShot = now + this.fireRate;

        //  The drum answers to none of what follows -- no obstacles, no
        //  bullseye, no crit, no combo, no miss. A tap is on it or it is not.
        if (this.state === 'spam')
        {
            const drum = this.drum;

            this.turret.fire(px, py, 1);

            const m = this.turret.tipFor(0);
            this.fx.beam(m.x, m.y, px, py, this.beam);

            if (drum && drum.contains(px, py, this.stats.hitRadius)) this.spamHit(px, py);
            else Sfx.dry();

            return;
        }

        //  The ability weapons are their own guns entirely. The beam does not
        //  answer to taps at all; the other two do their own thing with one.
        if (this.ability === 'laser') return;
        if (this.ability === 'mayhem') { this.shootMayhem(px, py); return; }
        if (this.ability === 'bomb') { this.shootBomb(px, py); return; }

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
        //  A locked link turns the shot away without a scratch. It is not a
        //  miss -- the player hit exactly what they aimed at -- but it is not
        //  free either: the shot, and the fire-rate delay behind it, are gone.
        if (primary && primary.chainLocked)
        {
            this.turret.fire(px, py, 1);

            const m = this.turret.tipFor(0);

            this.fx.beam(m.x, m.y, px, py, this.beam);
            this.lockedShot(primary);

            return;
        }

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
                .filter(t => !t.dead && !hit.has(t) && t.kind !== 'bomb' && !t.chainLocked &&
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
            //  A welded chain is off limits to the extra barrels entirely --
            //  not just the links that are still shuttered. Killing the head
            //  unlocks the next one in the same frame, so a filter that only
            //  skipped *locked* links let one tap walk the whole rope, which
            //  is the exact rule the chain exists to impose.
            const others = this.targets
                .filter(t => !t.dead && !hit.has(t) && t.kind !== 'bomb' && !t.chain)
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
        const block = this.hazards.blockOn(MUZZLE.x, MUZZLE.y, px, py);

        //  Whichever of the three the shot reaches first. Concrete is checked
        //  the same way as everything else rather than given priority: a slab
        //  behind a pane is still behind the pane.
        const far = (o: { x: number; y: number } | null): number =>
            o ? Math.hypot(o.x - MUZZLE.x, o.y - MUZZLE.y) : Infinity;

        const nearest = Math.min(far(block), far(glass), far(bolt));

        if (block && far(block) === nearest)
        {
            this.turret.fire(block.x, block.y, 1);

            const m = this.turret.tipFor(0);

            this.fx.beam(m.x, m.y, block.x, block.y, this.beam);
            this.hazards.hitBlock(block.block, block.x, block.y);

            return true;
        }

        if (glass && far(glass) === nearest)
        {
            this.turret.fire(glass.x, glass.y, 1);

            const m = this.turret.tipFor(0);

            this.fx.beam(m.x, m.y, glass.x, glass.y, this.beam);

            if (this.hazards.hitPane(glass.pane, glass.x, glass.y, this.punch)) this.paneDown(glass.pane.x, glass.pane.y);

            return true;
        }

        if (bolt && far(bolt) === nearest)
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

    /**
     * Whatever is under the tap, nearest first -- but an available target
     * always beats a locked one, however the distances fall.
     *
     * Two targets can easily overlap once the wind is pushing the board
     * around, and if one of them is a shuttered chain link the player must not
     * lose the shot to it: they were plainly aiming at the thing they can
     * actually kill. The lock is a rule about order, not a shield with a
     * hitbox around it.
     */
    private pickTarget (px: number, py: number): Target | null
    {
        let best: Target | null = null;
        let bestDist = Infinity;

        for (const t of this.targets)
        {
            if (t.dead) continue;
            if (!t.contains(px, py, this.stats.hitRadius)) continue;

            if (best && best.chainLocked !== t.chainLocked)
            {
                if (t.chainLocked) continue;
            }
            else if (t.distanceTo(px, py) >= bestDist)
            {
                continue;
            }

            bestDist = t.distanceTo(px, py);
            best = t;
        }

        return best;
    }

    /**
     * A shot the boss turned away, said in the one way that tells the player
     * *why* -- because "nothing happened" is the same picture for a plate they
     * can never break, a pane they are three shots from breaking, and a body
     * that has already gone somewhere else.
     */
    private bossBlocked (t: Target, stop: GuardHit): void
    {
        if (stop.kind === 'ghost')
        {
            //  It is in the air. The shot goes through the space it left.
            this.fx.burst(stop.x, stop.y, 0xd08cff, 6, 'hit');
            Sfx.dry();
            return;
        }

        const steel = stop.kind === 'steel';
        const color = steel ? 0x8fa4c8 : 0xd8e4ff;

        t.clang(Math.atan2(MUZZLE.y - t.y, MUZZLE.x - t.x));

        this.fx.burst(stop.x, stop.y, color, steel ? 8 : 12, 'hit');
        this.fx.ring(stop.x, stop.y, t.radius * 0.9, color, 3, 250);
        this.cameras.main.shake(50, 0.0025);
        Sfx.chip();
    }

    /**
     * A shot into a link that is not next.
     *
     * The combo survives, because the player did hit what they were aiming at
     * -- being wrong about the *order* is the mistake the chain is there to
     * punish, and it punishes it with the one currency the level actually
     * runs on, which is time.
     */
    private lockedShot (t: Target): void
    {
        const from = Math.atan2(MUZZLE.y - t.y, MUZZLE.x - t.x);

        t.clang(from);

        this.fx.burst(t.x + Math.cos(from) * t.radius, t.y + Math.sin(from) * t.radius, 0x8fa4c8, 9, 'hit');
        this.fx.ring(t.x, t.y, t.radius * 2.4, 0x8fa4c8, 3, 260);
        this.fx.popup(t.x, t.y - t.radius - 34, 'LOCKED', 0x9fb0d0, 20, 40, 480);
        this.cameras.main.shake(60, 0.003);

        Sfx.locked();

        //  And the one that *is* next says so again, wherever it is.
        const head = t.chain ? t.chain.head : null;

        if (head) this.fx.ring(head.x, head.y, head.radius * 3, 0xffd23f, 4, 340);
    }

    /**
     * The gun's worth, in targets per shot. 1.0 is a stock gun: exactly enough
     * for the thing it is pointed at and nothing to spare.
     */
    private get punch (): number
    {
        return punchOf(this.stats.damage, run.level);
    }

    private applyShot (t: Target, hx: number, hy: number, direct: boolean, origin?: { x: number; y: number }): void
    {
        //  A locked link refuses everything, not only the player's own tap:
        //  a lance running through it, a second barrel, a wingman's pot shot.
        //  The rule would not be a rule if a stray bullet could skip it.
        if (t.chainLocked && !this.shotIgnoresLock) return;

        if (t.kind === 'bomb')
        {
            this.hitBomb(t);
            return;
        }

        //  The orb takes two shots from any gun: its health is not a number
        //  the build gets to argue with.
        if (t.kind === 'ability')
        {
            this.hitOrb(t, hx, hy);
            return;
        }

        //  The world's exam, if this level is one. Everything a boss does to
        //  stop a shot -- a turning ring, a shutter that is still closed, a
        //  body that is not there any more -- is one question asked here, and
        //  answering it is the only boss-shaped code in this file.
        if (this.boss && this.boss.owns(t))
        {
            const gun = origin || MUZZLE;
            const stop = this.boss.guard(t, Math.atan2(gun.y - t.y, gun.x - t.x));

            if (stop)
            {
                this.bossBlocked(t, stop);
                return;
            }
        }

        //  "Which side was it hit from" is always the same question: where the
        //  gun that fired is, relative to the target. Normally that is the
        //  muzzle; a wingman answers it from its own corner.
        if (t.shieldArc > 0)
        {
            const gun = origin || MUZZLE;
            const from = Math.atan2(gun.y - t.y, gun.x - t.x);

            if (t.shielded(from))
            {
                const p = t.plateAt(from);

                //  A heavy enough gun does not wait for the plate to turn. It
                //  is the only rule in the game that raw damage is allowed to
                //  overrule, and it is deliberately loud when it does: the
                //  player has to see that the thing they were told they could
                //  not do is now something they can buy their way out of.
                if (this.punch >= PLATE_BREAK)
                {
                    t.shieldArc = 0;

                    this.fx.burst(p.x, p.y, 0xd8e4ff, 22, 'big');
                    this.fx.ring(p.x, p.y, t.radius * 3.2, 0xd8e4ff, 5, 340);
                    this.fx.popup(t.x, t.y - t.radius - 30, 'PLATE BROKEN', 0xd8e4ff, 20, 44, 520);
                    this.cameras.main.shake(90, 0.006);
                    Sfx.shatter();
                }
                else
                {
                    t.clang(from);
                    this.fx.burst(p.x, p.y, 0xd8e4ff, 8, 'hit');
                    this.fx.ring(p.x, p.y, t.radius * 1.9, 0xd8e4ff, 3, 260);
                    Sfx.chip();
                    return;
                }
            }
        }

        const crit = Math.random() < this.stats.crit;

        //  Only the player's own tap can be a bullseye. An auto-aimed second
        //  barrel is handed the target's exact centre, so letting those count
        //  would mean the precision bonus was paid out for no precision.
        const perfect = direct && t.distanceTo(hx, hy) <= t.radius * BULLSEYE_SPOT;

        const dmg = this.stats.damage * this.shotMult
            * (crit ? this.stats.critMult : 1)
            * (perfect ? BULLSEYE_DAMAGE + this.stats.perfect : 1);

        //  What the shot found, and where -- both read before the kill, which
        //  takes the target off the board and out of the scene.
        const spare = dmg - t.hp;
        const bx = t.x;
        const by = t.y;

        //  A bullseye is worth shouting about exactly when it is the reason
        //  the target died -- when the same shot off-centre would have left it
        //  standing. Announcing every centre hit would put the word on a third
        //  of all kills, which is how a reward turns into wallpaper.
        const earned = perfect && this.stats.damage * (crit ? this.stats.critMult : 1) <= t.hp;

        if (t.damage(dmg))
        {
            this.killTarget(t, crit, perfect, 0, earned);

            //  Only the tap the player actually aimed carries its leftovers
            //  through. A lance and a second barrel are their own upgrades and
            //  do not get to compound with this one.
            if (direct) this.blast(bx, by, spare);
        }
        else
        {
            this.fx.burst(hx, hy, 0xffffff, 5, 'hit');
            Sfx.chip();
            this.cameras.main.shake(50, 0.002);
        }
    }

    private killTarget (t: Target, crit: boolean, perfect: boolean, depth: number, earned = false): void
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
        const abilityId = t.ability;
        const x = t.x;
        const y = t.y;

        //  The chain closes up before the target goes, so the next link is
        //  already lit by the time the pop finishes.
        if (t.chain) this.releaseChain(t, true);

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
        if (perfect) mult *= BULLSEYE_SCORE + this.stats.perfect;

        const gain = Math.round(base * mult);
        this.levelScore += gain;

        //  --- coins & xp ---
        const lucky = Math.random() < this.stats.lucky;
        let coins = (def.coins + this.stats.flatCoins) * this.stats.coinMult * (1 + streak * 0.5);
        if (lucky) coins *= 2;
        coins = Math.round(coins);

        this.levelCoins += coins;
        bankCoins(coins);

        //  The streak is the XP engine, and the only one that matters.
        //
        //  Score already pays for a streak, but score is a number on a screen;
        //  XP pays in *upgrades*, which is the thing players actually chase. So
        //  keeping a run of hits alive is now the fastest route to the next
        //  rank, and it pays twice over: a step every time a milestone lands,
        //  and a smooth climb on the raw count in between, so hit forty-one
        //  after forty is worth more than hit two after one. Fifty in a row is
        //  worth about seven cold kills; breaking the chain costs all of it.
        const xpStreak = 1 + streak * 1.8 + Math.min(2.5, this.combo * 0.05);

        this.gainXp(Math.round(xpWorth(def.xp, run.level) * this.stats.xpMult * xpStreak), x, y);

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
        if (earned) this.fx.popup(x - 4, y - radius - 22, 'BULLSEYE', 0xfff3b0, 20, 44, 560);

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
        else if (kind === 'ability' && abilityId)
        {
            this.activateAbility(abilityId, x, y);
        }

        //  --- the world's exam, one body lighter ---
        if (this.boss && this.boss.took(t))
        {
            this.bossDown();
            return;
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

        //  A boss level is cleared by the boss and by nothing else. The adds
        //  are there to keep the gun warm, the combo alive and the coins
        //  coming; letting a long enough streak of them clear the level would
        //  mean the exam could be passed by ignoring it.
        if (this.boss) return;

        if (this.progress >= this.cfg.goal && this.state === 'play')
        {
            this.levelComplete();
        }
    }

    /**
     * Bank the XP a kill was worth, and pay out any ranks it bought.
     *
     * This is the whole progression loop in one method: XP goes in on every
     * single kill, the bar across the top of the frame moves for every one of
     * them, and when it tops out the run owes the player a card. Nothing waits
     * for the end of a level any more, which is the point -- the reward is
     * attached to the shooting rather than to the paperwork after it.
     */
    private gainXp (xp: number, x: number, y: number): void
    {
        if (xp <= 0) return;

        this.levelXp += xp;
        meta.rank += xp;

        const ranks = run.addXp(xp);

        if (ranks <= 0) return;

        //  The bar itself does the shouting; the hand is dealt on the next
        //  frame, from `update`, so a chain reaction that buys three ranks at
        //  once cannot re-enter this in the middle of its own kill loop.
        this.xpFlash = 1;

        Sfx.milestone(Math.min(3, ranks));
        this.fx.popup(x, y - 52, ranks > 1 ? `RANK UP x${ranks}` : 'RANK UP', RANK_GOLD, 26, 66, 760);
        this.fx.ring(x, y, 210, RANK_COLOR, 6, 460);
    }

    /**
     * The run stops, the arena dims, and three cards drop in to be shot. See
     * `objects/LevelUpPanel` for why this happens here rather than on a screen
     * of its own.
     */
    private openRankUp (): void
    {
        if (this.levelUp || this.state !== 'play') return;

        const offers = rollOffers(run.taken, run.level, 3);

        //  A build that has somehow maxed every line has nothing left to be
        //  offered. It cannot happen at the pick rate the curve deals at, but a
        //  hand with no cards in it would be a locked game, so the rank is
        //  simply banked and the level carries on.
        if (offers.length === 0)
        {
            run.owed = 0;
            run.burst = 0;
            return;
        }

        this.state = 'rank';
        setGameplayActive(false);

        this.cameras.main.flash(200, 179, 108, 255);
        Sfx.upgrade();

        this.levelUp = new LevelUpPanel(this, this.tier, this.fx, offers, up => this.takePick(up));
    }

    /**
     * A card was shot. The part goes on the gun *now*, in front of the player,
     * which means the weapon is refitted mid-level rather than at the start of
     * the next one -- the gun is the scoreboard, and a scoreboard that updates
     * two levels late is not one.
     */
    private takePick (up: Upgrade): void
    {
        run.take(up.id);
        run.owed = Math.max(0, run.owed - 1);
        run.burst = 0;

        //  Anything that buys time buys it on the clock that is running, not
        //  on the next one. A part that says "+3s" and then does nothing for
        //  fifteen seconds is a part the player will never take twice.
        const hadBonus = this.stats.timeBonus;

        this.stats = run.stats();

        //  The multiplier cards tick up on the readouts they act on, and the
        //  card just shot is the only one allowed to pop its own chip.
        this.refreshMultChips(up.id);

        const extra = (this.stats.timeBonus - hadBonus) * 1000;

        if (extra > 0)
        {
            this.timeTotal += extra;
            this.timeLeft += extra;
            this.fx.popup(CX, HUD.barY + 44, `+${(extra / 1000).toFixed(1)}s`, 0x62ffb8, 28, 54, 700);
        }

        this.look = gunLook(run.taken, meta.perks);
        this.beam = beamLook(this.look, this.tier);
        this.beam2 = beamLook(this.look, this.tier, true);

        this.turret.refit(this.look);
        this.turret.install(partFor(up.id));
        this.build.refresh();

        const tag = this.fx.popup(MUZZLE.x, MUZZLE.y - 128, up.name, up.color, 26, 36, 900);
        tag.setDepth(40);

        if (this.levelUp)
        {
            this.levelUp.destroy();
            this.levelUp = null;
        }

        if (this.state !== 'rank') return;

        //  Back to the level, mid-swing. Another rank still owed simply deals
        //  again on the next frame, through the same door.
        this.state = 'play';
        setGameplayActive(true);
    }

    /**
     * Overkill, made physical.
     *
     * A shot that kills with damage to spare used to throw the remainder away.
     * It now comes out the far side of the target as a shockwave, and how far
     * it reaches and how many it takes is exactly how much gun the player has
     * bought -- one spare target's worth of health is one neighbour.
     *
     * This is deliberately not another BOOM. It ignores shield plates, because
     * a wave arriving from inside the pack is not a shot from the muzzle; it
     * only ever fires off the tap the player aimed themselves; and it is
     * silent when it catches nobody, so a heavy gun on an empty stretch of
     * board does not fill the screen with rings for free.
     */
    /**
     * True for a body the world's exam is standing behind.
     *
     * The shockwave, the explosive rounds and the lightning all reach past the
     * thing the player actually aimed at, and all three of them damage what
     * they find directly rather than firing a shot at it -- which means none of
     * them ever asks the boss's rule whether it was allowed in. A turning ring
     * that a stray blast could reach through is not a ring, and every one of
     * the seven fights is built on the assumption that the only way to the
     * body is the way the fight says it is. So splash simply does not touch
     * one: the adds around it are what the upgrades get to eat.
     */
    private bossBody (t: Target): boolean
    {
        return !!this.boss && this.boss.owns(t);
    }

    private blast (x: number, y: number, spare: number): void
    {
        const over = spare / unitHp(run.level);

        if (over < BLAST_MIN) return;

        const reach = Math.min(340, 70 + over * 38);
        const room = Math.min(BLAST_MAX, Math.floor(over));

        const caught = this.targets
            .filter(t => !t.dead && t.kind !== 'bomb' && t.kind !== 'ability' && !t.chainLocked && !this.bossBody(t) && t.distanceTo(x, y) <= reach + t.radius)
            .sort((a, b) => a.distanceTo(x, y) - b.distanceTo(x, y))
            .slice(0, room);

        if (caught.length === 0) return;

        this.fx.ring(x, y, reach, 0xfff3b0, 6, 360);
        this.fx.burst(x, y, 0xffffff, 16, 'big');
        this.cameras.main.shake(90, 0.007);
        Sfx.boom();

        if (caught.length > 1) this.fx.popup(x, y - 46, 'OVERKILL', 0xffb020, 22, 52, 560);

        for (const t of caught)
        {
            if (t.damage(spare)) this.killTarget(t, false, false, 1);
        }
    }

    private explode (x: number, y: number, depth: number): void
    {
        const r = this.stats.explodeRadius;

        this.fx.ring(x, y, r, 0xff7a3d, 7, 380);
        this.fx.burst(x, y, 0xff9d3d, 22, 'big');
        this.cameras.main.shake(120, 0.01);
        Sfx.boom();

        const caught = this.targets.filter(t => !t.dead && t.kind !== 'bomb' && t.kind !== 'ability' && !this.bossBody(t) && t.distanceTo(x, y) <= r + t.radius);

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
            let bestDist = CHAIN_REACH;

            for (const t of this.targets)
            {
                //  Welded chains are the lightning's business too: it does not
                //  get to walk a rope the player is supposed to walk by hand.
                if (t.dead || used.has(t) || t.kind === 'bomb' || t.kind === 'ability' || t.chain || this.bossBody(t)) continue;

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

            if (best.damage(this.stats.damage * CHAIN_DAMAGE))
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
        const harmless = t.kind === 'bomb' || t.kind === 'ability';

        if (t.chain) this.releaseChain(t, false);

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
     * bigger, hotter, and finally shaking -- so the ramp is felt, not counted.
     */
    private applyComboTier (tier: number): void
    {
        this.comboTier = tier;

        const color = COMBO_RAMP[Math.min(tier, COMBO_RAMP.length - 1)];

        this.comboText.setStyle({
            fontFamily: FONT,
            fontSize: Math.min(40, 28 + tier * 1.8),
            color: hex(color),
            stroke: '#000000',
            strokeThickness: 4 + Math.min(7, tier)
        });

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
        g.fillRoundedRect(CX - under, COMBO_Y + 24, under * 2, 4, 2);
    }

    /**
     * The one line under the combo, and the only place the streak is spelled
     * out now that the gem track is gone.
     *
     * It reads in XP rather than in score on purpose. Score is a number that
     * goes up; XP is the next upgrade. Telling the player a streak is worth
     * "x3.4 XP" is telling them it is worth a card, which is the thing they are
     * actually playing for.
     */
    private updateStreakText (): void
    {
        const active = this.milestoneIdx >= 0 ? STREAKS[this.milestoneIdx] : null;
        const next = STREAKS.find(s => this.combo < s.n);

        //  The same sum `killTarget` pays out with, so the caption can never
        //  drift away from what the streak is actually worth.
        const xpAt = (combo: number, s: Streak | null) =>
            1 + (s ? s.bonus * this.stats.comboMult : 0) * 1.8 + Math.min(2.5, combo * 0.05);

        let label: string;
        let color: string;

        if (active)
        {
            label = `${active.label}   x${xpAt(this.combo, active).toFixed(1)} XP`;
            color = hex(STREAK_COLORS[Math.min(this.milestoneIdx, STREAK_COLORS.length - 1)]);
        }
        else if (next)
        {
            label = `${next.n - this.combo} MORE FOR x${xpAt(next.n, next).toFixed(1)} XP`;
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

        this.drawRank(g);
        this.layoutMultChips();

        //  low-time vignette
        if (low && this.state === 'play')
        {
            const a = 0.06 + Math.abs(Math.sin(this.time.now * 0.01)) * 0.1;
            g.fillStyle(0xff0033, a);
            g.fillRect(0, 0, W, H);
        }
    }

    /**
     * The rank bar: full width, hard against the top edge of the frame, and
     * moving on literally every kill.
     *
     * It gets the top edge because it is the one readout that is always doing
     * something. The countdown only ever empties, the goal bar only fills once
     * per level and then resets -- this one fills all run, wraps, and each wrap
     * is a card. A player who never reads a word of it still learns, inside the
     * first level, that shooting makes the purple line move and the purple line
     * reaching the end is when they get to choose something.
     */
    private drawRank (g: GameObjects.Graphics): void
    {
        const want = run.xpFrac;

        //  A rank-up wraps the bar. Running the fill backwards to the new value
        //  would read as *losing* progress, so it finishes the lap it was on
        //  and starts the next one from the left.
        if (want < this.xpShown - 0.02)
        {
            this.xpShown += (1.08 - this.xpShown) * 0.4;
            if (this.xpShown > 0.994) this.xpShown = 0;
        }
        else
        {
            this.xpShown += (want - this.xpShown) * 0.17;
        }

        const h = HUD.xpH;
        const y = HUD.xpY;
        const flash = this.xpFlash;
        const color = flash > 0.01 ? mix(RANK_COLOR, RANK_GOLD, flash) : RANK_COLOR;

        g.fillStyle(0x0a0e1e, 0.9);
        g.fillRect(0, y, W, h);

        const fill = Math.max(0, Math.min(1, this.xpShown)) * W;

        if (fill > 0.5)
        {
            g.fillStyle(color, 0.9 + flash * 0.1);
            g.fillRect(0, y, fill, h);

            //  Leading edge: the bit the eye actually tracks.
            g.fillStyle(mix(color, 0xffffff, 0.6), 0.9);
            g.fillRect(Math.max(0, fill - 3), y, 3, h);
            g.fillStyle(color, 0.22 + flash * 0.4);
            g.fillRect(Math.max(0, fill - 26), y, 26, h);
        }

        //  Ten notches across, so "nearly there" is readable at a glance
        //  rather than being a judgement about a bar with no marks on it.
        g.fillStyle(0x000000, 0.45);
        for (let i = 1; i < 10; i++) g.fillRect((W / 10) * i, y, 1.5, h);

        if (flash > 0.01)
        {
            g.fillStyle(RANK_GOLD, flash * 0.5);
            g.fillRect(0, y, W, h + 3);
        }

        this.rankText.setText(`RANK ${run.rank}`);
        this.rankText.setColor(hex(color));
    }

    //  --------------------------------------------------------------- loop

    update (_time: number, delta: number): void
    {
        const dt = Math.min(50, delta);

        this.fx.update(dt);
        this.backdrop.update(dt);
        this.hazards.update(dt, this.state === 'play');

        if (this.xpFlash > 0) this.xpFlash = Math.max(0, this.xpFlash - dt / 620);

        //  A rank bought itself a card. Dealt from here rather than from the
        //  kill that paid for it, so a chain reaction worth three ranks cannot
        //  re-enter the hand in the middle of its own kill loop.
        if (this.state === 'play' && run.owed > 0 && !this.levelUp) this.openRankUp();

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

            //  Spawning. `spawnRate` is the level's real pacing dial and it is
            //  treated as one: a board that has been cleared out refills at
            //  half the gap rather than instantly, which is the difference
            //  between a level that breathes and the machine-gun this used to
            //  be. It used to spawn once *per frame* while the board was under
            //  half full, which meant a player who shot well was punished with
            //  a wall of targets and the whole spawnRate column was decoration.
            this.spawnTimer -= dt;

            const alive = this.targets.length;
            const floor = Math.max(2, Math.ceil(this.cfg.maxActive * 0.5));

            if (this.spawnTimer <= 0 && alive < this.cfg.maxActive)
            {
                this.spawn();

                //  A chain arrives as three or four targets on one tick, and
                //  it is charged for all of them: a welded run is a different
                //  *shape* of work, not a free extra helping of it. Without
                //  this a chain zone quietly spawns at double the rate its
                //  table asks for, which is most of where the late-game wall
                //  of targets was coming from.
                const added = Math.max(1, this.targets.length - alive);

                this.spawnTimer = this.cfg.spawnRate * added * (alive < floor ? 0.5 : 1);
            }

            //  The orb, when its moment on the clock comes round.
            if (this.orbAt >= 0 && this.timeLeft <= this.orbAt)
            {
                this.orbAt = -1;
                this.spawnOrb(this.orbId);
            }

            this.tickAbility(dt);

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

        //  Everything on the board holds still behind the cards. The world
        //  behind it does not -- the backdrop keeps running, so the pause reads
        //  as a held breath rather than as a freeze frame.
        const frozen = this.state === 'rank' || this.state === 'menu';

        //  The beam only exists while the board is live; a frozen or finished
        //  board does not get a laser painted across it.
        if (this.state !== 'play' && this.ability === 'laser') this.laserGfx.clear();

        this.tickBolts(dt);

        for (let i = this.targets.length - 1; i >= 0; i--)
        {
            const t = this.targets[i];

            if (!frozen && (this.state !== 'spam' || t === this.drum)) t.update(dt, this.stats.slow);

            if (t.trail && this.state === 'play' && t.takeTrailPuff())
            {
                this.trails.puff(t.trail, t.x, t.y);
            }

            //  A falling target dies by reaching the floor; a standing one by
            //  running out of life. Both are the same miss.
            if ((t.life <= 0 || t.gone) && this.state === 'play')
            {
                this.expireTarget(t);
            }
        }

        if (this.state === 'spam')
        {
            this.spamLeft -= dt;

            if (this.spamLeft <= 0)
            {
                this.state = 'intro';
                this.closeSpam();
            }
        }

        if (this.boss && this.state === 'play')
        {
            this.boss.tick(dt);

            //  The goal counter *is* the boss's health bar on a boss level.
            //  It already sits in the player's eye and it already means "how
            //  much of this level is behind me", which on a level that is one
            //  object is exactly what its health is -- so the fight gets a
            //  readout without the HUD growing a second one.
            this.progress = Math.round(this.cfg.goal * (1 - this.boss.frac));
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

        //  The chains are drawn after the gimmick has moved the board, so the
        //  ropes are attached to where the links actually are this frame and
        //  not to where they were before the wind got them.
        for (const c of this.chains) c.update(dt);

        //  HUD text
        this.timeText.setText((this.timeLeft / 1000).toFixed(2));
        this.goalText.setText(`${Math.min(this.progress, this.cfg.goal)} / ${this.cfg.goal}`);

        this.checkComboTier();
        this.drawCombo();
        this.updateStreakText();
        this.turret.idle(this.time.now);
        this.tickWingmen(dt);

        if (this.coinsDisplay !== meta.coins)
        {
            this.coinsDisplay += Math.max(1, Math.ceil((meta.coins - this.coinsDisplay) * 0.25));
            if (this.coinsDisplay > meta.coins) this.coinsDisplay = meta.coins;
            this.coinLabel.setValue(fmt(this.coinsDisplay));
        }

        this.drawHud();
    }

    //  ----------------------------------------------------------- wingman

    /**
     * The bought guns: they track whatever is nearest to them every frame and
     * take a shot on their own clock, about once a second.
     *
     * They never shoot a bomb. The whole appeal of buying a second gun is that
     * it helps, and a gun that could break the player's combo for them -- with
     * no tap of theirs anywhere near it -- would be a punishment they paid for.
     */
    private tickWingmen (dt: number): void
    {
        if (this.wingmen.length === 0 && this.sentries.length === 0) return;

        for (const w of this.wingmen) this.trackPod(w, dt);
        for (const w of this.sentries) this.trackPod(w, dt);

        if (this.state !== 'play') return;

        this.wingTimer -= dt;

        if (this.wingTimer <= 0)
        {
            this.wingTimer = WINGMAN_DELAY;
            for (const w of this.wingmen) this.firePod(w);
        }

        //  The sentries run a much quicker clock: they are here for twelve
        //  seconds and they have to be felt in all of them.
        if (this.sentries.length > 0)
        {
            this.sentryTimer -= dt;

            if (this.sentryTimer <= 0)
            {
                this.sentryTimer = SENTRY_RATE;
                for (const w of this.sentries) this.firePod(w);
            }
        }
    }

    private trackPod (w: Wingman, dt: number): void
    {
        const mark = this.wingTarget(w);

        if (mark) w.aimAt(mark.x, mark.y);
        else w.stand();

        w.tick(dt, this.time.now);
    }

    private firePod (w: Wingman): void
    {
        if (this.state !== 'play') return;

        const mark = this.wingTarget(w);

        if (!mark) return;

        w.aimAt(mark.x, mark.y);
        w.fire();

        const m = w.muzzle;

        this.fx.beam(m.x, m.y, mark.x, mark.y, this.beam2, 0.8);
        this.applyShot(mark, mark.x, mark.y, false, m);
    }

    //  ----------------------------------------------------------- abilities

    /** The gun's clock: the ability's own while one is live, the build's otherwise. */
    private get fireRate (): number
    {
        if (this.ability === 'mayhem') return MAYHEM_RATE;
        if (this.ability === 'bomb') return BOMB_RATE;

        return this.stats.fireRate;
    }

    /**
     * The orb: a rainbow target in a golden setting, always on the move,
     * dragging a golden wake. It lives long enough to cross the board a few
     * times, never counts towards the goal, and costs nothing if it is missed
     * -- it is a gift, and a gift on a timer is a chore.
     */
    private spawnOrb (id: AbilityId): void
    {
        const radius = this.cfg.size * KINDS.ability.sizeMult;
        const spot = this.freeSpot(radius * 1.5);
        const speed = Math.max(this.cfg.speed, 120);

        const t = new Target(this, spot.x, spot.y, 'ability', this.cfg.size, run.level, speed, true);

        t.ability = id;
        t.trail = 'gold';
        t.progressWorth = 0;
        t.setLifetime(this.cfg.lifetime * 3.2);
        t.setDepth(12);

        dressAbilityTarget(this, t, id);

        this.targets.push(t);

        this.fx.ring(spot.x, spot.y, radius * 4, 0xffd23f, 5, 480);
        this.fx.burst(spot.x, spot.y, 0xfff3b0, 18, 'gold');
        this.fx.popup(spot.x, spot.y - radius - 40, 'ABILITY', 0xffd23f, 22, 50, 700);
        Sfx.unlock();
    }

    /** One of the orb's two shots. */
    private hitOrb (t: Target, hx: number, hy: number): void
    {
        if (t.damage(t.maxHp / 2))
        {
            this.killTarget(t, false, false, 0);
        }
        else
        {
            this.fx.burst(hx, hy, 0xffd23f, 10, 'gold');
            this.fx.ring(t.x, t.y, t.radius * 2.2, 0xffd23f, 4, 300);
            this.cameras.main.shake(50, 0.003);
            Sfx.clank();
        }
    }

    /**
     * The orb broke: the gun *is* this ability now, at once, for its clock.
     * Taking a second orb while one is live simply swaps the weapon.
     */
    private activateAbility (id: AbilityId, x: number, y: number, carried = 0): void
    {
        if (this.ability) this.endAbility(true);

        const def = ABILITIES[id];

        this.ability = id;
        this.abilityLeft = carried > 0 ? carried : def.duration;

        this.turret.charge(id);
        this.abilityBanner.show(def);
        this.abilityBanner.set(this.abilityLeft / def.duration);

        if (id === 'sentry') this.deploySentries();

        //  Picked up from the last screen: no fanfare the second time.
        if (carried > 0) return;

        this.cameras.main.flash(220, 255, 240, 180);
        this.cameras.main.shake(160, 0.01);
        this.fx.ring(x, y, 260, def.color, 8, 520);
        this.fx.burst(x, y, def.color, 30, 'gold');
        this.fx.popup(CX, arenaY(0.36), def.shout, def.color, 46, 60, 1000);
        Sfx.jackpot();
    }

    /** Bank what is left of the weapon so the next screen can finish it. */
    private carryAbility (): void
    {
        run.ability = this.ability && this.abilityLeft > 0 ? { id: this.ability, left: this.abilityLeft } : null;
    }

    private endAbility (swapping = false): void
    {
        const id = this.ability;

        if (!id) return;

        this.ability = null;
        this.abilityLeft = 0;
        this.shotMult = 1;
        this.laserGfx.clear();

        this.turret.charge(null);
        this.abilityBanner.hide();
        this.recallSentries();

        if (!swapping)
        {
            this.fx.popup(this.turret.tipX, this.turret.tipY - 30, 'POWER DOWN', 0x9fb0d0, 20, 40, 520);
        }
    }

    /** Two pods ride in from the wings, halfway up the arena. */
    private deploySentries (): void
    {
        const y = arenaY(0.52);
        const left = new Wingman(this, PLAY.left - 60, y, this.tier, -1);
        const right = new Wingman(this, PLAY.right + 60, y, this.tier, 1);

        this.tweens.add({ targets: left, x: PLAY.left - 6, duration: 380, ease: 'Back.out' });
        this.tweens.add({ targets: right, x: PLAY.right + 6, duration: 380, ease: 'Back.out' });

        this.sentries = [ left, right ];
        this.sentryTimer = 500;
    }

    private recallSentries (): void
    {
        for (const w of this.sentries)
        {
            const out = w.x < CX ? PLAY.left - 60 : PLAY.right + 60;

            this.tweens.add({ targets: w, x: out, alpha: 0, duration: 300, ease: 'Quad.in', onComplete: () => w.destroy() });
        }

        this.sentries = [];
    }

    /** Per frame while playing: the clock, the hose, the beam. */
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
            //  Hold to fire. A machine gun that asked for a tap per bullet
            //  would be a finger exercise, not mayhem.
            if (p.isDown && onBoard) this.requestShot(p.x, p.y);
        }
        else if (this.ability === 'laser')
        {
            this.runLaser(dt, p.x, p.y);
        }
    }

    /**
     * MAYHEM: a fan of slow beam projectiles that bounce round the arena.
     *
     * Every pull sends six short bolts out of the muzzle across a cone. They
     * fly on their own (see `Bolts`), fold off the walls twice, and hit at
     * triple damage whatever they cross. Bombs are left alone, as every
     * automatic gun in the game leaves them.
     */
    private shootMayhem (px: number, py: number): void
    {
        this.turret.fire(px, py, 1);

        const m = this.turret.tipFor(0);

        this.cameras.main.shake(60, 0.004);
        this.fx.burst(m.x, m.y, ABILITIES.mayhem.glow, 6, 'hit');

        //  Six bolts a pull, fanned across the cone. They are projectiles:
        //  they leave the muzzle, cross the board and bounce, on their own.
        for (const dir of sprayDirs(m.x, m.y, px, py, MAYHEM_BOLTS))
        {
            this.bolts.fire(m.x, m.y, dir.dx, dir.dy);
        }
    }

    /** Fly the MAYHEM bolts and land whatever they cross. */
    private tickBolts (dt: number): void
    {
        if (this.bolts.count === 0) return;

        const live = this.state === 'play';
        const def = ABILITIES.mayhem;

        this.bolts.update(live ? dt : 0, this.targets, (t, x, y) =>
        {
            if (!live || t.kind === 'bomb' || t.chainLocked) return false;

            this.shotMult = MAYHEM_DAMAGE;
            this.applyShot(t, t.x, t.y, false, { x, y });
            this.shotMult = 1;

            //  A bolt goes through everything it kills; only a body that
            //  survives it (a boss, a plate) stops it.
            return !t.dead && this.targets.indexOf(t) !== -1;
        }, (x, y) => this.fx.burst(x, y, def.glow, 3, 'hit'));
    }

    /**
     * BOMBS: a fat shell lobbed to the tap, and a blast the size of a fist
     * when it gets there. Slow, and worth the wait.
     */
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
            if (this.state === 'play') this.explodeBomb(px, py);
        });
    }

    private explodeBomb (x: number, y: number): void
    {
        bombImpact(this, this.fx, x, y);
        Sfx.boom();

        //  A blast takes the whole rope at once, locked links included.
        const caught = this.targets
            .filter(t => !t.dead && t.kind !== 'bomb' && t.distanceTo(x, y) <= BOMB_RADIUS + t.radius);

        this.shotMult = BOMB_DAMAGE;
        this.shotIgnoresLock = true;

        for (const t of caught) this.applyShot(t, t.x, t.y, false, { x, y });

        this.shotIgnoresLock = false;
        this.shotMult = 1;
    }

    /**
     * STATIC LASER: a thick beam from the muzzle out through wherever the
     * cursor is, on for as long as the ability lasts. No tapping. It burns
     * everything it crosses a little every frame rather than shooting
     * anything, so a target that wanders through it is scorched and one the
     * player holds it on is gone in a third of a second.
     */
    private runLaser (dt: number, px: number, py: number): void
    {
        const def = ABILITIES.laser;

        this.turret.aimAt(px, py);

        const m = this.turret.tipFor(0);
        const legs = laserPath(m.x, m.y, px, py);

        drawLaser(this.laserGfx, legs, this.time.now);

        this.laserSpark -= dt;

        const burn = this.stats.damage * LASER_DPS * (dt / 1000);
        const half = LASER_WIDTH * 0.5;

        for (let i = this.targets.length - 1; i >= 0; i--)
        {
            const t = this.targets[i];

            //  The beam burns through a rope in whatever order it likes.
            if (t.dead || t.kind === 'bomb') continue;

            //  Which leg of the beam is on it decides where the beam is
            //  coming *from*, which is what the guard and the plate ask.
            const leg = legs.find(l => distToSegment(t.x, t.y, l.x1, l.y1, l.x2, l.y2) <= t.radius + half);

            if (!leg) continue;

            const from = Math.atan2(leg.y1 - t.y, leg.x1 - t.x);

            //  The boss's guard and the shield plate still answer the beam;
            //  a wall of light does not get to skip the one rule of the zone.
            if (this.boss && this.boss.owns(t) && this.boss.guard(t, from)) continue;
            if (t.shieldArc > 0 && t.shielded(from)) continue;

            if (this.laserSpark <= 0) this.fx.burst(t.x, t.y, def.glow, 3, 'hit');

            //  The orb melts on its own clock rather than on the gun's.
            const amount = t.kind === 'ability' ? t.maxHp * (dt / 650) : burn;

            if (t.damage(amount)) this.killTarget(t, false, false, 0);
        }

        if (this.laserSpark <= 0) this.laserSpark = 70;
    }

    /** Whatever that pod can reach soonest, bombs excepted. */
    private wingTarget (w: Wingman): Target | null
    {
        let best: Target | null = null;
        let bestDist = Infinity;

        for (const t of this.targets)
        {
            if (t.dead || t.kind === 'bomb' || t.chainLocked) continue;

            const d = Math.hypot(t.x - w.x, t.y - w.y);

            if (d < bestDist) { bestDist = d; best = t; }
        }

        return best;
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

        const spare = boostCount('life');

        if (!this.revived && (spare > 0 || adsAvailable()))
        {
            this.offerRevive(spare);
            return;
        }

        this.endRun();
    }

    private offerRevive (spare: number): void
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

        //  Two ways back in, and the bought one goes on top: a player holding
        //  an extra life should never have to read past a video offer to find
        //  the thing they already paid for.
        let y = H * (spare > 0 ? 0.485 : 0.52);

        if (spare > 0)
        {
            panel.add(this.spareLifeButton(CX, y, spare, panel));
            y += 104;
        }

        const life = rewardButton(this, CX, y, {
            width: 360,
            height: 84,
            label: `EXTRA LIFE  +${REVIVE_SECONDS}s`,
            color: 0x6cf5c8,
            onReward: () => this.revive(panel)
        });

        if (life)
        {
            panel.add(life);
            y += 104;
        }

        const quit = this.add.text(CX, y + 8, 'GIVE UP', {
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

    /**
     * The extra life the player bought in the store, on the one screen where
     * it is worth anything. It says how many are left, because a consumable
     * that does not is a consumable nobody buys twice.
     */
    private spareLifeButton (x: number, y: number, spare: number, panel: GameObjects.Container): GameObjects.Container
    {
        const w = 360;
        const h = 84;
        const btn = this.add.container(x, y).setDepth(12);

        const g = this.add.graphics();
        g.fillStyle(0x6cf5c8, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 22);
        g.fillStyle(0xffffff, 0.2);
        g.fillRoundedRect(-w / 2, -h / 2, w, 34, { tl: 22, tr: 22, bl: 0, br: 0 });
        btn.add(g);

        const icon = iconImage(this, -w / 2 + 44, 0, 'shield', { size: 32, color: 0x0b1024 });
        btn.add(icon);

        btn.add(this.add.text(-w / 2 + 74, 0, `USE EXTRA LIFE  x${spare}`, {
            fontFamily: FONT, fontSize: 25, color: '#0b1024'
        }).setOrigin(0, 0.5));

        btn.setSize(w, h);
        btn.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, w, h),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        this.tweens.add({ targets: btn, scale: 1.03, duration: 780, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        btn.on('pointerdown', () =>
        {
            unlockAudio();

            if (!spendBoost('life'))
            {
                Sfx.dry();
                return;
            }

            this.revive(panel);
        });

        return btn;
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

    /**
     * Everything a run that is not going to be finished still owes the save.
     * Coins were banked to the counter as they were picked up, so the one
     * thing that would actually lose them is not writing the save.
     */
    private bankRun (): void
    {
        this.hazards.clear();
        this.clearChains();

        //  A failed attempt does not bank its score into the run -- retrying
        //  replays the same level from the same total.
        run.bestCombo = Math.max(run.bestCombo, this.bestCombo);
        run.coinsEarned += this.levelCoins;

        meta.best = Math.max(meta.best, run.score + this.levelScore);
        meta.bestLevel = Math.max(meta.bestLevel, run.level - 1);
        saveMeta();
    }

    /**
     * Walking out mid-run. The run's winnings are kept, but it is not booked
     * as a finished run: the present counter only pays for runs that were
     * played to the end, or quitting three times would be the fastest way to
     * open a box.
     */
    private quitToMenu (): void
    {
        if (this.state === 'done') return;

        this.state = 'done';
        setGameplayActive(false);

        this.bankRun();

        this.cameras.main.fadeOut(200, 0, 0, 0);
        this.time.delayedCall(210, () => this.scene.start('MainMenu'));
    }

    private endRun (): void
    {
        this.bankRun();

        this.time.delayedCall(340, () =>
        {
            this.cameras.main.fadeOut(180, 0, 0, 0);
            this.time.delayedCall(190, () => endOfRun(this, { mode: 'fail', levelScore: this.levelScore, bestCombo: this.bestCombo }));
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
        this.clearChains();

        run.bestCombo = Math.max(run.bestCombo, this.bestCombo);
        this.carryAbility();
        this.laserGfx.clear();
        this.bolts.clear();
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
        const perfect = !this.skipped && this.misses === 0 && this.expiredCount === 0;
        const perfectBonus = perfect ? 250 + run.level * 60 : 0;

        bankCoins(comboBonus + perfectBonus);

        run.score += this.levelScore;
        run.coinsEarned += this.levelCoins + comboBonus + perfectBonus;

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
                    endOfRun(this, { mode: 'victory', levelScore: this.levelScore, bestCombo: this.bestCombo });
                    return;
                }

                //  The level number used to be advanced by the upgrade screen,
                //  because there always was one. There is not any more: inside
                //  a zone the doors shut on one level and open on the next with
                //  nothing in between, so the level advances here.
                const cleared = run.level;

                run.level = Math.min(FINAL_LEVEL, cleared + 1);

                if (isBonusAfter(cleared))
                {
                    //  Every fifth level, the doors open onto the vault.
                    this.scene.start('Bonus');
                }
                else if (isZoneStart(run.level))
                {
                    //  Leaving a world is the one moment worth stopping for.
                    this.scene.start('World');
                }
                else
                {
                    this.scene.start('Game');
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
