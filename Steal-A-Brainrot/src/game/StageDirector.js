// Stage/wave progression, lives, win/lose panels, and the only two places an
// interstitial can run (NEXT STAGE and RETRY -- the first tap is never a
// natural break). Past the authored list the game goes endless on the last
// recipe with compounding hp growth.
class StageDirector {
  constructor(scene, combat, economy, hud) {
    this.scene = scene;
    this.combat = combat;
    this.economy = economy;
    this.hud = hud;

    this.state = 'idle';    // idle | prep | wave | gap | boss | victory | defeat
    this.stage = 1;
    this.waveIdx = 0;
    this.lives = CFG.STAGE.lives;
    this.timer = 0;
    this.holdPrep = false;  // tutorial keeps the first wave back until deploy
    this._revived = false;
    this._everFailed = false;
    this._bossSpawned = false;

    this.panel = scene.add.container(0, 0).setDepth(1150).setVisible(false);

    combat.onLifeLost = (n) => this._loseLives(n);
    combat.onBossDown = (e) => {
      const t = e.def.tickets || 1;
      this.economy.earnTickets(t);
      this.scene.fx.banner('BOSS DOWN!', '#ffd54f', '+' + t + ' \u{1F39F} tickets');
    };
  }

  recipeFor(n) {
    const idx = Math.min(n, STAGES.length) - 1;
    const def = STAGES[idx];
    const hpMult = Math.pow(CFG.STAGE.hpGrowth, n - 1) * (def.bossMult && n > STAGES.length ? 1 : 1);
    const coinMult = Math.pow(CFG.STAGE.coinGrowth, n - 1);
    return { def, hpMult, coinMult };
  }

  startStage(n) {
    this.stage = n;
    SaveSys.data.run.stage = n;
    this.recipe = this.recipeFor(n);
    this.waveIdx = 0;
    this.lives = CFG.STAGE.lives;
    this._revived = false;
    this._bossSpawned = false;
    this.combat.reset();
    this.hud.setLives(this.lives);
    this._refreshHudLabel('GET READY');
    this._hidePanel();
    this.state = 'prep';
    this.timer = CFG.STAGE.prepMs;
    this.scene.fx.banner('STAGE ' + n, '#ffffff', this.recipe.def.name);
    AudioSys.setMusic('normal');
  }

  update(dtMs) {
    switch (this.state) {
      case 'prep':
        if (this.holdPrep) return;
        this.timer -= dtMs;
        if (this.timer <= 0) this._startWave(0);
        break;
      case 'gap':
        this.timer -= dtMs;
        if (this.timer <= 0) this._startWave(this.waveIdx);
        break;
      case 'wave':
        if (this.combat.allDead()) {
          if (this.waveIdx < this.recipe.def.waves.length) {
            this.state = 'gap';
            this.timer = CFG.STAGE.waveGapMs;
          } else if (this.recipe.def.boss && !this._bossSpawned) {
            this._spawnBoss();
          } else {
            this._victory();
          }
        }
        break;
      case 'boss':
        if (this.combat.allDead()) this._victory();
        break;
    }
  }

  _startWave(i) {
    const waves = this.recipe.def.waves;
    this.waveIdx = i + 1;
    this.state = 'wave';
    this.combat.startWave(waves[i].spawns, this.recipe.hpMult, this.recipe.coinMult);
    this.scene.fx.banner('WAVE ' + this.waveIdx + '/' + waves.length, '#90caf9');
    AudioSys.sfx('wave');
    AudioSys.setMusic(this.recipe.def.boss ? 'boss' : 'battle');
    this._refreshHudLabel();
    if (this.scene.tutorial) this.scene.tutorial.onBattleStart();
  }

  _spawnBoss() {
    this._bossSpawned = true;
    this.state = 'boss';
    const mult = this.recipe.hpMult * (this.recipe.def.bossMult || 1);
    this.combat.spawnBoss(this.recipe.def.boss, mult, this.recipe.coinMult);
    AudioSys.setMusic('boss');
    this._refreshHudLabel('BOSS');
  }

  _refreshHudLabel(suffix) {
    const total = this.recipe ? this.recipe.def.waves.length : 0;
    const tail = suffix ? ' · ' + suffix
      : (this.waveIdx > 0 ? ' · WAVE ' + this.waveIdx + '/' + total : '');
    this.hud.setStage('STAGE ' + this.stage + tail);
  }

  _loseLives(n) {
    if (this.state === 'victory' || this.state === 'defeat') return;
    this.lives -= n;
    this.hud.setLives(Math.max(0, this.lives));
    if (this.lives <= 0) this._defeat();
  }

  // ------------------------------------------------------------ outcomes

  _victory() {
    if (this.state === 'victory') return;
    this.state = 'victory';
    const bonus = CFG.STAGE.victoryCoins * this.stage;
    this.economy.earn(bonus);
    SaveSys.addStat('stagesCleared');
    SaveSys.data.run.stage = this.stage + 1;
    this.scene.snapshot();
    Poki.happyTime(1);
    AudioSys.sfx('victory');
    AudioSys.setMusic('normal');
    if (this.scene.tutorial) this.scene.tutorial.onVictory();

    this._showPanel({
      title: 'STAGE ' + this.stage + ' CLEAR!',
      titleColor: '#ffd54f',
      sub: '+' + HUD.money(bonus) + ' bonus',
      buttons: [
        { label: 'NEXT STAGE ▶', color: 0x43a047, cb: () => this.nextStage() },
      ],
    });
    this.scene.fx.confetti(LAYOUT.width / 2, LAYOUT.height * 0.3, 36);
  }

  _defeat() {
    if (this.state === 'defeat') return;
    this.state = 'defeat';
    this._everFailed = true;
    AudioSys.sfx('defeat');
    AudioSys.setMusic('normal');
    this.scene.fx.shake(0.01, 350);

    const buttons = [
      { label: '↻ RETRY STAGE', color: 0x455a64, cb: () => this.retry() },
    ];
    if (!this._revived) {
      buttons.unshift({
        label: '\u{1F4FA} REVIVE (free)', color: 0x7b1fa2, cb: () => this.revive(),
      });
    }
    this._showPanel({
      title: 'THE BRAINROTS FELL!',
      titleColor: '#ff8a80',
      sub: 'Your board is safe. Merge stronger and try again!',
      buttons,
    });
  }

  nextStage() {
    this._maybeAd(() => this.startStage(this.stage + 1));
  }

  retry() {
    this._maybeAd(() => this.startStage(this.stage));
  }

  revive() {
    Poki.rewardedBreak().then((watched) => {
      if (!watched) { AudioSys.sfx('denied'); return; }
      this._revived = true;
      this.lives = CFG.STAGE.lives;
      this.hud.setLives(this.lives);
      this._hidePanel();
      this.state = this._bossSpawned && this.combat.hasBoss() ? 'boss' : 'wave';
      AudioSys.setMusic(this.recipe.def.boss ? 'boss' : 'battle');
      this.scene.fx.banner('REVIVED!', '#ce93d8');
    });
  }

  // Interstitials only on stage transitions, only after real gameplay, and
  // never around the very first stage: the first tap is the hook, not a break.
  _maybeAd(go) {
    const natural = this.scene.playerStartedGameplay && (this.stage > 1 || this._everFailed);
    if (!natural) { go(); return; }
    const p = Poki.commercialBreak(CFG.ADS.interstitialGapMs);
    if (p && p.then) p.then(go); else go();
  }

  // ------------------------------------------------------------ panels

  _showPanel(cfg) {
    const r = this.panel;
    r.removeAll(true);
    const W = LAYOUT.width, H = LAYOUT.height;

    const dim = this.scene.add.rectangle(W / 2, H / 2, W, H, 0x060a14, 0.7).setInteractive();
    const boxW = Math.min(480, W - 60), boxH = 210 + cfg.buttons.length * 66;
    const box = this.scene.add.graphics();
    box.fillStyle(0x18223a, 1);
    box.fillRoundedRect(W / 2 - boxW / 2, H / 2 - boxH / 2, boxW, boxH, 20);
    box.lineStyle(4, 0x3a4f7a, 1);
    box.strokeRoundedRect(W / 2 - boxW / 2, H / 2 - boxH / 2, boxW, boxH, 20);

    const title = this.scene.add.text(W / 2, H / 2 - boxH / 2 + 52, cfg.title, {
      fontFamily: 'Arial Black, Arial', fontSize: '30px', color: cfg.titleColor || '#ffffff',
      stroke: '#000000', strokeThickness: 6, align: 'center',
      wordWrap: { width: boxW - 40 },
    }).setOrigin(0.5);
    const sub = this.scene.add.text(W / 2, H / 2 - boxH / 2 + 106, cfg.sub || '', {
      fontFamily: 'Arial, sans-serif', fontSize: '17px', color: '#b0bec5',
      align: 'center', wordWrap: { width: boxW - 60 },
    }).setOrigin(0.5);
    r.add([dim, box, title, sub]);

    cfg.buttons.forEach((b, i) => {
      const by = H / 2 - boxH / 2 + 160 + i * 66;
      const bg = this.scene.add.graphics();
      bg.fillStyle(b.color, 1);
      bg.fillRoundedRect(W / 2 - (boxW - 80) / 2, by - 25, boxW - 80, 50, 14);
      const label = this.scene.add.text(W / 2, by, b.label, {
        fontFamily: 'Arial Black, Arial', fontSize: '20px', color: '#ffffff',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5);
      const zone = this.scene.add.zone(W / 2 - (boxW - 80) / 2, by - 25, boxW - 80, 50)
        .setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => { AudioSys.sfx('tick'); b.cb(); });
      r.add([bg, label, zone]);
    });

    r.setVisible(true).setAlpha(0);
    this.scene.tweens.add({ targets: r, alpha: 1, duration: 200 });
    this.scene.modalOpen = true;
    this._panelCfg = cfg;
  }

  _hidePanel() {
    this.panel.setVisible(false);
    this.panel.removeAll(true);
    this.scene.modalOpen = false;
    this._panelCfg = null;
  }

  relayout() {
    this._refreshHudLabel();
    if (this._panelCfg && this.panel.visible) this._showPanel(this._panelCfg);
  }
}
window.StageDirector = StageDirector;
