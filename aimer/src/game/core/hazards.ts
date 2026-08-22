import { GameObjects, Scene } from 'phaser';
import { Glass } from '../objects/Glass';
import { Concrete } from '../objects/Concrete';
import { Flak } from '../objects/Flak';
import { Fx } from './fx';
import { Sfx } from './audio';
import type { HazardSpec, Signature } from '../data/hazards';
import { CX, FONT, MUZZLE, PLAY, Tier, mix } from './theme';

/**
 * The obstacle layer: everything in the arena that is not a target.
 *
 * It owns three things -- panes of armoured glass that stand between the gun
 * and the board, slabs of concrete that will never come down at all, and bolts
 * fired back at the gun -- and it owns them completely.
 * The scene tells it when play starts and stops, asks it whether a shot ran
 * into something on its way out, and is told when a bolt got through. It never
 * touches score, coins or the clock itself: those belong to the scene, so all
 * the balance stays in one place.
 */

const ARENA_MID = PLAY.top + (PLAY.bottom - PLAY.top) * 0.5;

export interface HazardHooks
{
    /** A bolt reached the gun. The scene decides what that costs. */
    onLanded: (penaltyMs: number) => void;
}

export class Hazards
{
    private scene: Scene;
    private spec: HazardSpec;
    private tier: Tier;
    private fx: Fx;
    private hooks: HazardHooks;

    private panes: Glass[] = [];
    private blocks: Concrete[] = [];
    private bolts: Flak[] = [];

    /** Countdown to the next pane going back up, one slot per dead pane. */
    private paneTimers: number[] = [];
    private flakTimer = 0;
    private armed = false;

    constructor (scene: Scene, spec: HazardSpec, tier: Tier, fx: Fx, hooks: HazardHooks)
    {
        this.scene = scene;
        this.spec = spec;
        this.tier = tier;
        this.fx = fx;
        this.hooks = hooks;
    }

    /** The clock has started: raise the glass, arm the core. */
    start (): void
    {
        this.armed = true;

        for (let i = 0; i < this.spec.panes; i++) this.raise(i, false);
        for (let i = 0; i < this.spec.blocks; i++) this.drop(i);

        //  The first salvo never arrives the instant the level does.
        this.flakTimer = this.spec.flakEvery > 0 ? this.spec.flakEvery * 0.8 : 0;
    }

    /**
     * A band of the arena, split between however many obstacles of one type
     * are up at once, with the bottom of the board left clear.
     *
     * The clear strip at the bottom is not politeness. It is where a falling
     * target dies and where the gun's own muzzle flash lives, and an obstacle
     * parked over it would take away the last chance at a drop rather than
     * making the board harder to read.
     */
    private band (slot: number, count: number, h: number): number
    {
        const top = PLAY.top + 46;
        const bottom = PLAY.bottom - 120;
        const lanes = Math.max(1, count);
        const lane = (bottom - top) / lanes;

        const y = top + lane * (slot + 0.5) + (Math.random() - 0.5) * Math.max(0, lane - h) * 0.5;

        return Math.max(top + h / 2, Math.min(bottom - h / 2, y));
    }

    private raise (slot: number, heard = true): void
    {
        //  Panes are spread down the arena rather than stacked, so there is
        //  always a lane of clear air somewhere on the board.
        const width = (PLAY.right - PLAY.left) * this.spec.paneSpan;
        const height = (PLAY.bottom - PLAY.top) * this.spec.paneRise;
        const y = this.band(slot, this.spec.panes, height);

        const pane = new Glass(this.scene, this.tier, y, width, height, this.spec.paneHp, this.spec.paneDrift);

        this.panes[slot] = pane;
        this.paneTimers[slot] = 0;

        //  The opening set slides in with the doors and says nothing; a pane
        //  going back up mid-level is news, and gets a sound.
        if (heard) Sfx.chip();
    }

    /**
     * A slab, lowered in for the level.
     *
     * Unlike glass it is placed once and never replaced, because it is never
     * destroyed -- a slab is part of the level's geometry, not a timer the
     * player is racing. The swinging ones are hung off centre so their arcs do
     * not all sweep the same column of the board.
     */
    private drop (slot: number): void
    {
        const count = Math.max(1, this.spec.blocks);
        const w = (PLAY.right - PLAY.left) * this.spec.blockSpan;
        const h = (PLAY.bottom - PLAY.top) * this.spec.blockRise;

        //  Spread across the width, one column each, and never dead centre --
        //  the middle of the board is where the player's eye already lives.
        const cols = (PLAY.right - PLAY.left) - w;
        const x = PLAY.left + w / 2 + cols * ((slot + 0.5) / count) +
            (Math.random() - 0.5) * (cols / count) * 0.5;

        const y = this.band(slot, count, h);
        const swing = this.spec.blockSwing;

        this.blocks.push(new Concrete(this.scene, this.tier,
            Math.max(PLAY.left + w / 2, Math.min(PLAY.right - w / 2, x)), y,
            w, h, swing > 0 ? 'swing' : 'static', swing, this.spec.blockPeriod));
    }

    update (dtMs: number, playing: boolean): void
    {
        for (const p of this.panes)
        {
            if (p && !p.dead) p.update(dtMs);
        }

        for (const b of this.blocks) b.update(dtMs);

        for (let i = this.bolts.length - 1; i >= 0; i--)
        {
            const b = this.bolts[i];
            const done = b.update(dtMs);

            if (!done) continue;

            //  A bolt that arrives while the level is already over -- during
            //  the revive offer, say -- fizzles. Nothing is charged for a
            //  clock that is not running.
            if (b.landed && playing) this.land(b);

            b.destroy();
            this.bolts.splice(i, 1);
        }

        if (!playing || !this.armed) return;

        //  Glass goes back up a beat after it comes down, so shattering a pane
        //  buys the player a window rather than solving the level.
        for (let i = 0; i < this.spec.panes; i++)
        {
            const p = this.panes[i];

            if (p && !p.dead) continue;

            this.paneTimers[i] -= dtMs;

            if (this.paneTimers[i] <= 0)
            {
                if (p) p.destroy();
                this.raise(i);
            }
        }

        if (this.spec.flakEvery <= 0) return;

        this.flakTimer -= dtMs;

        if (this.flakTimer > 0) return;

        this.flakTimer = this.spec.flakEvery;

        for (let i = 0; i < this.spec.flakSalvo; i++)
        {
            this.scene.time.delayedCall(i * 260, () =>
            {
                if (!this.armed) return;
                this.bolts.push(new Flak(this.scene, this.tier.accent, this.spec.flakSpeed));
            });
        }

        Sfx.launch();
    }

    //  ---------------------------------------------------------------- glass

    /** Where a shot out to (x2,y2) meets glass, if any pane is in its way. */
    paneOn (x1: number, y1: number, x2: number, y2: number): { pane: Glass; x: number; y: number } | null
    {
        let best: { pane: Glass; x: number; y: number } | null = null;
        let bestDist = Infinity;

        for (const p of this.panes)
        {
            if (!p || p.dead) continue;

            const at = p.crossing(x1, y1, x2, y2);

            if (!at) continue;

            const d = Math.hypot(at.x - x1, at.y - y1);

            if (d < bestDist) { bestDist = d; best = { pane: p, x: at.x, y: at.y }; }
        }

        return best;
    }

    /**
     * A shot into the glass. True when the pane came apart.
     *
     * `punch` is what the gun is worth in targets per shot; the glass takes it
     * in shots, so POWER buys its way through a window as well as through a
     * target.
     */
    hitPane (pane: Glass, x: number, y: number, punch = 1): boolean
    {
        const shattered = pane.damage(punch);
        const edge = mix(this.tier.accent2, 0xffffff, 0.5);

        if (!shattered)
        {
            this.fx.burst(x, y, edge, 9, 'hit');
            this.fx.ring(x, y, 44, edge, 3, 240);
            this.scene.cameras.main.shake(60, 0.003);
            Sfx.chip();

            return false;
        }

        //  Coming apart: shards along the whole length of the pane, not a
        //  single puff at the point of impact.
        const slot = this.panes.indexOf(pane);

        if (slot >= 0) this.paneTimers[slot] = this.spec.paneRespawn;

        for (let i = 0; i < 7; i++)
        {
            const sx = pane.x - pane.w / 2 + (pane.w * (i + 0.5)) / 7;

            this.scene.time.delayedCall(i * 22, () =>
            {
                this.fx.burst(sx, pane.y, edge, 10, 'big');
            });
        }

        this.fx.ring(pane.x, pane.y, pane.w * 0.8, edge, 6, 420);
        this.scene.cameras.main.shake(180, 0.008);
        Sfx.shatter();

        pane.destroy();

        return true;
    }

    //  ------------------------------------------------------------- concrete

    /** Where a shot out to (x2,y2) meets concrete, if a slab is in its way. */
    blockOn (x1: number, y1: number, x2: number, y2: number): { block: Concrete; x: number; y: number } | null
    {
        let best: { block: Concrete; x: number; y: number } | null = null;
        let bestDist = Infinity;

        for (const b of this.blocks)
        {
            const at = b.crossing(x1, y1, x2, y2);

            if (!at) continue;

            const d = Math.hypot(at.x - x1, at.y - y1);

            if (d < bestDist) { bestDist = d; best = { block: b, x: at.x, y: at.y }; }
        }

        return best;
    }

    /**
     * A shot into a slab. It stops there and that is the end of it.
     *
     * The feedback is deliberately unsatisfying -- grey sparks, a dull knock,
     * no crack, no progress bar, nothing that could be mistaken for a health
     * bar coming down. A player who thinks a slab might break with enough
     * shots will keep feeding it shots, and the answer they need is "go
     * around", delivered the very first time.
     */
    hitBlock (block: Concrete, x: number, y: number): void
    {
        block.struck();

        this.fx.burst(x, y, 0x9fa8bd, 7, 'hit');
        this.fx.ring(x, y, 30, 0x6d7590, 2, 180);
        this.scene.cameras.main.shake(70, 0.004);
        Sfx.clank();
    }

    //  ----------------------------------------------------------------- flak

    /** The bolt under a tap, if there is one. */
    flakAt (px: number, py: number, forgiveness: number): Flak | null
    {
        let best: Flak | null = null;
        let bestDist = Infinity;

        for (const b of this.bolts)
        {
            if (b.dead || !b.live) continue;
            if (!b.contains(px, py, forgiveness)) continue;

            const d = Math.hypot(px - b.x, py - b.y);

            if (d < bestDist) { bestDist = d; best = b; }
        }

        return best;
    }

    /** Shot down. The scene pays for it; this just makes it pop. */
    killFlak (b: Flak): void
    {
        const i = this.bolts.indexOf(b);

        if (i === -1) return;

        this.bolts.splice(i, 1);

        this.fx.burst(b.x, b.y, mix(this.tier.accent, 0xff3b45, 0.4), 20, 'big');
        this.fx.ring(b.x, b.y, 90, 0xffb020, 5, 340);
        this.scene.cameras.main.shake(90, 0.005);
        Sfx.crit();

        b.destroy();
    }

    /** A bolt got through. */
    private land (b: Flak): void
    {
        this.fx.burst(b.x, b.y, 0xff3b45, 26, 'big');
        this.fx.ring(MUZZLE.x, MUZZLE.y - 30, 260, 0xff3b45, 8, 460);

        this.scene.cameras.main.shake(300, 0.016);
        this.scene.cameras.main.flash(240, 150, 0, 24);
        Sfx.bomb();

        this.hooks.onLanded(this.spec.flakPenalty);
    }

    //  ----------------------------------------------------------------- flow

    /** The level is over: take everything down without charging for it. */
    clear (): void
    {
        this.armed = false;

        for (const p of this.panes)
        {
            if (!p || p.dead) continue;

            this.fx.burst(p.x, p.y, mix(this.tier.accent2, 0xffffff, 0.5), 12, 'hit');
            p.destroy();
        }

        this.panes = [];
        this.paneTimers = [];

        //  Concrete goes quietly. It never gave the player anything while it
        //  was up and it is not going to pay out on the way down either.
        for (const b of this.blocks) b.destroy();

        this.blocks = [];

        for (const b of this.bolts) b.destroy();

        this.bolts = [];
    }

    destroy (): void
    {
        for (const p of this.panes) if (p) p.destroy();
        for (const b of this.blocks) b.destroy();
        for (const b of this.bolts) b.destroy();

        this.panes = [];
        this.blocks = [];
        this.bolts = [];
    }
}

//  ------------------------------------------------------------------ intro

/**
 * The hazard performing itself once, on an empty field, before the clock
 * starts -- the same teaching budget the zone rules get, and for the same
 * reason. Returns how long the scene should wait.
 */
export function hazardIntro (scene: Scene, signature: Signature, tier: Tier, fx: Fx): number
{
    const gone: GameObjects.GameObject[] = [];
    const clear = (after: number) => scene.time.delayedCall(after, () => gone.forEach(o => o.destroy()));

    switch (signature)
    {
        case 'fall':
        {
            //  One target dropped down the screen and through the floor. The
            //  splash at the bottom is the point: that is what missing costs.
            const c = scene.add.circle(CX, PLAY.top + 40, 32, tier.accent, 1).setDepth(12);
            c.setStrokeStyle(3, 0xffffff, 0.7);
            gone.push(c);

            scene.tweens.add({
                targets: c,
                y: PLAY.bottom - 10,
                duration: 620,
                delay: 120,
                ease: 'Quad.in',
                onComplete: () =>
                {
                    c.setVisible(false);
                    fx.burst(c.x, PLAY.bottom, 0xff4d5e, 14, 'hit');
                    fx.ring(c.x, PLAY.bottom, 70, 0xff4d5e, 4, 300);
                    Sfx.expire();
                }
            });

            clear(1000);
            return 1000;
        }

        case 'chain':
        {
            //  Three links, numbered. A shot into the second is refused; a
            //  shot into the first takes it, and the second lights up. The
            //  whole rule, in the order it is going to be played.
            const steel = 0x8fa4c8;
            const r = 32;
            const gap = 108;
            const marks: GameObjects.Arc[] = [];
            const collars: GameObjects.Arc[] = [];
            const nums: GameObjects.Text[] = [];

            for (let i = 0; i < 3; i++)
            {
                const x = CX + (i - 1) * gap;
                const dot = scene.add.circle(x, ARENA_MID, r, tier.accent, i === 0 ? 1 : 0.4).setDepth(12);
                const collar = scene.add.circle(x, ARENA_MID, r + 11).setDepth(12);

                collar.setStrokeStyle(5, i === 0 ? tier.accent2 : steel, i === 0 ? 0.95 : 0.85);

                const num = scene.add.text(x, ARENA_MID - r - 16, String(i + 1), {
                    fontFamily: FONT, fontSize: 24, color: i === 0 ? '#ffffff' : '#9fb0d0'
                }).setOrigin(0.5).setDepth(14);

                marks.push(dot);
                collars.push(collar);
                nums.push(num);
                gone.push(dot, collar, num);
            }

            const rope = scene.add.graphics().setDepth(11);
            rope.lineStyle(3, steel, 0.7);
            rope.lineBetween(CX - gap, ARENA_MID, CX + gap, ARENA_MID);
            gone.push(rope);

            //  Shot one: into link two, which is bolted shut.
            scene.time.delayedCall(320, () =>
            {
                fx.tracer(MUZZLE.x, MUZZLE.y - 30, CX, ARENA_MID + r, tier.accent, 7, 160);
                fx.burst(CX, ARENA_MID + r, steel, 9, 'hit');
                fx.ring(CX, ARENA_MID, r * 2.1, steel, 4, 280);
                scene.tweens.add({ targets: collars[1], scale: 1.18, duration: 90, yoyo: true });
                Sfx.locked();
            });

            //  Shot two: into link one, which was next all along.
            scene.time.delayedCall(880, () =>
            {
                const x = CX - gap;

                fx.tracer(MUZZLE.x, MUZZLE.y - 30, x, ARENA_MID, tier.accent, 7, 160);
                fx.burst(x, ARENA_MID, tier.accent, 22, 'big');
                fx.ring(x, ARENA_MID, 130, tier.accent, 6, 400);

                marks[0].setVisible(false);
                collars[0].setVisible(false);
                nums[0].setVisible(false);
                Sfx.crit();
            });

            //  And the second one opens.
            scene.time.delayedCall(1080, () =>
            {
                marks[1].setAlpha(1);
                collars[1].setStrokeStyle(5, tier.accent2, 0.95);
                nums[1].setColor('#ffffff');

                fx.ring(CX, ARENA_MID, r * 2.6, tier.accent2, 5, 360);
                scene.tweens.add({ targets: [ marks[1], collars[1] ], scale: 1.24, duration: 130, yoyo: true, ease: 'Quad.out' });
                Sfx.unlock();
            });

            clear(1600);
            return 1600;
        }

        case 'glass':
        {
            //  A window drops over the board with a target still moving under
            //  it. A shot goes into the glass instead of the target -- twice --
            //  and only when the pane is gone does the target die.
            const edge = mix(tier.accent, 0xffffff, 0.55);
            const w = (PLAY.right - PLAY.left) * 0.56;
            const h = (PLAY.bottom - PLAY.top) * 0.28;

            const mark = scene.add.circle(CX - 70, ARENA_MID + 10, 30, tier.accent, 1).setDepth(10);
            mark.setStrokeStyle(3, 0xffffff, 0.7);
            gone.push(mark);

            //  It keeps moving the whole time. Watching the shot you wanted go
            //  past while you break a window is the entire cost of glass.
            scene.tweens.add({
                targets: mark, x: CX + 70, duration: 900, yoyo: true, repeat: 1, ease: 'Sine.inOut'
            });

            const slab = scene.add.rectangle(CX, ARENA_MID, w, h, mix(tier.accent2, 0xffffff, 0.35), 0.12).setDepth(12);
            slab.setStrokeStyle(4, edge, 0.85);
            slab.setScale(1, 0);
            gone.push(slab);

            scene.tweens.add({ targets: slab, scaleY: 1, duration: 340, ease: 'Quad.out' });

            for (const at of [ 620, 1000 ])
            {
                scene.time.delayedCall(at, () =>
                {
                    //  Aimed at the target, stopped by the window in front of it.
                    fx.tracer(MUZZLE.x, MUZZLE.y - 30, mark.x, ARENA_MID + h / 2, tier.accent, 7, 160);
                    fx.burst(mark.x, ARENA_MID + h / 2, edge, 10, 'hit');
                    scene.cameras.main.shake(60, 0.003);
                    Sfx.chip();
                });
            }

            scene.time.delayedCall(1400, () =>
            {
                slab.setVisible(false);

                for (let i = 0; i < 7; i++)
                {
                    const sx = CX - w / 2 + (w * (i + 0.5)) / 7;
                    scene.time.delayedCall(i * 22, () => fx.burst(sx, ARENA_MID, edge, 10, 'big'));
                }

                fx.ring(CX, ARENA_MID, w * 0.7, edge, 6, 420);
                scene.cameras.main.shake(180, 0.008);
                Sfx.shatter();
            });

            //  Now, and only now, the shot lands.
            scene.time.delayedCall(1720, () =>
            {
                fx.tracer(MUZZLE.x, MUZZLE.y - 30, mark.x, mark.y, tier.accent, 7, 160);
                mark.setVisible(false);
                fx.burst(mark.x, mark.y, tier.accent, 22, 'big');
                fx.ring(mark.x, mark.y, 130, tier.accent, 6, 400);
                Sfx.crit();
            });

            clear(2000);
            return 2000;
        }

        case 'concrete':
        {
            //  A slab comes down on a rope and a target walks in behind it.
            //  Two shots go into the concrete and nothing at all happens --
            //  no crack, no pips, no progress. The third goes round the side.
            const w = (PLAY.right - PLAY.left) * 0.26;
            const h = (PLAY.bottom - PLAY.top) * 0.22;
            const body = mix(0x161b2b, tier.grid, 0.32);

            const mark = scene.add.circle(CX, ARENA_MID + 6, 30, tier.accent, 1).setDepth(10);
            mark.setStrokeStyle(3, 0xffffff, 0.7);
            gone.push(mark);

            const rope = scene.add.graphics().setDepth(13);
            const slab = scene.add.rectangle(CX, ARENA_MID, w, h, body, 1).setDepth(13);
            slab.setStrokeStyle(3, mix(body, 0x000000, 0.45), 1);
            slab.setScale(1, 0);
            gone.push(slab, rope);

            const drawRope = () =>
            {
                rope.clear();
                rope.lineStyle(4, mix(body, 0xffffff, 0.35), 0.55);
                rope.lineBetween(CX, PLAY.top + 6, slab.x, slab.y - (h * slab.scaleY) / 2);
            };

            drawRope();
            scene.tweens.add({ targets: slab, scaleY: 1, duration: 340, ease: 'Back.out', onUpdate: drawRope });

            //  Two shots, straight into it, and it does not care.
            for (const at of [ 600, 900 ])
            {
                scene.time.delayedCall(at, () =>
                {
                    fx.tracer(MUZZLE.x, MUZZLE.y - 30, CX, ARENA_MID + h / 2, tier.accent, 7, 160);
                    fx.burst(CX, ARENA_MID + h / 2, 0x9fa8bd, 7, 'hit');
                    scene.cameras.main.shake(70, 0.004);
                    Sfx.clank();
                });
            }

            //  So the target steps out from behind it instead.
            scene.time.delayedCall(1200, () =>
            {
                scene.tweens.add({
                    targets: mark, x: CX + w * 0.85, duration: 420, ease: 'Sine.inOut', onUpdate: drawRope
                });
            });

            scene.time.delayedCall(1740, () =>
            {
                fx.tracer(MUZZLE.x, MUZZLE.y - 30, mark.x, mark.y, tier.accent, 7, 160);
                mark.setVisible(false);
                fx.burst(mark.x, mark.y, tier.accent, 22, 'big');
                fx.ring(mark.x, mark.y, 130, tier.accent, 6, 400);
                Sfx.crit();
            });

            clear(2050);
            return 2050;
        }

        case 'flak':
        {
            //  One bolt, launched slowly, shot out of the air halfway down.
            const hot = mix(tier.accent, 0xff3b45, 0.55);
            const from = { x: CX + 150, y: PLAY.top + 40 };
            const mid = { x: (from.x + MUZZLE.x) / 2, y: (from.y + MUZZLE.y - 60) / 2 };

            const bolt = scene.add.circle(from.x, from.y, 15, hot, 1).setDepth(13);
            const halo = scene.add.circle(from.x, from.y, 30, hot, 0.25).setDepth(13);
            gone.push(bolt, halo);

            //  Warning first, exactly as it works in play.
            scene.tweens.add({ targets: halo, scale: 0.45, duration: 420, ease: 'Quad.in' });

            scene.tweens.add({
                targets: [ bolt, halo ],
                x: mid.x,
                y: mid.y,
                duration: 520,
                delay: 440,
                ease: 'Quad.in',
                onComplete: () =>
                {
                    fx.tracer(MUZZLE.x, MUZZLE.y - 30, mid.x, mid.y, tier.accent, 7, 160);
                    bolt.setVisible(false);
                    halo.setVisible(false);
                    fx.burst(mid.x, mid.y, hot, 22, 'big');
                    fx.ring(mid.x, mid.y, 110, 0xffb020, 5, 380);
                    Sfx.crit();
                }
            });

            clear(1250);
            return 1250;
        }

        default:
            return 0;
    }
}
