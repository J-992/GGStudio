import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import { theme } from './theme';

/** The board lessons, in the order a player can first meet them. */
export type BoardLessonId = 'lockedSlots' | 'debris';

interface Lesson {
  readonly id: BoardLessonId;
  readonly title: string;
  readonly copy: (core: GameCore) => string;
}

const LESSONS: readonly Lesson[] = [
  {
    id: 'lockedSlots',
    title: 'LOCKED SLOTS',
    copy: (core) => {
      const stage = core.nextUnlockStage;
      return stage === null
        ? 'EVERY SLOT IS OPEN'
        : `BEAT STAGE ${stage} TO UNLOCK ONE`;
    },
  },
  {
    id: 'debris',
    title: 'SHURIKEN STUCK!',
    copy: () => 'MERGE NEXT TO IT TO KNOCK IT OUT',
  },
];

const HOLD_MS = 3_600;

/**
 * The two lessons the board itself cannot teach.
 *
 * Locked slots and thrown debris both put a cross over a cell, and a player who
 * has not been told the difference reads both as "broken". This says which is
 * which, once each, ever.
 *
 * It is a prompt and never a gate: the simulation keeps running, the board
 * stays draggable underneath, and the card clears itself on a timer. The
 * onboarding funnel showed the tutorial chain is where players leave, so
 * nothing here is allowed to ask for a tap before play continues.
 */
export class BoardCoach extends Phaser.GameObjects.Container {
  private readonly card: Phaser.GameObjects.Container;
  private readonly backing: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly copy: Phaser.GameObjects.BitmapText;
  private readonly finger: Phaser.GameObjects.Image;
  private fingerTween: Phaser.Tweens.Tween | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;
  private target: Phaser.Math.Vector2 | null = null;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly slotPos: (slot: number) => { x: number; y: number },
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(344).setVisible(false);

    this.backing = sceneRef.add.rectangle(0, 0, 560, 104, 0x20160e, 0.97).setStrokeStyle(5, 0xffd35a);
    this.title = sceneRef.add.bitmapText(0, -22, 'pixel', '', 22).setOrigin(0.5).setTint(0xffe58a);
    this.copy = sceneRef.add.bitmapText(0, 24, 'pixel', '', 16).setOrigin(0.5).setTint(0xffffff);
    this.card = sceneRef.add.container(0, 0, [this.backing, this.title, this.copy]);
    this.finger = sceneRef.add.image(0, 0, 'tutorial_hand').setOrigin(0.5, 1).setDisplaySize(88, 88);
    this.add([this.card, this.finger]);

    core.events.onAny((event) => this.onEvent(event));
  }

  get isActive(): boolean { return this.visible; }

  /** Test seam: which lesson is on screen, if any. */
  snapshot(): { visible: boolean; title: string; copy: string } {
    return { visible: this.visible, title: this.title.text, copy: this.copy.text };
  }

  relayout(): void {
    if (this.visible) this.place();
  }

  private onEvent(event: GameEvent): void {
    // The very first boss is the earliest moment the locked cells are worth
    // explaining: before it, the player is still being taught to merge, and
    // the board has more empty slots than they can fill anyway.
    if (event.type === 'bossDefeated') {
      // The first boss a player beats *after* the opening coach, so this never
      // stacks a second prompt on top of the one teaching the merge.
      if (!this.core.tutorialCompleted || this.core.lockedSlots.length === 0) return;
      const slot = this.core.nextUnlockSlot;
      if (slot === null) return;
      // Long enough for the stage banner celebrating the kill to clear.
      this.sceneRef.time.delayedCall(1_600, () => this.show('lockedSlots', slot));
      return;
    }
    if (event.type === 'debrisLanded') this.show('debris', event.slot);
  }

  /**
   * The same lesson, on demand, however many times the player asks for it.
   *
   * `show` fires once ever by design: the onboarding funnel says unprompted
   * tutorial cards are where players leave. A tap on a locked slot is not
   * unprompted -- it is the question this card answers -- so answering it again
   * costs nothing and beats leaving the tap silent.
   */
  remind(id: BoardLessonId, slot: number): void {
    if (this.visible || this.core.isGameOver) return;
    this.core.completeBoardLesson(id);
    this.render(id, slot);
  }

  private show(id: BoardLessonId, slot: number): void {
    if (this.core.boardLessonSeen(id) || this.core.isGameOver) return;
    this.core.completeBoardLesson(id);
    this.render(id, slot);
  }

  private render(id: BoardLessonId, slot: number): void {
    const lesson = LESSONS.find((entry) => entry.id === id);
    if (lesson === undefined) return;

    this.title.setText(lesson.title);
    this.copy.setText(lesson.copy(this.core));
    const at = this.slotPos(slot);
    this.target = new Phaser.Math.Vector2(at.x, at.y);
    this.place();

    this.setVisible(true).setAlpha(0);
    this.sceneRef.tweens.add({ targets: this, alpha: 1, duration: 200 });
    this.timer?.remove();
    this.timer = this.sceneRef.time.delayedCall(HOLD_MS, () => this.hide());
  }

  private place(): void {
    const viewportWidth = this.sceneRef.scale.gameSize.width;
    this.card.setScale(Math.min(1, Math.max(0.7, (viewportWidth - 32) / 560)));
    const board = theme.layout.board;
    // Inside the board panel, above the slot rows. Sitting it above the panel
    // put it at the very top of the screen in landscape, where the board is the
    // right-hand column -- a card explaining the grid should be next to the
    // grid. It still clears the cell being pointed at, because a prompt that
    // covers the thing it describes is worse than no prompt.
    this.card.setPosition(
      Math.round(board.x + board.w / 2),
      Math.round(Math.max(board.y + 96, theme.layout.slots.startY - 96)),
    );

    if (this.target === null) {
      this.finger.setVisible(false);
      return;
    }
    this.fingerTween?.stop();
    this.finger.setVisible(true).setPosition(this.target.x, this.target.y - 6).setScale(1);
    this.fingerTween = this.sceneRef.tweens.add({
      targets: this.finger,
      y: this.target.y + 8,
      scale: 0.92,
      yoyo: true,
      repeat: -1,
      duration: 430,
      ease: 'Sine.easeInOut',
    });
  }

  private hide(): void {
    this.fingerTween?.stop();
    this.fingerTween = null;
    this.timer = null;
    this.target = null;
    this.sceneRef.tweens.add({
      targets: this,
      alpha: 0,
      duration: 220,
      onComplete: () => this.setVisible(false),
    });
  }
}
