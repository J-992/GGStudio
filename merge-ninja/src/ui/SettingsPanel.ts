import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { theme } from './theme';
import type { Sfx } from '../audio/Sfx';

interface Slider {
  label: Phaser.GameObjects.BitmapText;
  track: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  knob: Phaser.GameObjects.Rectangle;
  readout: Phaser.GameObjects.BitmapText;
  apply: (value: number) => void;
  read: () => number;
}

/**
 * A plate and its caption, kept as two loose objects rather than a container:
 * the pressable thing is the rectangle itself, which is the same arrangement
 * the sliders use and the same one the rest of the game's buttons use.
 */
interface Button {
  body: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.BitmapText;
}

/** Volume moves in twentieths: fine enough to feel free, coarse enough to hit. */
const STEP = 1 / 20;

/**
 * The settings screen: one slider per audio channel and the way to wipe a run
 * and start again.
 *
 * Restarting is deliberately two taps. Everything else in the panel is
 * reversible by moving the slider back, and this one is not.
 */
export class SettingsPanel extends Phaser.GameObjects.Container {
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly backing: Phaser.GameObjects.TileSprite;
  private readonly panel: Phaser.GameObjects.NineSlice;
  private readonly titlePlate: Phaser.GameObjects.NineSlice;
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly closeButton: Phaser.GameObjects.Image;
  private readonly music: Slider;
  private readonly sfxSlider: Slider;
  private readonly restartCaption: Phaser.GameObjects.BitmapText;
  private readonly restartHint: Phaser.GameObjects.BitmapText;
  private readonly restartButton: Button;
  private readonly cancelButton: Button;
  private readonly confirmButton: Button;
  private open = false;
  private armed = false;
  /** Set by a press that landed on the shade; only those may close the panel. */
  private pressedOnShade = false;
  private dragging: Slider | null = null;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly sfx: Sfx,
    private readonly onRestart: () => void,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(410).setVisible(false);

    const l = theme.layout;
    this.shade = sceneRef.add.rectangle(l.width / 2, l.height / 2, l.width, l.height, 0x0b1119, 0.82).setInteractive();
    this.backing = sceneRef.add.tileSprite(0, 0, 100, 100, 'tex_5').setTint(0x6a4a35);
    this.panel = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'frame_bezel', 100, 100, 20, 20, 20, 20);
    this.titlePlate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'banner_name_9', 260, 34, 11, 11, 7, 7);
    this.title = sceneRef.add.bitmapText(0, 0, 'pixel', 'SETTINGS', 14).setOrigin(0.5).setTint(0xffffff);
    this.closeButton = sceneRef.add.image(0, 0, ATLAS_KEY, 'btn_back').setScale(1.4);
    this.closeButton.setInteractive(new Phaser.Geom.Rectangle(-12, -12, 53, 53), Phaser.Geom.Rectangle.Contains);
    this.closeButton.on('pointerup', () => { this.sfx.play('click'); this.hide(); });
    // A press that starts on the shade and ends there is a tap outside the
    // panel. Releasing there after dragging a slider off its track is not.
    this.shade.on('pointerdown', () => { this.pressedOnShade = true; });
    this.shade.on('pointerup', () => {
      if (!this.pressedOnShade || this.dragging !== null) return;
      this.sfx.play('click');
      this.hide();
    });

    this.add([this.shade, this.backing, this.panel, this.titlePlate, this.title, this.closeButton]);

    this.music = this.makeSlider('MUSIC', (value) => this.sfx.setMusicVolume(value), () => this.sfx.musicVolume);
    this.sfxSlider = this.makeSlider('SOUND', (value) => this.sfx.setSfxVolume(value), () => this.sfx.sfxVolume);

    this.restartCaption = sceneRef.add.bitmapText(0, 0, 'pixel', 'RESTART RUN', 14).setOrigin(0.5).setTint(0xffe58a);
    this.restartHint = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0.5, 0).setCenterAlign().setTint(0xd8cfc4);
    this.add([this.restartCaption, this.restartHint]);

    this.restartButton = this.makeButton('RESTART RUN', theme.colors.trash, 0x7a1f1c, () => this.arm(true));
    this.cancelButton = this.makeButton('KEEP PLAYING', 0x6d6058, 0x3b332e, () => this.arm(false));
    this.confirmButton = this.makeButton('YES, WIPE IT', theme.colors.trash, 0x7a1f1c, () => this.confirmRestart());
    this.arm(false);

    // Dragging is tracked on the scene: a finger that slides off the narrow
    // track should keep moving the knob until it is lifted.
    sceneRef.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.dragging !== null) this.applyFromPointer(this.dragging, pointer);
    });
    for (const event of ['pointerup', 'pointerupoutside'] as const) {
      sceneRef.input.on(event, () => { this.dragging = null; });
    }

    this.relayout();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** The gear is a toggle, so a second tap on it closes the panel. */
  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.pressedOnShade = false;
    this.dragging = null;
    this.arm(false);
    this.syncFromAudio();
    this.relayout();
    this.setVisible(true).setAlpha(0);
    this.sceneRef.tweens.add({ targets: this, alpha: 1, duration: 160 });
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.pressedOnShade = false;
    this.dragging = null;
    this.arm(false);
    this.sceneRef.tweens.add({
      targets: this,
      alpha: 0,
      duration: 140,
      onComplete: () => this.setVisible(false).setAlpha(1),
    });
  }

  /**
   * Game-space anchors for the controls, in the same spirit as the board's
   * `slotPos`: the verification harness has to aim a real pointer at them.
   */
  anchors(): {
    music: { left: number; right: number; y: number };
    sfx: { left: number; right: number; y: number };
    restart: { x: number; y: number };
    cancel: { x: number; y: number };
    confirm: { x: number; y: number };
  } {
    const track = (slider: Slider): { left: number; right: number; y: number } => ({
      left: slider.track.x - slider.track.width / 2,
      right: slider.track.x + slider.track.width / 2,
      y: slider.track.y,
    });
    return {
      music: track(this.music),
      sfx: track(this.sfxSlider),
      restart: { x: this.restartButton.body.x, y: this.restartButton.body.y },
      cancel: { x: this.cancelButton.body.x, y: this.cancelButton.body.y },
      confirm: { x: this.confirmButton.body.x, y: this.confirmButton.body.y },
    };
  }

  /** Re-reads both channels, so a value changed elsewhere still shows here. */
  syncFromAudio(): void {
    this.paint(this.music, this.music.read());
    this.paint(this.sfxSlider, this.sfxSlider.read());
  }

  relayout(): void {
    const l = theme.layout;
    this.shade.setPosition(l.width / 2, l.height / 2).setSize(l.width, l.height);

    const width = Math.min(l.landscape ? 620 : 600, l.width - 56);
    // Height follows the contents rather than filling the screen: two sliders
    // and one confirm do not need a page, and a half-empty plate looks broken.
    const restartBlock = l.landscape ? 148 : 168;
    const height = Math.min(214 + restartBlock, l.height - 80);
    const centerX = l.width / 2;
    const top = (l.height - height) / 2;

    this.panel.setPosition(centerX, top + height / 2).setSize(width, height);
    this.backing.setPosition(centerX, top + height / 2).setSize(width - 18, height - 18);
    this.titlePlate.setPosition(centerX, top + 30).setSize(Math.min(300, width - 90), 34);
    this.title.setPosition(centerX, top + 30);
    this.closeButton.setPosition(centerX + width / 2 - 34, top + 32);

    // Audio block sits under the title, the restart block against the bottom
    // edge, and the space between them absorbs whatever height is going.
    const trackWidth = Math.min(300, width - 250);
    const rowLeft = centerX - width / 2 + 34;
    const audioTop = top + 92;
    const rowGap = 58;
    this.placeSlider(this.music, rowLeft, audioTop, trackWidth, width);
    this.placeSlider(this.sfxSlider, rowLeft, audioTop + rowGap, trackWidth, width);

    const restartTop = top + height - restartBlock;
    this.restartCaption.setPosition(centerX, restartTop);
    this.restartHint.setPosition(centerX, restartTop + 18).setMaxWidth(width - 72);
    const buttonY = restartTop + (l.landscape ? 88 : 96);
    const buttonWidth = Math.min(232, (width - 96) / 2);
    this.placeButton(this.restartButton, centerX, buttonY, Math.min(280, width - 96), 52);
    this.placeButton(this.cancelButton, centerX - buttonWidth / 2 - 8, buttonY, buttonWidth, 52);
    this.placeButton(this.confirmButton, centerX + buttonWidth / 2 + 8, buttonY, buttonWidth, 52);

    this.syncFromAudio();
  }

  private makeSlider(caption: string, write: (value: number) => void, read: () => number): Slider {
    const label = this.sceneRef.add.bitmapText(0, 0, 'pixel', caption, 14).setOrigin(0, 0.5).setTint(0xffffff);
    const track = this.sceneRef.add.rectangle(0, 0, 100, 14, 0x2b1d12).setStrokeStyle(2, 0x8a5c3a);
    const fill = this.sceneRef.add.rectangle(0, 0, 0, 10, theme.colors.slotActive).setOrigin(0, 0.5);
    const knob = this.sceneRef.add.rectangle(0, 0, 22, 34, 0xe9ece6).setStrokeStyle(3, 0x2b1d12);
    const readout = this.sceneRef.add.bitmapText(0, 0, 'pixel', '100%', 14).setOrigin(1, 0.5).setTint(0xffe58a);
    const slider: Slider = { label, track, fill, knob, readout, apply: write, read };

    // The whole row height is grabbable, not just the 14px bar: a thin track is
    // a miserable target on a phone.
    for (const target of [track, knob]) {
      target.setInteractive();
      target.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.dragging = slider;
        this.applyFromPointer(slider, pointer);
      });
    }

    this.add([label, track, fill, knob, readout]);
    return slider;
  }

  private placeSlider(slider: Slider, left: number, y: number, trackWidth: number, panelWidth: number): void {
    const trackLeft = left + 122;
    slider.label.setPosition(left, y);
    slider.track.setPosition(trackLeft + trackWidth / 2, y).setSize(trackWidth, 14);
    slider.track.setInteractive(new Phaser.Geom.Rectangle(-4, -19, trackWidth + 8, 52), Phaser.Geom.Rectangle.Contains);
    slider.fill.setPosition(trackLeft, y);
    slider.knob.setPosition(trackLeft, y);
    slider.readout.setPosition(left + panelWidth - 68, y);
    this.paint(slider, slider.read());
  }

  private applyFromPointer(slider: Slider, pointer: Phaser.Input.Pointer): void {
    const trackWidth = slider.track.width;
    const trackLeft = slider.track.x - trackWidth / 2;
    const raw = (pointer.worldX - trackLeft) / Math.max(1, trackWidth);
    const snapped = Math.round(Math.max(0, Math.min(1, raw)) / STEP) * STEP;
    if (Math.abs(snapped - slider.read()) < STEP / 2) return;
    slider.apply(snapped);
    this.paint(slider, snapped);
    this.sfx.play('pickup');
  }

  private paint(slider: Slider, value: number): void {
    const trackWidth = slider.track.width;
    const trackLeft = slider.track.x - trackWidth / 2;
    const clamped = Math.max(0, Math.min(1, value));
    slider.fill.setPosition(trackLeft, slider.track.y).setSize(trackWidth * clamped, 10);
    slider.knob.setPosition(trackLeft + trackWidth * clamped, slider.track.y);
    slider.readout.setText(`${Math.round(clamped * 100)}%`);
  }

  private makeButton(caption: string, fill: number, stroke: number, onPress: () => void): Button {
    const body = this.sceneRef.add.rectangle(0, 0, 200, 52, fill).setStrokeStyle(4, stroke);
    const label = this.sceneRef.add.bitmapText(0, 0, 'pixel', caption, 14).setOrigin(0.5).setTint(0xffffff);
    body.setInteractive();
    body.on('pointerup', () => {
      this.sfx.play('click');
      this.sceneRef.tweens.add({ targets: [body, label], scale: 0.95, yoyo: true, duration: 80 });
      onPress();
    });
    this.add([body, label]);
    return { body, label };
  }

  private placeButton(button: Button, x: number, y: number, width: number, height: number): void {
    button.body.setPosition(x, y).setSize(width, height);
    // A resized Rectangle keeps its old hit area, so the shape is re-set here
    // rather than only at construction.
    button.body.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    button.label.setPosition(x, y);
  }

  private showButton(button: Button, visible: boolean): void {
    button.body.setVisible(visible);
    button.label.setVisible(visible);
  }

  private arm(armed: boolean): void {
    this.armed = armed;
    // The bitmap font has no lowercase glyphs, so every caption is shouted.
    this.restartHint.setText(armed
      ? 'COINS, ROSTER AND BOSS PROGRESS ALL GO.\nTHIS CANNOT BE UNDONE.'
      : 'START OVER FROM AN EMPTY DOJO.');
    this.showButton(this.restartButton, !armed);
    this.showButton(this.cancelButton, armed);
    this.showButton(this.confirmButton, armed);
  }

  private confirmRestart(): void {
    if (!this.armed) return;
    this.hide();
    this.onRestart();
  }
}
