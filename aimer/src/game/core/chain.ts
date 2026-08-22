import { GameObjects, Scene } from 'phaser';
import type { Target } from '../objects/Target';
import { FONT, Tier, mix } from './theme';
import { Sfx } from './audio';

/**
 * A run of targets welded together, breakable in one order only.
 *
 * Everything else in this game rewards the fastest answer to "what is nearest
 * to my cursor". A chain refuses that question. Only the head of the chain can
 * be hurt; the rest are bolted shut, and a shot into a locked link is turned
 * away without a scratch. The player has to *read the board* -- find the one,
 * follow the line, take them in sequence -- and every second spent reading is
 * a second the rest of the level keeps running.
 *
 * The links stay whatever kind they rolled, so a chain can be three plain
 * targets or it can put the armoured one last and make the player earn the
 * pace they wanted. They never contain a bomb: a link the player is *forced*
 * to shoot, that punishes them for shooting it, would be a trap rather than a
 * puzzle.
 *
 * The chain owns nothing but its own drawing. It does not kill, score, or
 * spawn -- the scene does all of that, exactly as it does for a lone target,
 * and simply asks the chain who is allowed to be hit.
 */

const TAU = Math.PI * 2;

export class Chain
{
    /** Every link, in the order they must be broken. Emptied as they go. */
    readonly members: Target[];
    /** How long the chain was when it arrived, for the completion bonus. */
    readonly length: number;

    private gfx: GameObjects.Graphics;
    private labels: GameObjects.Text[];
    private accent: number;
    private steel: number;
    private pulse = 0;

    constructor (scene: Scene, tier: Tier, members: Target[])
    {
        this.members = members.slice();
        this.length = members.length;

        this.accent = mix(tier.accent, 0xffffff, 0.25);
        this.steel = 0x8fa4c8;

        this.gfx = scene.add.graphics().setDepth(11);
        this.labels = [];

        members.forEach((t, i) =>
        {
            t.chain = this;
            t.chainIndex = i;
            t.chainLocked = i > 0;

            const label = scene.add.text(t.x, t.y, String(i + 1), {
                fontFamily: FONT,
                fontSize: 22,
                color: '#ffffff'
            //  Under the concrete, over everything else. A slab that hides a
            //  target has to hide its number too, or the player is being told
            //  where something is by the very thing that is hiding it.
            }).setOrigin(0.5).setDepth(12);

            this.labels.push(label);
        });
    }

    /** The one link that can currently be hurt. */
    get head (): Target | null
    {
        return this.members.length > 0 ? this.members[0] : null;
    }

    get done (): boolean
    {
        return this.members.length === 0;
    }

    /**
     * A link left the board, however it left -- shot, expired, or fallen
     * through the floor. The next one up arms itself.
     *
     * Only the head unlocks anything. A link that expired out of turn (a
     * middle one whose clock ran out while the player was still on the first)
     * is simply dropped, and the order closes up around the gap.
     */
    release (t: Target): void
    {
        const i = this.members.indexOf(t);

        if (i === -1) return;

        this.members.splice(i, 1);
        this.labels[i]?.destroy();
        this.labels.splice(i, 1);

        t.chain = null;
        t.chainLocked = false;

        const next = this.head;

        if (!next || !next.chainLocked) return;

        next.chainLocked = false;
        this.pulse = 1;

        //  The next link snaps open where the player is already looking.
        next.scene.tweens.add({
            targets: next,
            scaleX: 1.24,
            scaleY: 1.24,
            duration: 110,
            yoyo: true,
            ease: 'Quad.out'
        });

        Sfx.unlock();
    }

    update (dtMs: number): void
    {
        if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dtMs / 340);

        const g = this.gfx;
        g.clear();

        if (this.members.length === 0) return;

        const t = (this.members[0].scene.time.now || 0) * 0.006;

        //  The link line. It runs through the whole chain in order, so "which
        //  one is next" is answered by following a rope and not by comparing
        //  two numbers.
        for (let i = 0; i < this.members.length - 1; i++)
        {
            const a = this.members[i];
            const b = this.members[i + 1];

            g.lineStyle(5, 0x05070f, 0.55);
            g.lineBetween(a.x, a.y, b.x, b.y);

            g.lineStyle(2.5, this.steel, 0.7);
            g.lineBetween(a.x, a.y, b.x, b.y);

            //  Links along the rope, crawling towards the head, so the line
            //  points at the thing the player is supposed to shoot next.
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const beads = Math.max(2, Math.floor(len / 22));
            const crawl = (t * 0.2) % 1;

            for (let k = 0; k < beads; k++)
            {
                const f = (k + crawl) / beads;

                g.fillStyle(this.steel, 0.85);
                g.fillCircle(a.x + dx * f, a.y + dy * f, 3.2);
            }
        }

        for (let i = 0; i < this.members.length; i++)
        {
            const m = this.members[i];
            const label = this.labels[i];
            const r = m.radius;

            if (label)
            {
                label.setPosition(m.x, m.y - r - 16);
                label.setFontSize(Math.max(16, Math.round(r * 0.85)));
            }

            if (i === 0)
            {
                //  The head: lit, ringed, and pulsing for a beat after it was
                //  unlocked. Nothing else on the board looks like this.
                const beat = 1 + Math.sin(t * 2) * 0.06 + this.pulse * 0.3;

                g.lineStyle(4, this.accent, 0.9);
                g.strokeCircle(m.x, m.y, (r + 15) * beat);

                g.lineStyle(2, 0xffffff, 0.5 + this.pulse * 0.5);
                g.strokeCircle(m.x, m.y, (r + 21) * beat);

                if (label) label.setColor('#ffffff').setAlpha(1);

                continue;
            }

            //  A locked link: shuttered behind a dark scrim, with a steel
            //  collar and its number greyed out. It is plainly still there and
            //  plainly not available, which is the whole message.
            g.fillStyle(0x05070f, 0.5);
            g.fillCircle(m.x, m.y, r * 1.06);

            g.lineStyle(5, this.steel, 0.85);
            g.strokeCircle(m.x, m.y, r + 11);

            //  Four bolts around the collar.
            for (let k = 0; k < 4; k++)
            {
                const a = TAU * (k / 4) + 0.4;

                g.fillStyle(mix(this.steel, 0xffffff, 0.3), 0.9);
                g.fillCircle(m.x + Math.cos(a) * (r + 11), m.y + Math.sin(a) * (r + 11), 4);
            }

            if (label) label.setColor('#9fb0d0').setAlpha(0.8);
        }
    }

    destroy (): void
    {
        for (const m of this.members)
        {
            m.chain = null;
            m.chainLocked = false;
        }

        this.members.length = 0;

        for (const l of this.labels) l.destroy();

        this.labels.length = 0;
        this.gfx.destroy();
    }
}
