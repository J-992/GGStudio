import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import { BALANCE } from '../data/balance';
import type { DojoStyleDef } from '../data/dojoStyles';
import type { Fx } from '../effects/Fx';
import type { VFXManager } from '../effects/VFXManager';
import { theme } from '../ui/theme';
import type { ArenaManager } from './ArenaManager';

/** Radians of the gap between two barrier segments. */
const SEGMENT_GAP = 0.12;

/**
 * Everything a boss modifier adds to the arena: the barrier, the greed clock,
 * and the flourish each one resolves with.
 *
 * Kept out of `CombatDirector` on purpose -- that class already owns the
 * strike choreography for every boss in the game, and an archetype is a layer
 * on top of a fight rather than a change to it. Nothing here is authored art:
 * the barrier is stroked arcs and the clock is a stroked arc, so both re-tint
 * for free when the dojo skin changes and neither costs a byte of download.
 */
export class ArchetypePresenter {
  private readonly barrier: Phaser.GameObjects.Graphics;
  private readonly greedClock: Phaser.GameObjects.Graphics;
  private style: DojoStyleDef;
  private charges = 0;
  private maxCharges = 0;
  private spin = 0;
  private breath = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly core: GameCore,
    private readonly arena: ArenaManager,
    private readonly vfx: VFXManager,
    private readonly fx: Fx,
  ) {
    this.style = core.equippedDojoStyle;
    this.barrier = scene.add.graphics().setDepth(19).setVisible(false);
    this.greedClock = scene.add.graphics().setDepth(31).setVisible(false);

    core.events.on('bossShieldChanged', (event) => this.onShield(event.charges, event.max, event.broken));
    core.events.on('bossArchetype', (event) => { if (event.archetype !== 'shielded') this.hideBarrier(); });
    core.events.on('bossBountyResolved', (event) => this.onBounty(event.won));
    core.events.on('bossSpawned', () => { this.hideBarrier(); this.greedClock.setVisible(false); });
  }

  setDojoStyle(style: DojoStyleDef): void { this.style = style; }

  update(dtMs: number): void {
    this.spin += dtMs * 0.006;
    this.breath += dtMs / 2_200 * Math.PI * 2;
    if (this.charges > 0) this.drawBarrier();
    this.drawGreedClock();
  }

  /** Test seam: what the arena is currently drawing, without reading pixels. */
  snapshot(): { barrier: boolean; charges: number; greedClock: boolean } {
    return { barrier: this.barrier.visible, charges: this.charges, greedClock: this.greedClock.visible };
  }

  private onShield(charges: number, max: number, broken: boolean): void {
    const spent = this.maxCharges === max && charges < this.charges;
    this.charges = charges;
    this.maxCharges = max;

    if (spent && !broken) {
      const { x, y, radius } = this.barrierGeometry();
      // Shatter the segment that just went, not the whole ring: the count is
      // read off the shape, so the shape has to lose exactly one piece.
      const angle = this.segmentAngle(charges);
      for (let i = 0; i < 3; i += 1) {
        const at = angle + (i - 1) * 0.12;
        this.vfx.sparks(x + Math.cos(at) * radius, y + Math.sin(at) * radius, this.style.palette.bossAura, 3);
      }
      this.fx.shake(0.004, 90);
      return;
    }

    if (broken) {
      const { x, y, radius } = this.barrierGeometry();
      this.vfx.shockwave(x, y, this.style.palette.bossAura, 2.2);
      this.fx.hitStop(60);
      const ring = this.scene.add.graphics().setDepth(19);
      this.strokeSegments(ring, x, y, radius, max, max);
      this.scene.tweens.add({
        targets: ring,
        alpha: 0,
        scaleX: 1.6, scaleY: 1.6,
        duration: 280,
        ease: 'Quad.easeOut',
        onComplete: () => ring.destroy(),
      });
      this.hideBarrier();
      return;
    }

    this.barrier.setVisible(charges > 0);
  }

  private onBounty(won: boolean): void {
    if (!this.greedClock.visible) return;
    const { x, y } = this.barrierGeometry();
    if (won) {
      this.vfx.pillarOfLight(x, y, this.style.palette.accentBright, 3);
    } else {
      // Quiet, never punitive: the base reward was still paid, so the failure
      // reads as a bonus that lapsed rather than something taken away.
      this.vfx.smoke(x, y, 0x8c8c8c);
    }
    this.greedClock.setVisible(false);
  }

  private hideBarrier(): void {
    this.charges = 0;
    this.barrier.clear().setVisible(false);
  }

  private barrierGeometry(): { x: number; y: number; radius: number } {
    const home = this.arena.bossHome();
    return { x: home.x, y: home.y, radius: theme.layout.bossHeight * 0.68 };
  }

  private segmentAngle(index: number): number {
    const step = (Math.PI * 2) / BALANCE.archetypes.shield.segments;
    return this.spin + index * step + step / 2;
  }

  private drawBarrier(): void {
    const { x, y, radius } = this.barrierGeometry();
    const scale = 1 + Math.sin(this.breath) * 0.03;
    this.barrier.setVisible(true);
    this.strokeSegments(this.barrier, x, y, radius * scale, this.charges, this.maxCharges);
  }

  /**
   * Six arcs; the lit ones carry the charges still standing.
   *
   * Charges are always drawn against the same six segments rather than one arc
   * per charge, so an eight-charge boss and a two-charge boss wear the same
   * silhouette and only the amount of light differs. A ring that changed shape
   * with the count would read as a different mechanic each time.
   */
  private strokeSegments(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    charges: number,
    max: number,
  ): void {
    const segments = BALANCE.archetypes.shield.segments;
    const lit = max <= 0 ? 0 : Math.ceil(segments * charges / max);
    const step = (Math.PI * 2) / segments;
    g.clear();
    for (let i = 0; i < segments; i += 1) {
      const from = this.spin + i * step + SEGMENT_GAP / 2;
      const to = from + step - SEGMENT_GAP;
      const alive = i < lit;
      g.lineStyle(alive ? 6 : 3, alive ? this.style.palette.bossAura : this.style.palette.panelDark, alive ? 0.95 : 0.45);
      g.beginPath();
      g.arc(x, y, radius, from, to, false);
      g.strokePath();
    }
  }

  /**
   * A gold arc draining around the boss health bar. No digits: the player has
   * to feel the window closing, not read it.
   */
  private drawGreedClock(): void {
    const spec = this.core.bossArchetype;
    const left = this.core.bossBountyMsLeft;
    if (spec.rewardMultiplier <= 1 || left <= 0) {
      this.greedClock.setVisible(false);
      return;
    }
    const ratio = Phaser.Math.Clamp(left / Math.max(1, spec.bountyWindowMs), 0, 1);
    const a = theme.layout.arena;
    const x = a.x + a.w / 2;
    const y = theme.layout.enemyHpY + a.y;
    const radius = Math.min(a.w, a.h) * 0.06 + 8;
    const urgent = left <= 5_000;
    const pulse = urgent ? 0.7 + Math.abs(Math.sin(this.breath * 2)) * 0.3 : 1;

    this.greedClock
      .setVisible(true)
      .clear()
      .lineStyle(5, this.style.palette.accentBright, pulse);
    this.greedClock.beginPath();
    this.greedClock.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
    this.greedClock.strokePath();
  }
}
