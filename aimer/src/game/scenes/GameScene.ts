import { GameObjects, Scene } from 'phaser';
import { Target } from '../objects/Target';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio, isMuted, toggleMute } from '../core/audio';
import { FINAL_LEVEL, KINDS, LevelConfig, levelConfig, pickKind } from '../data/levels';
import { Stats } from '../data/upgrades';
import { bankCoins, meta, run, saveMeta } from '../core/state';
import { FONT, FONT_UI, H, MUZZLE, PLAY, Tier, W, fmt, fmtShort, hex, tierFor } from '../core/theme';

interface Streak { n: number; bonus: number; label: string; }

const STREAKS: Streak[] = [
    { n: 5,  bonus: 0.10, label: 'NICE!' },
    { n: 10, bonus: 0.25, label: 'ON FIRE!' },
    { n: 20, bonus: 0.50, label: 'UNSTOPPABLE!' },
    { n: 30, bonus: 1.00, label: 'GODLIKE!' },
    { n: 50, bonus: 2.00, label: 'LEGENDARY!' },
    { n: 80, bonus: 3.50, label: 'INSANE!!!' }
];

const COIN_HUD = { x: 494, y: 30 };

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
    private stats!: Stats;
    private tier!: Tier;
    private fx!: Fx;

    private targets: Target[] = [];
    private state: 'play' | 'done' = 'play';

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
    private bgGfx!: GameObjects.Graphics;
    private hudGfx!: GameObjects.Graphics;
    private coinText!: GameObjects.Text;
    private scoreText!: GameObjects.Text;
    private comboText!: GameObjects.Text;
    private timeText!: GameObjects.Text;
    private goalText!: GameObjects.Text;
    private streakText!: GameObjects.Text;
    private multText!: GameObjects.Text;
    private muteBtn!: GameObjects.Text;
    private muzzle!: GameObjects.Arc;

    constructor ()
    {
        super('Game');
    }

    create ()
    {
        this.cfg = levelConfig(run.level);
        this.stats = run.stats();
        this.tier = tierFor(run.level);

        this.targets = [];
        this.state = 'play';
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

        this.cameras.main.setBackgroundColor(this.tier.bg);

        this.buildBackground();
        this.fx = new Fx(this, 20);
        this.buildHud();

        if (this.cfg.boss)
        {
            this.spawnBoss();
        }

        this.input.on('pointerdown', (p: Phaser.Input.Pointer) =>
        {
            unlockAudio();
            if (this.state !== 'play') return;
            if (p.y < PLAY.top - 16 || p.y > PLAY.bottom + 24) return;
            this.requestShot(p.x, p.y);
        });

        this.cameras.main.fadeIn(140, 0, 0, 0);
        this.showLevelBanner();
    }

    //  ---------------------------------------------------------------- setup

    private buildBackground (): void
    {
        this.bgGfx = this.add.graphics().setDepth(0);

        const intensity = Math.min(1, run.level / 16);

        for (let i = 0; i < 3 + Math.floor(intensity * 3); i++)
        {
            const orb = this.add.circle(
                40 + Math.random() * (W - 80),
                PLAY.top + Math.random() * (PLAY.bottom - PLAY.top),
                70 + Math.random() * 90,
                i % 2 === 0 ? this.tier.accent : this.tier.accent2,
                0.05 + intensity * 0.045
            ).setDepth(1);

            this.tweens.add({
                targets: orb,
                y: orb.y + (Math.random() > 0.5 ? 120 : -120),
                scale: 1.35,
                duration: 3000 + Math.random() * 3000,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.inOut'
            });
        }

        const dust = this.add.particles(0, 0, 'dust', {
            x: { min: 0, max: W },
            y: PLAY.bottom + 40,
            speedY: { min: -70, max: -20 },
            speedX: { min: -18, max: 18 },
            lifespan: { min: 3000, max: 6000 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 0.4, end: 0 },
            tint: this.tier.dust,
            blendMode: 'ADD',
            frequency: Math.max(90, 320 - run.level * 11),
            quantity: 1
        });
        dust.setDepth(2);
    }

    private buildHud (): void
    {
        this.hudGfx = this.add.graphics().setDepth(30);

        this.add.text(30, 30, `LEVEL ${run.level}`, {
            fontFamily: FONT, fontSize: 22, color: hex(this.tier.accent)
        }).setOrigin(0, 0.5).setDepth(31);

        this.coinText = this.add.text(W - 30, COIN_HUD.y, '◆ ' + fmt(meta.coins), {
            fontFamily: FONT, fontSize: 24, color: '#ffc857'
        }).setOrigin(1, 0.5).setDepth(31);

        this.scoreText = this.add.text(W / 2, 76, '0', {
            fontFamily: FONT, fontSize: 54, color: '#ffffff', stroke: '#000000', strokeThickness: 6
        }).setOrigin(0.5).setDepth(31);

        this.comboText = this.add.text(W / 2, 120, '', {
            fontFamily: FONT, fontSize: 30, color: hex(this.tier.accent2)
        }).setOrigin(0.5).setDepth(31);

        this.timeText = this.add.text(30, 158, '0.0', {
            fontFamily: FONT, fontSize: 20, color: '#ffffff'
        }).setOrigin(0, 0.5).setDepth(32);

        this.goalText = this.add.text(W - 30, 158, '0 / 0', {
            fontFamily: FONT, fontSize: 20, color: hex(this.tier.accent)
        }).setOrigin(1, 0.5).setDepth(32);

        this.streakText = this.add.text(W / 2, 892, '', {
            fontFamily: FONT_UI, fontSize: 15, color: '#7d88b0'
        }).setOrigin(0.5).setDepth(31);

        this.multText = this.add.text(W / 2, 936, '', {
            fontFamily: FONT, fontSize: 26, color: '#b388ff'
        }).setOrigin(0.5).setDepth(31).setAlpha(0);

        this.muteBtn = this.add.text(W - 24, 936, isMuted() ? '🔇' : '🔊', {
            fontFamily: FONT_UI, fontSize: 20
        }).setOrigin(1, 0.5).setDepth(32).setAlpha(0.4).setInteractive({ useHandCursor: true });

        this.muteBtn.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: any) =>
        {
            if (e && e.stopPropagation) e.stopPropagation();
            unlockAudio();
            meta.muted = toggleMute();
            saveMeta();
            this.muteBtn.setText(meta.muted ? '🔇' : '🔊');
        });

        this.muzzle = this.add.circle(MUZZLE.x, H - 6, 26, this.tier.accent, 0.35).setDepth(29);
    }

    private showLevelBanner (): void
    {
        const t = this.add.text(W / 2, PLAY.top + 190, `LEVEL ${run.level}`, {
            fontFamily: FONT, fontSize: 76, color: hex(this.tier.accent), stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setDepth(35).setScale(0.6).setAlpha(0);

        this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 180, ease: 'Back.out' });
        this.tweens.add({
            targets: t, scale: 1.5, alpha: 0, duration: 320, delay: 400, ease: 'Quad.in',
            onComplete: () => t.destroy()
        });
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

    private spawn (): void
    {
        const kind = pickKind(this.cfg.weights);
        const def = KINDS[kind];
        const radius = this.cfg.size * def.sizeMult;
        const spot = this.freeSpot(radius);
        const moving = Math.random() < this.cfg.moveChance;

        const t = new Target(this, spot.x, spot.y, kind, this.cfg.size, run.level, this.cfg.speed, moving);
        t.setLifetime(this.cfg.lifetime * (kind === 'bomb' ? 0.85 : 1));
        t.setDepth(10);

        this.targets.push(t);
    }

    private spawnBoss (): void
    {
        const t = new Target(this, W / 2, PLAY.top + 180, 'boss', this.cfg.size, run.level, this.cfg.speed, true);
        t.setLifetime(999999);
        t.setDepth(9);
        this.targets.push(t);

        this.time.delayedCall(320, () =>
        {
            this.fx.popup(W / 2, PLAY.top + 90, 'BOSS', 0xff2d55, 46, 40, 900);
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

        this.fx.tracer(MUZZLE.x, MUZZLE.y, px, py, this.tier.accent, 7, 150);
        this.muzzle.setScale(1.6);
        this.tweens.add({ targets: this.muzzle, scale: 1, duration: 130, ease: 'Quad.out' });

        const hit = new Set<Target>();
        const primary = this.pickTarget(px, py);

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

        if (this.stats.pierce > 0)
        {
            const along = this.targets
                .filter(t => !t.dead && !hit.has(t) && t.kind !== 'bomb' &&
                    distToSegment(t.x, t.y, MUZZLE.x, MUZZLE.y, px, py) < t.radius + 10)
                .sort((a, b) => a.distanceTo(px, py) - b.distanceTo(px, py))
                .slice(0, this.stats.pierce);

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

            for (const t of others)
            {
                hit.add(t);
                this.fx.tracer(MUZZLE.x, MUZZLE.y, t.x, t.y, this.tier.accent2, 4, 130);
                this.applyShot(t, t.x, t.y, false);
            }
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

    private applyShot (t: Target, hx: number, hy: number, direct: boolean): void
    {
        if (t.kind === 'bomb')
        {
            this.hitBomb(t);
            return;
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
        const radius = t.radius;
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

        this.progress += def.progress;
        run.kills += 1;

        //  --- feedback ---
        const big = crit || def.units > 1 || kind === 'golden' || kind === 'boss';

        this.fx.burst(x, y, def.color, big ? 26 : 14, kind === 'golden' || kind === 'boss' ? 'gold' : (big ? 'big' : 'hit'));
        this.fx.ring(x, y, radius * (big ? 3.4 : 2.2), def.color, big ? 6 : 3, big ? 420 : 280);

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
            this.fx.popup(W / 2, PLAY.top + 140, 'BOSS DOWN', 0xff2d55, 44, 50, 900);
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
            this.fx.tracer(fromX, fromY, best.x, best.y, 0xfff05c, 5, 220);
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

        this.fx.burst(x, y, 0xff4d5e, 8, 'hit');
        this.fx.ring(x, y, 40, 0xff4d5e, 3, 240);
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
        const colors = [ 0x6cf5c8, 0x3fe0ff, 0xb388ff, 0xff5ce0, 0xffb020, 0xff4d3d ];
        const color = colors[Math.min(idx, colors.length - 1)];

        const t = this.add.text(W / 2, PLAY.top + 250, s.label, {
            fontFamily: FONT, fontSize: 52 + idx * 5, color: hex(color), stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setDepth(34).setScale(0.3);

        this.tweens.add({ targets: t, scale: 1.1, duration: 200, ease: 'Back.out' });
        this.tweens.add({
            targets: t, scale: 1.6, alpha: 0, duration: 420, delay: 340, ease: 'Quad.in',
            onComplete: () => t.destroy()
        });

        this.fx.ring(W / 2, PLAY.top + 250, 240, color, 6, 520);
        this.cameras.main.shake(180, 0.008);
        this.cameras.main.flash(120, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff);
        Sfx.milestone(idx);
    }

    private showMult (): void
    {
        this.multText.setText(`SCORE x${this.tempMult}`);
        this.multText.setAlpha(1).setScale(1.6);
        this.tweens.add({ targets: this.multText, scale: 1, duration: 220, ease: 'Back.out' });
    }

    private bumpCoins (): void
    {
        this.coinText.setScale(1.28);
        this.tweens.add({ targets: this.coinText, scale: 1, duration: 160, ease: 'Quad.out' });
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

        //  timer bar
        const tf = Math.max(0, this.timeLeft / this.timeTotal);
        const low = this.timeLeft < 3200;
        const barColor = low ? 0xff4d5e : this.tier.accent;

        g.fillStyle(0x000000, 0.45);
        g.fillRoundedRect(26, 172, W - 52, 22, 11);
        if (tf > 0.001)
        {
            g.fillStyle(barColor, low ? 0.7 + Math.abs(Math.sin(this.time.now * 0.012)) * 0.3 : 0.95);
            g.fillRoundedRect(28, 174, Math.max(20, (W - 56) * tf), 18, 9);
        }

        //  goal bar
        const gf = Math.min(1, this.progress / this.cfg.goal);
        g.fillStyle(0x000000, 0.45);
        g.fillRoundedRect(26, 200, W - 52, 9, 4);
        if (gf > 0.001)
        {
            g.fillStyle(this.tier.accent2, 0.95);
            g.fillRoundedRect(28, 201, Math.max(8, (W - 56) * gf), 7, 3);
        }

        //  streak progress
        const next = STREAKS.find(s => this.combo < s.n);
        const prevN = this.milestoneIdx >= 0 ? STREAKS[this.milestoneIdx].n : 0;
        const sf = next ? Math.max(0, (this.combo - prevN) / (next.n - prevN)) : 1;

        g.fillStyle(0x000000, 0.4);
        g.fillRoundedRect(90, 908, W - 180, 9, 4);
        if (sf > 0.001)
        {
            g.fillStyle(this.tier.accent, 0.9);
            g.fillRoundedRect(91, 909, Math.max(8, (W - 182) * sf), 7, 3);
        }

        //  combo timer
        if (this.combo > 1)
        {
            const cf = Math.max(0, this.comboTimer / this.stats.comboWindow);
            g.fillStyle(this.tier.accent2, 0.8);
            g.fillRoundedRect(W / 2 - 60, 140, 120 * cf, 4, 2);
        }

        //  low-time vignette
        if (low && this.state === 'play')
        {
            const a = 0.06 + Math.abs(Math.sin(this.time.now * 0.01)) * 0.1;
            g.fillStyle(0xff0033, a);
            g.fillRect(0, 0, W, H);
        }
    }

    //  --------------------------------------------------------------- loop

    update (_time: number, delta: number): void
    {
        const dt = Math.min(50, delta);

        this.fx.update(dt);
        this.drawBackground();

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

            if (t.life <= 0 && this.state === 'play')
            {
                this.expireTarget(t);
            }
        }

        //  HUD text
        this.timeText.setText((this.timeLeft / 1000).toFixed(2));
        this.goalText.setText(`${Math.min(this.progress, this.cfg.goal)} / ${this.cfg.goal}`);

        if (this.combo >= 2)
        {
            this.comboText.setText(`COMBO x${this.combo}`);
            const b = this.streakBonus();
            this.comboText.setColor(hex(b >= 1 ? 0xffb020 : (b >= 0.25 ? 0xff5ce0 : this.tier.accent2)));
        }
        else
        {
            this.comboText.setText('');
        }

        const next = STREAKS.find(s => this.combo < s.n);
        this.streakText.setText(next ? `${next.n} STREAK  →  +${Math.round(next.bonus * this.stats.comboMult * 100)}% SCORE` : 'MAX STREAK');

        if (this.coinsDisplay !== meta.coins)
        {
            this.coinsDisplay += Math.max(1, Math.ceil((meta.coins - this.coinsDisplay) * 0.25));
            if (this.coinsDisplay > meta.coins) this.coinsDisplay = meta.coins;
            this.coinText.setText('◆ ' + fmt(this.coinsDisplay));
        }

        this.drawHud();
    }

    private drawBackground (): void
    {
        const g = this.bgGfx;
        const t = this.time.now;
        const step = 58;
        const off = (t * 0.022) % step;
        const alpha = 0.28 + Math.min(0.35, run.level * 0.018);

        g.clear();
        g.lineStyle(1, this.tier.grid, alpha);

        for (let x = 0; x <= W; x += step)
        {
            g.lineBetween(x, PLAY.top - 30, x, H);
        }

        for (let y = PLAY.top - 30 + off; y <= H; y += step)
        {
            g.lineBetween(0, y, W, y);
        }

        g.lineStyle(2, this.tier.accent, 0.35);
        g.lineBetween(0, PLAY.top - 30, W, PLAY.top - 30);
    }

    //  --------------------------------------------------------------- flow

    private fail (): void
    {
        if (this.state === 'done') return;

        this.state = 'done';

        //  A failed attempt does not bank its score into the run -- retrying
        //  replays the same level from the same total.
        run.bestCombo = Math.max(run.bestCombo, this.bestCombo);
        run.coinsEarned += this.levelCoins;
        run.xpEarned += this.levelXp;

        meta.rank += this.levelXp;
        meta.best = Math.max(meta.best, run.score + this.levelScore);
        meta.bestLevel = Math.max(meta.bestLevel, run.level - 1);
        saveMeta();

        Sfx.fail();
        this.cameras.main.shake(320, 0.014);

        this.time.delayedCall(340, () =>
        {
            this.cameras.main.fadeOut(180, 0, 0, 0);
            this.time.delayedCall(190, () => this.scene.start('Result', { mode: 'fail', levelScore: this.levelScore, bestCombo: this.bestCombo }));
        });
    }

    private levelComplete (): void
    {
        this.state = 'done';

        run.bestCombo = Math.max(run.bestCombo, this.bestCombo);
        Sfx.levelClear();
        this.cameras.main.flash(200, 255, 255, 255);

        //  Sweep the board -- every remaining target pops for free.
        const left = this.targets.slice();
        this.targets = [];

        left.forEach((t, i) =>
        {
            this.time.delayedCall(i * 45, () =>
            {
                this.fx.burst(t.x, t.y, t.def.color, 12, 'hit');
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

        this.showRewards(comboBonus, perfectBonus, perfect);
    }

    private showRewards (comboBonus: number, perfectBonus: number, perfect: boolean): void
    {
        const panel = this.add.container(0, 0).setDepth(40);

        const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.72);
        panel.add(dim);

        const title = this.add.text(W / 2, 300, 'LEVEL COMPLETE!', {
            fontFamily: FONT, fontSize: 44, color: hex(this.tier.accent), stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setScale(0.4);
        panel.add(title);

        this.tweens.add({ targets: title, scale: 1, duration: 260, ease: 'Back.out' });

        const rows: { label: string; value: number; color: number; suffix?: string }[] = [
            { label: 'COINS', value: this.levelCoins, color: 0xffc857 },
            { label: 'XP', value: this.levelXp, color: 0x9b6cff },
            { label: 'COMBO BONUS', value: comboBonus, color: 0xff5ce0 }
        ];

        if (perfect) rows.push({ label: 'PERFECT!', value: perfectBonus, color: 0x6cf5c8 });

        rows.forEach((r, i) =>
        {
            const y = 386 + i * 62;

            const label = this.add.text(90, y, r.label, {
                fontFamily: FONT_UI, fontSize: 20, color: '#8d97bd'
            }).setOrigin(0, 0.5).setAlpha(0);

            const value = this.add.text(W - 90, y, '+0', {
                fontFamily: FONT, fontSize: 34, color: hex(r.color)
            }).setOrigin(1, 0.5).setAlpha(0);

            panel.add([ label, value ]);

            this.time.delayedCall(220 + i * 150, () =>
            {
                label.setAlpha(1);
                value.setAlpha(1).setScale(1.3);
                this.tweens.add({ targets: value, scale: 1, duration: 180, ease: 'Back.out' });
                this.tweens.addCounter({
                    from: 0, to: r.value, duration: 340, ease: 'Cubic.out',
                    onUpdate: (tw: any) => value.setText('+' + fmt(tw.getValue() as number))
                });
                Sfx.reward();
            });
        });

        const totalY = 386 + rows.length * 62 + 42;

        const totalLabel = this.add.text(W / 2, totalY, 'SCORE', {
            fontFamily: FONT_UI, fontSize: 20, color: '#8d97bd'
        }).setOrigin(0.5).setAlpha(0);

        const total = this.add.text(W / 2, totalY + 52, '0', {
            fontFamily: FONT, fontSize: 60, color: '#ffffff', stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setAlpha(0);

        panel.add([ totalLabel, total ]);

        const revealDelay = 260 + rows.length * 150;

        this.time.delayedCall(revealDelay, () =>
        {
            totalLabel.setAlpha(1);
            total.setAlpha(1).setScale(1.5);
            this.tweens.add({ targets: total, scale: 1, duration: 240, ease: 'Back.out' });
            this.tweens.addCounter({
                from: 0, to: this.levelScore, duration: 420, ease: 'Cubic.out',
                onUpdate: (tw: any) => total.setText(fmt(tw.getValue() as number))
            });
            Sfx.milestone(2);
        });

        const advance = () =>
        {
            this.cameras.main.fadeOut(160, 0, 0, 0);
            this.time.delayedCall(170, () =>
            {
                if (run.level >= FINAL_LEVEL)
                {
                    this.scene.start('Result', { mode: 'victory', levelScore: this.levelScore, bestCombo: this.bestCombo });
                }
                else
                {
                    this.scene.start('Upgrade');
                }
            });
        };

        this.time.delayedCall(revealDelay + 900, advance);

        //  Tap anywhere to skip straight to the upgrade cards.
        this.time.delayedCall(400, () =>
        {
            dim.setInteractive({ useHandCursor: true });
            dim.once('pointerdown', () =>
            {
                this.time.removeAllEvents();
                advance();
            });
        });
    }
}
