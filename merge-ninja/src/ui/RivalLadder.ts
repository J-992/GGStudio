import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import { nextRivalIndex, rivalMilestone } from '../data/rivals';
import { ATLAS_KEY } from '../render/atlasConfig';
import { theme } from './theme';
import type { DojoStyleDef } from '../data/dojoStyles';
import { CLASSIC_DOJO_STYLE } from '../data/dojoStyles';

const PANEL_WIDTH = 270;
const PANEL_HEIGHT = 94;
const TRACK_WIDTH = 160;

/**
 * The scroll hangs from a fixed right-hand rod and pulls open to the left, so
 * the anchor point is the roll -- not the middle of the paper. Everything the
 * scroll says lives in a sub-container centred on the *open* sheet, which is
 * what keeps the readable layout independent of how far it has unfurled.
 */
const ROD_HALF_WIDTH = 8;
/** Rods stand proud of the paper at both ends; that overhang is the scroll read. */
const ROD_OVERHANG = 8;
const ROLL_CENTRE_X = -12;
const SHEET_CENTRE_X = ROLL_CENTRE_X - PANEL_WIDTH / 2;
/**
 * The paper never closes to nothing: a sliver of parchment left showing between
 * the two rods is what makes a shut scroll read as a coil rather than a stick.
 */
const ROLLED_WIDTH = 7;

/**
 * How far open the paper has to be before its text starts to fade up. The mask
 * already clips the ink to the paper, so this only stops a half-open scroll
 * from showing a sliver of a letter.
 */
const INK_APPEARS_AT = 0.22;

/** A tap has no hover to end it, so an opened scroll rolls itself back up. */
const TOUCH_HOLD_MS = 4_000;
/** Long enough to read a new rival's name after the arena hands one over. */
const ANNOUNCE_HOLD_MS = 2_600;

/** One readable target, modelled after an endless-runner friend marker. */
export class RivalLadder extends Phaser.GameObjects.Container {
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly rivalName: Phaser.GameObjects.BitmapText;
  private readonly stageText: Phaser.GameObjects.BitmapText;
  private readonly distance: Phaser.GameObjects.BitmapText;
  private readonly trackFill: Phaser.GameObjects.Rectangle;
  private readonly playerDot: Phaser.GameObjects.Arc;
  private readonly avatar: Phaser.GameObjects.Image;
  private readonly beat: Phaser.GameObjects.BitmapText;
  private readonly parchment: Phaser.GameObjects.Graphics;
  private readonly avatarPlate: Phaser.GameObjects.Arc;
  private readonly sheet: Phaser.GameObjects.Container;
  /** Clips the writing to the drawn paper, so the text unrolls with the scroll. */
  private readonly paperMask: Phaser.GameObjects.Graphics;
  /** Tweened rather than assigned so the paper can be redrawn every frame. */
  private readonly unfurl = { amount: 0 };
  private unfurlTween?: Phaser.Tweens.Tween;
  private rollUpTimer?: Phaser.Time.TimerEvent;
  private nextIndex: number;
  private style: DojoStyleDef = CLASSIC_DOJO_STYLE;

  constructor(private readonly sceneRef: Phaser.Scene, core: GameCore) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(32);

    this.parchment = sceneRef.add.graphics();
    const trackBack = sceneRef.add.rectangle(-27, 16, TRACK_WIDTH, 12, 0x3a2618, 0.84).setStrokeStyle(1, 0x76502d, 1);
    this.trackFill = sceneRef.add.rectangle(-107, 16, 1, 8, theme.colors.positive, 1).setOrigin(0, 0.5);
    this.playerDot = sceneRef.add.circle(-107, 16, 6, 0xfff0b8, 1).setStrokeStyle(2, 0x50331e, 1);
    this.avatarPlate = sceneRef.add.circle(97, 0, 31, 0x37251b, 1).setStrokeStyle(3, theme.colors.brass, 1);
    this.title = sceneRef.add.bitmapText(-118, -31, 'pixel', 'NEXT RIVAL:', 11).setOrigin(0, 0.5).setTint(theme.colors.parchmentInk);
    this.rivalName = sceneRef.add.bitmapText(-118, -9, 'pixel', '', 18).setOrigin(0, 0.5).setTint(theme.colors.parchmentInk);
    this.stageText = sceneRef.add.bitmapText(57, -8, 'pixel', '', 11).setOrigin(1, 0.5).setTint(0x694528);
    this.distance = sceneRef.add.bitmapText(-27, 34, 'pixel', '', 11).setOrigin(0.5).setTint(0x694528);
    this.avatar = sceneRef.add.image(97, 0, ATLAS_KEY, 'ninja_t1').setDisplaySize(56, 56);
    this.beat = sceneRef.add.bitmapText(0, -1, 'pixel', '', 14).setOrigin(0.5).setTint(theme.colors.parchmentInk).setVisible(false);
    this.sheet = sceneRef.add.container(SHEET_CENTRE_X, 0, [
      this.avatarPlate,
      trackBack,
      this.trackFill,
      this.playerDot,
      this.title,
      this.rivalName,
      this.stageText,
      this.distance,
      this.avatar,
      this.beat,
    ]);
    this.add([this.parchment, this.sheet]);
    // Kept off the display list: a mask shape is geometry, never something the
    // camera should draw. It works in world space, so it is redrawn from this
    // container's world transform whenever the paper or the layout moves.
    this.paperMask = sceneRef.make.graphics();
    this.sheet.setMask(this.paperMask.createGeometryMask());
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.paperMask.destroy());

    // Only the rolled scroll is clickable while it is shut: a hit box the width
    // of the open sheet would eat pointer events across a third of the arena.
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, 1, 1),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    this.on(Phaser.Input.Events.POINTER_OVER, () => this.openScroll());
    // A touch pointer reports "out" the instant the finger lifts, so a tap that
    // asked for a timed hold must not be cancelled by its own release.
    this.on(Phaser.Input.Events.POINTER_OUT, () => {
      if (this.rollUpTimer === undefined) this.closeScroll();
    });
    this.on(Phaser.Input.Events.POINTER_DOWN, () => this.openScroll(TOUCH_HOLD_MS));

    this.nextIndex = nextRivalIndex(core.boss.stage);
    this.redrawParchment();
    this.refresh(core.boss.stage, false);
    core.events.on('bossSpawned', (event) => this.refresh(event.stage, true));
    this.relayout();
  }

  relayout(): void {
    const a = theme.layout.arena;
    this.setPosition(a.x + a.w - 13, a.y + Math.min(174, a.h * 0.31));
    this.setScale(Math.min(1, Math.max(0.9, a.w / 735)));
    this.redrawParchment();
  }

  applyDojoStyle(style: DojoStyleDef): void {
    this.style = style;
    this.redrawParchment();
    this.avatarPlate.setStrokeStyle(3, style.palette.accent, 1);
  }

  /** Read-only hook for UI verification. */
  nextTargetStage(): number {
    return rivalMilestone(this.nextIndex).stage;
  }

  /** Read-only hook for UI verification: 0 is fully rolled up, 1 fully open. */
  unfurlAmount(): number {
    return this.unfurl.amount;
  }

  /**
   * @param holdMs keep it open this long with no pointer on it. Hover leaves it
   * at 0 so moving the mouse away rolls it straight back up.
   */
  private openScroll(holdMs = 0): void {
    // A touch reports down *before* over, so a plain hover-open must never
    // clear a hold a tap just asked for -- that ordering is what makes a tap
    // open and instantly shut again on a phone.
    if (holdMs > 0) {
      this.rollUpTimer?.remove();
      this.rollUpTimer = this.sceneRef.time.delayedCall(holdMs, () => this.closeScroll());
    }
    this.tweenUnfurl(1, 300, 'Cubic.easeOut');
  }

  private closeScroll(): void {
    this.rollUpTimer?.remove();
    this.rollUpTimer = undefined;
    this.tweenUnfurl(0, 220, 'Cubic.easeIn');
  }

  private tweenUnfurl(amount: number, duration: number, ease: string): void {
    if (this.unfurl.amount === amount && this.unfurlTween === undefined) return;
    this.unfurlTween?.stop();
    this.unfurlTween = this.sceneRef.tweens.add({
      targets: this.unfurl,
      amount,
      duration: duration * Math.abs(amount - this.unfurl.amount),
      ease,
      onUpdate: () => this.redrawParchment(),
      onComplete: () => {
        this.unfurlTween = undefined;
        this.redrawParchment();
      },
    });
  }

  private refresh(stage: number, celebrate: boolean): void {
    const safeStage = Math.max(1, Math.floor(stage));
    const next = nextRivalIndex(safeStage);
    const beatenRival = rivalMilestone(this.nextIndex);
    const beaten = celebrate && next > this.nextIndex;
    this.nextIndex = next;

    const target = rivalMilestone(next);
    const previousStage = next === 0 ? 1 : rivalMilestone(next - 1).stage;
    const progress = Phaser.Math.Clamp((safeStage - previousStage) / Math.max(1, target.stage - previousStage), 0, 1);
    const fillWidth = Math.max(1, TRACK_WIDTH * progress);
    const away = Math.max(1, target.stage - safeStage);

    this.avatar.setFrame(`ninja_t${target.avatarTier}`);
    this.rivalName.setText(target.name);
    this.stageText.setText(`STAGE ${target.stage}`);
    this.distance.setText(`${away} STAGE${away === 1 ? '' : 'S'} LEFT`);
    this.trackFill.setSize(fillWidth, 8);
    this.playerDot.setX(-107 + fillWidth);

    if (!beaten) return;
    // A rival falling is the one moment the scroll opens itself: the news is
    // worthless if it plays out inside a rolled-up tube.
    this.openScroll(ANNOUNCE_HOLD_MS);
    this.title.setVisible(false);
    this.stageText.setVisible(false);
    this.beat.setText(`YOU PASSED ${beatenRival.name}!`).setAlpha(0).setVisible(true);
    this.sceneRef.tweens.add({
      targets: this.beat,
      alpha: { from: 0, to: 1 },
      scale: { from: 0.8, to: 1 },
      duration: 260,
      ease: 'Back.easeOut',
    });
    this.sceneRef.tweens.add({ targets: this.avatar, scale: { from: 0.72, to: 1 }, duration: 330, ease: 'Back.easeOut' });
    this.sceneRef.time.delayedCall(1_250, () => {
      this.sceneRef.tweens.add({
        targets: this.beat,
        alpha: 0,
        duration: 180,
        onComplete: () => {
          this.beat.setVisible(false);
          this.title.setVisible(true);
          this.stageText.setVisible(true);
        },
      });
    });
  }

  /** One brass-capped wooden rod, drawn standing proud of the paper's edge. */
  private drawRod(x: number, wood: number, brass: number): void {
    const half = PANEL_HEIGHT / 2 + ROD_OVERHANG;
    this.parchment
      .fillStyle(wood, 1)
      .fillRoundedRect(x - ROD_HALF_WIDTH, -half, ROD_HALF_WIDTH * 2, half * 2, ROD_HALF_WIDTH)
      .fillStyle(0xffedbd, 0.22)
      .fillRect(x - ROD_HALF_WIDTH + 2, -half + 6, 2, half * 2 - 12)
      .fillStyle(brass, 1)
      .fillCircle(x, -half + 5, 6)
      .fillCircle(x, half - 5, 6)
      .fillStyle(0xffedbd, 0.5)
      .fillCircle(x - 1, -half + 4, 2)
      .fillCircle(x - 1, half - 6, 2);
  }

  /**
   * The cord that holds a shut scroll closed. It is the only affordance the
   * rolled state has, so it fades out the moment the paper starts to move.
   */
  private drawTieCord(left: number, open: number, brass: number): void {
    const strength = Phaser.Math.Clamp(1 - open / 0.18, 0, 1);
    if (strength <= 0) return;
    const centre = (left + ROLL_CENTRE_X) / 2;
    const span = ROLL_CENTRE_X - left + ROD_HALF_WIDTH * 2 + 2;
    this.parchment
      .fillStyle(0x3b2517, 0.8 * strength)
      .fillRect(centre - span / 2, -9, span, 4)
      .fillRect(centre - span / 2, 5, span, 4)
      .fillStyle(brass, 0.9 * strength)
      .fillCircle(centre, -2, 4);
  }

  private redrawParchment(): void {
    const p = this.style.palette;
    const paper = this.style.id === 'crimson-dojo' ? 0xd9b77b : theme.colors.parchment;
    const ink = this.style.id === 'crimson-dojo' ? p.panelDark : theme.colors.parchmentInk;
    const open = this.unfurl.amount;
    const width = ROLLED_WIDTH + (PANEL_WIDTH - ROLLED_WIDTH) * open;
    const left = ROLL_CENTRE_X - width;
    const top = -PANEL_HEIGHT / 2;
    const height = PANEL_HEIGHT - 4;

    this.parchment
      .clear()
      .fillStyle(0x050506, 0.46)
      .fillRoundedRect(left + 2, top + 5, width, height + 2, 5)
      .fillStyle(paper, 1)
      .fillRoundedRect(left, top, width, height, 4)
      // The paper curls back into each rod; without the shading either side
      // the sheet reads as a flat card with sticks glued to it.
      .fillStyle(0x6b4a26, 0.3)
      .fillRect(left, top + 2, 7, height - 4)
      .fillRect(ROLL_CENTRE_X - 7, top + 2, 7, height - 4)
      .lineStyle(2, p.accent, 0.92)
      .strokeRoundedRect(left, top, width, height, 4);
    if (open > 0.2) {
      this.parchment
        .lineStyle(1, 0xffedbd, 0.58)
        .lineBetween(left + 10, top + 5, ROLL_CENTRE_X - 10, top + 5);
    }
    this.drawRod(ROLL_CENTRE_X, 0x8a5f33, p.accent);
    // At rest both rods sit on top of one another, which is exactly what a
    // rolled scroll looks like end-on.
    this.drawRod(left, 0x76502d, p.accent);
    this.drawTieCord(left, open, p.accent);

    const readable = Phaser.Math.Clamp((open - INK_APPEARS_AT) / 0.3, 0, 1);
    this.sheet.setAlpha(readable).setVisible(readable > 0);
    this.clipToPaper(left, top, width, height);
    this.resizeHitArea(width);
    for (const text of [this.title, this.rivalName, this.stageText, this.distance, this.beat]) text.setTint(ink);
  }

  /** Redraws the geometry mask over whatever slice of paper is currently out. */
  private clipToPaper(left: number, top: number, width: number, height: number): void {
    const world = this.getWorldTransformMatrix();
    this.paperMask
      .clear()
      .fillStyle(0xffffff)
      .fillRect(
        world.tx + left * world.scaleX,
        world.ty + top * world.scaleY,
        width * world.scaleX,
        height * world.scaleY,
      );
  }

  /** Grows with the paper so an open scroll stays open while the pointer is on it. */
  private resizeHitArea(width: number): void {
    const hitArea = this.input?.hitArea as Phaser.Geom.Rectangle | undefined;
    if (hitArea === undefined) return;
    const half = PANEL_HEIGHT / 2 + ROD_OVERHANG;
    const right = ROLL_CENTRE_X + ROD_HALF_WIDTH;
    const left = Math.min(ROLL_CENTRE_X - ROD_HALF_WIDTH, ROLL_CENTRE_X - width - ROD_HALF_WIDTH);
    hitArea.setTo(left, -half, right - left, half * 2);
  }
}
