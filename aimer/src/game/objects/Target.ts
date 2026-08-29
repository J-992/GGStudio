import { GameObjects, Scene, Tweens } from 'phaser';
import { KINDS, KindDef, TargetKind, unitHp } from '../data/levels';
import { PLAY, FONT } from '../core/theme';
import { ic } from '../core/icons';
import { BodyShape, MARK_FIT, fillBody, strokeBody } from '../core/shapes';
import { sa } from '../core/skinart';
import { TrailId, trailInterval } from '../core/trails';
import type { Skin, TargetStyle } from '../data/skins';
import type { Chain } from '../core/chain';
import type { AbilityId } from '../core/abilities';

const TAU = Math.PI * 2;

export type { Skin, TargetStyle };

export class Target extends GameObjects.Container
{
    kind: TargetKind;
    def: KindDef;
    radius: number;
    /** The radius this one was built at. `setBulk` is measured against it. */
    readonly baseRadius: number;
    hp: number;
    maxHp: number;
    vx = 0;
    vy = 0;
    life: number;
    maxLife: number;
    dead = false;
    expired = false;

    //  ---- zone rules. All inert at zero, so a plain target costs nothing. ----

    /** Life remaining, in ms, at which this target warps somewhere else. */
    warpAt = -1;
    /** When set, the target keeps warping this often instead of warping once. */
    warpEvery = 0;
    /**
     * Dropped from the ceiling rather than parked. A falling target ignores the
     * floor -- passing it is how it dies -- and the fall is its whole timer.
     */
    falling = false;
    /** Half-width of the shield plate in radians. Zero means no shield. */
    shieldArc = 0;
    /** Where the plate is facing, and how fast it is turning (rad/sec). */
    shieldAngle = 0;
    shieldSpin = 0;
    /** Set on the halves a split leaves behind, so they cannot split again. */
    noSplit = false;
    /**
     * This target answers to its boss fight and to nothing else.
     *
     * The world's rule moves the board every frame -- the crosswind drags, the
     * reactor turns, the cavern blinks -- and a body that is being moved by its
     * own fight cannot also be moved by the weather, or the two fight each
     * other and the weather wins. It used to be enough to ask whether the kind
     * was `boss`, right up until a fight was built out of nine ordinary
     * targets welded together: the skyline's wind pushed all nine of the
     * serpent's links into the right-hand wall and held them there.
     */
    warded = false;
    /**
     * Nothing kills this one.
     *
     * The spam round's drum takes an unlimited number of taps and pays for
     * every one of them, so its health is not a small number -- it is not a
     * number at all, and modelling it as one would have meant either a fake
     * ceiling the player could hit by accident or an integer quietly counting
     * down towards a bug. `damage` simply refuses instead.
     */
    endless = false;
    /**
     * The ordered chain this target is welded into, and where in it it sits.
     *
     * A locked link refuses every shot -- the player's, a wingman's, a lance
     * running through it -- until the link in front of it is gone. The flag is
     * held here rather than asked of the chain every frame because the shot
     * path checks it on every target it touches, several times a tap.
     */
    chain: Chain | null = null;
    chainIndex = 0;
    chainLocked = false;
    /**
     * What this kill is worth towards the level goal. Normally the kind's own
     * value; the halves a split leaves behind are worth nothing, so the rule
     * pays in score and combo without quietly halving every goal in its zone.
     */
    progressWorth: number;

    /** The colours this one is actually painted in. */
    readonly color: number;
    readonly ringColor: number;

    /**
     * The body is drawn with graphics rather than a stack of arcs, because a
     * skin is allowed to change the silhouette and not only the colour -- and
     * a hexagon is a path, not a circle with a different radius.
     *
     * Each piece is pathed once, at construction, and animated after that by
     * scale, rotation and alpha alone. A target that re-pathed its outline
     * every frame would put the whole skin system on the per-frame budget, and
     * a late level has thirty of these on screen at once.
     */
    private halo: GameObjects.Graphics;
    private art: GameObjects.Graphics;
    private flash: GameObjects.Graphics;
    private mark: GameObjects.Image | null = null;
    /** The plating line on a target that takes more than one shot. */
    private band: GameObjects.Graphics | null = null;
    private label: GameObjects.Text | null = null;
    private ring: GameObjects.Graphics;
    private phase: number;
    private flashAmount = 0;

    /** The blink currently in flight, so a repeat warp can drop it. */
    private warpTween: Tweens.Tween | null = null;

    private shape: BodyShape;
    private spin: number;
    private glowMult: number;
    private rot = 0;

    /** The face or flag painted over the body, when the skin carries one. */
    private decal: GameObjects.Image | null = null;
    /**
     * The scale that fits the decal's texture to the body. Kept because the
     * pulse below multiplies it: calling setScale with the pulse alone would
     * throw away the fit and draw the face at its full texture size.
     */
    private decalFit = 1;

    /** The ability this orb hands over when it breaks, if it is one. */
    ability: AbilityId | null = null;

    /** The wake this target drags, and the countdown to its next puff. */
    trail: TrailId | null;
    private trailTimer = 0;

    constructor (scene: Scene, x: number, y: number, kind: TargetKind, baseSize: number, level: number, speed: number, moving: boolean, skin?: Skin, style?: TargetStyle)
    {
        super(scene, x, y);

        this.kind = kind;
        this.def = KINDS[kind];
        this.color = skin ? skin.color : this.def.color;
        this.ringColor = skin ? skin.ring : this.def.ring;
        this.radius = baseSize * this.def.sizeMult;
        this.baseRadius = this.radius;
        this.maxHp = unitHp(level) * this.def.units;
        this.hp = this.maxHp;
        this.progressWorth = this.def.progress;
        this.phase = Math.random() * TAU;

        this.maxLife = 0;
        this.life = 0;

        const r = this.radius;

        this.shape = style ? style.shape : 'circle';
        this.spin = style ? style.spin : 0;
        this.glowMult = style ? style.glow : 1;
        this.rot = this.spin !== 0 ? Math.random() * TAU : 0;
        this.trail = style && style.trail ? style.trail : null;

        //  Staggered, so twenty targets sharing a skin do not all puff on the
        //  same frame and pulse the whole board in time.
        this.trailTimer = this.trail ? Math.random() * trailInterval(this.trail) : 0;

        this.halo = scene.add.graphics();
        this.halo.fillStyle(this.color, 1);
        this.halo.fillCircle(0, 0, r * 1.55);
        this.halo.setAlpha(0.16 * this.glowMult);

        //  A decal that failed to download is simply not worn: the target
        //  falls back to a plain painted body rather than to Phaser's missing
        //  texture, so a 404 on a cosmetic can never cost the player a level.
        const wanted = style && style.art ? style.art : null;
        const face = wanted && scene.textures.exists(sa(wanted)) ? wanted : null;

        this.art = scene.add.graphics();
        this.art.fillStyle(this.color, 1);
        fillBody(this.art, this.shape, r, 0);

        //  A face covers the body, so the dark core that gives a plain target
        //  its depth would only be drawn over -- and the edge light has to go
        //  on last, on top of the decal, or the target loses its outline.
        if (!face)
        {
            this.art.lineStyle(Math.max(2, r * 0.09), 0xffffff, 0.65);
            strokeBody(this.art, this.shape, r, 0);
            this.art.fillStyle(0x000000, 0.28);
            fillBody(this.art, this.shape, r * 0.46, 0);
        }

        this.art.setRotation(this.rot);

        this.flash = scene.add.graphics();
        this.flash.fillStyle(0xffffff, 1);
        fillBody(this.flash, this.shape, r, 0);
        this.flash.setAlpha(0);

        this.ring = scene.add.graphics();

        this.add([ this.halo, this.art ]);

        if (face)
        {
            this.decal = scene.add.image(0, 0, sa(face));
            this.decal.setDisplaySize(r * 2, r * 2);
            this.decalFit = this.decal.scaleX;
            this.add(this.decal);

            //  The outline, restored over the top of the face.
            const edge = scene.add.graphics();
            edge.lineStyle(Math.max(2, r * 0.09), 0xffffff, 0.65);
            strokeBody(edge, this.shape, r, 0);
            this.add(edge);
        }

        //  Armour, said with one line.
        //
        //  A target that takes two shots used to say so by being painted a
        //  darker, duller version of the ordinary one -- which reads as
        //  *disabled*, not as *armoured*: the first thing a dimmed object says
        //  in any game is "you cannot interact with me". So the paint is the
        //  world's own colour at full strength now, and the plating is a
        //  single ring set inside the edge instead. It follows whatever
        //  silhouette the skin is wearing and turns with it.
        if (this.def.units > 1)
        {
            this.band = scene.add.graphics();
            this.band.lineStyle(Math.max(2, r * 0.075), 0xffffff, 0.5);
            strokeBody(this.band, this.shape, r * 0.72, 0);
            this.band.setRotation(this.rot);
            this.add(this.band);
        }

        this.add([ this.flash, this.ring ]);

        if (this.def.icon)
        {
            //  Sized to the largest square the silhouette can actually hold,
            //  so a star's glyph does not hang off its arms.
            const fit = r * 1.05 * MARK_FIT[this.shape];

            this.mark = scene.add.image(0, 0, ic(this.def.icon));
            this.mark.setDisplaySize(fit, fit);
            this.mark.setTint(0x0a1024);
            this.mark.setAlpha(0.9);
            this.add(this.mark);
        }

        if (this.def.units > 1)
        {
            this.label = scene.add.text(0, 0, '', {
                fontFamily: FONT,
                fontSize: Math.round(r * 0.8 * MARK_FIT[this.shape]),
                color: '#0b0f22'
            }).setOrigin(0.5);

            this.add(this.label);
            this.updateLabel();
        }

        if (moving && speed > 0)
        {
            const a = Math.random() * TAU;
            const s = speed * this.def.speedMult;
            this.vx = Math.cos(a) * s;
            this.vy = Math.sin(a) * s;
        }

        this.setScale(0.1);
        scene.tweens.add({ targets: this, scale: 1, duration: 190, ease: 'Back.out' });
        scene.add.existing(this);
    }

    /**
     * Re-scales this target's health after construction, keeping it full.
     *
     * Only the boss uses it: how much a boss is carrying is a property of the
     * *level* rather than of the kind (see `bossUnits`), and the kind table has
     * nowhere to say "more on level 40 than on level 20".
     */
    setUnits (units: number, level: number): this
    {
        this.def = { ...this.def, units };
        this.maxHp = unitHp(level) * units;
        this.hp = this.maxHp;
        this.updateLabel();

        return this;
    }

    /**
     * Permanently resize the body to `f` of what it was built at -- hit box,
     * life ring and all.
     *
     * The art is pathed once at construction and animated by scale alone (see
     * the note on the fields above), so a lasting size change is a scale on the
     * container and a new `radius` for everything that measures the target
     * rather than draws it. It lands as a flinch that settles into the smaller
     * size, and it takes the tweens with it: the hit-squash that `damage` has
     * usually just started would otherwise finish by yoyoing the body back to
     * the size it was before the hit.
     */
    setBulk (f: number): void
    {
        this.radius = this.baseRadius * f;

        this.scene.tweens.killTweensOf(this);
        this.setScale(f * 1.14);
        this.scene.tweens.add({ targets: this, scale: f, duration: 160, ease: 'Back.out' });
    }

    /**
     * Extra dressing laid over the body after construction. The hit flash and
     * the life ring are raised back over it, so a dressed target still blinks
     * when it is hit and still shows its clock.
     */
    wear (parts: GameObjects.GameObject[]): void
    {
        this.add(parts);
        this.bringToTop(this.flash);
        this.bringToTop(this.ring);
    }

    setLifetime (ms: number): this
    {
        this.maxLife = ms;
        this.life = ms;
        return this;
    }

    /** True when the target died from this hit. */
    damage (amount: number): boolean
    {
        if (this.endless)
        {
            this.flashAmount = 1;
            return false;
        }

        this.hp -= amount;
        this.flashAmount = 1;

        if (this.hp <= 0)
        {
            this.dead = true;
            return true;
        }

        this.updateLabel();
        this.scene.tweens.add({ targets: this, scaleX: 0.84, scaleY: 0.84, duration: 60, yoyo: true, ease: 'Quad.out' });

        return false;
    }

    private updateLabel (): void
    {
        if (!this.label) return;

        this.label.setText(String(Math.max(1, Math.ceil(this.hp / (this.maxHp / this.def.units)))));
    }

    update (dtMs: number, slow: number): void
    {
        const dt = dtMs / 1000;

        if (this.vx !== 0 || this.vy !== 0)
        {
            this.x += this.vx * slow * dt;
            this.y += this.vy * slow * dt;

            const r = this.radius;

            if (this.x < PLAY.left + r) { this.x = PLAY.left + r; this.vx = Math.abs(this.vx); }
            else if (this.x > PLAY.right - r) { this.x = PLAY.right - r; this.vx = -Math.abs(this.vx); }

            if (!this.falling)
            {
                if (this.y < PLAY.top + r) { this.y = PLAY.top + r; this.vy = Math.abs(this.vy); }
                else if (this.y > PLAY.bottom - r) { this.y = PLAY.bottom - r; this.vy = -Math.abs(this.vy); }
            }
        }

        this.life -= dtMs;

        if (this.trail) this.trailTimer -= dtMs;

        const t = this.scene.time.now;
        const pulse = 1 + Math.sin(t * 0.006 + this.phase) * 0.055;
        const halo = pulse * (1 + Math.sin(t * 0.004 + this.phase) * 0.08);

        if (this.spin !== 0) this.rot += this.spin * dt;

        if (this.flashAmount > 0)
        {
            this.flashAmount = Math.max(0, this.flashAmount - dtMs / 130);
        }

        const frac = this.maxLife > 0 ? Math.max(0, this.life / this.maxLife) : 1;
        const urgent = frac < 0.32;

        //  A target on its last third breathes harder -- the same warning the
        //  life ring gives, in the one part of the target already in the
        //  player's eye.
        const glow = (urgent ? 0.16 + Math.abs(Math.sin(t * 0.02)) * 0.28 : 0.16) * this.glowMult;

        this.halo.setScale(halo);
        this.halo.setAlpha(Math.min(0.62, glow));

        this.art.setScale(pulse);
        this.flash.setScale(pulse);
        if (this.decal) this.decal.setScale(this.decalFit * pulse);

        if (this.spin !== 0)
        {
            this.art.setRotation(this.rot);
            this.flash.setRotation(this.rot);
            this.band?.setRotation(this.rot);
        }

        this.flash.setAlpha(this.flashAmount * 0.85);

        this.ring.clear();
        this.ring.lineStyle(Math.max(3, this.radius * 0.13), urgent ? 0xff4d5e : this.ringColor, urgent ? 0.95 : 0.55);
        this.ring.beginPath();
        this.ring.arc(0, 0, this.radius + Math.max(6, this.radius * 0.22), -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        this.ring.strokePath();

        if (this.shieldArc > 0)
        {
            this.shieldAngle += this.shieldSpin * dt;
            this.drawShield();
        }
    }

    /**
     * The shield plate: a hard steel arc riding round the target. It is drawn
     * outside the life ring and lit from the inside so it reads as armour
     * rather than as more progress, and it is the only part of the target that
     * says "not from that side" -- which is the whole rule of its zone.
     */
    private drawShield (): void
    {
        const g = this.ring;
        const r = this.radius + Math.max(11, this.radius * 0.38);
        const a0 = this.shieldAngle - this.shieldArc;
        const a1 = this.shieldAngle + this.shieldArc;

        g.lineStyle(Math.max(6, this.radius * 0.26), 0x0a1024, 1);
        g.beginPath();
        g.arc(0, 0, r, a0, a1);
        g.strokePath();

        g.lineStyle(Math.max(4, this.radius * 0.17), 0xd8e4ff, 0.95);
        g.beginPath();
        g.arc(0, 0, r, a0, a1);
        g.strokePath();

        //  Bolts at both ends, so the plate has a start and a finish.
        for (const a of [ a0, a1 ])
        {
            g.fillStyle(0x8fa4c8, 1);
            g.fillCircle(Math.cos(a) * r, Math.sin(a) * r, Math.max(3, this.radius * 0.1));
        }
    }

    /** True when a shot arriving from `angle` (world radians) hits the plate. */
    shielded (angle: number): boolean
    {
        if (this.shieldArc <= 0) return false;

        let d = angle - this.shieldAngle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;

        return Math.abs(d) <= this.shieldArc;
    }

    /** Where a shot arriving from `angle` actually meets the plate. */
    plateAt (angle: number): { x: number; y: number }
    {
        const r = this.radius + Math.max(11, this.radius * 0.38);
        return { x: this.x + Math.cos(angle) * r, y: this.y + Math.sin(angle) * r };
    }

    /** The kick a blocked shot puts through the target. */
    clang (angle: number): void
    {
        this.scene.tweens.add({
            targets: this,
            x: this.x - Math.cos(angle) * 7,
            y: this.y - Math.sin(angle) * 7,
            duration: 70,
            yoyo: true,
            ease: 'Quad.out'
        });
    }

    /** Blink out here, blink in there. Used by the warp zone. */
    warp (x: number, y: number): void
    {
        //  A cavern deep enough books the next warp on the way out of this one.
        this.warpAt = this.warpEvery > 0 ? this.life - this.warpEvery : -1;

        //  Repeat warps can be booked faster than one blink takes to land. The
        //  older blink is abandoned rather than allowed to finish, so it cannot
        //  drop the target back at a spot the newer one has already left.
        this.warpTween?.remove();

        this.warpTween = this.scene.tweens.add({
            targets: this,
            scaleX: 0.05,
            scaleY: 1.25,
            duration: 110,
            ease: 'Quad.in',
            onComplete: () =>
            {
                //  Shot down mid-blink: the target is already gone by the time
                //  the squash lands, and there is nothing left to blink back in.
                if (!this.scene) return;

                this.warpTween = null;
                this.setPosition(x, y);
                this.scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: 170, ease: 'Back.out' });
            }
        });
    }

    /** Squared distance test against a tap, with the player's tap-forgiveness applied. */
    contains (px: number, py: number, forgiveness: number): boolean
    {
        const r = this.radius * forgiveness + 6;
        const dx = px - this.x;
        const dy = py - this.y;
        return dx * dx + dy * dy <= r * r;
    }

    /**
     * True once per trail interval -- the scene asks, and the answer rearms
     * the clock. Keeps the emitter pool in the scene and the pacing here.
     */
    takeTrailPuff (): boolean
    {
        if (!this.trail || this.trailTimer > 0) return false;

        this.trailTimer += trailInterval(this.trail);
        return true;
    }

    /** True when a falling target has gone through the floor. */
    get gone (): boolean
    {
        return this.falling && this.y > PLAY.bottom + this.radius;
    }

    distanceTo (px: number, py: number): number
    {
        return Math.hypot(px - this.x, py - this.y);
    }

    /**
     * A tween outlives the thing it animates. A popped target still holding a
     * blink, a clang or a hit-squash would otherwise keep being written to --
     * and the blink's callback would reach through a scene the destroy has
     * already cleared. Everything in flight leaves with the target.
     */
    destroy (fromScene?: boolean): void
    {
        this.warpTween = null;
        this.scene?.tweens?.killTweensOf(this);
        super.destroy(fromScene);
    }
}
