import Phaser from 'phaser';
import { ACHIEVEMENTS, ACHIEVEMENT_COUNT, ACHIEVEMENT_TINTS } from '../data/achievements';
import { ATLAS_KEY } from '../render/atlasConfig';
import { theme } from './theme';
import type { GameCore } from '../core/GameCore';
import type { Sfx } from '../audio/Sfx';

/** One achievement as drawn: badge, name, what it asks for. */
interface Row {
  root: Phaser.GameObjects.Container;
  badge: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.BitmapText;
  description: Phaser.GameObjects.BitmapText;
  check: Phaser.GameObjects.BitmapText;
}

interface PageButton {
  body: Phaser.GameObjects.Rectangle;
  icon: Phaser.GameObjects.Image;
}

/** How many achievements are listed on one page. */
const PER_PAGE = 6;

/**
 * The achievements page: everything the game will ever ask for, and how much
 * of it is done.
 *
 * Locked entries are shown in full rather than hidden behind question marks.
 * The almanac hides its unmet entries because *discovering* them is the point;
 * here the point is having somewhere to look when you want to know what to try
 * next, and a list of secrets would answer the wrong question.
 *
 * The header carries the ascension rank, which is the other half of the
 * prestige reward -- the income bonus decays with every ascension, the title
 * does not.
 */
export class AchievementsPanel extends Phaser.GameObjects.Container {
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly backing: Phaser.GameObjects.TileSprite;
  private readonly panel: Phaser.GameObjects.NineSlice;
  private readonly titlePlate: Phaser.GameObjects.NineSlice;
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly closeButton: Phaser.GameObjects.Image;
  private readonly rankPlate: Phaser.GameObjects.NineSlice;
  private readonly rankLabel: Phaser.GameObjects.BitmapText;
  private readonly progressLabel: Phaser.GameObjects.BitmapText;
  private readonly rows: Row[] = [];
  private readonly previousPage: PageButton;
  private readonly nextPage: PageButton;
  private readonly pageLabel: Phaser.GameObjects.BitmapText;
  private open = false;
  private page = 0;
  /** Set by a press that landed on the shade; only those may close the page. */
  private pressedOnShade = false;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly sfx: Sfx,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(400).setVisible(false);

    const l = theme.layout;
    this.shade = sceneRef.add.rectangle(l.width / 2, l.height / 2, l.width, l.height, 0x0b1119, 1).setInteractive();
    this.backing = sceneRef.add.tileSprite(0, 0, 100, 100, 'tex_5').setTint(0x6a4a35);
    this.panel = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'frame_bezel', 100, 100, 20, 20, 20, 20);
    this.titlePlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 260, 34, 11, 11, 7, 7);
    this.title = sceneRef.add.bitmapText(0, 0, 'pixel', 'ACHIEVEMENTS', 14).setOrigin(0.5).setTint(0xffffff);
    this.closeButton = sceneRef.add.image(0, 0, ATLAS_KEY, 'btn_back').setScale(1.4);
    // Same contract as the almanac: react to a press *and* a release inside the
    // modal, or the release of the tap that opened it would shut it again.
    this.closeButton.setInteractive(new Phaser.Geom.Rectangle(-12, -12, 53, 53), Phaser.Geom.Rectangle.Contains);
    this.closeButton.on('pointerdown', () => { this.pressedOnShade = true; });
    this.closeButton.on('pointerup', () => this.dismiss());
    this.shade.on('pointerdown', () => { this.pressedOnShade = true; });
    this.shade.on('pointerup', () => this.dismiss());
    this.add([this.shade, this.backing, this.panel, this.titlePlate, this.title, this.closeButton]);

    this.rankPlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 220, 30, 11, 11, 7, 7).setTint(0xb9862f);
    this.rankLabel = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0.5).setTint(0xfff6dd);
    this.progressLabel = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(1, 0.5).setTint(0xffe58a);
    this.add([this.rankPlate, this.rankLabel, this.progressLabel]);

    for (let index = 0; index < PER_PAGE; index += 1) this.rows.push(this.makeRow());

    this.previousPage = this.makePageButton('arrow_left', -1);
    this.nextPage = this.makePageButton('arrow_right', 1);
    this.pageLabel = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0.5).setTint(0xffe58a);
    this.add(this.pageLabel);

    this.relayout();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** The star button is a toggle, so a second tap on it closes the page. */
  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.pressedOnShade = false;
    this.refresh();
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

  /** Verification hook: which page is showing, and how much is unlocked. */
  pageState(): { page: number; pages: number; unlocked: number; total: number } {
    const progress = this.core.achievementProgress;
    return { page: this.page, pages: this.pageCount, unlocked: progress.have, total: progress.total };
  }

  /** Game-space anchors for the two page arrows. */
  anchors(): { previous: { x: number; y: number }; next: { x: number; y: number } } {
    return {
      previous: { x: this.previousPage.body.x, y: this.previousPage.body.y },
      next: { x: this.nextPage.body.x, y: this.nextPage.body.y },
    };
  }

  /** Repaints lock state and the header from the core. */
  refresh(): void {
    const rank = this.core.rank;
    const progress = this.core.achievementProgress;
    const ascensions = this.core.ascensionCount;
    // Before the first ascension the title is a starting point rather than an
    // award, so it is shown without a count next to it.
    this.rankLabel.setText(ascensions > 0 ? `${rank.name} - ASCENDED ${ascensions}` : rank.name);
    this.rankLabel.setTint(rank.tint);
    this.rankPlate.setTint(ascensions > 0 ? 0xb9862f : 0x6a5442);
    this.progressLabel.setText(`${progress.have} / ${progress.total}`);

    const start = this.page * PER_PAGE;
    this.rows.forEach((row, index) => {
      const entry = ACHIEVEMENTS[start + index];
      if (entry === undefined) {
        row.root.setVisible(false);
        return;
      }
      const unlocked = this.core.achievements.has(entry.id);
      row.root.setVisible(true);
      row.name.setText(entry.name);
      row.description.setText(entry.description);
      row.badge.setTint(unlocked ? ACHIEVEMENT_TINTS[entry.kind] : 0x4a4038);
      row.name.setTint(unlocked ? 0xfff6dd : 0x9a8f84);
      row.description.setTint(unlocked ? 0xd8cfc4 : 0x7d7169);
      row.check.setText(unlocked ? 'DONE' : '');
      row.root.setAlpha(unlocked ? 1 : 0.72);
    });

    this.showPageButton(this.previousPage, this.page > 0);
    this.showPageButton(this.nextPage, this.page < this.pageCount - 1);
    this.pageLabel.setText(`${this.page + 1} / ${this.pageCount}`);
  }

  relayout(): void {
    const l = theme.layout;
    this.shade.setPosition(l.width / 2, l.height / 2).setSize(l.width, l.height);

    const width = l.landscape ? Math.min(900, l.width - 64) : l.width - 56;
    const height = l.landscape ? Math.min(l.height - 44, 660) : Math.min(940, l.height - 120);
    const centerX = l.width / 2;
    const top = (l.height - height) / 2;

    this.panel.setPosition(centerX, top + height / 2).setSize(width, height);
    this.backing.setPosition(centerX, top + height / 2).setSize(width - 18, height - 18);
    this.titlePlate.setPosition(centerX, top + 30).setSize(l.landscape ? 300 : 340, 34);
    this.title.setPosition(centerX, top + 30);
    this.closeButton.setPosition(centerX + width / 2 - 34, top + 32);

    const left = centerX - width / 2 + 26;
    const right = centerX + width / 2 - 26;
    // Centred on half its own width, not a fixed offset: a fixed one hung the
    // plate over the panel's left bezel at every width below ~700.
    const rankWidth = Math.min(300, width - 200);
    this.rankPlate.setPosition(left + rankWidth / 2, top + 74).setSize(rankWidth, 30);
    this.rankLabel.setPosition(left + rankWidth / 2, top + 74);
    this.progressLabel.setPosition(right, top + 74);

    const listTop = top + 110;
    const footerY = top + height - 40;
    const rowGap = Math.max(52, (footerY - 34 - listTop) / PER_PAGE);
    this.rows.forEach((row, index) => {
      row.root.setPosition(left, listTop + rowGap * index);
      row.badge.setPosition(20, 16);
      row.name.setPosition(52, 6);
      row.description.setPosition(52, 26).setMaxWidth(width - 160);
      row.check.setPosition(right - left - 8, 16);
    });

    this.placePageButton(this.previousPage, centerX - Math.min(210, width / 2 - 46), footerY);
    this.placePageButton(this.nextPage, centerX + Math.min(210, width / 2 - 46), footerY);
    this.pageLabel.setPosition(centerX, footerY);
  }

  private get pageCount(): number {
    return Math.max(1, Math.ceil(ACHIEVEMENT_COUNT / PER_PAGE));
  }

  private dismiss(): void {
    if (!this.pressedOnShade) return;
    this.hide();
  }

  private turnTo(value: number): void {
    const target = Phaser.Math.Clamp(value, 0, this.pageCount - 1);
    if (target === this.page) return;
    this.page = target;
    this.sfx.play('drop');
    this.refresh();
    this.relayout();
  }

  private makeRow(): Row {
    const root = this.sceneRef.add.container(0, 0);
    const badge = this.sceneRef.add.image(0, 0, ATLAS_KEY, 'fx_star').setScale(1.2);
    const name = this.sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0, 0.5);
    const description = this.sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0, 0.5);
    const check = this.sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(1, 0.5).setTint(0x6fbf52);
    root.add([badge, name, description, check]);
    this.add(root);
    return { root, badge, name, description, check };
  }

  private makePageButton(frame: string, step: number): PageButton {
    const body = this.sceneRef.add.rectangle(0, 0, 84, 52, 0x2b1d12, 0.85).setStrokeStyle(3, 0x8a5c3a);
    const icon = this.sceneRef.add.image(0, 0, ATLAS_KEY, frame).setTint(0xffe58a);
    icon.setScale(24 / Math.max(1, icon.height));
    body.setInteractive();
    body.on('pointerdown', () => {
      this.sceneRef.tweens.add({ targets: [body, icon], scale: 0.92, yoyo: true, duration: 90 });
      this.turnTo(this.page + step);
    });
    // A press on a control must never reach the shade behind it, or turning
    // the page would also close the panel.
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
}
