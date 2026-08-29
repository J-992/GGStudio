import { GameObjects, Scene } from 'phaser';
import { GunLook, gunLook } from '../data/gunkit';
import { GunPlan, Op, Part, planGun } from '../core/gunart';
import { AIM_LIMIT, GUN_SCALE, MUZZLE, PLAY, Tier } from '../core/theme';
import { ABILITIES, AbilityId, fillPoly, strokePoly } from '../core/abilities';

/** Where the rotating rig pivots, relative to the turret's own origin. */
const PIVOT_Y = -10;

const TAU = Math.PI * 2;

interface BarrelUnit
{
    flash: GameObjects.Image;
    heat: GameObjects.Rectangle;
    x: number;
    len: number;
    order: number;
}

/**
 * The player's gun: a socketed emplacement at the bottom of the screen whose
 * barrels swing to whatever was just tapped, kick back, and flare.
 *
 * It starts as a bare frame with one barrel and ends the run as a slab of
 * hardware most of a screen wide. What it looks like at any point in between is
 * decided entirely by `core/gunart`, which turns a parts list into a plan of
 * plates and lights; this class turns that plan into Phaser objects and owns
 * everything that moves -- aim, recoil, muzzle flare, and the four attachments
 * that are redrawn every frame.
 */
export class Turret extends GameObjects.Container
{
    /** World position of the primary barrel mouth -- where tracers start. */
    tipX = MUZZLE.x;
    tipY = MUZZLE.y - 40;

    /** Every barrel mouth in world space, centre barrel first. */
    tips: { x: number; y: number }[] = [];

    private look: GunLook;
    private accent: number;
    private accent2: number;

    private plan!: GunPlan;

    private rig!: GameObjects.Container;
    private bank!: GameObjects.Container;
    private barrels: BarrelUnit[] = [];
    private groups = new Map<string, GameObjects.Container>();

    private glow!: GameObjects.Arc;
    private coilGfx: GameObjects.Graphics | null = null;
    private chronoGfx: GameObjects.Graphics | null = null;
    private laserGfx: GameObjects.Graphics | null = null;
    private cellGfx: GameObjects.Graphics | null = null;
    private gemArt: GameObjects.Container | null = null;

    /**
     * The ability's hardware, clamped over the bank while one is live. Built
     * and torn down in `charge`; the base gun underneath is never touched.
     */
    private rigAbility: GameObjects.Container | null = null;
    private abilityGfx: GameObjects.Graphics | null = null;
    private abilityAura: GameObjects.Image | null = null;
    private abilityId: AbilityId | null = null;
    private abilityT = 0;

    private baseScale = 1;

    private aim = -Math.PI / 2;
    private fireIdx = 0;
    private volleyStart = 0;
    private heatLevel = 0;

    constructor (scene: Scene, tier: Tier, look?: GunLook)
    {
        super(scene, MUZZLE.x, MUZZLE.y);

        this.accent = tier.accent;
        this.accent2 = tier.accent2;
        this.look = look || gunLook({});

        this.build();

        //  Behind the targets, not in front of them. A gun this big would
        //  otherwise swallow anything that drifted down to the bottom of the
        //  arena, and hiding a target is never worth a silhouette.
        this.setDepth(8);
        scene.add.existing(this);

        this.point(this.aim, false);
    }

    //  ---------------------------------------------------------------- build

    /** Paints one part's ops into a graphics object. */
    private paint (g: GameObjects.Graphics, ops: Op[]): void
    {
        const pal = this.plan.pal;

        for (const op of ops)
        {
            switch (op.k)
            {
                case 'plate':
                    g.fillStyle(op.lit ? pal.hullLit : pal.hull, 1);
                    g.fillRoundedRect(op.x, op.y, op.w, op.h, op.r);
                    g.lineStyle(2.5, pal.edge, 0.85);
                    g.strokeRoundedRect(op.x, op.y, op.w, op.h, op.r);
                    break;

                case 'poly':
                {
                    const path = (): void =>
                    {
                        g.beginPath();
                        g.moveTo(op.pts[0], op.pts[1]);

                        for (let i = 2; i < op.pts.length; i += 2) g.lineTo(op.pts[i], op.pts[i + 1]);

                        g.closePath();
                    };

                    g.fillStyle(op.lit ? pal.hullLit : pal.hull, 1);
                    path();
                    g.fillPath();

                    g.lineStyle(2.5, pal.edge, 0.85);
                    path();
                    g.strokePath();
                    break;
                }

                case 'slot':
                    g.fillStyle(op.c, (op.a ?? 0.95) * 0.3);
                    g.fillRoundedRect(op.x - 2, op.y - 2, op.w + 4, op.h + 4, (Math.min(op.w, op.h) + 4) / 2);
                    g.fillStyle(op.c, op.a ?? 0.95);
                    g.fillRoundedRect(op.x, op.y, op.w, op.h, Math.min(op.w, op.h) / 2);
                    break;

                case 'bar':
                    g.fillStyle(op.c, op.a);
                    g.fillRoundedRect(op.x, op.y, op.w, op.h, op.r);
                    break;

                case 'stroke':
                {
                    g.lineStyle(op.w, op.c, op.a);
                    g.beginPath();
                    g.moveTo(op.pts[0], op.pts[1]);

                    for (let i = 2; i < op.pts.length; i += 2) g.lineTo(op.pts[i], op.pts[i + 1]);

                    g.strokePath();
                    break;
                }

                case 'dot':
                    g.fillStyle(op.c, op.a);
                    g.fillCircle(op.x, op.y, op.r);
                    break;
            }
        }
    }

    /**
     * Turns a list of parts into containers under `parent`, one per part name
     * so that installing an upgrade can pop exactly the piece it bought.
     */
    private assemble (parts: Part[], parent: GameObjects.Container): void
    {
        for (const part of parts)
        {
            let group = this.groups.get(part.name);

            if (!group)
            {
                group = this.scene.add.container(0, 0);
                parent.add(group);
                this.groups.set(part.name, group);
            }

            const g = this.scene.add.graphics().setPosition(part.x, part.y);

            this.paint(g, part.ops);
            group.add(g);

            if (part.back) parent.sendToBack(group);
        }
    }

    private build (): void
    {
        const L = this.look;

        this.plan = planGun(L, this.accent, this.accent2);

        //  The gun is the scoreboard, so it is drawn big from the first level
        //  and grows from there. The ramp is deliberately shallow -- a stock
        //  gun that is already a real object makes every bolt-on read, and the
        //  endgame one still has to fit inside the arena when it swings.
        this.baseScale = (1.6 + L.bulk * 0.15) * GUN_SCALE;
        this.setScale(this.baseScale);

        this.glow = this.scene.add.circle(0, 6, this.plan.glowR, this.plan.pal.edge, this.plan.glowA);
        this.add(this.glow);

        this.assemble(this.plan.frame, this);

        this.rig = this.scene.add.container(0, PIVOT_Y);
        this.bank = this.scene.add.container(0, 0);
        this.rig.add(this.bank);
        this.add(this.rig);

        this.assemble(this.plan.bank, this.bank);

        //  Everything bolted to a barrel sits in front of it.
        for (const name of this.plan.top)
        {
            const g = this.groups.get(name);
            if (g) this.bank.bringToTop(g);
        }

        this.buildLive();
    }

    /** The four attachments that are redrawn every frame, plus muzzle flare. */
    private buildLive (): void
    {
        const L = this.look;

        for (let i = 0; i < this.plan.barrels.length; i++)
        {
            const b = this.plan.barrels[i];

            //  A slit in the bore rather than a dot stuck on the end: the gun
            //  has no circles on it until an upgrade puts one there.
            const heat = this.scene.add.rectangle(b.x, -b.muzzle + 5, b.wHalf * 0.9, 4, this.plan.pal.edge, 0.9);
            this.bank.add(heat);

            const flash = this.scene.add.image(b.x, -b.len - 4, 'spark');
            flash.setDisplaySize(100, 100).setTint(this.plan.pal.edge).setBlendMode('ADD').setAlpha(0);
            this.bank.add(flash);

            this.barrels.push({ flash, heat, x: b.x, len: b.len, order: 0 });
        }

        //  Centre barrel first, then outward: a volley walks out from the
        //  middle of the bank instead of sweeping across it.
        const n = this.barrels.length;

        this.barrels.forEach((b, i) => { b.order = Math.abs(i - (n - 1) / 2); });
        this.barrels.sort((a, b) => a.order - b.order);

        if (this.plan.cells.length > 0)
        {
            this.cellGfx = this.scene.add.graphics();
            this.groupFor('cells').add(this.cellGfx);
        }

        if (this.plan.gem)
        {
            this.gemArt = this.groups.get('gem') || null;
        }

        if (this.plan.coils)
        {
            this.coilGfx = this.scene.add.graphics();
            this.groupFor('coils').add(this.coilGfx);
        }

        if (this.plan.chrono)
        {
            this.chronoGfx = this.scene.add.graphics();
            this.groupFor('chrono').add(this.chronoGfx);
            this.bank.bringToTop(this.groupFor('chrono'));
        }

        if (L.laser > 0) this.laserGfx = this.scene.add.graphics().setDepth(27);
    }

    /** The container for a part name, made on the spot if the plan had none. */
    private groupFor (name: string): GameObjects.Container
    {
        let g = this.groups.get(name);

        if (!g)
        {
            g = this.scene.add.container(0, 0);
            this.bank.add(g);
            this.groups.set(name, g);
        }

        return g;
    }

    //  ----------------------------------------------------------- behaviour

    /**
     * Swing to face a tap and kick. `shots` is how many barrels actually went
     * off, so a multi-shot volley flares every gun that fired it.
     */
    fire (px: number, py: number, shots = 1): void
    {
        const raw = Math.atan2(py - (this.y + PIVOT_Y * this.baseScale), px - this.x);
        const clamped = Math.max(-Math.PI / 2 - AIM_LIMIT, Math.min(-Math.PI / 2 + AIM_LIMIT, raw));

        this.point(clamped, true);

        const n = Math.max(1, Math.min(this.barrels.length, shots));

        //  Locked in before the bank advances, so `tipFor` hands out the mouths
        //  of the barrels that actually flared for *this* volley.
        this.volleyStart = this.fireIdx;

        for (let i = 0; i < n; i++)
        {
            const b = this.barrels[(this.fireIdx + i) % this.barrels.length];

            b.flash.setAlpha(0.95).setScale(b.flash.scaleX);
            this.scene.tweens.add({ targets: b.flash, alpha: 0, duration: 110, ease: 'Quad.out' });

            b.heat.setScale(1.8);
            this.scene.tweens.add({ targets: b.heat, scale: 1, duration: 220, ease: 'Quad.out' });
        }

        if (this.barrels.length > 1) this.fireIdx = (this.fireIdx + n) % this.barrels.length;

        this.heatLevel = Math.min(1, this.heatLevel + 0.35);

        this.bank.setY(10 + this.look.power * 0.3);
        this.scene.tweens.add({ targets: this.bank, y: 0, duration: 160, ease: 'Back.out' });
    }

    /** Swing to face a point without firing -- the beam weapon's tracking. */
    aimAt (px: number, py: number): void
    {
        const raw = Math.atan2(py - (this.y + PIVOT_Y * this.baseScale), px - this.x);
        const clamped = Math.max(-Math.PI / 2 - AIM_LIMIT, Math.min(-Math.PI / 2 + AIM_LIMIT, raw));

        this.point(clamped, false);
    }

    /** The mouth of the `i`th barrel in the current volley, wrapping. */
    tipFor (i: number): { x: number; y: number }
    {
        if (this.tips.length === 0) return { x: this.tipX, y: this.tipY };
        return this.tips[(this.volleyStart + i) % this.tips.length];
    }

    private point (angle: number, tween: boolean): void
    {
        this.aim = angle;

        const rot = angle + Math.PI / 2;

        if (tween)
        {
            this.scene.tweens.add({ targets: this.rig, rotation: rot, duration: 70, ease: 'Quad.out' });
        }
        else
        {
            this.rig.setRotation(rot);
        }

        this.computeTips(rot);
    }

    /** Barrel mouths, rig space -> world space. Recoil is deliberately ignored. */
    private computeTips (rot: number): void
    {
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const s = this.baseScale;

        this.tips = this.barrels.map(b =>
        {
            const lx = b.x;
            const ly = -b.len;

            return {
                x: this.x + (lx * cos - ly * sin) * s,
                y: this.y + (PIVOT_Y + lx * sin + ly * cos) * s
            };
        });

        this.tipX = this.tips[0].x;
        this.tipY = this.tips[0].y;
    }

    /**
     * Rebuild the gun around a new parts list without swapping the object out.
     *
     * A part used to arrive at the start of a level, so the gun could simply be
     * constructed once with the finished list. Ranks are earned mid-fight now,
     * which means the weapon has to grow while the player is looking straight
     * at it -- the whole reason the gun is the scoreboard in the first place.
     * Everything the build fills in is cleared back to its starting value here,
     * so a refit leaves exactly the gun a fresh construction would have.
     */
    refit (look: GunLook): void
    {
        const aim = this.aim;

        this.laserGfx?.destroy();
        this.removeAll(true);

        this.rigAbility = null;
        this.abilityGfx = null;
        this.abilityAura = null;

        this.look = look;
        this.barrels = [];
        this.tips = [];
        this.groups.clear();
        this.coilGfx = null;
        this.chronoGfx = null;
        this.laserGfx = null;
        this.cellGfx = null;
        this.gemArt = null;
        this.heatLevel = 0;
        this.fireIdx = 0;

        this.build();
        this.point(aim, false);

        //  A refit mid-ability (a rank taken while the weapon is live) keeps
        //  the weapon dressed.
        if (this.abilityId) this.charge(this.abilityId);
    }

    /**
     * Dress the gun as an ability's weapon, or (`null`) strip it back.
     *
     * Each is one bolt-on over the barrel bank, in the ability's own colours
     * and nothing like the upgrade parts, so the player reads "this is
     * temporary and this is *mine for seven seconds*" at a glance:
     *
     *   mayhem   a rotary cage of six spinning vents round the bore, red-hot.
     *   bomb     a fat black mortar tube with hazard stripes and a fuse lamp.
     *   laser    a crystal prism emitter held in a cradle of rings.
     *   sentry   a command mast with a spinning radar dish and an uplink lamp.
     */
    charge (id: AbilityId | null): void
    {
        this.rigAbility?.destroy();
        this.rigAbility = null;
        this.abilityGfx = null;
        this.abilityAura?.destroy();
        this.abilityAura = null;
        this.abilityId = id;
        this.abilityT = 0;

        if (!id) return;

        const def = ABILITIES[id];
        const main = this.plan.barrels.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a), this.plan.barrels[0]);
        const len = main.len;
        const w = Math.max(9, main.wHalf * 1.6);

        const rig = this.scene.add.container(main.x, 0);
        const g = this.scene.add.graphics();

        rig.add(g);

        if (id === 'mayhem')
        {
            //  Shroud.
            g.fillStyle(0x1a0a0a, 1);
            g.fillRoundedRect(-w * 1.6, -len + 4, w * 3.2, len * 0.7, 6);
            g.lineStyle(2.5, def.color, 1);
            g.strokeRoundedRect(-w * 1.6, -len + 4, w * 3.2, len * 0.7, 6);

            //  Twin side barrels.
            for (const sx of [ -1, 1 ])
            {
                g.fillStyle(0x2a1010, 1);
                g.fillRoundedRect(sx * w * 1.1 - w * 0.4, -len - 10, w * 0.8, len * 0.55, 3);
                g.lineStyle(2, def.glow, 0.9);
                g.strokeRoundedRect(sx * w * 1.1 - w * 0.4, -len - 10, w * 0.8, len * 0.55, 3);
            }

            //  Heat fins.
            g.lineStyle(2, def.color, 0.8);
            for (let i = 0; i < 5; i++)
            {
                const y = -len + 10 + i * (len * 0.12);
                g.lineBetween(-w * 1.6, y, -w * 2.1, y + 4);
                g.lineBetween(w * 1.6, y, w * 2.1, y + 4);
            }
        }
        else if (id === 'bomb')
        {
            //  Mortar tube, fat and black.
            g.fillStyle(0x111118, 1);
            g.fillRoundedRect(-w * 1.7, -len - 8, w * 3.4, len * 0.95, 8);
            g.lineStyle(3, def.color, 1);
            g.strokeRoundedRect(-w * 1.7, -len - 8, w * 3.4, len * 0.95, 8);

            //  Hazard stripes.
            g.fillStyle(def.glow, 0.9);
            for (let i = 0; i < 4; i++)
            {
                const y = -len + 6 + i * 12;
                fillPoly(g, [
                    [-w * 1.4, y + 6], [-w * 0.6, y], [-w * 0.2, y], [-w * 1.0, y + 6]
                ]);
                fillPoly(g, [
                    [w * 0.2, y + 6], [w * 1.0, y], [w * 1.4, y], [w * 0.6, y + 6]
                ]);
            }

            //  Muzzle lip.
            g.fillStyle(0x222230, 1);
            g.fillRoundedRect(-w * 2, -len - 14, w * 4, 10, 4);
            g.lineStyle(2.5, def.color, 1);
            g.strokeRoundedRect(-w * 2, -len - 14, w * 4, 10, 4);
        }
        else if (id === 'laser')
        {
            //  Cradle rings up the barrel.
            for (let i = 0; i < 4; i++)
            {
                const y = -len + 8 + i * (len * 0.17);
                g.lineStyle(3, i % 2 ? def.color : def.glow, 0.95);
                g.strokeEllipse(0, y, w * 3.2, 9);
            }

            //  Spine struts.
            g.lineStyle(2.5, 0xd8e4ff, 0.9);
            g.lineBetween(-w * 1.6, -len + 8, -w * 1.6, -len + 8 + len * 0.51);
            g.lineBetween(w * 1.6, -len + 8, w * 1.6, -len + 8 + len * 0.51);

            //  The prism: a crystal sat in the mouth.
            const py = -len - 4;
            const ps = w * 1.5;

            g.fillStyle(0xffffff, 0.95);
            fillPoly(g, [
                [0, py - ps * 1.4], [ps * 0.8, py - ps * 0.3], [ps * 0.5, py + ps * 0.8],
                [-ps * 0.5, py + ps * 0.8], [-ps * 0.8, py - ps * 0.3]
            ]);
            g.fillStyle(def.color, 0.6);
            fillPoly(g, [ [0, py - ps * 1.4], [ps * 0.8, py - ps * 0.3], [0, py] ]);
            g.fillStyle(def.glow, 0.55);
            fillPoly(g, [ [0, py], [ps * 0.5, py + ps * 0.8], [-ps * 0.5, py + ps * 0.8] ]);
            g.lineStyle(2, 0xffffff, 1);
            strokePoly(g, [
                [0, py - ps * 1.4], [ps * 0.8, py - ps * 0.3], [ps * 0.5, py + ps * 0.8],
                [-ps * 0.5, py + ps * 0.8], [-ps * 0.8, py - ps * 0.3]
            ]);
        }
        else
        {
            //  Command mast beside the barrel, with a dish on top.
            const mx = w * 2.4;

            g.lineStyle(4, 0x1b2549, 1);
            g.lineBetween(mx, 4, mx, -len * 0.75);
            g.lineStyle(2, def.color, 0.9);
            g.lineBetween(mx, 4, mx, -len * 0.75);

            g.fillStyle(0x1b2549, 1);
            g.fillCircle(mx, -len * 0.75, 7);
            g.lineStyle(2, def.glow, 1);
            g.strokeCircle(mx, -len * 0.75, 7);

            //  Rank chevrons down the shroud.
            g.lineStyle(2.5, def.color, 0.9);
            for (let i = 0; i < 3; i++)
            {
                const y = -len * 0.55 + i * 9;
                g.lineBetween(-w, y + 5, 0, y);
                g.lineBetween(0, y, w, y + 5);
            }
        }

        //  Per-frame layer: spinning vents, fuse lamp, prism pulse, radar.
        const live = this.scene.add.graphics();
        rig.add(live);
        this.abilityGfx = live;

        this.bank.add(rig);
        this.rigAbility = rig;

        //  A coloured aura under the whole gun says "charged" from across the
        //  room, whichever way it is pointing.
        const aura = this.scene.add.image(0, 0, 'spark');
        aura.setDisplaySize(this.plan.glowR * 4.2, this.plan.glowR * 4.2).setTint(def.color).setBlendMode('ADD').setAlpha(0.55);
        this.addAt(aura, 0);
        this.abilityAura = aura;

        //  Slams on.
        rig.setScale(1.6).setAlpha(0);
        this.scene.tweens.add({ targets: rig, scale: 1, alpha: 1, duration: 320, ease: 'Back.out' });
    }

    /** The moving parts of the ability hardware. */
    private drawAbility (time: number): void
    {
        const g = this.abilityGfx;
        const id = this.abilityId;

        if (!g || !id) return;

        this.abilityT = time;

        const def = ABILITIES[id];
        const main = this.plan.barrels.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a), this.plan.barrels[0]);
        const len = main.len;
        const w = Math.max(9, main.wHalf * 1.6);
        const t = this.abilityT;

        g.clear();

        if (id === 'mayhem')
        {
            //  Six vents spinning round the bore.
            const cy = -len + 4 + len * 0.35;

            for (let i = 0; i < 6; i++)
            {
                const a = t * 0.012 + (i / 6) * Math.PI * 2;
                const x = Math.cos(a) * w * 1.15;
                const s = 0.5 + Math.sin(a) * 0.5;

                g.fillStyle(s > 0.5 ? def.glow : def.color, 0.5 + s * 0.5);
                g.fillCircle(x, cy, 2 + s * 2.5);
            }

            //  Hot muzzle.
            g.fillStyle(def.glow, 0.55 + Math.abs(Math.sin(t * 0.03)) * 0.45);
            g.fillCircle(0, -len - 2, w * 0.6);
        }
        else if (id === 'bomb')
        {
            //  A fuse lamp that blinks faster the nearer the next shell.
            const on = Math.sin(t * 0.01) > 0;

            g.fillStyle(on ? 0xff3b45 : 0x552020, 1);
            g.fillCircle(0, -len + 12 + len * 0.5, 5);
            g.fillStyle(def.glow, on ? 0.5 : 0.1);
            g.fillCircle(0, -len + 12 + len * 0.5, 9);
        }
        else if (id === 'laser')
        {
            //  The prism hums; the rings climb the barrel.
            const py = -len - 4;
            const pulse = 0.5 + Math.sin(t * 0.02) * 0.5;

            g.fillStyle(def.color, 0.25 + pulse * 0.35);
            g.fillCircle(0, py - w * 0.3, w * (1.8 + pulse * 0.7));
            g.fillStyle(0xffffff, 0.4 + pulse * 0.4);
            g.fillCircle(0, py - w * 0.3, w * 0.45);

            const climb = (t * 0.004) % 1;

            g.lineStyle(2, 0xffffff, 0.7 * (1 - climb));
            g.strokeEllipse(0, -len + 8 + (1 - climb) * len * 0.51, w * 3.2, 9);
        }
        else
        {
            //  Radar sweep on the dish and an uplink ping on the lamp.
            const mx = w * 2.4;
            const dy = -len * 0.75;
            const a = t * 0.006;

            g.lineStyle(2, def.glow, 0.9);
            g.lineBetween(mx, dy, mx + Math.cos(a) * 9, dy + Math.sin(a) * 9);

            const ping = (t * 0.0025) % 1;

            g.lineStyle(1.5, def.color, 1 - ping);
            g.strokeCircle(mx, dy, 7 + ping * 14);
        }

        if (this.abilityAura)
        {
            this.abilityAura.setAlpha(0.35 + Math.abs(Math.sin(t * 0.005)) * 0.3);
        }
    }

    /**
     * Bolt-on animation for a freshly taken upgrade: the part it installed
     * slams into place and the whole gun rings. This is the moment the upgrade
     * screen's promise is actually paid out.
     */
    install (part: string | null): void
    {
        const target = part ? this.groups.get(part) : null;

        this.setScale(this.baseScale * 1.12);
        this.scene.tweens.add({ targets: this, scale: this.baseScale, duration: 420, ease: 'Back.out' });

        this.glow.setAlpha(0.5);
        this.scene.tweens.add({ targets: this.glow, alpha: this.plan.glowA * 1.4, duration: 520, ease: 'Quad.out' });

        if (!target) return;

        target.setScale(1.9).setAlpha(0);
        this.scene.tweens.add({ targets: target, scale: 1, alpha: 1, duration: 360, ease: 'Back.out' });
    }

    /** Idle life: breathing glow, running cells, spinning gyro, live arcs. */
    idle (time: number): void
    {
        const L = this.look;

        this.glow.setScale(1 + Math.sin(time * 0.003) * 0.07);
        this.glow.setAlpha(0.03 + Math.abs(Math.sin(time * 0.0022)) * (0.04 + L.bulk * 0.14));

        this.heatLevel = Math.max(0, this.heatLevel - 0.02);

        if (this.gemArt) this.gemArt.setScale(1, 1 + Math.sin(time * 0.005) * 0.14);

        if (this.cellGfx) this.drawCells(time);
        if (this.coilGfx) this.drawCoils(time);
        if (this.chronoGfx) this.drawChrono(time);
        if (this.laserGfx) this.drawLaser();
        if (this.abilityGfx) this.drawAbility(time);
    }

    /** Charge cells lighting up in a wave out from the core. */
    private drawCells (time: number): void
    {
        const g = this.cellGfx!;
        const cells = this.plan.cells;

        g.clear();

        for (let i = 0; i < cells.length; i++)
        {
            const c = cells[i];
            const pulse = 0.45 + 0.55 * Math.max(0, Math.sin(time * 0.004 - Math.floor(i / 2) * 0.5));

            g.fillStyle(this.plan.pal.cell, 0.22 * pulse);
            g.fillRoundedRect(c.x - 3.5, c.y - 6, 7, 12, 3.5);
            g.fillStyle(this.plan.pal.cell, 0.55 + 0.4 * pulse);
            g.fillRoundedRect(c.x - 2, c.y - 4.5, 4, 9, 2);
        }
    }

    /** Electric arc snapping between the arc posts. */
    private drawCoils (time: number): void
    {
        const g = this.coilGfx!;
        const { reach, y } = this.plan.coils!;

        g.clear();

        const steps = 6;
        const amp = 5 + this.look.coils + this.heatLevel * 8;

        g.lineStyle(2.5, this.plan.pal.heat, 0.5 + this.heatLevel * 0.45);
        g.beginPath();
        g.moveTo(-reach, y);

        for (let i = 1; i <= steps; i++)
        {
            const t = i / steps;
            const jitter = i === steps ? 0 : Math.sin(time * 0.02 + i * 2.1) * amp;
            g.lineTo(-reach + t * reach * 2, y + jitter);
        }

        g.strokePath();
    }

    /** Gyro collar: dashes riding a squashed circle, front ones drawn fatter. */
    private drawChrono (time: number): void
    {
        const g = this.chronoGfx!;
        const { rx, ry, y } = this.plan.chrono!;
        const phase = time * 0.0022;
        const dashes = 8;

        g.clear();

        //  The collar itself, so the moving lights are riding a real part of
        //  the gun rather than floating over the barrels.
        g.lineStyle(3, this.plan.pal.edge, 0.5);
        g.beginPath();

        for (let i = 0; i <= 40; i++)
        {
            const a = (i / 40) * TAU;
            const px = Math.cos(a) * rx;
            const py = y + Math.sin(a) * ry;
            i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }

        g.strokePath();

        for (let i = 0; i < dashes; i++)
        {
            const a = phase + (i / dashes) * TAU;
            const depth = (Math.sin(a) + 1) / 2;

            g.fillStyle(this.plan.pal.tech, 0.25 + depth * 0.65);
            g.fillCircle(Math.cos(a) * rx, y + Math.sin(a) * ry, 1.4 + depth * 1.9);
        }
    }

    /** A thin sight line up the arena from the primary muzzle. */
    private drawLaser (): void
    {
        const g = this.laserGfx!;
        const reach = 1200;
        const a = this.rig.rotation - Math.PI / 2;

        g.clear();
        g.lineStyle(1.5 + this.look.laser * 0.2, this.plan.pal.aim, 0.16 + this.look.laser * 0.05);
        g.lineBetween(this.tipX, this.tipY, this.tipX + Math.cos(a) * reach, this.tipY + Math.sin(a) * reach);

        //  A dot where the sight crosses the top of the playfield reads as the
        //  gun actually pointing at something.
        const t = (PLAY.top - this.tipY) / (Math.sin(a) * reach);

        if (t > 0 && t < 1)
        {
            g.fillStyle(this.plan.pal.aim, 0.5);
            g.fillCircle(this.tipX + Math.cos(a) * reach * t, PLAY.top, 3);
        }
    }

    destroy (fromScene?: boolean): void
    {
        this.laserGfx?.destroy();
        this.laserGfx = null;
        super.destroy(fromScene);
    }
}
