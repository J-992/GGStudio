import Phaser from 'phaser';
import { BALANCE } from '../data/balance';
import { BOSS_COUNT, bossIdentity } from '../data/enemies';
import { ninjaDef } from '../data/ninjas';
import { almanacPageCount, almanacPageSlice } from '../data/presentation';
import { bossFlavorText, ninjaFlavorText } from '../data/flavorText';
import { ATLAS_KEY } from '../render/atlasConfig';
import { collectionProgress } from '../systems/CollectionProgress';
import { theme } from './theme';
import type { GameCore } from '../core/GameCore';
import type { Sfx } from '../audio/Sfx';

interface Entry {
  root: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.NineSlice;
  art: Phaser.GameObjects.Image;
  question: Phaser.GameObjects.BitmapText;
  label: Phaser.GameObjects.BitmapText;
  /** Invisible tap target sized to the whole cell (portrait + label), not just the plate -- a small kid's finger should not have to land on the art precisely. */
  hitZone: Phaser.GameObjects.Zone;
  textureKey: string;
  frame?: string | number;
  name: string;
  description: string;
  /** Kept in sync by `paint()`; the tap handler reads this at press time. */
  unlocked: boolean;
}

interface Grid {
  columns: number;
  cellWidth: number;
  cellHeight: number;
  artHeight: number;
  left: number;
  top: number;
}

/** A page-turn arrow: the pressable thing is the plate, never the container. */
interface PageButton {
  body: Phaser.GameObjects.Rectangle;
  icon: Phaser.GameObjects.Image;
}

/** Shown whenever no tapped entry's description is currently on screen. */
const DEFAULT_DETAIL = 'TAP A DISCOVERED ENTRY TO LEARN MORE';

/** Half a fold each way. Long enough to read as paper, short enough to spam. */
const FOLD_MS = 150;
const UNFOLD_MS = 190;

/** Display height both page-flip chevrons are drawn at, so the pair reads as twins. */
const PAGE_ICON_HEIGHT = 24;

/**
 * The collection screen: every ninja tier and every boss, with the ones the
 * player has not met yet shown as a black silhouette behind a question mark.
 *
 * Locked entries reuse the real art tinted to black rather than a separate
 * "unknown" sprite, so the silhouette always matches what will be revealed.
 */
export class Almanac extends Phaser.GameObjects.Container {
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly backing: Phaser.GameObjects.TileSprite;
  private readonly panel: Phaser.GameObjects.NineSlice;
  private readonly titlePlate: Phaser.GameObjects.NineSlice;
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly closeButton: Phaser.GameObjects.Image;
  private readonly headers: Phaser.GameObjects.BitmapText[] = [];
  /** "N LEFT" readouts sitting beside each section header. */
  private readonly leftReadouts: Phaser.GameObjects.BitmapText[] = [];
  private readonly ninjas: Entry[] = [];
  private readonly bosses: Entry[] = [];
  /**
   * Everything that turns. Held in its own container pinned to the middle of
   * the panel so the fold is a scaleX about the spine, the way a page moves.
   */
  private readonly spread: Phaser.GameObjects.Container;
  private readonly crease: Phaser.GameObjects.Rectangle;
  private readonly previousPage: PageButton;
  private readonly nextPage: PageButton;
  private readonly pageLabel: Phaser.GameObjects.BitmapText;
  /** One shared caption below the grid: whatever was last tapped, or a hint. */
  private readonly detailText: Phaser.GameObjects.BitmapText;
  private open = false;
  private page = 0;
  private turning = false;
  /** Set by a press that landed on the shade; only those may close the book. */
  private pressedOnShade = false;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly sfx: Sfx,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(400).setVisible(false);

    const l = theme.layout;
    // Opaque all the way through: the almanac is a page you read, not an
    // overlay, and a see-through panel made the silhouettes hard to judge.
    this.shade = sceneRef.add
      .rectangle(l.width / 2, l.height / 2, l.width, l.height, 0x0b1119, 1)
      .setInteractive();
    this.backing = sceneRef.add.tileSprite(0, 0, 100, 100, 'tex_5').setTint(0x6a4a35);
    this.panel = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'frame_bezel', 100, 100, 20, 20, 20, 20);
    this.titlePlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 260, 34, 11, 11, 7, 7);
    this.title = sceneRef.add.bitmapText(0, 0, 'pixel', 'ALMANAC', 14).setOrigin(0.5).setTint(0xffffff);
    this.closeButton = sceneRef.add.image(0, 0, ATLAS_KEY, 'btn_back').setScale(1.4);
    // Close on a press *and* release inside the modal. Reacting to a bare
    // pointerup would let the release of the tap that opened the almanac shut
    // it again, which read as "hold to view".
    this.closeButton.setInteractive(new Phaser.Geom.Rectangle(-12, -12, 53, 53), Phaser.Geom.Rectangle.Contains);
    this.closeButton.on('pointerdown', () => { this.pressedOnShade = true; });
    this.closeButton.on('pointerup', () => this.dismiss());
    this.shade.on('pointerdown', () => { this.pressedOnShade = true; });
    this.shade.on('pointerup', () => this.dismiss());

    this.add([this.shade, this.backing, this.panel, this.titlePlate, this.title, this.closeButton]);

    this.spread = sceneRef.add.container(0, 0);
    this.add(this.spread);
    // A dark band that sweeps across the fold, so the turn has a near edge and
    // a far one instead of reading as a flat squash.
    this.crease = sceneRef.add.rectangle(0, 0, 60, 100, 0x1a0f08, 0).setOrigin(0.5);
    this.add(this.crease);

    for (const caption of ['NINJAS', 'BOSSES']) {
      const header = sceneRef.add.bitmapText(0, 0, 'pixel', caption, 14).setOrigin(0.5).setTint(0xffe58a);
      this.headers.push(header);
      this.spread.add(header);
      // The goal-gradient next to the name: how many entries in this section
      // are still silhouettes. Same warm palette as the header -- information,
      // never urgency.
      const readout = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0, 0.5).setTint(0xcbb79a);
      this.leftReadouts.push(readout);
      this.spread.add(readout);
    }

    for (let tier = 1; tier <= BALANCE.tiers.count; tier += 1) {
      const ninja = ninjaDef(tier);
      this.ninjas.push(this.makeEntry(ninja.textureKey, undefined, ninja.name, ninjaFlavorText(tier)));
    }
    for (let index = 0; index < BOSS_COUNT; index += 1) {
      const boss = bossIdentity(index);
      this.bosses.push(this.makeEntry(boss.textureKey, undefined, boss.name, bossFlavorText(index)));
    }

    // The controls sit on their own footer rail. They used to be tucked either
    // side of the title, where the plate swallowed them whole and a miss landed
    // on the shade and closed the book -- which is what "cannot flip" was.
    this.previousPage = this.makePageButton('arrow_left', -1);
    this.nextPage = this.makePageButton('arrow_right', 1);
    this.pageLabel = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0.5).setTint(0xffe58a);
    this.add(this.pageLabel);
    this.detailText = sceneRef.add
      .bitmapText(0, 0, 'pixel', DEFAULT_DETAIL, 12)
      .setOrigin(0.5)
      .setCenterAlign()
      .setTint(0xb9ac9d);
    this.add(this.detailText);

    this.applyPage();
    this.relayout();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** The book button is a toggle, so a second tap on it closes the almanac. */
  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.pressedOnShade = false;
    this.turning = false;
    this.spread.setScale(1);
    this.crease.setAlpha(0);
    this.refresh();
    this.applyPage();
    this.relayout();
    this.setVisible(true).setAlpha(0);
    this.sceneRef.tweens.add({ targets: this, alpha: 1, duration: 160 });
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.pressedOnShade = false;
    this.sceneRef.tweens.add({
      targets: this,
      alpha: 0,
      duration: 140,
      onComplete: () => this.setVisible(false).setAlpha(1),
    });
  }

  /** Verification hook: which page is showing, and how many there are. */
  pageState(): { page: number; pages: number; visible: number } {
    return {
      page: this.page,
      pages: this.pageCount,
      visible: [...this.ninjas, ...this.bosses].filter((entry) => entry.root.visible).length,
    };
  }

  /** Game-space anchors for the two page arrows. */
  anchors(): { previous: { x: number; y: number }; next: { x: number; y: number } } {
    return {
      previous: { x: this.previousPage.body.x, y: this.previousPage.body.y },
      next: { x: this.nextPage.body.x, y: this.nextPage.body.y },
    };
  }

  /** Verification hook: game-space anchor for one visible grid entry's plate. */
  entryAnchor(kind: 'ninja' | 'boss', index: number): { x: number; y: number } | null {
    const entry = (kind === 'ninja' ? this.ninjas : this.bosses)[index];
    if (entry === undefined || !entry.root.visible) return null;
    return { x: this.spread.x + entry.root.x, y: this.spread.y + entry.root.y };
  }

  /** Verification hook: force the same press an entry's own plate would receive. */
  debugTap(kind: 'ninja' | 'boss', index: number): void {
    const entry = (kind === 'ninja' ? this.ninjas : this.bosses)[index];
    if (entry !== undefined) this.showDetail(entry);
  }

  /** Verification hook: the shared detail caption's current text. */
  detailState(): string {
    return this.detailText.text;
  }

  relayout(): void {
    const l = theme.layout;
    this.shade.setPosition(l.width / 2, l.height / 2).setSize(l.width, l.height);

    const width = l.landscape ? Math.min(1340, l.width - 64) : l.width - 56;
    const height = l.landscape ? l.height - 44 : Math.min(1060, l.height - 120);
    const centerX = l.width / 2;
    const top = (l.height - height) / 2;

    this.panel.setPosition(centerX, top + height / 2).setSize(width, height);
    this.backing.setPosition(centerX, top + height / 2).setSize(width - 18, height - 18);
    this.titlePlate.setPosition(centerX, top + 30).setSize(l.landscape ? 300 : 340, 34);
    this.title.setPosition(centerX, top + 30);
    this.closeButton.setPosition(centerX + width / 2 - 34, top + 32);

    // Footer rail: arrows out at the edges, the counter between them.
    const footerY = top + height - 40;
    this.placePageButton(this.previousPage, centerX - Math.min(210, width / 2 - 46), footerY);
    this.placePageButton(this.nextPage, centerX + Math.min(210, width / 2 - 46), footerY);
    this.pageLabel.setPosition(centerX, footerY);
    // Sits in the strip `detailReserve` carves out of the grid below, clear of
    // both the last grid row and the footer rail.
    this.detailText.setPosition(centerX, footerY - 44).setMaxWidth(width - 64);

    const gridLeft = centerX - width / 2 + 26;
    const gridWidth = width - 52;
    const bodyTop = top + 64;
    // Reserves a fixed strip between the grid and the footer for the tapped
    // entry's description; the grid shrinks by exactly this much rather than
    // hoping the existing footer gap happens to have slack.
    const detailReserve = 26;
    const bodyHeight = height - 88 - 56 - detailReserve;

    const columns = this.columns;
    const rows = this.rows;
    const headerHeight = 30;
    // Rows are sized to their contents and the block is centred, so the grid
    // never spreads into a sparse column of floating portraits. Names wrap to
    // two lines, so every row reserves label space first and the art takes
    // whatever height is left -- otherwise the last row clips off the panel.
    const labelSpace = l.landscape ? 58 : 68;
    const available = (bodyHeight - headerHeight * 2) / (rows * 2);
    const artHeight = Math.max(48, Math.min(l.landscape ? 96 : 112, available - labelSpace));
    const rowHeight = artHeight + labelSpace;
    const blockHeight = headerHeight * 2 + rowHeight * rows * 2;
    const blockTop = bodyTop + Math.max(0, (bodyHeight - blockHeight) / 2);

    // The spread is pinned to the spine so its fold pivots there; everything
    // inside is laid out relative to that point.
    this.spread.setPosition(centerX, 0);
    this.crease.setPosition(centerX, top + height / 2).setSize(72, height - 30);

    const ninjaGrid: Grid = {
      columns,
      cellWidth: gridWidth / columns,
      cellHeight: rowHeight,
      artHeight,
      left: gridLeft - centerX,
      top: blockTop + headerHeight,
    };
    const bossTop = ninjaGrid.top + rowHeight * rows + headerHeight;
    const bossGrid: Grid = { ...ninjaGrid, top: bossTop };

    this.headers[0]?.setPosition(0, blockTop + headerHeight / 2);
    this.headers[1]?.setPosition(0, bossTop - headerHeight / 2);

    // The readout rides just right of its header, on the same centre line.
    this.headers.forEach((header, index) => {
      const readout = this.leftReadouts[index];
      if (!header || !readout) return;
      readout.setPosition(header.x + header.width / 2 + 14, header.y);
    });

    this.visibleEntries(this.ninjas).forEach((entry, index) => this.placeEntry(entry, ninjaGrid, index));
    this.visibleEntries(this.bosses).forEach((entry, index) => this.placeEntry(entry, bossGrid, index));
  }

  /**
   * Repaints lock state from the lifetime collection.
   *
   * Reads `discoveredTiers` rather than the run's ladder position: the run
   * resets on every defeat and every ascension, and an almanac that emptied
   * itself each time would not be a collection at all.
   */
  refresh(): void {
    this.ninjas.forEach((entry, index) => this.paint(entry, this.core.discoveredTiers.has(index + 1)));
    this.bosses.forEach((entry, index) => this.paint(entry, this.core.seenBosses.has(index)));
    this.updateProgress();
  }

  /**
   * Cheap per-frame progress readouts, safe to call while the book is open
   * (a boss can step through the gate mid-read). Only touches two texts.
   */
  updateProgress(): void {
    const ninjas = collectionProgress(this.core.discoveredTiers.size, BALANCE.tiers.count);
    const bosses = collectionProgress(this.core.seenBosses.size, BOSS_COUNT);
    this.leftReadouts[0]?.setText(`${ninjas.left} LEFT`);
    this.leftReadouts[1]?.setText(`${bosses.left} LEFT`);
  }

  private get columns(): number {
    return theme.layout.landscape ? 6 : 4;
  }

  private get rows(): number {
    return 2;
  }

  private get perSection(): number {
    return this.columns * this.rows;
  }

  private get pageCount(): number {
    return almanacPageCount(this.ninjas.length, this.bosses.length, this.perSection);
  }

  private dismiss(): void {
    if (!this.pressedOnShade) return;
    this.hide();
  }

  /**
   * Turn to a page: fold the spread shut about the spine, swap what is on it,
   * then let it fall open again. A second press mid-turn is ignored rather
   * than queued -- two overlapping folds look like a glitch, not a book.
   */
  private turnTo(value: number): void {
    const target = Phaser.Math.Clamp(value, 0, this.pageCount - 1);
    if (this.turning || target === this.page) return;
    const forward = target > this.page;
    this.turning = true;
    this.page = target;
    this.sfx.play('drop');

    const l = theme.layout;
    this.crease.setPosition(l.width / 2, this.crease.y).setAlpha(0);
    this.sceneRef.tweens.add({ targets: this.crease, alpha: 0.4, duration: FOLD_MS, yoyo: true });
    this.sceneRef.tweens.add({
      targets: this.spread,
      scaleX: 0.02,
      duration: FOLD_MS,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.applyPage();
        this.relayout();
        // Come back from the other side, so the sheet reads as having been
        // lifted over rather than squashed and released.
        this.spread.setScale(forward ? -0.02 : 0.02, 1);
        this.sceneRef.tweens.add({
          targets: this.spread,
          scaleX: 1,
          duration: UNFOLD_MS,
          ease: 'Quad.easeOut',
          onComplete: () => { this.spread.setScale(1); this.turning = false; },
        });
      },
    });
  }

  /** Shows the current page's slice of each list and repaints the footer. */
  private applyPage(): void {
    this.page = Phaser.Math.Clamp(this.page, 0, this.pageCount - 1);
    // Whatever was on the detail line belonged to whichever entry sat on the
    // page just left; a turned page must not keep talking about it.
    this.detailText.setText(DEFAULT_DETAIL);
    const ninjaSlice = almanacPageSlice(this.ninjas.length, this.page, this.perSection);
    const bossSlice = almanacPageSlice(this.bosses.length, this.page, this.perSection);
    this.ninjas.forEach((entry, index) => entry.root.setVisible(index >= ninjaSlice.start && index < ninjaSlice.end));
    this.bosses.forEach((entry, index) => entry.root.setVisible(index >= bossSlice.start && index < bossSlice.end));
    this.headers[1]?.setVisible(bossSlice.end > bossSlice.start);
    this.showPageButton(this.previousPage, this.page > 0);
    this.showPageButton(this.nextPage, this.page < this.pageCount - 1);
    this.pageLabel.setText(`${this.page + 1} / ${this.pageCount}`);
  }

  private visibleEntries(entries: readonly Entry[]): Entry[] {
    return entries.filter((entry) => entry.root.visible);
  }

  private makePageButton(frame: string, step: number): PageButton {
    const body = this.sceneRef.add.rectangle(0, 0, 84, 52, 0x2b1d12, 0.85).setStrokeStyle(3, 0x8a5c3a);
    const icon = this.sceneRef.add.image(0, 0, ATLAS_KEY, frame).setTint(0xffe58a);
    // Whatever each frame's native size, both chevrons share a display height
    // so the pair sits symmetrically on the plate.
    icon.setScale(PAGE_ICON_HEIGHT / Math.max(1, icon.height));
    body.setInteractive();
    body.on('pointerdown', () => {
      this.sceneRef.tweens.add({ targets: [body, icon], scale: 0.92, yoyo: true, duration: 90 });
      this.turnTo(this.page + step);
    });
    // Presses on a control must never reach the shade behind it, or flipping
    // the page would also shut the book.
    body.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
    });
    this.add([body, icon]);
    return { body, icon };
  }

  private placePageButton(button: PageButton, x: number, y: number): void {
    button.body.setPosition(x, y).setSize(84, 52);
    // A resized Rectangle keeps its old hit area, so the shape is re-set here.
    button.body.setInteractive(new Phaser.Geom.Rectangle(0, 0, 84, 52), Phaser.Geom.Rectangle.Contains);
    button.icon.setPosition(x, y);
  }

  private showPageButton(button: PageButton, enabled: boolean): void {
    button.body.setAlpha(enabled ? 0.85 : 0.25);
    button.icon.setAlpha(enabled ? 1 : 0.3);
  }

  private makeEntry(textureKey: string, frame: string | number | undefined, name: string, description: string): Entry {
    const root = this.sceneRef.add.container(0, 0);
    const plate = this.sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'panel_frame_9', 120, 120, 8, 8, 8, 8);
    const art = this.sceneRef.add.image(0, 0, textureKey, frame);
    const question = this.sceneRef.add.bitmapText(0, 0, 'pixel', '?', 14).setOrigin(0.5).setScale(2).setTint(0xffffff);
    const label = this.sceneRef.add.bitmapText(0, 0, 'pixel', name.toUpperCase(), 14).setOrigin(0.5, 0).setCenterAlign();
    // Invisible, sized to the whole cell in placeEntry -- the tappable region
    // covers the portrait AND the name below it, not just the framed plate.
    const hitZone = this.sceneRef.add.zone(0, 0, 10, 10).setOrigin(0.5, 0.5);
    root.add([plate, art, question, label, hitZone]);
    this.spread.add(root);
    const entry: Entry = { root, plate, art, question, label, hitZone, textureKey, frame, name, description, unlocked: false };
    // Matches the page arrows' pattern: stop propagation on release so a tap
    // never falls through to the shade behind it and closes the book.
    hitZone.setInteractive();
    hitZone.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.showDetail(entry);
    });
    return entry;
  }

  /** Shows a discovered entry's one-line description; silhouettes stay silent. */
  private showDetail(entry: Entry): void {
    if (!entry.unlocked) return;
    this.sfx.play('click');
    this.detailText.setText(`${entry.name.toUpperCase()} - ${entry.description}`);
  }

  private placeEntry(entry: Entry, grid: Grid, index: number): void {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const x = grid.left + grid.cellWidth * (column + 0.5);
    const y = grid.top + grid.cellHeight * row;

    const source = this.sceneRef.textures.getFrame(entry.textureKey, entry.frame);
    const sourceWidth = source?.width ?? 128;
    const sourceHeight = source?.height ?? 128;
    const plateWidth = Math.min(grid.cellWidth - 8, grid.artHeight + 14);
    // Bosses are wider than they are tall, so fit the art to the cell on both
    // axes -- height alone let the big silhouettes bleed over their neighbours.
    const scale = Math.min(grid.artHeight / sourceHeight, (plateWidth - 10) / sourceWidth);
    const centerY = grid.artHeight / 2 + 6;

    entry.root.setPosition(x, y);
    entry.plate.setSize(plateWidth, grid.artHeight + 12).setPosition(0, centerY);
    entry.art.setScale(scale).setPosition(0, centerY);
    entry.question.setPosition(0, centerY);
    // The whole cell, portrait and name together -- a forgiving mobile target.
    entry.hitZone.setSize(grid.cellWidth, grid.cellHeight).setPosition(0, grid.cellHeight / 2);
    entry.label.setPosition(0, grid.artHeight + 18).setMaxWidth(grid.cellWidth - 6);
  }

  private paint(entry: Entry, unlocked: boolean): void {
    entry.unlocked = unlocked;
    entry.art.setTint(unlocked ? 0xffffff : 0x000000).setAlpha(unlocked ? 1 : 0.92);
    entry.question.setVisible(!unlocked);
    entry.label.setText(unlocked ? entry.name.toUpperCase() : '???');
    entry.label.setTint(unlocked ? 0xffffff : 0x9a8f84);
    entry.plate.setTint(unlocked ? 0xffffff : 0x6d6058);
  }
}
