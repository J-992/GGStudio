import { GameObjects, Geom, Scene } from 'phaser';
import { Fx } from '../core/fx';
import { Sfx, unlockAudio } from '../core/audio';
import { IconLabel, iconImage } from '../core/icons';
import { fillBody, strokeBody } from '../core/shapes';
import { BOOSTS, Boost } from '../data/boosts';
import { SKINS, TargetSkin } from '../data/skins';
import { sa } from '../core/skinart';
import {
    PERKS, Perk, boostCount, buyBoost, buySkin, equipSkin, equippedSkin,
    grantBoost, grantSkin, meta, ownsSkin, perkCost, saveMeta
} from '../core/state';
import { offerUnlock, skinUnlocked } from './StoreModal';
import { FONT, FONT_UI, fmt, hex, mix } from '../core/theme';

/**
 * The store.
 *
 * It sells three different kinds of thing and it is one panel, because a
 * player with coins in their pocket should never have to go looking for the
 * shelf they want: the tabs are the shelves, they are all one tap apart, and
 * every row on every shelf reads the same way -- what it is, what it does,
 * what it costs, and whether it is already theirs.
 *
 *   UPGRADES  permanent perks, bought once and kept for ever.
 *   BOOSTS    consumables for a single run (see data/boosts).
 *   SKINS     what the targets are cut and painted like (see data/skins).
 */

export interface StoreLayout
{
    /** Centre line of the column the store lives in. */
    x: number;
    /** The title and coin balance line. */
    headerY: number;
    tabsY: number;
    /** Centre of the first row, and the gap to the next. */
    rowY0: number;
    rowStep: number;
    rowW: number;
    rowH: number;
    /**
     * How many rows of skins one page of the wardrobe holds.
     *
     * A wide screen gives the store a column of its own and can afford four;
     * a phone is showing the store *under* the whole menu, so it gets two and
     * pages more often. Four rows of tiles down there read as the store having
     * taken the screen over.
     */
    gridRows: number;
    /** Bottom of the shelf. The skin grid pages itself to fit inside it. */
    listBottom: number;
}

/** The skin grid. Four across is the widest that keeps a name legible. */
const GRID_COLS = 4;
/** Room reserved under the grid for the pager. */
const PAGER_H = 36;
/** How tall a tile is allowed to get once the rows stop needing the room. */
const TILE_MAX_H = 128;

type TabId = 'perks' | 'boosts' | 'skins';

/**
 * Skins lead, and the store opens on them.
 *
 * The other two shelves are lists of numbers, and a player who has never
 * bought anything has no way to want a number. The wardrobe is a grid of
 * faces -- it is the only shelf that sells itself from across the room, and
 * the only one worth putting in front of somebody who has just arrived.
 */
const TABS: { id: TabId; label: string }[] = [
    { id: 'skins',  label: 'SKINS' },
    { id: 'perks',  label: 'UPGRADES' },
    { id: 'boosts', label: 'BOOSTS' }
];

/** Above the modal scrim in objects/StoreModal, so confetti lands on top. */
const MODAL_FX_DEPTH = 46;

const PANEL = 0x0b1024;
const IDLE_EDGE = 0x2a3352;
const AFFORD_EDGE = 0xffc857;
const DONE_EDGE = 0x6cf5c8;
const DIM = '#7d88b0';

export class StorePanel
{
    private scene: Scene;
    private fx: Fx;
    private L: StoreLayout;
    private onChange: () => void;
    /** Starts a run wearing what was just bought. Handed down by the menu. */
    private onPlay: () => void;

    private tab: TabId = 'skins';
    private coinLabel!: IconLabel;
    private tabButtons: { id: TabId; redraw: () => void }[] = [];
    private rows: GameObjects.Container[] = [];
    private redraws: (() => void)[] = [];
    private previews: { g: GameObjects.Graphics | null; skin: TargetSkin; rot: number; r: number }[] = [];
    private skinPage = 0;

    /**
     * A second effects layer, above the modal scrim. The panel's own `fx` sits
     * at the menu's depth and would fire its confetti *behind* the card that
     * is celebrating -- so the modals get their own, and it is ticked with the
     * rest of the panel.
     */
    private topFx: Fx;

    constructor (scene: Scene, fx: Fx, layout: StoreLayout, onChange: () => void, onPlay: () => void)
    {
        this.scene = scene;
        this.fx = fx;
        this.L = layout;
        this.onChange = onChange;
        this.onPlay = onPlay;
        this.topFx = new Fx(scene, MODAL_FX_DEPTH);

        this.buildHeader();
        this.buildTabs();
        this.deal();
    }

    //  --------------------------------------------------------------- chrome

    private buildHeader (): void
    {
        const { x, headerY, rowW } = this.L;

        this.scene.add.text(x - rowW / 2 + 4, headerY, 'STORE', {
            fontFamily: FONT, fontSize: 24, color: '#ffffff'
        }).setOrigin(0, 0.5).setDepth(10);

        this.coinLabel = new IconLabel(this.scene, x + rowW / 2 - 4, headerY, 'gem', fmt(meta.coins), {
            align: 'right', fontSize: 28, iconSize: 25
        });
        this.coinLabel.setDepth(11);
    }

    private buildTabs (): void
    {
        const { x, tabsY, rowW } = this.L;
        const gap = 8;
        const w = (rowW - gap * 2) / 3;
        const h = 40;

        this.tabButtons = TABS.map((tab, i) =>
        {
            const tx = x - rowW / 2 + w / 2 + i * (w + gap);
            const btn = this.scene.add.container(tx, tabsY).setDepth(10);

            const g = this.scene.add.graphics();
            btn.add(g);

            const label = this.scene.add.text(0, 0, tab.label, {
                fontFamily: FONT, fontSize: 17, color: '#ffffff'
            }).setOrigin(0.5);
            btn.add(label);

            const redraw = () =>
            {
                const on = this.tab === tab.id;

                g.clear();
                g.fillStyle(on ? 0x3fe0ff : PANEL, on ? 1 : 0.9);
                g.fillRoundedRect(-w / 2, -h / 2, w, h, 13);
                g.lineStyle(2, on ? 0x3fe0ff : IDLE_EDGE, 0.9);
                g.strokeRoundedRect(-w / 2, -h / 2, w, h, 13);

                label.setColor(on ? '#06101f' : DIM);
            };

            redraw();

            btn.setSize(w, h);
            btn.setInteractive({
                hitArea: new Geom.Rectangle(0, 0, w, h),
                hitAreaCallback: Geom.Rectangle.Contains,
                useHandCursor: true
            });

            btn.on('pointerdown', () =>
            {
                unlockAudio();

                if (this.tab === tab.id) return;

                this.tab = tab.id;
                Sfx.ui();

                for (const t of this.tabButtons) t.redraw();

                this.deal();
            });

            return { id: tab.id, redraw };
        });
    }

    //  ---------------------------------------------------------------- rows

    /** Tears the shelf down and stocks it with whatever tab is showing. */
    private deal (): void
    {
        for (const row of this.rows) row.destroy();

        this.rows = [];
        this.redraws = [];
        this.previews = [];

        if (this.tab === 'skins')
        {
            this.dealSkins();
            return;
        }

        const items: (() => GameObjects.Container)[] =
            this.tab === 'perks'
                ? PERKS.map((p, i) => () => this.perkRow(p, i))
                : BOOSTS.map((b, i) => () => this.boostRow(b, i));

        items.forEach((make, i) =>
        {
            const row = make();

            //  The shelf deals itself top to bottom, so switching tabs reads as
            //  a new set of things arriving rather than a redraw.
            row.setAlpha(0);
            row.setX(row.x + 26);

            this.scene.tweens.add({
                targets: row,
                x: this.L.x,
                alpha: 1,
                duration: 200,
                delay: i * 34,
                ease: 'Quad.out'
            });

            this.rows.push(row);
        });
    }

    /** The card every row is built on: dark plate, one meaningful edge colour. */
    private plate (i: number): { row: GameObjects.Container; g: GameObjects.Graphics }
    {
        const { x, rowY0, rowStep } = this.L;
        const row = this.scene.add.container(x, rowY0 + i * rowStep).setDepth(10);
        const g = this.scene.add.graphics();

        row.add(g);

        return { row, g };
    }

    private frame (g: GameObjects.Graphics, edge: number, lit: boolean, tint = 0): void
    {
        const { rowW, rowH } = this.L;

        g.clear();
        g.fillStyle(PANEL, 0.92);
        g.fillRoundedRect(-rowW / 2, -rowH / 2, rowW, rowH, 16);

        if (tint)
        {
            g.fillStyle(tint, 0.09);
            g.fillRoundedRect(-rowW / 2, -rowH / 2, rowW, rowH, 16);
        }

        g.lineStyle(2, edge, lit ? 0.95 : 0.7);
        g.strokeRoundedRect(-rowW / 2, -rowH / 2, rowW, rowH, 16);
    }

    private touchable (row: GameObjects.Container, onTap: () => void): void
    {
        const { rowW, rowH } = this.L;

        row.setSize(rowW, rowH);
        row.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, rowW, rowH),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        row.on('pointerdown', () =>
        {
            unlockAudio();
            onTap();
        });
    }

    /** The shake and the buzz a row gives when the player cannot afford it. */
    private deny (row: GameObjects.Container): void
    {
        this.denyAt(row, this.L.x);
    }

    /** The same refusal, for a tile whose home is not the column centre. */
    private denyAt (obj: GameObjects.Container, home: number): void
    {
        Sfx.miss();
        this.scene.tweens.add({ targets: obj, x: home + 8, duration: 55, yoyo: true, repeat: 2 });
    }

    private bought (row: GameObjects.Container, color: number): void
    {
        Sfx.upgrade();

        //  A rewarded video can outlive the row that started it -- the shelf
        //  may have been re-dealt while the ad was on screen. The purchase
        //  still stands either way; only its flourish is skipped.
        if (row.active)
        {
            this.fx.burst(row.x, row.y, color, 18, 'hit');
            this.scene.tweens.add({ targets: row, scale: 1.05, duration: 110, yoyo: true, ease: 'Quad.out' });
        }

        this.refresh();
        this.onChange();
    }

    //  --------------------------------------------------------------- perks

    private perkRow (perk: Perk, i: number): GameObjects.Container
    {
        const { rowW, rowH } = this.L;
        const { row, g } = this.plate(i);

        const icon = iconImage(this.scene, -rowW / 2 + 26, 0, perk.icon, { size: 28, color: 0xffffff, alpha: 0.9 });
        row.add(icon);

        row.add(this.scene.add.text(-rowW / 2 + 52, -12, perk.name, {
            fontFamily: FONT, fontSize: 19, color: '#ffffff'
        }).setOrigin(0, 0.5));

        row.add(this.scene.add.text(-rowW / 2 + 52, 10, perk.effect, {
            fontFamily: FONT_UI, fontSize: 13, color: DIM
        }).setOrigin(0, 0.5));

        const price = new IconLabel(this.scene, rowW / 2 - 20, 0, 'gem', '', {
            align: 'right', fontSize: 20, iconSize: 18
        });
        row.add(price);

        const pips = this.scene.add.graphics();
        row.add(pips);

        const redraw = () =>
        {
            const lvl = meta.perks[perk.id] || 0;
            const maxed = lvl >= perk.max;
            const cost = perkCost(perk, lvl);
            const afford = !maxed && meta.coins >= cost;
            const tone = maxed ? DONE_EDGE : (afford ? AFFORD_EDGE : 0x4c5578);

            this.frame(g, maxed ? DONE_EDGE : (afford ? AFFORD_EDGE : IDLE_EDGE), maxed || afford);

            pips.clear();

            for (let p = 0; p < perk.max; p++)
            {
                //  Pinned to the bottom edge rather than measured down from the
                //  middle, so a shorter row moves the pips off the effect line
                //  instead of onto it.
                pips.fillStyle(p < lvl ? DONE_EDGE : IDLE_EDGE, 1);
                pips.fillRect(-rowW / 2 + 52 + p * 12, rowH / 2 - 9, 8, 4);
            }

            price.setValue(maxed ? 'MAX' : fmt(cost), !maxed);
            price.text.setColor(hex(tone));
            price.icon.setTint(tone);
        };

        redraw();
        this.redraws.push(redraw);

        this.touchable(row, () =>
        {
            const lvl = meta.perks[perk.id] || 0;

            if (lvl >= perk.max) { Sfx.dry(); return; }

            const cost = perkCost(perk, lvl);

            if (meta.coins < cost) { this.deny(row); return; }

            meta.coins -= cost;
            meta.perks[perk.id] = lvl + 1;
            saveMeta();

            this.bought(row, DONE_EDGE);
        });

        return row;
    }

    //  -------------------------------------------------------------- boosts

    private boostRow (boost: Boost, i: number): GameObjects.Container
    {
        const { rowW, rowH } = this.L;
        const { row, g } = this.plate(i);

        const glow = this.scene.add.circle(-rowW / 2 + 30, 0, 22, boost.color, 0.16);
        row.add(glow);

        row.add(iconImage(this.scene, -rowW / 2 + 30, 0, boost.icon, { size: 28, color: boost.color }));

        row.add(this.scene.add.text(-rowW / 2 + 58, -12, boost.name, {
            fontFamily: FONT, fontSize: 19, color: '#ffffff'
        }).setOrigin(0, 0.5));

        row.add(this.scene.add.text(-rowW / 2 + 58, 10, boost.blurb, {
            fontFamily: FONT_UI, fontSize: 12, color: DIM
        }).setOrigin(0, 0.5));

        //  How many are in the bag, said in the row that sells them.
        const held = this.scene.add.text(rowW / 2 - 74, -rowH / 2 + 15, '', {
            fontFamily: FONT, fontSize: 15, color: hex(boost.color)
        }).setOrigin(1, 0.5);
        row.add(held);

        const price = new IconLabel(this.scene, rowW / 2 - 20, 0, 'gem', '', {
            align: 'right', fontSize: 20, iconSize: 18
        });
        row.add(price);

        const redraw = () =>
        {
            const n = boostCount(boost.id);
            const full = n >= boost.max;
            const afford = !full && meta.coins >= boost.cost;
            const tone = full ? DONE_EDGE : (afford ? AFFORD_EDGE : 0x4c5578);

            this.frame(g, n > 0 ? boost.color : (afford ? AFFORD_EDGE : IDLE_EDGE), afford || n > 0, boost.color);

            held.setText(n > 0 ? `OWNED x${n}` : '');
            price.setValue(full ? 'FULL' : fmt(boost.cost), !full);
            price.text.setColor(hex(tone));
            price.icon.setTint(tone);
        };

        redraw();
        this.redraws.push(redraw);

        this.touchable(row, () =>
        {
            if (boostCount(boost.id) >= boost.max) { Sfx.dry(); return; }

            if (meta.coins < boost.cost)
            {
                //  Short of the price. The tap said what they want, so the
                //  video is offered for that -- and the shake is still what
                //  happens on a build that has no video to offer.
                const offered = offerUnlock(this.scene, {
                    name: boost.name,
                    blurb: boost.blurb,
                    cost: boost.cost,
                    color: boost.color,
                    look: { color: boost.color, icon: boost.icon },
                    action: 'GET ONE FREE',
                    onUnlock: () =>
                    {
                        grantBoost(boost.id, 1);
                        this.bought(row, boost.color);
                    },
                    onPlay: this.onPlay
                });

                if (!offered) this.deny(row);

                return;
            }

            if (!buyBoost(boost)) { this.deny(row); return; }

            this.bought(row, boost.color);
        });

        return row;
    }

    //  --------------------------------------------------------------- skins

    /**
     * The wardrobe is a grid, not a list.
     *
     * There are thirty of these and a player browsing cosmetics is shopping by
     * eye, not reading specifications -- so each one is a tile that is mostly
     * the thing itself, drawn by the same code that will draw it on the board,
     * and the shelf pages rather than scrolls so a tap never turns into a drag.
     */
    private dealSkins (): void
    {
        const { x, rowY0, rowW, rowH, gridRows, listBottom } = this.L;

        const perPage = GRID_COLS * gridRows;
        const top = rowY0 - rowH / 2;
        const gapX = 8;
        const tileW = (rowW - gapX * (GRID_COLS - 1)) / GRID_COLS;
        const tileH = Math.min(TILE_MAX_H, (listBottom - top - PAGER_H) / gridRows - 6);
        const gapY = 6;

        const pages = Math.ceil(SKINS.length / perPage);

        this.skinPage = Math.max(0, Math.min(pages - 1, this.skinPage));

        const page = SKINS.slice(this.skinPage * perPage, (this.skinPage + 1) * perPage);

        page.forEach((skin, i) =>
        {
            const col = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);

            const tx = x - rowW / 2 + tileW / 2 + col * (tileW + gapX);
            const ty = top + tileH / 2 + row * (tileH + gapY);

            const tile = this.skinTile(skin, tx, ty, tileW, tileH);

            tile.setAlpha(0);
            tile.setScale(0.86);

            this.scene.tweens.add({
                targets: tile,
                alpha: 1,
                scale: 1,
                duration: 190,
                delay: i * 16,
                ease: 'Back.out'
            });

            this.rows.push(tile);
        });

        if (pages > 1) this.rows.push(this.pager(pages, top + gridRows * (tileH + gapY) + PAGER_H / 2 - 4));
    }

    private skinTile (skin: TargetSkin, x: number, y: number, w: number, h: number): GameObjects.Container
    {
        const tile = this.scene.add.container(x, y).setDepth(10);

        const g = this.scene.add.graphics();
        tile.add(g);

        //  The name and the price own the bottom of the tile; the preview gets
        //  everything above them, centred -- so a shelf with fewer rows on it
        //  spends the room it saved on bigger faces rather than a bigger gap.
        const textH = 46;
        const r = Math.min(28, (h - textH) / 2 - 4);
        const artY = -h / 2 + (h - textH) / 2;

        //  The preview is the real thing: a bought face is drawn from the same
        //  texture the target will wear, and a bought shape from the same path.
        if (skin.art && this.scene.textures.exists(sa(skin.art)))
        {
            const img = this.scene.add.image(0, artY, sa(skin.art));
            img.setDisplaySize(r * 2, r * 2);
            tile.add(img);
            this.previews.push({ g: null, skin, rot: 0, r });
        }
        else
        {
            const preview = this.scene.add.graphics();
            preview.setPosition(0, artY);
            tile.add(preview);
            this.previews.push({ g: preview, skin, rot: Math.random() * Math.PI, r });
        }

        const name = this.scene.add.text(0, h / 2 - 30, skin.name, {
            fontFamily: FONT, fontSize: 12, color: '#ffffff'
        }).setOrigin(0.5);

        //  A long country name has to shrink rather than run off its tile.
        if (name.width > w - 10) name.setFontSize(Math.max(8, 12 * (w - 10) / name.width));

        tile.add(name);

        const state = this.scene.add.text(0, h / 2 - 13, '', {
            fontFamily: FONT, fontSize: 12, color: '#ffffff'
        }).setOrigin(0.5);
        tile.add(state);

        const redraw = () =>
        {
            const owned = ownsSkin(skin.id);
            const worn = meta.skin === skin.id;
            const afford = !owned && meta.coins >= skin.cost;
            const edge = worn ? DONE_EDGE : (owned ? skin.accent : (afford ? AFFORD_EDGE : IDLE_EDGE));

            g.clear();
            g.fillStyle(PANEL, 0.92);
            g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
            g.fillStyle(skin.accent, worn ? 0.16 : 0.07);
            g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
            g.lineStyle(worn ? 3 : 2, edge, worn || afford ? 0.95 : 0.65);
            g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);

            state.setText(worn ? 'WEARING' : (owned ? 'EQUIP' : fmt(skin.cost)));
            state.setColor(worn ? hex(DONE_EDGE) : (owned ? DIM : hex(afford ? AFFORD_EDGE : 0x4c5578)));
            name.setAlpha(owned ? 1 : 0.75);
        };

        redraw();
        this.redraws.push(redraw);

        tile.setSize(w, h);
        tile.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, w, h),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true
        });

        tile.on('pointerdown', () =>
        {
            unlockAudio();

            if (meta.skin === skin.id) { Sfx.dry(); return; }

            if (ownsSkin(skin.id))
            {
                equipSkin(skin.id);
                Sfx.ui();
                this.fx.ring(tile.x, tile.y - h / 2 + 30, 80, skin.accent, 4, 380);
                this.refresh();
                this.onChange();
                return;
            }

            if (meta.coins < skin.cost)
            {
                const offered = offerUnlock(this.scene, {
                    name: skin.name,
                    blurb: skin.blurb,
                    cost: skin.cost,
                    color: skin.accent,
                    look: { color: skin.accent, art: skin.art, shape: skin.shape },
                    action: 'UNLOCK FREE',
                    onUnlock: () => { if (grantSkin(skin.id)) this.wonSkin(skin, tile); },
                    onPlay: this.onPlay
                });

                if (!offered) this.denyAt(tile, x);

                return;
            }

            if (!buySkin(skin)) { this.denyAt(tile, x); return; }

            this.wonSkin(skin, tile);
        });

        return tile;
    }

    /**
     * What happens the moment a skin becomes theirs, however it was paid for.
     *
     * The tile pops first, because that is the thing they tapped, and the card
     * follows a beat later -- two flourishes on the same frame read as one
     * glitch. See objects/StoreModal for why the card exists at all.
     */
    private wonSkin (skin: TargetSkin, tile: GameObjects.Container): void
    {
        Sfx.upgrade();

        if (tile.active)
        {
            this.fx.burst(tile.x, tile.y, skin.accent, 22, 'hit');
            this.scene.tweens.add({ targets: tile, scale: 1.12, duration: 120, yoyo: true, ease: 'Quad.out' });
        }

        this.refresh();
        this.onChange();

        this.scene.time.delayedCall(180, () =>
        {
            skinUnlocked(this.scene, this.topFx, skin, this.onPlay);
        });
    }

    /** Page back and forth through the wardrobe. */
    private pager (pages: number, y: number): GameObjects.Container
    {
        const bar = this.scene.add.container(this.L.x, y).setDepth(11);

        const step = (dir: number) =>
        {
            const next = this.skinPage + dir;

            if (next < 0 || next >= pages) { Sfx.dry(); return; }

            this.skinPage = next;
            Sfx.ui();
            this.deal();
        };

        for (const dir of [ -1, 1 ])
        {
            const bx = dir * 96;
            const arrow = this.scene.add.container(bx, 0);

            const g = this.scene.add.graphics();
            g.fillStyle(PANEL, 0.92);
            g.fillRoundedRect(-22, -14, 44, 28, 9);
            g.lineStyle(2, IDLE_EDGE, 0.8);
            g.strokeRoundedRect(-22, -14, 44, 28, 9);
            arrow.add(g);

            const icon = iconImage(this.scene, 0, 0, 'arrowRight', { size: 14, color: 0xa8b4d0 });
            if (dir < 0) icon.setFlipX(true);
            arrow.add(icon);

            arrow.setSize(44, 28);
            arrow.setInteractive({
                hitArea: new Geom.Rectangle(0, 0, 44, 28),
                hitAreaCallback: Geom.Rectangle.Contains,
                useHandCursor: true
            });

            arrow.on('pointerdown', () => { unlockAudio(); step(dir); });

            bar.add(arrow);
        }

        //  One pip per page, so the shelf says how much more there is.
        const dots = this.scene.add.graphics();

        for (let i = 0; i < pages; i++)
        {
            dots.fillStyle(i === this.skinPage ? 0x3fe0ff : IDLE_EDGE, 1);
            dots.fillCircle((i - (pages - 1) / 2) * 16, 0, i === this.skinPage ? 5 : 3.5);
        }

        bar.add(dots);

        return bar;
    }

    //  -------------------------------------------------------------- upkeep

    /** Redraws every row against the current save. */
    refresh (): void
    {
        this.coinLabel.setValue(fmt(meta.coins));
        this.coinLabel.setScale(1.15);

        this.scene.tweens.add({ targets: this.coinLabel, scale: 1, duration: 160, ease: 'Quad.out' });

        for (const redraw of this.redraws) redraw();
    }

    /** Turns the skin previews. Called from the scene's own update. */
    tick (dtMs: number): void
    {
        this.topFx.update(dtMs);

        if (this.previews.length === 0) return;

        const t = this.scene.time.now;
        const worn = equippedSkin().id;

        for (const p of this.previews)
        {
            //  A face is a baked texture and already drawn; only the shape
            //  previews have anything to animate.
            if (!p.g) continue;

            const g = p.g;
            const skin = p.skin;
            const r = p.r * 0.72;
            const on = skin.id === worn;

            p.rot += skin.spin * (dtMs / 1000);

            const pulse = 1 + Math.sin(t * 0.005) * 0.06;

            //  Previewed through the skin's own paint, so a skin that turns
            //  its targets black is sold as black rather than as its label.
            const paint = skin.tint
                ? skin.tint({ color: skin.accent, ring: mix(skin.accent, 0xffffff, 0.6) })
                : { color: skin.accent, ring: mix(skin.accent, 0xffffff, 0.6) };

            const color = paint.color;

            g.clear();
            g.fillStyle(color, 0.18 * skin.glow * (on ? 1.4 : 1));
            g.fillCircle(0, 0, r * 1.7 * pulse);

            g.fillStyle(color, 1);
            fillBody(g, skin.shape, r * pulse, p.rot);

            g.lineStyle(2, 0xffffff, 0.65);
            strokeBody(g, skin.shape, r * pulse, p.rot);

            g.fillStyle(0x000000, 0.28);
            fillBody(g, skin.shape, r * 0.46 * pulse, p.rot);

            //  The life ring, so the preview is unmistakably a target.
            g.lineStyle(3, paint.ring, on ? 0.75 : 0.5);
            g.strokeCircle(0, 0, r + 6);
        }
    }
}
