import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { VFX_ANIMATIONS } from '../data/vfxAssets';
import { compactNumber, theme } from './theme';

/** Crisper wallet coin: the 22px atlas frame drawn at x2.5 inside the plate. */
const ICON_SCALE = 2.5;
/** Icon half-width at native 22px, scaled for the crisp draw. */
const ICON_HALF = 11 * ICON_SCALE;
/** Label starts just past the enlarged coin, so the two never crowd. */
const TEXT_OFFSET = Math.ceil(ICON_HALF * 2) + 13;
const FONT_SIZE = 16;
const PAD_X = 13;
const PAD_Y = 7;
const PLATE_RADIUS = 10;
const HOP_MS = 105;
const SETTLE_MS = 190;
const NORMAL_HOP_PX = 5;
const CELEBRATE_HOP_PX = 8;
const HUGE_HOP_PX = 11;
/** Bursts landing inside this window ride the running wave instead of stacking a new one. */
const PULSE_COALESCE_MS = 180;
const FLASH_MS = 200;
/** The gold the number flashes on a gain, lerping back to white. */
const GOLD = { r: 255, g: 210, b: 63 };
/** A small alternating tilt keeps repeated arrivals lively without resizing. */
const NORMAL_TILT_DEG = 5;
const CELEBRATE_TILT_DEG = 9;
/** Per-arrival tick throttle so a magnet wave reads as one sparkle per beat. */
const TICK_THROTTLE_MS = 60;
const SPARKLE_POOL = 4;
/**
 * Huge-payday heuristic: a single credit larger than 25x the running average
 * of the last eight gains is a boss payout, not damage trickle. Boot and save
 * loads (first fill from zero) never qualify.
 */
const HUGE_DELTA_FACTOR = 25;
const RECENT_DELTA_WINDOW = 8;
/** Huge tallies roll longer, so the count is still live when the volley lands. */
const COUNT_MS = { normal: 360, huge: 900 } as const;

export class CurrencyDisplay extends Phaser.GameObjects.Container {
  /**
   * Latest instance per scene. Effect classes outside the scene-graph wiring
   * (CoinFX's payday finale) reach the wallet through this handle.
   */
  private static readonly instances = new WeakMap<Phaser.Scene, CurrencyDisplay>();
  static of(scene: Phaser.Scene): CurrencyDisplay | undefined { return CurrencyDisplay.instances.get(scene); }

  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Arc;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly text: Phaser.GameObjects.BitmapText;
  private readonly sparkles: Phaser.GameObjects.Sprite[] = [];
  private sparkleCursor = 0;
  /** Label -> measured width, so the plate resizes without per-tick text thrash. */
  private readonly widths = new Map<string, number>();
  private readonly flash = { p: 1 };
  private readonly recentDeltas: number[] = [];
  private shown = 0; private lastBurstAt = -Infinity; private lastTickAt = -Infinity;
  private pendingHuge = false;
  private hopDirection = 1;
  constructor(scene: Phaser.Scene) {
    super(scene, theme.layout.coin.x, theme.layout.coin.y); scene.add.existing(this).setDepth(8);
    CurrencyDisplay.instances.set(scene, this);
    this.plate = scene.add.graphics(); this.add(this.plate);
    this.glow = scene.add.circle(0, 0, ICON_HALF * 1.02, theme.colors.coin).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD); this.add(this.glow);
    this.icon = scene.add.image(0, 0, ATLAS_KEY, 'icon_coin').setScale(ICON_SCALE); this.add(this.icon);
    this.text = scene.add.bitmapText(TEXT_OFFSET, 0, 'pixel', '0', FONT_SIZE).setOrigin(0, .5).setTint(0xffffff); this.add(this.text);
    for (let i = 0; i < SPARKLE_POOL; i += 1) {
      const sparkle = scene.add.sprite(0, 0, VFX_ANIMATIONS.merge.textureKey, 0).setVisible(false).setTint(0xffe58a);
      this.sparkles.push(sparkle); this.add(sparkle);
    }
    this.resizePlate('0');
  }
  setCoins(coins: number): void {
    const target = Math.floor(coins); if (target === this.shown) return;
    const delta = target - this.shown;
    this.noteIncome(delta);
    const label = compactNumber(target);
    const counter = { value: this.shown };
    // A huge payout counts up slower so the tally is still rolling when the
    // coin volley lands; the finale beat then meets the number mid-glow.
    const budget = this.pendingHuge ? COUNT_MS.huge : COUNT_MS.normal;
    this.scene.tweens.add({ targets: counter, value: target, duration: Math.min(budget, 90 + Math.abs(target - this.shown) * 12), ease: 'Quad.easeOut', onUpdate: () => this.text.setText(compactNumber(counter.value)) });
    this.shown = target;
    this.resizePlate(label);
  }
  /** Regular income response: one coalesced hop plus the gold flash. */
  burst(): void {
    const now = this.scene.time.now;
    if (now - this.lastBurstAt < PULSE_COALESCE_MS) return;
    this.lastBurstAt = now;
    this.hopWave(NORMAL_HOP_PX, NORMAL_TILT_DEG);
    this.sparkleBurst(1);
    this.flash.p = 0; this.text.setTint(this.tintAt(0));
    this.scene.tweens.add({ targets: this.flash, p: 1, duration: FLASH_MS, ease: 'Quad.easeOut', onUpdate: () => this.text.setTint(this.tintAt(this.flash.p)) });
  }
  /** One coin arriving: a sparkle tick and a tiny counter bump, rate-limited. */
  tick(): void {
    const now = this.scene.time.now;
    if (now - this.lastTickAt < TICK_THROTTLE_MS) return;
    this.lastTickAt = now;
    this.sparkleBurst(1);
    this.scene.tweens.killTweensOf(this.text);
    this.text.setScale(1.12);
    this.scene.tweens.add({ targets: this.text, scaleX: 1, scaleY: 1, duration: 110, ease: 'Quad.easeOut' });
  }
  /**
   * The payday finale: a higher hop, a glow flare behind the coin and a
   * bounded extra beat when the heuristic flags a huge payout. The wallet
   * coin never changes size: the prior squash drove scaleY through zero and
   * made every collection look like the icon collapsed or briefly flipped.
   */
  celebrate(): void {
    const huge = this.pendingHuge; this.pendingHuge = false;
    this.hopWave(huge ? HUGE_HOP_PX : CELEBRATE_HOP_PX, CELEBRATE_TILT_DEG);
    this.scene.tweens.killTweensOf(this.glow);
    this.glow.setAlpha(huge ? .85 : .6).setScale(huge ? 1.25 : 1);
    this.scene.tweens.add({ targets: this.glow, alpha: 0, scale: huge ? 1.7 : 1.4, duration: huge ? 340 : 240, ease: 'Quad.easeOut' });
    this.flash.p = 0; this.scene.tweens.killTweensOf(this.flash);
    this.text.setTint(this.tintAt(0));
    this.scene.tweens.add({ targets: this.flash, p: 1, duration: FLASH_MS, ease: 'Quad.easeOut', onUpdate: () => this.text.setTint(this.tintAt(this.flash.p)) });
    this.sparkleBurst(huge ? 3 : 2);
  }
  spend(): void {
    // Spending never distorts the coin either -- just stop any motion cold.
    this.scene.tweens.killTweensOf(this.icon);
    this.icon.setPosition(0, 0).setAngle(0).setScale(ICON_SCALE);
  }
  relayout(): void { this.setPosition(theme.layout.coin.x, theme.layout.coin.y); }
  /**
   * Hop and settle without touching scale. Repeated rewards alternate their
   * tilt, so the motion stays lively while the enlarged icon remains crisp and
   * can never collapse, mirror, or snap back from an invalid scale.
   */
  private hopWave(liftPx: number, tiltDeg: number): void {
    const icon = this.icon;
    this.scene.tweens.killTweensOf(icon);
    this.hopDirection *= -1;
    const direction = this.hopDirection;
    icon.setPosition(0, 0).setAngle(0).setScale(ICON_SCALE);
    this.scene.tweens.add({
      targets: icon,
      y: -liftPx,
      angle: tiltDeg * direction,
      duration: HOP_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({ targets: icon, y: 0, angle: 0, duration: SETTLE_MS, ease: 'Back.easeOut' });
      },
    });
  }
  /** Bounded sparkle pops beside the coin; the pool round-robins, never grows. */
  private sparkleBurst(count: number): void {
    for (let i = 0; i < count; i += 1) {
      const sparkle = this.sparkles[this.sparkleCursor]!; this.sparkleCursor = (this.sparkleCursor + 1) % this.sparkles.length;
      this.scene.tweens.killTweensOf(sparkle);
      const angle = Math.random() * Math.PI * 2;
      sparkle.setPosition(Math.cos(angle) * 20, Math.sin(angle) * 12 - 4).setScale(.1).setAlpha(1).setVisible(true).play(VFX_ANIMATIONS.merge.animationKey);
      this.scene.tweens.add({ targets: sparkle, x: sparkle.x + Math.cos(angle) * 16, y: sparkle.y + Math.sin(angle) * 10, scale: .025, alpha: 0, duration: 260, onComplete: () => sparkle.setVisible(false) });
    }
  }
  private noteIncome(delta: number): void {
    // Gains only, and never on the first fill from zero (boot, save load,
    // welcome-back grant) -- those are restorations, not paydays.
    if (delta <= 0 || this.shown <= 0) return;
    const prior = this.recentDeltas;
    const average = prior.length === 0 ? 0 : prior.reduce((sum, value) => sum + value, 0) / prior.length;
    if (delta > HUGE_DELTA_FACTOR * Math.max(1, average)) this.pendingHuge = true;
    prior.push(delta);
    if (prior.length > RECENT_DELTA_WINDOW) prior.shift();
  }
  /** Plate hugs the current label, so a short balance never trails empty tin. */
  private resizePlate(label: string): void {
    const right = TEXT_OFFSET + this.measure(label) + PAD_X;
    const left = -ICON_HALF - PAD_X;
    const h = ICON_HALF * 2 + PAD_Y * 2;
    this.plate.clear();
    this.plate.fillStyle(theme.colors.shadow, .92).fillRoundedRect(left, -h / 2, right - left, h, PLATE_RADIUS);
    this.plate.lineStyle(3, theme.colors.matBorder, 1).strokeRoundedRect(left, -h / 2, right - left, h, PLATE_RADIUS);
  }
  /** Measures via a synchronous swap -- render never sees the borrowed label. */
  private measure(label: string): number {
    const cached = this.widths.get(label); if (cached !== undefined) return cached;
    if (this.widths.size > 256) this.widths.clear();
    const previous = this.text.text;
    this.text.setText(label);
    const w = Math.ceil(this.text.width);
    this.text.setText(previous);
    this.widths.set(label, w);
    return w;
  }
  private tintAt(p: number): number {
    return Phaser.Display.Color.GetColor(Math.round(GOLD.r + (255 - GOLD.r) * p), Math.round(GOLD.g + (255 - GOLD.g) * p), Math.round(GOLD.b + (255 - GOLD.b) * p));
  }
}
