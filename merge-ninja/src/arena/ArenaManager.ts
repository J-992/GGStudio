import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import type { SfxName } from '../audio/Sfx';
import type { VFXManager } from '../effects/VFXManager';
import { bossSpawnRecipe, type BossSpawnVfxRecipe } from '../data/bossVfx';
import { ninjaDef } from '../data/ninjas';
import { ATLAS_KEY, bossCatalogPortrait, FLAME_SHOGUN_TIER, ninjaCatalogPortrait } from '../render/atlasConfig';
import { portraitTexture } from '../render/portraitTexture';
import {
  bossScale,
  bossTapContainsPoint,
  fourFramePoseAt,
  HUMANOID_BOSS_BASIC_FOUR_FRAME,
  HUMANOID_BOSS_IDLE_FOUR_FRAME,
  HUMANOID_BOSS_SPECIAL_FOUR_FRAME,
  ninjaIdleFrameAt,
  ninjaScale,
  type FourFrameAnimation,
  type FourFramePose,
} from '../data/presentation';
import { ArenaScenery } from './ArenaScenery';
import { theme } from '../ui/theme';
import { CLASSIC_DOJO_STYLE, type DojoStyleDef } from '../data/dojoStyles';

/** Authored creature attack cadence: anticipation -> impact -> recovery. */
const BOSS_EIGHT_FRAME_MS = [110, 100, 95, 85, 75, 90, 115, 150] as const;
const BOSS_EIGHT_IDLE_FRAME_MS = 420;

export type ActorState = 'idle' | 'moving' | 'attacking' | 'reacting' | 'recovering';
export interface ArenaActor {
  sprite: Phaser.GameObjects.Sprite;
  tier: number;
  state: ActorState;
  home: Phaser.Math.Vector2;
  scale: number;
}

/**
 * Presentation deps for data-driven boss entrances. Wired by the scene that
 * owns the shared VFX pool; without it entrances fall back to the plain
 * portal fly-in so every scene keeps working.
 */
export interface BossEntrancePresenter {
  vfx: VFXManager;
  /** Already-capped camera shake (Fx.shake clamps to .012 / 220ms). */
  shake(intensity: number, durationMs: number): void;
  sfx(name: SfxName, tier?: number): void;
}

/** Mirrors a deliberately small, high-tier biased sample of the merge board. */
export class ArenaManager {
  readonly scenery: ArenaScenery;
  readonly actors: ArenaActor[] = [];
  readonly boss: Phaser.GameObjects.Sprite;
  private readonly bossAura: Phaser.GameObjects.Arc;
  private readonly bossCrest: Phaser.GameObjects.Image;
  private readonly actorPool: Phaser.GameObjects.Sprite[] = [];
  private readonly actorAuras: Phaser.GameObjects.Ellipse[] = [];
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private bossFootInset = 0;
  private bossHasEntered = false;
  private entrancePresenter: BossEntrancePresenter | null = null;
  private style: DojoStyleDef = CLASSIC_DOJO_STYLE;
  constructor(private readonly scene: Phaser.Scene, private readonly core: GameCore) {
    this.scenery = new ArenaScenery(scene, core.boss.stage);
    const a = theme.layout.arena;
    this.maskShape = scene.add.graphics().fillRect(a.x, a.y, a.w, a.h).setVisible(false);
    const mask = this.maskShape.createGeometryMask();
    for (let i = 0; i < 3; i += 1) {
      this.actorAuras.push(
        scene.add.ellipse(-200, -200, 94, 24, 0xffc85b, 0.16)
          .setStrokeStyle(2, 0xffef9a, 0.58)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false)
          .setDepth(11)
          .setMask(mask),
      );
      this.actorPool.push(scene.add.sprite(-200, -200, ATLAS_KEY, 'ninja_t1').setVisible(false).setDepth(12));
    }
    this.bossAura = scene.add.circle(this.scenery.bossPlatform.x, this.scenery.bossPlatform.y - 105, 126, 0xd66ac5, .10).setDepth(10).setMask(mask);
    this.bossCrest = scene.add
      .image(this.scenery.bossPlatform.x, this.scenery.bossPlatform.y - 105, ATLAS_KEY, 'fx_ring')
      .setTint(0xffc85b)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setDepth(34)
      .setMask(mask);
    this.boss = scene.add.sprite(this.scenery.bossPlatform.x, this.scenery.bossPlatform.y - 128, ATLAS_KEY, core.boss.boss.spriteKey).setDepth(35).setMask(mask);
    this.actorPool.forEach((sprite) => sprite.setMask(mask));
    this.sync();
  }
  sync(): void {
    const owned = this.core.board.slots
      .filter((ninja): ninja is NonNullable<typeof ninja> => ninja !== null)
      .sort((a, b) => b.tier - a.tier || a.id - b.id)
      .slice(0, this.actorPool.length);
    this.actors.length = 0;
    // The supplied character art is a single flattened frame. Pivoting low in
    // the body keeps feet planted while the built-in weapon silhouette swings.
    const actorOriginY = 0.77;
    this.actorPool.forEach((sprite, index) => {
      const ninja = owned[index];
      if (ninja === undefined) {
        sprite.setVisible(false);
        this.actorAuras[index]?.setVisible(false);
        return;
      }
      const p = this.scenery.platforms[index % 3]!;
      const def = ninjaDef(ninja.tier);
      const art = portraitTexture(this.scene, def, ninjaCatalogPortrait(ninja.tier));
      sprite.stop().setTexture(art.key, art.frame);
      if (art.animated) sprite.setFrame(0);
      // Portraits may have different native dimensions (the final evolution is
      // deliberately wide), so normalise from the loaded frame rather than
      // assuming all supplied art is 128px high.
      const actorScale = ninjaScale(sprite.frame.width, sprite.frame.height, theme.layout.arenaNinjaHeight, ninja.tier);
      const footInset = art.footInset * actorScale;
      const home = new Phaser.Math.Vector2(
        p.x,
        p.y - theme.layout.arenaNinjaHeight * (1 - actorOriginY) + footInset,
      );
      sprite
        .setOrigin(0.5, actorOriginY)
        .setPosition(home.x, home.y)
        .setScale(actorScale)
        .setAngle(0)
        .setFlipX(false)
        .setAlpha(1)
        .setTint(def.artTint)
        .setDepth(12)
        .setVisible(true);
      this.actorAuras[index]
        ?.setPosition(home.x, p.y - 7)
        .setScale(Math.max(.72, Math.min(1.1, actorScale * 1.25)))
        .setVisible(this.style.id === 'crimson-dojo');
      this.actors.push({ sprite, tier: ninja.tier, state: 'idle', home, scale: actorScale });
    });
    this.refreshBoss(false);
  }
  refreshBoss(slide: boolean): void {
    const boss = this.core.boss.boss;
    this.scenery.setStage(boss.stage, slide && this.bossHasEntered);
    // Bosses reuse one sprite. At high game speed the next spawn can happen
    // before the prior defeat fade completes, so cancel that stale fade first.
    this.scene.tweens.killTweensOf([this.boss, this.bossAura]);
    // Player ninjas attack from the left side of the stage, so flip the enemy
    // art toward them instead of presenting its back or weapon to the crowd.
    const art = portraitTexture(this.scene, boss, bossCatalogPortrait(boss.appearanceIndex));
    this.boss.stop();
    this.bossFootInset = art.footInset;
    this.boss.setTexture(art.key, art.frame);
    if (art.animated) this.boss.setFrame(0);
    this.boss.setFlipX(true).setTint(boss.artTint);
    const nativeHeight = this.boss.frame.height;
    const scale = this.bossScale();
    const x = this.scenery.bossPlatform.x;
    const y = this.scenery.bossPlatform.y - nativeHeight * scale / 2 + this.bossFootInset * scale;
    this.boss.setScale(scale).setPosition(x, y).setAngle(0).setAlpha(1).setVisible(true).setDepth(40);
    this.bossCrest
      .setPosition(x, y)
      .setScale(Math.max(1.2, Math.min(2.1, this.boss.displayHeight / 115)))
      .setVisible(this.style.id === 'crimson-dojo')
      .setAlpha(this.style.id === 'crimson-dojo' ? .28 : 0);
    this.bossAura
      .setPosition(x, y)
      .setRadius(Math.min(142, this.boss.displayHeight * .55))
      .setScale(1)
      .setAlpha(.15)
      .setVisible(true);
    if (slide || !this.bossHasEntered) {
      this.bossHasEntered = true;
      this.enterBossFromPortal();
    } else {
      this.startBossAuraPulse();
    }
  }
  /**
   * Boss size, normalised on frame area rather than height.
   *
   * `theme.layout.bossHeight` is a presence target, not a literal height: the
   * supplied boss art ranges from tall serpents to low, wide hydras, and
   * height alone made the squat ones read as smaller than the ninjas hitting
   * them. See `bossScale` in `src/data/presentation.ts`.
   */
  private bossScale(): number {
    const a = theme.layout.arena;
    return bossScale(this.boss.frame.width, this.boss.frame.height, theme.layout.bossHeight, { w: a.w, h: a.h });
  }

  /**
   * Whether the boss is drawing its own frame strip yet.
   *
   * Boss art streams in behind the running game, so until this boss's portrait
   * arrives the sprite is showing a single stand-in frame from the packed
   * atlas. Every strip-stepping path has to check this first: `setFrame(3)` on
   * an atlas texture does not fail, it just draws whatever was packed fourth.
   * The transform-driven poses are fine either way, so a stand-in still moves.
   */
  private bossOnStrip(): boolean {
    return this.boss.texture.key !== ATLAS_KEY;
  }

  update(dt: number): void {
    this.scenery.update(0, dt);
    const now = this.scene.time.now;
    for (const actor of this.actors) if (actor.state === 'idle') this.animateIdleActor(actor, now);
    if (this.boss.visible && !this.scene.tweens.isTweening(this.boss)) {
      const baseScale = this.bossScale();
      const home = this.bossHome();
      const boss = this.core.boss.boss;
      if (boss.animation === 'eightFrame' && this.bossOnStrip()) {
        const idleFrame = Math.floor((now + boss.appearanceIndex * 127) / BOSS_EIGHT_IDLE_FRAME_MS) % 2;
        this.boss.setFrame(idleFrame).setPosition(home.x, home.y).setScale(baseScale).setAngle(0);
      } else {
        const { pose } = fourFramePoseAt(HUMANOID_BOSS_IDLE_FOUR_FRAME, now + boss.appearanceIndex * 127);
        this.applyPose(this.boss, home, baseScale, -1, 1, pose);
      }
    }
    if (this.bossCrest.visible) {
      this.bossCrest.setPosition(this.boss.x, this.boss.y).setAngle(this.scene.time.now * .018);
    }
  }
  relayout(): void { const a = theme.layout.arena; this.maskShape.clear().fillRect(a.x, a.y, a.w, a.h); this.scenery.relayout(); this.sync(); }
  bossHome(): Phaser.Math.Vector2 {
    const baseScale = this.bossScale();
    return new Phaser.Math.Vector2(
      this.scenery.bossPlatform.x,
      this.scenery.bossPlatform.y - this.boss.frame.height * baseScale / 2 + this.bossFootInset * baseScale,
    );
  }
  bossAccent(): number { return this.core.boss.boss.accent; }
  bossDef() { return this.core.boss.boss; }
  /** Generous body-only hit test for the player's optional manual strike. */
  containsBossPoint(x: number, y: number): boolean {
    if (!this.boss.visible || this.boss.alpha < .5 || this.core.boss.defeated) return false;
    return bossTapContainsPoint(this.boss, x, y);
  }
  /** Scene wiring for the shared VFX pool, camera shake, and sfx bus. Pass null to detach. */
  attachBossEntrancePresenter(presenter: BossEntrancePresenter | null): void { this.entrancePresenter = presenter; }
  setDojoStyle(style: DojoStyleDef): void {
    this.style = style;
    const crimson = style.id === 'crimson-dojo';
    this.bossAura.setFillStyle(crimson ? style.palette.bossAura : 0xd66ac5);
    this.bossCrest.setVisible(crimson).setTint(style.palette.accentBright).setAlpha(crimson ? .28 : 0);
    this.actorAuras.forEach((aura, index) => {
      aura
        .setFillStyle(style.palette.ninjaAura, crimson ? .17 : 0)
        .setStrokeStyle(2, style.palette.accentBright, crimson ? .62 : 0)
        .setVisible(crimson && this.actorPool[index]?.visible === true);
    });
  }
  /**
   * Humanoids use transform choreography; creatures play their authored
   * anatomy-specific eight-frame strip. Both report impact on the strike pose.
   */
  bossStrike(special = false, onImpact?: () => void): void {
    if (!this.boss.visible) return;
    const animation = this.core.boss.boss.animation;
    const home = this.bossHome();
    const baseScale = this.bossScale();
    this.scene.tweens.killTweensOf(this.boss);
    this.boss.setPosition(home.x, home.y).setScale(baseScale).setAngle(0);
    if (animation === 'eightFrame' && this.bossOnStrip()) {
      this.runBossEightFrame(home, baseScale, special, onImpact);
      return;
    }
    this.runBossFourFrame(
      special ? HUMANOID_BOSS_SPECIAL_FOUR_FRAME : HUMANOID_BOSS_BASIC_FOUR_FRAME,
      home,
      baseScale,
      onImpact,
    );
  }
  highest(): ArenaActor | undefined { return this.actors.reduce<ArenaActor | undefined>((best, actor) => best === undefined || actor.tier > best.tier ? actor : best, undefined); }
  pick(index: number): ArenaActor | undefined { return this.actors[index % this.actors.length]; }
  reset(actor: ArenaActor): void {
    actor.state = 'idle';
    actor.sprite.setPosition(actor.home.x, actor.home.y).setAlpha(1).setScale(actor.scale).setAngle(0);
  }

  private animateIdleActor(actor: ArenaActor, now: number): void {
    const catalogPortrait = ninjaCatalogPortrait(actor.tier);
    // While a portrait is still streaming in, this sprite is showing a single
    // atlas frame instead of a strip, and stepping it by index would land on
    // whatever art happens to be packed alongside it.
    const onStrip = actor.sprite.texture.key !== ATLAS_KEY;
    if (onStrip && catalogPortrait?.animation !== undefined) {
      actor.sprite.setFrame(ninjaIdleFrameAt(now, actor.tier * 379, actor.tier === FLAME_SHOGUN_TIER));
    }
    // Idle poses live in the strip. Keeping this transform neutral prevents
    // the previous left/right slide and preserves the exact foot baseline.
    actor.sprite.setPosition(actor.home.x, actor.home.y).setScale(actor.scale).setAngle(0);
  }

  private applyPose(
    sprite: Phaser.GameObjects.Sprite,
    home: Phaser.Math.Vector2,
    scale: number,
    direction: number,
    angleDirection: number,
    pose: FourFramePose,
  ): void {
    sprite
      .setPosition(home.x + pose.x * direction, home.y + pose.y)
      .setScale(scale * pose.scaleX, scale * pose.scaleY)
      .setAngle(pose.angle * angleDirection);
  }

  private runBossFourFrame(
    animation: FourFrameAnimation,
    home: Phaser.Math.Vector2,
    baseScale: number,
    onImpact?: () => void,
  ): void {
    let index = 0;
    const next = (): void => {
      const pose = animation[index]!;
      this.scene.tweens.add({
        targets: this.boss,
        x: home.x - pose.x,
        y: home.y + pose.y,
        scaleX: baseScale * pose.scaleX,
        scaleY: baseScale * pose.scaleY,
        angle: pose.angle,
        duration: pose.duration,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          if (index === 2) onImpact?.();
          index += 1;
          if (index < animation.length) next();
          else {
            this.boss.setPosition(home.x, home.y).setScale(baseScale).setAngle(0);
            this.startBossAuraPulse();
          }
        },
      });
    };
    next();
  }

  /** Plays all eight equal-sized cells without transform wobble fighting the art. */
  private runBossEightFrame(
    home: Phaser.Math.Vector2,
    baseScale: number,
    special: boolean,
    onImpact?: () => void,
  ): void {
    let index = 0;
    const speed = special ? .84 : 1;
    const next = (): void => {
      this.boss.setFrame(index).setPosition(home.x, home.y).setScale(baseScale).setAngle(0);
      this.scene.tweens.add({
        targets: this.boss,
        x: home.x,
        duration: Math.round(BOSS_EIGHT_FRAME_MS[index]! * speed),
        onComplete: () => {
          if (index === 4) onImpact?.();
          index += 1;
          if (index < BOSS_EIGHT_FRAME_MS.length) next();
          else {
            this.boss.setFrame(0).setPosition(home.x, home.y).setScale(baseScale).setAngle(0);
            this.startBossAuraPulse();
          }
        },
      });
    };
    next();
  }

  private startBossAuraPulse(): void {
    this.scene.tweens.killTweensOf(this.bossAura);
    this.bossAura.setScale(1).setAlpha(.15);
    this.scene.tweens.add({
      targets: this.bossAura,
      alpha: .21,
      scale: 1.07,
      duration: 940,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * Data-driven boss entrance: src/data/bossVfx.ts decides how identity N
   * arrives, this method only stages tweens and pooled VFX. Everything here is
   * fire-and-forget; gameplay resolution never waits on an entrance finishing.
   */
  private enterBossFromPortal(): void {
    const presenter = this.entrancePresenter;
    if (presenter === null) { this.enterLegacyPortal(); return; }
    const boss = this.core.boss.boss;
    const recipe = bossSpawnRecipe(boss.appearanceIndex - 1);
    const vfx = presenter.vfx;
    const home = this.bossHome();
    const baseScale = this.bossScale();
    const primary = recipe.palette[0]!;
    const secondary = recipe.palette[1] ?? primary;
    const ts = recipe.timingScale;
    const footY = this.scenery.bossPlatform.y;
    const drop = Math.max(230, this.boss.frame.height * baseScale * .95);
    this.bossAura.setFillStyle(this.style.id === 'crimson-dojo' ? this.style.palette.bossAura : primary);
    // Landing payoff shared by every non-portal entrance: impact, shake, sound.
    const land = (): void => {
      this.fireGroundImpact(vfx, recipe, home.x, footY);
      this.fireMotif(vfx, recipe, home.x, home.y);
      this.fireEntranceShake(recipe);
      this.fireEntranceSound(recipe);
      this.startBossAuraPulse();
    };
    switch (recipe.entrance) {
      case 'portal': {
        const portal = this.scenery.portalOrigin();
        this.scenery.pulsePortal();
        vfx.portal(portal.x, portal.y, primary);
        vfx.shockwave(portal.x, portal.y, secondary, 1.6 + recipe.intensity * .4);
        this.stageBossAt(portal.x, portal.y, baseScale * .2, 0);
        this.bossAura.setPosition(portal.x, portal.y).setScale(.35).setAlpha(.46);
        this.scene.tweens.add({
          targets: this.boss,
          x: home.x,
          y: home.y,
          scaleX: baseScale,
          scaleY: baseScale,
          alpha: 1,
          duration: 580 * ts,
          ease: 'Back.easeOut',
          onComplete: () => { this.fireGroundImpact(vfx, recipe, home.x, footY); this.fireEntranceShake(recipe); this.fireEntranceSound(recipe); this.startBossAuraPulse(); },
        });
        this.scene.tweens.add({ targets: this.bossAura, x: home.x, y: home.y, scale: 1, alpha: .16, duration: 580 * ts, ease: 'Cubic.easeOut' });
        break;
      }
      case 'pillar': {
        vfx.pillarOfLight(home.x, footY, primary, 2.4 + recipe.intensity);
        this.scene.tweens.add({ targets: this.bossAura, x: home.x, y: home.y, scale: 1, alpha: .18, delay: 120 * ts, duration: 420 * ts, ease: 'Cubic.easeOut' });
        this.stageBossAt(home.x, home.y + drop, baseScale * .3, 0);
        this.scene.tweens.add({
          targets: this.boss,
          y: home.y,
          scaleX: baseScale,
          scaleY: baseScale,
          alpha: 1,
          duration: 520 * ts,
          delay: 90 * ts,
          ease: 'Cubic.easeOut',
          onComplete: () => { vfx.pillarOfLight(home.x, footY, secondary, 1.8); land(); },
        });
        break;
      }
      case 'riftTear': {
        const portal = this.scenery.portalOrigin();
        vfx.riftTear(portal.x, portal.y, primary, 2.4 + recipe.intensity);
        this.stageBossAt(portal.x - 26, portal.y, baseScale * .55, 0);
        this.bossAura.setPosition(portal.x, portal.y).setScale(.5).setAlpha(.3);
        this.scene.tweens.add({ targets: this.bossAura, x: home.x, y: home.y, scale: 1, alpha: .16, duration: 500 * ts, ease: 'Sine.easeOut' });
        this.scene.tweens.add({
          targets: this.boss,
          alpha: .9,
          duration: 150 * ts,
          ease: 'Quad.easeOut',
          onComplete: () => this.scene.tweens.add({
            targets: this.boss,
            x: home.x,
            y: home.y,
            scaleX: baseScale,
            scaleY: baseScale,
            alpha: 1,
            duration: 400 * ts,
            ease: 'Quad.easeInOut',
            onComplete: land,
          }),
        });
        break;
      }
      case 'summonCircle': {
        vfx.summonCircle(home.x, footY - 12, primary, 1.8 + recipe.intensity);
        this.bossAura.setPosition(home.x, home.y).setScale(.2).setAlpha(0);
        this.stageBossAt(home.x, home.y, 0, 0);
        this.scene.tweens.add({ targets: this.bossAura, scale: 1, alpha: .14, delay: 240 * ts, duration: 380 * ts, ease: 'Sine.easeOut' });
        this.scene.tweens.add({
          targets: this.boss,
          scaleX: baseScale,
          scaleY: baseScale,
          alpha: 1,
          duration: 430 * ts,
          delay: 260 * ts,
          ease: 'Sine.easeOut',
          onComplete: land,
        });
        break;
      }
      case 'skyFall': {
        const topY = theme.layout.arena.y - this.boss.frame.height * baseScale * .6;
        vfx.skyFallTrail(home.x, footY, primary);
        this.stageBossAt(home.x, topY, baseScale, 1);
        this.bossAura.setPosition(home.x, home.y).setScale(.6).setAlpha(.08);
        this.scene.tweens.add({ targets: this.bossAura, x: home.x, y: home.y, scale: 1, alpha: .17, duration: 480 * ts, ease: 'Quad.easeOut' });
        this.scene.tweens.add({
          targets: this.boss,
          y: home.y,
          duration: 400 * ts,
          ease: 'Quad.easeIn',
          onComplete: () => {
            land();
            this.scene.tweens.add({ targets: this.boss, scaleY: baseScale * .84, duration: 70, ease: 'Quad.easeOut', onComplete: () => this.scene.tweens.add({ targets: this.boss, scaleY: baseScale, duration: 130, ease: 'Quad.easeOut' }) });
          },
        });
        break;
      }
      case 'eruption': {
        vfx.eruptionBurst(home.x, footY, primary, Math.round(3 + recipe.intensity * 1.5));
        this.stageBossAt(home.x, home.y + drop, baseScale * .4, 0);
        this.bossAura.setPosition(home.x, home.y).setScale(.45).setAlpha(.24);
        this.scene.tweens.add({ targets: this.bossAura, x: home.x, y: home.y, scale: 1, alpha: .17, duration: 480 * ts, ease: 'Cubic.easeOut' });
        this.scene.tweens.add({
          targets: this.boss,
          y: home.y,
          scaleX: baseScale,
          scaleY: baseScale,
          alpha: 1,
          duration: 500 * ts,
          delay: 60 * ts,
          ease: 'Back.easeOut',
          onComplete: () => { vfx.dust(home.x, footY); land(); },
        });
        break;
      }
    }
  }

  /** Places the boss sprite for an entrance without touching its tween state. */
  private stageBossAt(x: number, y: number, scale: number, alpha: number): void {
    this.boss.setPosition(x, y).setScale(scale, scale).setAngle(0).setAlpha(alpha).setVisible(true).setDepth(40);
  }

  private fireGroundImpact(vfx: VFXManager, recipe: BossSpawnVfxRecipe, x: number, y: number): void {
    const primary = recipe.palette[0]!;
    if (recipe.groundImpact === 'dust') vfx.dust(x, y);
    if (recipe.groundImpact === 'shockwave') vfx.shockwave(x, y, primary, 1.8 + recipe.intensity * .5);
    if (recipe.groundImpact === 'crack') {
      vfx.shockwave(x, y, primary, 2.2 + recipe.intensity * .4);
      vfx.sparks(x, y, recipe.palette[1] ?? primary, Math.round(3 + recipe.intensity * 2));
      vfx.smoke(x, y, 0x66707a);
    }
  }

  private fireMotif(vfx: VFXManager, recipe: BossSpawnVfxRecipe, x: number, y: number): void {
    const accentColor = recipe.palette[recipe.palette.length - 1] ?? recipe.palette[0]!;
    if (recipe.motif === 'bolt') vfx.lightning(x, y, accentColor);
    if (recipe.motif === 'flame' || recipe.motif === 'ember') vfx.eruptionBurst(x, y, accentColor, 3);
    if (recipe.motif === 'shadow') vfx.smoke(x, y, 0x2b2440);
    if (recipe.motif === 'petal' || recipe.motif === 'spark') vfx.sparks(x, y, accentColor, 5);
    // 'void' already reads through the rift/aura tints; no extra burst.
  }

  private fireEntranceShake(recipe: BossSpawnVfxRecipe): void {
    if (recipe.shake === 0 || this.entrancePresenter === null) return;
    this.entrancePresenter.shake(recipe.shake === 2 ? .012 : .005, recipe.shake === 2 ? 220 : 140);
  }

  private fireEntranceSound(recipe: BossSpawnVfxRecipe): void {
    if (this.entrancePresenter === null) return;
    const name: SfxName = recipe.soundVariant === 0 ? 'strongHit' : recipe.soundVariant === 1 ? 'newTier' : 'hit';
    this.entrancePresenter.sfx(name, this.core.boss.boss.stage);
  }

  /** Pre-recipe fallback so scenes without a wired VFX pool still get an entrance. */
  private enterLegacyPortal(): void {
    const portal = this.scenery.portalOrigin();
    const home = this.bossHome();
    const baseScale = this.bossScale();
    this.scenery.pulsePortal();
    this.boss
      .setPosition(portal.x, portal.y)
      .setScale(baseScale * .2)
      .setAlpha(0)
      .setAngle(0)
      .setVisible(true);
    this.bossAura.setPosition(portal.x, portal.y).setScale(.35).setAlpha(.46);
    this.scene.tweens.add({
      targets: this.boss,
      x: home.x,
      y: home.y,
      scaleX: baseScale,
      scaleY: baseScale,
      alpha: 1,
      duration: 580,
      ease: 'Back.easeOut',
      onComplete: () => this.startBossAuraPulse(),
    });
    this.scene.tweens.add({
      targets: this.bossAura,
      x: home.x,
      y: home.y,
      scale: 1,
      alpha: .16,
      duration: 580,
      ease: 'Cubic.easeOut',
    });
  }
}
