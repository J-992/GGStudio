import Phaser from 'phaser';
import { ATLAS_KEY } from '../render/atlasConfig';
import { POWERUPS } from '../data/powerups';
import type { PowerupDef, PowerupId } from '../data/powerups';
import { VFX_ANIMATIONS } from '../data/vfxAssets';
import type { GameCore } from '../core/GameCore';
import type { Fx } from '../effects/Fx';
import type { Sfx } from '../audio/Sfx';
import { CurrencyDisplay } from './CurrencyDisplay';
import { compactNumber, theme } from './theme';

/**
 * The five data-driven powerup tokens rendered as one manager.
 *
 * The simulation owns every decision -- cadence, eligibility, stacking --
 * through `core.powerups`; this class is pure presentation. A spawned token
 * drifts across the arena lane like the potion and the clock, and an active
 * effect shows up as a draining chip beside the player HUD.
 */
interface Flight {
  readonly root: Phaser.GameObjects.Container;
  readonly halo: Phaser.GameObjects.Arc;
  readonly icon: Phaser.GameObjects.Image;
  t: number;
  fromX: number;
  toX: number;
  laneY: number;
  bobPhase: number;
}

interface Chip {
  readonly root: Phaser.GameObjects.Container;
  readonly fill: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.BitmapText;
  readonly fillWidth: number;
}

interface RainCoin {
  readonly image: Phaser.GameObjects.Image;
  active: boolean;
  elapsedMs: number;
  delayMs: number;
  fallMs: number;
  originX: number;
  startY: number;
  swayPx: number;
  swayPhase: number;
  spin: number;
}

const CHIP_W = 148;
const CHIP_H = 34;
const PICKUP_ICON_SIZE = 62;
const CHIP_ICON_SIZE = 25;
const RAIN_COIN_SIZE = 54;
const RAIN_TAP_RADIUS = 46;
const RAIN_EDGE_MARGIN = 34;
const RAIN_STAGGER_MS = 24;
const ACTIVATION_PARTICLES = 22;
const ACTIVATION_BEAMS = 10;

export class PowerupPickups extends Phaser.GameObjects.Container {
  private readonly core: GameCore;
  private readonly fx: Fx;
  private readonly sfx: Sfx;
  private readonly blocked: () => boolean;
  private readonly flights = new Map<PowerupId, Flight>();
  private readonly chips = new Map<PowerupId, Chip>();
  private readonly chipRow: Phaser.GameObjects.Container;
  private readonly banners = new Map<PowerupId, Phaser.GameObjects.Container>();
  private readonly rainCoins: RainCoin[] = [];
  /** Brief, non-interactive screen-wide payoff for every collected powerup. */
  private readonly activationRoot: Phaser.GameObjects.Container;
  private readonly activationFlash: Phaser.GameObjects.Rectangle;
  private readonly activationIcon: Phaser.GameObjects.Image;
  private readonly activationLabel: Phaser.GameObjects.BitmapText;
  private readonly activationRings: Phaser.GameObjects.Arc[] = [];
  private readonly activationBeams: Phaser.GameObjects.Rectangle[] = [];
  private readonly activationParticles: Phaser.GameObjects.Image[] = [];
  private activationToken = 0;

  constructor(
    sceneRef: Phaser.Scene,
    core: GameCore,
    fx: Fx,
    sfx: Sfx,
    blocked: () => boolean,
  ) {
    super(sceneRef, 0, 0);
    this.core = core;
    this.fx = fx;
    this.sfx = sfx;
    this.blocked = blocked;
    sceneRef.add.existing(this);

    this.chipRow = sceneRef.add.container(0, 0).setDepth(305);
    this.activationFlash = sceneRef.add.rectangle(0, 0, 1, 1, 0xffffff, 0);
    this.activationIcon = sceneRef.add.image(0, 0, POWERUPS.shurikenFrenzy.iconTexture).setVisible(false);
    this.activationLabel = sceneRef.add
      .bitmapText(0, 0, 'pixel', '', 18)
      .setOrigin(0.5)
      .setCenterAlign()
      .setVisible(false);
    for (let i = 0; i < 3; i += 1) {
      this.activationRings.push(sceneRef.add.circle(0, 0, 60, 0xffffff, 0).setStrokeStyle(5, 0xffffff, 0).setVisible(false));
    }
    for (let i = 0; i < ACTIVATION_BEAMS; i += 1) {
      this.activationBeams.push(sceneRef.add.rectangle(0, 0, 1, 1, 0xffffff, 0).setVisible(false));
    }
    for (let i = 0; i < ACTIVATION_PARTICLES; i += 1) {
      this.activationParticles.push(sceneRef.add.image(0, 0, POWERUPS.shurikenFrenzy.iconTexture).setVisible(false));
    }
    this.activationRoot = sceneRef.add
      .container(0, 0, [this.activationFlash, ...this.activationRings, ...this.activationBeams, ...this.activationParticles, this.activationIcon, this.activationLabel])
      .setDepth(350)
      .setVisible(false);

    core.events.on('powerupSpawned', (event) => this.beginFlight(event.id));
    core.events.on('powerupCollected', (event) => this.onCollected(event.id));
    core.events.on('powerupWardBlocked', () => this.floatBlocked());

    this.relayout();
  }

  get liveIds(): PowerupId[] {
    return [...this.flights.entries()].filter(([, f]) => f.root.visible).map(([id]) => id);
  }

  posOf(id: PowerupId): { x: number; y: number } | null {
    const flight = this.flights.get(id);
    return flight && flight.root.visible ? { x: flight.root.x, y: flight.root.y } : null;
  }

  get liveRainCoins(): ReadonlyArray<{ x: number; y: number }> {
    return this.rainCoins
      .filter((coin) => coin.active && coin.image.visible)
      .map((coin) => ({ x: coin.image.x, y: coin.image.y }));
  }

  /** Real-time update; mirrors the clock and potion (sim speed irrelevant). */
  override update(dtMs: number): void {
    this.syncChips();
    if (this.blocked()) return;
    this.updateCoinRain(dtMs);
    for (const [id, flight] of this.flights) {
      if (!flight.root.visible) continue;
      const travelMs = POWERUPS[id].travelMs;
      flight.t += dtMs;
      const progress = flight.t / travelMs;
      if (progress >= 1) {
        // Drifted off unpunished: it simply leaves, the next offer comes later.
        this.hide(flight);
        this.core.notePowerupExpired(id);
        continue;
      }
      flight.bobPhase += dtMs;
      const x = Phaser.Math.Linear(flight.fromX, flight.toX, progress);
      const y = flight.laneY + Math.sin((flight.bobPhase / 2_100) * Math.PI * 2) * 36;
      flight.root.setPosition(x, y);
      flight.icon.setAngle(Math.sin((flight.bobPhase / 900) * Math.PI) * 9);
      flight.root.setAlpha(Phaser.Math.Clamp(Math.min(progress, 1 - progress) * 12, 0, 1));
    }
  }

  relayout(): void {
    const l = theme.layout;
    this.chipRow.setPosition(l.arena.x + l.arena.w / 2, l.arena.y + l.arena.h - (l.landscape ? 40 : 46));
    for (const banner of this.banners.values()) {
      banner.setPosition(l.arena.x + l.arena.w / 2, l.arena.y + (l.landscape ? 168 : 176));
    }
    for (const flight of this.flights.values()) {
      if (flight.root.visible) flight.laneY = Phaser.Math.Clamp(flight.laneY, l.arena.y + 90, l.arena.y + l.arena.h - 90);
    }
    for (const coin of this.rainCoins) {
      if (coin.active) coin.originX = Phaser.Math.Clamp(coin.originX, RAIN_EDGE_MARGIN, l.width - RAIN_EDGE_MARGIN);
    }
    this.activationFlash.setPosition(l.width / 2, l.height / 2).setSize(l.width, l.height);
  }

  /** Is this press on a token? Generous radius; these are moving targets. */
  hits(pointer: Phaser.Input.Pointer): PowerupId | null {
    for (const [id, flight] of this.flights) {
      if (!flight.root.visible) continue;
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, flight.root.x, flight.root.y) <= POWERUPS[id].tapRadiusPx) return id;
    }
    return null;
  }

  tryCollect(pointer: Phaser.Input.Pointer): boolean {
    const rainCoin = this.hitRainCoin(pointer);
    if (rainCoin !== null) {
      this.collectRainCoin(rainCoin);
      return true;
    }
    const id = this.hits(pointer);
    if (id === null) return false;
    this.core.collectPowerup(id);
    return true;
  }

  /** Debug/verification hook: put a token in the air right now. */
  forceSpawn(id?: PowerupId): void {
    const target = id ?? POWERUPS[Object.keys(POWERUPS)[0] as PowerupId].id;
    this.beginFlightNow(target);
  }

  /**
   * Entrance spacing: after a long gate or a session start on an old save,
   * several defs can come due in the same instant and the simulation drains
   * them back-to-back by design. Presenting them that way reads as a glitch,
   * so each launch waits until the previous token has had a moment on screen.
   */
  private static readonly ENTRANCE_STAGGER_MS = 2_200;
  private lastEntranceAt = Number.NEGATIVE_INFINITY;
  private readonly entranceQueue = new Map<PowerupId, Phaser.Time.TimerEvent>();

  private beginFlight(id: PowerupId): void {
    const existing = this.flights.get(id);
    if (existing !== undefined && existing.root.visible) return;
    const wait = PowerupPickups.ENTRANCE_STAGGER_MS - (this.scene.time.now - this.lastEntranceAt);
    if (wait <= 0) {
      this.beginFlightNow(id);
      return;
    }
    if (!this.entranceQueue.has(id)) {
      this.entranceQueue.set(
        id,
        this.scene.time.delayedCall(wait, () => {
          this.entranceQueue.delete(id);
          this.beginFlightNow(id);
        }),
      );
    }
  }

  private beginFlightNow(id: PowerupId): void {
    const existing = this.flights.get(id);
    if (existing !== undefined && existing.root.visible) return;
    const l = theme.layout;
    const def = POWERUPS[id];
    let flight = this.flights.get(id);
    if (flight === undefined) {
      const halo = this.scene.add.circle(0, 0, 44, def.hudColor, 0.24);
      const icon = this.scene.add.image(0, 0, def.iconTexture).setDisplaySize(PICKUP_ICON_SIZE, PICKUP_ICON_SIZE);
      const root = this.scene.add.container(0, 0, [halo, icon]).setVisible(false).setDepth(300);
      this.scene.add.existing(root);
      flight = { root, halo, icon, t: 0, fromX: 0, toX: 0, laneY: 0, bobPhase: 0 };
      this.flights.set(id, flight);
    }
    flight.t = 0;
    const leftToRight = Math.random() < 0.5;
    flight.fromX = leftToRight ? -70 : l.width + 70;
    flight.toX = leftToRight ? l.width + 70 : -70;
    flight.laneY = Phaser.Math.Between(l.arena.y + 110, l.arena.y + l.arena.h - 110);
    flight.bobPhase = Math.random() * 2_100;
    this.lastEntranceAt = this.scene.time.now;
    flight.root.setVisible(true).setPosition(flight.fromX, flight.laneY).setAlpha(0).setScale(1);
    flight.halo.setScale(1).setAlpha(0.24);
  }

  private hide(flight: Flight): void {
    flight.root.setVisible(false).setAlpha(1).setScale(1);
  }

  /** A small burst of the powerup's own colour where it was caught. */
  private scatter(flight: Flight): void {
    const originX = flight.root.x;
    const originY = flight.root.y;
    const tint = POWERUPS[this.keyOf(flight)].hudColor;
    const merge = VFX_ANIMATIONS.merge;
    for (let i = 0; i < 10; i += 1) {
      const spark = this.scene.add.sprite(originX, originY, merge.textureKey, 0).setDepth(302).setScale(0.14).setTint(tint).play(merge.animationKey);
      const angle = (Math.PI * 2 * i) / 10;
      this.scene.tweens.add({
        targets: spark,
        x: originX + Math.cos(angle) * 120,
        y: originY + Math.sin(angle) * 120,
        alpha: 0,
        scale: 0.03,
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }

  private keyOf(flight: Flight): PowerupId {
    for (const [id, candidate] of this.flights) if (candidate === flight) return id;
    return 'shurikenFrenzy';
  }

  private onCollected(id: PowerupId): void {
    const flight = this.flights.get(id);
    const def = POWERUPS[id];
    this.sfx.play('newTier');
    if (flight !== undefined && flight.root.visible) {
      this.fx.mergeFlash(flight.root.x, flight.root.y);
      this.scatter(flight);
      this.hide(flight);
    }
    this.playActivation(def);
    if (def.effect === 'coinRain') this.startCoinRain(this.core.coinFrenzyState.remaining);
    this.showBanner(def);
  }

  /**
   * Every pickup gets a quick whole-screen signature moment. This lives above
   * the board but owns no input, so a Coin Frenzy can immediately rain
   * collectable coins over the celebration instead of waiting for it to end.
   */
  private playActivation(def: PowerupDef): void {
    const token = this.activationToken + 1;
    this.activationToken = token;
    const l = theme.layout;
    const centerX = l.width / 2;
    const centerY = l.height / 2;
    const targets = [
      this.activationRoot,
      this.activationFlash,
      this.activationIcon,
      this.activationLabel,
      ...this.activationRings,
      ...this.activationBeams,
      ...this.activationParticles,
    ];
    this.scene.tweens.killTweensOf(targets);
    this.activationRoot.setVisible(true);
    this.activationFlash.setFillStyle(def.hudColor, 0).setAlpha(0);
    this.activationIcon
      .setTexture(def.iconTexture)
      .setPosition(centerX, centerY - 24)
      .setDisplaySize(184, 184)
      .setScale(0.34)
      .setAlpha(0)
      .setVisible(true);
    this.activationLabel
      .setPosition(centerX, centerY + 132)
      .setText(def.effect === 'coinRain' ? `${def.label}!\nTAP COINS!` : `${def.label}!`)
      .setTint(def.hudColor)
      .setScale(0.7)
      .setAlpha(0)
      .setVisible(true);
    this.scene.tweens.add({ targets: this.activationFlash, alpha: { from: 0.36, to: 0 }, duration: 760, ease: 'Quad.easeOut' });
    this.scene.tweens.add({ targets: this.activationIcon, alpha: { from: 0, to: 1 }, scale: { from: 0.34, to: 1.12 }, duration: 300, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: this.activationIcon, angle: { from: -12, to: 12 }, yoyo: true, repeat: 1, duration: 160, delay: 220, ease: 'Sine.easeInOut' });
    this.scene.tweens.add({ targets: this.activationIcon, alpha: { from: 1, to: 0 }, scale: { from: 1.12, to: 1.46 }, duration: 310, delay: 620, ease: 'Quad.easeIn' });
    this.scene.tweens.add({ targets: this.activationLabel, alpha: { from: 0, to: 1 }, scale: { from: 0.7, to: 1 }, duration: 260, delay: 120, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: this.activationLabel, alpha: { from: 1, to: 0 }, y: centerY + 98, duration: 340, delay: 650, ease: 'Quad.easeIn' });

    const maxRingScale = Math.max(l.width, l.height) / 74;
    this.activationRings.forEach((ring, index) => {
      ring
        .setPosition(centerX, centerY)
        .setRadius(50 + index * 24)
        .setStrokeStyle(5, def.hudColor, 0.9)
        .setScale(0.1)
        .setAlpha(0.95)
        .setVisible(true);
      this.scene.tweens.add({
        targets: ring,
        scale: maxRingScale,
        alpha: 0,
        duration: 720 + index * 110,
        delay: index * 80,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.setVisible(false),
      });
    });

    // Wide, transparent rays make the activation register across the entire
    // display even for powerups whose source icon is intentionally compact.
    const beamLength = Math.hypot(l.width, l.height) * 1.3;
    this.activationBeams.forEach((beam, index) => {
      beam
        .setPosition(centerX, centerY)
        .setSize(42, beamLength)
        .setAngle((360 / this.activationBeams.length) * index + Phaser.Math.Between(-12, 12))
        .setFillStyle(def.hudColor, 0.22)
        .setScale(0.08, 1)
        .setAlpha(0.64)
        .setVisible(true);
      this.scene.tweens.add({
        targets: beam,
        scaleX: 1.9,
        alpha: 0,
        duration: 620,
        delay: index * 18,
        ease: 'Cubic.easeOut',
        onComplete: () => beam.setVisible(false),
      });
    });

    this.activationParticles.forEach((particle, index) => {
      const startX = Phaser.Math.Between(-30, l.width + 30);
      const startY = Phaser.Math.Between(-30, l.height + 30);
      particle
        .setTexture(def.iconTexture)
        // The burst begins across the entire display rather than travelling
        // there from the centre, so it reads as a screen takeover on frame 1.
        .setPosition(startX, startY)
        .setDisplaySize(Phaser.Math.Between(62, 96), Phaser.Math.Between(62, 96))
        .setAngle(Phaser.Math.Between(-35, 35))
        .setScale(0.58)
        .setAlpha(0.96)
        .setVisible(true);
      this.scene.tweens.add({
        targets: particle,
        x: startX + Phaser.Math.Between(-90, 90),
        y: startY + Phaser.Math.Between(-90, 90),
        angle: particle.angle + Phaser.Math.Between(-540, 540),
        scale: Phaser.Math.FloatBetween(0.92, 1.3),
        alpha: 0,
        duration: Phaser.Math.Between(620, 960),
        delay: index * 12,
        ease: 'Cubic.easeOut',
        onComplete: () => particle.setVisible(false),
      });
    });

    this.scene.time.delayedCall(1_020, () => {
      if (token === this.activationToken) this.activationRoot.setVisible(false);
    });
  }

  private startCoinRain(count: number): void {
    this.clearCoinRain();
    while (this.rainCoins.length < count) {
      const image = this.scene.add.image(0, 0, ATLAS_KEY, 'icon_coin').setVisible(false).setDepth(370);
      this.rainCoins.push({
        image,
        active: false,
        elapsedMs: 0,
        delayMs: 0,
        fallMs: 0,
        originX: 0,
        startY: 0,
        swayPx: 0,
        swayPhase: 0,
        spin: 0,
      });
    }
    const l = theme.layout;
    const lanes = Math.min(6, Math.max(1, count));
    for (let i = 0; i < count; i += 1) {
      const coin = this.rainCoins[i]!;
      const lane = i % lanes;
      const wave = Math.floor(i / lanes);
      coin.active = true;
      coin.elapsedMs = 0;
      // Six quick waves put every payout on screen within half a second,
      // instead of making a 36-coin frenzy look like a few stray drops.
      coin.delayMs = wave * RAIN_STAGGER_MS + Phaser.Math.Between(0, 48);
      coin.fallMs = Phaser.Math.Between(4_700, 6_200);
      const laneCenter = ((lane + 0.5) / lanes) * l.width;
      coin.originX = Phaser.Math.Clamp(laneCenter + Phaser.Math.Between(-26, 26), RAIN_EDGE_MARGIN, l.width - RAIN_EDGE_MARGIN);
      // A whole-screen field is legible immediately and still reads as a rain
      // cascade while every coin drifts down toward the wallet.
      coin.startY = Phaser.Math.Between(-RAIN_COIN_SIZE, Math.round(l.height * 0.58));
      coin.swayPx = Phaser.Math.Between(24, 62);
      coin.swayPhase = Math.random() * Math.PI * 2;
      coin.spin = Phaser.Math.Between(-190, 190);
      this.scene.tweens.killTweensOf(coin.image);
      coin.image
        .setPosition(coin.originX, coin.startY)
        .setDisplaySize(RAIN_COIN_SIZE, RAIN_COIN_SIZE)
        .setAngle(Phaser.Math.Between(-30, 30))
        .setAlpha(1)
        .setVisible(false)
        .setDepth(370);
    }
  }

  private updateCoinRain(dtMs: number): void {
    const height = theme.layout.height;
    for (const coin of this.rainCoins) {
      if (!coin.active) continue;
      coin.elapsedMs += Math.max(0, dtMs);
      if (coin.elapsedMs < coin.delayMs) continue;
      const progress = (coin.elapsedMs - coin.delayMs) / coin.fallMs;
      if (progress >= 1) {
        coin.active = false;
        coin.image.setVisible(false);
        this.core.missCoinFrenzyCoin();
        continue;
      }
      const wave = Math.sin(progress * Math.PI * 3 + coin.swayPhase) * coin.swayPx;
      coin.image
        .setVisible(true)
        .setPosition(Phaser.Math.Clamp(coin.originX + wave, RAIN_EDGE_MARGIN, theme.layout.width - RAIN_EDGE_MARGIN), Phaser.Math.Linear(coin.startY, height + RAIN_COIN_SIZE, progress))
        .setAngle(coin.image.angle + coin.spin * (dtMs / 1000))
        .setAlpha(Phaser.Math.Clamp(Math.min(progress * 8, (1 - progress) * 8), 0, 1));
    }
  }

  private hitRainCoin(pointer: Phaser.Input.Pointer): RainCoin | null {
    for (let i = this.rainCoins.length - 1; i >= 0; i -= 1) {
      const coin = this.rainCoins[i]!;
      if (!coin.active || !coin.image.visible) continue;
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, coin.image.x, coin.image.y) <= RAIN_TAP_RADIUS) return coin;
    }
    return null;
  }

  private collectRainCoin(coin: RainCoin): void {
    if (!coin.active) return;
    const value = this.core.collectCoinFrenzyCoin();
    coin.active = false;
    if (value <= 0) {
      coin.image.setVisible(false);
      return;
    }
    this.sfx.play('coin');
    this.floatCoinValue(coin.image.x, coin.image.y, value);
    const target = theme.layout.coin;
    coin.image.setDepth(380).setAlpha(1);
    this.scene.tweens.add({
      targets: coin.image,
      x: target.x,
      y: target.y,
      angle: coin.image.angle + 360,
      duration: 360,
      ease: 'Quad.easeIn',
      onComplete: () => {
        coin.image.setVisible(false).setDepth(370);
        CurrencyDisplay.of(this.scene)?.tick();
      },
    });
  }

  private floatCoinValue(x: number, y: number, value: number): void {
    const label = this.scene.add
      .bitmapText(x, y - 28, 'pixel', `+${compactNumber(value)}`, 13)
      .setOrigin(0.5)
      .setTint(0xffe58a)
      .setDepth(381);
    this.scene.tweens.add({
      targets: label,
      y: label.y - 42,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private clearCoinRain(): void {
    for (const coin of this.rainCoins) {
      this.scene.tweens.killTweensOf(coin.image);
      coin.active = false;
      coin.image.setVisible(false).setDepth(370);
    }
  }

  /** One compact plate per running effect, draining left to right. */
  private syncChips(): void {
    const active = this.core.powerups.activeEffects();
    const liveIds = new Set<PowerupId>(active.map((effect) => effect.id));
    const wardCharges = this.core.powerups.wardCharges;

    for (const [id, chip] of this.chips) {
      const stillLive = liveIds.has(id) || (id === 'protectiveWard' && wardCharges > 0);
      if (!stillLive) {
        chip.root.destroy();
        this.chips.delete(id);
        this.sfx.play('drop');
      }
    }
    for (const effect of active) this.placeChip(effect.id);
    if (wardCharges > 0 && !liveIds.has('protectiveWard')) this.placeChip('protectiveWard');
    this.layoutChips();
  }

  private placeChip(id: PowerupId): void {
    let chip = this.chips.get(id);
    const def = POWERUPS[id];
    if (chip === undefined) {
      const bg = this.scene.add.rectangle(0, 0, CHIP_W, CHIP_H, 0x201a14, 0.86).setStrokeStyle(3, def.hudColor);
      const icon = this.scene.add.image(-CHIP_W / 2 + 22, 0, def.iconTexture).setDisplaySize(CHIP_ICON_SIZE, CHIP_ICON_SIZE);
      const label = this.scene.add.bitmapText(-CHIP_W / 2 + 42, 0, 'pixel', def.label.split(' ')[0] ?? def.label, 10).setOrigin(0, 0.5).setTint(0xfff3d9);
      const fillWidth = CHIP_W - 52;
      const fill = this.scene.add.rectangle(-CHIP_W / 2 + 26, CHIP_H / 2 - 7, fillWidth, 5, def.hudColor).setOrigin(0, 0.5);
      // Chip positions are offsets from `chipRow`; leaving them on the scene's
      // root display list makes those offsets absolute, which pins the row to
      // (0, 0) and clips half of every chip into the top-left screen edge.
      const root = this.scene.add.container(0, 0, [bg, icon, label, fill]);
      this.chipRow.add(root);
      chip = { root, fill, label, fillWidth };
      this.chips.set(id, chip);
    }
    const effect = this.core.powerups.activeEffects().find((entry) => entry.id === id);
    if (effect !== undefined) {
      chip.fill.width = Math.max(2, chip.fillWidth * Math.max(0, Math.min(1, effect.remainingMs / this.totalFor(id))));
      if (def.effect === 'dpsMultiplier' || def.effect === 'coinMultiplier') {
        chip.label.setText(`${def.label.split(' ')[0] ?? ''} X${def.factor}`);
      } else {
        chip.label.setText(def.label.split(' ')[0] ?? def.label);
      }
    } else {
      // Ward with charges banked but no timed window: show the charge count.
      chip.fill.width = chip.fillWidth * Math.max(0, Math.min(1, this.core.powerups.wardCharges / (def.effect === 'ward' ? def.charges : 1)));
      chip.label.setText(`WARD X${this.core.powerups.wardCharges}`);
    }
    chip.root.setVisible(true);
  }

  private totalFor(id: PowerupId): number {
    const def = POWERUPS[id];
    return def.effect === 'ward' || def.effect === 'coinRain' ? 1 : def.durationMs;
  }

  private layoutChips(): void {
    const ids = [...this.chips.keys()];
    const pitch = CHIP_W + 12;
    const startX = -((ids.length - 1) * pitch) / 2;
    ids.forEach((id, i) => this.chips.get(id)?.root.setPosition(startX + i * pitch, 0));
  }

  private showBanner(def: PowerupDef): void {
    let banner = this.banners.get(def.id);
    if (banner === undefined) {
      const coinRain = def.effect === 'coinRain';
      const bg = this.scene.add.rectangle(0, 0, 300, coinRain ? 70 : 56, 0x241a10).setStrokeStyle(4, def.hudColor);
      const copy = coinRain ? `${def.label}!\nTAP THE COINS!` : def.label;
      const label = this.scene.add.bitmapText(0, 0, 'pixel', copy, coinRain ? 12 : 14).setOrigin(0.5).setCenterAlign().setTint(def.hudColor);
      // Stage announcements share this arena lane. A collected powerup is the
      // actionable, time-sensitive message, so it must read above "STAGE
      // REACHED" rather than being hidden behind it.
      banner = this.scene.add.container(0, 0, [bg, label]).setVisible(false).setDepth(320);
      this.scene.add.existing(banner);
      this.banners.set(def.id, banner);
    }
    this.relayout();
    banner.setVisible(true).setAlpha(0).setScale(0.7);
    this.scene.tweens.add({ targets: banner, alpha: 1, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.scene.time.delayedCall(1_400, () => {
      this.scene.tweens.add({
        targets: banner,
        alpha: 0,
        duration: 240,
        onComplete: () => banner?.setVisible(false),
      });
    });
  }

  private floatBlocked(): void {
    const l = theme.layout;
    const text = this.scene.add
      .bitmapText(l.arena.x + l.arena.w / 2, l.arena.y + l.arena.h * 0.55, 'pixel', 'BLOCKED!', 16)
      .setOrigin(0.5)
      .setTint(0x7dff9e)
      .setDepth(308);
    this.scene.tweens.add({
      targets: text,
      y: text.y - 64,
      alpha: 0,
      duration: 780,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }
}
