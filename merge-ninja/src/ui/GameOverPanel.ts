import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { compactNumber, theme } from './theme';
import { bossForStage } from '../data/enemies';
import type { GameEvent } from '../core/EventBus';
import type { Sfx } from '../audio/Sfx';

/**
 * A stat line: the caption on the left, the number hard right, and a tag
 * between them carrying either the record just beaten or the one still
 * standing.
 */
interface Row {
  caption: Phaser.GameObjects.BitmapText;
  value: Phaser.GameObjects.BitmapText;
  tag: Phaser.GameObjects.BitmapText;
}

const mmss = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * The end of a run.
 *
 * There is one way out of this screen and it is the button: no tap-outside, no
 * close cross. Losing should land, and an accidental dismissal that drops the
 * player back onto a frozen board would read as the game having crashed.
 */
export class GameOverPanel extends Phaser.GameObjects.Container {
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly backing: Phaser.GameObjects.TileSprite;
  private readonly panel: Phaser.GameObjects.NineSlice;
  private readonly titlePlate: Phaser.GameObjects.NineSlice;
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly subtitle: Phaser.GameObjects.BitmapText;
  private readonly rows: Row[] = [];
  /** A soft, spoiler-free curiosity hook -- what's one stage past the player's best ever. Never a countdown, never urgent. */
  private readonly nextTease: Phaser.GameObjects.BitmapText;
  private readonly reviveBody: Phaser.GameObjects.Rectangle;
  private readonly reviveLabel: Phaser.GameObjects.BitmapText;
  private readonly buttonBody: Phaser.GameObjects.Rectangle;
  private readonly buttonLabel: Phaser.GameObjects.BitmapText;
  private open = false;
  /** Ignores taps for a moment: a finger already mid-merge must not restart. */
  private armedAt = 0;
  private revivePending = false;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly sfx: Sfx,
    private readonly onRestart: () => void,
    private readonly onRevive: () => Promise<boolean>,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(430).setVisible(false);

    const l = theme.layout;
    // Deep red rather than the settings panel's neutral shade: the screen state
    // has to be readable in the first half second, before any text is.
    this.shade = sceneRef.add.rectangle(l.width / 2, l.height / 2, l.width, l.height, 0x28070a, 0.88).setInteractive();
    this.backing = sceneRef.add.tileSprite(0, 0, 100, 100, 'tex_5').setTint(0x6a4a35);
    this.panel = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'frame_bezel', 100, 100, 20, 20, 20, 20);
    this.titlePlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 300, 38, 11, 11, 7, 7).setTint(0xd05450);
    this.title = sceneRef.add.bitmapText(0, 0, 'pixel', 'GAME OVER', 14).setOrigin(0.5).setTint(0xffffff);
    this.subtitle = sceneRef.add
      .bitmapText(0, 0, 'pixel', 'THE LINE IS DOWN.', 14)
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setTint(0xf0d6b6);
    this.add([this.shade, this.backing, this.panel, this.titlePlate, this.title, this.subtitle]);

    for (const caption of ['STAGE REACHED', 'BEST NINJA', 'COINS EARNED', 'SURVIVED']) {
      const row: Row = {
        caption: sceneRef.add.bitmapText(0, 0, 'pixel', caption, 14).setOrigin(0, 0.5).setTint(0xd8cfc4),
        value: sceneRef.add.bitmapText(0, 0, 'pixel', '-', 14).setOrigin(1, 0.5).setTint(0xffe58a),
        tag: sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0.5).setTint(0xcbb79a),
      };
      this.rows.push(row);
      this.add([row.caption, row.tag, row.value]);
    }

    this.nextTease = sceneRef.add
      .bitmapText(0, 0, 'pixel', '', 10)
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setTint(0xb9ac9d);
    this.add(this.nextTease);

    this.reviveBody = sceneRef.add.rectangle(0, 0, 260, 52, 0x548ac4).setStrokeStyle(4, 0x244c78);
    this.reviveLabel = sceneRef.add.bitmapText(0, 0, 'pixel', 'WATCH AD: REVIVE', 14).setOrigin(0.5).setTint(0xffffff);
    this.reviveBody.setInteractive();
    this.reviveBody.on('pointerup', () => { void this.tryRevive(); });
    this.add([this.reviveBody, this.reviveLabel]);

    this.buttonBody = sceneRef.add.rectangle(0, 0, 260, 58, theme.colors.buy).setStrokeStyle(4, 0x14520f);
    this.buttonLabel = sceneRef.add.bitmapText(0, 0, 'pixel', 'TRY AGAIN', 14).setOrigin(0.5).setTint(0xffffff);
    this.buttonBody.setInteractive();
    this.buttonBody.on('pointerup', () => this.tryRestart());
    this.add([this.buttonBody, this.buttonLabel]);

    this.relayout();
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(event: Extract<GameEvent, { type: 'gameOver' }>): void {
    if (this.open) return;
    this.open = true;
    this.revivePending = false;
    this.reviveBody.setVisible(true).setAlpha(1).setInteractive();
    this.reviveLabel.setVisible(true).setText('WATCH AD: REVIVE');
    this.armedAt = this.sceneRef.time.now + 400;

    const values = [
      String(event.stage),
      `LV.${event.highestTier}`,
      compactNumber(event.coinsEarned),
      mmss(event.timePlayedMs),
    ];
    // What the record board holds now, formatted the same way as the run's own
    // numbers so the two read as comparable at a glance.
    const bests = [
      String(event.best.stage),
      `LV.${event.best.tier}`,
      compactNumber(event.best.coins),
      mmss(event.best.timeMs),
    ];
    const beaten = [
      event.records.stage,
      event.records.tier,
      event.records.coins,
      event.records.timeMs,
    ];

    this.rows.forEach((row, index) => {
      row.value.setText(values[index] ?? '-');
      const isRecord = beaten[index] === true;
      // A beaten record shouts; a standing one is quiet information the player
      // can aim at next run. Never a nag, never red.
      row.tag.setText(isRecord ? 'NEW BEST!' : `BEST ${bests[index] ?? '-'}`);
      row.tag.setTint(isRecord ? 0xffd23f : 0x9a8f84);
      row.value.setTint(isRecord ? 0xfff6dd : 0xffe58a);
    });

    const celebrating = beaten.some((flag) => flag);
    this.title.setText(celebrating ? 'NEW BEST!' : 'GAME OVER');
    this.titlePlate.setTint(celebrating ? 0xd9a441 : 0xd05450);
    // Kept to one line at the panel's narrowest: the subtitle sits 50px above
    // the first stat row, and a wrapped second line would land on top of it.
    this.subtitle.setText(celebrating ? 'YOU WENT FURTHER THAN EVER.' : 'THE LINE IS DOWN.');
    // Purely informational curiosity hook: what's one stage past the player's
    // best ever, named plainly. No countdown, no penalty for not returning.
    const next = bossForStage(event.best.stage + 1);
    this.nextTease.setText(`NEXT UP: ${next.name.toUpperCase()}`);

    this.relayout();
    this.setVisible(true).setAlpha(0);
    this.sceneRef.tweens.add({ targets: this, alpha: 1, duration: 320 });
    // A short drop onto the screen, so the panel arrives rather than appearing.
    this.panel.setScale(0.9);
    this.sceneRef.tweens.add({ targets: this.panel, scale: 1, duration: 320, ease: 'Back.easeOut' });
    if (celebrating) this.flashRecords();
    this.sfx.play(celebrating ? 'newTier' : 'defeat');
  }

  /**
   * A short pop on each beaten record, staggered down the list.
   *
   * The run is over and nothing is at stake any more, so this is the whole
   * reward: the eye is walked down the panel and told, one line at a time,
   * which parts of that run were the best the player has ever managed.
   */
  private flashRecords(): void {
    this.rows.forEach((row, index) => {
      if (row.tag.text !== 'NEW BEST!') return;
      this.sceneRef.tweens.killTweensOf(row.tag);
      row.tag.setScale(1);
      this.sceneRef.tweens.add({
        targets: row.tag,
        scale: { from: 1.6, to: 1 },
        duration: 340,
        delay: 260 + index * 120,
        ease: 'Back.easeOut',
      });
    });
  }

  hide(): void {
    this.open = false;
    this.setVisible(false).setAlpha(1);
  }

  /** Game-space anchors for the post-run choices, for the verification harness. */
  anchors(): { tryAgain: { x: number; y: number }; revive: { x: number; y: number } } {
    return {
      tryAgain: { x: this.buttonBody.x, y: this.buttonBody.y },
      revive: { x: this.reviveBody.x, y: this.reviveBody.y },
    };
  }

  relayout(): void {
    const l = theme.layout;
    this.shade.setPosition(l.width / 2, l.height / 2).setSize(l.width, l.height);

    const width = Math.min(l.landscape ? 560 : 600, l.width - 56);
    const height = Math.min(450, l.height - 80);
    const centerX = l.width / 2;
    const top = (l.height - height) / 2;

    this.panel.setPosition(centerX, top + height / 2).setSize(width, height);
    this.backing.setPosition(centerX, top + height / 2).setSize(width - 18, height - 18);
    this.titlePlate.setPosition(centerX, top + 34).setSize(Math.min(320, width - 80), 38);
    this.title.setPosition(centerX, top + 34);
    this.subtitle.setPosition(centerX, top + 66).setMaxWidth(width - 72);

    const rowLeft = centerX - width / 2 + 44;
    const rowRight = centerX + width / 2 - 44;
    const rowTop = top + 116;
    const rowGap = Math.min(42, (height - 232) / 3);
    // The tag rides two thirds of the way across: clear of the longest caption
    // on the left and of the widest value on the right.
    const tagX = rowLeft + (rowRight - rowLeft) * 0.68;
    this.rows.forEach((row, index) => {
      row.caption.setPosition(rowLeft, rowTop + rowGap * index);
      row.tag.setPosition(tagX, rowTop + rowGap * index);
      row.value.setPosition(rowRight, rowTop + rowGap * index);
    });

    const buttonY = top + height - 48;
    // Sits in the gap between the last stat row and the button; the row loop
    // above always leaves at least ~60px here (rowGap is capped at 42 for four
    // rows against this panel's minimum height).
    this.nextTease.setPosition(centerX, buttonY - 116).setMaxWidth(width - 64);
    const buttonWidth = Math.min(300, width - 96);
    this.reviveBody.setPosition(centerX, buttonY - 62).setSize(buttonWidth, 52);
    this.reviveBody.setInteractive(new Phaser.Geom.Rectangle(0, 0, buttonWidth, 52), Phaser.Geom.Rectangle.Contains);
    this.reviveLabel.setPosition(centerX, buttonY - 62);
    this.buttonBody.setPosition(centerX, buttonY).setSize(buttonWidth, 58);
    // A resized Rectangle keeps its old hit area, so the shape is re-set here.
    this.buttonBody.setInteractive(new Phaser.Geom.Rectangle(0, 0, buttonWidth, 58), Phaser.Geom.Rectangle.Contains);
    this.buttonLabel.setPosition(centerX, buttonY);
  }

  private tryRestart(): void {
    if (!this.open || this.sceneRef.time.now < this.armedAt) return;
    this.sfx.play('click');
    this.sceneRef.tweens.add({ targets: [this.buttonBody, this.buttonLabel], scale: 0.95, yoyo: true, duration: 80 });
    this.open = false;
    this.onRestart();
  }

  private async tryRevive(): Promise<void> {
    if (!this.open || this.revivePending || this.sceneRef.time.now < this.armedAt) return;
    this.revivePending = true;
    this.sfx.play('click');
    this.reviveBody.disableInteractive().setFillStyle(0x75879b);
    this.reviveLabel.setText('LOADING AD...');
    const revived = await this.onRevive();
    if (revived) return;
    this.revivePending = false;
    this.reviveBody.setFillStyle(0x548ac4).setInteractive();
    this.reviveLabel.setText('AD UNAVAILABLE — TRY AGAIN');
  }
}
