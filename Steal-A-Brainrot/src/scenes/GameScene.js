// Orchestration: builds every system, owns the drop() intent table, forwards
// raw pointer events to the board, gates Poki gameplay reporting on real
// player input, and drives the per-frame update order.
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    this.modalOpen = false;
    this.playerStartedGameplay = false;
    this._gameplayReported = false;
    this._saveTimer = 0;

    this.cameras.main.setBackgroundColor('#101a30');

    this.fx = new Effects(this);
    this.economy = new Economy();
    this.board = new BoardModel();

    // restore the run
    const run = SaveSys.data.run;
    this.economy.coins = run.coins != null ? run.coins : CFG.ECON.startCoins;
    this.economy.tickets = run.tickets || 0;
    this.board.load(run.board);
    this.board.allUnits().forEach((u) => { SaveSys.discover(u.id); SaveSys.bestStar(u.id, u.star); });

    this.gacha = new GachaSystem(this.board, this.economy);
    this.boardUI = new BoardUI(this, this.board);
    this.combat = new CombatSystem(this, this.board, this.economy);
    this.hud = new HUD(this, this.economy);
    this.machineUI = new MachineUI(this, this.gacha, this.economy);
    this.braindex = new Braindex(this);
    this.director = new StageDirector(this, this.combat, this.economy, this.hud);
    this.tutorial = new TutorialSystem(this, this.director);

    this.machineUI.onResult = (result) => this.applyGachaResult(result);
    this.combat.onKill = () => this.machineUI.refresh();

    // ---- input: raw pointer events, no drag plugin ----
    this.input.addPointer(2);
    this.input.on('pointerdown', (p) => {
      AudioSys.ensure();
      if (this.modalOpen) return;
      if (this.machineUI.handlePointerDown(p)) return;
      if (this.boardUI.beginDrag(p)) this.startGameplayOnInteraction();
    });
    this.input.on('pointermove', (p) => { if (!this.modalOpen) this.boardUI.moveDrag(p); });
    this.input.on('pointerup', (p) => { if (!this.modalOpen) this.boardUI.endDrag(p); });
    this.input.on('pointerupoutside', (p) => { if (!this.modalOpen) this.boardUI.endDrag(p); });

    this._onResize = () => this.relayoutAll();
    this.scale.on('resize', this._onResize);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this._onResize);
      Poki.gameplayStop();
    });

    this.director.startStage(run.stage || 1);
    AudioSys.setMusic('normal');
  }

  // ------------------------------------------------------- drop intents
  // merge -> swap -> move -> sell; a max-star pair trades places instead of
  // refusing silently.

  drop(fromSlot, target) {
    const unit = this.board.at(fromSlot);
    if (!unit) return 'rejected';

    if (target.kind === 'trash') {
      const def = CREATURES_BY_ID[unit.id];
      const price = Units.sellPrice(def, unit.star);
      this.board.remove(fromSlot);
      this.economy.earn(price);
      this.boardUI.sellAnim(unit.uid, price);
      this.machineUI.refresh();
      return 'sold';
    }

    const to = target.slot;
    if (to < 0 || to >= BoardModel.SIZE || to === fromSlot) return 'rejected';
    const other = this.board.at(to);

    if (!other) {
      this.board.move(fromSlot, to);
      if (this.board.isField(to) && this.tutorial) this.tutorial.onDeploy();
      return 'moved';
    }

    if (other.id !== unit.id || other.star !== unit.star) {
      this.board.swap(fromSlot, to);
      if (this.board.isField(to) && this.tutorial) this.tutorial.onDeploy();
      return 'swapped';
    }

    const merged = this.board.merge(fromSlot, to);
    if (!merged) {
      // both already at max star
      this.board.swap(fromSlot, to);
      return 'swapped';
    }

    SaveSys.addStat('merges');
    SaveSys.bestStar(merged.result.id, merged.result.star);
    if (merged.result.star >= CFG.STAR.max) SaveSys.addStat('fiveStars');
    this.boardUI.animateMerge(fromSlot, to, merged.consumedUids, merged.result);
    if (this.tutorial) this.tutorial.onMerge();
    Poki.happyTime(merged.result.star >= 4 ? 0.8 : 0.5);
    this.machineUI.refresh();
    return 'merged';
  }

  // ------------------------------------------------------- gacha results

  applyGachaResult(result) {
    const m = LAYOUT.machine;
    const mx = m.x + m.w / 2, my = m.y + m.h / 2;

    if (result.coins) {
      this.economy.earn(result.coins);
      const t = this.hud.coinTarget();
      this.fx.coinBurst(mx, my, 10);
      this.fx.coinFly(mx, my, t.x, t.y, () => this.hud.bumpCoins());
      this.fx.floatText(mx, my - 30, '+' + HUD.money(result.coins), '#ffe082', 24);
    }
    if (result.kind === 'jackpot') {
      this.fx.banner('JACKPOT!', '#ffd54f');
      this.fx.confetti(mx, my, 30);
    }
    if (result.kind === 'double' && result.defs.length > 1) {
      this.fx.banner('DOUBLE!', '#80deea');
    }

    result.defs.forEach((def) => {
      const slot = this.board.firstEmptyBench();
      if (slot === -1) return;   // guarded upstream; never drop one silently
      const unit = this.board.spawn(def.id, 1, slot);
      this.boardUI.spawnAnim(unit);
      const isNew = SaveSys.discover(def.id);
      SaveSys.bestStar(def.id, 1);
      const rc = RARITIES[def.rarity];
      const colorStr = '#' + rc.color.toString(16).padStart(6, '0');
      if (isNew) {
        this.fx.banner('NEW! ' + def.name.toUpperCase(), colorStr, rc.name);
        AudioSys.sfx(rc.tier >= 4 ? 'legendary' : 'reveal');
        Poki.happyTime(rc.tier >= 4 ? 1 : 0.6);
      } else if (rc.tier >= 4) {
        this.fx.banner(def.name.toUpperCase() + '!', colorStr);
        AudioSys.sfx('legendary');
        Poki.happyTime(1);
      }
    });

    this.machineUI.refresh();
    // the merge/deploy hand can only aim once the units actually exist
    if (this.tutorial && this.tutorial.active) this.tutorial.relayout();
    this.snapshot();
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
    const dt = Math.min(delta, 100);

    if (!this.modalOpen) {
      const combatDt = dt * this.fx.timeScale();
      const st = this.director.state;
      if (st === 'wave' || st === 'boss' || st === 'gap') this.combat.update(combatDt);
      this.director.update(dt);
    }

    this.boardUI.update(time);
    this.hud.refresh();
    this.syncGameplayReport();

    SaveSys.addStat('playMs', dt);
    this._saveTimer += dt;
    if (this._saveTimer >= CFG.SAVE_EVERY_MS) {
      this._saveTimer = 0;
      this.snapshot();
    }
  }

  snapshot() {
    SaveSys.snapshotRun(this.economy, this.board, this.director.stage);
  }

  relayoutAll() {
    this.boardUI.relayout();
    this.combat.relayout();
    this.hud.relayout();
    this.machineUI.relayout();
    this.braindex.relayout();
    this.director.relayout();
    if (this.tutorial) this.tutorial.relayout();
  }
}
window.GameScene = GameScene;
