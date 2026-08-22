import Phaser from 'phaser';
import { ACHIEVEMENT_TINTS } from '../data/achievements';
import type { AchievementKind } from '../data/achievements';
import { ATLAS_KEY } from '../render/atlasConfig';
import { ACHIEVEMENTS_ICON_KEY } from '../render/revealAssets';
import { theme } from './theme';

/** How long a single unlock holds on screen before it slides away. */
const HOLD_MS = 2200;
const SLIDE_MS = 260;

interface Pending {
  name: string;
  description: string;
  kind: AchievementKind;
  progress: string;
}

/**
 * The moment a named goal is met.
 *
 * Deliberately a small card at the top of the arena rather than a modal: the
 * player is usually mid-merge when one of these lands, and stopping the game
 * to say "well done" would punish the very thing being congratulated. It never
 * takes input, never pauses the sim, and it queues rather than overlapping --
 * a long-time player opening a build that has achievements in it for the first
 * time earns a parade of them at once, and a pile of cards stacked on the same
 * pixels would read as a glitch.
 */
export class AchievementToast extends Phaser.GameObjects.Container {
  private readonly plate: Phaser.GameObjects.NineSlice;
  private readonly badge: Phaser.GameObjects.Image;
  private readonly heading: Phaser.GameObjects.BitmapText;
  private readonly label: Phaser.GameObjects.BitmapText;
  private readonly description: Phaser.GameObjects.BitmapText;
  private readonly progress: Phaser.GameObjects.BitmapText;
  private readonly queue: Pending[] = [];
  private showing = false;
  private timer: Phaser.Time.TimerEvent | null = null;

  constructor(private readonly sceneRef: Phaser.Scene) {
    super(sceneRef, 0, 0);
    // Above the arena and the board, below every modal: an unlock must never
    // cover a game over or the almanac.
    sceneRef.add.existing(this).setDepth(320).setVisible(false);

    this.plate = sceneRef.add.nineslice(0, 0, ATLAS_KEY, 'panel_frame_9', 360, 76, 8, 8, 8, 8).setTint(0x2b1d12);
    // The trophy, not the atlas star: the card has to read as the same feature
    // the rail button opens.
    this.badge = sceneRef.add.image(0, 0, ACHIEVEMENTS_ICON_KEY).setScale(1.3);
    this.heading = sceneRef.add.bitmapText(0, 0, 'pixel', 'ACHIEVEMENT', 14).setOrigin(0, 0.5).setTint(0xcbb79a);
    this.label = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0, 0.5).setTint(0xfff6dd);
    this.description = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(0, 0.5).setTint(0xd8cfc4);
    this.progress = sceneRef.add.bitmapText(0, 0, 'pixel', '', 14).setOrigin(1, 0.5).setTint(0xffe58a);
    this.add([this.plate, this.badge, this.heading, this.label, this.description, this.progress]);
    this.relayout();
  }

  /** Queue an unlock. Shown immediately when the card is free, else in turn. */
  show(entry: Pending): void {
    this.queue.push(entry);
    if (!this.showing) this.advance();
  }

  /** Verification hook: the achievement currently on the card, if any. */
  currentName(): string | null {
    return this.visible ? this.label.text : null;
  }

  get pending(): number {
    return this.queue.length;
  }

  relayout(): void {
    const a = theme.layout.arena;
    const width = Math.min(a.w - 40, 380);
    this.plate.setSize(width, 76);

    // Everything is laid out from the plate's own left edge, so the card can
    // change width between portrait and landscape without re-tuning.
    const left = -width / 2;
    this.badge.setPosition(left + 34, 0);
    this.heading.setPosition(left + 62, -22);
    this.label.setPosition(left + 62, -4);
    this.description.setPosition(left + 62, 18).setMaxWidth(width - 78);
    this.progress.setPosition(left + width - 14, -22);

    // Pinned to the bottom of the arena, not the top. The top of the panel is
    // where the stage plate, the boss name and both health bars live, and a
    // card parked there hides the only live numbers in the fight for over two
    // seconds. Down here it grazes the floor slab and nothing else.
    this.setPosition(a.x + a.w / 2, a.y + a.h - 54);
  }

  private advance(): void {
    const entry = this.queue.shift();
    if (entry === undefined) {
      this.showing = false;
      this.setVisible(false);
      return;
    }

    this.showing = true;
    this.label.setText(entry.name);
    this.description.setText(entry.description);
    this.progress.setText(entry.progress);
    // The trophy keeps its own gold; the category colour rides the heading
    // instead, since tinting the badge would just muddy the art.
    this.heading.setTint(ACHIEVEMENT_TINTS[entry.kind]);
    this.relayout();

    this.timer?.remove();
    this.sceneRef.tweens.killTweensOf(this);
    // Rises into place from below, matching where it now lives.
    const restY = this.y;
    this.setVisible(true).setAlpha(0).setY(restY + 26);
    this.sceneRef.tweens.add({ targets: this, alpha: 1, y: restY, duration: SLIDE_MS, ease: 'Back.easeOut' });
    this.sceneRef.tweens.add({
      targets: this.badge,
      angle: { from: -18, to: 0 },
      scale: { from: 2.2, to: 1.5 },
      duration: 420,
      ease: 'Back.easeOut',
    });

    this.timer = this.sceneRef.time.delayedCall(HOLD_MS, () => this.dismiss());
  }

  private dismiss(): void {
    this.timer = null;
    this.sceneRef.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y + 22,
      duration: SLIDE_MS,
      ease: 'Quad.easeIn',
      // The next card is only started once this one is gone, which is what
      // keeps a burst of unlocks readable one at a time.
      onComplete: () => this.advance(),
    });
  }
}
