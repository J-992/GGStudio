import { GameObjects, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { setGameplayActive } from '../core/lifecycle';
import { iconImage } from '../core/icons';
import { reportPlatformHappyTime } from '../platform/platform';
import { CX, CY, FONT, FONT_UI, H, LANDSCAPE, W, fmt, hex, mix } from '../core/theme';
import {
    CPU_COLOR, CPU_COLOR_DIM, ComboTier, CpuTier, MATCH_SECONDS, SeqTarget, YOU_COLOR, YOU_COLOR_DIM,
    buildSequence, comboTier, scoreHit
} from '../data/versus';

interface VersusData
{
    cpuName: string;
    tier: CpuTier;
}

/** One half of the screen and everything on it. */
interface PaneRect
{
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A target that is up right now. */
interface Live
{
    id: number;
    node: GameObjects.Container;
    fuse: GameObjects.Graphics;
    def: SeqTarget;
    at: number;
    x: number;
    y: number;
    r: number;
}

/** The strip between the two panes where the clock lives. */
const STRIP = LANDSCAPE ? 96 : 92;

/**
 * Where the two halves sit. Portrait stacks them, with the player on the
 * bottom where the thumbs are; a wide screen puts the player on the left.
 */
const PANES: { you: PaneRect; cpu: PaneRect } = LANDSCAPE
    ? {
        you: { x: 0, y: 0, w: CX - STRIP / 2, h: H },
        cpu: { x: CX + STRIP / 2, y: 0, w: CX - STRIP / 2, h: H }
    }
    : {
        cpu: { x: 0, y: 0, w: W, h: CY - STRIP / 2 },
        you: { x: 0, y: CY + STRIP / 2, w: W, h: CY - STRIP / 2 }
    };

/** Inset of the header band at the top of each pane. */
const HEAD = 64;

/** Gap between one target dying and its replacement. */
const RESPAWN_GAP = 140;

/** How long the wrong-side warning covers the opponent's half. */
const WRONG_SIDE_MS = 1000;

/**
 * Spotting a player who is mashing at the screen: the last few shots, how many
 * of them missed, and how fast they came. The lesson is only worth teaching
 * twice a match, and only after a pause long enough that it is not nagging.
 */
const SPRAY = {
    window: 8,
    misses: 5,
    /** Mean gap between shots, in ms, under which this is spray and not aim. */
    gap: 300,
    cooldown: 14000,
    max: 2
};

class Pane
{
    readonly rect: PaneRect;
    readonly play: PaneRect;
    readonly color: number;
    readonly dim: number;
    readonly isYou: boolean;

    score = 0;
    streak = 0;
    bestStreak = 0;
    hits = 0;
    misses = 0;
    bulls = 0;
    /** Next index into the shared sequence. */
    index = 0;
    /** How many targets the pane is keeping up, per the last spawned def. */
    slots = 2;

    live: Live[] = [];
    /** Replacements that are waiting out the respawn gap. */
    pending: number[] = [];

    private nextId = 1;
    private tier: ComboTier;

    private scoreText: GameObjects.Text;
    private multText: GameObjects.Text;
    private streakText: GameObjects.Text;
    /** Border that heats up with the combo. */
    private heat: GameObjects.Graphics;
    private heatTween: Phaser.Tweens.Tween | null = null;

    constructor (
        private scene: Scene,
        private fx: Fx,
        rect: PaneRect,
        name: string,
        sub: string,
        color: number,
        dim: number,
        isYou: boolean
    )
    {
        this.rect = rect;
        this.color = color;
        this.dim = dim;
        this.isYou = isYou;
        this.tier = comboTier(0);
        this.play = {
            x: rect.x + 26,
            y: rect.y + HEAD + 10,
            w: rect.w - 52,
            h: rect.h - HEAD - 34
        };

        //  Background: a tinted panel with the side's colour along the edge
        //  that faces the clock, so the split reads from across a room.
        const g = scene.add.graphics().setDepth(1);
        g.fillStyle(mix(0x080b1c, color, 0.08), 1);
        g.fillRect(rect.x, rect.y, rect.w, rect.h);
        g.lineStyle(1, mix(0x1b2a5e, color, 0.35), 0.45);

        for (let x = rect.x; x <= rect.x + rect.w; x += 58) g.lineBetween(x, rect.y, x, rect.y + rect.h);
        for (let y = rect.y; y <= rect.y + rect.h; y += 58) g.lineBetween(rect.x, y, rect.x + rect.w, y);

        g.fillStyle(color, 0.9);

        if (LANDSCAPE)
        {
            const ex = isYou ? rect.x + rect.w - 4 : rect.x;
            g.fillRect(ex, rect.y, 4, rect.h);
        }
        else
        {
            const ey = isYou ? rect.y : rect.y + rect.h - 4;
            g.fillRect(rect.x, ey, rect.w, 4);
        }

        this.heat = scene.add.graphics().setDepth(2).setAlpha(0);

        //  Header: name on the left, score on the right.
        const hy = rect.y + 30;
        const tag = scene.add.container(rect.x + 24, hy).setDepth(5);
        const tg = scene.add.graphics();
        tg.fillStyle(color, 1);
        tg.fillRoundedRect(0, -13, isYou ? 54 : 50, 26, 8);
        tag.add(tg);
        tag.add(scene.add.text(isYou ? 27 : 25, 0, isYou ? 'YOU' : 'CPU', {
            fontFamily: FONT, fontSize: 14, color: '#06101f'
        }).setOrigin(0.5));
        tag.add(scene.add.text(isYou ? 66 : 62, -2, name, {
            fontFamily: FONT, fontSize: name.length > 12 ? 17 : 20, color: hex(color)
        }).setOrigin(0, 0.5));
        tag.add(scene.add.text(isYou ? 66 : 62, 17, sub, {
            fontFamily: FONT_UI, fontSize: 11, color: '#7d88b0'
        }).setOrigin(0, 0.5));

        this.scoreText = scene.add.text(rect.x + rect.w - 24, hy, '0', {
            fontFamily: FONT, fontSize: 34, color: '#ffffff', stroke: hex(dim), strokeThickness: 4
        }).setOrigin(1, 0.5).setDepth(5);

        //  The multiplier sits under the score; the streak count to its left.
        this.multText = scene.add.text(rect.x + rect.w - 24, hy + 30, '', {
            fontFamily: FONT, fontSize: 16, color: '#ffffff', stroke: '#000000', strokeThickness: 3
        }).setOrigin(1, 0.5).setDepth(5);

        this.streakText = scene.add.text(rect.x + rect.w - 24, hy + 30, '', {
            fontFamily: FONT_UI, fontSize: 12, color: hex(color)
        }).setOrigin(1, 0.5).setDepth(5);
    }

    /** Pane-fraction coordinates to screen, for the shared sequence. */
    place (def: SeqTarget): { x: number; y: number; r: number }
    {
        const r = def.r * Math.min(this.play.w, this.play.h);
        const x = this.play.x + r + def.u * (this.play.w - r * 2);
        const y = this.play.y + r + def.v * (this.play.h - r * 2);

        return { x, y, r };
    }

    spawn (def: SeqTarget, now: number): Live
    {
        const { x, y, r } = this.place(def);
        const c = this.color;

        const node = this.scene.add.container(x, y).setDepth(3);
        const g = this.scene.add.graphics();

        //  A bullseye: three rings, brighter toward the centre, because the
        //  centre is where the points are and it has to look like it.
        g.fillStyle(c, 0.22);
        g.fillCircle(0, 0, r);
        g.lineStyle(3, c, 0.9);
        g.strokeCircle(0, 0, r);
        g.fillStyle(c, 0.3);
        g.fillCircle(0, 0, r * 0.66);
        g.lineStyle(2, mix(c, 0xffffff, 0.4), 0.8);
        g.strokeCircle(0, 0, r * 0.66);
        g.fillStyle(mix(c, 0xffffff, 0.55), 1);
        g.fillCircle(0, 0, r * 0.32);
        node.add(g);

        const fuse = this.scene.add.graphics();
        node.add(fuse);

        node.setScale(0.2);
        this.scene.tweens.add({ targets: node, scale: 1, duration: 140, ease: 'Back.out' });

        const live: Live = { id: this.nextId++, node, fuse, def, at: now, x, y, r };

        this.live.push(live);
        this.slots = def.slots;

        return live;
    }

    /** Redraw every fuse; expire the ones whose time is up. Returns how many did. */
    tick (now: number): number
    {
        let expired = 0;

        for (let i = this.live.length - 1; i >= 0; i--)
        {
            const t = this.live[i];
            const left = 1 - (now - t.at) / t.def.life;

            t.fuse.clear();

            if (left <= 0)
            {
                this.expire(t, now);
                expired += 1;
                continue;
            }

            const r = t.r + 7;
            t.fuse.lineStyle(3, left < 0.3 ? 0xffffff : this.color, 0.8);
            t.fuse.beginPath();
            t.fuse.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left, false);
            t.fuse.strokePath();
        }

        return expired;
    }

    /** The live target a point lands on -- the closest centre, if any. */
    targetAt (x: number, y: number): Live | null
    {
        let best: Live | null = null;
        let bestD = Infinity;

        for (const t of this.live)
        {
            const d = Math.hypot(x - t.x, y - t.y);

            if (d <= t.r * 1.05 && d < bestD)
            {
                best = t;
                bestD = d;
            }
        }

        return best;
    }

    /** The target that has been up the longest -- what a sane player shoots first. */
    oldest (): Live | null
    {
        let best: Live | null = null;
        for (const t of this.live) if (!best || t.at < best.at) best = t;
        return best;
    }

    /**
     * A shot lands at (x, y). Returns the points scored, 0 on a miss, and
     * the combo tier that was just reached, if one was.
     */
    shoot (x: number, y: number, now: number): { points: number; reached: ComboTier | null }
    {
        const t = this.targetAt(x, y);

        if (!t)
        {
            this.miss(x, y);
            return { points: 0, reached: null };
        }

        const d = Math.hypot(x - t.x, y - t.y);
        const { points, tier, mult } = scoreHit(d / t.r, this.streak);

        this.streak += 1;
        this.hits += 1;
        this.score += points;
        this.bestStreak = Math.max(this.bestStreak, this.streak);

        if (tier === 'bull') this.bulls += 1;

        const before = this.tier;
        this.tier = comboTier(this.streak);
        const reached = this.tier !== before ? this.tier : null;

        const hot = this.tier.at >= 10;
        const label = tier === 'bull' ? `BULLSEYE +${points}` : `+${points}`;
        const color = tier === 'bull' ? 0xffc857 : hot ? this.tier.color : tier === 'inner' ? mix(this.color, 0xffffff, 0.5) : this.color;

        this.fx.burst(t.x, t.y, hot ? this.tier.color : this.color, (tier === 'bull' ? 16 : 9) + (hot ? 6 : 0), tier === 'bull' || hot ? 'big' : 'hit');
        this.fx.ring(t.x, t.y, t.r * (2.2 + mult * 0.3), color, 3, 260);
        this.fx.popup(t.x, t.y - t.r - 6, label, color, tier === 'bull' ? 22 : 18, 44, 520);

        if (mult > 1 && tier !== 'bull')
        {
            this.fx.popup(t.x, t.y + t.r + 10, `x${mult}`, this.tier.color, 14, 26, 420);
        }

        this.remove(t);
        this.pending.push(now + RESPAWN_GAP);
        this.bump();

        return { points, reached };
    }

    miss (x: number, y: number): void
    {
        this.breakStreak(x, y);
        this.misses += 1;

        const g = this.scene.add.graphics().setDepth(4);
        g.lineStyle(3, this.color, 0.8);
        g.lineBetween(x - 7, y - 7, x + 7, y + 7);
        g.lineBetween(x - 7, y + 7, x + 7, y - 7);
        this.scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
        this.fx.ring(x, y, 22, this.color, 2, 200);
    }

    /** A target's clock ran out. Counts against the streak like a miss does. */
    private expire (t: Live, now: number): void
    {
        const node = t.node;
        this.scene.tweens.add({ targets: node, alpha: 0, scale: 0.5, duration: 160, onComplete: () => node.destroy() });
        this.live.splice(this.live.indexOf(t), 1);
        this.pending.push(now + RESPAWN_GAP);
        this.breakStreak(t.x, t.y);
    }

    private breakStreak (x: number, y: number): void
    {
        const lost = this.streak;

        this.streak = 0;
        this.tier = comboTier(0);

        if (lost >= 5)
        {
            //  A long run ending is a moment too: the heat drains, the
            //  multiplier falls off the screen.
            this.fx.popup(x, y - 30, `${lost} COMBO LOST`, 0xffffff, 16, 40, 700);
            this.heatTween?.stop();
            this.scene.tweens.add({ targets: this.heat, alpha: 0, duration: 320, ease: 'Quad.out' });

            const baseY = this.multText.y;
            this.scene.tweens.add({
                targets: this.multText, y: baseY + 14, alpha: 0, duration: 240,
                onComplete: () => { this.multText.setAlpha(1).setY(baseY).setText(''); }
            });
        }

        this.refresh();
    }

    private remove (t: Live): void
    {
        t.node.destroy();
        this.live.splice(this.live.indexOf(t), 1);
    }

    /** How many targets to spawn now: pending ones whose gap has passed, plus any newly opened slot. */
    due (now: number): number
    {
        let n = 0;

        while (this.pending.length && this.pending[0] <= now && this.live.length + n < this.slots)
        {
            this.pending.shift();
            n += 1;
        }

        //  A slot that opened because the sequence went three-wide is owed
        //  immediately; there is no dead target to wait on.
        if (this.pending.length === 0) n = Math.max(n, this.slots - this.live.length);

        return n;
    }

    clearAll (): void
    {
        for (const t of this.live) t.node.destroy();
        this.live = [];
        this.pending = [];
        this.heatTween?.stop();
        this.heat.setAlpha(0);
    }

    private bump (): void
    {
        this.refresh();
        this.scene.tweens.add({ targets: this.scoreText, scale: 1.18, duration: 80, yoyo: true });

        if (this.tier.mult > 1)
        {
            this.scene.tweens.add({ targets: this.multText, scale: 1.35, duration: 90, yoyo: true });
        }
    }

    refresh (): void
    {
        this.scoreText.setText(fmt(this.score));

        const right = this.rect.x + this.rect.w - 24;

        if (this.tier.mult > 1)
        {
            this.multText.setText(`x${this.tier.mult}`).setColor(hex(this.tier.color));
            this.streakText.setText(`${this.streak} STREAK`).setX(right - this.multText.width - 8);
        }
        else
        {
            this.multText.setText('');
            this.streakText.setText(this.streak >= 3 ? `${this.streak} STREAK` : '').setX(right);
        }
    }

    /**
     * The border glow for a combo tier. Drawn once per tier, pulsed by tween;
     * the hotter the tier the brighter and faster it breathes.
     */
    heatUp (tier: ComboTier): void
    {
        const r = this.rect;
        const g = this.heat;

        g.clear();

        for (let i = 0; i < 3; i++)
        {
            g.lineStyle(4 + i * 6, tier.color, 0.55 - i * 0.16);
            g.strokeRect(r.x + 2 + i * 3, r.y + 2 + i * 3, r.w - 4 - i * 6, r.h - 4 - i * 6);
        }

        this.heatTween?.stop();
        g.setAlpha(0.2);
        this.heatTween = this.scene.tweens.add({
            targets: g, alpha: Math.min(1, 0.5 + tier.mult * 0.12),
            duration: Math.max(240, 700 - tier.mult * 100), yoyo: true, repeat: -1, ease: 'Sine.inOut'
        });
    }
}

/**
 * The match. Two panes, one clock, the same targets on both sides -- two or
 * three up at a time. The player taps theirs; a simulated opponent with a
 * reaction time and an aim spread shoots at the other.
 */
export class VersusScene extends Scene
{
    private fx!: Fx;
    private match!: VersusData;
    private seq: SeqTarget[] = [];

    private you!: Pane;
    private cpu!: Pane;

    private state: 'count' | 'play' | 'over' = 'count';
    private endAt = 0;
    private lastWhole = MATCH_SECONDS;

    private clock!: GameObjects.Text;
    private clockBar!: GameObjects.Graphics;
    private leadBar!: GameObjects.Graphics;
    private leadText!: GameObjects.Text;

    /** The CPU's crosshair, and the shot it has decided to take. */
    private cursor!: GameObjects.Container;
    private cpuShotAt = 0;
    private cpuAim = { x: 0, y: 0 };
    private cpuFocus: Live | null = null;

    /** The cover over the opponent's half, while it is up. */
    private wrongSide: GameObjects.Container | null = null;
    private wrongSideTimer: Phaser.Time.TimerEvent | null = null;

    /** The player's last few shots, and the spray lesson they may have earned. */
    private shots: { at: number; hit: boolean }[] = [];
    private sprayShown = 0;
    private sprayAt = 0;
    private sprayCard: GameObjects.Container | null = null;

    constructor ()
    {
        super('Versus');
    }

    init (data: VersusData)
    {
        this.match = data;
    }

    create ()
    {
        this.state = 'count';
        this.cpuFocus = null;
        this.wrongSide = null;
        this.wrongSideTimer = null;
        this.shots = [];
        this.sprayShown = 0;
        this.sprayAt = 0;
        this.sprayCard = null;
        this.cameras.main.setBackgroundColor(0x080b1c);
        this.cameras.main.fadeIn(160, 0, 0, 0);
        this.fx = new Fx(this, 20);

        this.seq = buildSequence(Math.floor(Math.random() * 0x7fffffff));

        this.you = new Pane(this, this.fx, PANES.you, 'YOU', 'blue side', YOU_COLOR, YOU_COLOR_DIM, true);
        this.cpu = new Pane(this, this.fx, PANES.cpu, this.match.cpuName, `${this.match.tier.name} opponent`, CPU_COLOR, CPU_COLOR_DIM, false);

        this.buildStrip();
        this.buildCursor();

        this.input.on('pointerdown', (p: Phaser.Input.Pointer) =>
        {
            unlockAudio();

            if (this.state === 'over') return;

            const r = this.you.rect;
            const mine = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y + HEAD && p.y <= r.y + r.h;

            if (!mine)
            {
                //  Shooting at the opponent's half is the first thing a lot of
                //  players try, and nothing happening is no answer. Say it on
                //  the half they shot at, where they are already looking.
                if (this.inPane(this.cpu.rect, p.x, p.y)) this.warnWrongSide(p.x, p.y);

                return;
            }

            if (this.state !== 'play') return;

            const now = this.time.now;
            const { points, reached } = this.you.shoot(p.x, p.y, now);

            if (points > 0)
            {
                if (points >= 250) Sfx.crit();
                else Sfx.hit(this.you.streak);

                if (reached) this.comboCallout(this.you, reached);

                this.refreshLead();
            }
            else
            {
                Sfx.miss();
            }

            this.trackShot(points > 0, now);
        });

        this.countdown();

        this.events.once('shutdown', () => setGameplayActive(false));
    }

    //  ------------------------------------------------------------ coaching

    private inPane (r: PaneRect, x: number, y: number): boolean
    {
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    /**
     * The player shot at the opponent's half. Black it out for a second with
     * an arrow pointing at their own -- long enough to read, short enough that
     * it never costs them a target they could have hit.
     */
    private warnWrongSide (x: number, y: number): void
    {
        Sfx.dry();
        this.fx.ring(x, y, 34, CPU_COLOR, 3, 240);

        //  Already up: restart its clock rather than stack a second copy.
        if (this.wrongSide)
        {
            this.wrongSideTimer?.remove();
            this.wrongSideTimer = this.time.delayedCall(WRONG_SIDE_MS, () => this.hideWrongSide());

            return;
        }

        const r = this.cpu.rect;
        const c = this.add.container(r.x + r.w / 2, r.y + r.h / 2).setDepth(18).setAlpha(0);

        const g = this.add.graphics();
        g.fillStyle(0x1a0410, 0.86);
        g.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
        g.lineStyle(4, CPU_COLOR, 0.95);
        g.strokeRect(-r.w / 2 + 3, -r.h / 2 + 3, r.w - 6, r.h - 6);
        c.add(g);

        c.add(this.add.text(0, -52, 'NOT YOUR SIDE', {
            fontFamily: FONT, fontSize: LANDSCAPE ? 36 : 30, color: hex(CPU_COLOR),
            stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5));

        c.add(this.add.text(0, -14, 'THIS HALF BELONGS TO THE CPU', {
            fontFamily: FONT_UI, fontSize: 15, color: '#ffb0bb'
        }).setOrigin(0.5));

        c.add(this.add.text(0, 26, LANDSCAPE ? 'SHOOT THE BLUE HALF ON THE LEFT' : 'SHOOT THE BLUE HALF BELOW', {
            fontFamily: FONT, fontSize: 18, color: hex(YOU_COLOR), stroke: '#000000', strokeThickness: 5
        }).setOrigin(0.5));

        const arrow = iconImage(this, 0, 74, 'chevrons', { size: 46, color: YOU_COLOR });
        arrow.setAngle(LANDSCAPE ? 180 : 90);
        c.add(arrow);

        this.tweens.add({
            targets: arrow, ...(LANDSCAPE ? { x: -18 } : { y: 88 }),
            duration: 400, yoyo: true, repeat: -1, ease: 'Sine.inOut'
        });

        c.setScale(0.96);
        this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 120, ease: 'Quad.out' });

        this.wrongSide = c;
        this.wrongSideTimer = this.time.delayedCall(WRONG_SIDE_MS, () => this.hideWrongSide());
    }

    private hideWrongSide (): void
    {
        const c = this.wrongSide;

        this.wrongSideTimer?.remove();
        this.wrongSideTimer = null;
        this.wrongSide = null;

        if (!c) return;

        this.tweens.add({ targets: c, alpha: 0, duration: 200, onComplete: () => c.destroy() });
    }

    /**
     * Watch the player's own shots. A run of fast taps that mostly miss is
     * somebody mashing at the screen, and the thing they have not noticed is
     * that the combo -- not the click rate -- is where the points are. Say it
     * once, plainly, and then leave them alone for a good while.
     */
    private trackShot (hit: boolean, now: number): void
    {
        this.shots.push({ at: now, hit });

        if (this.shots.length > SPRAY.window) this.shots.shift();

        if (hit || this.shots.length < SPRAY.window) return;
        if (this.sprayShown >= SPRAY.max || now - this.sprayAt < SPRAY.cooldown) return;

        const misses = this.shots.filter(s => !s.hit).length;
        const gap = (this.shots[this.shots.length - 1].at - this.shots[0].at) / (this.shots.length - 1);

        if (misses < SPRAY.misses || gap > SPRAY.gap) return;

        this.sprayShown += 1;
        this.sprayAt = now;
        this.shots = [];
        this.sprayTip();
    }

    /** The tip card itself: high in the player's own half, and out again. */
    private sprayTip (): void
    {
        this.sprayCard?.destroy();

        const r = this.you.play;
        const w = Math.min(430, r.w - 12);
        const h = 106;
        const baseY = r.y + h / 2 + 8;

        const c = this.add.container(r.x + r.w / 2, baseY - 8).setDepth(16).setAlpha(0);

        const g = this.add.graphics();
        g.fillStyle(0x0b1024, 0.93);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
        g.lineStyle(2, 0xffc857, 0.8);
        g.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
        c.add(g);
        c.add(iconImage(this, -w / 2 + 32, 0, 'mult', { size: 28, color: 0xffc857 }));

        c.add(this.add.text(-w / 2 + 60, -32, 'SLOW DOWN · STACK YOUR COMBO', {
            fontFamily: FONT, fontSize: 13, color: '#ffc857'
        }).setOrigin(0, 0.5).setLetterSpacing(1));

        c.add(this.add.text(-w / 2 + 60, -16, 'Spraying misses and resets your streak. 5 hits in a row is x1.5, 10 is x2 — one aimed shot is worth more than five fast ones.', {
            fontFamily: FONT_UI, fontSize: 13, color: '#dfe5ff', wordWrap: { width: w - 80 }
        }).setOrigin(0, 0));

        Sfx.chip();
        this.tweens.add({ targets: c, alpha: 1, y: baseY, duration: 180, ease: 'Quad.out' });
        this.tweens.add({
            targets: c, alpha: 0, duration: 300, delay: 2800,
            onComplete: () => { if (this.sprayCard === c) this.sprayCard = null; c.destroy(); }
        });

        this.sprayCard = c;
    }

    //  ------------------------------------------------------------ the combo

    /**
     * A new combo tier slams its name across the pane, the border lights up
     * in its colour and the camera flinches -- once per tier, so a long
     * streak is a staircase of bigger and bigger moments, not a strobe.
     */
    private comboCallout (pane: Pane, tier: ComboTier): void
    {
        const r = pane.rect;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h * 0.5;

        pane.heatUp(tier);

        const big = tier.mult >= 2.5;

        const t = this.add.text(cx, cy, tier.name, {
            fontFamily: FONT, fontSize: big ? 44 : 36, color: hex(tier.color),
            stroke: '#000000', strokeThickness: 8
        }).setOrigin(0.5).setDepth(15).setScale(0.2).setAlpha(0.95).setAngle(-4);

        const sub = this.add.text(cx, cy + (big ? 34 : 28), `${tier.at} HIT COMBO  ·  x${tier.mult}`, {
            fontFamily: FONT, fontSize: 15, color: '#ffffff', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5).setDepth(15).setAlpha(0);

        this.tweens.add({ targets: t, scale: 1, angle: 0, duration: 220, ease: 'Back.out' });
        this.tweens.add({ targets: sub, alpha: 1, y: sub.y + 6, duration: 180, delay: 120 });
        this.tweens.add({
            targets: [ t, sub ], alpha: 0, y: '-=30', duration: 420, delay: 760, ease: 'Quad.in',
            onComplete: () => { t.destroy(); sub.destroy(); }
        });

        //  Sparks fan out from the word along the pane.
        for (let i = 0; i < (big ? 4 : 2); i++)
        {
            this.time.delayedCall(i * 70, () =>
                this.fx.burst(cx + (Math.random() - 0.5) * r.w * 0.6, cy + (Math.random() - 0.5) * 60, tier.color, 10, big ? 'gold' : 'big'));
        }

        this.fx.ring(cx, cy, Math.min(r.w, r.h) * 0.6, tier.color, 5, 460);

        if (pane.isYou)
        {
            Sfx.milestone(Math.min(3, Math.round(tier.mult)));
            this.cameras.main.shake(big ? 160 : 100, big ? 0.009 : 0.005);
        }
        else
        {
            Sfx.chip();
        }
    }

    //  ------------------------------------------------------------ the strip

    private buildStrip (): void
    {
        const g = this.add.graphics().setDepth(2);
        g.fillStyle(0x05070f, 1);

        if (LANDSCAPE) g.fillRect(CX - STRIP / 2, 0, STRIP, H);
        else g.fillRect(0, CY - STRIP / 2, W, STRIP);

        const cx = CX;
        const cy = LANDSCAPE ? 70 : CY;

        this.clock = this.add.text(cx, cy - (LANDSCAPE ? 0 : 8), this.clockLabel(MATCH_SECONDS), {
            fontFamily: FONT, fontSize: LANDSCAPE ? 30 : 40, color: '#ffffff', stroke: '#000000', strokeThickness: 5
        }).setOrigin(0.5).setDepth(6);

        this.clockBar = this.add.graphics().setDepth(6);
        this.leadBar = this.add.graphics().setDepth(6);

        this.leadText = this.add.text(cx, LANDSCAPE ? H - 40 : cy + 30, '', {
            fontFamily: FONT_UI, fontSize: 12, color: '#7d88b0'
        }).setOrigin(0.5).setDepth(6);

        this.refreshLead();
        this.drawClock(1);
    }

    private clockLabel (secs: number): string
    {
        return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
    }

    private drawClock (frac: number): void
    {
        const g = this.clockBar;
        g.clear();

        const warn = frac < 10 / MATCH_SECONDS;
        const c = warn ? CPU_COLOR : 0xffffff;

        if (LANDSCAPE)
        {
            //  A vertical bar running the length of the strip, draining down.
            const x = CX - 5;
            const top = 110;
            const len = H - 170;
            g.fillStyle(0x1b2a5e, 0.6);
            g.fillRoundedRect(x, top, 10, len, 5);
            g.fillStyle(c, 0.9);
            g.fillRoundedRect(x, top, 10, Math.max(10, len * frac), 5);
        }
        else
        {
            //  A horizontal bar across the strip, shrinking from both ends so
            //  the time left is centred under the numbers.
            const w = W - 80;
            const y = CY + STRIP / 2 - 14;
            g.fillStyle(0x1b2a5e, 0.6);
            g.fillRoundedRect(40, y, w, 8, 4);
            const fw = Math.max(8, w * frac);
            g.fillStyle(c, 0.9);
            g.fillRoundedRect(CX - fw / 2, y, fw, 8, 4);
        }
    }

    /**
     * Who is ahead, and by how much -- a two-colour bar that tips towards the
     * leader, because the two scores are at opposite corners of the screen
     * and nobody has time to subtract them mid-match.
     */
    private refreshLead (): void
    {
        const a = this.you.score;
        const b = this.cpu.score;
        const total = a + b;
        const share = total === 0 ? 0.5 : a / total;
        const g = this.leadBar;

        g.clear();

        if (LANDSCAPE)
        {
            const x = CX + 8;
            const top = 110;
            const len = H - 170;
            const ya = Math.round(len * share);
            g.fillStyle(YOU_COLOR, 1);
            g.fillRoundedRect(x, top, 10, ya, 5);
            g.fillStyle(CPU_COLOR, 1);
            g.fillRoundedRect(x, top + ya, 10, len - ya, 5);
        }
        else
        {
            const w = W - 80;
            const y = CY + STRIP / 2 - 28;
            const wa = Math.round(w * share);
            g.fillStyle(YOU_COLOR, 1);
            g.fillRoundedRect(40, y, wa, 8, 4);
            g.fillStyle(CPU_COLOR, 1);
            g.fillRoundedRect(40 + wa, y, w - wa, 8, 4);
        }

        const diff = a - b;
        this.leadText.setText(diff === 0 ? 'EVEN' : diff > 0 ? `YOU +${fmt(diff)}` : `THEM +${fmt(-diff)}`)
            .setColor(diff === 0 ? '#7d88b0' : hex(diff > 0 ? YOU_COLOR : CPU_COLOR));
    }

    //  ------------------------------------------------------------ the CPU

    private buildCursor (): void
    {
        const r = this.cpu.play;
        this.cursor = this.add.container(r.x + r.w / 2, r.y + r.h / 2).setDepth(7);

        const g = this.add.graphics();
        g.lineStyle(2, CPU_COLOR, 0.95);
        g.strokeCircle(0, 0, 13);
        g.lineBetween(-20, 0, -7, 0);
        g.lineBetween(7, 0, 20, 0);
        g.lineBetween(0, -20, 0, -7);
        g.lineBetween(0, 7, 0, 20);
        g.fillStyle(CPU_COLOR, 1);
        g.fillCircle(0, 0, 2);
        this.cursor.add(g);
    }

    /**
     * Decide where and when the CPU's next shot goes. It always takes the
     * oldest target -- the one about to run out -- and a target that has
     * already been sitting there while it dealt with another needs less of a
     * reaction, because it has already been seen.
     */
    private planCpuShot (now: number, afterMiss: boolean): void
    {
        const tier = this.match.tier;
        const t = this.cpu.oldest();

        this.cpuFocus = t;

        if (!t) return;

        const seen = now - t.at;
        const delay = afterMiss
            ? tier.retry + Math.random() * tier.retry * 0.5
            : Math.max(tier.react * 0.5, tier.react - seen * 0.6) + (Math.random() * 2 - 1) * tier.jitter;

        //  Aim: a gaussian-ish scatter around the centre, scaled by spread;
        //  a deliberate miss lands just outside the rim.
        const hitRoll = Math.random() < tier.accuracy;
        const angle = Math.random() * Math.PI * 2;
        const gauss = (Math.random() + Math.random() + Math.random()) / 3;
        const dist = hitRoll
            ? gauss * tier.spread * t.r
            : t.r * (1.15 + Math.random() * 0.5);

        this.cpuAim = { x: t.x + Math.cos(angle) * dist, y: t.y + Math.sin(angle) * dist };
        this.cpuShotAt = now + Math.max(110, delay);

        //  The crosshair drifts to the shot over most of the reaction time.
        this.tweens.killTweensOf(this.cursor);
        this.tweens.add({
            targets: this.cursor, x: this.cpuAim.x, y: this.cpuAim.y,
            duration: Math.max(80, (this.cpuShotAt - now) * 0.75), ease: 'Quad.out'
        });
    }

    private cpuFire (now: number): void
    {
        const p = this.cpu;

        this.cpuFocus = null;
        this.tweens.add({ targets: this.cursor, scale: 0.7, duration: 60, yoyo: true });

        const { points, reached } = p.shoot(this.cpuAim.x, this.cpuAim.y, now);

        if (points > 0)
        {
            if (reached) this.comboCallout(p, reached);
            this.refreshLead();
        }
        else
        {
            this.planCpuShot(now, true);
        }
    }

    //  ------------------------------------------------------------ the clock

    private countdown (): void
    {
        setGameplayActive(true);

        const steps = [ '3', '2', '1', 'GO!' ];

        steps.forEach((s, i) =>
        {
            this.time.delayedCall(500 + i * 700, () =>
            {
                const go = s === 'GO!';
                const t = this.add.text(CX, CY, s, {
                    fontFamily: FONT, fontSize: go ? 96 : 120, color: go ? '#6cf5c8' : '#ffffff',
                    stroke: '#000000', strokeThickness: 12
                }).setOrigin(0.5).setDepth(30).setScale(0.3);

                if (go) Sfx.launch();
                else Sfx.ui();

                this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.out' });
                this.tweens.add({
                    targets: t, alpha: 0, scale: 1.5, duration: 380, delay: 260, onComplete: () => t.destroy()
                });

                if (go) this.begin();
            });
        });
    }

    private begin (): void
    {
        this.state = 'play';
        this.endAt = this.time.now + MATCH_SECONDS * 1000;
        this.lastWhole = MATCH_SECONDS;
    }

    private finish (): void
    {
        this.state = 'over';
        setGameplayActive(false);

        this.you.clearAll();
        this.cpu.clearAll();
        this.hideWrongSide();
        this.tweens.killTweensOf(this.cursor);
        this.clock.setText('0:00');
        this.drawClock(0);

        Sfx.milestone(3);

        const t = this.add.text(CX, CY, 'TIME!', {
            fontFamily: FONT, fontSize: 96, color: '#ffffff', stroke: '#000000', strokeThickness: 12
        }).setOrigin(0.5).setDepth(30).setScale(0.3);

        this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.out' });
        this.cameras.main.shake(160, 0.01);

        const won = this.you.score > this.cpu.score;
        void reportPlatformHappyTime(won ? 0.9 : 0.4);

        this.time.delayedCall(1300, () =>
        {
            this.cameras.main.fadeOut(220, 0, 0, 0);
            this.time.delayedCall(230, () => this.scene.start('VersusResult', {
                you: this.you.score,
                cpu: this.cpu.score,
                cpuName: this.match.cpuName,
                tier: this.match.tier,
                stats: {
                    hits: this.you.hits, misses: this.you.misses, bulls: this.you.bulls,
                    bestStreak: this.you.bestStreak,
                    cpuHits: this.cpu.hits, cpuMisses: this.cpu.misses
                }
            }));
        });
    }

    //  ------------------------------------------------------------ the loop

    private stepPane (pane: Pane, now: number): void
    {
        const expired = pane.tick(now);

        //  The CPU was lining up a target that just vanished: start over.
        if (expired > 0 && !pane.isYou && this.cpuFocus && pane.live.indexOf(this.cpuFocus) === -1)
        {
            this.cpuFocus = null;
        }

        const n = pane.due(now);

        for (let i = 0; i < n; i++)
        {
            const def = this.seq[pane.index % this.seq.length];
            pane.index += 1;
            pane.spawn(def, now);
        }
    }

    update (_t: number, delta: number): void
    {
        this.fx.update(Math.min(50, delta));

        if (this.state !== 'play') return;

        const now = this.time.now;
        const left = Math.max(0, this.endAt - now);

        if (left <= 0)
        {
            this.finish();
            return;
        }

        const secs = Math.ceil(left / 1000);

        if (secs !== this.lastWhole)
        {
            this.lastWhole = secs;
            this.clock.setText(this.clockLabel(secs));

            if (secs <= 10)
            {
                this.clock.setColor(hex(CPU_COLOR));
                this.tweens.add({ targets: this.clock, scale: 1.2, duration: 90, yoyo: true });
                Sfx.dry();
            }
        }

        this.drawClock(left / (MATCH_SECONDS * 1000));

        this.stepPane(this.you, now);
        this.stepPane(this.cpu, now);

        if (!this.cpuFocus && this.cpu.live.length) this.planCpuShot(now, false);
        else if (this.cpuFocus && now >= this.cpuShotAt) this.cpuFire(now);
    }
}
