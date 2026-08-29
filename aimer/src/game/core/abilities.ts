import { GameObjects, Scene } from 'phaser';
import { ic } from './icons';
import { FONT, PLAY, W } from './theme';
import type { Fx } from './fx';
import type { Target } from '../objects/Target';

/**
 * Abilities.
 *
 * A rainbow target drifts across the board, wrapped in a golden ring with a
 * crystal set on top and an icon on its face. It takes two shots -- whatever
 * the gun -- and the moment it breaks the player's weapon *is* that ability,
 * for a few seconds, with no menu and no button in between:
 *
 *   mayhem   the gun becomes a machine gun. Lasers at a hose-pipe rate that
 *            ricochet off the arena walls twice and delete everything along
 *            the way.
 *   bomb     the gun becomes a mortar. Slow, fat shells that land where the
 *            player tapped and take the whole neighbourhood with them.
 *   laser    the gun becomes a continuous beam that follows the cursor. No
 *            tapping at all -- the player just points.
 *   sentry   two automated pods slide in at the sides and help out for a
 *            while.
 *
 * Everything about *what* an ability is lives here; the scene only asks for
 * the definition and runs the weapon.
 */

export type AbilityId = 'mayhem' | 'bomb' | 'laser' | 'sentry';

export interface AbilityDef
{
    id: AbilityId;
    name: string;
    /** One-line shout when it lands. */
    shout: string;
    icon: string;
    color: number;
    glow: number;
    /** How long the weapon lasts, in ms. */
    duration: number;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
    mayhem: { id: 'mayhem', name: 'MAYHEM',      shout: 'MAYHEM!',      icon: 'burst',   color: 0xff4d3d, glow: 0xffb020, duration: 5000 },
    bomb:   { id: 'bomb',   name: 'BOMBS',       shout: 'BOMBS AWAY!',  icon: 'bomb',    color: 0xff8a2b, glow: 0xffd23f, duration: 8000 },
    laser:  { id: 'laser',  name: 'STATIC LASER', shout: 'LASER ONLINE', icon: 'bolt',    color: 0x3fe0ff, glow: 0xff5ce0, duration: 6500 },
    sentry: { id: 'sentry', name: 'SENTRIES',    shout: 'BACKUP!',      icon: 'trident', color: 0x6cf5c8, glow: 0x62ffb8, duration: 6000 }
};

export const ABILITY_IDS: AbilityId[] = [ 'mayhem', 'bomb', 'laser', 'sentry' ];

/** Weapon numbers. */
/** Shot cooldown, ms. 520 at first; twice the pulls per second was the ask. */
export const MAYHEM_RATE = 260;
/** Bolts per trigger pull, fanned across the spray. */
export const MAYHEM_BOLTS = 6;
/** MAYHEM bolt speed (px/s), length and the longest it may fly, ms. */
export const MAYHEM_SPEED = 620;
export const MAYHEM_LENGTH = 34;
export const MAYHEM_LIFE = 3200;
export const MAYHEM_BOUNCES = 2;
/** A bolt is half a shot: there are six of them a pull and they bounce. */
export const MAYHEM_DAMAGE = 0.5;
export const BOMB_RATE = 620;
export const BOMB_RADIUS = 240;
export const BOMB_DAMAGE = 8;
export const BOMB_FLIGHT = 210;
/** Laser damage per second, in shots. */
export const LASER_DPS = 4.5;
/** The beam folds off the arena wall this many times. */
export const LASER_BOUNCES = 1;
export const LASER_WIDTH = 14;
export const SENTRY_RATE = 420;

/** Half-angle of MAYHEM's spray, in radians. Every bolt leaves at a fresh angle. */
export const MAYHEM_SPREAD = 0.55;

interface Bolt
{
    x: number;
    y: number;
    dx: number;
    dy: number;
    bounces: number;
    age: number;
    hit: Set<Target>;
}

/**
 * MAYHEM's projectiles: short, slow beams that leave the muzzle, cross the
 * board, fold off the walls twice and go out. One Graphics for the lot,
 * repainted each frame. The scene decides what a bolt is allowed to hit and
 * what happens when it does; this only flies them.
 */
export class Bolts
{
    private bolts: Bolt[] = [];
    private gfx: GameObjects.Graphics;

    constructor (scene: Scene, depth: number)
    {
        this.gfx = scene.add.graphics().setDepth(depth).setBlendMode('ADD');
    }

    fire (x: number, y: number, dx: number, dy: number): void
    {
        this.bolts.push({ x, y, dx, dy, bounces: 0, age: 0, hit: new Set() });
    }

    get count (): number
    {
        return this.bolts.length;
    }

    clear (): void
    {
        this.bolts = [];
        this.gfx.clear();
    }

    /**
     * Fly everything one frame. `targets` is what is on the board; `onHit` is
     * told about each target a bolt crosses for the first time, and answers
     * whether the bolt stopped there.
     */
    update (dtMs: number, targets: Target[], onHit: (t: Target, x: number, y: number) => boolean, onBounce?: (x: number, y: number) => void): void
    {
        const dt = dtMs / 1000;
        const def = ABILITIES.mayhem;
        const g = this.gfx;

        g.clear();

        //  Walked on a local handle: a hit can end the level, and the level
        //  ending clears the list out from under this loop.
        const list = this.bolts;

        for (let i = list.length - 1; i >= 0; i--)
        {
            const b = list[i];

            if (!b) continue;

            b.age += dtMs;

            let step = MAYHEM_SPEED * dt;
            let dead = b.age > MAYHEM_LIFE;

            //  Walk the step wall by wall, so a bolt never tunnels through a
            //  corner on a slow frame.
            while (step > 0 && !dead)
            {
                let t = step;
                let wall: 'x' | 'y' | null = null;

                if (b.dx > 0) { const c = (PLAY.right - b.x) / b.dx; if (c < t) { t = c; wall = 'x'; } }
                if (b.dx < 0) { const c = (PLAY.left - b.x) / b.dx; if (c < t) { t = c; wall = 'x'; } }
                if (b.dy > 0) { const c = (PLAY.bottom - b.y) / b.dy; if (c < t) { t = c; wall = 'y'; } }
                if (b.dy < 0) { const c = (PLAY.top - b.y) / b.dy; if (c < t) { t = c; wall = 'y'; } }

                t = Math.max(0, t);

                const x1 = b.x;
                const y1 = b.y;

                b.x += b.dx * t;
                b.y += b.dy * t;
                step -= t;

                //  Everything the bolt swept across this step.
                for (const o of targets)
                {
                    if (o.dead || b.hit.has(o)) continue;
                    if (distSeg(o.x, o.y, x1, y1, b.x, b.y) > o.radius + MAYHEM_LENGTH * 0.3) continue;

                    b.hit.add(o);

                    if (onHit(o, b.x, b.y)) { dead = true; break; }
                }

                if (dead) break;

                if (wall)
                {
                    b.bounces += 1;

                    if (b.bounces > MAYHEM_BOUNCES) { dead = true; break; }

                    if (wall === 'x') b.dx = -b.dx;
                    else b.dy = -b.dy;

                    onBounce?.(b.x, b.y);

                    //  Off the wall by a hair, so the next pass does not find
                    //  the same wall at distance zero.
                    b.x += b.dx * 0.5;
                    b.y += b.dy * 0.5;
                }
            }

            if (dead)
            {
                list.splice(i, 1);
                continue;
            }

            if (list !== this.bolts) continue;

            //  The beam: a short bright rod with a soft sheath and a hot tip.
            const tx = b.x - b.dx * MAYHEM_LENGTH;
            const ty = b.y - b.dy * MAYHEM_LENGTH;
            const fade = b.age > MAYHEM_LIFE - 400 ? (MAYHEM_LIFE - b.age) / 400 : 1;

            g.lineStyle(11, def.color, 0.22 * fade);
            g.lineBetween(tx, ty, b.x, b.y);
            g.lineStyle(5.5, def.color, 0.95 * fade);
            g.lineBetween(tx, ty, b.x, b.y);
            g.lineStyle(2.2, 0xfff3b0, fade);
            g.lineBetween(tx, ty, b.x, b.y);
            g.fillStyle(0xffffff, fade);
            g.fillCircle(b.x, b.y, 3.2);
            g.fillStyle(def.glow, 0.5 * fade);
            g.fillCircle(b.x, b.y, 6.5);
        }
    }

    destroy (): void
    {
        this.gfx.destroy();
        this.bolts = [];
    }
}

function distSeg (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number
{
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = dx * dx + dy * dy;
    let t = len === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/**
 * MAYHEM's fan for one trigger pull: `n` headings spread evenly across the
 * cone round the tap, each nudged a little so no two pulls draw the same
 * picture.
 */
export function sprayDirs (fromX: number, fromY: number, px: number, py: number, n: number): { dx: number; dy: number }[]
{
    const aim = Math.atan2(py - fromY, px - fromX);
    const step = (MAYHEM_SPREAD * 2) / Math.max(1, n - 1);
    const out: { dx: number; dy: number }[] = [];

    for (let i = 0; i < n; i++)
    {
        const a = aim - MAYHEM_SPREAD + step * i + (Math.random() * 2 - 1) * step * 0.35;

        out.push({ dx: Math.cos(a), dy: Math.sin(a) });
    }

    return out;
}

export interface LaserLeg { x1: number; y1: number; x2: number; y2: number; }

/**
 * The STATIC LASER's path: out from the muzzle through the cursor to the
 * wall, and once more off it. The first leg is what the player is pointing;
 * the second is the bonus for pointing it well.
 */
export function laserPath (mx: number, my: number, px: number, py: number): LaserLeg[]
{
    let dx = px - mx;
    let dy = py - my;
    const len = Math.hypot(dx, dy) || 1;

    dx /= len;
    dy /= len;

    let x = mx;
    let y = my;
    const out: LaserLeg[] = [];

    for (let i = 0; i <= LASER_BOUNCES; i++)
    {
        let t = Infinity;
        let wall: 'x' | 'y' = 'x';

        if (dx > 0) { const c = (PLAY.right - x) / dx; if (c < t) { t = c; wall = 'x'; } }
        if (dx < 0) { const c = (PLAY.left - x) / dx; if (c < t) { t = c; wall = 'x'; } }
        if (dy < 0) { const c = (PLAY.top - y) / dy; if (c < t) { t = c; wall = 'y'; } }
        if (dy > 0) { const c = (PLAY.bottom - y) / dy; if (c < t) { t = c; wall = 'y'; } }

        if (!isFinite(t) || t < 1) break;

        const ex = x + dx * t;
        const ey = y + dy * t;

        out.push({ x1: x, y1: y, x2: ex, y2: ey });

        x = ex;
        y = ey;

        if (wall === 'x') dx = -dx;
        else dy = -dy;
    }

    if (out.length === 0) out.push({ x1: mx, y1: my, x2: mx, y2: my - 40 });

    return out;
}

/** The beam itself, painted fresh each frame. */
export function drawLaser (g: GameObjects.Graphics, legs: LaserLeg[], now: number): void
{
    const def = ABILITIES.laser;
    const flick = Math.sin(now * 0.03) * 1.5;

    g.clear();

    legs.forEach((l, i) =>
    {
        //  The reflected leg is a touch thinner, so the eye reads which is which.
        const w = LASER_WIDTH * (i === 0 ? 1 : 0.8);

        g.lineStyle(w * 2.6 + flick, def.color, 0.18);
        g.lineBetween(l.x1, l.y1, l.x2, l.y2);
        g.lineStyle(w * 1.5 + flick, def.glow, 0.35);
        g.lineBetween(l.x1, l.y1, l.x2, l.y2);
        g.lineStyle(w + flick, def.color, 0.95);
        g.lineBetween(l.x1, l.y1, l.x2, l.y2);
        g.lineStyle(w * 0.42, 0xffffff, 1);
        g.lineBetween(l.x1, l.y1, l.x2, l.y2);

        //  A hot spot where it strikes the wall.
        if (i < legs.length - 1)
        {
            g.fillStyle(0xffffff, 0.9);
            g.fillCircle(l.x2, l.y2, w * 0.8);
            g.fillStyle(def.glow, 0.5);
            g.fillCircle(l.x2, l.y2, w * 1.7 + flick);
        }
    });

    const m = legs[0];

    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(m.x1, m.y1, LASER_WIDTH * 0.9);
    g.fillStyle(def.color, 0.5);
    g.fillCircle(m.x1, m.y1, LASER_WIDTH * 1.6);
}

/**
 * The shell landing. A flash, a white core, three rings rolling outward, a
 * scorch that lingers, and debris thrown the whole width of the blast --
 * loud enough that nothing in the radius needs to be watched to know it went.
 */
export function bombImpact (scene: Scene, fx: Fx, x: number, y: number): void
{
    const def = ABILITIES.bomb;

    scene.cameras.main.shake(260, 0.02);
    scene.cameras.main.flash(160, 255, 170, 70);

    //  White-hot core that swells and burns off.
    const core = scene.add.image(x, y, 'spark');
    core.setDisplaySize(BOMB_RADIUS * 0.9, BOMB_RADIUS * 0.9).setTint(0xffffff).setBlendMode('ADD').setDepth(27);
    scene.tweens.add({ targets: core, scale: core.scaleX * 2.4, alpha: 0, duration: 360, ease: 'Quad.out', onComplete: () => core.destroy() });

    //  The fireball under it, in the ability's orange.
    const ball = scene.add.image(x, y, 'spark');
    ball.setDisplaySize(BOMB_RADIUS * 1.3, BOMB_RADIUS * 1.3).setTint(def.color).setBlendMode('ADD').setDepth(26).setAlpha(0.9);
    scene.tweens.add({ targets: ball, scale: ball.scaleX * 1.9, alpha: 0, duration: 520, ease: 'Cubic.out', onComplete: () => ball.destroy() });

    //  Three shockwaves, one after another, out to the edge of the blast.
    for (let i = 0; i < 3; i++)
    {
        scene.time.delayedCall(i * 70, () =>
        {
            fx.ring(x, y, BOMB_RADIUS * (0.5 + i * 0.25), i === 1 ? 0xffffff : def.color, 12 - i * 3, 420 + i * 80);
        });
    }

    //  Scorch: a dark disc that hangs for a moment where the shell went off.
    const scorch = scene.add.circle(x, y, BOMB_RADIUS * 0.55, 0x000000, 0.35).setDepth(9);
    scene.tweens.add({ targets: scorch, alpha: 0, scale: 1.3, duration: 900, delay: 200, onComplete: () => scorch.destroy() });

    //  Debris and embers, thrown out in two colours.
    fx.burst(x, y, def.glow, 46, 'big');
    fx.burst(x, y, def.color, 30, 'gold');
    fx.burst(x, y, 0xffffff, 18, 'big');

    //  Spokes: a few bright lines out from the centre that vanish at once.
    const spokes = scene.add.graphics().setDepth(27).setBlendMode('ADD');

    for (let i = 0; i < 10; i++)
    {
        const a = Math.random() * TAU;
        const r = BOMB_RADIUS * (0.6 + Math.random() * 0.5);

        spokes.lineStyle(2 + Math.random() * 3, i % 2 ? 0xffffff : def.glow, 0.9);
        spokes.lineBetween(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r);
    }

    scene.tweens.add({ targets: spokes, alpha: 0, duration: 220, ease: 'Quad.out', onComplete: () => spokes.destroy() });

    fx.popup(x, y - 50, 'KABOOM', def.glow, 34, 70, 700);
}

/** The lobbed shell: a fat striped bomb that swells on the way up and settles as it lands. */
export function lobShell (scene: Scene, fromX: number, fromY: number, toX: number, toY: number, onLand: () => void): void
{
    const def = ABILITIES.bomb;
    const shell = scene.add.graphics().setDepth(25);

    shell.fillStyle(0x111118, 1);
    shell.fillCircle(0, 0, 13);
    shell.lineStyle(3, def.color, 1);
    shell.strokeCircle(0, 0, 13);
    shell.fillStyle(def.glow, 1);
    shell.fillCircle(0, -3, 4);
    shell.setPosition(fromX, fromY).setScale(0.7);

    scene.tweens.add({ targets: shell, x: toX, y: toY, duration: BOMB_FLIGHT, ease: 'Quad.out' });
    scene.tweens.add({ targets: shell, scale: 1.5, duration: BOMB_FLIGHT * 0.5, yoyo: true, ease: 'Quad.out', onComplete: () =>
    {
        shell.destroy();
        onLand();
    } });
}

/** The rainbow, as eight wedges. */
const RAINBOW = [ 0xff3b45, 0xff8a2b, 0xffd23f, 0x7dff6b, 0x3fe0ff, 0x6c8cff, 0xb388ff, 0xff5ce0 ];

const TAU = Math.PI * 2;

/** A closed polygon from [x, y] pairs, filled with the current style. */
export function fillPoly (g: GameObjects.Graphics, pts: number[][]): void
{
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillPath();
}

/** The same outline, stroked. */
export function strokePoly (g: GameObjects.Graphics, pts: number[][]): void
{
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.strokePath();
}

/**
 * Which level's board gets an ability orb, and when on its clock.
 *
 * The first one is saved for the first boss so the player's first taste of
 * it is on the level that most wants a big gun, and the second arrives midway
 * through the second world. From there it is a regular treat: every boss
 * level, and a coin flip on the rest.
 */
export function abilityPlan (level: number, boss: boolean): { at: number; id: AbilityId } | null
{
    if (level < 3) return null;
    if (level === 3) return { at: 0.085, id: 'mayhem' };
    if (level === 4) return null;
    if (level === 5) return { at: 0.3, id: 'laser' };
    if (level === 6) return { at: 0.35, id: 'bomb' };
    if (level === 7) return { at: 0.25, id: 'sentry' };

    if (!boss && Math.random() > 0.55) return null;

    return { at: 0.15 + Math.random() * 0.45, id: ABILITY_IDS[Math.floor(Math.random() * ABILITY_IDS.length)] };
}

/**
 * The rainbow coat, golden ring and crystal that make an ability orb read as
 * the prize it is. Layered onto a plain target after construction; the target
 * keeps its own hit box, life ring and flash.
 */
export function dressAbilityTarget (scene: Scene, t: Target, id: AbilityId): void
{
    const def = ABILITIES[id];
    const r = t.radius;

    //  Golden ring, outside the body, under everything else.
    const ring = scene.add.graphics();
    ring.lineStyle(Math.max(4, r * 0.16), 0xffd23f, 1);
    ring.strokeCircle(0, 0, r * 1.4);
    ring.lineStyle(Math.max(2, r * 0.06), 0xfff3b0, 0.9);
    ring.strokeCircle(0, 0, r * 1.4);

    //  Studs on the ring, so it reads as a setting rather than as a life ring.
    for (let i = 0; i < 6; i++)
    {
        const a = (i / 6) * TAU;
        ring.fillStyle(0xfff3b0, 1);
        ring.fillCircle(Math.cos(a) * r * 1.4, Math.sin(a) * r * 1.4, Math.max(2.5, r * 0.09));
    }

    //  The rainbow body: eight wedges, spun slowly.
    const wheel = scene.add.graphics();

    for (let i = 0; i < RAINBOW.length; i++)
    {
        wheel.fillStyle(RAINBOW[i], 1);
        wheel.slice(0, 0, r, (i / RAINBOW.length) * TAU, ((i + 1) / RAINBOW.length) * TAU, false);
        wheel.fillPath();
    }

    //  A soft white centre so the icon has somewhere to sit.
    const core = scene.add.graphics();
    core.fillStyle(0xffffff, 0.92);
    core.fillCircle(0, 0, r * 0.62);
    core.fillStyle(def.color, 0.25);
    core.fillCircle(0, 0, r * 0.62);
    core.lineStyle(Math.max(2, r * 0.07), 0xffffff, 0.8);
    core.strokeCircle(0, 0, r);

    //  Gloss.
    core.fillStyle(0xffffff, 0.35);
    core.fillEllipse(-r * 0.3, -r * 0.42, r * 0.7, r * 0.36);

    const icon = scene.add.image(0, 0, ic(def.icon));
    icon.setDisplaySize(r * 0.82, r * 0.82);
    icon.setTint(0x0a1024);

    //  The crystal, perched on top of the ring.
    const gem = scene.add.graphics();
    const gy = -r * 1.4;
    const gs = Math.max(7, r * 0.34);

    gem.fillStyle(0xfff3b0, 1);
    fillPoly(gem, [
        [0, gy - gs * 1.3],
        [gs * 0.75, gy - gs * 0.35],
        [gs * 0.45, gy + gs * 0.7],
        [-gs * 0.45, gy + gs * 0.7],
        [-gs * 0.75, gy - gs * 0.35]
    ]);
    gem.fillStyle(0xffffff, 0.85);
    fillPoly(gem, [
        [0, gy - gs * 1.3],
        [gs * 0.75, gy - gs * 0.35],
        [0, gy - gs * 0.1]
    ]);
    gem.fillStyle(def.color, 0.5);
    fillPoly(gem, [
        [0, gy - gs * 0.1],
        [gs * 0.45, gy + gs * 0.7],
        [-gs * 0.45, gy + gs * 0.7]
    ]);
    gem.lineStyle(Math.max(1.5, r * 0.05), 0xffd23f, 1);
    strokePoly(gem, [
        [0, gy - gs * 1.3],
        [gs * 0.75, gy - gs * 0.35],
        [gs * 0.45, gy + gs * 0.7],
        [-gs * 0.45, gy + gs * 0.7],
        [-gs * 0.75, gy - gs * 0.35]
    ]);

    //  Outer glow so the orb stands off whatever backdrop it is crossing.
    const aura = scene.add.image(0, 0, 'spark');
    aura.setDisplaySize(r * 5, r * 5).setTint(0xffd23f).setBlendMode('ADD').setAlpha(0.45);

    t.addAt(aura, 0);
    t.wear([ ring, wheel, core, icon, gem ]);

    const spin = scene.tweens.add({ targets: wheel, rotation: TAU, duration: 2600, repeat: -1 });
    const twinkle = scene.tweens.add({ targets: gem, alpha: 0.55, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    const breathe = scene.tweens.add({ targets: aura, alpha: 0.75, scale: aura.scaleX * 1.18, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    t.once('destroy', () =>
    {
        spin.remove();
        twinkle.remove();
        breathe.remove();
    });
}

/**
 * The strip across the top of the arena while an ability is live: icon, name
 * and a bar draining with the clock. It is the only readout the weapon gets,
 * and it is in the zone's colour-free prize gold so it reads as a bonus.
 */
export class AbilityBanner extends GameObjects.Container
{
    private bar: GameObjects.Graphics;
    private icon: GameObjects.Image;
    private label: GameObjects.Text;
    private color = 0xffffff;
    private barWidth = Math.min(300, W * 0.56);

    constructor (scene: Scene)
    {
        super(scene, W / 2, PLAY.top + 34);

        const w = this.barWidth;

        const back = scene.add.graphics();
        back.fillStyle(0x0a1024, 0.72);
        back.fillRoundedRect(-w / 2, -22, w, 44, 14);
        back.lineStyle(2, 0xffd23f, 0.9);
        back.strokeRoundedRect(-w / 2, -22, w, 44, 14);

        this.bar = scene.add.graphics();

        this.icon = scene.add.image(-w / 2 + 24, 0, ic('star'));
        this.icon.setDisplaySize(24, 24);

        this.label = scene.add.text(-w / 2 + 44, -1, '', {
            fontFamily: FONT,
            fontSize: 20,
            color: '#ffffff'
        }).setOrigin(0, 0.5);

        this.add([ back, this.bar, this.icon, this.label ]);

        this.setDepth(30);
        this.setAlpha(0);
        this.setVisible(false);

        scene.add.existing(this);
    }

    show (def: AbilityDef): void
    {
        this.color = def.color;
        this.icon.setTexture(ic(def.icon)).setTint(def.color);
        this.label.setText(def.name).setColor('#' + def.color.toString(16).padStart(6, '0'));

        this.setVisible(true);
        this.setScale(0.6);
        this.scene.tweens.killTweensOf(this);
        this.scene.tweens.add({ targets: this, alpha: 1, scale: 1, duration: 260, ease: 'Back.out' });
        this.set(1);
    }

    /** Fraction of the weapon's clock still left. */
    set (frac: number): void
    {
        const w = this.barWidth;
        const g = this.bar;

        g.clear();
        g.fillStyle(this.color, 0.22);
        g.fillRoundedRect(-w / 2 + 6, 14, w - 12, 5, 2);
        g.fillStyle(frac < 0.25 ? 0xff4d5e : this.color, 1);
        g.fillRoundedRect(-w / 2 + 6, 14, Math.max(4, (w - 12) * frac), 5, 2);
    }

    hide (): void
    {
        this.scene.tweens.killTweensOf(this);
        this.scene.tweens.add({ targets: this, alpha: 0, scale: 0.8, duration: 220, onComplete: () => this.setVisible(false) });
    }
}
