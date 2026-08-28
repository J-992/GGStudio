import Phaser from 'phaser';
import type { GameEvent } from '../core/EventBus';
import type { Sfx } from '../audio/Sfx';
import { ninjaDef, ninjaVfxStyle } from '../data/ninjas';
import { ninjaCatalogPortrait } from '../render/atlasConfig';
import {
  NINJA_BASIC_FOUR_FRAME,
  NINJA_SPECIAL_FOUR_FRAME,
  bossMotionForIdentity,
  type BossMotionRecipe,
  type FourFrameAnimation,
} from '../data/presentation';
import type { CombatStyle } from '../data/types';
import { Fx } from '../effects/Fx';
import { CoinFX } from '../effects/CoinFX';
import { VFXManager } from '../effects/VFXManager';
import { ArenaManager, type ArenaActor } from './ArenaManager';
import { compactNumber } from '../ui/theme';
import { CLASSIC_DOJO_STYLE, type DojoStyleDef } from '../data/dojoStyles';
import type { AttackTrailKind } from '../effects/TrailSystem';

/**
 * Rhythm-driven choreography. GameCore owns damage; this class gives every
 * supplied portrait a physical basic attack and a recurring signature special.
 */
export class CombatDirector {
  private clock = 0;
  private damageClock = 0;
  private ninjaActionCount = 0;
  private bossActionCount = 0;
  private forcedHigh = false;
  private lowBoss = false;
  /** Recipe for the boss currently on the platform; re-derived when it changes. */
  private bossMotion: BossMotionRecipe = bossMotionForIdentity(0);
  private bossMotionAppearance = -1;
  /** Guards the wall-clock flash restore so only the latest timer clears. */
  private flashToken = 0;
  private lastFlashAt = -Infinity;
  private tapCombo = 0;
  private lastTapAt = -Infinity;
  private lastTapSoundAt = -Infinity;
  /** A short visible history makes a rapid tap streak read as a rising combo. */
  private readonly tapComboLabels: Phaser.GameObjects.BitmapText[] = [];
  private tapComboLabelCursor = 0;
  /** Reusable over-boss blades make a Frenzy hit read as a physical impact. */
  private readonly embeddedFrenzyShurikens: Phaser.GameObjects.Image[] = [];
  private embeddedFrenzyCursor = 0;
  private style: DojoStyleDef = CLASSIC_DOJO_STYLE;

  constructor(private readonly scene: Phaser.Scene, private readonly arena: ArenaManager, private readonly vfx: VFXManager, private readonly fx: Fx, private readonly sfx: Sfx) {
    for (let index = 0; index < 14; index += 1) {
      this.tapComboLabels.push(
        // Above the boss (depth 40) and the arena HUD (depth 30), so a fast
        // streak never disappears behind the character art on a small phone.
        scene.add.bitmapText(-100, -100, 'pixel', '', 18).setOrigin(.5).setDepth(60).setVisible(false),
      );
    }
    for (let index = 0; index < 10; index += 1) {
      this.embeddedFrenzyShurikens.push(
        scene.add.image(-100, -100, 'powerup_shuriken_frenzy')
          .setDepth(46)
          .setVisible(false),
      );
    }
  }

  setForceHigh(value: boolean): void { this.forcedHigh = value; }
  setDojoStyle(style: DojoStyleDef): void { this.style = style; }

  update(dt: number): void {
    this.syncBossMotion();
    this.applyBossIdleLayer();
    this.clock += dt;
    if (this.clock < 780 || this.arena.actors.length === 0) return;
    this.clock = 0;
    const actor = this.arena.pick(Math.floor(this.scene.time.now / 780));
    if (actor === undefined) return;
    const special = (this.ninjaActionCount + actor.tier) % 3 === 0 || this.forcedHigh;
    this.ninjaActionCount += 1;
    this.sequence(actor, this.intensity(), special);
  }

  onEvent(event: GameEvent): void {
    if (event.type === 'bossDamaged') {
      this.lowBoss = event.hp / event.maxHp < .22;
      this.flashBossHit();
      if (event.source === 'tap') this.playerTapHit();
      if (event.source === 'merge') this.mergeStrikeHit();
      this.damageClock += 100;
      if (this.damageClock >= 340) {
        this.damageClock = 0;
        this.reactBoss(this.lowBoss ? 2 : 1);
      }
    }
    if (event.type === 'shurikenFrenzyVolley') this.launchFrenzyVolley(event.stage, event.shurikens);
    if (event.type === 'bossAttack') this.bossAttack(event.damage, this.arena.pick(Math.floor(this.scene.time.now / 190)));
    if (event.type === 'ninjaMerged') this.mergePayoff(event.result.tier);
    if (event.type === 'bossDefeated') this.defeat(event.reward);
    if (event.type === 'bossSpawned') {
      // Entrance VFX are recipe-driven per identity inside ArenaManager now;
      // anything fired here would double up or contradict a skyFall/eruption.
      this.bossActionCount = 0;
      this.clearEmbeddedFrenzyShurikens();
      this.arena.refreshBoss(true);
    }
    if (event.type === 'ninjaSpawned') {
      this.arena.sync();
      this.popArrival(event.ninja.tier);
    } else if (event.type === 'ninjaSold' || event.type === 'ninjaMerged' || event.type === 'stateLoaded') {
      this.arena.sync();
    }
  }

  /** The board's core verb lands in the arena immediately, not one DPS tick later. */
  private mergeStrikeHit(): void {
    const boss = this.arena.boss;
    if (!boss.visible) return;
    const color = this.style.palette.vfx;
    this.vfx.shockwave(boss.x, boss.y, color, 2.5);
    this.vfx.sparks(boss.x, boss.y - 20, color, 10);
    this.fx.gain(boss.x, boss.y - boss.displayHeight * 0.3, 'MERGE STRIKE!');
    this.fx.shake(0.006, 100);
    this.sfx.play('strongHit');
  }

  /**
   * Frenzy is a real volley, not a token spinner: each blade leaves the ninja
   * line, targets the boss body, then makes contact before feedback plays.
   * The stage guard prevents a projectile fired at a dying boss from hitting
   * the next one during its entrance.
   */
  private launchFrenzyVolley(stage: number, shurikens: number): void {
    const boss = this.arena.boss;
    if (!boss.visible || this.arena.bossDef().stage !== stage) return;
    const shooter = this.arena.highest();
    const count = Math.max(1, Math.floor(shurikens));
    for (let index = 0; index < count; index += 1) {
      this.scene.time.delayedCall(index * 86, () => {
        if (!boss.active || !boss.visible || this.arena.bossDef().stage !== stage) return;
        const lane = index - (count - 1) / 2;
        const source = new Phaser.Math.Vector2(
          shooter?.sprite.x ?? boss.x - boss.displayWidth * .86,
          (shooter?.sprite.y ?? boss.y + boss.displayHeight * .12) + lane * 11,
        );
        const target = new Phaser.Math.Vector2(
          boss.x + Phaser.Math.FloatBetween(-.24, .14) * boss.displayWidth,
          boss.y + Phaser.Math.FloatBetween(-.22, .2) * boss.displayHeight,
        );
        this.vfx.projectile('shuriken', source, target, 0xff6b57, () => {
          if (!boss.active || !boss.visible || this.arena.bossDef().stage !== stage) return;
          this.frenzyImpact(target.x, target.y);
        });
      });
    }
  }

  /** Arrival feedback belongs at the end of the projectile tween, never launch. */
  private frenzyImpact(x: number, y: number): void {
    const boss = this.arena.boss;
    this.vfx.impact(x, y, 0xffd4c7);
    this.vfx.sparks(x, y, 0xff6b57, 5);
    this.embedFrenzyShuriken(x, y);
    this.flashBossHit();
    // Attacks, entrances and defeat poses own the boss body; otherwise a
    // clean sharp recoil confirms that the blades landed.
    if (!this.scene.tweens.isTweening(boss)) this.reactBoss(1);
  }

  /** Code-native hit frames: an embedded blade stays on the body briefly. */
  private embedFrenzyShuriken(x: number, y: number): void {
    const blade = this.embeddedFrenzyShurikens[this.embeddedFrenzyCursor]!;
    this.embeddedFrenzyCursor = (this.embeddedFrenzyCursor + 1) % this.embeddedFrenzyShurikens.length;
    this.scene.tweens.killTweensOf(blade);
    blade
      .setPosition(x, y)
      .setTint(0xffe1d7)
      .setScale(0.36)
      .setAngle(Phaser.Math.Between(-40, 40))
      .setAlpha(1)
      .setVisible(true);
    this.scene.tweens.add({
      targets: blade,
      alpha: 0,
      duration: 720,
      ease: 'Quad.easeIn',
      onComplete: () => blade.setVisible(false),
    });
  }

  private clearEmbeddedFrenzyShurikens(): void {
    for (const blade of this.embeddedFrenzyShurikens) {
      this.scene.tweens.killTweensOf(blade);
      blade.setVisible(false);
    }
  }

  private intensity(): number { return this.forcedHigh || this.lowBoss ? 3 : Math.random() < .18 ? 2 : 1; }

  /**
   * Small arena-side arrival pop for a freshly bought or merged-in recruit.
   * Pure presentation after the sync: a quick back-eased scale punch plus a
   * dust ring, so the line visibly grows even when the board is off-glance.
   */
  private popArrival(tier: number): void {
    const actor = this.arena.actors.find((candidate) => candidate.tier === tier);
    if (actor === undefined) return;
    const sprite = actor.sprite;
    const target = sprite.scaleX;
    sprite.setScale(target * .4);
    this.scene.tweens.add({ targets: sprite, scaleX: target, scaleY: target, duration: 260, ease: 'Back.easeOut' });
    this.vfx.dust(sprite.x, sprite.y + sprite.displayHeight * .38);
  }

  private syncBossMotion(): void {
    const appearance = this.arena.bossDef().appearanceIndex;
    if (appearance !== this.bossMotionAppearance) {
      this.bossMotionAppearance = appearance;
      this.bossMotion = bossMotionForIdentity(appearance - 1);
    }
  }

  /**
   * Continuous recipe-driven idle for the boss. This is an additive nudge over
   * whatever the arena's own idle pass staged this tick (GameScene steps the
   * arena first), so authored four-frame poses stay the primary layer and the
   * recipe only breathes on top -- at under half strength for strip bosses.
   * Everything reuses sin/cos of the scene clock: no allocations per frame,
   * and the ranges are small enough that the sprite stays inside the mask.
   */
  private applyBossIdleLayer(): void {
    const boss = this.arena.boss;
    // While any tween owns the body (entrance, strike, recoil, defeat) the
    // choreography in charge wins; both managers check the same condition so
    // neither fights a running tween.
    if (!boss.visible || this.scene.tweens.isTweening(boss)) return;
    const recipe = this.bossMotion;
    const def = this.arena.bossDef();
    // Authored creature frames already carry the large body motion; keep this
    // ambient recipe subtle so it reads as breathing, not double animation.
    const weight = def.animation === 'eightFrame' ? .25 : .4;
    const phase = ((this.scene.time.now + def.appearanceIndex * 173) / recipe.idlePeriodMs) * Math.PI * 2;
    const bob = Math.sin(phase) * recipe.breatheAmount * boss.displayHeight * weight;
    const lean = Math.sin(phase * .61 + 1.4) * recipe.swayDegrees * weight;
    const pump = Math.sin(phase * 1.33) * recipe.breatheAmount * weight;
    boss.setY(boss.y + bob);
    boss.setAngle(boss.angle + lean);
    boss.setScale(boss.scaleX * (1 + pump * .5), boss.scaleY * (1 - pump * .5));
  }

  /**
   * Hit feedback on landed hits, deliberately restrained: damage events fire
   * every fixed tick while the line fights, and an unthrottled fill held the
   * boss solid white for entire fights (reported by playtesting). One SHORT
   * blink per long beat -- under ~10% duty -- plus the spark bursts the
   * attackers already throw. Restore runs on wall-clock time because hit-stop
   * slows the scene clock (see DECISIONS.md).
   */
  private flashBossHit(): void {
    const now = window.performance.now();
    if (now - this.lastFlashAt < 420) return;
    this.lastFlashAt = now;
    const boss = this.arena.boss;
    if (!boss.visible || this.scene.tweens.isTweening(boss)) return;
    const token = this.flashToken + 1;
    this.flashToken = token;
    boss.setTintFill(0xffffff);
    window.setTimeout(() => {
      if (token !== this.flashToken || !boss.active) return;
      boss.clearTint();
    }, 50);
  }

  /**
   * Every player tap gets a tangible cut/impact. A quick string builds an
   * uncapped combo and punctuates every fifth strike with a larger shockwave.
   * The label trail makes the growing streak visible without filling the
   * arena with damage arithmetic.
   */
  private playerTapHit(): void {
    const boss = this.arena.boss;
    if (!boss.visible) return;
    const now = this.scene.time.now;
    this.tapCombo = now - this.lastTapAt <= 460 ? this.tapCombo + 1 : 1;
    this.lastTapAt = now;
    const finisher = this.tapCombo % 5 === 0;
    const x = boss.x + Phaser.Math.Between(-Math.round(boss.displayWidth * .18), Math.round(boss.displayWidth * .18));
    const y = boss.y + Phaser.Math.Between(-Math.round(boss.displayHeight * .18), Math.round(boss.displayHeight * .18));
    const rainbow = this.style.id === 'crimson-dojo'
      ? (this.tapCombo % 2 === 0 ? this.style.palette.accentBright : this.style.palette.vfx)
      : Phaser.Display.Color.HSVToRGB((this.tapCombo * .065) % 1, .82, 1).color;
    this.vfx.slash(x, y, rainbow, finisher ? 1.45 : 1, Phaser.Math.Between(-36, 36), finisher ? 2.2 : 1.15);
    this.vfx.impact(x, y, rainbow);
    this.vfx.sparks(x, y, rainbow, finisher ? 8 : 3);
    this.showTapCombo(x, y, rainbow, finisher);
    this.hapticTap(finisher);
    if (finisher) {
      this.vfx.shockwave(x, y, rainbow, 2.4);
      this.fx.shake(.004, 80);
    }
    if (now - this.lastTapSoundAt >= 70) {
      this.lastTapSoundAt = now;
      this.sfx.play(finisher ? 'strongHit' : 'hit');
    }
    // Entrance/attack/defeat choreography owns the boss body. Between those
    // beats, add a fast recoil without cancelling the authored animation.
    if (this.scene.tweens.isTweening(boss)) return;
    const scaleX = boss.scaleX;
    const scaleY = boss.scaleY;
    this.scene.tweens.add({
      targets: boss,
      scaleX: scaleX * (finisher ? 1.09 : 1.045),
      scaleY: scaleY * (finisher ? .91 : .955),
      angle: finisher ? Phaser.Math.Between(-4, 4) : 0,
      duration: finisher ? 90 : 55,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /** Shows this click in front while making prior streak counts recede. */
  private showTapCombo(x: number, y: number, color: number, finisher: boolean): void {
    for (const prior of this.tapComboLabels) {
      if (!prior.visible) continue;
      this.scene.tweens.killTweensOf(prior);
      this.scene.tweens.add({
        targets: prior,
        alpha: Math.min(prior.alpha, .32),
        scaleX: prior.scaleX * .92,
        scaleY: prior.scaleY * .92,
        angle: prior.angle + (prior.x < x ? -7 : 7),
        duration: 120,
        ease: 'Sine.easeOut',
        onComplete: () => this.scene.tweens.add({
          targets: prior,
          y: prior.y - 24,
          alpha: 0,
          duration: 620,
          ease: 'Quad.easeOut',
          onComplete: () => prior.setVisible(false),
        }),
      });
    }
    const label = this.tapComboLabels.find((candidate) => !candidate.visible)
      ?? this.tapComboLabels[this.tapComboLabelCursor % this.tapComboLabels.length]!;
    this.tapComboLabelCursor += 1;
    this.scene.tweens.killTweensOf(label);
    const angle = Phaser.Math.Between(-12, 12);
    const scale = finisher ? 2.55 : 2.05;
    label
      .setText(`STREAK x${this.tapCombo}${finisher ? '!' : ''}`)
      .setPosition(x, y - (finisher ? 18 : 6))
      .setTint(color)
      .setAngle(angle)
      .setScale(scale)
      .setAlpha(1)
      .setVisible(true);
    this.scene.tweens.add({
      targets: label,
      y: label.y - (finisher ? 72 : 52),
      angle: angle + (angle < 0 ? -20 : 20),
      scaleX: scale * (finisher ? 1.12 : .88),
      scaleY: scale * (finisher ? 1.12 : .88),
      alpha: 0,
      duration: finisher ? 1_400 : 1_100,
      ease: 'Quad.easeOut',
      onComplete: () => label.setVisible(false),
    });
  }

  /**
   * Android and some in-app mobile browsers expose the Vibration API. It is
   * deliberately optional: iOS Safari simply ignores it, so this never
   * blocks a click or asks for a permission prompt where haptics are absent.
   */
  private hapticTap(finisher: boolean): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(finisher ? [12, 18, 26] : 8);
  }

  private sequence(actor: ArenaActor, intensity: number, special: boolean): void {
    const def = ninjaDef(actor.tier);
    const sprite = actor.sprite;
    actor.state = 'moving';
    const targetX = this.arena.boss.x - Math.min(120, this.arena.boss.displayWidth * .42);
    const beat = Math.floor(this.scene.time.now / 780 + actor.tier) % 4;
    const approachY = this.arena.boss.y - (beat === 1 ? 94 : 18);
    if (beat === 2 || special) this.vfx.teleportFlash(sprite.x, sprite.y, def.vfx.color);
    this.scene.tweens.add({
      targets: sprite,
      x: targetX,
      y: approachY,
      duration: beat === 2 ? 90 : special ? 145 : 180,
      ease: beat === 1 ? 'Quad.easeOut' : 'Quad.easeIn',
      onStart: () => this.vfx.afterimage(sprite),
      onComplete: () => this.performNinjaAttack(actor, intensity, special),
    });
    if (intensity === 3) {
      const ally = this.arena.actors.find((candidate) => candidate !== actor);
      if (ally !== undefined) this.scene.tweens.add({ targets: ally.sprite, alpha: .55, duration: 1, delay: 80, onComplete: () => this.sequence(ally, 2, true) });
    }
  }

  /**
   * Each ninja runs its authored source frames: guard, weapon lift, impact,
   * and recovery. The impact is deliberately attached to frame three so VFX
   * land with the weapon instead of a container wobble.
   */
  private performNinjaAttack(actor: ArenaActor, intensity: number, special: boolean): void {
    const sprite = actor.sprite;
    actor.state = 'attacking';
    const origin = new Phaser.Math.Vector2(sprite.x, sprite.y);
    this.runNinjaFourFrame(
      actor,
      special ? NINJA_SPECIAL_FOUR_FRAME : NINJA_BASIC_FOUR_FRAME,
      origin,
      () => {
        this.attackBeat(actor, intensity, special);
        this.reactBoss(special ? Math.max(2, intensity) : intensity);
      },
      () => {
        actor.state = 'recovering';
        this.scene.tweens.add({
          targets: sprite,
          x: actor.home.x,
          y: actor.home.y,
          angle: 0,
          scaleX: actor.scale,
          scaleY: actor.scale,
          duration: special ? 310 : 250,
          ease: 'Quad.easeInOut',
          onComplete: () => this.arena.reset(actor),
        });
      },
    );
  }

  private runNinjaFourFrame(
    actor: ArenaActor,
    animation: FourFrameAnimation,
    origin: Phaser.Math.Vector2,
    onImpact: () => void,
    onComplete: () => void,
  ): void {
    const usesStripFrames = ninjaCatalogPortrait(actor.tier)?.animation !== undefined;
    let index = 0;
    const next = (): void => {
      const pose = animation[index]!;
      if (usesStripFrames) actor.sprite.setFrame(index);
      this.scene.tweens.add({
        targets: actor.sprite,
        // A real strip already has its weapon/attachment motion baked in.
        // Keep its body planted at the chosen attack point; retain transform
        // choreography only as a safe fallback for a future still portrait.
        x: origin.x + (usesStripFrames ? 0 : pose.x),
        y: origin.y + (usesStripFrames ? 0 : pose.y),
        angle: usesStripFrames ? 0 : pose.angle,
        scaleX: actor.scale * (usesStripFrames ? 1 : pose.scaleX),
        scaleY: actor.scale * (usesStripFrames ? 1 : pose.scaleY),
        duration: pose.duration,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          if (index === 2) onImpact();
          index += 1;
          if (index < animation.length) next();
          else onComplete();
        },
      });
    };
    next();
  }

  private attackBeat(actor: ArenaActor, intensity: number, special: boolean): void {
    const def = ninjaDef(actor.tier);
    const boss = this.arena.boss;
    const hitX = boss.x - 22;
    const hitY = boss.y - 35;
    const color = this.style.id === 'crimson-dojo'
      ? (special ? this.style.palette.accentBright : this.style.palette.vfx)
      : def.vfx.color;
    const trailFrom = new Phaser.Math.Vector2(
      actor.sprite.x - actor.sprite.displayWidth * 0.32,
      actor.sprite.y - actor.sprite.displayHeight * 0.12,
    );
    this.vfx.attackTrail(trailFrom, new Phaser.Math.Vector2(hitX, hitY), color, this.trailKind(actor.tier), special || intensity >= 2);
    if (special) this.ninjaSpecial(def.combat.style, hitX, hitY, color, intensity);
    else this.ninjaBasic(def.combat.style, actor, hitX, hitY, color, intensity);
    this.vfx.sparks(hitX + 7, hitY, color, special ? 7 + intensity : 2 + intensity);
    if (special || intensity >= 2) {
      this.fx.hitStop(special ? 55 : 34);
    }
  }

  private trailKind(tier: number): AttackTrailKind {
    switch (ninjaVfxStyle(tier)) {
      case 'tide':
      case 'frost':
        return 'water';
      case 'scarlet':
      case 'sun':
      case 'dawn':
        return 'fire';
      case 'storm':
        return 'lightning';
      case 'umbral':
      case 'eclipse':
      case 'astral':
      case 'rune':
        return 'shadow';
      default:
        return 'blade';
    }
  }

  private ninjaBasic(style: CombatStyle, actor: ArenaActor, hitX: number, hitY: number, color: number, intensity: number): void {
    switch (style) {
      case 'projectile':
        this.vfx.projectile('shuriken', new Phaser.Math.Vector2(actor.sprite.x, actor.sprite.y), new Phaser.Math.Vector2(hitX, hitY), color);
        this.vfx.slash(hitX, hitY, color, intensity, 20, 1);
        break;
      case 'arcane':
        this.vfx.energyRing(hitX, hitY, color);
        this.vfx.slash(hitX, hitY, color, intensity, -42, 1);
        break;
      case 'storm':
        this.vfx.lightning(hitX, hitY - 25, color);
        this.vfx.slash(hitX, hitY, color, intensity, 35, 1);
        break;
      case 'void':
        this.vfx.teleportFlash(hitX, hitY, color);
        this.vfx.slash(hitX, hitY, color, intensity, 62, 1);
        break;
      case 'brute':
        this.vfx.shockwave(hitX, hitY, color, 1.35);
        this.vfx.dust(hitX, hitY + 26);
        break;
      default:
        this.vfx.slash(hitX, hitY, color, intensity, -25, 1);
    }
  }

  private ninjaSpecial(style: CombatStyle, hitX: number, hitY: number, color: number, intensity: number): void {
    switch (style) {
      case 'projectile':
        for (let i = -1; i <= 1; i += 1) {
          this.vfx.projectile('shuriken', new Phaser.Math.Vector2(hitX - 130, hitY + i * 24), new Phaser.Math.Vector2(hitX, hitY), color);
        }
        this.vfx.shockwave(hitX, hitY, color, 2);
        break;
      case 'arcane':
        this.vfx.portal(hitX, hitY, color);
        this.vfx.lightning(hitX, hitY - 44, color);
        this.vfx.shockwave(hitX, hitY, color, 2.6);
        break;
      case 'storm':
        this.vfx.lightning(hitX - 22, hitY - 48, color);
        this.vfx.lightning(hitX + 22, hitY - 12, color);
        this.vfx.shockwave(hitX, hitY, color, 2.4);
        break;
      case 'void':
        this.vfx.teleportFlash(hitX, hitY, color);
        this.vfx.portal(hitX, hitY, color);
        this.vfx.slash(hitX, hitY, color, intensity + 2, -64, 2);
        break;
      case 'brute':
        this.vfx.shockwave(hitX, hitY, color, 3);
        this.vfx.dust(hitX - 16, hitY + 28);
        this.vfx.dust(hitX + 18, hitY + 28);
        break;
      default:
        this.vfx.slash(hitX - 10, hitY + 5, color, intensity + 2, -60, 2);
        this.vfx.slash(hitX + 14, hitY - 10, color, intensity + 1, 44, 2);
        this.vfx.shockwave(hitX, hitY, color, 2);
    }
  }

  private reactBoss(intensity: number): void {
    const boss = this.arena.boss;
    const home = this.arena.bossHome();
    this.scene.tweens.add({ targets: boss, x: home.x + intensity * 8, yoyo: true, duration: 72, repeat: intensity - 1, onComplete: () => boss.setPosition(home.x, home.y) });
    this.vfx.impact(boss.x - Math.min(28, boss.displayWidth * .12), boss.y - 30);
    if (intensity >= 2) this.vfx.dust(boss.x, boss.y + Math.min(58, boss.displayHeight * .24));
  }

  private bossAttack(damage: number, actor: ArenaActor | undefined): void {
    const boss = this.arena.boss;
    const bossDef = this.arena.bossDef();
    const color = this.arena.bossAccent();
    const special = damage > 0 && (this.bossActionCount + bossDef.appearanceIndex) % 3 === 0;
    this.bossActionCount += 1;
    if (actor === undefined) {
      this.arena.bossStrike(special, () => this.vfx.shockwave(boss.x - boss.displayWidth * .22, boss.y, color, special ? 2.2 : 1));
      return;
    }
    const target = new Phaser.Math.Vector2(actor.sprite.x, actor.sprite.y - 28);
    const origin = new Phaser.Math.Vector2(boss.x - boss.displayWidth * .23, boss.y - 12);
    this.arena.bossStrike(special, () => {
      if (special) this.bossSpecial(bossDef.combat.style, origin, target, color);
      else this.bossBasic(bossDef.combat.style, origin, target, color);
      if (damage > 0) this.vfx.sparks(target.x, target.y, color, special ? 9 : 5);
      this.defend(actor, special);
    });
  }

  private bossBasic(style: CombatStyle, origin: Phaser.Math.Vector2, target: Phaser.Math.Vector2, color: number): void {
    if (style === 'brute') {
      this.vfx.shockwave(target.x, target.y, color, 1.5);
      this.vfx.dust(target.x, target.y + 24);
      return;
    }
    if (style === 'arcane' || style === 'void') this.vfx.portal(target.x, target.y, color);
    if (style === 'storm') this.vfx.lightning(target.x, target.y - 28, color);
    this.vfx.projectile('shuriken', origin, target, color);
    this.vfx.slash(target.x, target.y, color, 1, 150, 1);
  }

  private bossSpecial(style: CombatStyle, origin: Phaser.Math.Vector2, target: Phaser.Math.Vector2, color: number): void {
    switch (style) {
      case 'brute':
        this.vfx.shockwave(target.x, target.y, color, 3);
        this.vfx.dust(target.x - 20, target.y + 26);
        this.vfx.dust(target.x + 20, target.y + 26);
        break;
      case 'arcane':
        this.vfx.portal(target.x, target.y, color);
        this.vfx.lightning(target.x, target.y - 45, color);
        this.vfx.shockwave(target.x, target.y, color, 2.5);
        break;
      case 'storm':
        this.vfx.lightning(target.x - 24, target.y - 46, color);
        this.vfx.lightning(target.x + 20, target.y - 10, color);
        this.vfx.shockwave(target.x, target.y, color, 2.4);
        break;
      case 'void':
        this.vfx.portal(origin.x, origin.y, color);
        this.vfx.teleportFlash(target.x, target.y, color);
        this.vfx.slash(target.x, target.y, color, 3, 150, 2);
        break;
      default:
        this.vfx.projectile('shuriken', origin, target, color);
        this.vfx.projectile('shuriken', new Phaser.Math.Vector2(origin.x, origin.y - 28), target, color);
        this.vfx.shockwave(target.x, target.y, color, 2);
    }
  }

  private defend(actor: ArenaActor | undefined, special: boolean): void {
    if (actor === undefined) return;
    actor.state = 'reacting';
    const sprite = actor.sprite;
    this.vfx.teleportFlash(sprite.x, sprite.y);
    this.scene.tweens.add({ targets: sprite, x: sprite.x - (special ? 72 : 54), y: sprite.y - (special ? 12 : 0), alpha: .25, duration: special ? 150 : 110, yoyo: true, onComplete: () => this.arena.reset(actor) });
  }

  private mergePayoff(tier: number): void {
    const actor = this.arena.highest();
    if (actor === undefined) return;
    const def = ninjaDef(tier);
    actor.sprite.setDepth(17).setScale(actor.scale * 1.5);
    this.vfx.teleportFlash(actor.sprite.x, actor.sprite.y, def.vfx.color);
    this.scene.tweens.add({ targets: actor.sprite, scale: actor.scale, duration: 220, onComplete: () => actor.sprite.setDepth(12) });
    this.sequence(actor, 3, true);
  }

  /**
   * The kill is a payday: the boss bursts, then the reward physically travels
   * home. The coins converge on the wallet through CoinFX, which owns the
   * arrival chime and flash, and the amount reads out once at the death spot.
   */
  private defeat(reward: number): void {
    const boss = this.arena.boss;
    this.vfx.shockwave(boss.x, boss.y, 0xffe7a3, 4);
    this.vfx.sparks(boss.x, boss.y - 30, 0xffe7a3, 12);
    boss.setTint(0xffffff);
    this.scene.tweens.add({ targets: boss, alpha: 0, y: boss.y - 40, duration: 330, onComplete: () => boss.clearTint() });
    // The staged burst-scatter-magnetize sequence lives in CoinFX; `Fx.coins`
    // only exposes the plain flight, and the reward magnitude picks the volley.
    const coinFx = CoinFX.of(this.scene);
    if (coinFx === undefined) this.fx.coins(boss.x, boss.y, 14);
    else coinFx.payday(boss.x, boss.y, reward);
    this.fx.gain(boss.x, boss.y - 46, `+${compactNumber(Math.max(1, Math.round(reward)))}`);
    this.sfx.play('bossDefeat');
  }
}
