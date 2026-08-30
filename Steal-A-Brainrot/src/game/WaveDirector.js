// Level flow: prep -> waves (timed, with a FINAL WAVE shout) -> boss ->
// victory / defeat panels, and the only places an interstitial can run
// (RETRY and the trip back to HQ -- the first tap is never a natural break).
// Past the authored list the game goes endless on the last recipe with
// compounding hp.
class WaveDirector {
  constructor(scene, combat, economy, hud) {
    this.scene = scene;
    this.combat = combat;
    this.economy = economy;
    this.hud = hud;

    this.state = 'idle';        // idle | prep | wave | boss | victory | defeat
    this.levelN = 1;
    this.waveIdx = 0;
    this.timer = 0;
    this.holdPrep = false;      // tutorial holds the first wave back
    this._revived = false;
    this._bossSpawned = false;
    this._clearedAt = null;

    this.panel = scene.add.container(0, 0).setDepth(1150).setVisible(false);

    combat.onDefeat = () => this._defeat();
    combat.onBossDown = () => {};
  }

  recipeFor(n) {
    const idx = Math.min(n, LEVELS.length) - 1;
    const def = LEVELS[idx];
    let hpMult = Math.pow(CFG.LEVEL.hpGrowth, n - 1);
    if (n > LEVELS.length) hpMult *= Math.pow(CFG.LEVEL.endlessGrowth, n - LEVELS.length);
    return { def, hpMult };
  }

  startLevel(n) {
    this.levelN = n;
    this.recipe = this.recipeFor(n);
    this.waveIdx = 0;
    this._revived = false;
    this._bossSpawned = false;
    this._clearedAt = null;
    this.combat.reset();
    this._hidePanel();
    this.state = 'prep';
    this.timer = this.prepMs();
    this.hud.setLevelLabel('LEVEL ' + n + ' · ' + this.recipe.def.name);
    this.hud.setProgress(0);
    this.scene.fx.banner('LEVEL ' + n, '#ffffff', this.recipe.def.name);
    AudioSys.setMusic('normal');
  }

  totalWaves() { return this.recipe.def.waves.length; }

  // Pacing is per level first, CFG second: the early levels buy their gentler
  // difficulty with time on the clock rather than with weaker enemies.
  prepMs() {
    const v = this.recipe.def.prepMs;
    return v != null ? v : CFG.LEVEL.prepMs;
  }

  waveGapMs() {
    const v = this.recipe.def.waveGapMs;
    return v != null ? v : CFG.LEVEL.waveTimeoutMs;
  }

  clearGapMs() {
    const v = this.recipe.def.clearGapMs;
    return v != null ? v : CFG.LEVEL.waveClearGapMs;
  }

  update(dtMs) {
    switch (this.state) {
      case 'prep':
        if (this.holdPrep) return;
        this.timer -= dtMs;
        if (this.timer <= 0) this._startWave(0);
        break;
      case 'wave': {
        this.timer -= dtMs;
        const cleared = this.combat.allDead();
        if (cleared && this._clearedAt === null) this._clearedAt = this.clearGapMs();
        if (this._clearedAt !== null) this._clearedAt -= dtMs;
        const moreWaves = this.waveIdx < this.totalWaves();

        if (moreWaves) {
          if (this.timer <= 0 || (this._clearedAt !== null && this._clearedAt <= 0)) {
            this._startWave(this.waveIdx);
          }
        } else if (cleared) {
          if (this.recipe.def.boss && !this._bossSpawned) this._spawnBoss();
          else this._victory();
        }
        break;
      }
      case 'boss':
        if (this.combat.allDead()) this._victory();
        break;
    }
  }

  _startWave(i) {
    const waves = this.recipe.def.waves;
    this.waveIdx = i + 1;
    this.state = 'wave';
    this.timer = this.waveGapMs();
    this._clearedAt = null;
    this.combat.startWave(waves[i].spawns, this.recipe.hpMult);
    const last = this.waveIdx === waves.length && !this.recipe.def.boss;
    this.scene.fx.banner(last ? 'FINAL WAVE!' : 'WAVE ' + this.waveIdx + '/' + waves.length,
      last ? '#ff8a80' : '#90caf9');
    AudioSys.sfx('wave');
    AudioSys.setMusic('battle');
    this.hud.setProgress(this.waveIdx / (waves.length + (this.recipe.def.boss ? 1 : 0)));
    if (this.scene.tutorial) this.scene.tutorial.onBattleStart();
  }

  _spawnBoss() {
    this._bossSpawned = true;
    this.state = 'boss';
    this.combat.spawnBoss(this.recipe.def.boss, this.recipe.hpMult);
    this.hud.setProgress(0.95);
  }

  // ------------------------------------------------------------ outcomes

  _victory() {
    if (this.state === 'victory') return;
    this.state = 'victory';
    const banked = this.economy.bank(this.recipe.def.reward);
    SaveSys.addStat('levelsCleared');
    if (this.levelN >= SaveSys.data.level) SaveSys.data.level = this.levelN + 1;
    SaveSys.save();
    Poki.happyTime(1);
    AudioSys.sfx('victory');
    AudioSys.setMusic('normal');
    this.hud.setProgress(1);
    if (this.scene.tutorial) this.scene.tutorial.onVictory();

    this._showPanel({
      title: 'LEVEL ' + this.levelN + ' CLEAR!',
      titleColor: '#ffd54f',
      sub: 'The monsters dropped ' + HUD.money(banked) + '\nSpend it on new brainrots!',
      buttons: [
        { label: '\u{1F6D2} SHOP & NEXT LEVEL', color: 0x43a047, cb: () => this.toHQ() },
      ],
    });
    this.scene.fx.confetti(LAYOUT.width / 2, LAYOUT.height * 0.3, 36);
  }

  _defeat() {
    if (this.state === 'defeat' || this.state === 'victory') return;
    this.state = 'defeat';
    AudioSys.sfx('defeat');
    AudioSys.setMusic('normal');
    this.scene.fx.shake(0.01, 350);
    this.scene.fx.flash(0xd32f2f);

    const buttons = [
      { label: '↻ RETRY LEVEL', color: 0x455a64, cb: () => this.retry() },
      { label: '\u{1F6D2} CHANGE SQUAD', color: 0x37474f, cb: () => this.toHQ(true) },
    ];
    if (!this._revived) {
      buttons.unshift({
        label: '\u{1F4FA} CLEAR THE LAWN (free)', color: 0x7b1fa2, cb: () => this.revive(),
      });
    }
    this._showPanel({
      title: 'THE LAWN IS LOST!',
      titleColor: '#ff8a80',
      sub: 'The monsters got through. Rethink your squad!',
      buttons,
    });
  }

  retry() {
    this._maybeAd(() => this.scene.scene.restart({ level: this.levelN, team: this.scene.teamIds }));
  }

  toHQ(failed) {
    this._maybeAd(() => this.scene.scene.start('HQ'));
  }

  revive() {
    Poki.rewardedBreak().then((watched) => {
      if (!watched) { AudioSys.sfx('denied'); return; }
      this._revived = true;
      this.combat.wipeEnemies();
      this._hidePanel();
      this.state = this._bossSpawned && this.combat.hasBoss() ? 'boss' : 'wave';
      if (this.state === 'wave' && this.waveIdx === 0) this.state = 'prep';
      AudioSys.setMusic('battle');
      this.scene.fx.banner('LAWN CLEARED!', '#ce93d8');
    });
  }

  // Interstitials only on level transitions, only after real gameplay, and
  // never around level 1's first attempt: the first tap is the hook.
  _maybeAd(go) {
    // never between the tutorial's victory tap and the first shop visit
    const firstClear = this.levelN === 1 && this.state === 'victory' && SaveSys.data.stats.levelsCleared <= 1;
    if (!this.scene.playerStartedGameplay || firstClear) { go(); return; }
    const p = Poki.commercialBreak(CFG.ADS.interstitialGapMs);
    if (p && p.then) p.then(go); else go();
  }

  // ------------------------------------------------------------ panels

  _showPanel(cfg) {
    const r = this.panel;
    r.removeAll(true);
    const W = LAYOUT.width, H = LAYOUT.height;

    const dim = this.scene.add.rectangle(W / 2, H / 2, W, H, 0x060a14, 0.7).setInteractive();
    const boxW = Math.min(500, W - 60), boxH = 200 + cfg.buttons.length * 66;
    const box = this.scene.add.graphics();
    box.fillStyle(0x18223a, 1);
    box.fillRoundedRect(W / 2 - boxW / 2, H / 2 - boxH / 2, boxW, boxH, 20);
    box.lineStyle(4, 0x3a4f7a, 1);
    box.strokeRoundedRect(W / 2 - boxW / 2, H / 2 - boxH / 2, boxW, boxH, 20);

    const title = this.scene.add.text(W / 2, H / 2 - boxH / 2 + 50, cfg.title, {
      fontFamily: 'Arial Black, Arial', fontSize: '30px', color: cfg.titleColor || '#ffffff',
      stroke: '#000000', strokeThickness: 6, align: 'center',
      wordWrap: { width: boxW - 40 },
    }).setOrigin(0.5);
    const sub = this.scene.add.text(W / 2, H / 2 - boxH / 2 + 104, cfg.sub || '', {
      fontFamily: 'Arial, sans-serif', fontSize: '17px', color: '#b0bec5',
      align: 'center', wordWrap: { width: boxW - 60 },
    }).setOrigin(0.5);
    r.add([dim, box, title, sub]);

    cfg.buttons.forEach((b, i) => {
      const by = H / 2 - boxH / 2 + 156 + i * 66;
      const bg = this.scene.add.graphics();
      bg.fillStyle(b.color, 1);
      bg.fillRoundedRect(W / 2 - (boxW - 80) / 2, by - 25, boxW - 80, 50, 14);
      const label = this.scene.add.text(W / 2, by, b.label, {
        fontFamily: 'Arial Black, Arial', fontSize: '19px', color: '#ffffff',
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
    if (this._panelCfg && this.panel.visible) this._showPanel(this._panelCfg);
  }
}
window.WaveDirector = WaveDirector;
