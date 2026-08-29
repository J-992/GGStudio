import { GameObjects, Scene } from 'phaser';
import { Target, Skin, TargetStyle } from '../objects/Target';
import { Chain } from './chain';
import { Fx } from './fx';
import { Sfx } from './audio';
import { PLAY, Tier, mix } from './theme';
import { unitHp } from '../data/levels';
import type { BossSpec, RingSpec } from '../data/bosses';

const TAU = Math.PI * 2;

/**
 * The exponent that makes a shrinking body half its size at half its health.
 *
 * Solved rather than dialled in: with a floor of 0.3, `0.3 + 0.7 * 0.5^k = 0.5`
 * gives k = 1.8. Move the floor and this wants re-solving with it.
 */
const SHRINK_CURVE = 1.8;

/**
 * A boss fight, and the only place any of them is written down.
 *
 * The scene keeps doing what it already does -- it owns the target list, it
 * fires the gun, it scores the kills, it runs the clock. This owns the one
 * thing that makes a boss a boss rather than a very large target: the *rule*
 * standing between the gun and the body. It answers three questions for the
 * scene and nothing else asks it anything.
 *
 *   guard()  a shot has arrived at one of ours from this angle -- does it land?
 *   took()   the scene killed one of ours; is the fight over?
 *   tick()   move, turn, open, shut, blink.
 *
 * Every mechanic in `data/bosses` is expressed through those three, which is
 * why there is no per-boss scene code anywhere: adding an eighth world means
 * adding a row to the table and a case here, and touching nothing else.
 *
 * Three of the seven are the same object with different numbers. A turning
 * ring of arcs around a body covers the bunker (gaps you wait for, glass you
 * can buy your way through), the core (no gaps at all until it has fired) and
 * the aegis (two rings turning opposite ways, so the gap is never twice in the
 * same place). Writing those as three separate mechanics would have been three
 * chances to get the same angle arithmetic wrong.
 */

/** What a blocked shot ran into, so the scene can say the right thing about it. */
export type GuardHit = { x: number; y: number; kind: 'steel' | 'glass' | 'ghost' };

export interface BossHooks
{
    /** Puts a target on the scene's board. */
    add: (t: Target) => void;
    /** The paint and silhouette an ordinary target wears on this level. */
    dress: () => { skin?: Skin; style?: TargetStyle };
    /** Hands the scene a welded run to draw and to pay out. */
    weld: (c: Chain) => void;
    /** Somewhere on the board with room for a body of this radius. */
    freeSpot: (radius: number) => { x: number; y: number };
    /** The core, shooting back. */
    salvo: (bolts: number) => void;
}

/** One arc of a turning ring. */
interface Arc
{
    /** Centre of the arc on the ring, before the ring's own rotation. */
    at: number;
    /** Half the arc's angular width. */
    half: number;
    hp: number;
    maxHp: number;
    /** Milliseconds until a shattered arc comes back. Zero means it is up. */
    down: number;
}

interface Ring
{
    arcs: Arc[];
    spec: RingSpec;
    phase: number;
    reach: number;
}

export class BossFight
{
    readonly spec: BossSpec;

    /** Every body this fight still owns. Emptied as they die. */
    private bodies: Target[] = [];
    private scene: Scene;
    private tier: Tier;
    private fx: Fx;
    private hooks: BossHooks;
    private level: number;
    /** The level's normal target radius -- every size here is a multiple of it. */
    private unit: number;

    private gfx: GameObjects.Graphics;
    private rings: Ring[] = [];

    /** Total health the fight started with, so the bar can mean something. */
    private startHp = 1;

    //  --- brute ---
    /** Health at the last frame, so a hit can be noticed without a hook. */
    private lastHp = -1;
    private running = false;

    //  --- serpent ---
    private heading = 0;
    private wander = 0;
    /** Where the head is currently crawling towards. */
    private mark = { x: 0, y: 0 };
    /** Seconds until the head abandons its current leg and picks a new one. */
    private jink = 0;

    //  --- phantom ---
    private ghost = 0;
    private nextBand = 0;

    //  --- core ---
    private shut = true;
    private phase = 0;

    //  --- hydra ---
    private generation = new Map<Target, number>();

    constructor (scene: Scene, spec: BossSpec, tier: Tier, level: number, unitSize: number, fx: Fx, hooks: BossHooks)
    {
        this.scene = scene;
        this.spec = spec;
        this.tier = tier;
        this.level = level;
        this.unit = unitSize;
        this.fx = fx;
        this.hooks = hooks;

        //  Over the bodies, under the HUD. The ring has to read as being in
        //  front of the thing it is protecting or it is not protecting it.
        this.gfx = scene.add.graphics().setDepth(11);

        this.build();

        this.startHp = Math.max(1, this.pool());
    }

    /**
     * Every point of health this fight will *ever* have, counted before a shot
     * is fired -- which for six of the seven is simply what is on the board.
     *
     * The hydra is the exception and the reason this is a method: breaking a
     * head puts two more on the board, so its health goes *up* in the middle
     * of the fight. Measuring the bar against what is currently standing would
     * have run it backwards every time the player did the right thing, which
     * is the worst possible moment for a progress bar to lie.
     */
    private pool (): number
    {
        if (this.spec.mech !== 'hydra') return this.hp;

        const per = unitHp(this.level);
        const heads = Math.max(2, this.spec.heads || 2);

        let units = this.spec.units;
        let wave = 1;

        for (let gen = 1; gen <= (this.spec.generations || 0); gen++)
        {
            wave *= heads;
            units += wave * Math.max(4, Math.round(this.spec.units * Math.pow(0.62, gen)));
        }

        return units * per;
    }

    //  ------------------------------------------------------------- building

    /**
     * A body, sized off the level's own targets.
     *
     * Target works out its radius from the kind's `sizeMult`, and the boss
     * kind's is 2.6 -- so a spec that wants to be 2.2 normal targets across
     * asks for a base size that lands there rather than carrying its own
     * private idea of how big a pixel is.
     */
    private body (x: number, y: number, units: number, size: number): Target
    {
        const worn = this.spec.skinned ? this.hooks.dress() : {};

        const t = new Target(this.scene, x, y, 'boss', (this.unit * size) / 2.6, this.level, 0, false,
            worn.skin, worn.style);

        t.setUnits(units, this.level);
        t.setLifetime(999999);
        t.setDepth(9);
        t.warded = true;

        this.bodies.push(t);
        this.hooks.add(t);

        return t;
    }

    private build (): void
    {
        const s = this.spec;

        if (s.mech === 'serpent')
        {
            this.buildSerpent();
            return;
        }

        const spot = { x: (PLAY.left + PLAY.right) / 2, y: PLAY.top + (PLAY.bottom - PLAY.top) * 0.34 };
        const t = this.body(spot.x, spot.y, s.units, s.size);

        if (s.mech === 'hydra') this.generation.set(t, 0);

        if (s.mech === 'phantom')
        {
            const bands = Math.max(1, s.bands || 1);
            this.nextBand = t.maxHp * (1 - 1 / bands);
        }

        if (s.ring) this.rings = this.ringsFrom(s.ring, t.radius);

        //  The core starts shut, and starts its first salvo immediately: the
        //  fight has to open on the thing the player must learn to wait for.
        if (s.mech === 'core') this.phase = 0;
    }

    /**
     * The snake: one welded run, laid out along its own body so it is already
     * curved when the doors open. It is the skyline's chains -- the same lock,
     * the same order, the same rope -- at four times the length and swimming.
     */
    private buildSerpent (): void
    {
        const len = Math.max(3, this.spec.links || 7);
        const cx = (PLAY.left + PLAY.right) / 2;
        const cy = PLAY.top + (PLAY.bottom - PLAY.top) * 0.4;

        const members: Target[] = [];

        //  Fanned out, not coiled: the body opens on a wide arc across the
        //  board so every link is visible and readable from the first frame,
        //  with the head at one end and the tail at the other. Links alternate
        //  big and small, so the spine reads as beads rather than a rope.
        const width = (PLAY.right - PLAY.left) * 0.8;
        const sweep = Math.PI * 0.9;
        const arcR = width / (2 * Math.sin(sweep / 2));
        const a0 = -Math.PI / 2 - sweep / 2;

        for (let i = 0; i < len; i++)
        {
            const a = a0 + sweep * (i / (len - 1));
            const x = cx + Math.cos(a) * arcR;
            const y = cy + arcR * 0.6 + Math.sin(a) * arcR * 0.6;
            const size = this.unit * this.linkScale(i);

            const t = new Target(this.scene, clamp(x, PLAY.left + size, PLAY.right - size),
                clamp(y, PLAY.top + size, PLAY.bottom - size), 'tough', size, this.level, 0, false);

            t.setLifetime(999999);
            t.setDepth(9);
            t.warded = true;

            this.bodies.push(t);
            this.hooks.add(t);
            members.push(t);
        }

        //  Point the head along the arc it was laid on, so the first motion
        //  unrolls the fan instead of dragging the tail through the body.
        const head = members[0];
        const next = members[1];

        this.heading = Math.atan2(head.y - next.y, head.x - next.x);
        this.mark = this.nextMark(head);
        this.jink = 0.6 + Math.random() * 0.8;

        this.hooks.weld(new Chain(this.scene, this.tier, members));
    }

    /** Big, small, big, small -- the head is always one of the big ones. */
    private linkScale (i: number): number
    {
        return i % 2 === 0 ? 1.25 : 0.7;
    }

    private ringsFrom (spec: RingSpec, radius: number): Ring[]
    {
        const out: Ring[] = [ this.oneRing(spec, radius) ];

        if (spec.counter) out.push(this.oneRing(spec.counter, radius));

        return out;
    }

    private oneRing (spec: RingSpec, radius: number): Ring
    {
        const arcs: Arc[] = [];
        const slice = TAU / Math.max(1, spec.count);

        //  Glass arcs are spread around the ring rather than bunched, so the
        //  breakable one is never all on one side -- a player who happens to
        //  be under the steel half would otherwise have no second answer at
        //  all, which is exactly the answer the glass exists to give them.
        const stride = spec.glass > 0 ? Math.max(1, Math.floor(spec.count / spec.glass)) : 0;
        let glazed = 0;

        for (let i = 0; i < spec.count; i++)
        {
            const glass = stride > 0 && i % stride === 0 && glazed < spec.glass;

            if (glass) glazed += 1;

            arcs.push({
                at: slice * i,
                //  `cover` is a share of the slice, so an arc can never be
                //  wider than the space it was given and a ring can never
                //  accidentally overlap itself into a solid wall -- except on
                //  purpose, which is what a cover above 1 is for.
                half: (slice * Math.min(1.05, spec.cover)) / 2,
                hp: glass ? spec.hp : 0,
                maxHp: glass ? spec.hp : 0,
                down: 0
            });
        }

        return { arcs, spec, phase: Math.random() * TAU, reach: radius * spec.reach };
    }

    //  ------------------------------------------------------------- the fight

    /** Every body still standing. */
    get members (): Target[]
    {
        return this.bodies;
    }

    get done (): boolean
    {
        return this.bodies.length === 0;
    }

    owns (t: Target): boolean
    {
        return this.bodies.indexOf(t) !== -1;
    }

    /** Health left across the whole fight, 0..1. */
    get frac (): number
    {
        return Math.max(0, Math.min(1, this.hp / this.startHp));
    }

    private get hp (): number
    {
        let n = 0;
        for (const t of this.bodies) n += Math.max(0, t.hp);
        return n;
    }

    /** Where the fight is, for a popup or a camera. */
    get focus (): { x: number; y: number }
    {
        const t = this.bodies[0];
        return t ? { x: t.x, y: t.y } : { x: (PLAY.left + PLAY.right) / 2, y: (PLAY.top + PLAY.bottom) / 2 };
    }

    /**
     * A shot has arrived at one of ours from `from` (world radians, measured
     * from the body towards the gun that fired). Null lets it through.
     *
     * This is the entire difference between the seven fights, and it is
     * deliberately the *only* thing standing between the player and an
     * ordinary kill: everything past this point -- damage, crit, bullseye,
     * score, the pop -- is the same code that runs for a plain target, so a
     * boss can never quietly pay differently from what the board says it does.
     */
    guard (t: Target, from: number): GuardHit | null
    {
        if (this.ghost > 0)
        {
            return { x: t.x, y: t.y, kind: 'ghost' };
        }

        if (this.spec.mech === 'core' && !this.shut)
        {
            //  Open. The shutters are pulled back into the body and there is
            //  nothing in the way at all.
            return null;
        }

        for (const ring of this.rings)
        {
            const arc = this.arcAt(ring, from);

            if (!arc) continue;

            const x = t.x + Math.cos(from) * ring.reach;
            const y = t.y + Math.sin(from) * ring.reach;

            if (arc.maxHp <= 0) return { x, y, kind: 'steel' };

            arc.hp -= 1;

            if (arc.hp > 0) return { x, y, kind: 'glass' };

            //  Bought a gap. It is a window and not a solution: the ring keeps
            //  turning, and this arc comes back.
            arc.down = ring.spec.respawn;

            this.fx.burst(x, y, 0xd8e4ff, 20, 'big');
            this.fx.ring(x, y, ring.reach * 0.7, 0xd8e4ff, 5, 340);
            Sfx.shatter();

            return { x, y, kind: 'glass' };
        }

        return null;
    }

    /** The live arc covering `angle` on this ring, if any. */
    private arcAt (ring: Ring, angle: number): Arc | null
    {
        for (const arc of ring.arcs)
        {
            if (arc.down > 0) continue;

            let d = angle - (arc.at + ring.phase);

            while (d > Math.PI) d -= TAU;
            while (d < -Math.PI) d += TAU;

            if (Math.abs(d) <= arc.half) return arc;
        }

        return null;
    }

    /**
     * The scene has killed one of ours. True when that was the last of it.
     *
     * The hydra is the only one that answers "no" to a body dying without
     * another body already being on the board, and it answers it by putting
     * two there.
     */
    took (t: Target): boolean
    {
        const i = this.bodies.indexOf(t);

        if (i === -1) return false;

        this.bodies.splice(i, 1);

        if (this.spec.mech === 'hydra') this.splitHead(t);

        //  The ring belonged to the body it was turning around.
        if (this.bodies.length === 0)
        {
            this.rings = [];
            this.gfx.clear();
        }

        return this.bodies.length === 0;
    }

    private splitHead (t: Target): void
    {
        const gen = (this.generation.get(t) || 0) + 1;
        const max = this.spec.generations || 1;

        this.generation.delete(t);

        if (gen > max) return;

        const heads = Math.max(2, this.spec.heads || 2);
        //  Each generation is smaller, thinner and faster than the one it came
        //  out of, so four of them at once is a busier board rather than four
        //  times the fight.
        const shrink = Math.pow(0.62, gen);
        const units = Math.max(4, Math.round(this.spec.units * shrink));
        const size = this.spec.size * Math.pow(0.72, gen);

        for (let i = 0; i < heads; i++)
        {
            const a = TAU * (i / heads) + Math.random();
            const r = t.radius * 0.9;
            const x = clamp(t.x + Math.cos(a) * r, PLAY.left + 40, PLAY.right - 40);
            const y = clamp(t.y + Math.sin(a) * r, PLAY.top + 40, PLAY.bottom - 40);

            const head = this.body(x, y, units, size);

            this.generation.set(head, gen);

            head.vx = Math.cos(a) * this.spec.speed;
            head.vy = Math.sin(a) * this.spec.speed;
        }

        this.fx.popup(t.x, t.y - t.radius - 20, 'IT SPLITS', 0xff2d55, 26, 54, 700);
        this.fx.ring(t.x, t.y, t.radius * 3, 0xff2d55, 6, 420);
        Sfx.bomb();
    }

    //  -------------------------------------------------------------- per frame

    tick (dtMs: number): void
    {
        const dt = dtMs / 1000;

        if (this.ghost > 0) this.ghost = Math.max(0, this.ghost - dtMs);

        for (const ring of this.rings)
        {
            ring.phase += ring.spec.spin * dt;

            for (const arc of ring.arcs)
            {
                if (arc.down <= 0) continue;

                arc.down -= dtMs;

                if (arc.down <= 0) arc.hp = arc.maxHp;
            }
        }

        switch (this.spec.mech)
        {
            case 'brute': this.grind(dt); break;
            case 'serpent': this.swim(dt); break;
            case 'phantom': this.haunt(dt); break;
            case 'core': this.pulse(dtMs); break;
            case 'bunker': this.drift(dt); break;
            case 'aegis': this.drift(dt); break;
            case 'hydra': this.drift(dt); break;
            default: break;
        }

        this.draw();
    }

    /**
     * The brute. It loses a piece of itself on every hit, and once it is half
     * gone it stops absorbing the fight and starts running from it.
     *
     * The size is read off the health rather than counted per hit, so it is
     * right no matter what took the health off -- a bullseye worth two, a crit,
     * a lance passing through. `lastHp` is only there to notice that *something*
     * happened, because nothing tells this class when a shot lands.
     */
    private grind (dt: number): void
    {
        const t = this.bodies[0];

        if (!t) return;

        const left = t.maxHp > 0 ? Math.max(0, t.hp / t.maxHp) : 1;

        if (t.hp !== this.lastHp)
        {
            this.lastHp = t.hp;

            const floor = this.spec.shrinkTo ?? 0.5;

            //  Bent so that half health is half the body, exactly. Straight
            //  interpolation between the floor and full size would have left
            //  it at seven tenths at the halfway mark, which is the moment it
            //  turns and starts running -- and "it got small and quick" has to
            //  be one read, not a size the player has to be told about.
            t.setBulk(floor + (1 - floor) * Math.pow(left, SHRINK_CURVE));
        }

        if (!this.running && left <= (this.spec.runsAt ?? 0.5))
        {
            //  The turn. A wall the player has been standing still and hitting
            //  for fifteen seconds becomes something that has to be chased,
            //  and it says so with the whole screen.
            this.running = true;

            const a = Math.random() * TAU;

            t.vx = Math.cos(a) * this.spec.speed;
            t.vy = Math.sin(a) * this.spec.speed;

            this.fx.burst(t.x, t.y, t.color, 26, 'big');
            this.fx.ring(t.x, t.y, t.radius * 3.4, t.color, 6, 460);
            this.fx.popup(t.x, t.y - t.radius - 24, 'IT RUNS', 0xffb020, 30, 58, 720);
            this.scene.cameras.main.shake(260, 0.011);
            Sfx.crit();
        }

        if (this.running) this.drift(dt);
    }

    /**
     * The snake. The head picks a heading and wanders it; every link behind it
     * is pulled towards the one in front and never closer than one body width,
     * which is the whole of "it moves like an animal" in six lines.
     *
     * It steers away from the walls rather than bouncing off them, because a
     * nine-link body that bounced would fold itself in half in a corner and
     * the player would lose the order they are being asked to read.
     */
    private swim (dt: number): void
    {
        const head = this.bodies[0];

        if (!head) return;

        //  It crawls to somewhere, and when it gets there it picks somewhere
        //  else. That is the whole steering, and it replaces a free-running
        //  heading that was nudged away from the walls when it got too close:
        //  a wandering heading averages to a straight line, and a straight
        //  line in a box ends in a corner, where the nudge and the wander
        //  cancelled each other out and the snake sat still. A destination it
        //  has to actually arrive at cannot be satisfied by a corner.
        //
        //  It also changes its mind. Every leg has a fuse, and when it burns
        //  out the head picks a new destination whether or not it got there,
        //  so a player who has read where it is going cannot bank on it.
        this.jink -= dt;

        if (this.jink <= 0 || Math.hypot(this.mark.x - head.x, this.mark.y - head.y) < this.unit * 1.8)
        {
            this.mark = this.nextMark(head);
            this.jink = 0.5 + Math.random() * 1.1;
        }

        //  A weave laid over the bearing, so even a straight leg is never a
        //  straight line.
        this.wander += dt * 5;

        const want = Math.atan2(this.mark.y - head.y, this.mark.x - head.x) + Math.sin(this.wander) * 0.5;

        let d = want - this.heading;

        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;

        //  A capped turn rate is what keeps it an animal. Snapping straight on
        //  to the bearing would make it a cursor that happens to have nine
        //  circles behind it.
        const turn = 4.2 * dt;

        this.heading += Math.max(-turn, Math.min(turn, d));

        const step = this.spec.speed * dt;

        head.x = clamp(head.x + Math.cos(this.heading) * step, PLAY.left + head.radius, PLAY.right - head.radius);
        head.y = clamp(head.y + Math.sin(this.heading) * step, PLAY.top + head.radius, PLAY.bottom - head.radius);

        for (let i = 1; i < this.bodies.length; i++)
        {
            const a = this.bodies[i - 1];
            const b = this.bodies[i];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;

            //  Links sit rim to rim, so the gap follows the two radii either
            //  side of it rather than one fixed body width.
            const gap = (a.radius + b.radius) * 1.05;

            if (len <= gap) continue;

            const pull = (len - gap) / len;

            //  Followed *and* fenced. Only the head used to be held inside the
            //  arena, so a tight turn could throw the tail through a wall and
            //  leave the last links floating outside the board, unshootable.
            b.x = clamp(b.x - dx * pull, PLAY.left + b.radius, PLAY.right - b.radius);
            b.y = clamp(b.y - dy * pull, PLAY.top + b.radius, PLAY.bottom - b.radius);
        }
    }

    /**
     * Somewhere else to be -- and deliberately somewhere *far*.
     *
     * Half the arena's diagonal is the shortest hop it will take, so every leg
     * is a crossing rather than a shuffle, and the head is guaranteed to visit
     * both ends of the board rather than circling one of them. The inset keeps
     * the destination off the walls, so the body arrives with room to turn
     * instead of arriving folded against the edge.
     */
    private nextMark (head: Target): { x: number; y: number }
    {
        const pad = this.unit * 2.4;
        const left = PLAY.left + pad;
        const right = PLAY.right - pad;
        const top = PLAY.top + pad;
        const bottom = PLAY.bottom - pad;
        const span = Math.hypot(right - left, bottom - top) * 0.5;

        let best = { x: (left + right) / 2, y: (top + bottom) / 2 };
        let bestGap = -1;

        for (let i = 0; i < 12; i++)
        {
            const spot = {
                x: left + Math.random() * Math.max(1, right - left),
                y: top + Math.random() * Math.max(1, bottom - top)
            };
            const gap = Math.hypot(spot.x - head.x, spot.y - head.y);

            if (gap > bestGap) { bestGap = gap; best = spot; }
            if (gap >= span) break;
        }

        return best;
    }

    /**
     * The phantom. It drifts, and every time it loses a band of health it is
     * gone before the next shot lands -- untouchable in the air, and somewhere
     * else when it comes down.
     */
    private haunt (dt: number): void
    {
        const t = this.bodies[0];

        if (!t) return;

        if (this.ghost <= 0)
        {
            this.wander += dt * 1.1;

            const step = this.spec.speed * dt;

            t.x = clamp(t.x + Math.cos(this.wander) * step, PLAY.left + t.radius, PLAY.right - t.radius);
            t.y = clamp(t.y + Math.sin(this.wander * 1.4) * step, PLAY.top + t.radius, PLAY.bottom - t.radius);
        }

        if (t.hp > this.nextBand || this.ghost > 0) return;

        const bands = Math.max(1, this.spec.bands || 1);

        this.nextBand -= t.maxHp / bands;
        this.ghost = this.spec.blinkMs || 500;

        const spot = this.hooks.freeSpot(t.radius);

        this.fx.burst(t.x, t.y, t.color, 22, 'big');
        this.fx.ring(t.x, t.y, t.radius * 2.6, t.color, 5, 360);
        this.fx.popup(t.x, t.y - t.radius - 18, 'GONE', 0xd08cff, 26, 52, 620);

        t.warp(spot.x, spot.y);
        Sfx.crit();
    }

    /**
     * The core. Shut, it fires and cannot be touched; open, it is a target and
     * nothing else. The player does not choose when to shoot it, which is the
     * one thing no other fight in the run does to them.
     */
    private pulse (dtMs: number): void
    {
        this.phase -= dtMs;

        if (this.phase > 0) return;

        this.shut = !this.shut;
        this.phase = this.shut ? (this.spec.shutMs || 2400) : (this.spec.openMs || 1600);

        const t = this.bodies[0];

        if (!t) return;

        if (this.shut)
        {
            this.fx.ring(t.x, t.y, t.radius * 2.4, 0x8fa4c8, 6, 320);
            Sfx.chip();

            //  It fires on the way shut, so the salvo *is* the warning that
            //  the window has closed.
            this.hooks.salvo(this.spec.salvo || 1);
            return;
        }

        this.fx.burst(t.x, t.y, this.tier.accent2, 18, 'big');
        this.fx.ring(t.x, t.y, t.radius * 3, this.tier.accent2, 6, 420);
        this.fx.popup(t.x, t.y - t.radius - 22, 'OPEN', 0x2fffa0, 28, 56, 560);
        Sfx.unlock();
    }

    /** Bodies that simply move, bouncing off the walls under their own steam. */
    private drift (dt: number): void
    {
        for (const t of this.bodies)
        {
            if (t.vx === 0 && t.vy === 0)
            {
                const a = Math.random() * TAU;
                t.vx = Math.cos(a) * this.spec.speed;
                t.vy = Math.sin(a) * this.spec.speed;
            }

            t.x += t.vx * dt;
            t.y += t.vy * dt;

            if (t.x < PLAY.left + t.radius) { t.x = PLAY.left + t.radius; t.vx = Math.abs(t.vx); }
            else if (t.x > PLAY.right - t.radius) { t.x = PLAY.right - t.radius; t.vx = -Math.abs(t.vx); }

            if (t.y < PLAY.top + t.radius) { t.y = PLAY.top + t.radius; t.vy = Math.abs(t.vy); }
            else if (t.y > PLAY.bottom - t.radius) { t.y = PLAY.bottom - t.radius; t.vy = -Math.abs(t.vy); }
        }
    }

    //  ---------------------------------------------------------------- drawing

    /**
     * The rings, drawn where they actually are this frame.
     *
     * Steel is opaque and bolted; glass is tinted, translucent and shows its
     * wear as it loses shots. The two have to be told apart at a glance from
     * across the arena, because the whole fight is the player deciding which
     * one to point at.
     */
    private draw (): void
    {
        const g = this.gfx;

        g.clear();

        const t = this.bodies[0];

        if (!t || this.rings.length === 0) return;

        //  Open shutters are drawn pulled back into the body rather than not
        //  drawn at all: a ring that vanished would read as destroyed.
        const open = this.spec.mech === 'core' && !this.shut;

        for (const ring of this.rings)
        {
            const r = open ? ring.reach * 0.42 : ring.reach;

            for (const arc of ring.arcs)
            {
                if (arc.down > 0) continue;

                const a0 = arc.at + ring.phase - arc.half;
                const a1 = arc.at + ring.phase + arc.half;
                const steel = arc.maxHp <= 0;
                const wear = steel ? 1 : Math.max(0.25, arc.hp / Math.max(1, arc.maxHp));

                g.lineStyle(Math.max(7, t.radius * 0.3), 0x05070f, open ? 0.35 : 0.75);
                g.beginPath();
                g.arc(t.x, t.y, r, a0, a1);
                g.strokePath();

                const face = steel ? 0x8fa4c8 : mix(this.tier.accent2, 0xffffff, 0.45);

                g.lineStyle(Math.max(5, t.radius * 0.2), face, (steel ? 0.95 : 0.4 + wear * 0.5) * (open ? 0.4 : 1));
                g.beginPath();
                g.arc(t.x, t.y, r, a0, a1);
                g.strokePath();

                //  Bolts at both ends of a steel plate; a crack down the
                //  middle of glass that has been hit.
                if (steel)
                {
                    for (const a of [ a0, a1 ])
                    {
                        g.fillStyle(mix(face, 0xffffff, 0.35), open ? 0.4 : 1);
                        g.fillCircle(t.x + Math.cos(a) * r, t.y + Math.sin(a) * r, Math.max(3, t.radius * 0.09));
                    }
                }
                else if (arc.hp < arc.maxHp)
                {
                    const mid = (a0 + a1) / 2;

                    g.lineStyle(2, 0xffffff, 0.8);
                    g.beginPath();
                    g.arc(t.x, t.y, r + t.radius * 0.06, mid - arc.half * 0.5, mid + arc.half * 0.5);
                    g.strokePath();
                }
            }
        }
    }

    destroy (): void
    {
        this.rings = [];
        this.bodies = [];
        this.generation.clear();
        this.gfx.destroy();
    }
}

function clamp (v: number, lo: number, hi: number): number
{
    return Math.max(lo, Math.min(hi, v));
}
