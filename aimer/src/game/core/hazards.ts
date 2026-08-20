import { GameObjects, Scene } from 'phaser';
import { Glass } from '../objects/Glass';
import { Flak } from '../objects/Flak';
import { Fx } from './fx';
import { Sfx } from './audio';
import type { HazardSpec, Signature } from '../data/hazards';
import { CX, MUZZLE, PLAY, Tier, mix } from './theme';

/**
 * The obstacle layer: everything in the arena that is not a target.
 *
 * It owns two things -- panes of armoured glass that stand between the gun and
 * the board, and bolts fired back at the gun -- and it owns them completely.
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

        //  The first salvo never arrives the instant the level does.
        this.flakTimer = this.spec.flakEvery > 0 ? this.spec.flakEvery * 0.8 : 0;
    }

    private raise (slot: number, heard = true): void
    {
        //  Panes are spread down the arena rather than stacked, so there is
        //  always a lane of clear air somewhere on the board.
        const bands = Math.max(1, this.spec.panes);
        const band = (slot + 0.5) / bands;
        const top = PLAY.top + 70;
        const bottom = PLAY.bottom - 90;
        const y = top + (bottom - top) * band + (Math.random() - 0.5) * 40;

        const width = (PLAY.right - PLAY.left) * this.spec.paneSpan;

        const pane = new Glass(this.scene, this.tier, y, width, this.spec.paneHp, this.spec.paneDrift);

        this.panes[slot] = pane;
        this.paneTimers[slot] = 0;

        //  The opening set slides in with the doors and says nothing; a pane
        //  going back up mid-level is news, and gets a sound.
        if (heard) Sfx.chip();
    }

    update (dtMs: number, playing: boolean): void
    {
        for (const p of this.panes)
        {
            if (p && !p.dead) p.update(dtMs);
        }

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

    /** A shot into the glass. True when the pane came apart. */
    hitPane (pane: Glass, x: number, y: number): boolean
    {
        const shattered = pane.damage();
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

        for (const b of this.bolts) b.destroy();

        this.bolts = [];
    }

    destroy (): void
    {
        for (const p of this.panes) if (p) p.destroy();
        for (const b of this.bolts) b.destroy();

        this.panes = [];
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

        case 'glass':
        {
            //  A pane slides in, eats a shot, and shatters on the second.
            const edge = mix(tier.accent, 0xffffff, 0.55);
            const w = (PLAY.right - PLAY.left) * 0.46;
            const slab = scene.add.rectangle(CX, ARENA_MID, w, 26, mix(tier.accent2, 0xffffff, 0.35), 0.18).setDepth(12);
            slab.setStrokeStyle(3, edge, 0.8);
            slab.setScale(0, 1);
            gone.push(slab);

            scene.tweens.add({ targets: slab, scaleX: 1, duration: 320, ease: 'Quad.out' });

            scene.time.delayedCall(480, () =>
            {
                fx.tracer(MUZZLE.x, MUZZLE.y - 30, CX, ARENA_MID + 13, tier.accent, 7, 160);
                fx.burst(CX, ARENA_MID + 13, edge, 10, 'hit');
                Sfx.chip();
            });

            scene.time.delayedCall(820, () =>
            {
                fx.tracer(MUZZLE.x, MUZZLE.y - 30, CX, ARENA_MID + 13, tier.accent, 7, 160);
                slab.setVisible(false);

                for (let i = 0; i < 6; i++)
                {
                    const sx = CX - w / 2 + (w * (i + 0.5)) / 6;
                    scene.time.delayedCall(i * 22, () => fx.burst(sx, ARENA_MID, edge, 10, 'big'));
                }

                fx.ring(CX, ARENA_MID, w * 0.8, edge, 6, 420);
                Sfx.shatter();
            });

            clear(1350);
            return 1350;
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
