import { GameObjects, Scene } from 'phaser';
import { UPGRADE_BY_ID } from '../data/upgrades';
import { run } from '../core/state';
import { iconImage } from '../core/icons';
import { FONT, FONT_UI, hex } from '../core/theme';

/**
 * The build, on one line.
 *
 * A run is a build, and until now the only place a player could see theirs was
 * the three-card hand -- which shows what is on *offer*, tells you what you own
 * of that one part, and says nothing at all about the other eight things
 * bolted to the gun. The old upgrade screen had a YOUR BUILD strip along the
 * bottom and it was the single most-read thing on it; deleting the screen took
 * the strip with it by accident.
 *
 * This is that strip, as an object rather than a screen, so it can live in two
 * places at once: along the bottom of the play HUD, where it is the answer to
 * "what am I running", and along the bottom of the rank-up hand, where it is
 * the answer to "what does this card go with".
 *
 * One chip per part, in the order the parts were taken, each showing its stack
 * count. It never wraps and it never scrolls: past a certain length the chips
 * simply pack tighter, because a build strip that reflows is a build strip the
 * player has to re-read every time it changes.
 *
 * It runs either way. The rank-up hand reads it as a line under the cards; the
 * play HUD reads it as a rail up the left margin, because the bottom of the
 * play screen belongs to the gun -- which swings almost flat and is most of a
 * screen wide by the end of a run, so there is no strip of floor down there
 * that a horizontal row could have to itself.
 */

export interface BuildStripStyle
{
    /** Icon size, before any packing squeeze. */
    iconSize?: number;
    /** Gap between chip centres, before any packing squeeze. */
    spacing?: number;
    /** How long the strip may get, along its run, before chips pack tighter. */
    maxWidth: number;
    /**
     * Run the chips up the screen instead of across it, growing away from the
     * anchor rather than centring on it -- a rail that re-centred itself every
     * time a part was taken would move the whole build under the player's eye.
     */
    vertical?: boolean;
    /** A dark plate behind the row, for the strip that sits over the gun. */
    plate?: boolean;
    alpha?: number;
    /** A small caption above the row -- the old screen's "YOUR BUILD". */
    label?: string;
}

export class BuildStrip
{
    readonly root: GameObjects.Container;

    private scene: Scene;
    private style: Required<Omit<BuildStripStyle, 'label'>> & { label: string };
    /** What was drawn last, so an unchanged build never rebuilds. */
    private key = '';

    constructor (scene: Scene, x: number, y: number, style: BuildStripStyle)
    {
        this.scene = scene;
        this.style = {
            iconSize: style.iconSize ?? 20,
            spacing: style.spacing ?? 32,
            maxWidth: style.maxWidth,
            vertical: style.vertical ?? false,
            plate: style.plate ?? false,
            alpha: style.alpha ?? 1,
            label: style.label ?? ''
        };

        this.root = scene.add.container(x, y);
        this.root.setAlpha(this.style.alpha);

        this.refresh();
    }

    setDepth (d: number): this
    {
        this.root.setDepth(d);
        return this;
    }

    /** Redraws, but only when the build actually changed. */
    refresh (): void
    {
        const ids = Object.keys(run.taken).filter(id => !!UPGRADE_BY_ID[id]);
        const key = ids.map(id => `${id}:${run.taken[id]}`).join(',');

        if (key === this.key) return;

        this.key = key;
        this.root.removeAll(true);

        if (ids.length === 0)
        {
            this.root.setVisible(false);
            return;
        }

        this.root.setVisible(true);

        const s = this.style;

        //  Everything past the point where the row would run out of room is
        //  paid for by squeezing, not by hiding parts: a build with fourteen
        //  things on it is exactly the build the player most wants to see.
        const squeeze = Math.min(1, s.maxWidth / Math.max(1, ids.length * s.spacing));
        const step = s.spacing * squeeze;
        const size = Math.max(12, s.iconSize * Math.max(0.72, squeeze));

        //  Across: centred on the anchor. Up: growing off it.
        const start = s.vertical ? 0 : -((ids.length - 1) * step) / 2;
        const at = (i: number): { x: number; y: number } => (s.vertical
            ? { x: 0, y: start - i * step }
            : { x: start + i * step, y: 0 });

        if (s.plate)
        {
            //  A capsule around the run, whichever way the run goes.
            const thick = size + 20;
            const w = s.vertical ? thick : ids.length * step + 22;
            const h = s.vertical ? (ids.length - 1) * step + thick : thick;
            const y = s.vertical ? -(ids.length - 1) * step - thick / 2 : -h / 2;
            const g = this.scene.add.graphics();

            g.fillStyle(0x070b1a, 0.62);
            g.fillRoundedRect(-w / 2, y, w, h, Math.min(w, h) / 2);
            g.lineStyle(1.5, 0x2a3352, 0.7);
            g.strokeRoundedRect(-w / 2, y, w, h, Math.min(w, h) / 2);

            this.root.add(g);
        }

        if (s.label)
        {
            this.root.add(this.scene.add.text(0, -(size / 2) - 22, s.label, {
                fontFamily: FONT_UI, fontSize: 14, color: '#5f6a92'
            }).setOrigin(0.5));
        }

        ids.forEach((id, i) =>
        {
            const up = UPGRADE_BY_ID[id];
            const p = at(i);
            const n = run.taken[id];

            this.root.add(iconImage(this.scene, p.x, p.y, up.icon, { size, color: up.color }));

            //  The count only appears once there is one to make: a lone "1"
            //  under every chip is noise on a line that has to be read fast.
            if (n > 1)
            {
                this.root.add(this.scene.add.text(p.x + size * 0.5, p.y + size * 0.44, String(n), {
                    fontFamily: FONT, fontSize: Math.max(11, Math.round(size * 0.6)), color: hex(up.color),
                    stroke: '#04060f', strokeThickness: 3
                }).setOrigin(0.5));
            }
        });
    }

    destroy (): void
    {
        this.root.destroy();
    }
}
