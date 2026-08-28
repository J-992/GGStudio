import Phaser from 'phaser';
import { GameCore } from '../core/GameCore';
import { ArenaManager } from '../arena/ArenaManager';
import { CombatDirector } from '../arena/CombatDirector';
import { VFXManager } from '../effects/VFXManager';
import { PowerupAuras } from '../effects/PowerupAuras';
import { AscensionButton } from '../ui/AscensionButton';
import { BossHud } from '../ui/BossHud';
import { PlayerHud } from '../ui/PlayerHud';
import { BuyButton } from '../ui/BuyButton';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { PanelChrome } from '../ui/PanelChrome';
import { DebugPanel } from '../ui/DebugPanel';
import { MergeBoard } from '../ui/MergeBoard';
import { TrashSlot } from '../ui/TrashSlot';
import { compactNumber, theme } from '../ui/theme';
import { ATLAS_KEY } from '../render/atlasConfig';
import { ACHIEVEMENTS_ICON_KEY } from '../render/revealAssets';
import { Fx } from '../effects/Fx';
import { Sfx } from '../audio/Sfx';
import { musicTrackForStage } from '../audio/Music';
import { NinjaReveal } from '../ui/NinjaReveal';
import { Almanac } from '../ui/Almanac';
import { AchievementToast } from '../ui/AchievementToast';
import { AchievementsPanel } from '../ui/AchievementsPanel';
import { SettingsPanel } from '../ui/SettingsPanel';
import { TimeClock } from '../ui/TimeClock';
import { HealthPotion } from '../ui/HealthPotion';
import { PowerupPickups } from '../ui/PowerupPickups';
import { LowHealthWarning } from '../ui/LowHealthWarning';
import { GameOverPanel } from '../ui/GameOverPanel';
import { StageBanner } from '../ui/StageBanner';
import { RivalLadder } from '../ui/RivalLadder';
import { FirstRunTutorial } from '../ui/FirstRunTutorial';
import { ContextualPowerupCoach } from '../ui/ContextualPowerupCoach';
import { ArchetypePresenter } from '../arena/ArchetypePresenter';
import { ARCHETYPES } from '../data/bossArchetypes';
import { ARCHETYPE_LESSON } from '../data/flavorText';
import { BoardCoach } from '../ui/BoardCoach';
import { DraftCards } from '../ui/DraftCards';
import { StickerEarned } from '../ui/StickerEarned';
import { BALANCE } from '../data/balance';
import { BOSS_COUNT } from '../data/enemies';
import { previewSeedPlan } from '../data/devPreview';
import { themeForStage } from '../data/arenaThemes';
import { isShowcaseNinjaTier } from '../data/presentation';
import { isRivalMilestoneStage } from '../data/rivals';
import type { PowerupId } from '../data/powerups';
import { collectionProgress } from '../systems/CollectionProgress';
import { attachAdHold } from '../platform/adHold';
import {
  reportPlatformHappyTime,
  reportPlatformMeasure,
  requestPlatformCommercialBreak,
  requestPlatformRewardedBreak,
  setPlatformGameplayActive,
} from '../platform/platform';
import { shouldOfferCommercialBreak } from '../platform/adPolicy';
import { RetentionFunnel } from '../platform/retentionFunnel';
import type { DojoStyleDef } from '../data/dojoStyles';

export class GameScene extends Phaser.Scene {
  /**
   * Built in `init` rather than as a field: restarting the scene from the
   * settings panel has to hand every widget a core reloaded from the wiped
   * save, and a field initialiser only ever runs once per scene instance.
   */
  core!: GameCore;

  private board!: MergeBoard;
  private buy!: BuyButton;
  private trash!: TrashSlot;
  private currency!: CurrencyDisplay;
  private debug!: DebugPanel;
  private arena!: ArenaManager;
  private director!: CombatDirector;
  private hud!: BossHud;
  private playerHud!: PlayerHud;
  private reveal!: NinjaReveal;
  private almanac!: Almanac;
  private achievementsPanel!: AchievementsPanel;
  private achievementToast!: AchievementToast;
  private settings!: SettingsPanel;
  private timeClock!: TimeClock;
  private potion!: HealthPotion;
  private powerups!: PowerupPickups;
  private lowHealth!: LowHealthWarning;
  private tutorial!: FirstRunTutorial;
  private powerupCoach!: ContextualPowerupCoach;
  private stickerEarned!: StickerEarned;
  private draftCards!: DraftCards;
  private archetypes!: ArchetypePresenter;
  private boardCoach!: BoardCoach;
  private gameOver!: GameOverPanel;
  private stageBanner!: StageBanner;
  private rivals!: RivalLadder;
  private ascension!: AscensionButton;
  private almanacButton!: Phaser.GameObjects.Image;
  private almanacPlate!: Phaser.GameObjects.NineSlice;
  private almanacBadge!: Phaser.GameObjects.BitmapText;
  private settingsButton!: Phaser.GameObjects.Image;
  private settingsPlate!: Phaser.GameObjects.NineSlice;
  private achievementsButton!: Phaser.GameObjects.Image;
  private achievementsPlate!: Phaser.GameObjects.NineSlice;
  private achievementsBadge!: Phaser.GameObjects.BitmapText;
  private background!: Phaser.GameObjects.Image;
  private arenaVfx!: VFXManager;
  private powerAuras!: PowerupAuras;
  private arenaFrame!: PanelChrome;
  private readonly gears: Array<{ image: Phaser.GameObjects.Image; speed: number }> = [];
  private boughtOnce = false;
  /** True when this create came from Settings' Restart, not from a boot. */
  private restarted = false;
  /** Last gameplay state handed to the portal; see syncGameplayReport. */
  private gameplayReported = false;
  /** Poki counts gameplay only after the player has deliberately entered it. */
  private playerStartedGameplay = false;
  /** True from the moment a restart is asked for until the scene is rebuilt. */
  private restarting = false;
  private retention!: RetentionFunnel;
  private detachAdHold: (() => void) | null = null;
  private fx!: Fx;
  private readonly sfx = new Sfx();

  constructor() {
    super('GameScene');
  }

  init(data?: { restarted?: boolean }): void {
    this.core = new GameCore({});
    // Sfx survives scene restarts, so select the saved run's act before the
    // next player gesture starts (or continues) the procedural soundtrack.
    this.sfx.setMusicTrack(musicTrackForStage(this.core.boss.stage));
    this.boughtOnce = false;
    this.playerStartedGameplay = false;
    this.restarted = data?.restarted === true;
  }

  create(): void {
    // Nothing may move or make a sound behind an ad. The hold is taken and
    // released by the portal itself, and torn down with the scene so a restart
    // does not stack a second listener on the same audio bus.
    this.detachAdHold = attachAdHold(this, this.sfx);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.detachAdHold?.();
      this.detachAdHold = null;
      this.gameplayReported = false;
      setPlatformGameplayActive(false);
    });

    this.background = this.add.image(theme.layout.width / 2, theme.layout.height / 2, 'dojo_night_backdrop').setDepth(-2);
    this.layoutScreenBackground();
    this.makeBackdrop();

    this.fx = new Fx(this, this.sfx);
    this.arena = new ArenaManager(this, this.core);
    this.arenaVfx = new VFXManager(this);
    this.powerAuras = new PowerupAuras(this, this.core);
    this.director = new CombatDirector(this, this.arena, this.arenaVfx, this.fx, this.sfx);
    // Boss entrances are data-driven per identity; without a presenter they
    // fall back to the legacy portal fly-in.
    this.arena.attachBossEntrancePresenter({
      vfx: this.arenaVfx,
      shake: (intensity, durationMs) => this.fx.shake(intensity, durationMs),
      sfx: (name, tier) => this.sfx.play(name, tier),
    });
    this.hud = new BossHud(this, this.core);
    this.playerHud = new PlayerHud(this, this.core);
    this.rivals = new RivalLadder(this, this.core);
    this.makeArenaChrome();
    this.core.events.onAny((event) => this.director.onEvent(event));

    this.trash = new TrashSlot(this);
    this.board = new MergeBoard(this, this.core, this.trash, this.fx, this.sfx);
    this.currency = new CurrencyDisplay(this);
    this.fx.setCoinTarget(() => new Phaser.Math.Vector2(this.currency.x, this.currency.y));
    this.buy = new BuyButton(this, () => this.onBuy(), this.fx, this.sfx);
    this.debug = new DebugPanel(this, this.core, (value) => this.director.setForceHigh(value));
    this.reveal = new NinjaReveal(this, this.core, this.sfx);
    this.almanac = new Almanac(this, this.core, this.sfx);
    this.achievementsPanel = new AchievementsPanel(this, this.core, this.sfx);
    this.achievementToast = new AchievementToast(this);
    this.timeClock = new TimeClock(this, this.core, this.fx, this.sfx, () => this.modalOpen);
    this.potion = new HealthPotion(this, this.core, this.fx, this.sfx, () => this.modalOpen);
    this.powerups = new PowerupPickups(this, this.core, this.fx, this.sfx, () => this.modalOpen);
    this.retention = new RetentionFunnel((event) => {
      void reportPlatformMeasure(event.category, event.what, event.action);
    });
    if (!this.core.tutorialCompleted) {
      this.retention.startTutorial(this.core.metrics.purchases, this.core.metrics.merges);
    }
    if (this.core.crimsonDojoProgress.have > 0 && !this.core.crimsonDojoProgress.complete) {
      this.retention.startStickerPage();
    }
    this.core.events.onAny((event) => this.retention.handle(event, this.core.metrics.purchases));
    this.tutorial = new FirstRunTutorial(this, this.core, {
      buy: () => new Phaser.Math.Vector2(theme.layout.buy.x, theme.layout.buy.y),
      ninja: (slot) => {
        const pos = this.board.slotPos(slot);
        return new Phaser.Math.Vector2(pos.x, pos.y - 66 * theme.layout.slots.spriteScale);
      },
      boss: () => new Phaser.Math.Vector2(this.arena.boss.x, this.arena.boss.y),
    });
    this.powerupCoach = new ContextualPowerupCoach(
      this,
      this.core,
      (id) => {
        const pos = this.powerups.posOf(id);
        return pos === null ? null : new Phaser.Math.Vector2(pos.x, pos.y);
      },
      () => this.retention.startPowerupLesson(),
    );
    this.lowHealth = new LowHealthWarning(this);
    this.stageBanner = new StageBanner(this);
    this.stickerEarned = new StickerEarned(this, this.core, this.sfx, () => this.pulseAlmanacButton());
    this.draftCards = new DraftCards(this, this.core, this.fx, this.arenaVfx, this.sfx);
    this.archetypes = new ArchetypePresenter(this, this.core, this.arena, this.arenaVfx, this.fx);
    this.boardCoach = new BoardCoach(this, this.core, (slot) => this.board.slotPos(slot));
    this.settings = new SettingsPanel(this, this.sfx, () => this.restartRun());
    this.gameOver = new GameOverPanel(this, this.sfx, () => this.restartRun(), () => this.reviveFromRewardedAd());
    this.ascension = new AscensionButton(this, this.core, this.sfx);
    this.makeAlmanacButton();
    this.makeSettingsButton();
    this.makeAchievementsButton();
    this.applyDojoStyle(this.core.equippedDojoStyle);
    this.syncFirstRunChrome();

    // The welcome-back reward was already credited to the wallet at load; the
    // banner is announced here so it can never be missed by an event fired
    // before the scene existed. It yields to stage announcements the same way
    // they yield to each other: one banner at a time.
    const offline = this.core.consumeOfflineReward();
    if (offline !== null) {
      this.stageBanner.announce('WELCOME BACK!', `+${compactNumber(offline.coins)} COINS WHILE YOU WERE AWAY`, 0xfff6dd);
    }
    // The new-day gift, on the same one-at-a-time contract. When a long
    // absence earns both, they are shown in turn rather than one replacing the
    // other unseen.
    const daily = this.core.consumeDailyBonus();
    if (daily !== null) {
      const announce = (): void => {
        this.stageBanner.announce('DAILY BONUS', `+${compactNumber(daily.coins)} COINS - DAY ${daily.daysVisited}`, 0xfff6dd);
      };
      if (offline === null) announce();
      else this.time.delayedCall(1900, announce);
    }

    this.scale.on('resize', this.onResize, this);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.sfx.unlock();
      if (this.modalOpen) return;
      // The clock only swallows presses that actually land on it -- everything
      // else still reaches the board while it drifts past.
      if (this.timeClock.tryCollect(pointer)) { this.startGameplayOnInteraction(); return; }
      if (this.potion.tryCollect(pointer)) { this.startGameplayOnInteraction(); return; }
      if (this.powerups.tryCollect(pointer)) { this.startGameplayOnInteraction(); return; }
      if (this.arena.containsBossPoint(pointer.x, pointer.y) && this.core.tapBoss() > 0) { this.startGameplayOnInteraction(); return; }
      if (this.board.beginDrag(pointer)) { this.startGameplayOnInteraction(); this.core.notePlayerAction(); return; }
      // Pressing a slot the run has not earned is a question, so it gets the
      // lesson naming the stage that opens it -- not just the tile's rattle.
      // Not while the opening tutorial still owns the screen, though: stacking
      // a second card on that one is the clutter the first playtest called out.
      const lockedSlot = this.board.pressLocked(pointer);
      if (lockedSlot === null) return;
      this.startGameplayOnInteraction();
      if (!this.tutorial.isActive && !this.tutorial.visible) this.boardCoach.remind('lockedSlots', lockedSlot);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.modalOpen) this.board.moveDrag(pointer);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.modalOpen) this.board.endDrag(pointer);
    });
    this.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => {
      if (!this.modalOpen) this.board.endDrag(pointer);
    });
    this.core.events.on('coinsChanged', (event) => {
      this.currency.setCoins(event.coins);
      if (event.delta > 0) this.currency.burst();
    });
    // The four moments worth telling the portal about. Poki uses happyTime to
    // learn where a game is at its best, so it is spent on the things a player
    // would tell someone else about: a ninja they have never seen, a boss down,
    // a named goal met, and a prestige.
    this.core.events.on('newTierDiscovered', (event) => {
      if (isShowcaseNinjaTier(event.tier)) this.reveal.show(event.tier, this.input.activePointer.id);
      else this.core.revealTier(event.tier);
      void reportPlatformHappyTime(0.8);
    });
    this.core.events.on('bossDefeated', (event) => {
      void reportPlatformHappyTime(0.5);
      // The very first boss is the opening's proof that the player understood
      // the loop. Let stage 2 arrive, then replace its generic banner with a
      // small celebration and one clear reason to keep going.
      if (event.stage === 1) {
        this.time.delayedCall(620, () => {
          if (!this.core.isGameOver) this.stageBanner.announce('FIRST BOSS DEFEATED!', 'NEXT: PASS KAI AT STAGE 10', 0xfff6dd);
        });
      }
    });
    this.core.events.on('ascended', () => {
      this.sfx.setMusicTrack('dojo');
      this.sfx.play('ascend');
      void reportPlatformHappyTime(1);
    });
    this.core.events.on('dojoStyleEquipped', (event) => {
      this.applyDojoStyle(this.core.equippedDojoStyle, event.source === 'unlock');
      if (event.source === 'unlock') {
        this.stageBanner.announce('CRIMSON DOJO UNLOCKED!', 'GLOSSY BOSS SET COMPLETE', 0xfff1c2);
        void reportPlatformHappyTime(1);
      }
    });
    // Routine stage changes stay in the HUD. Only authored chapter/rival
    // arrivals take over the arena, so forward progress feels meaningful
    // without interrupting the merge loop every few seconds.
    this.core.events.on('bossSpawned', (event) => {
      this.sfx.setMusicTrack(musicTrackForStage(event.stage));
      this.sfx.play(isRivalMilestoneStage(event.stage) ? 'stage' : 'bossIntro');
      if (!isRivalMilestoneStage(event.stage)) return;
      const arenaTheme = themeForStage(event.stage);
      this.stageBanner.announce(arenaTheme.label.toUpperCase(), `RIVAL REACHED - STAGE ${event.stage}`, 0xfff6dd);
    });
    // One line, once per archetype per player, ever. Repeating it every eighth
    // stage would turn the only lesson these mechanics get into chrome.
    this.core.events.on('bossArchetype', (event) => {
      if (!event.firstSeen) return;
      const lesson = ARCHETYPE_LESSON[event.archetype];
      if (lesson === undefined) return;
      this.stageBanner.announce(ARCHETYPES[event.archetype].label, lesson, 0xfff1c2);
    });
    // An ascension restarts the run from stage 1, so it deserves the banner
    // more than the stage-1 spawn that follows it does.
    // The rank is announced ahead of the percentage on purpose: the bonus
    // shrinks with every ascension, the title does not, and by the fourth
    // prestige the title is the part the player can still feel.
    this.core.events.on('ascended', (event) => {
      this.stageBanner.announce(`RANK: ${event.rank}`, `ASCENSION ${event.ascensions} - +${event.bonusPct}% COIN INCOME FOREVER`, 0xfff6dd);
    });
    this.core.events.on('achievementUnlocked', (event) => {
      this.achievementToast.show({
        name: event.name,
        description: event.description,
        kind: event.kind,
        progress: `${event.unlockedCount}/${event.total}`,
      });
      this.sfx.play('newTier');
      void reportPlatformHappyTime(0.6);
      this.refreshAchievementsBadge(true);
      // The page does not pause the run, so an unlock can land while it is
      // open; without this the row it belongs to would stay greyed out.
      if (this.achievementsPanel.isOpen) this.achievementsPanel.refresh();
    });
    this.core.events.on('gameOver', (event) => {
      this.sfx.setMusicTrack('results');
      this.gameOver.show(event);
    });
    this.core.events.on('mergeComboRewarded', (event) => this.sfx.play('combo', event.count));
    this.core.events.on('powerupExpired', () => this.sfx.play('powerupMiss'));
    this.core.events.on('powerupWardBlocked', () => this.sfx.play('shield'));
    this.core.events.on('bossAttack', () => this.sfx.play('attack'));
    this.core.events.on('boardFull', () => {
      this.buy.pulse();
      this.board.pulseMergeable();
    });
    // A broke tap used to be completely silent: the click played, nothing
    // happened, and the button read as broken. Say how much is missing.
    this.core.events.on('purchaseRejected', (event) => {
      this.sfx.play('error');
      if (event.reason !== 'coins') return;
      const shortfall = Math.max(1, this.core.buyCost - this.core.economy.coins);
      this.buy.reject(compactNumber(shortfall));
    });

    this.seedFlameShogunPreview();
    this.currency.setCoins(this.core.economy.coins);
    this.board.syncFromCore();
    this.buy.refresh(this.core.buyTier, this.core.buyCost, this.core.canBuy);
    if (!this.boughtOnce) this.buy.pulse();
    this.exposeHooks();
  }

  /**
   * Dev-only preview seeding, decided by the pure helper in
   * `src/data/devPreview.ts` (unit-tested there). `?showcaseTier=14` is the
   * direct visual proof that a tier does not reuse an earlier portrait;
   * `?showcaseBoss=14` previews the boss at that identity; `?showcaseRoster=1`
   * fills the board with the curated spread. Explicit params work regardless
   * of save state; nothing else ever touches the roster -- reloads, HMR,
   * responsive relayouts and production boots are no-ops, and a fresh run
   * starts through the real economy instead of an implicit starter ninja.
   * Also skipped after a Restart, where a free unit would make the wipe look
   * broken.
   */
  private seedFlameShogunPreview(): void {
    const query = new URLSearchParams(window.location.search);
    const plan = previewSeedPlan(
      {
        showcaseTier: query.get('showcaseTier'),
        showcaseBoss: query.get('showcaseBoss'),
        showcaseRoster: query.has('showcaseRoster'),
      },
      {
        devMode: import.meta.env.DEV,
        restarted: this.restarted,
        loadedFromSave: this.core.loadedFromSave,
        tierCount: BALANCE.tiers.count,
        bossCount: BOSS_COUNT,
      },
    );
    for (const tier of plan.tiers) {
      if (this.core.board.slots.some((ninja) => ninja?.tier === tier)) continue;
      if (this.core.spawnTier(tier) === null) break;
    }
    if (plan.skipToStage !== null) {
      while (this.core.boss.stage < plan.skipToStage) this.core.skipEnemy();
    }
  }

  /** Reveal, almanac, achievements, settings and game over take the screen; none leak drags. */
  private get modalOpen(): boolean {
    return this.reveal.isShowing || this.almanac.isOpen || this.achievementsPanel.isOpen
      || this.settings.isOpen || this.gameOver.isOpen;
  }

  /**
   * Back to a first-ever session: the save slot is deleted, then the scene is
   * rebuilt so every widget is constructed against a core that found nothing
   * to load. Coins, roster, boss stage, health and the almanac's discoveries
   * all start over. Audio settings live in their own slot and are kept.
   */
  private restartRun(): void {
    if (this.restarting) return;
    this.restarting = true;

    // The only interstitial slot in the game, and the one place an ad
    // interrupts nothing: the run is already over, the board is frozen behind a
    // full-screen card, and the next thing the player sees is a new run either
    // way. Whether an ad actually plays is Poki's call -- they cap the
    // frequency, so a player who restarts twice in a minute does not pay for it.
    void (async () => {
      if (shouldOfferCommercialBreak('runRestart')) await requestPlatformCommercialBreak();
      this.restarting = false;
      this.core.wipeSave();
      this.scene.restart({ restarted: true });
    })();
  }

  /** The ad choice is explicit on the game-over screen; no fill, no revive. */
  private async reviveFromRewardedAd(): Promise<boolean> {
    if (!this.core.canRewardedRevive) return false;
    const rewarded = await requestPlatformRewardedBreak();
    if (!rewarded || !this.core.reviveFromRewardedAd()) return false;
    this.gameOver.hide();
    this.sfx.setMusicTrack(musicTrackForStage(this.core.boss.stage));
    this.sfx.play('heal');
    return true;
  }

  private makeAlmanacButton(): void {
    const a = theme.layout.almanac;
    // Same straw nine-slice plate as the gear and the trophy (see
    // makeSettingsButton), so the book doesn't float bare while its two
    // neighbours on the rail sit in a frame -- the row reads as one set of
    // controls instead of two styles.
    this.almanacPlate = this.add
      .nineslice(a.x, a.y, ATLAS_KEY, 'banner_name_9', 46, 46, 11, 11, 7, 7)
      .setTint(theme.colors.woodLight)
      .setDepth(8);
    this.almanacButton = this.add
      .image(a.x, a.y, ATLAS_KEY, 'icon_book')
      .setScale(1.35)
      .setDepth(9)
      .setInteractive(new Phaser.Geom.Rectangle(-6, -6, 38, 38), Phaser.Geom.Rectangle.Contains);
    this.almanacButton.on('pointerdown', () => {
      this.sfx.play('click');
      this.tweens.add({ targets: this.almanacButton, scale: 1.5, yoyo: true, duration: 90 });
      this.almanac.toggle();
    });
    // A quiet progress counter under the book: informational, never urgent --
    // no red, no pulse, no timer. It only ever grows.
    this.almanacBadge = this.add
      .bitmapText(a.x, a.y + 21, 'pixel', '', 11)
      .setOrigin(0.5, 0)
      .setTint(0xffe58a)
      .setDepth(9);
    this.refreshAlmanacBadge(true);
  }

  /** Collection totals behind the badge, plus the one-time completion fanfare. */
  private refreshAlmanacBadge(force = false): void {
    const ninjas = collectionProgress(this.core.discoveredTiers.size, BALANCE.tiers.count);
    const bosses = collectionProgress(this.core.seenBosses.size, BOSS_COUNT);
    const have = ninjas.have + bosses.have;
    const total = BALANCE.tiers.count + BOSS_COUNT;
    const text = `${have}/${total}`;
    if (force || this.almanacBadge.text !== text) this.almanacBadge.setText(text);

    // The whole collection is done: celebrate exactly once, ever -- persisted
    // in the meta save, so a player who already saw this does not see it again
    // on their next session. It is a moment, not a nag.
    if (have >= total && !this.core.collectionCelebrated) {
      this.core.markCollectionCelebrated();
      this.stageBanner.announce('COLLECTION COMPLETE!', 'EVERY NINJA AND BOSS DISCOVERED');
    }
  }

  /**
   * The book takes the hand-off when an earned seal lands on it: a single
   * beat on the icon and its counter, so the player sees where the collectible
   * went without the arena having to carry a permanent panel for it.
   */
  private pulseAlmanacButton(): void {
    this.tweens.add({ targets: this.almanacButton, scale: 2.15, yoyo: true, duration: 180, ease: 'Sine.easeOut' });
    this.tweens.add({ targets: this.almanacPlate, scaleX: 1.14, scaleY: 1.14, yoyo: true, duration: 180, ease: 'Sine.easeOut' });
    this.almanacBadge.setTint(0xffffff);
    this.time.delayedCall(420, () => this.almanacBadge.setTint(0xffe58a));
    this.sfx.play('pickup');
  }

  private layoutAlmanacButton(): void {
    const a = theme.layout.almanac;
    this.almanacPlate.setPosition(a.x, a.y);
    this.almanacButton.setPosition(a.x, a.y);
    this.almanacBadge.setPosition(a.x, a.y + 21);
  }

  /**
   * Sat beside the book: the atlas has no gear icon, so a prop gear is it.
   * The dark prop used to sit straight on the near-black deck and read as a
   * hole, so it gets the AscensionButton treatment -- a straw nine-slice
   * plate to sit on -- while the gear itself is warmed toward white.
   */
  private makeSettingsButton(): void {
    const s = theme.layout.settings;
    this.settingsPlate = this.add
      .nineslice(s.x, s.y, ATLAS_KEY, 'banner_name_9', 46, 46, 11, 11, 7, 7)
      .setTint(theme.colors.woodLight)
      .setDepth(8);
    this.settingsButton = this.add
      .image(s.x, s.y, ATLAS_KEY, 'prop_gear_small_a')
      // A near-white warm multiply keeps the cog's dark silhouette but lets
      // it pop against the light plate instead of sinking into the deck.
      .setScale(1.02)
      .setTint(0xfff6dd)
      .setDepth(9)
      // Covers the 56px plate with a little margin (scale 1.25 turns this
      // into a ~60px world-space square). Written relative to the icon's own
      // native frame (31x33, prop_gear_small_a) rather than centred at 0:
      // Phaser tests a custom hit area after shifting the pointer by the
      // object's own displayOrigin (see BuyButton's fix), so a rectangle
      // centred at (-24,-24) here would have left an 8-9px dead zone along
      // the gear's right and bottom edges.
      .setInteractive(new Phaser.Geom.Rectangle(-8.5, -7.5, 48, 48), Phaser.Geom.Rectangle.Contains);
    this.settingsButton.on('pointerdown', () => {
      this.sfx.unlock();
      this.sfx.play('click');
      // Only the gear turns; the plate stays axis-aligned like the ascension
      // star's, so the hit area never swings away from where a finger aims.
      this.tweens.add({ targets: this.settingsButton, angle: this.settingsButton.angle + 90, duration: 220 });
      this.settings.toggle();
    });
  }

  private layoutSettingsButton(): void {
    const s = theme.layout.settings;
    this.settingsPlate.setPosition(s.x, s.y);
    this.settingsButton.setPosition(s.x, s.y);
  }

  /**
   * Third on the rail: a trophy on the same straw plate the gear and the
   * ascension offer sit on, so the row reads as one set of controls.
   *
   * Deliberately not the atlas star. The ascension offer is a star on a plate
   * and sits on this same rail, so a second star here read as the same button
   * appearing twice; the trophy is drawn in the shipped icon style but is
   * unmistakably a different thing.
   */
  private makeAchievementsButton(): void {
    const a = theme.layout.achievements;
    this.achievementsPlate = this.add
      .nineslice(a.x, a.y, ATLAS_KEY, 'banner_name_9', 46, 46, 11, 11, 7, 7)
      .setTint(theme.colors.woodLight)
      .setDepth(8);
    this.achievementsButton = this.add
      .image(a.x, a.y, ACHIEVEMENTS_ICON_KEY)
      .setScale(1.12)
      .setDepth(9)
      // Same fix as the settings gear: written relative to the icon's own
      // native 30x30 frame, not centred at 0 -- see that comment for why.
      .setInteractive(new Phaser.Geom.Rectangle(-9, -9, 48, 48), Phaser.Geom.Rectangle.Contains);
    this.achievementsButton.on('pointerdown', () => {
      this.sfx.unlock();
      this.sfx.play('click');
      this.tweens.add({ targets: this.achievementsButton, scale: 1.2, yoyo: true, duration: 90 });
      this.achievementsPanel.toggle();
    });
    // The same quiet counter the almanac carries: it only ever grows, and it
    // is the one place a player can see how much is left to try.
    this.achievementsBadge = this.add
      .bitmapText(a.x, a.y + 21, 'pixel', '', 11)
      .setOrigin(0.5, 0)
      .setTint(0xffe58a)
      .setDepth(9);
    this.refreshAchievementsBadge(true);
  }

  private refreshAchievementsBadge(force = false): void {
    const progress = this.core.achievementProgress;
    const text = `${progress.have}/${progress.total}`;
    if (force || this.achievementsBadge.text !== text) this.achievementsBadge.setText(text);
  }

  private layoutAchievementsButton(): void {
    const a = theme.layout.achievements;
    this.achievementsPlate.setPosition(a.x, a.y);
    this.achievementsButton.setPosition(a.x, a.y);
    this.achievementsBadge.setPosition(a.x, a.y + 21);
  }

  private makeBackdrop(): void {
    // The old industrial gears fought the dojo setting. The supplied backdrop
    // already carries restrained lantern light and architecture, so the panel
    // chrome can remain the only foreground decoration.
    this.layoutBackdrop();
  }

  private layoutBackdrop(): void {
    if (this.gears.length === 0) return;
    const l = theme.layout;
    const b = l.board;
    const positions: Array<[number, number]> = [
      [l.width * 0.06, l.height * 0.13],
      [l.width * 0.53, l.height * 0.07],
      [l.width * 0.96, l.height * 0.21],
      [b.x + 64, b.y + b.h - 72],
      [b.x + b.w * 0.53, b.y + b.h - 74],
      [b.x + b.w - 64, b.y + b.h - 72],
    ];
    this.gears.forEach(({ image }, index) => {
      image
        .setPosition(...positions[index]!)
        .setScale(index === 0 || index === 4 ? 1.8 : 1.35)
        .setAlpha(index < 3 ? 0.2 : 0.42)
        .setDepth(index < 3 ? 0 : 4);
    });
  }

  private makeArenaChrome(): void {
    const a = theme.layout.arena;
    this.arenaFrame = new PanelChrome(this, a, 'ARENA', 50);
    this.layoutArenaChrome();
  }

  private layoutArenaChrome(): void {
    const a = theme.layout.arena;
    this.arenaFrame.relayout(a);
  }

  /**
   * `configureLayout` is not re-run here: the resize that triggers this
   * handler is always preceded by main.ts's own listener already calling it
   * with the real `window.innerWidth/innerHeight` and pushing the result into
   * `game.scale.resize()`. Re-deriving layout from the resize event's
   * `gameSize` (the canvas's internal design resolution, not the viewport)
   * would size everything for the wrong reference frame.
   */
  private onResize(): void {
    this.layoutScreenBackground();
    this.layoutBackdrop();
    this.layoutArenaChrome();
    this.arena.relayout();
    this.arenaVfx.relayout();
    this.powerAuras.relayout();
    this.board.relayout();
    this.buy.relayout();
    this.trash.relayout();
    this.currency.relayout();
    this.hud.relayout();
    this.playerHud.relayout();
    this.reveal.relayout();
    this.almanac.relayout();
    this.achievementsPanel.relayout();
    this.achievementToast.relayout();
    this.settings.relayout();
    this.gameOver.relayout();
    this.timeClock.relayout();
    this.potion.relayout();
    this.powerups.relayout();
    this.tutorial.relayout();
    this.powerupCoach.relayout();
    this.lowHealth.relayout();
    this.stageBanner.relayout();
    this.stickerEarned.relayout();
    this.draftCards.relayout();
    this.boardCoach.relayout();
    this.rivals.relayout();
    this.ascension.relayout();
    this.layoutAlmanacButton();
    this.layoutSettingsButton();
    this.layoutAchievementsButton();
    this.exposeHooks();
  }

  /**
   * Poki is told the player is playing whenever a live run is on screen with
   * nothing on top of it. The almanac, the settings page, a tier reveal and the
   * game-over card are all "not playing" -- their checklist counts a menu as a
   * menu however good the game behind it is.
   *
   * The last reported value is held here rather than pushed every frame: the
   * SDK wrapper dedupes, but only after building a promise to do it in.
   */
  private syncGameplayReport(): void {
    const active = this.playerStartedGameplay && !this.modalOpen && !this.core.isGameOver;
    if (active === this.gameplayReported) return;
    this.gameplayReported = active;
    setPlatformGameplayActive(active);
  }

  /** The SDK event must follow an actual game interaction, never the first frame. */
  private startGameplayOnInteraction(): void {
    if (this.playerStartedGameplay) return;
    // The first tap is the hook, not a natural break. Report play immediately;
    // interstitial opportunities begin only after a completed run.
    this.playerStartedGameplay = true;
    this.retention.startGameplay(this.core.boss.stage);
    this.syncGameplayReport();
  }

  override update(_time: number, dt: number): void {
    this.syncGameplayReport();
    if (this.gameplayReported) this.retention.updateActive(dt);
    this.core.update(dt);
    this.timeClock.update(dt);
    this.potion.update(dt);
    this.powerups.update(dt);
    this.tutorial.update();
    this.powerupCoach.update();
    this.syncFirstRunChrome();
    this.powerAuras.update(dt);
    this.arenaVfx.update(dt);
    this.lowHealth.setDanger(this.core.lowHealth);
    this.lowHealth.setEnraged(this.core.bossEnraged);
    this.arena.update(dt);
    this.director.update(dt);
    this.gears.forEach(({ image, speed }) => {
      image.angle += speed * dt;
    });
    this.draftCards.update();
    this.archetypes.update(dt);
    this.hud.update();
    this.playerHud.update();
    this.board.refreshExternalState(dt);
    this.buy.refresh(this.core.buyTier, this.core.buyCost, this.core.canBuy);
    this.ascension.refresh();
    this.refreshAlmanacBadge();
    this.refreshAchievementsBadge();
    if (this.almanac.isOpen) this.almanac.updateProgress();
    if (this.debug.visible) this.debug.refresh();
  }

  /** Keep the first lesson focused on one verb; secondary systems arrive after it clicks. */
  private syncFirstRunChrome(): void {
    const visible = !this.tutorial.isActive && !this.tutorial.visible;
    this.rivals.setVisible(visible);
    this.trash.setVisible(visible);
    this.almanacPlate.setVisible(visible);
    this.almanacButton.setVisible(visible);
    this.almanacBadge.setVisible(visible);
    this.settingsPlate.setVisible(visible);
    this.settingsButton.setVisible(visible);
    this.achievementsPlate.setVisible(visible);
    this.achievementsButton.setVisible(visible);
    this.achievementsBadge.setVisible(visible);
    this.stickerEarned.setTutorialHidden(!visible);
  }

  private applyDojoStyle(style: DojoStyleDef, animate = false): void {
    this.background.setTint(style.palette.backgroundTint);
    this.arenaFrame.applyDojoStyle(style);
    this.almanacPlate.setTint(style.palette.plate);
    this.settingsPlate.setTint(style.palette.plate);
    this.achievementsPlate.setTint(style.palette.plate);
    this.board.applyDojoStyle(style);
    this.buy.applyDojoStyle(style);
    this.currency.applyDojoStyle(style);
    this.hud.applyDojoStyle(style);
    this.playerHud.applyDojoStyle(style);
    this.rivals.applyDojoStyle(style);
    this.stageBanner.applyDojoStyle(style);
    this.stickerEarned.applyDojoStyle(style);
    this.draftCards.applyDojoStyle(style);
    this.archetypes.setDojoStyle(style);
    this.lowHealth.applyDojoStyle(style);
    this.almanac.applyDojoStyle(style);
    this.arena.setDojoStyle(style);
    this.director.setDojoStyle(style);
    if (!animate) return;
    const flash = this.add
      .rectangle(theme.layout.width / 2, theme.layout.height / 2, theme.layout.width, theme.layout.height, style.palette.accentBright, .22)
      .setDepth(305)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: flash, alpha: 0, duration: 720, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
  }

  private onBuy(): void {
    // The button itself already played the click; a second one here flams
    // against it. This handler only reacts to the outcome.
    this.startGameplayOnInteraction();
    this.core.notePlayerAction();
    const ninja = this.core.buy();
    if (ninja !== null) this.boughtOnce = true;
    else if (this.core.board.firstEmpty() === null) {
      this.buy.pulse();
      this.board.pulseMergeable();
    }
  }

  private exposeHooks(): void {
    const w = window as unknown as Record<string, unknown>;
    w.__mn = {
      ready: true,
      core: this.core,
      revealing: () => this.reveal.isShowing,
      almanacOpen: () => this.almanac.isOpen,
      achievementsOpen: () => this.achievementsPanel.isOpen,
      toggleAchievements: () => this.achievementsPanel.toggle(),
      achievementsButtonPos: () => this.toPage(theme.layout.achievements.x, theme.layout.achievements.y),
      achievementsPage: () => this.achievementsPanel.pageState(),
      achievementsAnchors: () => {
        const anchors = this.achievementsPanel.anchors();
        return { previous: this.toPage(anchors.previous.x, anchors.previous.y), next: this.toPage(anchors.next.x, anchors.next.y) };
      },
      toastName: () => this.achievementToast.currentName(),
      toastPending: () => this.achievementToast.pending,
      rank: () => this.core.rank,
      best: () => this.core.best,
      achievementProgress: () => this.core.achievementProgress,
      lockedSlotPos: () => this.core.lockedSlots.map((slot) => {
        const at = this.board.slotPos(slot);
        return { slot, ...this.toPage(at.x, at.y + 6) };
      }),
      lockedPadOffset: (slot: number) => this.board.padOffset(slot),
      coachCard: () => this.boardCoach.snapshot(),
      clockLive: () => this.timeClock.isLive,
      spawnClock: () => this.timeClock.forceSpawn(),
      clockPos: () => this.toPage(this.timeClock.x, this.timeClock.y),
      potionLive: () => this.potion.isLive,
      spawnPotion: () => this.potion.forceSpawn(),
      potionPos: () => this.toPage(this.potion.x, this.potion.y),
      powerupSpawn: (id?: PowerupId) => this.powerups.forceSpawn(id),
      powerupLive: () => this.powerups.liveIds,
      powerupPos: (id: PowerupId) => {
        const pos = this.powerups.posOf(id);
        return pos === null ? null : this.toPage(pos.x, pos.y);
      },
      powerupHud: () => ({ active: this.core.powerups.activeEffects(), hud: this.core.powerups.hudState(), charges: this.core.powerups.wardCharges }),
      powerupActivate: (id: PowerupId) => this.core.collectPowerup(id),
      tutorialActive: () => this.tutorial.isActive,
      powerupCoachActive: () => this.powerupCoach.isActive,
      stickerEarned: () => this.stickerEarned.snapshot(),
      draftHovered: () => this.draftCards.hoveredCard(),
      draftCardRects: () => this.draftCards.cardRects().map((card) => ({
        id: card.id,
        angle: card.angle,
        centre: this.toPage(card.x, card.y),
        halfW: card.halfW * (this.game.canvas.getBoundingClientRect().width / theme.layout.width),
        halfH: card.halfH * (this.game.canvas.getBoundingClientRect().height / theme.layout.height),
      })),
      equipDojoStyle: (id: 'classic' | 'crimson-dojo') => this.core.equipDojoStyle(id),
      equippedDojoStyle: () => this.core.equippedDojoStyle.id,
      coinFrenzyCoins: () => this.powerups.liveRainCoins.map((coin) => this.toPage(coin.x, coin.y)),
      coinFrenzyState: () => this.core.coinFrenzyState,
      lowHealthWarning: () => this.lowHealth.isShowing,
      gameOverOpen: () => this.gameOver.isOpen,
      tryAgainPos: () => this.toPage(this.gameOver.anchors().tryAgain.x, this.gameOver.anchors().tryAgain.y),
      openAlmanac: () => this.almanac.show(),
      toggleAlmanac: () => this.almanac.toggle(),
      almanacButtonPos: () => this.toPage(theme.layout.almanac.x, theme.layout.almanac.y),
      almanacPage: () => this.almanac.pageState(),
      almanacArrows: () => {
        const a = this.almanac.anchors();
        return { previous: this.toPage(a.previous.x, a.previous.y), next: this.toPage(a.next.x, a.next.y) };
      },
      almanacEntryPos: (kind: 'ninja' | 'boss', index: number) => {
        const anchor = this.almanac.entryAnchor(kind, index);
        return anchor === null ? null : this.toPage(anchor.x, anchor.y);
      },
      almanacDebugTap: (kind: 'ninja' | 'boss', index: number) => this.almanac.debugTap(kind, index),
      almanacDetail: () => this.almanac.detailState(),
      almanacStylesOpen: () => this.almanac.stylesOpen,
      almanacStylesPos: () => {
        const anchor = this.almanac.stylesAnchor();
        return this.toPage(anchor.x, anchor.y);
      },
      stageBannerVisible: () => this.stageBanner.visible,
      /** The rival scroll's fixed roll: the only part of it on screen while shut. */
      rivalScrollPos: () => this.toPage(this.rivals.x, this.rivals.y),
      rivalScrollOpen: () => this.rivals.unfurlAmount(),
      settingsOpen: () => this.settings.isOpen,
      openSettings: () => this.settings.show(),
      settingsButtonPos: () => this.toPage(theme.layout.settings.x, theme.layout.settings.y),
      settingsAnchors: () => {
        const a = this.settings.anchors();
        const track = (t: { left: number; right: number; y: number }) => ({
          left: this.toPage(t.left, t.y),
          right: this.toPage(t.right, t.y),
        });
        return {
          music: track(a.music),
          sfx: track(a.sfx),
          restart: this.toPage(a.restart.x, a.restart.y),
          cancel: this.toPage(a.cancel.x, a.cancel.y),
          confirm: this.toPage(a.confirm.x, a.confirm.y),
        };
      },
      volumes: () => ({ music: this.sfx.musicVolume, sfx: this.sfx.sfxVolume }),
      slotPos: (slot: number) => this.toPage(this.board.slotPos(slot).x, this.board.slotPos(slot).y),
      /** Where the character's body actually renders -- what a finger aims at. */
      bodyPos: (slot: number) =>
        this.toPage(this.board.slotPos(slot).x, this.board.slotPos(slot).y - 66 * theme.layout.slots.spriteScale),
      buyPos: () => this.toPage(theme.layout.buy.x, theme.layout.buy.y),
      trashPos: () => this.toPage(theme.layout.trash.x, theme.layout.trash.y),
      almanacBadgeText: () => this.almanacBadge.text,
      ascensionVisible: () => this.ascension.visible,
      ascensionAnchors: () => this.ascension.anchors(),
      bannerVisible: () => this.stageBanner.visible,
      bannerMainText: () => this.stageBanner.mainText(),
      /** Direct probe for the reward floater, so verification needs no boss kill timing. */
      fxGain: (x: number, y: number, message: string) => this.fx.gain(x, y, message),
      /** Who would actually receive a press right now (topOnly order), and who lost. */
      inputStack: () =>
        (this.input.hitTestPointer(this.input.activePointer) as Phaser.GameObjects.GameObject[]).map((obj) => ({
          kind: obj.constructor.name,
          depth: (obj as unknown as { depth: number }).depth,
          visible: (obj as Phaser.GameObjects.Container | Phaser.GameObjects.Image).visible,
          label: obj instanceof Phaser.GameObjects.BitmapText ? obj.text : '',
        })),
    };
  }

  private toPage(x: number, y: number): { x: number; y: number } {
    const rect = this.game.canvas.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX + (x * rect.width) / theme.layout.width,
      y: rect.top + window.scrollY + (y * rect.height) / theme.layout.height,
    };
  }

  /** Cover, never stretch: the dojo stays coherent in every layout. */
  private layoutScreenBackground(): void {
    const width = Math.max(1, this.background.width);
    const height = Math.max(1, this.background.height);
    const scale = Math.max(theme.layout.width / width, theme.layout.height / height);
    this.background.setPosition(theme.layout.width / 2, theme.layout.height / 2).setScale(scale);
  }
}
