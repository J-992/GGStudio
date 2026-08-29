import Phaser from 'phaser';
import type { Sfx } from '../audio/Sfx';
import { CombatFX } from './CombatFX';
import { CoinFX } from './CoinFX';
import { MergeFX } from './MergeFX';

/** The sole presentation-effects surface exposed to scenes and UI. */
export class Fx {
  readonly mergeFx: MergeFX; private readonly combatFx: CombatFX; private readonly coinFx: CoinFX; private hitStopToken = 0;
  constructor(private readonly scene: Phaser.Scene, sfx?: Sfx | null) { this.mergeFx = new MergeFX(scene); this.combatFx = new CombatFX(scene); this.coinFx = new CoinFX(scene, sfx ?? null); }
  merge(x: number, y: number, tier: number): void { this.mergeFx.play(x, y, tier); }
  mergeFlash(x: number, y: number): void { this.mergeFx.flash(x, y); }
  hit(x: number, y: number, damage: number, accent: number, target: Phaser.GameObjects.Image, strong: boolean): void { this.combatFx.hit(x, y, damage, accent, target, strong); }
  defeat(x: number, y: number, boss: boolean): void { this.combatFx.defeat(x, y, boss); }
  coins(x: number, y: number, count?: number, onArrival?: () => void): void { this.coinFx.burst(x, y, count, onArrival); }
  gain(x: number, y: number, message: string): void { this.combatFx.gain(x, y, message); }
  setCoinTarget(target: () => Phaser.Math.Vector2): void { this.coinFx.setTarget(target); }
  shake(intensity: number, durationMs: number): void { this.scene.cameras.main.shake(Math.min(durationMs, 220), Math.min(intensity, .012)); }
  /**
   * Brief slow-motion on heavy impacts.
   *
   * The restore runs on wall-clock time rather than `scene.time.delayedCall`:
   * that timer is itself slowed by the very `timeScale` being set here, which
   * stretched a 55ms hit-stop into roughly 3.8 SECONDS of slow motion on every
   * strong hit and left board tweens stranded mid-flight. Re-entrant via the
   * token, so a hit-stop landing mid-stop still restores exactly once.
   */
  hitStop(ms: number): void {
    const token = this.hitStopToken + 1;
    this.hitStopToken = token;
    const slow = 0.12;
    this.scene.time.timeScale = slow;
    this.scene.tweens.timeScale = slow;
    window.setTimeout(() => {
      if (token !== this.hitStopToken) return;
      this.scene.time.timeScale = 1;
      this.scene.tweens.timeScale = 1;
    }, ms);
  }
}
