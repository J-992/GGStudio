import Phaser from 'phaser';
import { FX_FRAMES } from '../render/atlasConfig';
import { VFX_ANIMATIONS } from '../data/vfxAssets';
import type { Sfx } from '../audio/Sfx';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { theme } from '../ui/theme';

const FLIGHT_MS = 520;
const STAGGER_MS = 38;
const POOL_SIZE = 32;
/** Minimum gap between arrival chimes so stacked bursts stay one sound. */
const COIN_SFX_GAP_MS = 90;
const RING_POOL = 2;
const SPARK_POOL = 8;

/**
 * Boss payday choreography (staged): pop out of the boss, rain onto the arena
 * platform, then peel off one by one into the wallet. The reward amount itself
 * lives in the economy -- these sprites are only a representative volley, so
 * their count grows sub-linearly with the payout and never with its digits.
 * Threshold table (first row whose reward clears wins), hard-capped at 16:
 *   >= 1e9 -> 16 | >= 1e7 -> 14 | >= 1e5 -> 12 | >= 1e4 -> 10 | >= 1e3 -> 8 | else 6
 */
const VOLLEY_TABLE: ReadonlyArray<readonly [threshold: number, coins: number]> = [
  [1e9, 16], [1e7, 14], [1e5, 12], [1e4, 10], [1e3, 8],
];
const VOLLEY_BASE = 6;

// Every phase chains through tween callbacks, never scene.time.delayedCall:
// a hit-stop slows tweens wholesale, so the sequence stretches coherently
// instead of its beats drifting apart.
const POP_MS = 230;
const FALL_MS = 250;
/** Damped bounce heights after touchdown; two hops, then the coin settles. */
const BOUNCE_HEIGHTS_PX: ReadonlyArray<number> = [22, 9];
const BOUNCE_UP_MS = 120;
const BOUNCE_DOWN_MS = 110;
/** Settle window before a coin peels toward the wallet; later coins wait longer. */
const SETTLE_BASE_MS = 350;
const SETTLE_STEP_MS = 26;
const SETTLE_CAP_MS = 550;
const POP_RISE_PX: readonly [number, number] = [46, 92];
const POP_SPREAD_PX: readonly [number, number] = [34, 96];
const LAND_BELOW_BOSS_PX = 78;
const ARENA_MARGIN_PX = 18;
/** Finale camera nudge -- deliberately under Fx.shake's .012/220ms ceiling. */
const FINALE_SHAKE_INTENSITY = .008;
const FINALE_SHAKE_MS = 150;

const volleySize = (reward: number): number => {
  const magnitude = Math.max(0, reward);
  for (const [threshold, coins] of VOLLEY_TABLE) {
    if (magnitude >= threshold) return coins;
  }
  return VOLLEY_BASE;
};

export class CoinFX {
  /**
   * Latest instance per scene. `Fx` keeps its CoinFX private and is not this
   * class's to edit, so the one boss-defeat call-site reaches the staged
   * payday through this handle; a rebuilt scene simply overwrites the entry.
   */
  private static readonly instances = new WeakMap<Phaser.Scene, CoinFX>();
  static of(scene: Phaser.Scene): CoinFX | undefined { return CoinFX.instances.get(scene); }

  private readonly pool: Phaser.GameObjects.Image[] = [];
  private readonly rings: Phaser.GameObjects.Sprite[] = [];
  private readonly sparks: Phaser.GameObjects.Sprite[] = [];
  private ringCursor = 0; private sparkCursor = 0;
  private lastCueAt = -Infinity;
  private target: (() => Phaser.Math.Vector2) | null = null;
  constructor(private readonly scene: Phaser.Scene, private readonly sfx: Sfx | null = null) {
    CoinFX.instances.set(scene, this);
    for (let i = 0; i < POOL_SIZE; i += 1) this.pool.push(scene.add.image(0, 0, 'game', FX_FRAMES.coin).setVisible(false).setDepth(35));
    for (let i = 0; i < RING_POOL; i += 1) {
      this.rings.push(scene.add.sprite(0, 0, VFX_ANIMATIONS.shockwave.textureKey, 0).setVisible(false).setDepth(36));
    }
    for (let i = 0; i < SPARK_POOL; i += 1) {
      this.sparks.push(scene.add.sprite(0, 0, VFX_ANIMATIONS.merge.textureKey, 0).setVisible(false).setDepth(36));
    }
  }
  setTarget(target: () => Phaser.Math.Vector2): void { this.target = target; }
  burst(x: number, y: number, count = 6, onArrival?: () => void): void {
    if (this.target === null) return;
    const end = this.target(); let used = 0; let landed = false;
    for (const coin of this.pool) {
      if (used >= count || coin.visible) continue;
      used += 1;
      const delay = used * STAGGER_MS;
      // A reused coin only ever comes back after its tween completed, so the
      // proxy below is dead by then and cannot steer two coins at once.
      const flight = { t: 0, sx: x, sy: y };
      const arc = Math.min(150, Math.max(70, Phaser.Math.Distance.Between(x, y, end.x, end.y) * .3));
      const ctrlY = Math.min(y, end.y) - arc;
      coin.setPosition(x, y).setScale(.65).setAngle(0).setAlpha(1).setVisible(true);
      this.scene.tweens.add({
        targets: flight,
        t: 1,
        delay,
        duration: FLIGHT_MS,
        ease: 'Linear',
        onUpdate: () => coin.setPosition(Phaser.Math.Linear(flight.sx, end.x, flight.t), Phaser.Math.Interpolation.QuadraticBezier(flight.t, flight.sy, ctrlY, end.y)),
        onComplete: () => {
          coin.setVisible(false);
          if (!landed) { landed = true; this.arrival(end.x, end.y); }
          onArrival?.();
        },
      });
      this.scene.tweens.add({ targets: coin, scale: 1, angle: 360, delay, duration: FLIGHT_MS, ease: 'Quad.easeIn' });
    }
  }
  /**
   * The staged boss payoff: a bounded volley bursts out of the fallen boss,
   * bounces onto the platform beside it, settles for a beat, then magnetises
   * to the wallet one coin at a time. The final arrival plays the finale beat.
   * Pure presentation -- GameCore credits the reward exactly once upstream.
   */
  payday(x: number, y: number, reward: number): void {
    if (this.target === null) return;
    const end = this.target();
    const picked: Phaser.GameObjects.Image[] = [];
    for (const coin of this.pool) {
      if (picked.length >= volleySize(reward)) break;
      if (!coin.visible) picked.push(coin);
    }
    if (picked.length === 0) { CurrencyDisplay.of(this.scene)?.celebrate(); return; }
    let remaining = picked.length;
    picked.forEach((coin, index) => this.scatter(coin, x, y, index, end, () => {
      remaining -= 1;
      if (remaining === 0) this.finale(end.x, end.y);
    }));
  }
  /** Phase 1-2: pop upward/outward, fall to the platform line, bounce, settle. */
  private scatter(coin: Phaser.GameObjects.Image, x: number, y: number, index: number, end: Phaser.Math.Vector2, done: () => void): void {
    const side = index % 2 === 0 ? 1 : -1;
    const drift = Phaser.Math.Between(...POP_SPREAD_PX) * side;
    const landX = this.clampArenaX(x + drift * 1.55);
    const landY = this.platformLine(y);
    const settleMs = Math.min(SETTLE_CAP_MS, SETTLE_BASE_MS + index * SETTLE_STEP_MS);
    this.scene.tweens.killTweensOf(coin);
    coin.setPosition(x, y).setScale(.5).setAngle(Phaser.Math.Between(-24, 24)).setAlpha(1).setVisible(true).setDepth(35);
    this.scene.tweens.add({
      targets: coin,
      x: x + drift * .6,
      y: y - Phaser.Math.Between(...POP_RISE_PX),
      duration: POP_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: coin,
          x: landX,
          y: landY,
          scale: 1,
          angle: coin.angle + side * 160,
          duration: FALL_MS,
          ease: 'Quad.easeIn',
          onComplete: () => this.bounce(coin, landY, 0, settleMs, end, done),
        });
      },
    });
  }
  /** Touchdown squash plus up to two damped hops, then the settle hold. */
  private bounce(coin: Phaser.GameObjects.Image, groundY: number, hop: number, settleMs: number, end: Phaser.Math.Vector2, done: () => void): void {
    coin.setScale(1.14, .8);
    this.scene.tweens.add({ targets: coin, scaleX: 1, scaleY: 1, duration: 100, ease: 'Quad.easeOut' });
    const height = BOUNCE_HEIGHTS_PX[hop];
    if (height === undefined) {
      this.scene.tweens.addCounter({ from: 0, to: 1, duration: settleMs, ease: 'Linear', onComplete: () => this.magnetize(coin, end, done) });
      return;
    }
    this.scene.tweens.add({
      targets: coin,
      y: groundY - height,
      duration: BOUNCE_UP_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: coin,
          y: groundY,
          duration: BOUNCE_DOWN_MS,
          ease: 'Quad.easeIn',
          onComplete: () => this.bounce(coin, groundY, hop + 1, settleMs, end, done),
        });
      },
    });
  }
  /** Phase 3: accelerate along an arc into the wallet; every landing blips. */
  private magnetize(coin: Phaser.GameObjects.Image, end: Phaser.Math.Vector2, done: () => void): void {
    const sx = coin.x; const sy = coin.y;
    const distance = Phaser.Math.Distance.Between(sx, sy, end.x, end.y);
    const ctrlY = Math.min(sy, end.y) - Math.min(170, Math.max(80, distance * .35));
    const flight = { t: 0 };
    this.scene.tweens.add({
      targets: flight,
      t: 1,
      duration: FLIGHT_MS,
      ease: 'Quad.easeIn',
      onUpdate: () => coin.setPosition(Phaser.Math.Linear(sx, end.x, flight.t), Phaser.Math.Interpolation.QuadraticBezier(flight.t, sy, ctrlY, end.y)),
      onComplete: () => {
        coin.setVisible(false);
        this.blip(end.x, end.y);
        done();
      },
    });
    this.scene.tweens.add({ targets: coin, angle: coin.angle + 360, duration: FLIGHT_MS, ease: 'Quad.easeIn' });
  }
  /** One coin home: throttled chime, a two-spark flicker, a wallet tick. */
  private blip(x: number, y: number): void {
    const now = this.scene.time.now;
    if (this.sfx !== null && now - this.lastCueAt >= COIN_SFX_GAP_MS) { this.lastCueAt = now; this.sfx.play('coin'); }
    for (let i = 0; i < 2; i += 1) this.spark(x, y, Math.random() * Math.PI * 2, 20);
    CurrencyDisplay.of(this.scene)?.tick();
  }
  /** Phase 4: last coin home -- big ring, spark fan, camera nudge, wallet beat. */
  private finale(x: number, y: number): void {
    const ring = this.rings[this.ringCursor]!; this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    this.scene.tweens.killTweensOf(ring);
    ring.stop().setTexture(VFX_ANIMATIONS.shockwave.textureKey, 0).setPosition(x, y).setScale(.12).setAlpha(.95).setVisible(true).setDepth(36).play(VFX_ANIMATIONS.shockwave.animationKey);
    this.scene.tweens.add({ targets: ring, scale: .72, alpha: 0, duration: 360, ease: 'Quad.easeOut', onComplete: () => ring.stop().setVisible(false) });
    for (let i = 0; i < 5; i += 1) this.spark(x, y, (i / 5) * Math.PI * 2 + .4, 32);
    this.scene.cameras.main.shake(FINALE_SHAKE_MS, FINALE_SHAKE_INTENSITY);
    CurrencyDisplay.of(this.scene)?.celebrate();
  }
  /** Platform line just ahead of where the boss stood, kept inside the arena. */
  private platformLine(bossY: number): number {
    const arena = theme.layout.arena;
    return Math.min(arena.y + arena.h - 26, bossY + LAND_BELOW_BOSS_PX);
  }
  private clampArenaX(x: number): number {
    const arena = theme.layout.arena;
    return Phaser.Math.Clamp(x, arena.x + ARENA_MARGIN_PX, arena.x + arena.w - ARENA_MARGIN_PX);
  }
  private spark(x: number, y: number, angle: number, reach: number): void {
    const spark = this.sparks[this.sparkCursor]!; this.sparkCursor = (this.sparkCursor + 1) % this.sparks.length;
    this.scene.tweens.killTweensOf(spark);
    spark.stop().setTexture(VFX_ANIMATIONS.merge.textureKey, 0).setPosition(x, y).setScale(.12).setAlpha(1).setTint(0xffd23f).setVisible(true).setDepth(36).play(VFX_ANIMATIONS.merge.animationKey);
    this.scene.tweens.add({ targets: spark, x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach, scale: .04, alpha: 0, duration: 260, onComplete: () => spark.stop().setVisible(false) });
  }
  /** First landing of a plain burst: a chime plus a small flash where the money lands. */
  private arrival(x: number, y: number): void {
    const now = this.scene.time.now;
    if (this.sfx !== null && now - this.lastCueAt >= COIN_SFX_GAP_MS) { this.lastCueAt = now; this.sfx.play('coin'); }
    const ring = this.rings[this.ringCursor]!; this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    this.scene.tweens.killTweensOf(ring);
    ring.stop().setTexture(VFX_ANIMATIONS.shockwave.textureKey, 0).setPosition(x, y).setScale(.1).setAlpha(.85).setVisible(true).play(VFX_ANIMATIONS.shockwave.animationKey);
    this.scene.tweens.add({ targets: ring, scale: .46, alpha: 0, duration: 300, ease: 'Quad.easeOut', onComplete: () => ring.stop().setVisible(false) });
    for (let i = 0; i < 4; i += 1) this.spark(x, y, (i / 4) * Math.PI * 2 + .6, 24);
  }
}
