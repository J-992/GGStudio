import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import { BALANCE } from '../data/balance';
import type { DojoStyleDef } from '../data/dojoStyles';
import type { Fx } from '../effects/Fx';
import type { Sfx } from '../audio/Sfx';
import { ATLAS_KEY, FX_FRAMES } from '../render/atlasConfig';
import { theme } from './theme';

type SlotPos = (slot: number) => { x: number; y: number };

const THROW_MS = 420;

/**
 * Everything drawn over a board cell the player cannot use: debris a boss
 * threw, and slots not yet earned.
 *
 * The two are deliberately opposite in weight. Debris is thin, jittering and
 * wears a draining ring; a lock is heavy, still and nailed down. A player must
 * never mistake a twelve-second problem for a four-stage goal, and colour
 * alone would not carry that -- so the difference is in the drawing.
 *
 * All of it is `Graphics`, which means it re-tints for free when the dojo skin
 * changes and costs nothing to download. The thrown shuriken is the existing
 * `fx_star` frame, spun and darkened.
 */
export class SlotOverlays extends Phaser.GameObjects.Container {
  private readonly plankLayer: Phaser.GameObjects.Graphics;
  private readonly ringLayer: Phaser.GameObjects.Graphics;
  /** One embedded shuriken per blocked slot, keyed by slot. */
  private readonly shurikens = new Map<number, Phaser.GameObjects.Image>();
  private style: DojoStyleDef;
  private jitter = 0;
  private glow = 0;
  /** Slots whose planks are mid-shatter and must not be redrawn under them. */
  private readonly clearing = new Set<number>();

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly slotPos: SlotPos,
    private readonly fx: Fx,
    private readonly sfx: Sfx,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(3.5);
    this.style = core.equippedDojoStyle;
    this.plankLayer = sceneRef.add.graphics();
    this.ringLayer = sceneRef.add.graphics();
    this.add([this.plankLayer, this.ringLayer]);

    core.events.on('debrisLanded', (event) => this.throwAt(event.slot));
    core.events.on('debrisCleared', (event) => this.shatter(event.slot, event.cause));
    core.events.on('slotUnlocked', (event) => this.celebrateUnlock(event.slot));
  }

  applyDojoStyle(style: DojoStyleDef): void { this.style = style; }

  override update(dtMs: number): void {
    this.jitter += dtMs;
    this.glow += dtMs / 2_900 * Math.PI * 2;
    this.redraw();
  }

  snapshot(): { debris: number[]; locked: number[] } {
    return {
      debris: this.core.debrisSlots.map((entry) => entry.slot),
      locked: [...this.core.lockedSlots],
    };
  }

  private redraw(): void {
    const planks = this.plankLayer.clear();
    const rings = this.ringLayer.clear();
    const p = this.style.palette;
    const radius = theme.layout.slots.radius;

    for (const slot of this.core.lockedSlots) {
      const at = this.slotPos(slot);
      const next = this.core.nextUnlockSlot === slot;
      // Heavy, static, nailed shut: a goal, not a timer. Nothing about it
      // moves, which is the whole contrast with debris.
      this.drawPlanks(planks, at.x, at.y, radius * 0.9, 15, p.panel, p.panelDark, 0.85);
      for (const angle of [Math.PI / 5, -Math.PI / 5]) {
        for (const end of [-1, 1]) {
          planks.fillStyle(p.panelDark, 0.9);
          planks.fillCircle(at.x + Math.cos(angle) * radius * 0.9 * end, at.y + Math.sin(angle) * radius * 0.9 * end, 3);
        }
      }
      if (!next) continue;
      const pulse = 0.35 + (Math.sin(this.glow) + 1) / 2 * 0.4;
      rings.lineStyle(4, p.accent, pulse);
      rings.strokeCircle(at.x, at.y, radius * 0.94);
    }

    // Debris keeps the silhouette of the thing that made it: the shuriken that
    // flew in is the shuriken now stuck in the slot. Crossed planks were tried
    // first and read as a second kind of lock -- same shape, same weight, and
    // a player cannot afford to confuse a twelve-second problem with a
    // four-stage goal.
    const live = new Set<number>();
    for (const entry of this.core.debrisSlots) {
      if (this.clearing.has(entry.slot)) continue;
      live.add(entry.slot);
      const at = this.slotPos(entry.slot);
      const shake = entry.msLeft <= 3_000 ? Math.sin(this.jitter / 62) * 1.5 : 0;
      const blade = this.shurikenFor(entry.slot);
      blade
        .setPosition(at.x + shake, at.y)
        .setTint(p.panelDark)
        .setScale(radius / 46)
        .setAngle(18);
      const ratio = Phaser.Math.Clamp(entry.msLeft / BALANCE.debris.holdMs, 0, 1);
      rings.lineStyle(5, p.accent, 0.95);
      rings.beginPath();
      rings.arc(at.x, at.y, radius * 0.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
      rings.strokePath();
    }
    for (const [slot, blade] of this.shurikens) {
      if (live.has(slot)) continue;
      blade.destroy();
      this.shurikens.delete(slot);
    }
  }

  private shurikenFor(slot: number): Phaser.GameObjects.Image {
    const existing = this.shurikens.get(slot);
    if (existing !== undefined) return existing;
    const blade = this.sceneRef.add.image(0, 0, ATLAS_KEY, FX_FRAMES.star);
    this.add(blade);
    this.shurikens.set(slot, blade);
    return blade;
  }

  private drawPlanks(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    half: number,
    thickness: number,
    fill: number,
    stroke: number,
    strokeAlpha: number,
  ): void {
    for (const angle of [Math.PI / 5, -Math.PI / 5]) {
      const dx = Math.cos(angle) * half;
      const dy = Math.sin(angle) * half;
      if (strokeAlpha > 0) {
        // Drawn under the plank, a shade wider, so each board reads as a solid
        // object with an edge rather than a flat stroke of colour.
        g.lineStyle(thickness + 5, stroke, strokeAlpha);
        g.lineBetween(x - dx, y - dy, x + dx, y + dy);
      }
      g.lineStyle(thickness, fill, 0.98);
      g.lineBetween(x - dx, y - dy, x + dx, y + dy);
    }
  }

  /**
   * One sprite for the whole flight, boss to slot.
   *
   * Deliberately owned by the board layer rather than handed off at the arena
   * boundary: `VFXManager` is geometry-masked to the arena, so a projectile
   * started there would be clipped halfway and read as a bug. One unmasked
   * object crossing the seam is the same picture with none of the seam.
   */
  private throwAt(slot: number): void {
    const target = this.slotPos(slot);
    const from = { x: theme.layout.enemy.x, y: theme.layout.enemy.y };
    const shuriken = this.sceneRef.add
      .image(from.x, from.y, ATLAS_KEY, FX_FRAMES.star)
      .setDepth(9.5)
      .setTint(this.style.palette.panelDark)
      .setScale(0.9);
    const peak = Math.min(from.y, target.y) - 120;

    this.sceneRef.tweens.addCounter({
      from: 0, to: 1,
      duration: THROW_MS,
      ease: 'Sine.easeIn',
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        // Quadratic Bézier through a peak above both ends, so the throw arcs
        // over the arena floor instead of sliding across it.
        const inv = 1 - t;
        shuriken.setPosition(
          inv * inv * from.x + 2 * inv * t * (from.x + target.x) / 2 + t * t * target.x,
          inv * inv * from.y + 2 * inv * t * peak + t * t * target.y,
        );
        shuriken.setAngle(t * 720);
      },
      onComplete: () => {
        shuriken.destroy();
        this.fx.shake(0.005, 110);
        this.fx.mergeFlash(target.x, target.y);
        this.sfx.play('hit');
      },
    });
  }

  private shatter(slot: number, cause: 'merge' | 'expire'): void {
    const at = this.slotPos(slot);
    this.clearing.add(slot);
    const pieces = cause === 'merge' ? 4 : 2;
    for (let i = 0; i < pieces; i += 1) {
      const piece = this.sceneRef.add
        .image(at.x, at.y, ATLAS_KEY, cause === 'merge' ? FX_FRAMES.spark : FX_FRAMES.puff)
        .setDepth(9.5)
        .setTint(cause === 'merge' ? this.style.palette.accentBright : 0x9a8f88)
        .setScale(cause === 'merge' ? 0.7 : 0.9);
      const angle = (i / pieces) * Math.PI * 2;
      this.sceneRef.tweens.add({
        targets: piece,
        x: at.x + Math.cos(angle) * (cause === 'merge' ? 68 : 26),
        y: at.y + Math.sin(angle) * (cause === 'merge' ? 68 : 26),
        alpha: 0,
        scale: 0.2,
        // Clearing it yourself is always louder than letting it lapse.
        duration: cause === 'merge' ? 260 : 300,
        ease: cause === 'merge' ? 'Quad.easeOut' : 'Sine.easeOut',
        onComplete: () => piece.destroy(),
      });
    }
    if (cause === 'merge') this.sfx.play('sell');
    this.sceneRef.time.delayedCall(cause === 'merge' ? 260 : 300, () => this.clearing.delete(slot));
  }

  private celebrateUnlock(slot: number): void {
    const at = this.slotPos(slot);
    this.fx.hitStop(50);
    this.fx.mergeFlash(at.x, at.y);
    for (let i = 0; i < 6; i += 1) {
      const splinter = this.sceneRef.add
        .image(at.x, at.y, ATLAS_KEY, FX_FRAMES.spark)
        .setDepth(9.5)
        .setTint(this.style.palette.accentBright)
        .setScale(0.9);
      const angle = (i / 6) * Math.PI * 2;
      this.sceneRef.tweens.add({
        targets: splinter,
        x: at.x + Math.cos(angle) * 92,
        y: at.y + Math.sin(angle) * 92,
        angle: 25,
        alpha: 0,
        scale: 0.2,
        duration: 620,
        ease: 'Quad.easeOut',
        onComplete: () => splinter.destroy(),
      });
    }
    this.sfx.play('newTier');
  }
}
