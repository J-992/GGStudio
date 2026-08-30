// Orchestration: builds every system, owns the place/dig rules, forwards raw
// pointer events (coin taps beat cards beat the lawn), gates Poki gameplay
// reporting on real player input, and drives the per-frame update order.
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.levelN = (data && data.level) || SaveSys.data.level || 1;
    this.teamIds = ((data && data.team) || SaveSys.data.team).slice(0, CFG.TEAM.size);
  }

  create() {
    this.modalOpen = false;
    this.playerStartedGameplay = false;
    this._gameplayReported = false;

    this.cameras.main.setBackgroundColor('#101a30');

    const recipe = LEVELS[Math.min(this.levelN, LEVELS.length) - 1];

    this.fx = new Effects(this);
    this.economy = new Economy();
    this.economy.energy = recipe.startEnergy != null ? recipe.startEnergy : CFG.ENERGY.start;

    this.lawn = new Lawn(this, recipe.lanes);
    this.energy = new EnergySystem(this, this.economy);
    this.combat = new CombatSystem(this, this.lawn, this.economy, this.energy);
    this.hud = new HUD(this, this.economy);
    this.cards = new CardBar(this, this.teamIds, this.economy);
    this.director = new WaveDirector(this, this.combat, this.economy, this.hud);
    this.tutorial = new TutorialSystem(this, this.director);

    this.energy.onCollect = () => { if (this.tutorial) this.tutorial.onCollect(); };

    // ---- input: raw pointer events, no drag plugin ----
    this.input.addPointer(2);
    this.input.on('pointerdown', (p) => {
      AudioSys.ensure();
      if (this.modalOpen) return;
      if (this.energy.tryCollect(p)) { this.startGameplayOnInteraction(); return; }
      if (this.cards.handleDown(p)) { this.startGameplayOnInteraction(); return; }
      const intent = this.cards.fieldTap(p);
      if (intent) this.applyIntent(intent);
    });
    this.input.on('pointermove', (p) => { if (!this.modalOpen) this.cards.moveDrag(p); });
    const up = (p) => {
      if (this.modalOpen) return;
      const intent = this.cards.handleUp(p);
      if (intent) this.applyIntent(intent);
    };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);

    this._onResize = () => this.relayoutAll();
    this.scale.on('resize', this._onResize);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this._onResize);
      Poki.gameplayStop();
    });

    this.director.startLevel(this.levelN);
    AudioSys.setMusic('normal');
  }

  // ------------------------------------------------------- intents

  applyIntent(intent) {
    if (intent.kind === 'dig') {
      if (this.lawn.dig(intent.lane, intent.col)) {
        this.cards.clearSelection();
        this.startGameplayOnInteraction();
      }
      return;
    }
    this.tryPlace(intent.card, intent.lane, intent.col);
  }

  tryPlace(cardIdx, lane, col) {
    const card = this.cards.cards[cardIdx];
    if (!card) return false;
    const def = card.def;

    if (!this.lawn.canPlace(lane, col)) {
      AudioSys.sfx('denied');
      return false;
    }
    if (!this.cards.isReady(cardIdx)) {
      AudioSys.sfx('denied');
      if (!this.economy.canAfford(def.cost)) {
        this.fx.floatText(LAYOUT.field.colX(col), LAYOUT.field.laneY(lane) - 40, 'NEED MORE COINS!', '#ff8a80', 18);
      }
      return false;
    }

    this.economy.spend(def.cost);
    this.lawn.place(def.id, lane, col);
    this.cards.startCooldown(cardIdx);
    this.startGameplayOnInteraction();
    if (this.tutorial) this.tutorial.onPlant(def.id);
    return true;
  }

  // ------------------------------------------------------- poki gating
  // The SDK event must follow an actual game interaction, never the first
  // frame; opening any modal reads as a gameplay pause.

  startGameplayOnInteraction() {
    if (this.playerStartedGameplay) return;
    this.playerStartedGameplay = true;
    this.syncGameplayReport();
  }

  syncGameplayReport() {
    const active = this.playerStartedGameplay && !this.modalOpen && !Poki.adPlaying;
    if (active === this._gameplayReported) return;
    this._gameplayReported = active;
    if (active) Poki.gameplayStart();
    else Poki.gameplayStop();
  }

  // ------------------------------------------------------- frame

  update(time, delta) {
    // Clamp the top end for a tab that was backgrounded, and the bottom end
    // because a non-finite delta does not throw -- it silently turns every
    // countdown in the game (produce timers, card cooldowns, wave clocks) into
    // NaN, and the lawn just quietly stops working.
    const dt = delta > 0 && delta < 100 ? delta : (delta >= 100 ? 100 : 16);

    if (!this.modalOpen) {
      const combatDt = dt * this.fx.timeScale();
      const st = this.director.state;
      if (st === 'wave' || st === 'boss' || st === 'prep') this.combat.update(combatDt);
      this.energy.update(dt);
      this.cards.update(dt);
      this.director.update(dt);
      if (this.tutorial) this.tutorial.update(dt);
    }

    this.hud.refresh();
    this.syncGameplayReport();
    SaveSys.addStat('playMs', dt);
  }

  relayoutAll() {
    this.lawn.relayout();
    this.combat.relayout();
    this.hud.relayout();
    this.cards.relayout();
    this.director.relayout();
    if (this.tutorial) this.tutorial.relayout();
  }
}
window.GameScene = GameScene;
