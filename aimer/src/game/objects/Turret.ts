import { GameObjects, Scene } from 'phaser';
import { GunLook, gunLook } from '../data/gunkit';
import { AIM_LIMIT, GUN_SCALE, MUZZLE, PLAY, Tier, mix } from '../core/theme';

/** Where the rotating rig pivots, relative to the turret's own origin. */
const PIVOT_Y = -10;

const TAU = Math.PI * 2;

/**
 * The one material the whole weapon is cut from. Every part -- frame, barrels,
 * pods, vanes -- is this dark plate with an accent edge light, and an upgrade's
 * own colour only ever shows up as a small emissive slot set into it. That is
 * what keeps a twenty-part endgame gun looking like one machine instead of a
 * pile of stickers.
 */
const HULL = 0x1b2549;
const HULL_LIT = 0x2d3c74;

const GOLD = 0xffc857;

/** Signature slot colours. Small chips of light, never whole shapes. */
const LIT = {
    vents: 0xff8a3d,
    scope: 0xffd23f,
    lance: 0x7dff6b,
    drum: 0xff5a3d,
    blast: 0x4fd6ff,
    coils: 0xfff05c,
    gem: 0x9b6cff,
    magnet: 0xff7ae0,
    chrono: 0x8fd3ff,
    charms: 0x7dff6b,
    laser: 0xff5470
};

interface BarrelUnit
{
    root: GameObjects.Container;
    flash: GameObjects.Image;
    heat: GameObjects.Rectangle;
    len: number;
    order: number;
}

/**
 * The player's gun: a socketed emplacement at the bottom of the screen whose
 * barrels swing to whatever was just tapped, kick back, and flare.
 *
 * It starts as a bare frame with one barrel and ends the run as a slab of
 * hardware most of a screen wide. Everything past the frame is bolted on by an
 * upgrade (see `data/gunkit` for the parts list) -- this class is handed a
 * `GunLook` and builds exactly that, and decides nothing about what the player
 * has earned.
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

    //  Palette, resolved once from the build.
    private hull = HULL;
    private hullLit = HULL_LIT;
    private edge = 0xffffff;

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

    //  Geometry the per-frame drawing needs back.
    private baseScale = 1;
    private coilReach = 40;
    private chronoRx = 40;
    private cellSlots: { x: number; y: number }[] = [];

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

    /** A named, poppable sub-assembly. Installing an upgrade pops its group. */
    private group (name: string, parent: GameObjects.Container, x = 0, y = 0): GameObjects.Container
    {
        const c = this.scene.add.container(x, y);
        parent.add(c);
        this.groups.set(name, c);
        return c;
    }

    /** One piece of hull: dark plate, accent edge. The gun's only vocabulary. */
    private plate (g: GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, lit = false): void
    {
        g.fillStyle(lit ? this.hullLit : this.hull, 1);
        g.fillRoundedRect(x, y, w, h, r);
        g.lineStyle(2.5, this.edge, 0.85);
        g.strokeRoundedRect(x, y, w, h, r);
    }

    /** An emissive slot set into a plate -- the only place colour is allowed. */
    private slot (g: GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 0.95): void
    {
        g.fillStyle(color, alpha * 0.3);
        g.fillRoundedRect(x - 2, y - 2, w + 4, h + 4, (h + 4) / 2);
        g.fillStyle(color, alpha);
        g.fillRoundedRect(x, y, w, h, h / 2);
    }

    private build (): void
    {
        const L = this.look;

        //  Gold is a change of material, not a bag of new shapes: the same
        //  plates, cast in a different metal.
        const goldT = Math.min(0.7, L.gold * 0.075);

        //  Gold darkens the plate rather than lightening it: the edge light is
        //  what should read as gold, not a flat wash over the whole gun.
        this.hull = mix(HULL, 0x2c2008, goldT * 0.85);
        this.hullLit = mix(HULL_LIT, 0x4a3a0e, goldT * 0.85);
        this.edge = mix(this.accent, GOLD, goldT);

        //  The gun is the scoreboard, so it is drawn big from the first level
        //  and grows from there. The ramp is deliberately shallow -- a stock
        //  gun that is already a real object makes every bolt-on read, and the
        //  endgame one still has to fit inside the arena when it swings.
        this.baseScale = (1.6 + L.bulk * 0.15) * GUN_SCALE;
        this.setScale(this.baseScale);

        this.glow = this.scene.add.circle(0, 6, 60 + L.bulk * 70, this.edge, 0.04 + L.bulk * 0.09);
        this.add(this.glow);

        this.buildFrame(goldT);

        this.rig = this.scene.add.container(0, PIVOT_Y);
        this.bank = this.scene.add.container(0, 0);
        this.rig.add(this.bank);
        this.add(this.rig);

        this.buildBank();

        if (L.laser > 0) this.laserGfx = this.scene.add.graphics().setDepth(27);
    }

    /**
     * The frame the rig sits in. Stock, this is a single plate and a light bar
     * and nothing else -- deliberately plain, so the first upgrade to touch it
     * is obvious.
     */
    private buildFrame (goldT: number): void
    {
        const L = this.look;
        const half = 66 + L.bulk * 20;

        const g = this.scene.add.graphics();

        this.plate(g, -half, -20, half * 2, 70, 14);

        //  One short light strip, centred. The stock gun is a plate, a strip
        //  and a barrel -- nothing else. Every other mark on it was bought.
        g.fillStyle(this.edge, 0.8);
        g.fillRoundedRect(-half * 0.42, -20, half * 0.84, 6, 3);

        this.add(g);

        //  Gold inlay: chevrons cut into the frame once the greed build has
        //  really committed. Still hull-coloured plate underneath.
        if (goldT > 0.4)
        {
            const gold = this.group('gold', this, 0, 0);
            const c = this.scene.add.graphics();

            c.lineStyle(3, GOLD, 0.9);

            for (let i = 0; i < 3; i++)
            {
                const x = half - 16 - i * 13;
                c.lineBetween(-x, -8, -x + 7, 0);
                c.lineBetween(-x + 7, 0, -x, 8);
                c.lineBetween(x, -8, x - 7, 0);
                c.lineBetween(x - 7, 0, x, 8);
            }

            gold.add(c);
        }

        //  Outriggers. Struts and foot plates, same plate language as the rest.
        if (L.brace > 0)
        {
            const brace = this.group('brace', this, 0, 0);
            const b = this.scene.add.graphics();
            //  Short struts: a two-stack utility upgrade should not be the
            //  thing that decides how wide the whole gun is.
            const reach = 10 + L.brace * 6;

            for (const side of [ -1, 1 ])
            {
                b.lineStyle(9, this.hullLit, 1);
                b.lineBetween(side * (half - 8), -2, side * (half + reach), 6);
                b.lineStyle(2.5, this.edge, 0.8);
                b.lineBetween(side * (half - 8), -2, side * (half + reach), 6);
                this.plate(b, side * (half + reach) - 11, -4, 22, 18, 5, true);
            }

            brace.add(b);
            this.sendToBack(brace);
        }

        //  Luck tag: a small chamfered plate with pips, bolted to the frame.
        if (L.charms > 0)
        {
            const charm = this.group('charms', this, -(half - 18), -6);
            const c = this.scene.add.graphics();

            this.plate(c, -9, -9, 18, 18, 4, true);

            const pips = Math.min(5, 1 + Math.round(L.charms * 0.6));

            for (let i = 0; i < pips; i++)
            {
                const a = -Math.PI / 2 + (i / pips) * TAU;
                c.fillStyle(LIT.charms, 0.95);
                c.fillCircle(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 1.7);
            }

            charm.add(c);
        }
    }

    /** The rotating half: receiver, barrels, and everything bolted to them. */
    private buildBank (): void
    {
        const L = this.look;
        const n = L.barrels;

        const halfW = 9 + Math.min(3.5, L.power * 0.3);
        const len = 60 + Math.min(30, L.power * 2.9) + L.bulk * 20;
        const spread = halfW * 2 + 3;

        const flank = ((n - 1) / 2) * spread + halfW;
        const recHalf = flank + 12 + L.bulk * 6;

        //  Receiver: the block every barrel plugs into. Without it a six-gun
        //  bank is six loose tubes; with it the gun has a body.
        const rg = this.scene.add.graphics();

        this.plate(rg, -recHalf, -26, recHalf * 2, 46, 12);

        //  An inset deck once the receiver is big enough that a bare plate
        //  would read as a blank box.
        if (L.bulk > 0.22)
        {
            this.plate(rg, -recHalf + 9, -21, (recHalf - 9) * 2, 22, 8, true);
        }

        this.bank.add(rg);

        //  The receiver's lower face is the one strip of the gun the barrels
        //  never cover, so it is where the readouts live.
        const faceY = 2;

        this.buildBarrels(n, halfW, len, spread, flank);
        this.buildFlanks(flank, recHalf, len);
        this.buildFace(recHalf, flank, faceY);

        //  Reinforcement collars: heavy banding across the whole bank. Power's
        //  second job, after length -- it is what makes the gun read as dense.
        if (L.power > 2)
        {
            const collars = this.group('power', this.bank, 0, 0);
            const c = this.scene.add.graphics();
            const bands = Math.min(2, Math.floor(L.power / 4));

            for (let i = 0; i < bands; i++)
            {
                //  Short of the full bank width -- a band that runs edge to
                //  edge turns the whole gun into a crate.
                const w = (flank + 2) * (0.74 - i * 0.16);
                const y = -len * (0.42 + i * 0.24);

                this.plate(c, -w, y, w * 2, 10, 5, true);
                this.slot(c, -w * 0.55, y + 3.5, w * 1.1, 3, this.edge, 0.5);
            }

            collars.add(c);
        }

        //  Chrono gyro: a collar ring around the bank, dashes riding it.
        if (L.chrono > 0)
        {
            const chrono = this.group('chrono', this.bank, 0, -len * 0.2);
            this.chronoRx = flank + 16;
            this.chronoGfx = this.scene.add.graphics();
            chrono.add(this.chronoGfx);
        }

        //  Everything bolted to a barrel has to sit in front of it.
        for (const name of [ 'power', 'vents', 'lance', 'drum', 'blast', 'magnet', 'scope', 'chrono', 'coils', 'laser' ])
        {
            const g = this.groups.get(name);
            if (g && g.parentContainer === this.bank) this.bank.bringToTop(g);
        }

        this.groups.set('barrels', this.bank);
    }

    private buildBarrels (n: number, halfW: number, len: number, spread: number, flank: number): void
    {
        const L = this.look;

        const order = Array.from({ length: n }, (_, i) => i)
            .sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));

        const ventArt = L.vents > 0 ? this.group('vents', this.bank) : null;
        const lanceArt = L.lance > 0 ? this.group('lance', this.bank) : null;

        for (let i = 0; i < n; i++)
        {
            const slot = i - (n - 1) / 2;
            const off = slot * spread;
            const outer = Math.abs(slot) >= (n - 1) / 2 - 0.01;

            const root = this.scene.add.container(off, 0);

            const g = this.scene.add.graphics();

            //  Barrel proper, plugged deep into the receiver.
            this.plate(g, -halfW, -len, halfW * 2, len + 22, 6);

            //  Muzzle band.
            g.fillStyle(this.edge, 0.9);
            g.fillRoundedRect(-halfW + 2, -len + 5, (halfW - 2) * 2, 6, 3);

            root.add(g);

            //  Heat sinks ride the two outermost barrels only. On the inner
            //  ones they would be hidden by their neighbours anyway, and the
            //  pair reads as a matched set.
            if (ventArt && outer)
            {
                const v = this.scene.add.graphics().setPosition(off, 0);
                const fins = Math.min(5, 1 + Math.round(L.vents * 0.5));
                const side = slot < 0 ? -1 : 1;

                for (let f = 0; f < fins; f++)
                {
                    const fy = -len * 0.28 - f * 11;

                    this.plate(v, side > 0 ? halfW - 1 : -halfW - 9, fy, 10, 8, 3, true);
                    this.slot(v, side > 0 ? halfW + 2 : -halfW - 6, fy + 3, 4, 2, LIT.vents);
                }

                ventArt.add(v);
            }

            //  Pierce chamfers every muzzle into a lance point -- same plate,
            //  same edge light, just a sharper end.
            if (lanceArt)
            {
                const s = this.scene.add.graphics().setPosition(off, 0);
                const reach = 10 + Math.min(18, L.lance * 4);
                const base = halfW * 0.8;

                s.fillStyle(this.hullLit, 1);
                s.fillTriangle(-base, -len + 6, base, -len + 6, 0, -len - reach);
                s.lineStyle(2.5, this.edge, 0.85);
                s.strokeTriangle(-base, -len + 6, base, -len + 6, 0, -len - reach);
                this.slot(s, -1.5, -len - reach * 0.35, 3, 4, LIT.lance);

                lanceArt.add(s);
            }

            //  A slit in the bore rather than a dot stuck on the end: the gun
            //  has no circles on it until an upgrade puts one there.
            const heat = this.scene.add.rectangle(0, -len + 8, halfW * 0.9, 4, this.edge, 0.9);
            root.add(heat);

            const flash = this.scene.add.image(0, -len - 4, 'spark');
            flash.setDisplaySize(100, 100).setTint(this.edge).setBlendMode('ADD').setAlpha(0);
            root.add(flash);

            this.bank.add(root);
            this.barrels.push({ root, flash, heat, len, order: order.indexOf(i) });
        }

        this.barrels.sort((a, b) => a.order - b.order);

        void flank;
    }

    /** Pods, vanes, loops and arc posts -- everything that hangs off the sides. */
    private buildFlanks (flank: number, recHalf: number, len: number): void
    {
        const L = this.look;

        //  Launcher pods, bolted to the receiver flanks.
        if (L.drum > 0)
        {
            const drum = this.group('drum', this.bank, 0, -6);
            const d = this.scene.add.graphics();
            const w = 16 + L.drum * 2.4;
            const h = 26 + L.drum * 2.6;

            for (const side of [ -1, 1 ])
            {
                const x = side * (recHalf + w * 0.5 - 8);

                this.plate(d, x - w / 2, -h / 2, w, h, 5, true);

                const ports = Math.min(4, 2 + Math.floor(L.drum / 2));

                for (let p = 0; p < ports; p++)
                {
                    const py = -h / 2 + 7 + p * ((h - 14) / Math.max(1, ports - 1));
                    d.fillStyle(LIT.drum, 0.3);
                    d.fillRoundedRect(x - 5.5, py - 3, 11, 6, 3);
                    d.fillStyle(LIT.drum, 0.95);
                    d.fillRoundedRect(x - 4, py - 1.75, 8, 3.5, 1.75);
                }
            }

            drum.add(d);

            //  Blast slits the pods with vent slats and widens their throat.
            if (L.blast > 0)
            {
                const bl = this.group('blast', this.bank, 0, -6);
                const b = this.scene.add.graphics();
                const slats = Math.min(4, 1 + Math.round(L.blast * 0.6));

                for (const side of [ -1, 1 ])
                {
                    const x = side * (recHalf + w - 12);

                    for (let p = 0; p < slats; p++)
                    {
                        const py = -h / 2 + 6 + p * 8;
                        this.plate(b, side > 0 ? x - 2 : x - 8, py, 10, 5, 2, true);
                        this.slot(b, side > 0 ? x + 1 : x - 5, py + 1.5, 4, 2, LIT.blast);
                    }
                }

                bl.add(b);
            }
        }

        //  Targeting vanes: thin blades off the receiver's top corners, swept
        //  forward past the muzzles. Crit's whole silhouette contribution.
        if (L.scope > 0)
        {
            const scope = this.group('scope', this.bank, 0, 0);
            const s = this.scene.add.graphics();
            //  Sized off the crit stacks, not off the barrel: one point of crit
            //  should be a small fin, not a wing twice the length of the gun.
            const reach = 16 + Math.min(42, L.scope * 4.5);

            for (const side of [ -1, 1 ])
            {
                //  Swept outward as well as up, and mounted clear of the outer
                //  barrel, so the vanes read as the gun's wings instead of
                //  crossing the barrels they sit next to.
                const x = side * (flank + 9);
                const tipX = x + side * reach * 0.55;
                const tipY = -14 - reach;

                s.fillStyle(this.hullLit, 1);
                s.fillTriangle(x - side * 6, -14, x + side * 6, -4, tipX, tipY);
                s.lineStyle(2.5, this.edge, 0.85);
                s.strokeTriangle(x - side * 6, -14, x + side * 6, -4, tipX, tipY);
                this.slot(s, tipX - side * 5 - 1.5, tipY + 5, 3, Math.min(11, 4 + reach * 0.14), LIT.scope);
            }

            scope.add(s);

            //  Perfect mounts its emitter on the vanes it already paid for.
            if (L.laser > 0)
            {
                const las = this.group('laser', this.bank, 0, 0);
                const e = this.scene.add.graphics();

                this.plate(e, -8, -34 - reach * 0.3, 16, 13, 4, true);
                this.slot(e, -4, -30 - reach * 0.3, 8, 3, LIT.laser);
                las.add(e);
            }
        }

        //  Collector loops: wide arcs sweeping out and forward, low on the
        //  flanks so they never fight the vanes above them.
        if (L.magnet > 0)
        {
            const mag = this.group('magnet', this.bank, 0, 0);
            const m = this.scene.add.graphics();
            const reach = 10 + L.magnet * 3;

            for (const side of [ -1, 1 ])
            {
                const x = side * (recHalf - 4);

                m.lineStyle(9, this.hullLit, 1);
                m.beginPath();
                m.moveTo(x, 6);
                m.lineTo(x + side * reach, -10);
                m.lineTo(x + side * (reach - 3), -34);
                m.strokePath();

                m.lineStyle(2.5, this.edge, 0.8);
                m.beginPath();
                m.moveTo(x, 6);
                m.lineTo(x + side * reach, -10);
                m.lineTo(x + side * (reach - 3), -34);
                m.strokePath();

                this.slot(m, x + side * (reach - 3) - 3, -40, 6, 4, LIT.magnet);
            }

            mag.add(m);
        }

        //  Arc posts at the muzzle line. The lightning between them is redrawn
        //  every frame, so the gun crackles between shots.
        if (L.coils > 0)
        {
            const coils = this.group('coils', this.bank, 0, -len - 16);
            const c = this.scene.add.graphics();
            const reach = flank + 10 + L.coils * 3;

            for (const side of [ -1, 1 ])
            {
                const x = side * reach;

                this.plate(c, x - 6, -14, 12, 26, 4, true);
                c.fillStyle(LIT.coils, 0.3);
                c.fillCircle(x, -16, 7);
                c.fillStyle(LIT.coils, 1);
                c.fillCircle(x, -16, 4);
            }

            coils.add(c);

            this.coilReach = reach;
            this.coilGfx = this.scene.add.graphics();
            coils.add(this.coilGfx);
        }
    }

    /** The receiver's lower face: core window and charge cells. */
    private buildFace (recHalf: number, flank: number, faceY: number): void
    {
        const L = this.look;

        if (L.gem > 0)
        {
            const gem = this.group('gem', this.bank, 0, faceY + 4);
            const g = this.scene.add.graphics();
            const w = 14 + Math.min(20, L.gem * 2.2);

            this.plate(g, -w / 2, -8, w, 16, 5, true);
            g.fillStyle(LIT.gem, 0.35);
            g.fillRoundedRect(-w / 2 + 3, -5, w - 6, 10, 5);
            g.fillStyle(mix(LIT.gem, 0x6cf5c8, Math.min(0.5, L.gem * 0.06)), 0.95);
            g.fillRoundedRect(-w / 2 + 5, -3.5, w - 10, 7, 3.5);
            gem.add(g);
            this.gemArt = gem;
        }

        if (L.cells > 0)
        {
            const cellArt = this.group('cells', this.bank, 0, faceY + 4);
            const count = Math.min(12, 2 + Math.round(L.cells * 0.8));
            const inner = 12 + Math.min(24, L.gem * 2.4);

            this.cellSlots = [];

            for (let i = 0; i < count; i++)
            {
                const side = i % 2 === 0 ? -1 : 1;
                const step = Math.floor(i / 2);
                const x = side * Math.min(recHalf - 8, inner + 5 + step * 9);

                this.cellSlots.push({ x, y: 0 });
            }

            this.cellGfx = this.scene.add.graphics();
            cellArt.add(this.cellGfx);
        }

        void flank;
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
            const lx = b.root.x;
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
        this.scene.tweens.add({ targets: this.glow, alpha: 0.12, duration: 520, ease: 'Quad.out' });

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
    }

    /** Charge cells lighting up in a wave out from the core. */
    private drawCells (time: number): void
    {
        const g = this.cellGfx!;

        g.clear();

        for (let i = 0; i < this.cellSlots.length; i++)
        {
            const c = this.cellSlots[i];
            const pulse = 0.45 + 0.55 * Math.max(0, Math.sin(time * 0.004 - Math.floor(i / 2) * 0.5));

            g.fillStyle(this.accent2, 0.22 * pulse);
            g.fillRoundedRect(c.x - 3.5, c.y - 6, 7, 12, 3.5);
            g.fillStyle(this.accent2, 0.55 + 0.4 * pulse);
            g.fillRoundedRect(c.x - 2, c.y - 4.5, 4, 9, 2);
        }
    }

    /** Electric arc snapping between the arc posts. */
    private drawCoils (time: number): void
    {
        const g = this.coilGfx!;
        const reach = this.coilReach;

        g.clear();

        const steps = 6;
        const amp = 5 + this.look.coils + this.heatLevel * 8;

        g.lineStyle(2.5, LIT.coils, 0.5 + this.heatLevel * 0.45);
        g.beginPath();
        g.moveTo(-reach, -16);

        for (let i = 1; i <= steps; i++)
        {
            const t = i / steps;
            const jitter = i === steps ? 0 : Math.sin(time * 0.02 + i * 2.1) * amp;
            g.lineTo(-reach + t * reach * 2, -16 + jitter);
        }

        g.strokePath();
    }

    /** Gyro collar: dashes riding a squashed circle, front ones drawn fatter. */
    private drawChrono (time: number): void
    {
        const g = this.chronoGfx!;
        const rx = this.chronoRx;
        const ry = rx * 0.26;
        const phase = time * 0.0022;
        const dashes = 8;

        g.clear();

        //  The collar itself, so the moving lights are riding a real part of
        //  the gun rather than floating over the barrels.
        g.lineStyle(3, this.edge, 0.5);
        g.beginPath();

        for (let i = 0; i <= 40; i++)
        {
            const a = (i / 40) * TAU;
            const x = Math.cos(a) * rx;
            const y = Math.sin(a) * ry;
            i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }

        g.strokePath();

        for (let i = 0; i < dashes; i++)
        {
            const a = phase + (i / dashes) * TAU;
            const depth = (Math.sin(a) + 1) / 2;

            g.fillStyle(LIT.chrono, 0.25 + depth * 0.65);
            g.fillCircle(Math.cos(a) * rx, Math.sin(a) * ry, 1.4 + depth * 1.9);
        }
    }

    /** A thin sight line up the arena from the primary muzzle. */
    private drawLaser (): void
    {
        const g = this.laserGfx!;
        const reach = 1200;
        const a = this.rig.rotation - Math.PI / 2;

        g.clear();
        g.lineStyle(1.5 + this.look.laser * 0.2, LIT.laser, 0.16 + this.look.laser * 0.05);
        g.lineBetween(this.tipX, this.tipY, this.tipX + Math.cos(a) * reach, this.tipY + Math.sin(a) * reach);

        //  A dot where the sight crosses the top of the playfield reads as the
        //  gun actually pointing at something.
        const t = (PLAY.top - this.tipY) / (Math.sin(a) * reach);

        if (t > 0 && t < 1)
        {
            g.fillStyle(LIT.laser, 0.5);
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
